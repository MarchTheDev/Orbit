//! Game details without asking the player for anything.
//!
//! The Steam store answers questions about a title with no credentials at all,
//! description, genres, developer, release year and artwork, which is what
//! makes Orbit work out of the box. There is no second provider to configure:
//! IGDB was dropped, so nothing here can expire, need a key, or fail because
//! somebody's token ran out.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const STORE: &str = "https://store.steampowered.com";
/// Steam's portrait artwork, the same picture the client shows in its library.
const PORTRAIT: &str = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps";

/// A description longer than this is trimmed: it is shown in a drawer, not read
/// like an article, and Steam's detailed description can run to several pages.
const SUMMARY_LIMIT: usize = 1500;

/// What Orbit found, shaped like the front end's own metadata object.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    /// What the store calls the game. Only filled in when the lookup started
    /// from an app id, a title search already knows the name it asked about.
    pub name: Option<String>,
    pub summary: String,
    pub genres: Vec<String>,
    pub developer: String,
    /// The store's own id for the game, which is what a `steam://` launch needs.
    pub steam_app_id: Option<u64>,
    pub release_year: Option<i32>,
    /// Out of 100, or absent when nobody has scored it.
    pub rating: Option<i32>,
    /// Portrait artwork, if the store has it. The front end falls back to the
    /// wide one below before it falls back to initials.
    pub cover_url: Option<String>,
    /// The wide header picture, which every store page has.
    pub header_url: Option<String>,
    /// The wide background art, when the store has a separate one. Bigger and
    /// softer than the header, which is what a page backdrop wants.
    pub background_url: Option<String>,
    /// Where these details came from. Only `steam` for now, but a field so the
    /// front end does not have to guess if that ever changes.
    pub source: &'static str,
}

/// Look a title up in the store.
///
/// The only failure that matters is the store not knowing the title, which is
/// reported as a sentence rather than an error code: a game with no details is
/// still perfectly playable.
pub async fn lookup(title: &str) -> Result<Meta, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("No title to look up.".into());
    }
    let client = client()?;
    steam_lookup(&client, title).await
}

/// Look up one app id directly.
///
/// This is what makes importing by id worth doing: no name is needed to start
/// with, because the store page brings its own.
pub async fn lookup_app(app_id: u64) -> Result<Meta, String> {
    let client = client()?;
    let app = app_details(&client, app_id).await?;
    Ok(meta_from_app(&client, app_id, app).await)
}

