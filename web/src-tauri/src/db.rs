//! The library, in SQLite.
//!
//! One row per game and one row per play session. Playtime is then always a sum
//! of real sessions rather than a number in a file that can drift away from
//! reality, and the history survives the app being closed, moved or upgraded.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bumped whenever the schema below changes, and never guessed at.
///
/// 2, the metadata column is called `meta` rather than `igdb`, since Orbit no
///     longer talks to IGDB at all, and a game can list the programs it wants
///     started alongside it.
/// 5, a game can be on the library's shelf before it has a program to start.
/// 6, a game can be hidden from the library without being removed from it.
const SCHEMA_VERSION: i64 = 6;

/// How a session came to an end. Short enough to read in a table.
pub const ENDED_MANUAL: &str = "manual";
pub const ENDED_PROCESS: &str = "process exit";
pub const ENDED_FAILED: &str = "failed";
pub const ENDED_RECOVERED: &str = "recovered";
/// The app was closed while a session was running, so the clock stopped with
/// it. The time up to that moment is the player's and is kept.
pub const ENDED_APP_CLOSED: &str = "app closed";

/// Seconds since the Unix epoch, which is what every timestamp in here is.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The same moment in milliseconds, for a UI clock that must not drift.
pub fn epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The library. One connection, guarded, behind Tauri's shared state.
pub struct Db {
    conn: Mutex<Connection>,
}

/// A game as the front end wants it, with playtime worked out from its sessions.
///
/// The names match the front end's own `Game` interface on purpose, so the UI
/// does not have to know any of this happened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRow {
    pub id: String,
    pub title: String,
    pub exe_path: Option<String>,
    pub install_dir: Option<String>,
    /// `C:`, worked out from the install folder.
    pub drive: String,
    pub size_bytes: u64,
    pub size_gb: f64,
    pub status: String,
    pub favorite: bool,
    /// A total the player typed in, which wins over the sum of sessions.
    pub manual_play_secs: i64,
    pub cover_path: Option<String>,
    pub launch: Value,
    /// What a store knows about the game. The field was called `igdb` before
    /// IGDB was dropped; the name now says what it holds rather than where it
    /// came from.
    pub meta: Option<Value>,
    pub hltb: Option<Value>,
    /// Programs Orbit starts at the same time as the game.
    pub companions: Vec<Companion>,
    /// Something the player means to play, which is not on this machine yet.
    pub planned: bool,
    /// On the library's shelf with nothing to start yet: added by title alone,
    /// waiting for its program or kept as a game timed by hand.
    pub in_library: bool,
    /// Kept out of the library without being removed from it.
    pub hidden: bool,
    /// Achievements, as last read, with the ones the player has ticked.
    pub achievements: Vec<serde_json::Value>,
    pub notes: String,
    pub hue: i64,
    #[serde(rename = "addedAt")]
    pub created_at: String,
    pub last_played: Option<String>,
    /// Everything played, in seconds: the sessions plus the time typed in.
    ///
    /// Seconds rather than minutes, because rounding down hid short sessions
    /// entirely: ninety seconds of play reported as one whole minute, and a run
    /// of sessions under a minute added up to nothing at all.
    pub play_secs: i64,
    pub session_count: i64,
    pub longest_secs: i64,
    /// True while a session for this game is open right now.
    pub running: bool,
}

/// A program started alongside a game, such as a frame-rate tool or a mod
/// manager. `args` is kept as typed, exactly like a launch target's.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Companion {
    pub path: String,
    #[serde(default)]
    pub args: String,
}

/// One play session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: i64,
    pub game_id: String,
    pub game_title: String,
    pub started_at: i64,
    /// `None` while the session is still going.
    pub ended_at: Option<i64>,
    pub duration_secs: i64,
    pub category: String,
    pub note: String,
    /// True when the player typed the time in rather than playing.
    pub manual: bool,
    pub ended_by: Option<String>,
}

/// A player's own note about a game.
///
/// Nothing writes these automatically: the player says what happened, when, and
/// how long it took, which is a different thing from a tracked session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogRow {
    pub id: i64,
    pub game_id: String,
    /// Filled in wherever the game is joined; empty on a bare row.
    #[serde(default)]
    pub game_title: String,
    /// When it happened, as Unix seconds, to the minute the player chose.
    pub at: i64,
    /// How much time the note is about, in seconds.
    pub secs: i64,
    pub note: String,
    pub created_at: i64,
}

/// Library-wide figures for the statistics row.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Sum of every game's *effective* playtime, so a manual total counts.
    pub total_secs: i64,
    /// The sessions on their own, without any time typed in by hand.
    pub session_secs: i64,
    /// Games with at least one session, counted from the sessions themselves.
    ///
    /// Reading this off the library's playtime instead meant deleting every
    /// session of a game left it counted as tracked, because a manual total, or
    /// a row that had not been recomputed, still added up to something.
    pub tracked_games: i64,
    pub total_games: i64,
    pub session_count: i64,
    pub longest_secs: i64,
    pub first_play: Option<i64>,
    pub last_play: Option<i64>,
}

