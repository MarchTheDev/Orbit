//! Game details without asking the player for a key.
//!
//! The Steam store answers questions about a title with no credentials at all —
//! description, genres, developer, release year and artwork — which is what
//! makes Orbit work out of the box. IGDB has richer data but needs a Twitch
//! application, so it is used instead when the player has saved one: Orbit
//! mints the app-access token itself and refreshes it when it expires, so
//! there is never a token to paste or a login to redo.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const STORE: &str = "https://store.steampowered.com";
const IGDB: &str = "https://api.igdb.com/v4/games";
const TWITCH_TOKEN: &str = "https://id.twitch.tv/oauth2/token";

/// A description longer than this is trimmed: it is shown in a drawer, not read
/// like an article, and Steam's detailed description can run to several pages.
const SUMMARY_LIMIT: usize = 1500;

/// What Orbit found, shaped like the front end's own metadata object.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub summary: String,
    pub genres: Vec<String>,
    pub developer: String,
    /// The store's own id for the game, which is what a `steam://` launch needs.
    pub steam_app_id: Option<u64>,
    pub release_year: Option<i32>,
    /// Out of 100, or absent when nobody has scored it.
    pub rating: Option<i32>,
    pub cover_url: Option<String>,
    /// Where these details came from: `steam` or `igdb`.
    pub source: &'static str,
}

/// Look a title up, IGDB first when it can be used, Steam otherwise.
///
/// A failure from the richer source is never fatal: the point of this module is
/// that a game added without any setup still gets a description and a cover.
pub async fn lookup(title: &str, igdb: Option<(String, String)>) -> Result<Meta, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("No title to look up.".into());
    }
    let client = client()?;

    let mut igdb_error: Option<String> = None;
    if let Some((client_id, secret)) = igdb {
        match igdb_lookup(&client, &client_id, &secret, title).await {
            Ok(meta) => return Ok(meta),
            Err(e) => {
                log::warn!("IGDB lookup failed, falling back to the store: {e}");
                igdb_error = Some(e);
            }
        }
    }

    steam_lookup(&client, title).await.map_err(|store| match igdb_error {
        // Both were tried, so the message names both rather than blaming
        // whichever happened to be last.
        Some(igdb) => format!("IGDB: {igdb} · and the store: {store}"),
        None => store,
    })
}

// ------------------------------------------------------------------- the store

#[derive(Debug, Deserialize)]
struct SteamSearch {
    #[serde(default)]
    items: Vec<SteamItem>,
}

#[derive(Debug, Deserialize)]
struct SteamItem {
    id: u64,
    name: String,
}

#[derive(Debug, Deserialize)]
struct AppDetails {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Option<SteamApp>,
}

#[derive(Debug, Default, Deserialize)]
struct SteamApp {
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    short_description: String,
    #[serde(default)]
    detailed_description: String,
    #[serde(default)]
    developers: Vec<String>,
    #[serde(default)]
    publishers: Vec<String>,
    #[serde(default)]
    genres: Vec<Named>,
    #[serde(default)]
    release_date: ReleaseDate,
    #[serde(default)]
    header_image: String,
    #[serde(default)]
    capsule_image: String,
    #[serde(default)]
    metacritic: Option<Metacritic>,
}

#[derive(Debug, Default, Deserialize)]
struct Named {
    #[serde(default)]
    description: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Default, Deserialize)]
struct ReleaseDate {
    #[serde(default)]
    date: String,
}

#[derive(Debug, Default, Deserialize)]
struct Metacritic {
    #[serde(default)]
    score: Option<i32>,
}