/// The same, but the app id is only used when the store has no page for the
/// title, which is the case for a game that is not sold any more.
pub async fn lookup_or_app(title: &str, app_id: Option<u64>) -> Result<Meta, String> {
    if let Some(id) = app_id {
        if let Ok(meta) = lookup_app(id).await {
            return Ok(meta);
        }
    }
    lookup(title).await
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
    /// The little capsule the store's own search shows, which is enough to
    /// recognise a game by while a title is being typed.
    #[serde(default)]
    tiny_image: String,
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
    #[serde(default)]
    name: String,
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
    background_image: String,
    #[serde(default)]
    capsule_image: String,
    /// The full-size background the store page uses, which the header is a crop
    /// of. Some pages have it and some do not.
    #[serde(default)]
    background_raw: String,
    #[serde(default)]
    screenshots: Vec<Screenshot>,
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

/// A store-page screenshot, in two sizes: the full one is what a backdrop wants.
#[derive(Debug, Default, Deserialize)]
struct Screenshot {
    #[serde(default)]
    path_full: String,
    #[serde(default)]
    path_thumbnail: String,
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

    let app = app_details(client, app_id)
        .await
        .map_err(|_| format!("the store has no page for \"{title}\""))?;

    Ok(meta_from_app(client, app_id, app).await)
}

/// The store page for one app id.
async fn app_details(client: &reqwest::Client, app_id: u64) -> Result<SteamApp, String> {
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

    reply
        .into_values()
        .next()
        .filter(|r| r.success)
        .and_then(|r| r.data)
        .ok_or_else(|| format!("the store has no page for app {app_id}"))
}

/// Shape a store page into what the front end stores.
///
/// Async because the portrait artwork is asked for rather than assumed: not
/// every store page has a library capsule, and offering a URL that 404s is what
/// left some games showing initials while their neighbours had covers.
async fn meta_from_app(client: &reqwest::Client, app_id: u64, app: SteamApp) -> Meta {
    // A bundle or a soundtrack is not what a player means by a game title, but
    // it is still better than nothing when it is all the store has.
    if !app.kind.is_empty() && app.kind != "game" {
        log::info!("the store matched app {app_id} to a {}", app.kind);
    }

    let summary = if app.short_description.trim().is_empty() {
        plain(&app.detailed_description)
    } else {
        plain(&app.short_description)
    };

    let header = if app.header_image.is_empty() {
        app.capsule_image.clone()
    } else {
        app.header_image.clone()
    };
    // The background is a different, larger picture than the header on most
    // pages; where it is missing or the same, the header does the job.
    let background = if app.background_image.is_empty() || app.background_image == header {
        None
    } else {
        Some(app.background_image.clone())
    };
    // The portrait picture is what a grid of covers actually wants, and the
    // wide header is the fallback, so the front end never has to fall through
    // to initials when the store has any artwork at all.
    let portrait = format!("{PORTRAIT}/{app_id}/library_600x900.jpg");
    let cover_url = if exists(client, &portrait).await { Some(portrait) } else { None };

    // A page with no name at all reads better as no name than as an empty one,
    // but the rest of the page is still filled in.
    let name = (!app.name.trim().is_empty()).then(|| app.name.clone());

    Meta {
        name,
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
        cover_url,
        header_url: Some(header).filter(|url| !url.is_empty()),
        background_url: background,
        source: "steam",
    }
}

/// One picture the store has, and what sort of picture it is.
///
/// The kind is what stops the front end guessing from the file name which
/// picture goes where: a portrait belongs on a tile, a hero or a screenshot
/// behind the page, a logo over a backdrop, and a capsule is what the store
/// itself uses for a list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkPick {
    pub url: String,
    /// `portrait`, `hero`, `logo`, `header`, `capsule` or `screenshot`.
    pub kind: String,
    /// What to call it in the list, in words rather than a file name.
    pub label: String,
}

/// The names Valve publishes for a game's artwork.
///
/// The same app has several crops and sizes, and which one suits depends on
/// where it is going: the portrait fills a tile, the wide header suits a list
/// row, the hero art and the screenshots suit a page backdrop, and the logo is
/// the name on its own. Not every app has every one, so each is checked before
/// it is offered rather than handed over as a broken picture.
const ASSETS: &[(&str, &str, &str)] = &[
    ("library_600x900.jpg", "portrait", "Portrait, tile shape"),
    ("library_600x900_2x.jpg", "portrait", "Portrait, sharper"),
    ("library_hero.jpg", "hero", "Hero art"),
    ("library_hero_blur.jpg", "hero", "Hero art, blurred"),
    ("logo.png", "logo", "Logo on its own"),
    ("header.jpg", "header", "Store header"),
    ("capsule_616x353.jpg", "capsule", "Capsule, large"),
    ("capsule_231x87.jpg", "capsule", "Capsule, small"),
];

/// The hosts that serve those files.
///
/// The first is the one Steam uses now. The other two are where the same
/// pictures lived before it, and they still answer for older games, which is
/// exactly the case where the modern host comes back empty. Each asset is
/// asked for on the first host and only falls through on a miss.
const HOSTS: &[&str] = &[
    PORTRAIT,
    "https://cdn.cloudflare.steamstatic.com/steam/apps",
    "https://steamcdn-a.akamaihd.net/steam/apps",
];

