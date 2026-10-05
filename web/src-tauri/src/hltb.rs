//! HowLongToBeat completion-time lookups.
//!
//! HLTB has no public API. These are the same endpoints their website calls,
//! which means the shape can change without notice: a search now needs a
//! session token first, minted from `<endpoint>/init` and handed back in the
//! `x-auth-token` header, and the endpoint's own name has changed more than
//! once (`/api/find` → `/api/bleed` → `/api/search/site`). So the known names
//! are tried in turn and, when all of them fail, the current one is read out of
//! the site's own JavaScript.
//!
//! Nothing in the app depends on this succeeding, so every failure turns into a
//! sentence a player can read rather than a panic.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Where the site lives.
const SITE: &str = "https://howlongtobeat.com";

/// Names the search endpoint has had, newest first. The last resort is
/// discovery, which reads the current name out of the site's JavaScript.
const ENDPOINTS: [&str; 4] = [
    "/api/search/site",
    "/api/bleed",
    "/api/find",
    "/api/search",
];

/// Completion estimates, in hours, as the front end wants them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HltbData {
    pub main: f64,
    pub main_extra: f64,
    pub completionist: f64,
    pub source: &'static str,
}

/// One entry as HLTB returns it: times arrive in seconds, ids as numbers.
#[derive(Debug, Deserialize)]
struct HltbGame {
    #[serde(default)]
    game_id: i64,
    #[serde(default)]
    game_name: String,
    #[serde(default)]
    comp_main: f64,
    #[serde(default)]
    comp_plus: f64,
    #[serde(default)]
    comp_100: f64,
}

#[derive(Debug, Deserialize)]
struct SearchReply {
    #[serde(default)]
    data: Vec<HltbGame>,
}

/// The session a search is allowed through with. Older builds also expected a
/// honeypot pair; the current one hands back a token on its own, so the pair is
/// optional and only sent when it is actually there.
#[derive(Debug, Default, Deserialize)]
struct Session {
    #[serde(default)]
    token: String,
    #[serde(default, rename = "hpKey")]
    hp_key: Option<String>,
    #[serde(default, rename = "hpVal")]
    hp_val: Option<String>,
}

fn cache() -> &'static Mutex<HashMap<String, HltbData>> {
    static CACHE: OnceLock<Mutex<HashMap<String, HltbData>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The endpoint that worked last time, tried before the guesses.
fn working_endpoint() -> &'static Mutex<Option<String>> {
    static FOUND: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    FOUND.get_or_init(|| Mutex::new(None))
}

/// Search for a game by title and return completion estimates.
///
/// Picks the best title match rather than trusting result order, since HLTB
/// frequently returns sequels and ports first.
pub async fn lookup(title: &str) -> Result<HltbData, String> {
    let key = title.trim().to_lowercase();
    if key.is_empty() {
        return Err("No title to search for.".into());
    }
    if let Ok(c) = cache().lock() {
        if let Some(hit) = c.get(&key) {
            return Ok(hit.clone());
        }
    }

    let client = client()?;

    // The remembered endpoint first, then the known names, then whatever the
    // site's JavaScript says its endpoint is called now.
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(found) = working_endpoint().lock() {
        if let Some(current) = found.as_ref() {
            candidates.push(current.clone());
        }
    }
    for known in ENDPOINTS {
        if !candidates.iter().any(|c| c == known) {
            candidates.push(known.to_string());
        }
    }

    let mut last_error = String::from("HowLongToBeat did not answer.");
    for endpoint in &candidates {
        match search(&client, endpoint, title).await {
            Ok(Some(hit)) => {
                remember(endpoint);
                return Ok(remember_hit(key, hit));
            }
            // The search itself went through and simply has no such game, which
            // is the answer: there is nothing to gain by asking elsewhere.
            Ok(None) => {
                remember(endpoint);
                return Err(format!("HowLongToBeat has no match for \"{title}\"."));
            }
            Err(e) => last_error = e,
        }
    }

    for found in discover(&client).await {
        if candidates.iter().any(|c| c == &found) {
            continue;
        }
        match search(&client, &found, title).await {
            Ok(Some(hit)) => {
                remember(&found);
                return Ok(remember_hit(key, hit));
            }
            Ok(None) => {
                remember(&found);
                return Err(format!("HowLongToBeat has no match for \"{title}\"."));
            }
            Err(e) => last_error = e,
        }
    }

    Err(last_error)
}

