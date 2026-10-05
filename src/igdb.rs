use std::time::Duration;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::models::Game;

/// OAuth client for the IGDB API.
///
/// IGDB is owned by Twitch and has no anonymous access: every request needs a
/// `Client-ID` header plus a bearer token obtained from Twitch's
/// client-credentials flow. Get free credentials at
/// <https://dev.twitch.tv/console/app> (register an app, set Client Type to
/// Confidential, note the Client ID and Secret).
#[derive(Debug, Clone)]
pub struct IgdbClient {
    client_id: String,
    client_secret: String,
    http: reqwest::Client,
    /// Cached app access token with its expiry, shared across clones so a
    /// worker thread does not spend a request re-authenticating.
    token: std::sync::Arc<std::sync::RwLock<Option<CachedToken>>>,
}

#[derive(Debug, Clone)]
struct CachedToken {
    value: String,
    /// Unix seconds; refresh slightly early to avoid races.
    expires_at: i64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct IgdbGame {
    name: String,
    summary: Option<String>,
    #[serde(default)]
    first_release_date: Option<i64>,
    #[serde(default)]
    genres: Vec<NamedRef>,
    #[serde(default)]
    platforms: Vec<PlatformRef>,
    #[serde(default)]
    involved_companies: Vec<CompanyRef>,
    #[serde(default)]
    total_rating: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct NamedRef {
    name: String,
}

#[derive(Debug, Deserialize)]
struct PlatformRef {
    name: String,
}

#[derive(Debug, Deserialize)]
struct CompanyRef {
    company: NamedRef,
    developer: bool,
}

/// Fields requested from IGDB. Kept explicit to keep responses small.
const GAME_FIELDS: &str = "fields name,summary,first_release_date,\
 genres.name,platforms.name,involved_companies.company.name,\
 involved_companies.developer,total_rating;";

impl IgdbClient {
    pub fn new(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("Orbit/0.1", " (game library tracker)"))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default();

        Self {
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            http,
            token: Default::default(),
        }
    }

    /// Fetch a valid app access token, reusing the cached one when possible.
    async fn access_token(&self) -> Result<String> {
        // A cached token is reused until shortly before it expires.
        let cached = self.token.read().ok().and_then(|t| t.clone());
        if let Some(cached) = cached {
            let now = chrono::Utc::now().timestamp();
            if cached.expires_at > now + 60 {
                return Ok(cached.value);
            }
        }

        let url = format!(
            "https://id.twitch.tv/oauth2/token?client_id={}&client_secret={}&grant_type=client_credentials",
            self.client_id, self.client_secret
        );
        tracing::debug!("requesting twitch app access token");

        let resp = self.http.post(&url).send().await.map_err(|e| {
            tracing::error!("twitch token request failed: {e}");
            Error::Network(e)
        })?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            tracing::error!("twitch token request returned {status}: {body}");
            return Err(Error::MissingCredentials);
        }

        let token: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| Error::parse("Twitch OAuth", format!("{e}; body: {body}")))?;

        let value = token.access_token;
        let expires_at = chrono::Utc::now().timestamp() + token.expires_in;
        if let Ok(mut t) = self.token.write() {
            *t = Some(CachedToken {
                value: value.clone(),
                expires_at,
            });
        }
        Ok(value)
    }

    /// Search IGDB for games matching `query`.
    pub async fn search(&self, query: &str) -> Result<Vec<Game>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let body = format!("search \"{}\"; {GAME_FIELDS} limit 25;", q.replace('"', ""));
        self.post_games(&body).await
    }

    /// Look a game up by exact-ish title.
    pub async fn by_name(&self, title: &str) -> Result<Game> {
        let t = title.replace('"', "");
        let body = format!("search \"{t}\"; {GAME_FIELDS} limit 10;");
        let games = self.post_games(&body).await?;
        games
            .into_iter()
            .max_by_key(|g| title_similarity(&g.name, title))
            .ok_or_else(|| Error::NotFound(format!("IGDB title \"{title}\"")))
    }

    async fn post_games(&self, apicalypse: &str) -> Result<Vec<Game>> {
        let token = self.access_token().await?;

        let resp = self
            .http
            .post("https://api.igdb.com/v4/games")
            .header("Client-ID", &self.client_id)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "text/plain")
            .header("Accept", "application/json")
            .body(apicalypse.to_string())
            .send()
            .await
            .map_err(|e| {
                tracing::error!("igdb request failed: {e}");
                Error::Network(e)
            })?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            // Token went stale; force a refresh on the next attempt.
            if let Ok(mut t) = self.token.write() {
                *t = None;
            }
            return Err(Error::MissingCredentials);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(Error::parse(
                "IGDB",
                "rate limited (4 req/s); try again shortly",
            ));
        }

        let text = resp.text().await.map_err(Error::Network)?;
        if !status.is_success() {
            tracing::error!("igdb returned {status}: {text}");
            return Err(Error::parse("IGDB", format!("HTTP {status}: {text}")));
        }

        let raw: Vec<IgdbGame> = serde_json::from_str(&text)
            .map_err(|e| Error::parse("IGDB", format!("{e}; body: {}", truncate(&text))))?;
        Ok(raw.into_iter().map(convert).collect())
    }
}

/// Map an IGDB record onto Orbit's `Game`, leaving local fields untouched.
fn convert(raw: IgdbGame) -> Game {
    let mut g = Game::new(raw.name.clone());
    g.description = raw.summary.unwrap_or_default();
    g.release_date = raw.first_release_date.map(|ts| {
        chrono::DateTime::from_timestamp(ts, 0)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default()
    });
    g.genres = raw
        .genres
        .into_iter()
        .map(|n| n.name)
        .filter(|n| !n.is_empty())
        .collect();
    g.platforms = raw
        .platforms
        .into_iter()
        .map(|p| p.name)
        .filter(|n| !n.is_empty())
        .collect();

    let devs: Vec<String> = raw
        .involved_companies
        .iter()
        .filter(|c| c.developer)
        .map(|c| c.company.name.clone())
        .collect();
    let pubs: Vec<String> = raw
        .involved_companies
        .iter()
        .filter(|c| !c.developer)
        .map(|c| c.company.name.clone())
        .collect();
    g.developer = devs.join(", ");
    g.publisher = pubs.join(", ");

    if let Some(r) = raw.total_rating {
        g.rating = r.round() as i32;
    }
    g
}

/// Cheap similarity for picking the right title from a result set.
fn title_similarity(a: &str, b: &str) -> usize {
    let na: String = a
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    let nb: String = b
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    if na == nb {
        10_000
    } else if na.contains(&nb) || nb.contains(&na) {
        5_000
    } else {
        na.chars()
            .zip(nb.chars())
            .take_while(|(x, y)| x == y)
            .count()
    }
}

fn truncate(s: &str) -> String {
    if s.len() <= 200 {
        s.to_string()
    } else {
        format!("{}…", &s[..200])
    }
}