impl Db {
    /// Open (creating if needed) the database in Orbit's data folder.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let conn =
            Connection::open(path).map_err(|e| format!("Could not open the library: {e}"))?;
        Self::prepare(conn)
    }

    /// An in-memory database, for tests.
    #[cfg(test)]
    pub fn open_memory() -> Result<Self, String> {
        Self::prepare(Connection::open_in_memory().map_err(|e| e.to_string())?)
    }

    fn prepare(conn: Connection) -> Result<Self, String> {
        // WAL keeps a read from blocking a write, and NORMAL is the right trade
        // for a single-user desktop app.
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("Could not set the journal mode: {e}"))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("Could not enable foreign keys: {e}"))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| format!("Could not set the sync mode: {e}"))?;
        Self::migrate(&conn)?;
        Self::close_orphans(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Close whatever a closed app left open, so nothing pretends to be running.
    ///
    /// Done on every open rather than only when migrating: an app that is killed
    /// mid-session comes back to a schema that is already current, and that
    /// session still needs closing.
    ///
    /// Every open session is closed here, at its heartbeat. Orbit starting up is
    /// proof that nothing it was watching is still being watched, and a session
    /// left open is a game the interface would show as running with a clock
    /// ticking on it. The time up to the last heartbeat is the player's and is
    /// kept; the time between the app dying and this moment is not counted,
    /// because nobody knows whether the game was still open for any of it.
    ///
    /// A session from before this column existed has no heartbeat, so it ends
    /// where it started. That loses the time of one session in a library that
    /// predates the fix, which is better than counting a night of playtime for a
    /// game that may have been closed after five minutes.
    fn close_orphans(conn: &Connection) -> Result<(), String> {
        let closed = conn
            .execute(
                "UPDATE sessions
                    SET ended_at      = COALESCE(last_seen, started_at),
                        duration_secs = MAX(0, COALESCE(last_seen, started_at) - started_at),
                        ended_by      = ?1
                  WHERE ended_at IS NULL",
                params![ENDED_RECOVERED],
            )
            .map_err(|e| format!("Could not tidy up open sessions: {e}"))?;
        if closed > 0 {
            log::info!("closed {closed} session(s) left open by a previous run");
        }
        Ok(())
    }

    /// Create anything that is missing, one step at a time.
    ///
    /// Gated on `user_version`, so opening an existing library does nothing and
    /// opening it twice in a row is harmless.
    fn migrate(conn: &Connection) -> Result<(), String> {
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| format!("Could not read the schema version: {e}"))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        log::info!("migrating the library from schema {version} to {SCHEMA_VERSION}");

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS games (
                id               TEXT    PRIMARY KEY,
                title            TEXT    NOT NULL,
                launch           TEXT    NOT NULL DEFAULT '{"kind":"none"}',
                exe_path         TEXT,
                install_dir      TEXT,
                size_bytes       INTEGER NOT NULL DEFAULT 0,
                status           TEXT    NOT NULL DEFAULT 'backlog',
                favorite         INTEGER NOT NULL DEFAULT 0,
                manual_play_secs INTEGER NOT NULL DEFAULT 0,
                cover_path       TEXT,
                meta             TEXT,
                hltb             TEXT,
                companions       TEXT    NOT NULL DEFAULT '[]',
                planned          INTEGER NOT NULL DEFAULT 0,
                in_library       INTEGER NOT NULL DEFAULT 0,
                hidden           INTEGER NOT NULL DEFAULT 0,
                achievements     TEXT    NOT NULL DEFAULT '[]',
                notes            TEXT    NOT NULL DEFAULT '',
                logs             TEXT    NOT NULL DEFAULT '[]',
                hue              INTEGER NOT NULL DEFAULT 0,
                created_at       INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id       TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                started_at    INTEGER NOT NULL,
                ended_at      INTEGER,
                -- The last time the app was sure the game was still going. A
                -- session that is still open when Orbit starts was left behind
                -- by something, and this is where its time is cut off.
                last_seen     INTEGER,
                duration_secs INTEGER NOT NULL DEFAULT 0,
                category      TEXT    NOT NULL DEFAULT 'Main story',
                note          TEXT    NOT NULL DEFAULT '',
                manual        INTEGER NOT NULL DEFAULT 0,
                ended_by      TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_game    ON sessions(game_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

            -- The player's own notes: what happened, when, and how long it took.
            -- Written by hand, never by the tracker.
            CREATE TABLE IF NOT EXISTS game_logs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id    TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                at         INTEGER NOT NULL,
                secs       INTEGER NOT NULL DEFAULT 0,
                note       TEXT    NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                -- Where the player put it in their own order. Everything starts
                -- at zero, which falls back to newest first.
                position   INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_game_logs_game ON game_logs(game_id, at DESC);
            "#,
        )
        .map_err(|e| format!("Could not build the library: {e}"))?;

        // Anything a version 1 library has that version 2 spells differently.
        Self::upgrade_to_2(conn)?;
        // Version 3 adds what a game planned rather than installed needs, plus
        // the player's own order for each game's log.
        Self::upgrade_to_3(conn)?;
        // Version 4 adds the heartbeat, so a session left open by a crash has
        // an end that is known rather than guessed.
        Self::upgrade_to_4(conn)?;

        // Version 5 adds the shelf flag: a game put in the library by hand,
        // which has nothing to start yet but is not a plan either.
        Self::upgrade_to_5(conn)?;

        // Version 6 adds hiding: a game that is still in the library, with its
        // sessions and its notes, and simply out of the way.
        Self::upgrade_to_6(conn)?;

        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("Could not record the schema version: {e}"))?;
        Ok(())
    }

    /// Bring a version 1 library up to date, or do nothing to a new one.
    ///
    /// Both steps are conditional because a fresh library is built by the batch
    /// above and already has the right shape.
    fn upgrade_to_2(conn: &Connection) -> Result<(), String> {
        let names: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(games)")
                .map_err(|e| format!("Could not read the library layout: {e}"))?;
            // Collected into a binding here rather than returned as the block's
            // own expression: the rows borrow the statement, and a tail
            // expression outlives the locals it borrows from.
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| format!("Could not read the library layout: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Could not read the library layout: {e}"))?;
            rows
        };

        if names.iter().any(|c| c == "igdb") && !names.iter().any(|c| c == "meta") {
            // IGDB is gone from the app, but the details it fetched are still
            // the player's data, kept under a name that says what they are
            // rather than where they came from.
            conn.execute("ALTER TABLE games RENAME COLUMN igdb TO meta", [])
                .map_err(|e| format!("Could not rename the metadata column: {e}"))?;
            log::info!("renamed games.igdb to games.meta");
        }
        if !names.iter().any(|c| c == "companions") {
            conn.execute(
                "ALTER TABLE games ADD COLUMN companions TEXT NOT NULL DEFAULT '[]'",
                [],
            )
            .map_err(|e| format!("Could not add the companions column: {e}"))?;
            log::info!("added games.companions");
        }
        Ok(())
    }

    /// Bring a version 1 or 2 library up to date.
    ///
    /// Every step is conditional, because a fresh library is built by the batch
    /// above and already has these.
    fn upgrade_to_3(conn: &Connection) -> Result<(), String> {
        let columns = |table: &str, conn: &Connection| -> Result<Vec<String>, String> {
            let mut stmt = conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(|e| format!("Could not read the library layout: {e}"))?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| format!("Could not read the library layout: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Could not read the library layout: {e}"))?;
            Ok(rows)
        };

        let games = columns("games", conn)?;
        if !games.iter().any(|c| c == "planned") {
            conn.execute(
                "ALTER TABLE games ADD COLUMN planned INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("Could not add the planned column: {e}"))?;
            log::info!("added games.planned");
        }
        if !games.iter().any(|c| c == "achievements") {
            conn.execute(
                "ALTER TABLE games ADD COLUMN achievements TEXT NOT NULL DEFAULT '[]'",
                [],
            )
            .map_err(|e| format!("Could not add the achievements column: {e}"))?;
            log::info!("added games.achievements");
        }

        let logs = columns("game_logs", conn)?;
        if !logs.iter().any(|c| c == "position") {
            conn.execute(
                "ALTER TABLE game_logs ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("Could not add the log order column: {e}"))?;
            log::info!("added game_logs.position");
        }
        Ok(())
    }

    /// Bring a version 3 library up to date.
    ///
    /// One column: the last moment a session was seen to be alive. Sessions that
    /// were already open when this arrived have no heartbeat to show, so they
    /// are treated as having ended where they started: Orbit does not know how
    /// long they were played, and inventing a number would put time in the
    /// library that nobody spent.
    fn upgrade_to_4(conn: &Connection) -> Result<(), String> {
        let mut stmt = conn
            .prepare("PRAGMA table_info(sessions)")
            .map_err(|e| format!("Could not read the session layout: {e}"))?;
        let columns = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| format!("Could not read the session layout: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the session layout: {e}"))?;
        drop(stmt);

        if !columns.iter().any(|c| c == "last_seen") {
            conn.execute("ALTER TABLE sessions ADD COLUMN last_seen INTEGER", [])
                .map_err(|e| format!("Could not add the session heartbeat: {e}"))?;
            log::info!("added sessions.last_seen");
        }
        Ok(())
    }

    /// Bring a version 4 library up to date.
    ///
    /// One column: whether a game belongs to the library before it has a
    /// program. Everything already in the library has one, so they read as
    /// `false` and behave exactly as they did.
    fn upgrade_to_5(conn: &Connection) -> Result<(), String> {
        let mut stmt = conn
            .prepare("PRAGMA table_info(games)")
            .map_err(|e| format!("Could not read the library layout: {e}"))?;
        let columns = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| format!("Could not read the library layout: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the library layout: {e}"))?;
        drop(stmt);

        if !columns.iter().any(|c| c == "in_library") {
            conn.execute(
                "ALTER TABLE games ADD COLUMN in_library INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("Could not add the library shelf column: {e}"))?;
            log::info!("added games.in_library");
        }
        Ok(())
    }

    /// Bring a version 5 library up to date.
    ///
    /// One column: whether a game is being kept out of sight. Nothing in the
    /// library is hidden by it, so every game already there behaves as before.
    fn upgrade_to_6(conn: &Connection) -> Result<(), String> {
        let mut stmt = conn
            .prepare("PRAGMA table_info(games)")
            .map_err(|e| format!("Could not read the library layout: {e}"))?;
        let columns = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| format!("Could not read the library layout: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the library layout: {e}"))?;
        drop(stmt);

        if !columns.iter().any(|c| c == "hidden") {
            conn.execute(
                "ALTER TABLE games ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("Could not add the hidden column: {e}"))?;
            log::info!("added games.hidden");
        }
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "The library is not usable.".to_string())
    }

    // ------------------------------------------------------------- the library

    /// Every game, with playtime worked out.
    pub fn list_games(&self) -> Result<Vec<GameRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT g.id, g.title, g.launch, g.exe_path, g.install_dir, g.size_bytes,
                       g.status, g.favorite, g.manual_play_secs, g.cover_path,
                       g.meta, g.hltb, g.notes, g.companions, g.hue, g.created_at,
                       COALESCE(SUM(s.duration_secs), 0)              AS total_secs,
                       COUNT(s.id)                                    AS session_count,
                       COALESCE(MAX(s.duration_secs), 0)              AS longest_secs,
                       MIN(s.started_at)                              AS first_play,
                       MAX(COALESCE(s.ended_at, s.started_at))        AS last_end,
                       COALESCE(SUM(CASE WHEN s.ended_at IS NULL THEN 1 ELSE 0 END), 0) AS open_count,
                       g.planned, g.achievements, g.in_library, g.hidden
                  FROM games g
                  LEFT JOIN sessions s ON s.game_id = g.id
                 GROUP BY g.id
                 ORDER BY g.title COLLATE NOCASE
                "#,
            )
            .map_err(|e| format!("Could not read the library: {e}"))?;

        let rows = stmt
            .query_map([], |r| {
                let launch: Option<String> = r.get(2)?;
                let meta: Option<String> = r.get(10)?;
                let hltb: Option<String> = r.get(11)?;
                let companions: Option<String> = r.get(13)?;
                let created_at: i64 = r.get(15)?;
                let total_secs: i64 = r.get(16)?;
                let session_count: i64 = r.get(17)?;
                let longest_secs: i64 = r.get(18)?;
                let last_end: Option<i64> = r.get(20)?;
                let open_count: i64 = r.get(21)?;
                let manual_play_secs: i64 = r.get(8)?;
                let size_bytes: i64 = r.get(5)?;
                let install_dir: Option<String> = r.get(4)?;
                let achievements: Option<String> = r.get(23)?;
                let in_library: i64 = r.get(24)?;
                let hidden: i64 = r.get(25)?;

                // The typed-in time is time played away from Orbit, so it adds to
                // what the sessions recorded rather than standing in for it.
                // Replacing the sum is what made a game with ten hours of
                // sessions and a five hour correction report five hours.
                let effective = total_secs.saturating_add(manual_play_secs);

                Ok(GameRow {
                    // No folder means no drive. Guessing C: listed every game
                    // that had not been installed anywhere under the system
                    // drive, which is a lie about where the player's files are.
                    drive: install_dir
                        .as_deref()
                        .map(|p| crate::storage::drive_of(Path::new(p)))
                        .unwrap_or_default(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    launch: parse(launch.as_deref(), r#"{"kind":"none"}"#),
                    exe_path: r.get(3)?,
                    install_dir,
                    size_bytes: size_bytes.max(0) as u64,
                    size_gb: size_bytes.max(0) as f64 / 1e9,
                    status: r.get(6)?,
                    favorite: r.get::<_, i64>(7)? != 0,
                    manual_play_secs,
                    cover_path: r.get(9)?,
                    meta: meta.as_deref().and_then(|v| serde_json::from_str(v).ok()),
                    hltb: hltb.as_deref().and_then(|v| serde_json::from_str(v).ok()),
                    notes: r.get(12)?,
                    companions: parse_vec(companions.as_deref()),
                    planned: r.get::<_, i64>(22)? != 0,
                    in_library: in_library != 0,
                    hidden: hidden != 0,
                    achievements: achievements
                        .as_deref()
                        .and_then(|v| serde_json::from_str::<Vec<Value>>(v).ok())
                        .unwrap_or_default(),
                    hue: r.get(14)?,
                    created_at: iso8601(created_at),
                    last_played: last_end.map(iso8601),
                    play_secs: effective,
                    session_count,
                    longest_secs,
                    running: open_count > 0,
                })
            })
            .map_err(|e| format!("Could not read the library: {e}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the library: {e}"))
    }

    pub fn game(&self, id: &str) -> Result<Option<GameRow>, String> {
        Ok(self.list_games()?.into_iter().find(|g| g.id == id))
    }

    /// Insert a game, or update the one with the same id.
    pub fn upsert_game(&self, game: &GameWrite) -> Result<(), String> {
        if game.id.trim().is_empty() {
            return Err("A game needs an id.".into());
        }
        if game.title.trim().is_empty() {
            return Err("A game needs a title.".into());
        }
        let size_bytes: i64 = match (game.size_bytes, game.size_gb) {
            (Some(b), _) if b > 0 => b as i64,
            (_, Some(gb)) if gb > 0.0 => (gb * 1e9).round() as i64,
            _ => 0,
        };
        let conn = self.lock()?;
        conn.execute(
            r#"
            INSERT INTO games (id, title, launch, exe_path, install_dir, size_bytes,
                               status, favorite, manual_play_secs, cover_path, meta,
                               hltb, notes, companions, hue, planned, achievements,
                               in_library, hidden, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?17, ?18, ?19, ?20, ?16, ?16)
            ON CONFLICT(id) DO UPDATE SET
                title            = excluded.title,
                launch           = excluded.launch,
                exe_path         = excluded.exe_path,
                install_dir      = excluded.install_dir,
                size_bytes       = excluded.size_bytes,
                status           = excluded.status,
                favorite         = excluded.favorite,
                manual_play_secs = excluded.manual_play_secs,
                cover_path       = excluded.cover_path,
                meta             = excluded.meta,
                hltb             = excluded.hltb,
                notes            = excluded.notes,
                companions       = excluded.companions,
                hue              = excluded.hue,
                planned          = excluded.planned,
                achievements     = excluded.achievements,
                in_library       = excluded.in_library,
                hidden           = excluded.hidden,
                updated_at       = excluded.updated_at
            "#,
            params![
                game.id.trim(),
                game.title.trim(),
                json(
                    &game
                        .launch
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({"kind": "none"}))
                ),
                game.exe_path,
                game.install_dir,
                size_bytes,
                game.status.trim(),
                i64::from(game.favorite),
                game.manual_play_secs.max(0),
                game.cover_path,
                game.meta.as_ref().map(|v| v.to_string()),
                game.hltb.as_ref().map(|v| v.to_string()),
                game.notes,
                serde_json::to_string(&game.companions).unwrap_or_else(|_| "[]".into()),
                game.hue,
                now(),
                i64::from(game.planned),
                serde_json::to_string(&game.achievements).unwrap_or_else(|_| "[]".into()),
                i64::from(game.in_library),
                i64::from(game.hidden),
            ],
        )
        .map_err(|e| format!("Could not save {}: {e}", game.title))?;
        Ok(())
    }

    pub fn delete_game(&self, id: &str) -> Result<(), String> {
        let conn = self.lock()?;
        // Sessions go with it, through `ON DELETE CASCADE`.
        conn.execute("DELETE FROM games WHERE id = ?1", params![id])
            .map_err(|e| format!("Could not remove that game: {e}"))?;
        Ok(())
    }

    /// Change only how a game is launched, leaving the rest of it alone.
    pub fn set_launch(&self, id: &str, launch: &Value) -> Result<(), String> {
        let conn = self.lock()?;
        let changed = conn
            .execute(
                "UPDATE games SET launch = ?1, updated_at = ?2 WHERE id = ?3",
                params![json(launch), now(), id],
            )
            .map_err(|e| format!("Could not save the launch settings: {e}"))?;
        if changed == 0 {
            return Err("That game is not in the library.".into());
        }
        Ok(())
    }

    /// Set the playtime a player wants to see, sessions and all.
    ///
    /// The player types the total they have in mind, so the difference from what
    /// the sessions recorded is stored as the correction. Setting a total equal to
    /// the session sum therefore clears any earlier correction rather than adding
    /// to it, and a total below the session sum is refused: the sessions are the
    /// real record and cannot be edited away from here.
    pub fn set_playtime(&self, id: &str, total_secs: i64) -> Result<(), String> {
        let conn = self.lock()?;
        let recorded: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(duration_secs), 0) FROM sessions WHERE game_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Could not read the playtime: {e}"))?;
        if total_secs < recorded {
            return Err(
                "The sessions already add up to more than that. Edit or remove a session to lower it."
                    .to_string(),
            );
        }
        let correction = total_secs - recorded;
        let changed = conn
            .execute(
                "UPDATE games SET manual_play_secs = ?1, updated_at = ?2 WHERE id = ?3",
                params![correction, now(), id],
            )
            .map_err(|e| format!("Could not save the playtime: {e}"))?;
        if changed == 0 {
            return Err("That game is not in the library.".into());
        }
        Ok(())
    }

    /// Forget every game, and all their sessions with them.
    pub fn clear_library(&self) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM games", [])
            .map_err(|e| format!("Could not empty the library: {e}"))?;
        Ok(())
    }

    /// Every game id, for checking an import against what is already there.
    pub fn known_exe_paths(&self) -> Result<Vec<String>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare("SELECT exe_path FROM games WHERE exe_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    // -------------------------------------------------------------- the sessions

    /// Open a session, unless one is already running.
    ///
    /// Only ever one session at a time: two running clocks would fight over who
    /// gets the time.
    pub fn open_session(
        &self,
        game_id: &str,
        started_at: i64,
        category: &str,
    ) -> Result<i64, String> {
        let conn = self.lock()?;

        // A row can still be open from a run of the app that ended badly, or from
        // a game whose launcher handed off and which the player never stopped.
        // That time belongs to the game it was played on, so it is written down
        // before this new session starts rather than blocking the launch. Nobody
        // wants to be told they cannot play something because Orbit forgot to
        // stop counting yesterday's game.
        let leftover: Option<(i64, i64)> = conn
            .query_row(
                "SELECT id, started_at FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Could not check for a running session: {e}"))?;
        if let Some((id, began)) = leftover {
            let secs = (started_at - began).max(0);
            conn.execute(
                "UPDATE sessions SET ended_at = ?2, duration_secs = ?3, ended_by = ?4 WHERE id = ?1",
                params![id, started_at, secs, ENDED_RECOVERED],
            )
            .map_err(|e| format!("Could not close the previous session: {e}"))?;
            log::info!("closed a session left open elsewhere, {secs}s counted");
        }
        let category = if category.trim().is_empty() {
            "Main story"
        } else {
            category.trim()
        };
        conn.execute(
            "INSERT INTO sessions (game_id, started_at, last_seen, category)
             VALUES (?1, ?2, ?2, ?3)",
            params![game_id, started_at, category],
        )
        .map_err(|e| format!("Could not start the session: {e}"))?;
        Ok(conn.last_insert_rowid())
    }

    /// Say that a session is still going, right now.
    ///
    /// Answers whether it is still open: once the row has been closed there is
    /// nothing left to keep alive, and whoever is calling this can stop.
    pub fn touch_session(&self, id: i64, at: i64) -> Result<bool, String> {
        let conn = self.lock()?;
        let changed = conn
            .execute(
                "UPDATE sessions SET last_seen = ?2 WHERE id = ?1 AND ended_at IS NULL",
                params![id, at],
            )
            .map_err(|e| format!("Could not record the heartbeat: {e}"))?;
        Ok(changed > 0)
    }

    /// Close a session and record why.
    pub fn close_session(&self, id: i64, ended_at: i64, ended_by: &str) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE sessions
                SET ended_at      = ?1,
                    duration_secs = MAX(0, ?1 - started_at),
                    ended_by      = ?2
              WHERE id = ?3 AND ended_at IS NULL",
            params![ended_at, ended_by, id],
        )
        .map_err(|e| format!("Could not close the session: {e}"))?;
        Ok(())
    }

    /// The session that is open right now, if any.
    pub fn current_session(&self) -> Result<Option<SessionRow>, String> {
        let conn = self.lock()?;
        conn.query_row(
            r#"
                SELECT s.id, s.game_id, COALESCE(g.title, ''), s.started_at, s.ended_at,
                       s.duration_secs, s.category, s.note, s.manual, s.ended_by
                  FROM sessions s
                  LEFT JOIN games g ON g.id = s.game_id
                 WHERE s.ended_at IS NULL
                 ORDER BY s.id DESC LIMIT 1
                "#,
            [],
            session_from_row,
        )
        .optional()
        .map_err(|e| format!("Could not read the running session: {e}"))
    }

    /// Sessions newest first, a page at a time.
    pub fn list_sessions(
        &self,
        limit: i64,
        offset: i64,
        game_id: Option<&str>,
    ) -> Result<Vec<SessionRow>, String> {
        let conn = self.lock()?;
        let limit = limit.clamp(1, 500);
        let offset = offset.max(0);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT s.id, s.game_id, COALESCE(g.title, ''), s.started_at, s.ended_at,
                       s.duration_secs, s.category, s.note, s.manual, s.ended_by
                  FROM sessions s
                  LEFT JOIN games g ON g.id = s.game_id
                 WHERE (?1 IS NULL OR s.game_id = ?1)
                 ORDER BY s.started_at DESC, s.id DESC
                 LIMIT ?2 OFFSET ?3
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![game_id, limit, offset], session_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the sessions: {e}"))
    }

    pub fn count_sessions(&self, game_id: Option<&str>) -> Result<i64, String> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE (?1 IS NULL OR game_id = ?1)",
            params![game_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Could not count the sessions: {e}"))
    }

    /// Edit a finished session.
    ///
    /// Both halves of the time are editable: how long it ran, and when it
    /// started. The end time is derived from those two, so correcting either
    /// one keeps the session self-consistent.
    pub fn update_session(
        &self,
        id: i64,
        started_at: i64,
        duration_secs: i64,
        category: &str,
        note: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE sessions
                SET started_at     = ?1,
                    duration_secs = ?2,
                    ended_at      = CASE WHEN ended_at IS NULL
                                         THEN NULL
                                         ELSE ?1 + ?2 END,
                    category      = ?3,
                    note          = ?4
              WHERE id = ?5",
            params![
                started_at,
                duration_secs.max(0),
                if category.trim().is_empty() {
                    "Main story"
                } else {
                    category.trim()
                },
                note,
                id
            ],
        )
        .map_err(|e| format!("Could not edit that session: {e}"))?;
        Ok(())
    }

    pub fn delete_session(&self, id: i64) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| format!("Could not remove that session: {e}"))?;
        Ok(())
    }

    // ----------------------------------------------------------- the game log

    /// A player's own note about a game, with the moment and the time it covers.
    pub fn list_game_logs(&self, game_id: &str) -> Result<Vec<GameLogRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.game_id, l.at, l.secs, l.note, l.created_at, COALESCE(g.title, '')
                   FROM game_logs l
                   LEFT JOIN games g ON g.id = l.game_id
                  WHERE l.game_id = ?1
                  ORDER BY l.position ASC, l.at DESC, l.id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![game_id], |r| {
                Ok(GameLogRow {
                    id: r.get(0)?,
                    game_id: r.get(1)?,
                    game_title: r.get(6)?,
                    at: r.get(2)?,
                    secs: r.get(3)?,
                    note: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn add_game_log(
        &self,
        game_id: &str,
        at: i64,
        secs: i64,
        note: &str,
    ) -> Result<GameLogRow, String> {
        // Checked before the lock is taken: `game` needs the same mutex, and a
        // guard cannot be taken twice.
        if self.game(game_id)?.is_none() {
            return Err("That game is not in the library.".into());
        }
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO game_logs (game_id, at, secs, note, created_at, position) \
             VALUES (?1, ?2, ?3, ?4, ?5, \
                     (SELECT COALESCE(MIN(position), 0) - 1 FROM game_logs WHERE game_id = ?1))",
            params![game_id, at, secs.max(0), note.trim(), now()],
        )
        .map_err(|e| format!("Could not save that note: {e}"))?;
        let id = conn.last_insert_rowid();
        Ok(GameLogRow {
            id,
            game_id: game_id.to_string(),
            // The caller already knows which game this is.
            game_title: String::new(),
            at,
            secs: secs.max(0),
            note: note.trim().to_string(),
            created_at: now(),
        })
    }

    /// Every note in the library, newest moment first.
    ///
    /// The Logs page shows all of them at once, so they arrive in one read with
    /// their game's title attached rather than as one query per game.
    pub fn list_all_logs(&self, limit: i64, offset: i64) -> Result<Vec<GameLogRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.game_id, l.at, l.secs, l.note, l.created_at, COALESCE(g.title, '')
                   FROM game_logs l
                   LEFT JOIN games g ON g.id = l.game_id
                  ORDER BY l.at DESC, l.id DESC
                  LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| format!("Could not read the logs: {e}"))?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 5_000), offset.max(0)], |r| {
                Ok(GameLogRow {
                    id: r.get(0)?,
                    game_id: r.get(1)?,
                    game_title: r.get(6)?,
                    at: r.get(2)?,
                    secs: r.get(3)?,
                    note: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })
            .map_err(|e| format!("Could not read the logs: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read the logs: {e}"))
    }

    /// How many notes there are, for paging.
    pub fn count_logs(&self) -> Result<i64, String> {
        let conn = self.lock()?;
        conn.query_row("SELECT COUNT(*) FROM game_logs", [], |r| r.get(0))
            .map_err(|e| format!("Could not count the logs: {e}"))
    }

    /// Write the "Started playing" note the first time a game is ever launched.
    ///
    /// Called before the session row exists, which is what makes "first" mean
    /// first: a game the player has already played, or already written about,
    /// gets nothing. A failure here is never worth stopping a launch for, so the
    /// caller logs it and carries on.
    pub fn add_started_log_if_first(&self, game_id: &str, at: i64) -> Result<bool, String> {
        let conn = self.lock()?;
        let written = conn
            .execute(
                "INSERT INTO game_logs (game_id, at, secs, note, created_at, position)
                 SELECT ?1, ?2, 0, 'Started playing', ?2, 0
                  WHERE NOT EXISTS (SELECT 1 FROM game_logs WHERE game_id = ?1)
                    AND NOT EXISTS (SELECT 1 FROM sessions WHERE game_id = ?1)",
                params![game_id, at],
            )
            .map_err(|e| format!("Could not write the first note: {e}"))?;
        Ok(written > 0)
    }

    /// Edit a note in place, so a date or a time can be corrected later.
    pub fn update_game_log(&self, id: i64, at: i64, secs: i64, note: &str) -> Result<(), String> {
        let conn = self.lock()?;
        let changed = conn
            .execute(
                "UPDATE game_logs SET at = ?1, secs = ?2, note = ?3 WHERE id = ?4",
                params![at, secs.max(0), note.trim(), id],
            )
            .map_err(|e| format!("Could not edit that note: {e}"))?;
        if changed == 0 {
            return Err("That note is not in any log.".into());
        }
        Ok(())
    }

    /// Put one game's notes in the order they were dragged into.
    ///
    /// Only the ids that were sent are placed, in the order given, at 0, 1, 2
    /// and so on. Anything else is left alone, so a note written in another
    /// window is not swallowed by a drag that started before it existed.
    pub fn reorder_game_logs(&self, game_id: &str, ids: &[i64]) -> Result<(), String> {
        let mut conn = self.lock()?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Could not reorder the notes: {e}"))?;
        for (index, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE game_logs SET position = ?1 WHERE id = ?2 AND game_id = ?3",
                params![index as i64, id, game_id],
            )
            .map_err(|e| format!("Could not reorder the notes: {e}"))?;
        }
        tx.commit()
            .map_err(|e| format!("Could not reorder the notes: {e}"))?;
        Ok(())
    }

    pub fn delete_game_log(&self, id: i64) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM game_logs WHERE id = ?1", params![id])
            .map_err(|e| format!("Could not remove that note: {e}"))?;
        Ok(())
    }

    /// Record time by hand, for playing on a console or a handheld.
    pub fn log_manual_session(
        &self,
        game_id: &str,
        started_at: i64,
        duration_secs: i64,
        category: &str,
        note: &str,
    ) -> Result<(), String> {
        if duration_secs <= 0 {
            return Err("Enter a duration greater than zero.".into());
        }
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO sessions
                 (game_id, started_at, ended_at, duration_secs, category, note, manual)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
            params![
                game_id,
                started_at,
                started_at + duration_secs,
                duration_secs,
                if category.trim().is_empty() {
                    "Main story"
                } else {
                    category.trim()
                },
                note,
            ],
        )
        .map_err(|e| format!("Could not log that session: {e}"))?;
        Ok(())
    }

    // ------------------------------------------------------------- the numbers

    /// Library-wide totals.
    ///
    /// Sums each game's *effective* playtime rather than raw session seconds, so
    /// a game with a typed-in total is counted the way the player sees it.
    pub fn stats(&self) -> Result<Stats, String> {
        let games = self.list_games()?;
        let conn = self.lock()?;
        let (session_count, longest, first_play, session_secs, tracked): (
            i64,
            i64,
            Option<i64>,
            i64,
            i64,
        ) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(MAX(duration_secs), 0), MIN(started_at), \
                        COALESCE(SUM(duration_secs), 0), COUNT(DISTINCT game_id) \
                   FROM sessions",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|e| format!("Could not total up the sessions: {e}"))?;
        let last_play: Option<i64> = conn
            .query_row(
                "SELECT MAX(COALESCE(ended_at, started_at)) FROM sessions",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("Could not total up the sessions: {e}"))?;

        Ok(Stats {
            total_secs: games.iter().map(|g| g.play_secs).sum(),
            session_secs,
            // A game with sessions but no time left in them (a session that was
            // deleted, a stray zero) is still counted: the count answers "which
            // games have been played", not "which add up to more than zero".
            tracked_games: tracked,
            total_games: games.len() as i64,
            session_count,
            longest_secs: longest,
            first_play,
            last_play,
        })
    }
}