/// One search against one endpoint: mint a session, then ask.
async fn search(
    client: &reqwest::Client,
    endpoint: &str,
    title: &str,
) -> Result<Option<HltbData>, String> {
    let session = handshake(client, endpoint).await?;

    // The same query the site's own search box builds.
    let body = serde_json::json!({
        "searchType": "games",
        "searchTerms": [title.trim()],
        "searchPage": 1,
        "size": 20,
        "searchOptions": {
            "games": {
                "userId": 0,
                "platform": "",
                "sortCategory": "popular",
                "rangeCategory": "main",
                "rangeTime": { "min": null, "max": null },
                "gameplay": { "perspective": "", "flow": "", "genre": "", "difficulty": "" },
                "rangeDate": { "min": null, "max": null },
                "modifier": ""
            },
            "users": { "sortCategory": "postcount" },
            "filter": "",
            "sort": 0,
            "randomizer": 0
        }
    });

    let mut req = client
        .post(format!("{SITE}{endpoint}"))
        .header(reqwest::header::REFERER, format!("{SITE}/"))
        .header(reqwest::header::ORIGIN, SITE)
        .header(reqwest::header::ACCEPT, "application/json")
        .header("x-auth-token", session.token.as_str())
        .json(&body);
    if let (Some(k), Some(v)) = (session.hp_key.as_deref(), session.hp_val.as_deref()) {
        req = req.header("x-hp-key", k).header("x-hp-val", v);
    }

    let reply = req
        .send()
        .await
        .map_err(|e| format!("HowLongToBeat is unreachable: {e}"))?;
    let status = reply.status();
    let text = reply
        .text()
        .await
        .map_err(|e| format!("Could not read the HowLongToBeat reply: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "HowLongToBeat answered {status} for {endpoint}."
        ));
    }

    let reply: SearchReply = serde_json::from_str(&text)
        .map_err(|e| format!("Unexpected HowLongToBeat reply: {e}"))?;

    Ok(pick_best(&reply.data, title).map(|best| {
        log::debug!(
            "HowLongToBeat matched \"{}\" ({}) to \"{title}\"",
            best.game_name,
            best.game_id
        );
        HltbData {
            main: to_hours(best.comp_main),
            main_extra: to_hours(best.comp_plus),
            completionist: to_hours(best.comp_100),
            source: "hltb",
        }
    }))
}

/// Ask the site for a session token.
async fn handshake(client: &reqwest::Client, endpoint: &str) -> Result<Session, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let url = format!("{SITE}{endpoint}/init?t={stamp}");

    let text = client
        .get(&url)
        .header(reqwest::header::REFERER, format!("{SITE}/"))
        .header(reqwest::header::ORIGIN, SITE)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("HowLongToBeat is unreachable: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Could not read the HowLongToBeat reply: {e}"))?;

    let session: Session = serde_json::from_str(&text)
        .map_err(|e| format!("HowLongToBeat would not open a session: {e}"))?;
    if session.token.trim().is_empty() {
        return Err(format!("HowLongToBeat handed back no token for {endpoint}."));
    }
    Ok(session)
}

/// Read the name of the current search endpoint out of the site's JavaScript.
///
/// The chunk that performs the search writes it as a path ending in `/init`,
/// which is exactly how the site's own front end finds it again after a rename.
/// A bundle mentions several `/api/` paths, so names with `search` in them come
/// first; the rest are still worth one attempt each, and a wrong guess costs
/// nothing but a failed request.
async fn discover(client: &reqwest::Client) -> Vec<String> {
    let Some(html) = get_text(client, SITE).await else {
        return Vec::new();
    };
    let mut scripts: Vec<String> = Vec::new();
    for chunk in html.split("src=\"").skip(1) {
        let Some(end) = chunk.find('"') else { continue };
        let src = &chunk[..end];
        if !src.contains("/_next/static/") {
            continue;
        }
        scripts.push(if src.starts_with("http") {
            src.to_string()
        } else {
            format!("{SITE}{src}")
        });
        if scripts.len() >= 12 {
            break;
        }
    }

    let mut found: Vec<String> = Vec::new();
    for script in scripts {
        if let Some(js) = get_text(client, &script).await {
            for endpoint in endpoints_in(&js) {
                if !found.contains(&endpoint) {
                    found.push(endpoint);
                }
            }
        }
        if found.len() >= 4 {
            break;
        }
    }

    let ranked = ranked(found);
    if let Some(first) = ranked.first() {
        log::info!("discovered HowLongToBeat endpoint {first}");
    }
    ranked
}

/// Every endpoint-shaped path in one chunk, in the order it is written.
fn endpoints_in(js: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = js;
    while let Some(at) = rest.find("/api/") {
        let tail = &rest[at..];
        let end = tail
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_'))
            .unwrap_or(tail.len());
        let candidate = &tail[..end];
        if let Some(base) = candidate.strip_suffix("/init") {
            if base.len() > "/api/".len() && !found.iter().any(|f| f == base) {
                found.push(base.to_string());
            }
        }
        // `end` cannot be zero (a path starts with the `/` that scanning
        // allows), but a loop that cannot advance would hang the lookup, so it
        // is written as though it could.
        rest = &tail[end.max(1)..];
        if rest.is_empty() {
            break;
        }
    }
    found
}

