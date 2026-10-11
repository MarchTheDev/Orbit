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
//! The endpoints are the same for every picture, differing only in the noun:
//! `/grids/steam/<app>` for covers and `/heroes/steam/<app>` for backdrops. Both
//! answer `{ "success": true, "data": [ { "url": ... } ] }`.

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
/// The answer is in the same shape as the store's own artwork, so a grid and a
/// Steam capsule are interchangeable as far as the picker is concerned.
pub async fn art(
    app_id: u64,
    api_key: &str,
) -> Result<Vec<crate::metadata::ArtworkPick>, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    // Portrait grids are the covers; heroes are the wide backdrops. The two are
    // asked for separately because the API has no endpoint that returns both.
    out.extend(pictures(app_id, key, "grids", "portrait", "342x482,660x930").await?);
    out.extend(pictures(app_id, key, "heroes", "hero", "1920x620,3840x1240").await?);
    Ok(out)
}

/// One endpoint's worth of pictures.
async fn pictures(
    app_id: u64,
    key: &str,
    noun: &str,
    kind: &str,
    dimensions: &str,
) -> Result<Vec<crate::metadata::ArtworkPick>, String> {
    let url = format!("{API}/{noun}/steam/{app_id}?dimensions={dimensions}&limit=24");
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
