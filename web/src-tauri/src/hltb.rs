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

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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
    pub game_name: String,
    pub main: f64,
    pub main_extra: f64,
    pub completionist: f64,
    pub source: &'static str,
}

/// One HLTB search result, including the cover art shown on the website.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HltbSuggestion {
    pub id: i64,
    pub name: String,
    pub cover_url: Option<String>,
    pub hltb: HltbData,
}

/// One entry as HLTB returns it: times arrive in seconds, ids as numbers.
#[derive(Debug, Clone, Deserialize)]
struct HltbGame {
    #[serde(default)]
    game_id: i64,
    #[serde(default)]
    game_name: String,
    #[serde(default)]
    game_image: String,
    #[serde(default)]
    game_type: String,
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
#[derive(Debug, Default, Deserialize, Clone)]
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

fn suggestions_cache() -> &'static Mutex<HashMap<String, Vec<HltbSuggestion>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Vec<HltbSuggestion>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The endpoint that worked last time, tried before the guesses.
fn working_endpoint() -> &'static Mutex<Option<String>> {
    static FOUND: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    FOUND.get_or_init(|| Mutex::new(None))
}

/// How long a session handed out by the site is trusted for.
///
/// The site mints one for a browsing session and its own front end keeps it for
/// many searches, so a few minutes is well inside what it expects. Forgetting
/// it sooner than it expires is free - the next lookup mints another one - and
/// forgetting it later would turn a stale token into a lookup that could not
/// answer, which is why the clock is there at all.
const SESSION_TTL: Duration = Duration::from_secs(600);

/// The session last handed out, the endpoint that gave it, and when.
///
/// Minting one is a round trip of its own, and a search is two round trips
/// without it. Keeping it is simply what the site's own front end does.
fn session_store() -> &'static Mutex<Option<(String, Session, Instant)>> {
    static SESSION: OnceLock<Mutex<Option<(String, Session, Instant)>>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(None))
}

/// A session good for this endpoint, if one was handed out recently enough.
fn remembered_session(endpoint: &str) -> Option<Session> {
    let kept = session_store().lock().ok()?;
    match kept.as_ref() {
        Some((from, session, at)) if from == endpoint && at.elapsed() < SESSION_TTL => Some(session.clone()),
        _ => None,
    }
}

fn keep_session(endpoint: &str, session: &Session) {
    if let Ok(mut kept) = session_store().lock() {
        *kept = Some((endpoint.to_string(), session.clone(), Instant::now()));
    }
}

fn forget_session() {
    if let Ok(mut kept) = session_store().lock() {
        *kept = None;
    }
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
    let games = search_candidates(&client, title).await?;
    let Some(best) = pick_best(&games, title) else {
        return Err(format!("HowLongToBeat has no match for \"{title}\"."));
    };
    let hit = data_for(best);
    Ok(remember_hit(key, hit))
}

/// Search HLTB's full title list, including entries without playtime reports.
///
/// The website includes image filenames in each search row, so this serves the
/// same cover art as HLTB for console, upcoming, and other non-Steam titles.
pub async fn suggestions(title: &str) -> Result<Vec<HltbSuggestion>, String> {
    let key = title.trim().to_lowercase();
    if key.chars().count() < 2 {
        return Ok(Vec::new());
    }
    if let Ok(kept) = suggestions_cache().lock() {
        if let Some(found) = kept.get(&key) {
            return Ok(found.clone());
        }
    }

    let client = client()?;
    let games = search_candidates(&client, title).await?;
    let found = ranked_suggestions(games, title);
    if let Ok(mut kept) = suggestions_cache().lock() {
        if kept.len() >= 100 {
            kept.clear();
        }
        kept.insert(key, found.clone());
    }
    Ok(found)
}

/// Search the written title and useful expansions, retrying with a simpler query
/// only when the first answer has no plausible title match.
async fn search_candidates(client: &reqwest::Client, title: &str) -> Result<Vec<HltbGame>, String> {
    let mut successful = None;
    let mut last_error = None;
    for query in query_variants(title) {
        match search_results(client, &query).await {
            Ok(games) => {
                if games.iter().any(|game| title_score(game, title).is_some()) {
                    return Ok(games);
                }
                if successful.is_none() {
                    successful = Some(games);
                }
            }
            Err(error) => last_error = Some(error),
        }
    }
    if let Some(games) = successful {
        Ok(games)
    } else {
        Err(last_error.unwrap_or_else(|| "HowLongToBeat has no matching games.".to_string()))
    }
}

