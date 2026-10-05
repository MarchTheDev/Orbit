/// Errors surfaced to the UI. Kept small on purpose: the UI shows the message
/// and logs the source chain.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("could not encode data: {0}")]
    Json(#[from] serde_json::Error),

    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("failed to parse response from {service}: {detail}")]
    Parse {
        service: &'static str,
        detail: String,
    },

    #[error("could not launch game: {0}")]
    Launch(String),

    #[error("a session is already running; stop it first")]
    AlreadyPlaying,

    #[error("IGDB credentials are not configured; add a Twitch client ID and secret in Settings")]
    MissingCredentials,

    #[error("not found: {0}")]
    NotFound(String),
}

impl Error {
    pub fn parse(service: &'static str, detail: impl Into<String>) -> Self {
        Self::Parse {
            service,
            detail: detail.into(),
        }
    }

    /// Log the full chain at error level, return the top-level message.
    pub fn log_and_message(&self, context: &str) -> String {
        tracing::error!(error = ?self, context, "operation failed");
        self.to_string()
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