/// Search-looking names first, since a bundle mentions plenty of other paths.
fn ranked(mut found: Vec<String>) -> Vec<String> {
    found.sort_by_key(|endpoint| !endpoint.contains("search"));
    found.truncate(4);
    found
}

async fn get_text(client: &reqwest::Client, url: &str) -> Option<String> {
    let res = client.get(url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.text().await.ok()
}

fn remember(endpoint: &str) {
    if let Ok(mut found) = working_endpoint().lock() {
        *found = Some(endpoint.to_string());
    }
}

fn remember_hit(key: String, hit: HltbData) -> HltbData {
    if let Ok(mut c) = cache().lock() {
        c.insert(key, hit.clone());
    }
    hit
}

/// HLTB reports seconds; the front end wants hours.
///
/// A reply shape from long ago carried hours directly, so a number too small to
/// be a plausible number of seconds is taken at face value: ten minutes is the
/// shortest a game's main story gets before "hours" reads as the likelier unit.
fn to_hours(raw: f64) -> f64 {
    if raw <= 0.0 {
        return 0.0;
    }
    let hours = if raw < 600.0 { raw } else { raw / 3600.0 };
    (hours * 10.0).round() / 10.0
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/0.1",
            " (game library tracker)"
        ))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Score a candidate against the requested title, preferring exact-ish matches
/// and penalising common suffixes like "(Remastered)" or platform tags.
fn pick_best<'a>(games: &'a [HltbGame], title: &str) -> Option<&'a HltbGame> {
    if games.is_empty() {
        return None;
    }
    let want = normalize(title);
    games
        .iter()
        .map(|g| {
            let got = normalize(&g.game_name);
            let score: i64 = if got == want {
                1000
            } else if got.starts_with(&want) || want.starts_with(&got) {
                500
            } else {
                // Count shared leading characters as a weak signal.
                want.chars()
                    .zip(got.chars())
                    .take_while(|(a, b)| a == b)
                    .count() as i64
            };
            // An entry with no times at all is no use, however good the title
            // match is: a near match with real numbers beats an exact one that
            // would report 0h.
            let has_data = if g.comp_main > 0.0 || g.comp_plus > 0.0 || g.comp_100 > 0.0 {
                50
            } else {
                -500
            };
            (score + has_data, g)
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, g)| g)
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(name: &str, main: f64) -> HltbGame {
        HltbGame {
            game_id: 1,
            game_name: name.to_string(),
            comp_main: main,
            comp_plus: main * 1.5,
            comp_100: main * 2.5,
        }
    }

    #[test]
    fn the_exact_title_wins_over_a_sequel() {
        let games = vec![game("Hades II", 40.0), game("Hades", 22.0)];
        let best = pick_best(&games, "Hades").expect("a match");
        assert_eq!(best.game_name, "Hades");
    }

    #[test]
    fn a_match_with_no_times_loses_to_one_with_times() {
        let games = vec![game("Hades", 0.0), game("Hades Remastered", 22.0)];
        let best = pick_best(&games, "Hades").expect("a match");
        assert_eq!(best.game_name, "Hades Remastered");
    }

    #[test]
    fn punctuation_does_not_stop_a_match() {
        let games = vec![game("Hollow Knight", 31.0)];
        assert!(pick_best(&games, "hollow-knight").is_some());
    }

    #[test]
    fn times_arrive_as_seconds_and_are_shown_as_hours() {
        // 22 hours as the site reports it.
        assert_eq!(to_hours(79_200.0), 22.0);
        assert_eq!(to_hours(45_360.0), 12.6);
        assert_eq!(to_hours(0.0), 0.0);
    }

    #[test]
    fn a_half_hour_game_is_not_filed_under_hours() {
        assert_eq!(to_hours(1_800.0), 0.5);
    }

    #[test]
    fn a_reply_that_already_used_hours_is_not_divided_again() {
        assert_eq!(to_hours(22.0), 22.0);
    }

    #[test]
    fn the_endpoint_is_read_out_of_the_sites_own_javascript() {
        let js = r#"const u=`/api/search/site/init?t=${Date.now()}`;fetch(u)"#;
        assert_eq!(endpoints_in(js), vec!["/api/search/site".to_string()]);
    }

    #[test]
    fn a_path_without_init_is_not_a_search_endpoint() {
        let js = r#"fetch("/api/search/site");fetch("/api/stats")"#;
        assert!(endpoints_in(js).is_empty());
    }

    #[test]
    fn a_name_containing_search_is_preferred() {
        let ranked = ranked(vec![
            "/api/user/stats".to_string(),
            "/api/search/site".to_string(),
        ]);
        assert_eq!(ranked.first().map(String::as_str), Some("/api/search/site"));
    }
}