/// What the front end sends when saving a game. Anything it does not know about
/// is ignored rather than rejected.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GameWrite {
    pub id: String,
    pub title: String,
    pub exe_path: Option<String>,
    pub install_dir: Option<String>,
    pub size_bytes: Option<u64>,
    pub size_gb: Option<f64>,
    pub status: String,
    pub favorite: bool,
    pub manual_play_secs: i64,
    pub cover_path: Option<String>,
    pub launch: Option<Value>,
    pub meta: Option<Value>,
    pub hltb: Option<Value>,
    /// Programs to start alongside the game, in the order they were added.
    #[serde(default)]
    pub companions: Vec<Companion>,
    pub notes: String,
    pub hue: i64,
    /// Meant to be played rather than installed here.
    #[serde(default)]
    pub planned: bool,
    /// Added to the library by hand, with nothing to point at yet.
    #[serde(default)]
    pub in_library: bool,
    /// Kept out of the library without being removed from it.
    #[serde(default)]
    pub hidden: bool,
    /// Read from Steam, with the ones the player has ticked kept as they are.
    #[serde(default)]
    pub achievements: Vec<Value>,
}

fn session_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: r.get(0)?,
        game_id: r.get(1)?,
        game_title: r.get(2)?,
        started_at: r.get(3)?,
        ended_at: r.get(4)?,
        duration_secs: r.get(5)?,
        category: r.get(6)?,
        note: r.get(7)?,
        manual: r.get::<_, i64>(8)? != 0,
        ended_by: r.get(9)?,
    })
}

