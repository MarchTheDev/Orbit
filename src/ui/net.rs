use std::sync::mpsc::Receiver;

use crate::state::App;

/// Background network jobs run off the UI thread and report back through a
/// channel, so the window never blocks on an HTTP request.
pub mod jobs {
    use std::sync::mpsc::{Receiver, Sender};

    use super::App;

    /// Result of an HLTB lookup.
    pub struct HltbResult {
        pub game_id: i64,
        /// Title the lookup was for, so the editor can match its own request.
        pub title: String,
        pub data: Option<crate::models::HltbData>,
        pub error: Option<String>,
    }

    /// Result of an IGDB metadata search.
    pub struct IgdbResults {
        pub query: String,
        pub games: Vec<crate::models::Game>,
        pub error: Option<String>,
    }

    /// Result of a single-game IGDB fetch.
    pub struct IgdbFetch {
        pub game_id: i64,
        /// Title the fetch was for, so the editor can match its own request.
        pub title: String,
        pub meta: Option<crate::models::Game>,
        pub error: Option<String>,
    }

    pub type HltbTx = Sender<HltbResult>;
    pub type IgdbTx = Sender<IgdbResults>;
    pub type IgdbFetchTx = Sender<IgdbFetch>;

    pub fn hltb_channel() -> (HltbTx, Receiver<HltbResult>) {
        std::sync::mpsc::channel()
    }

    pub fn igdb_channel() -> (IgdbTx, Receiver<IgdbResults>) {
        std::sync::mpsc::channel()
    }

    pub fn igdb_fetch_channel() -> (IgdbFetchTx, Receiver<IgdbFetch>) {
        std::sync::mpsc::channel()
    }

    /// Build a single-threaded runtime for one blocking request.
    ///
    /// Each job gets its own runtime so no tokio state is shared across
    /// threads, which keeps the networking code simple and predictable.
    pub fn run_blocking<F, T>(f: F) -> Result<T, String>
    where
        F: std::future::Future<Output = crate::error::Result<T>>,
    {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("could not start a network thread: {e}"))?;
        rt.block_on(f).map_err(|e| e.to_string())
    }

    /// Start an HLTB lookup for a title and report back.
    pub fn spawn_hltb_lookup(app: &App, game_id: i64, title: &str) {
        let client = app.hltb.clone();
        let title = title.to_string();
        let requested = title.clone();
        std::thread::spawn(move || {
            let (data, error) = match run_blocking({
                let client = client.clone();
                let title = title.clone();
                async move { client.lookup(&title).await }
            }) {
                Ok(d) => (Some(d), None),
                Err(e) => (None, Some(e)),
            };
            crate::ui::net::push_hltb_result(game_id, &requested, data, error);
        });
    }
}

/// Inbox for completed background work, polled once per frame.
pub struct Inbox {
    pub hltb: Receiver<jobs::HltbResult>,
    pub igdb: Receiver<jobs::IgdbResults>,
    pub igdb_fetch: Receiver<jobs::IgdbFetch>,
}

// Global senders, so worker threads can hand results back without borrowing
// the App. `OnceLock` keeps this to a single init with no extra deps.
static HLTB_TX: std::sync::OnceLock<jobs::HltbTx> = std::sync::OnceLock::new();
static IGDB_TX: std::sync::OnceLock<jobs::IgdbTx> = std::sync::OnceLock::new();
static IGDB_FETCH_TX: std::sync::OnceLock<jobs::IgdbFetchTx> = std::sync::OnceLock::new();

pub fn init(hltb: jobs::HltbTx, igdb: jobs::IgdbTx, igdb_fetch: jobs::IgdbFetchTx) {
    let _ = HLTB_TX.set(hltb);
    let _ = IGDB_TX.set(igdb);
    let _ = IGDB_FETCH_TX.set(igdb_fetch);
}

/// Hand an HLTB result to the UI thread.
pub fn push_hltb_result(
    game_id: i64,
    title: &str,
    data: Option<crate::models::HltbData>,
    error: Option<String>,
) {
    if let Some(tx) = HLTB_TX.get() {
        let _ = tx.send(jobs::HltbResult {
            game_id,
            title: title.to_string(),
            data,
            error,
        });
    }
}

