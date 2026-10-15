//! Portrait covers from SteamGridDB.
//!
//! Steam's own catalogue is free, needs no key and is what Orbit uses by
//! default. SteamGridDB is asked only for a portrait grid, the shape a library
//! tile is. Heroes, logos and wide banners are not covers, and mixing them in
//! is what made a preview look half empty. A page is one screen of covers;
//! the next page is a separate ask, because a popular game has far more than
//! one screen of them.

use serde::Deserialize;

const API: &str = "https://www.steamgriddb.com/api/v2";
/// One screen. The API allows 50; 24 is enough to browse without a wall of them.
const PAGE_SIZE: u32 = 24;
/// The portrait crops. 600×900 is the usual one, and leaving it out used to
/// make a game look as if the site had nothing.
const PORTRAITS: &str = "600x900,660x930,342x482";

/// One picture, as the answer describes it.
#[derive(Debug, Clone, Deserialize)]
struct Asset {
    url: String,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    score: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct Answer {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Vec<Asset>,
}

pub struct Page {
    pub picks: Vec<crate::metadata::ArtworkPick>,
    pub has_more: bool,
}

/// Portrait covers, best first. An empty page is a normal answer.
///
/// A Steam id is tried first. A title is used when that page is empty, including
/// a later page, and only an exact name is accepted.
pub async fn portraits(
    app_id: Option<u64>,
    title: &str,
    api_key: &str,
    page: u32,
) -> Result<Page, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Ok(Page { picks: Vec::new(), has_more: false });
    }

    if let Some(app_id) = app_id {
        let found = grids(&format!("{API}/grids/steam/{app_id}"), key, page).await?;
        // An empty Steam-id page is not "this game has no covers". The name
        // search is used for that page, and again for a later page, because the
        // id that missed on the first screen will miss on the next one too.
        if !found.picks.is_empty() {
            return Ok(found);
        }
    }
    if let Some(id) = find_game(title, key).await? {
        return grids(&format!("{API}/grids/game/{id}"), key, page).await;
    }
    Ok(Page { picks: Vec::new(), has_more: false })
}

async fn grids(base: &str, key: &str, page: u32) -> Result<Page, String> {
    let paged = format!("{base}?dimensions={PORTRAITS}&limit={PAGE_SIZE}&page={page}");
    let mut fetched = get_json(key, &paged).await?;
    // A catalogue that does not understand `page=0` still has a first page.
    // Asking again without the parameter is that page, and only that page.
    if page == 0 && fetched.status == 400 {
        fetched = get_json(key, &format!("{base}?dimensions={PORTRAITS}&limit={PAGE_SIZE}")).await?;
    }
    if fetched.status == 401 || fetched.status == 403 {
        return Err("SteamGridDB refused that key. Check it in Settings → Artwork.".into());
    }
    if fetched.status == 429 {
        return Err("SteamGridDB asked for a pause. Try the next page in a moment.".into());
    }
    if !(200..300).contains(&fetched.status) {
        return Ok(Page { picks: Vec::new(), has_more: false });
    }

    let parsed: Answer = match serde_json::from_str(&fetched.body) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(Page { picks: Vec::new(), has_more: false }),
    };
    if !parsed.success {
        return Ok(Page { picks: Vec::new(), has_more: false });
    }

    // Full before the filter: a page of 24 that loses a few odd crops still
    // has another page behind it.
    let has_more = parsed.data.len() as u32 >= PAGE_SIZE;
    let mut assets: Vec<Asset> = parsed.data.into_iter().filter(|asset| is_portrait(asset.width, asset.height)).collect();
    assets.sort_by(|a, b| {
        b.score.cmp(&a.score).then_with(|| (b.width * b.height).cmp(&(a.width * a.height)))
    });
    let picks = assets
        .into_iter()
        .enumerate()
        .map(|(index, asset)| crate::metadata::ArtworkPick {
            url: asset.url,
            kind: "portrait".into(),
            label: format!(
                "SteamGridDB cover {} · {}×{}",
                page * PAGE_SIZE + index as u32 + 1,
                asset.width,
                asset.height
            ),
        })
        .collect();
    Ok(Page { picks, has_more })
}

struct Fetched {
    status: u16,
    body: String,
}

async fn get_json(key: &str, url: &str) -> Result<Fetched, String> {
    let client = crate::metadata::client()?;
    let answer = client
        .get(url)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("SteamGridDB could not be reached: {e}"))?;
    let status = answer.status().as_u16();
    let body = answer.text().await.map_err(|e| e.to_string())?;
    Ok(Fetched { status, body })
}

/// A cover is taller than it is wide. A missing size is kept, because the
/// request already asked only for portrait crops.
fn is_portrait(width: u32, height: u32) -> bool {
    if width == 0 || height == 0 {
        return true;
    }
    height.saturating_mul(10) >= width.saturating_mul(13)
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
    use super::{is_portrait, path_term};

    #[test]
    fn a_title_with_punctuation_is_safe_in_a_path() {
        assert_eq!(path_term("Hades"), "Hades");
        assert_eq!(path_term("The Witcher 3"), "The%20Witcher%203");
        assert_eq!(path_term("Don't Starve"), "Don%27t%20Starve");
    }

    #[test]
    fn only_a_portrait_crop_counts_as_a_cover() {
        assert!(is_portrait(600, 900));
        assert!(is_portrait(660, 930));
        assert!(is_portrait(342, 482));
        assert!(!is_portrait(460, 215));
        assert!(!is_portrait(512, 512));
        assert!(!is_portrait(1024, 1024));
        assert!(is_portrait(0, 0));
    }
}