fn json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

/// Read a JSON array column as typed rows.
///
/// A column that is missing, empty or unreadable reads as no rows at all: a
/// game with damaged side data is still a game worth launching.
fn parse_vec<T: serde::de::DeserializeOwned>(text: Option<&str>) -> Vec<T> {
    text.and_then(|t| serde_json::from_str::<Vec<T>>(t).ok())
        .unwrap_or_default()
}

fn parse(text: Option<&str>, fallback: &str) -> Value {
    text.and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_else(|| serde_json::from_str(fallback).unwrap_or(Value::Null))
}

/// Format Unix seconds as an ISO 8601 timestamp, the shape the UI already uses.
pub fn iso8601(unix: i64) -> String {
    let days = unix.div_euclid(86_400);
    let secs_of_day = unix.rem_euclid(86_400);
    // Days since 1970-01-01 to a civil (year, month, day). Howard Hinnant's
    // algorithm, which is exact for every date this century will produce.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        y,
        m,
        d,
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60,
        secs_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(id: &str, title: &str) -> GameWrite {
        GameWrite {
            id: id.into(),
            title: title.into(),
            status: "backlog".into(),
            ..Default::default()
        }
    }

    #[test]
    fn timestamps_come_back_as_iso() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso8601(1_700_000_000), "2023-11-14T22:13:20.000Z");
    }

    #[test]
    fn a_game_survives_a_round_trip() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let games = db.list_games().unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].title, "Hades");
        assert_eq!(games[0].play_secs, 0);
    }

    #[test]
    fn opening_a_library_twice_changes_nothing() {
        let dir = std::env::temp_dir().join("orbit-tauri-migrate");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("orbit.db");
        {
            let db = Db::open(&path).unwrap();
            db.upsert_game(&game("g1", "Hades")).unwrap();
        }
        // Re-opening must not wipe or duplicate anything.
        let db = Db::open(&path).unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        assert_eq!(db.list_games().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn playtime_is_the_sum_of_sessions() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let first = db.open_session("g1", 1_000, "Main story").unwrap();
        db.close_session(first, 1_000 + 3_600, ENDED_MANUAL)
            .unwrap();
        let second = db.open_session("g1", 10_000, "DLC").unwrap();
        db.close_session(second, 10_000 + 1_800, ENDED_PROCESS)
            .unwrap();

        let g = &db.list_games().unwrap()[0];
        assert_eq!(g.play_secs, 5_400);
        assert_eq!(g.session_count, 2);
        assert_eq!(g.longest_secs, 3_600);
        assert!(!g.running);
    }

    #[test]
    fn time_played_away_from_orbit_adds_to_the_sessions() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let id = db.open_session("g1", 1_000, "Main story").unwrap();
        db.close_session(id, 1_060, ENDED_MANUAL).unwrap();

        let mut g = game("g1", "Hades");
        g.manual_play_secs = 7_200;
        db.upsert_game(&g).unwrap();

        // One minute of sessions plus two hours typed in. This used to report
        // the two hours on their own, quietly dropping the session.
        assert_eq!(db.list_games().unwrap()[0].play_secs, 7_260);
        // The library total agrees with the rows, which is what the old app
        // managed to get wrong.
        assert_eq!(db.stats().unwrap().total_secs, 7_260);
    }

    #[test]
    fn setting_a_total_keeps_the_sessions_and_clears_the_correction() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let id = db.open_session("g1", 1_000, "Main story").unwrap();
        db.close_session(id, 1_600, ENDED_MANUAL).unwrap();

        // Ten minutes of sessions, then a total of two hours.
        db.set_playtime("g1", 7_200).unwrap();
        let g = &db.list_games().unwrap()[0];
        assert_eq!(g.play_secs, 7_200);
        assert_eq!(g.manual_play_secs, 6_600);

        // Asking for exactly what the sessions hold clears the correction rather
        // than leaving 22 hours behind.
        db.set_playtime("g1", 600).unwrap();
        let g = &db.list_games().unwrap()[0];
        assert_eq!(g.play_secs, 600);
        assert_eq!(g.manual_play_secs, 0);

        // Below the real sessions is refused, because they are the record.
        assert!(db.set_playtime("g1", 60).is_err());
        assert_eq!(db.list_games().unwrap()[0].play_secs, 600);
    }

    #[test]
    fn a_session_can_be_moved_and_reshaped() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        db.log_manual_session("g1", 1_700_000_000, 3600, "Main story", "runs 1-4")
            .unwrap();

        let s = db.list_sessions(10, 0, Some("g1")).unwrap().pop().unwrap();
        assert_eq!(s.started_at, 1_700_000_000);
        assert_eq!(s.ended_at, Some(1_700_003_600));

        // Correcting the length alone keeps the end where it should be.
        db.update_session(s.id, 1_700_000_000, 5400, "Main story", "runs 1-4")
            .unwrap();
        let s = db.list_sessions(10, 0, Some("g1")).unwrap().pop().unwrap();
        assert_eq!(s.duration_secs, 5400);
        assert_eq!(s.ended_at, Some(1_700_005_400));

        // And correcting the day it happened moves the whole thing.
        db.update_session(s.id, 1_702_000_000, 5400, "DLC", "New Game+")
            .unwrap();
        let s = db.list_sessions(10, 0, Some("g1")).unwrap().pop().unwrap();
        assert_eq!(s.started_at, 1_702_000_000);
        assert_eq!(s.ended_at, Some(1_702_005_400));
        assert_eq!(s.category, "DLC");
        assert_eq!(s.note, "New Game+");
    }

    #[test]
    fn a_players_notes_are_their_own_record() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hollow Knight")).unwrap();

        // "10h 08-12-26 finished main story" and "2h 10-12-26 DLC completed".
        let a = db
            .add_game_log("g1", 1_700_000_000, 36_000, "finished main story")
            .unwrap();
        let b = db
            .add_game_log("g1", 1_700_086_400, 7_200, "DLC completed")
            .unwrap();
        assert_ne!(a.id, b.id);

        // Newest first, which is the order the screen reads in.
        let logs = db.list_game_logs("g1").unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].note, "DLC completed");
        assert_eq!(logs[0].secs, 7_200);
        assert_eq!(logs.iter().map(|l| l.secs).sum::<i64>(), 43_200);

        // A date or a time can be corrected afterwards.
        db.update_game_log(a.id, 1_700_100_000, 39_600, "finished main story (real)")
            .unwrap();
        let logs = db.list_game_logs("g1").unwrap();
        let edited = logs.iter().find(|l| l.id == a.id).unwrap();
        assert_eq!(edited.at, 1_700_100_000);
        assert_eq!(edited.secs, 39_600);
        assert_eq!(edited.note, "finished main story (real)");
        assert_eq!(
            db.list_game_logs("g1")
                .unwrap()
                .iter()
                .map(|l| l.secs)
                .sum::<i64>(),
            46_800
        );

        db.delete_game_log(b.id).unwrap();
        assert_eq!(db.list_game_logs("g1").unwrap().len(), 1);
        assert!(db.update_game_log(9_999, 1, 1, "gone").is_err());
    }

    #[test]
    fn notes_go_when_the_game_does() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hollow Knight")).unwrap();
        db.add_game_log("g1", 1_700_000_000, 60, "kept").unwrap();
        db.delete_game("g1").unwrap();
        assert!(db.list_game_logs("g1").unwrap().is_empty());
        assert!(db.add_game_log("g1", 1_700_000_000, 60, "orphan").is_err());
    }

    #[test]
    fn a_new_session_takes_over_from_one_left_open() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        db.upsert_game(&game("g2", "Hollow Knight")).unwrap();
        let first = db.open_session("g1", 1_000, "Main story").unwrap();
        // Not an error: the row left open is closed with the time it was open,
        // and the new session starts. Being told you cannot play because Orbit
        // forgot to stop counting an earlier game is not a thing to build.
        let second = db.open_session("g2", 1_900, "Main story").unwrap();
        assert_ne!(first, second);

        let rows = db.list_sessions(10, 0, None).unwrap();
        let closed = rows.iter().find(|r| r.id == first).unwrap();
        assert_eq!(closed.ended_by.as_deref(), Some(ENDED_RECOVERED));
        assert_eq!(closed.duration_secs, 900);
        assert_eq!(db.current_session().unwrap().unwrap().id, second);
    }

    #[test]
    fn a_recent_open_session_survives_a_restart() {
        let dir = std::env::temp_dir().join("orbit-tauri-resume");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("orbit.db");
        {
            let db = Db::open(&path).unwrap();
            db.upsert_game(&game("g1", "Hades")).unwrap();
            db.open_session("g1", now() - 600, "Main story").unwrap();
            // No close: the app was killed, or a launcher handed the game off.
        }
        let db = Db::open(&path).unwrap();
        // Ten minutes of play is still there to be stopped by hand, rather than
        // tidied away into nothing.
        let open = db.current_session().unwrap().unwrap();
        assert_eq!(open.game_title, "Hades");
        db.close_session(open.id, now(), ENDED_MANUAL).unwrap();
        let rows = db.list_sessions(10, 0, None).unwrap();
        assert!(rows[0].duration_secs >= 600);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_planned_game_and_its_ticks_survive_a_round_trip() {
        let db = Db::open_memory().unwrap();
        let mut g1 = game("g1", "Hades");
        g1.planned = true;
        g1.achievements = vec![serde_json::json!({ "id": "WAKE_UP", "unlocked": true })];
        db.upsert_game(&g1).unwrap();

        let rows = db.list_games().unwrap();
        assert!(rows[0].planned);
        assert_eq!(rows[0].achievements[0]["id"], "WAKE_UP");
        assert_eq!(rows[0].achievements[0]["unlocked"], true);
    }

    #[test]
    fn logs_keep_the_order_they_were_arranged_into() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let a = db.add_game_log("g1", 1_000, 60, "started").unwrap().id;
        let b = db.add_game_log("g1", 2_000, 60, "beat the boss").unwrap().id;
        let c = db.add_game_log("g1", 3_000, 60, "finished").unwrap().id;

        // The latest one written is read first.
        let rows = db.list_game_logs("g1").unwrap();
        assert_eq!(rows[0].note, "finished");

        // An arrangement the player made is kept, entry by entry.
        db.reorder_game_logs("g1", &[a, c, b]).unwrap();
        let rows = db.list_game_logs("g1").unwrap();
        let order: Vec<&str> = rows.iter().map(|r| r.note.as_str()).collect();
        assert_eq!(order, vec!["started", "finished", "beat the boss"]);
    }

    #[test]
    fn an_open_session_is_reported_and_never_left_behind() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let id = db.open_session("g1", 1_000, "Main story").unwrap();
        let open = db.current_session().unwrap().unwrap();
        assert_eq!(open.id, id);
        assert_eq!(open.game_title, "Hades");
        assert!(db.list_games().unwrap()[0].running);
    }

    #[test]
    fn a_crash_does_not_leave_an_unclosable_session() {
        let dir = std::env::temp_dir().join("orbit-tauri-recover");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("orbit.db");
        {
            let db = Db::open(&path).unwrap();
            db.upsert_game(&game("g1", "Hades")).unwrap();
            db.open_session("g1", 1_000, "Main story").unwrap();
            // No close: as if the app was killed here.
        }
        let db = Db::open(&path).unwrap();
        assert!(db.current_session().unwrap().is_none());
        let rows = db.list_sessions(50, 0, None).unwrap();
        assert_eq!(rows[0].ended_by, Some(ENDED_RECOVERED.to_string()));
        // And a new session can start.
        assert!(db.open_session("g1", 5_000, "Main story").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_game_takes_its_sessions_with_it() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        let id = db.open_session("g1", 1_000, "Main story").unwrap();
        db.close_session(id, 2_000, ENDED_MANUAL).unwrap();
        db.delete_game("g1").unwrap();
        assert!(db.list_games().unwrap().is_empty());
        assert_eq!(db.count_sessions(None).unwrap(), 0);
    }

    #[test]
    fn sessions_are_paged_newest_first() {
        let db = Db::open_memory().unwrap();
        db.upsert_game(&game("g1", "Hades")).unwrap();
        for i in 0..5 {
            let id = db
                .open_session("g1", 1_000 + i * 10_000, "Main story")
                .unwrap();
            db.close_session(id, 1_000 + i * 10_000 + 600, ENDED_MANUAL)
                .unwrap();
        }
        let page = db.list_sessions(2, 0, None).unwrap();
        assert_eq!(page.len(), 2);
        assert!(page[0].started_at > page[1].started_at);
        assert_eq!(db.count_sessions(None).unwrap(), 5);
        let next = db.list_sessions(2, 2, None).unwrap();
        assert!(page[1].started_at > next[0].started_at);
    }

    #[test]
    fn a_game_needs_a_title() {
        let db = Db::open_memory().unwrap();
        assert!(db.upsert_game(&game("", "Hades")).is_err());
        assert!(db.upsert_game(&game("g1", "   ")).is_err());
    }
}
