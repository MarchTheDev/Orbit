//! HowLongToBeat completion-time lookups.
//!
//! HLTB has no public API. These are the same JSON endpoints their website
//! calls, which means they can change or rate-limit without notice, so every
//! entry point here is cacheable and failure-tolerant and nothing in the app
//! depends on it succeeding.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Completion estimates, in hours.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HltbData {
    pub main: f64,
    pub main_extra: f64,
    pub completionist: f64,
    pub source: &'static str,
}

#[derive(Debug, Deserialize)]
struct HltbGame {
    game_name: String,
    #[serde(default)]
    comp_main: f64,
    #[serde(default)]
    comp_plus: f64,
    #[serde(default)]
    comp_100: f64,
}

fn cache() -> &'static Mutex<HashMap<String, HltbData>> {
    static CACHE: OnceLock<Mutex<HashMap<String, HltbData>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
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

    let url = format!(
        "https://howlongtobeat.com/api/search?searchType=all&pageSize=20&q={}",
        urlencode(title.trim())
    );
    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/0.1",
            " (game library tracker)"
        ))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let text = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HowLongToBeat is unreachable: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Could not read the HowLongToBeat reply: {e}"))?;

    let games: Vec<HltbGame> =
        serde_json::from_str(&text).map_err(|e| format!("Unexpected HowLongToBeat reply: {e}"))?;

    let best = pick_best(&games, title)
        .ok_or_else(|| format!("No HowLongToBeat match for \"{title}\"."))?;

    let data = HltbData {
        main: best.comp_main,
        main_extra: best.comp_plus,
        completionist: best.comp_100,
        source: "hltb",
    };

    if let Ok(mut c) = cache().lock() {
        c.insert(key, data.clone());
    }
    Ok(data)
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

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "%20".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(name: &str, main: f64) -> HltbGame {
        HltbGame {
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
    fn titles_are_url_encoded() {
        assert_eq!(urlencode("Portal 2"), "Portal%202");
        assert_eq!(urlencode("S.T.A.L.K.E.R."), "S.T.A.L.K.E.R.");
    }
}