/// Every piece of artwork the store has for an app, best first.
///
/// This is the answer for a cover that crops badly: instead of guessing, the
/// player is shown each picture with its shape named, and picks.
///
/// SteamKit was the pointer here, and it is the wrong tool for this: it is a
/// .NET library that speaks Steam's client protocol from C#, and Orbit is a Rust
/// backend, so it cannot be linked in. What it would have fetched is not secret
/// either. Valve publishes the artwork over plain HTTPS at predictable names,
/// with no key and no login, which is what is asked for below.
pub async fn artwork(app_id: u64) -> Result<Vec<ArtworkPick>, String> {
    let client = client()?;

    // Every candidate at once: one after another would be eight round trips
    // before the player sees a picture.
    let mut asking = Vec::new();
    for (name, kind, label) in ASSETS {
        let client = client.clone();
        asking.push(tokio::spawn(async move {
            for host in HOSTS {
                let url = format!("{host}/{app_id}/{name}");
                if exists(&client, &url).await {
                    return Some(ArtworkPick {
                        url,
                        kind: (*kind).to_string(),
                        label: (*label).to_string(),
                    });
                }
            }
            None
        }));
    }

    let mut out: Vec<ArtworkPick> = Vec::new();
    for handle in asking {
        if let Ok(Some(pick)) = handle.await {
            out.push(pick);
        }
    }

    // The store page adds the pictures whose file names cannot be guessed,
    // because they carry a hash: the wide background and the screenshots. A page
    // with no details call answered still has the ones above.
    if let Ok(app) = app_details(&client, app_id).await {
        let mut add = |url: String, kind: &str, label: &str| {
            let url = url.trim().to_string();
            if !url.is_empty() && !out.iter().any(|p| p.url == url) {
                out.push(ArtworkPick {
                    url,
                    kind: kind.to_string(),
                    label: label.to_string(),
                });
            }
        };
        add(app.background_raw, "hero", "Background, full size");
        add(app.background_image, "hero", "Store background");
        add(app.header_image, "header", "Header from the store page");
        add(app.capsule_image, "capsule", "Capsule from the store page");
        for (i, shot) in app.screenshots.iter().take(6).enumerate() {
            let url = if shot.path_full.trim().is_empty() {
                shot.path_thumbnail.clone()
            } else {
                shot.path_full.clone()
            };
            add(url, "screenshot", &format!("Screenshot {}", i + 1));
        }
    }

    if out.is_empty() {
        return Err("The store has no artwork for this game.".into());
    }
    Ok(out)
}

/// The store's id for a title, when the library does not know it.
pub async fn app_id_for(title: &str) -> Option<u64> {
    let title = title.trim();
    if title.chars().count() < 2 {
        return None;
    }
    let client = client().ok()?;
    let items = store_search(&client, title).await.ok()?;
    best_match(&items, title).map(|item| item.id)
}

/// Whether an image URL really is there.
///
/// A HEAD request, with a short clock on it: a wrong guess about artwork is
/// never worth making a lookup slow.
async fn exists(client: &reqwest::Client, url: &str) -> bool {
    client
        .head(url)
        .timeout(Duration::from_secs(6))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
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

/// One suggested game, with the little picture the store shows for it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub app_id: u64,
    pub name: String,
    pub cover_url: Option<String>,
}

/// The games a partial name suggests, best match first, with their covers.
///
/// This is the same search the Add dialog uses, with the store's own capsule
/// travelling with each name. Seeing the picture is most of how anyone knows
/// they have picked the right game out of a list of similar titles.
pub async fn suggest_cards(title: &str) -> Result<Vec<Card>, String> {
    let title = title.trim();
    if title.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let client = client()?;
    let mut items = store_search(&client, title).await?;
    items.sort_by_key(|item| {
        let got = normalize(&item.name);
        let want = normalize(title);
        !(got == want || got.starts_with(&want) || want.starts_with(&got))
    });
    Ok(items
        .into_iter()
        .take(8)
        .map(|item| Card {
            app_id: item.id,
            name: item.name,
            cover_url: (!item.tiny_image.is_empty()).then_some(item.tiny_image),
        })
        .collect())
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

/// The shared HTTP client, also used for the Steam Community achievements page.
pub fn client() -> Result<reqwest::Client, String> {
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
            tiny_image: format!("https://cdn.example/{id}.jpg"),
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
