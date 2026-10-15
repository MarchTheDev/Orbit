//! Cover art from SteamGridDB.
//!
//! Steam's own catalogue is free, needs no key and is what Orbit uses by
//! default. SteamGridDB is the community's collection on top of it: replacement
//! grids and heroes for the same games, which are often sharper and more varied
//! than the capsule the store ships. It costs nothing but it does need a key,
//! because every request is attributed to the person who asked - so Orbit never
//! ships one and never invents one. No key in Settings means this module is
//! never called at all.
//!
//! A Steam id is asked first: `/grids/steam/<app>` and `/heroes/steam/<app>`.
//! Sizes are not filtered. Asking only for two exact crops used to hide the
//! usual 600×900 grids, which looked like the site had nothing. A title is
//! searched only when that id has no cover, and only an exact name is used.
//! Both endpoints answer `{ "success": true, "data": [ { "url": ... } ] }`.

use serde::Deserialize;

const API: &str = "https://www.steamgriddb.com/api/v2";

/// One picture, as the answer describes it.
#[derive(Debug, Clone, Deserialize)]
struct Asset {
    url: String,
    /// Pixels, which the API gives and which are worth sorting by: the largest
    /// of a game's grids is the one that survives being blown up on a detail
    /// page.
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    /// The community's own ranking, where it has one.
    #[serde(default)]
    score: i64,
}

/// The envelope every endpoint answers with.
#[derive(Debug, Clone, Deserialize)]
struct Answer {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<Asset>,
}

/// A game's pictures, best first.
///
/// An empty list is a normal answer: SteamGridDB simply may not have anything
/// for that game, and the caller falls back to what the store had.
///
/// Sizes are not filtered. The old request asked only for two exact crops, and
/// a game whose grids were the usual 600×900 came back empty, which looked like
/// the site had nothing. A Steam id is tried first. A title is used only when
/// that id has no cover, and only an exact name is accepted, so a nearby game
/// does not lend its art.
pub async fn art(
    app_id: Option<u64>,
    title: &str,
    api_key: &str,
) -> Result<Vec<crate::metadata::ArtworkPick>, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    if let Some(app_id) = app_id {
        // A missing page is not a bad key. Name search still gets a turn.
        out.extend(pictures_or_empty(&format!("{API}/grids/steam/{app_id}"), key, "portrait").await?);
        out.extend(pictures_or_empty(&format!("{API}/heroes/steam/{app_id}"), key, "hero").await?);
    }
    if out.iter().any(|pick| pick.kind == "portrait") {
        return Ok(out);
    }
    if let Some(id) = find_game(title, key).await? {
        let mut named = pictures_or_empty(&format!("{API}/grids/game/{id}"), key, "portrait").await?;
        named.extend(pictures_or_empty(&format!("{API}/heroes/game/{id}"), key, "hero").await?);
        named.append(&mut out);
        out = named;
    }
    Ok(deduped(out))
}

/// Pictures, or nothing when the page is simply missing.
///
/// A refused key and a network failure still stop the lookup. A 404 does not,
/// or a game SteamGridDB has under a different id would never be searched by name.
async fn pictures_or_empty(
    url: &str,
    key: &str,
    kind: &str,
) -> Result<Vec<crate::metadata::ArtworkPick>, String> {
    match pictures(url, key, kind).await {
        Ok(found) => Ok(found),
        Err(reason) if reason.contains("refused") || reason.contains("could not be reached") => Err(reason),
        Err(_) => Ok(Vec::new()),
    }
}

/// One endpoint's worth of pictures.
async fn pictures(
    url: &str,
    key: &str,
    kind: &str,
) -> Result<Vec<crate::metadata::ArtworkPick>, String> {
    // Adult and humor pictures are left out by the API unless asked for. Sizes
    // are not filtered: a game whose grids are not one of two crops still has art.
    let url = format!("{url}?limit=24");
    let client = crate::metadata::client()?;
    let answer = client
        .get(&url)
        // The key is the whole of the authentication; there is no login and no
        // session, so it goes on the request rather than in the URL.
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("SteamGridDB could not be reached: {e}"))?;

    let status = answer.status();
    let body = answer.text().await.map_err(|e| e.to_string())?;
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("SteamGridDB refused that key. Check it in Settings → Artwork.".into());
    }
    if !status.is_success() {
        return Err(format!("SteamGridDB answered {status}."));
    }

    // A game with nothing there is not an error, and neither is an answer that
    // says so in its own envelope rather than with a status code.
    let parsed: Answer = match serde_json::from_str(&body) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(Vec::new()),
    };
    if !parsed.success {
        return Ok(Vec::new());
    }

    let mut assets = parsed.data;
    // Best first: what the community ranked highest, and where nothing was
    // ranked, the largest picture.
    assets.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| (b.width * b.height).cmp(&(a.width * a.height)))
    });

    Ok(assets
        .into_iter()
        .enumerate()
        .map(|(index, asset)| crate::metadata::ArtworkPick {
            url: asset.url,
            kind: kind.to_string(),
            label: format!(
                "SteamGridDB {kind} {} · {}×{}",
                index + 1,
                asset.width,
                asset.height
            ),
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct Hit {
    id: u64,
    name: String,
}

#[derive(Debug, Deserialize)]
struct Hits {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<Hit>,
}

/// The SteamGridDB id of a game whose name is this title, ignoring case.
async fn find_game(title: &str, key: &str) -> Result<Option<u64>, String> {
    let wanted = title.trim();
    if wanted.chars().count() < 2 {
        return Ok(None);
    }
    let url = format!("{API}/search/autocomplete/{}", path_term(wanted));
    let client = crate::metadata::client()?;
    let answer = client
        .get(url)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("SteamGridDB could not be reached: {e}"))?;
    let status = answer.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("SteamGridDB refused that key. Check it in Settings → Artwork.".into());
    }
    if !status.is_success() {
        return Ok(None);
    }
    let body = answer.text().await.map_err(|e| e.to_string())?;
    let parsed: Hits = match serde_json::from_str(&body) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(None),
    };
    if !parsed.success {
        return Ok(None);
    }
    let wanted = wanted.to_lowercase();
    Ok(parsed
        .data
        .into_iter()
        .find(|hit| hit.name.trim().to_lowercase() == wanted)
        .map(|hit| hit.id))
}

fn deduped(picks: Vec<crate::metadata::ArtworkPick>) -> Vec<crate::metadata::ArtworkPick> {
    let mut seen = std::collections::HashSet::new();
    picks
        .into_iter()
        .filter(|pick| seen.insert(pick.url.clone()))
        .collect()
}

/// A path segment. Spaces and anything outside a URL name are escaped, so a
/// title with a colon or an apostrophe still reaches the search.
fn path_term(title: &str) -> String {
    let mut out = String::new();
    for byte in title.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::path_term;

    #[test]
    fn a_title_with_punctuation_is_safe_in_a_path() {
        assert_eq!(path_term("Hades"), "Hades");
        assert_eq!(path_term("The Witcher 3"), "The%20Witcher%203");
        assert_eq!(path_term("Don't Starve"), "Don%27t%20Starve");
    }
}