/// Alternative search phrases for common abbreviations and version notes.
fn query_variants(title: &str) -> Vec<String> {
    let title = title.trim();
    let mut queries = vec![title.to_string()];
    let without_note = title.split(['(', '[']).next().unwrap_or(title).trim();
    if !without_note.is_empty() && without_note != title {
        queries.push(without_note.to_string());
    }

    let words: Vec<&str> = title.split_whitespace().collect();
    if words.first().is_some_and(|word| word.eq_ignore_ascii_case("gta")) && words.len() > 1 {
        queries.push(format!("Grand Theft Auto {}", words[1..].join(" ")));
    } else if words.len() >= 4
        && words[0].eq_ignore_ascii_case("grand")
        && words[1].eq_ignore_ascii_case("theft")
        && words[2].eq_ignore_ascii_case("auto")
    {
        queries.push(format!("GTA {}", words[3..].join(" ")));
    }
    let lower = title.to_lowercase();
    if lower.contains("ocarina") && lower.contains("time") {
        queries.push("Ocarina of Time".to_string());
        queries.push("The Legend of Zelda: Ocarina of Time".to_string());
    }

    let mut seen = HashSet::new();
    queries.retain(|query| seen.insert(query.to_lowercase()));
    queries
}

/// The endpoint that worked last time, known names, and then the name read from
/// the site's JavaScript. A successful empty search is still a valid answer.
async fn search_results(client: &reqwest::Client, title: &str) -> Result<Vec<HltbGame>, String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(found) = working_endpoint().lock() {
        if let Some(current) = found.as_ref() {
            candidates.push(current.clone());
        }
    }
    for known in ENDPOINTS {
        if !candidates.iter().any(|candidate| candidate == known) {
            candidates.push(known.to_string());
        }
    }

    let mut last_error = String::from("HowLongToBeat did not answer.");
    for endpoint in &candidates {
        match search(client, endpoint, title).await {
            Ok(games) => {
                remember(endpoint);
                return Ok(games);
            }
            Err(error) => last_error = error,
        }
    }

    for endpoint in discover(client).await {
        if candidates.iter().any(|candidate| candidate == &endpoint) {
            continue;
        }
        match search(client, &endpoint, title).await {
            Ok(games) => {
                remember(&endpoint);
                return Ok(games);
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

/// One search against one endpoint, with a session reused where possible.
///
/// A search is a handshake and then a question. The handshake is skipped when a
/// session from this endpoint is still in hand. A stale session is refreshed
/// once, then the search is retried.
async fn search(client: &reqwest::Client, endpoint: &str, title: &str) -> Result<Vec<HltbGame>, String> {
    if let Some(session) = remembered_session(endpoint) {
        match ask(client, endpoint, title, &session).await {
            Ok(found) => return Ok(found),
            Err(Refusal::Stale) => forget_session(),
            Err(Refusal::Failed(message)) => return Err(message),
        }
    }

    let session = handshake(client, endpoint).await?;
    match ask(client, endpoint, title, &session).await {
        Ok(found) => {
            keep_session(endpoint, &session);
            Ok(found)
        }
        Err(Refusal::Stale) => Err(format!("HowLongToBeat would not open a session for {endpoint}.")),
        Err(Refusal::Failed(message)) => Err(message),
    }
}

/// Why a search went unanswered.
enum Refusal {
    /// The session is no longer good, so the question is worth asking once
    /// more with a fresh one.
    Stale,
    /// Anything else, which asking again would only repeat.
    Failed(String),
}

/// One search with a session already in hand.
async fn ask(
    client: &reqwest::Client,
    endpoint: &str,
    title: &str,
    session: &Session,
) -> Result<Vec<HltbGame>, Refusal> {
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
        .map_err(|e| Refusal::Failed(format!("HowLongToBeat is unreachable: {e}")))?;
    let status = reply.status();
    let text = reply
        .text()
        .await
        .map_err(|e| Refusal::Failed(format!("Could not read the HowLongToBeat reply: {e}")))?;
    // A session that has aged out is refused rather than explained.
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(Refusal::Stale);
    }
    if !status.is_success() {
        return Err(Refusal::Failed(format!(
            "HowLongToBeat answered {status} for {endpoint}."
        )));
    }

    let reply: SearchReply = serde_json::from_str(&text)
        .map_err(|e| Refusal::Failed(format!("Unexpected HowLongToBeat reply: {e}")))?;

    Ok(reply.data)
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

fn data_for(game: &HltbGame) -> HltbData {
    HltbData {
        game_name: game.game_name.clone(),
        main: to_hours(game.comp_main),
        main_extra: to_hours(game.comp_plus),
        completionist: to_hours(game.comp_100),
        source: "hltb",
    }
}

fn ranked_suggestions(games: Vec<HltbGame>, title: &str) -> Vec<HltbSuggestion> {
    let mut scored: Vec<(i64, HltbGame)> = games
        .into_iter()
        .filter(|game| {
            game.game_id > 0
                && !game.game_name.trim().is_empty()
                && !game.game_type.eq_ignore_ascii_case("dlc")
        })
        .filter_map(|game| title_score(&game, title).map(|score| (score, game)))
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));

    let mut ids = HashSet::new();
    scored
        .into_iter()
        .filter_map(|(_, game)| {
            // HLTB can contain separate releases with identical display names
            // (remasters, platform editions, regional releases). Their IDs are
            // the identity; only repeated copies of the same result are noise.
            if !ids.insert(game.game_id) {
                return None;
            }
            Some(HltbSuggestion {
                id: game.game_id,
                name: game.game_name.clone(),
                cover_url: image_url(&game.game_image),
                hltb: data_for(&game),
            })
        })
        .take(20)
        .collect()
}

fn image_url(image: &str) -> Option<String> {
    let image = image.trim();
    if image.is_empty() {
        return None;
    }
    if image.starts_with("https://") || image.starts_with("http://") {
        return Some(image.to_string());
    }
    let path = image.trim_start_matches('/');
    Some(if path.starts_with("games/") {
        format!("{SITE}/{path}")
    } else {
        format!("{SITE}/games/{path}")
    })
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/",
            env!("CARGO_PKG_VERSION"),
            " (game library tracker)"
        ))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Score a candidate against the requested title. Search results often add a