async fn steam_lookup(client: &reqwest::Client, title: &str) -> Result<Meta, String> {
    let items = store_search(client, title).await?;

    let app_id = best_match(&items, title)
        .map(|item| item.id)
        .ok_or_else(|| format!("the store has no match for \"{title}\""))?;

    let reply: HashMap<String, AppDetails> = client
        .get(format!("{STORE}/api/appdetails"))
        .query(&[
            ("appids", app_id.to_string()),
            ("l", "en".to_string()),
            ("cc", "us".to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("the store is unreachable: {e}"))?
        .json()
        .await
        .map_err(|e| format!("the store answered something unexpected: {e}"))?;

    let app = reply
        .into_values()
        .next()
        .filter(|r| r.success)
        .and_then(|r| r.data)
        .ok_or_else(|| format!("the store has no page for \"{title}\""))?;

    // A bundle or a soundtrack is not what a player means by a game title, but
    // it is still better than nothing when it is all the store has.
    if !app.kind.is_empty() && app.kind != "game" {
        log::info!("the store matched \"{title}\" to a {}", app.kind);
    }

    let summary = if app.short_description.trim().is_empty() {
        plain(&app.detailed_description)
    } else {
        plain(&app.short_description)
    };

    Ok(Meta {
        summary,
        genres: names(&app.genres),
        // A few store pages leave the developer empty and only credit the
        // publisher, which is nearer the truth than an empty line.
        developer: app
            .developers
            .first()
            .or_else(|| app.publishers.first())
            .cloned()
            .unwrap_or_default(),
        steam_app_id: Some(app_id),
        release_year: year_in(&app.release_date.date),
        rating: app.metacritic.and_then(|m| m.score).filter(|s| *s > 0),
        cover_url: Some(if app.header_image.is_empty() {
            app.capsule_image
        } else {
            app.header_image
        })
        .filter(|url| !url.is_empty()),
        source: "steam",
    })
}

/// Ask the store what it has for a name.
async fn store_search(client: &reqwest::Client, title: &str) -> Result<Vec<SteamItem>, String> {
    let search: SteamSearch = client
        .get(format!("{STORE}/api/storesearch/"))
        .query(&[("term", title), ("l", "en"), ("cc", "us")])
        .send()
        .await
        .map_err(|e| format!("the store is unreachable: {e}"))?
        .json()
        .await
        .map_err(|e| format!("the store answered something unexpected: {e}"))?;
    Ok(search.items)
}

/// The titles a store suggests for a partial name, best match first.
///
/// Used by the Add dialog while a name is being typed, so a mistyped title can
/// be corrected before it becomes a permanent entry.
pub async fn suggest(title: &str) -> Result<Vec<String>, String> {
    let title = title.trim();
    if title.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let client = client()?;
    let mut items = store_search(&client, title).await?;
    // The store ranks by relevance already; the closest spelling still leads,
    // because a search for "Hades" should not put "Hades II" first.
    items.sort_by_key(|item| {
        let got = normalize(&item.name);
        let want = normalize(title);
        !(got == want || got.starts_with(&want) || want.starts_with(&got))
    });
    Ok(items.into_iter().map(|item| item.name).take(8).collect())
}

/// The result whose name is closest to what was asked for.
fn best_match<'a>(items: &'a [SteamItem], title: &str) -> Option<&'a SteamItem> {
    let want = normalize(title);
    items
        .iter()
        .map(|item| {
            let got = normalize(&item.name);
            let score = if got == want {
                1000
            } else if got.starts_with(&want) || want.starts_with(&got) {
                500
            } else {
                want.chars()
                    .zip(got.chars())
                    .take_while(|(a, b)| a == b)
                    .count() as i64
            };
            (score, item)
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, item)| item)
}

// --------------------------------------------------------------------- IGDB

