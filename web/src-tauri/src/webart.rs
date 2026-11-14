//! A last-resort cover: DuckDuckGo's image search.
//!
//! Steam, Bonker and SteamGridDB cover the games that are in a store. Heronite
//! falls back to a plain web image search after its own stores, and the same
//! step is here: when nothing else offers a portrait, a picture of the game's
//! box is asked for by name. DuckDuckGo is chosen because it answers with JSON
//! that needs no key, no client id and no signed request.
//!
//! The result is only ever offered as a choice. A web picture can be a banner,
//! a logo or someone's screenshot, so anything that is not taller than it is
//! wide is dropped before it reaches the picker.

use std::time::Duration;

use serde_json::Value;

use crate::metadata::ArtworkPick;

const HOST: &str = "https://duckduckgo.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Could not start the image search: {e}"))
}

/// The `vqd` token DuckDuckGo puts in its results page, which its JSON needs.
fn vqd(html: &str) -> Option<String> {
    for marker in ["vqd=\"", "vqd='", "vqd="] {
        let Some(at) = html.find(marker) else { continue };
        let rest = &html[at + marker.len()..];
        let token: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '-')
            .collect();
        if !token.is_empty() {
            return Some(token);
        }
    }
    None
}

fn side(row: &Value, key: &str) -> u64 {
    match row.get(key) {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

/// The portrait-shaped results of a search body, best first.
fn portraits(body: &Value, limit: usize) -> Vec<ArtworkPick> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let Some(rows) = body.get("results").and_then(Value::as_array) else {
        return out;
    };
    for row in rows {
        let Some(url) = row
            .get("image")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
        else {
            continue;
        };
        let width = side(row, "width");
        let height = side(row, "height");
        // A box is taller than it is wide. Unmeasured pictures are kept, since
        // the browser will show the crop rather than nothing.
        if height > 0 && height * 10 < width * 13 {
            continue;
        }
        if !seen.insert(url.to_string()) {
            continue;
        }
        out.push(ArtworkPick {
            url: url.to_string(),
            kind: "portrait".into(),
            label: "Web image".into(),
        });
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// Portrait covers for a title, from the web.
pub async fn covers(title: &str, limit: usize) -> Result<Vec<ArtworkPick>, String> {
    let title = title.trim();
    if title.is_empty() {
        return Ok(Vec::new());
    }
    let client = client()?;
    let query = format!("{title} game cover art");
    let page = client
        .get(format!("{HOST}/"))
        .query(&[("q", query.as_str()), ("iax", "images"), ("ia", "images")])
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Could not reach the image search: {e}"))?
        .text()
        .await
        .map_err(|e| format!("The image search did not answer: {e}"))?;
    let token = vqd(&page).ok_or_else(|| "The image search did not return a token.".to_string())?;
    let body = client
        .get(format!("{HOST}/i.js"))
        .query(&[
            ("l", "us-en"),
            ("o", "json"),
            ("q", query.as_str()),
            ("vqd", token.as_str()),
            ("f", ",,,,,"),
            ("p", "1"),
        ])
        .header("Referer", format!("{HOST}/"))
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("The image search did not answer: {e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("The image search answered in a form Orbit cannot read: {e}"))?;
    Ok(portraits(&body, limit))
}