pub fn push_igdb_results(query: &str, games: Vec<crate::models::Game>, error: Option<String>) {
    if let Some(tx) = IGDB_TX.get() {
        let _ = tx.send(jobs::IgdbResults {
            query: query.to_string(),
            games,
            error,
        });
    }
}

pub fn push_igdb_fetch(
    game_id: i64,
    title: &str,
    meta: Option<crate::models::Game>,
    error: Option<String>,
) {
    if let Some(tx) = IGDB_FETCH_TX.get() {
        let _ = tx.send(jobs::IgdbFetch {
            game_id,
            title: title.to_string(),
            meta,
            error,
        });
    }
}

/// Start an IGDB search on a worker thread.
pub fn spawn_igdb_search(app: &App, query: &str) {
    let Some(client) = app.igdb.clone() else {
        push_igdb_results(
            query,
            Vec::new(),
            Some(crate::error::Error::MissingCredentials.to_string()),
        );
        return;
    };
    let query = query.to_string();
    let requested = query.clone();
    std::thread::spawn(move || {
        let (games, error) = match jobs::run_blocking({
            let client = client.clone();
            let q = query.clone();
            async move { client.search(&q).await }
        }) {
            Ok(g) => (g, None),
            Err(e) => (Vec::new(), Some(e)),
        };
        push_igdb_results(&requested, games, error);
    });
}

/// Fetch full metadata for a title on a worker thread.
pub fn spawn_igdb_fetch(app: &App, game_id: i64, title: &str) {
    let requested = title.to_string();
    let Some(client) = app.igdb.clone() else {
        push_igdb_fetch(
            game_id,
            &requested,
            None,
            Some(crate::error::Error::MissingCredentials.to_string()),
        );
        return;
    };
    let title = requested.clone();
    std::thread::spawn(move || {
        let (meta, error) = match jobs::run_blocking({
            let client = client.clone();
            let t = title.clone();
            async move { client.by_name(&t).await }
        }) {
            Ok(m) => (Some(m), None),
            Err(e) => (None, Some(e)),
        };
        push_igdb_fetch(game_id, &requested, meta, error);
    });
}

/// Take every finished HLTB job without applying it, so the shell can decide
/// whether the result belongs to the library or to an open editor draft.
pub fn take_hltb(inbox: &Inbox) -> Vec<jobs::HltbResult> {
    let mut out = Vec::new();
    while let Ok(res) = inbox.hltb.try_recv() {
        out.push(res);
    }
    out
}

/// Take every finished IGDB single-game fetch.
pub fn take_igdb_fetch(inbox: &Inbox) -> Vec<jobs::IgdbFetch> {
    let mut out = Vec::new();
    while let Ok(res) = inbox.igdb_fetch.try_recv() {
        out.push(res);
    }
    out
}

/// Take every finished IGDB search.
pub fn take_igdb(inbox: &Inbox) -> Vec<jobs::IgdbResults> {
    let mut out = Vec::new();
    while let Ok(res) = inbox.igdb.try_recv() {
        out.push(res);
    }
    out
}

/// Write an HLTB result onto a saved library entry. Returns true when the
/// library changed.
pub fn apply_hltb(app: &mut App, res: jobs::HltbResult) -> bool {
    match res.data {
        Some(data) => match app.game_by_id(res.game_id) {
            Some(g) => {
                let mut g = g.clone();
                g.hltb = Some(data);
                app.update_game(&g)
            }
            None => false,
        },
        None => {
            if let Some(e) = res.error {
                tracing::warn!(error = %e, title = %res.title, "hltb lookup failed");
                app.last_error = Some(format!("HowLongToBeat: {e}"));
            }
            false
        }
    }
}

/// Write an IGDB single-game fetch onto a saved library entry. Returns true when
/// the library changed.
pub fn apply_igdb_fetch(app: &mut App, res: jobs::IgdbFetch) -> bool {
    match res.meta {
        Some(meta) => app.apply_igdb(res.game_id, &meta),
        None => {
            if let Some(e) = res.error {
                tracing::warn!(error = %e, title = %res.title, "igdb fetch failed");
                app.last_error = Some(format!("IGDB: {e}"));
            }
            false
        }
    }
}