#[derive(Debug, Deserialize)]
struct TwitchToken {
    access_token: String,
    #[serde(default)]
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct IgdbGame {
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    genres: Option<Vec<Named>>,
    #[serde(default)]
    involved_companies: Option<Vec<Involved>>,
    #[serde(default)]
    first_release_date: Option<i64>,
    #[serde(default)]
    total_rating: Option<f64>,
    #[serde(default)]
    cover: Option<Cover>,
}

#[derive(Debug, Deserialize)]
struct Involved {
    #[serde(default)]
    developer: bool,
    #[serde(default)]
    company: Option<Named>,
}

#[derive(Debug, Deserialize)]
struct Cover {
    #[serde(default)]
    image_id: Option<String>,
}

/// A token and the moment it stops being usable.
struct Token {
    value: String,
    expires_at: i64,
    client_id: String,
}

fn token_cache() -> &'static Mutex<Option<Token>> {
    static CACHE: OnceLock<Mutex<Option<Token>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// The app-access token, reused until it is nearly expired.
///
/// This is the piece that makes IGDB plug and play: the player saves a Client
/// ID and Secret once and never sees a token, because Orbit asks Twitch for one
/// itself and replaces it before it lapses.
async fn twitch_token(
    client: &reqwest::Client,
    client_id: &str,
    secret: &str,
) -> Result<String, String> {
    let now = now();
    if let Ok(cache) = token_cache().lock() {
        if let Some(token) = cache.as_ref() {
            if token.client_id == client_id && token.expires_at - 60 > now {
                return Ok(token.value.clone());
            }
        }
    }

    let reply = client
        .post(TWITCH_TOKEN)
        .query(&[
            ("client_id", client_id),
            ("client_secret", secret),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|e| format!("Twitch is unreachable: {e}"))?;
    let status = reply.status();
    let text = reply.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Twitch refused the credentials ({status})."));
    }
    let token: TwitchToken = serde_json::from_str(&text)
        .map_err(|e| format!("Twitch answered something unexpected: {e}"))?;

    let value = token.access_token;
    if let Ok(mut cache) = token_cache().lock() {
        *cache = Some(Token {
            value: value.clone(),
            expires_at: now + token.expires_in.max(600),
            client_id: client_id.to_string(),
        });
    }
    Ok(value)
}

async fn igdb_lookup(
    client: &reqwest::Client,
    client_id: &str,
    secret: &str,
    title: &str,
) -> Result<Meta, String> {
    let token = twitch_token(client, client_id, secret).await?;

    // IGDB queries are a small language of their own; the title is quoted inside
    // it, so anything that would close the quote is dropped first.
    let body = format!(
        "search \"{}\"; fields summary,genres.name,involved_companies.developer,\
         involved_companies.company.name,first_release_date,total_rating,cover.image_id; limit 1;",
        title.replace(&['"', '\\'][..], " ")
    );

    let games: Vec<IgdbGame> = client
        .post(IGDB)
        .header("Client-ID", client_id)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB is unreachable: {e}"))?
        .json()
        .await
        .map_err(|e| format!("IGDB answered something unexpected: {e}"))?;

    let game = games
        .into_iter()
        .next()
        .ok_or_else(|| format!("IGDB has no match for \"{title}\""))?;

    Ok(Meta {
        summary: game.summary.map(|s| plain(&s)).unwrap_or_default(),
        genres: names(&game.genres.unwrap_or_default()),
        developer: game
            .involved_companies
            .unwrap_or_default()
            .into_iter()
            .find(|c| c.developer)
            .and_then(|c| c.company)
            .map(|c| c.name)
            .unwrap_or_default(),
        steam_app_id: None,
        release_year: game
            .first_release_date
            .and_then(|secs| chrono_year(secs)),
        rating: game.total_rating.map(|r| r.round() as i32),
        cover_url: game.cover.and_then(|c| c.image_id).map(|id| {
            format!("https://images.igdb.com/igdb/image/upload/t_cover_big/{id}.jpg")
        }),
        source: "igdb",
    })
}

/// The year part of a Unix timestamp, without dragging in a date library.
fn chrono_year(secs: i64) -> Option<i32> {
    if secs <= 0 {
        return None;
    }
    let days = secs / 86_400;
    // Civil-from-days, the same arithmetic the calendar has used since 1970.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    Some((year + if month <= 2 { 1 } else { 0 }) as i32)
}

// -------------------------------------------------------------------- helpers

fn names(values: &[Named]) -> Vec<String> {
    values
        .iter()
        .map(|g| {
            if g.description.trim().is_empty() {
                g.name.clone()
            } else {
                g.description.clone()
            }
        })
        .filter(|name| !name.trim().is_empty())
        .collect()
}

/// A description as prose: tags and entities stripped, whitespace collapsed,
/// and cut off at a sentence where possible.
fn plain(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let text = out
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&hellip;", "…");
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= SUMMARY_LIMIT {
        return text;
    }
    let cut: String = text.chars().take(SUMMARY_LIMIT).collect();
    let trimmed = match cut.rfind(". ") {
        Some(at) if at > SUMMARY_LIMIT / 2 => cut[..=at].to_string(),
        _ => format!("{}…", cut.trim_end()),
    };
    trimmed.trim().to_string()
}

/// The last four-digit year in a release date, which is the only part of
/// "Dec 17, 2020", "Q1 2024" or "To be announced" worth keeping.
fn year_in(date: &str) -> Option<i32> {
    let digits: Vec<char> = date.chars().collect();
    let mut found = None;
    for window in digits.windows(4) {
        if window.iter().all(char::is_ascii_digit) {
            if let Ok(year) = window.iter().collect::<String>().parse::<i32>() {
                if (1970..=2100).contains(&year) {
                    found = Some(year);
                }
            }
        }
    }
    found
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/0.1",
            " (game library tracker)"
        ))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u64, name: &str) -> SteamItem {
        SteamItem {
            id,
            name: name.to_string(),
        }
    }

    #[test]
    fn the_closest_store_result_wins() {
        let items = vec![item(1, "Hades II"), item(2, "Hades"), item(3, "Hades' Star")];
        assert_eq!(best_match(&items, "Hades").map(|i| i.id), Some(2));
    }

    #[test]
    fn tags_and_entities_are_stripped_from_a_description() {
        let html = "<p>Shoot &amp; loot<br/>in <b>space</b></p>";
        assert_eq!(plain(html), "Shoot & loot in space");
    }

    #[test]
    fn a_long_description_is_cut_at_a_sentence() {
        let long = format!("{} And then more words follow.", "A short sentence. ".repeat(120));
        let cut = plain(&long);
        assert!(cut.chars().count() <= SUMMARY_LIMIT + 1);
        assert!(cut.ends_with('.'), "cut at a sentence rather than mid-word: {cut}");
    }

    #[test]
    fn the_year_comes_out_of_whatever_the_store_wrote() {
        assert_eq!(year_in("Dec 17, 2020"), Some(2020));
        assert_eq!(year_in("Q1 2024"), Some(2024));
        assert_eq!(year_in("To be announced"), None);
    }

    #[test]
    fn a_unix_release_date_gives_the_same_year_as_the_calendar() {
        // 2018-09-04.
        assert_eq!(chrono_year(1_536_019_200), Some(2018));
    }

    #[test]
    fn a_page_with_no_developer_falls_back_to_the_publisher() {
        // Guarded by reading the field, which is also what stops the compiler
        // warning that nothing uses it.
        let app: SteamApp = serde_json::from_str(r#"{"publishers":["Annapurna Interactive"]}"#).unwrap();
        assert_eq!(app.publishers.first().map(String::as_str), Some("Annapurna Interactive"));
    }

    #[test]
    fn genres_can_come_back_as_either_field() {
        let values = vec![
            Named {
                description: "Action".into(),
                name: String::new(),
            },
            Named {
                description: String::new(),
                name: "Indie".into(),
            },
        ];
        assert_eq!(names(&values), vec!["Action".to_string(), "Indie".to_string()]);
    }
}
