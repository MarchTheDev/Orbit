use std::time::Duration;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::models::HltbData;

/// HowLongToBeat completion-time lookups.
///
/// HLTB has no public API. These are the same JSON endpoints their website
/// calls, which means they can change or rate-limit without notice. Every
/// entry point here is therefore cacheable and failure-tolerant, and nothing
/// in the app depends on it succeeding.
/// HowLongToBeat client.
///
/// The HTTP client is cheap to clone and the cache is shared behind an `Arc`,
/// so a cloned handle sees the same results. That lets a worker thread take
/// its own copy without the UI thread losing the cache.
#[derive(Debug, Clone)]
pub struct HltbClient {
    http: reqwest::Client,
    cache: std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, HltbData>>>,
}

impl Default for HltbClient {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
struct HltbGame {
    game_id: i64,
    game_name: String,
    #[serde(default)]
    comp_main: f64,
    #[serde(default)]
    comp_plus: f64,
    #[serde(default)]
    comp_100: f64,
    #[serde(default)]
    comp_all: f64,
    #[serde(default)]
    review_score: i64,
}

impl HltbClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/0.1",
                " (game library tracker)"
            ))
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        Self {
            http,
            cache: Default::default(),
        }
    }

    /// Cached result for a title, if one has been fetched this session.
    pub fn cached(&self, title: &str) -> Option<HltbData> {
        let key = title.trim().to_lowercase();
        self.cache.read().ok().and_then(|c| c.get(&key).cloned())
    }

    /// Search for a game by title and return completion estimates.
    ///
    /// Picks the best title match rather than trusting result order, since HLTB
    /// frequently returns sequels and ports first.
    pub async fn lookup(&self, title: &str) -> Result<HltbData> {
        let key = title.trim().to_lowercase();
        if key.is_empty() {
            return Err(Error::NotFound("empty title".into()));
        }
        if let Some(hit) = self.cached(title) {
            tracing::debug!("hltb cache hit for {key}");
            return Ok(hit);
        }

        let url = format!(
            "https://howlongtobeat.com/api/search?searchType=all&pageSize=20&q={}",
            urlencode(title.trim())
        );
        tracing::debug!("hltb lookup: {url}");

        let text = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("hltb request failed: {e}");
                Error::Network(e)
            })?
            .text()
            .await
            .map_err(|e| {
                tracing::warn!("hltb body read failed: {e}");
                Error::Network(e)
            })?;

        let games: Vec<HltbGame> = serde_json::from_str(&text).map_err(|e| {
            Error::parse("HowLongToBeat", format!("{e}; body: {}", truncate(&text)))
        })?;

        let best = pick_best(&games, title).ok_or_else(|| {
            tracing::warn!("no hltb match for {title:?}");
            Error::NotFound(format!("no HowLongToBeat match for \"{title}\""))
        })?;

        let data = HltbData {
            main: best.comp_main,
            main_plus: best.comp_plus,
            completionist: best.comp_100,
            speedrun: best.comp_all,
            rating: best.review_score as i32,
            hltb_id: best.game_id,
        };

        if let Ok(mut c) = self.cache.write() {
            c.insert(key, data);
        }
        Ok(data)
    }

    /// Drop cached results, e.g. from a "refresh" button.
    pub fn clear_cache(&self) {
        if let Ok(mut c) = self.cache.write() {
            c.clear();
        }
    }

    pub fn cached_len(&self) -> usize {
        self.cache.read().map(|c| c.len()).unwrap_or(0)
    }
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
            let score = if got == want {
                1000
            } else if got.starts_with(&want) || want.starts_with(&got) {
                500
            } else {
                // Count shared token characters as a weak signal.
                let shared = want
                    .chars()
                    .zip(got.chars())
                    .take_while(|(a, b)| a == b)
                    .count();
                shared
            };
            // Prefer entries that actually have time data.
            let has_data = if g.comp_main > 0.0 { 50 } else { 0 };
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

fn truncate(s: &str) -> String {
    if s.len() <= 200 {
        s.to_string()
    } else {
        format!("{}…", &s[..200])
    }
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
