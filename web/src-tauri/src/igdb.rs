//! Covers from IGDB, the catalogue used when a store has no portrait.
//!
//! IGDB will not answer without a Twitch application id and secret. Orbit does
//! not ship either, and does not ask at all when Settings has neither. A cover
//! from here is one more choice in the picker, not a replacement for Steam.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::metadata::{client, ArtworkPick};

struct CachedToken {
    client_id: String,
    token: String,
    until: Instant,
}

static TOKEN: Mutex<Option<CachedToken>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
struct Token {
    access_token: String,
    #[serde(default)]
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct Game {
    name: String,
    cover: Option<Cover>,
}

#[derive(Debug, Deserialize)]
struct Cover {
    image_id: String,
}

/// Portrait covers for this title.
///
/// `exact` keeps only a name that matches, which is what a silent fill wants.
/// The picker passes false so a near title can still be chosen, with its own
/// name in the label.
pub async fn covers(
    title: &str,
    client_id: &str,
    client_secret: &str,
    exact: bool,
) -> Result<Vec<ArtworkPick>, String> {
    let title = title.trim();
    let client_id = client_id.trim();
    let client_secret = client_secret.trim();
    if title.chars().count() < 2 || client_id.is_empty() || client_secret.is_empty() {
        return Ok(Vec::new());
    }

    let token = token_for(client_id, client_secret).await?;
    let games = match games_for(title, client_id, &token).await {
        // A cached token can outlive a rotated secret. One fresh token, then stop.
        Err(reason) if reason.contains("refused") => {
            let token = token_for(client_id, client_secret).await?;
            games_for(title, client_id, &token).await?
        }
        other => other?,
    };
    let wanted = title.to_lowercase();
    let mut exact_hits = Vec::new();
    let mut rest = Vec::new();
    for game in games {
        let Some(cover) = game.cover else { continue };
        if cover.image_id.is_empty() {
            continue;
        }
        let pick = ArtworkPick {
            url: format!(
                "https://images.igdb.com/igdb/image/upload/t_cover_big/{}.jpg",
                cover.image_id
            ),
            kind: "portrait".into(),
            label: format!("IGDB cover · {}", game.name),
        };
        if game.name.trim().to_lowercase() == wanted {
            exact_hits.push(pick);
        } else if !exact {
            rest.push(pick);
        }
    }
    exact_hits.append(&mut rest);
    Ok(exact_hits)
}

async fn token_for(client_id: &str, client_secret: &str) -> Result<String, String> {
    if let Some(token) = cached(client_id) {
        return Ok(token);
    }
    let http = client()?;
    let response = http
        .post("https://id.twitch.tv/oauth2/token")
        .query(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|e| format!("IGDB could not be reached: {e}"))?;
    if !response.status().is_success() {
        return Err("IGDB refused those Twitch credentials. Check them in Settings → Artwork.".into());
    }
    let token: Token = response.json().await.map_err(|_| {
        "IGDB refused those Twitch credentials. Check them in Settings → Artwork.".to_string()
    })?;
    let life = token.expires_in.saturating_sub(60).clamp(60, 12 * 60 * 60);
    let mut guard = TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(CachedToken {
        client_id: client_id.to_string(),
        token: token.access_token.clone(),
        until: Instant::now() + Duration::from_secs(life),
    });
    Ok(token.access_token)
}

fn cached(client_id: &str) -> Option<String> {
    let guard = TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.as_ref().and_then(|cached| {
        if cached.client_id == client_id && cached.until > Instant::now() {
            Some(cached.token.clone())
        } else {
            None
        }
    })
}

async fn games_for(title: &str, client_id: &str, token: &str) -> Result<Vec<Game>, String> {
    let safe = title.replace(['\\', '"', ';', '\n', '\r'], "");
    let query = format!("search \"{safe}\"; fields name,cover.image_id; where cover != null; limit 8;");
    let http = client()?;
    let response = http
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", client_id)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("Content-Type", "text/plain")
        .body(query)
        .send()
        .await
        .map_err(|e| format!("IGDB could not be reached: {e}"))?;
    if response.status().as_u16() == 401 {
        let mut guard = TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
        return Err("IGDB refused those Twitch credentials. Check them in Settings → Artwork.".into());
    }
    if !response.status().is_success() {
        return Err(format!("IGDB answered {}.", response.status()));
    }
    response
        .json()
        .await
        .map_err(|e| format!("IGDB answered something unexpected: {e}"))
}