/// series prefix ("The Legend of Zelda: Ocarina of Time") or a subtitle, so
/// contained titles and shared words matter more than identical prefixes.
fn pick_best<'a>(games: &'a [HltbGame], title: &str) -> Option<&'a HltbGame> {
    games
        .iter()
        .filter_map(|game| title_score(game, title).map(|score| (score, game)))
        .max_by_key(|(score, _)| *score)
        .map(|(_, game)| game)
}

fn title_score(game: &HltbGame, title: &str) -> Option<i64> {
    let want = normalize(title);
    let got = normalize(&game.game_name);
    let want_words = title_words(title);
    if want_words.is_empty() {
        return None;
    }
    let got_words = title_words(&game.game_name);
    let requested_numbers: Vec<&str> = want_words
        .iter()
        .filter(|word| word.chars().all(char::is_numeric))
        .map(String::as_str)
        .collect();
    let candidate_numbers: Vec<&str> = got_words
        .iter()
        .filter(|word| word.chars().all(char::is_numeric))
        .map(String::as_str)
        .collect();
    if !requested_numbers.is_empty() && !candidate_numbers.is_empty() && requested_numbers != candidate_numbers {
        return None;
    }
    let shared = want_words.iter().filter(|word| got_words.contains(word)).count();
    let required = if want_words.len() < 2 { 1 } else { 2 };
    if shared < required {
        return None;
    }
    let name_score = if got == want {
        100_000
    } else if got.contains(want.as_str()) {
        80_000 - (got.len().saturating_sub(want.len()) as i64)
    } else if want.contains(got.as_str()) {
        70_000 - (want.len().saturating_sub(got.len()) as i64)
    } else {
        1_000 + (shared as i64 * 1_000) + (shared as i64 * 500 / want_words.len() as i64)
    };
    let has_data = if game.comp_main > 0.0 || game.comp_plus > 0.0 || game.comp_100 > 0.0 { 1 } else { 0 };
    Some(name_score + has_data)
}

fn title_words(s: &str) -> Vec<String> {
    s.split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .flat_map(|word| {
            let lowered = word.to_lowercase();
            match lowered.as_str() {
                // HLTB spells Grand Theft Auto out, while players commonly type GTA.
                "gta" => vec!["grand".into(), "theft".into(), "auto".into()],
                // Normalize common sequel numerals so "GTA 6" matches "GTA VI".
                "i" => vec!["1".into()],
                "ii" => vec!["2".into()],
                "iii" => vec!["3".into()],
                "iv" => vec!["4".into()],
                "v" => vec!["5".into()],
                "vi" => vec!["6".into()],
                "vii" => vec!["7".into()],
                "viii" => vec!["8".into()],
                "ix" => vec!["9".into()],
                "x" => vec!["10".into()],
                "xi" => vec!["11".into()],
                "xii" => vec!["12".into()],
                _ => vec![lowered],
            }
        })
        .collect()
}

fn normalize(s: &str) -> String {
    title_words(s).join("")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(name: &str, main: f64) -> HltbGame {
        HltbGame {
            game_id: 1,
            game_name: name.to_string(),
            game_image: "cover.jpg".to_string(),
            game_type: "game".to_string(),
            comp_main: main,
            comp_plus: main * 1.5,
            comp_100: main * 2.5,
        }
    }

    #[test]
    fn hltb_suggestions_keep_upcoming_games_and_use_the_site_cover_url() {
        let mut upcoming = game("Palia 2", 0.0);
        upcoming.game_id = 2;
        upcoming.game_image = "2_Palia_2.jpg".to_string();
        let results = ranked_suggestions(vec![upcoming], "Palia");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Palia 2");
        assert_eq!(results[0].cover_url.as_deref(), Some("https://howlongtobeat.com/games/2_Palia_2.jpg"));
        assert_eq!(results[0].hltb.main, 0.0);
    }

    #[test]
    fn hltb_suggestions_keep_same_name_releases_but_skip_duplicate_ids_and_dlc() {
        let mut dlc = game("Hades DLC", 3_600.0);
        dlc.game_type = "dlc".to_string();
        let first = game("Hades", 3_600.0);
        let mut remake = game("Hades", 3_600.0);
        remake.game_id = 2;
        let duplicate_id = first.clone();
        let results = ranked_suggestions(vec![first, remake, duplicate_id, dlc], "Hades");
        assert_eq!(results.len(), 2);
        assert!(results.iter().any(|suggestion| suggestion.id == 1));
        assert!(results.iter().any(|suggestion| suggestion.id == 2));
    }

    #[test]
    fn the_exact_title_wins_over_a_sequel() {
        let games = vec![game("Hades II", 40.0), game("Hades", 22.0)];
        let best = pick_best(&games, "Hades").expect("a match");
        assert_eq!(best.game_name, "Hades");
    }

    #[test]
    fn the_exact_title_wins_even_when_it_has_no_times() {
        let games = vec![game("Hades", 0.0), game("Hades Remastered", 22.0)];
        let best = pick_best(&games, "Hades").expect("a match");
        assert_eq!(best.game_name, "Hades");
    }

    #[test]
    fn a_subtitle_search_finds_the_console_game_inside_its_series_name() {
        let games = vec![game("The Legend of Zelda: Ocarina of Time", 26.0), game("Mario Kart 8 Deluxe", 35.0)];
        let best = pick_best(&games, "Ocarina of Time").expect("a match");
        assert_eq!(best.game_name, "The Legend of Zelda: Ocarina of Time");
    }

    #[test]
    fn gta_arabic_number_matches_hltb_roman_numeral_title() {
        let games = vec![game("Grand Theft Auto V", 35.0), game("Grand Theft Auto VI", 0.0)];
        assert_eq!(normalize("GTA 6"), normalize("Grand Theft Auto VI"));
        assert_eq!(pick_best(&games, "gta 6").unwrap().game_name, "Grand Theft Auto VI");
        assert!(title_score(&games[0], "gta 6").is_none());
        assert!(query_variants("GTA 6").contains(&"Grand Theft Auto 6".to_string()));
    }

    #[test]
    fn ocarina_year_and_remake_notes_do_not_hide_the_underlying_game_match() {
        let games = vec![game("The Legend of Zelda: Ocarina of Time", 26.0)];
        assert!(pick_best(&games, "Ocarina of Time (2026 remake)").is_some());
        let queries = query_variants("Ocarina of Time (2026 remake)");
        assert!(queries.contains(&"Ocarina of Time".to_string()));
        assert!(queries.contains(&"The Legend of Zelda: Ocarina of Time".to_string()));
    }

    #[test]
    fn unrelated_search_results_are_not_returned_as_catalogue_matches() {
        let games = vec![game("Mario Kart 8 Deluxe", 35.0)];
        assert!(pick_best(&games, "Ocarina of Time").is_none());
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
    fn a_session_is_only_kept_for_the_endpoint_that_gave_it() {
        forget_session();
        let session = Session {
            token: "abc".to_string(),
            hp_key: None,
            hp_val: None,
        };
        keep_session("/api/search/site", &session);
        assert!(remembered_session("/api/search/site").is_some());
        assert!(remembered_session("/api/find").is_none());
        forget_session();
        assert!(remembered_session("/api/search/site").is_none());
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
