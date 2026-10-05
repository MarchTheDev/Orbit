use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::models::{Game, LaunchTarget, PlaySession, PlaytimeSummary, Tag};

/// Schema version. Bump this when adding a migration.
const SCHEMA_VERSION: i64 = 2;

/// Thin wrapper over the SQLite connection.
///
/// Every method maps rows to domain structs so the rest of the app never
/// touches raw `rusqlite` types.
pub struct Library {
    conn: Connection,
}

impl Library {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    /// In-memory database, used by tests.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self> {
        // WAL keeps the UI responsive while sessions are written.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        let mut lib = Library { conn };
        lib.migrate()?;
        Ok(lib)
    }

    fn migrate(&mut self) -> Result<()> {
        let mut current: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?;

        if current < 1 {
            tracing::info!("applying migration 1 (initial schema)");
            self.conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS games (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    name            TEXT    NOT NULL,
                    developer       TEXT    NOT NULL DEFAULT '',
                    publisher       TEXT    NOT NULL DEFAULT '',
                    release_date    TEXT,
                    genres          TEXT    NOT NULL DEFAULT '',
                    platforms       TEXT    NOT NULL DEFAULT '',
                    notes           TEXT    NOT NULL DEFAULT '',
                    cover_path      TEXT,
                    description     TEXT    NOT NULL DEFAULT '',
                    launch          TEXT    NOT NULL DEFAULT '{"kind":"none"}',
                    hltb            TEXT,
                    manual_playtime INTEGER NOT NULL DEFAULT 0,
                    rating          INTEGER NOT NULL DEFAULT -1,
                    hidden          INTEGER NOT NULL DEFAULT 0,
                    created_at      INTEGER NOT NULL,
                    updated_at      INTEGER NOT NULL,
                    last_played     INTEGER
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                    started_at    INTEGER NOT NULL,
                    ended_at      INTEGER,
                    duration_secs INTEGER NOT NULL DEFAULT 0,
                    note          TEXT    NOT NULL DEFAULT '',
                    category      TEXT    NOT NULL DEFAULT '',
                    manual        INTEGER NOT NULL DEFAULT 0,
                    ended_by      TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_game
                    ON sessions(game_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_started
                    ON sessions(started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_games_name
                    ON games(name COLLATE NOCASE);
                "#,
            )?;
            current = 1;
            self.conn.pragma_update(None, "user_version", current)?;
        }

        if current < 2 {
            tracing::info!("applying migration 2 (install folder)");
            // Games added before this column simply have no folder until the
            // user points Orbit at one in the editor.
            self.conn
                .execute_batch("ALTER TABLE games ADD COLUMN install_dir TEXT;")?;
            current = 2;
            self.conn.pragma_update(None, "user_version", current)?;
        }

        debug_assert_eq!(current, SCHEMA_VERSION);
        Ok(())
    }

    // ---- games ----------------------------------------------------------

    pub fn insert_game(&self, game: &Game) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO games (name, developer, publisher, release_date, genres,
                platforms, notes, cover_path, install_dir, description, launch, hltb,
                manual_playtime, rating, hidden, created_at, updated_at, last_played)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
            params![
                game.name,
                game.developer,
                game.publisher,
                game.release_date,
                game.genres.join("|"),
                game.platforms.join("|"),
                game.notes,
                game.cover_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string()),
                game.install_dir
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string()),
                game.description,
                serde_json::to_string(&game.launch)?,
                game.hltb.map(|h| serde_json::to_string(&h)).transpose()?,
                game.manual_playtime_secs,
                game.rating,
                game.hidden as i32,
                game.created_at,
                game.updated_at,
                game.last_played,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_game(&self, game: &Game) -> Result<()> {
        self.conn.execute(
            "UPDATE games SET name=?1, developer=?2, publisher=?3, release_date=?4,
                genres=?5, platforms=?6, notes=?7, cover_path=?8, install_dir=?9,
                description=?10, launch=?11, hltb=?12, manual_playtime=?13,
                rating=?14, hidden=?15, updated_at=?16, last_played=?17
             WHERE id=?18",
            params![
                game.name,
                game.developer,
                game.publisher,
                game.release_date,
                game.genres.join("|"),
                game.platforms.join("|"),
                game.notes,
                game.cover_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string()),
                game.install_dir
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string()),
                game.description,
                serde_json::to_string(&game.launch)?,
                game.hltb.map(|h| serde_json::to_string(&h)).transpose()?,
                game.manual_playtime_secs,
                game.rating,
                game.hidden as i32,
                game.updated_at,
                game.last_played,
                game.id,
            ],
        )?;
        Ok(())
    }

    pub fn delete_game(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM games WHERE id=?1", params![id])?;
        Ok(())
    }

    /// One game by id, or `None` if it has been deleted.
    #[cfg(test)]
    pub fn get_game(&self, id: i64) -> Result<Option<Game>> {
        let game: Option<Game> = self
            .conn
            .query_row("SELECT * FROM games WHERE id=?1", params![id], row_to_game)
            .optional()?;
        Ok(game)
    }

    /// All games with their tracked playtime, for the library view.
    pub fn list_games(&self) -> Result<Vec<(Game, PlaytimeSummary)>> {
        let mut stmt = self.conn.prepare(
            "SELECT g.*,
                    COALESCE(SUM(s.duration_secs), 0)  AS total_secs,
                    COUNT(s.id)                        AS session_count,
                    COALESCE(MAX(s.duration_secs), 0)  AS longest_secs,
                    MIN(s.started_at)                  AS first_play,
                    MAX(s.ended_at)                    AS last_session_end
             FROM games g
             LEFT JOIN sessions s ON s.game_id = g.id
             GROUP BY g.id",
        )?;

        // Column order must match the SELECT: g.* then the six aggregates.
        const COLS: &[&str] = &[
            "id",
            "name",
            "developer",
            "publisher",
            "release_date",
            "genres",
            "platforms",
            "notes",
            "cover_path",
            "install_dir",
            "description",
            "launch",
            "hltb",
            "manual_playtime",
            "rating",
            "hidden",
            "created_at",
            "updated_at",
            "last_played",
            "total_secs",
            "session_count",
            "longest_secs",
            "first_play",
            "last_session_end",
        ];

        let rows = stmt.query_map([], |row| {
            let mut idx = std::collections::HashMap::new();
            for (i, name) in COLS.iter().enumerate() {
                idx.insert(*name, i);
            }
            let col = |name: &str| *idx.get(name).expect("column present in SELECT");

            let game = row_to_game(row)?;
            let total: i64 = row.get(col("total_secs"))?;
            let count: i64 = row.get(col("session_count"))?;
            let longest: i64 = row.get(col("longest_secs"))?;
            let first: Option<i64> = row.get(col("first_play"))?;
            let last_end: Option<i64> = row.get(col("last_session_end"))?;

            // A session with no end time still counts as played.
            let last_play = last_end.or(if count > 0 { game.last_played } else { None });

            let summary = PlaytimeSummary {
                total_secs: total,
                session_count: count as usize,
                longest_secs: longest,
                first_play: first,
                last_play,
            };
            Ok((game, summary))
        })?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Distinct genres with counts, for the sidebar.
    pub fn list_genres(&self) -> Result<Vec<Tag>> {
        let mut stmt = self
            .conn
            .prepare("SELECT genres FROM games WHERE genres <> ''")?;
        let mut counts: std::collections::HashMap<String, usize> = Default::default();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for r in rows {
            for g in r?.split('|').filter(|s| !s.is_empty()) {
                *counts.entry(g.to_string()).or_default() += 1;
            }
        }
        let mut out: Vec<Tag> = counts
            .into_iter()
            .map(|(name, count)| Tag { name, count })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    // ---- sessions -------------------------------------------------------

    /// Start a tracked session. Only one may be open at a time.
    pub fn start_session(&self, game_id: i64, started_at: i64, category: &str) -> Result<i64> {
        let open: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        if open > 0 {
            return Err(crate::error::Error::AlreadyPlaying);
        }
        self.conn.execute(
            "INSERT INTO sessions (game_id, started_at, ended_at, duration_secs,
                note, category, manual, ended_by)
             VALUES (?1,?2,NULL,0,'',?3,0,NULL)",
            params![game_id, started_at, category],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Close a running session, writing its duration.
    pub fn stop_session(&self, id: i64, ended_at: i64, ended_by: &str) -> Result<i64> {
        let duration: i64 = self.conn.query_row(
            "SELECT started_at FROM sessions WHERE id=?1 AND ended_at IS NULL",
            params![id],
            |r| r.get(0),
        )?;
        let secs = (ended_at - duration).max(0);
        self.conn.execute(
            "UPDATE sessions SET ended_at=?1, duration_secs=?2, ended_by=?3
             WHERE id=?4",
            params![ended_at, secs, ended_by, id],
        )?;
        self.touch_game_playtime(duration, ended_at)?;
        Ok(secs)
    }

    /// Re-close a session that was left open because Orbit crashed.
    pub fn recover_stale_session(&self, id: i64, ended_at: i64) -> Result<i64> {
        self.stop_session(id, ended_at, "recovered")
    }

    pub fn has_open_session(&self) -> Result<Option<i64>> {
        let id = self
            .conn
            .query_row(
                "SELECT id FROM sessions WHERE ended_at IS NULL LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(id)
    }

    /// Manually recorded or hand-edited session.
    pub fn add_manual_session(
        &self,
        game_id: i64,
        started_at: i64,
        duration_secs: i64,
        note: &str,
        category: &str,
    ) -> Result<i64> {
        let ended_at = started_at + duration_secs;
        self.conn.execute(
            "INSERT INTO sessions (game_id, started_at, ended_at, duration_secs,
                note, category, manual, ended_by)
             VALUES (?1,?2,?3,?4,?5,?6,1,NULL)",
            params![game_id, started_at, ended_at, duration_secs, note, category],
        )?;
        self.touch_game_playtime(started_at, ended_at)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Edit any field of a saved session. Duration is authoritative, so the
    /// end timestamp is recomputed to match.
    pub fn update_session(&self, s: &PlaySession) -> Result<()> {
        let ended_at = if s.is_running() {
            None
        } else {
            Some(s.started_at + s.duration_secs)
        };
        self.conn.execute(
            "UPDATE sessions SET started_at=?1, duration_secs=?2, note=?3,
                category=?4, manual=?5, ended_at=?6
             WHERE id=?7",
            params![
                s.started_at,
                s.duration_secs,
                s.note,
                s.category,
                s.manual as i32,
                ended_at,
                s.id,
            ],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM sessions WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn list_sessions(&self, game_id: Option<i64>) -> Result<Vec<PlaySession>> {
        let (sql, args): (&str, Vec<i64>) = match game_id {
            Some(gid) => (
                "SELECT * FROM sessions WHERE game_id=?1 ORDER BY started_at DESC",
                vec![gid],
            ),
            None => ("SELECT * FROM sessions ORDER BY started_at DESC", vec![]),
        };
        let mut stmt = self.conn.prepare(sql)?;
        let mapped = stmt.query_map(rusqlite::params_from_iter(args), row_to_session)?;
        let mut out = Vec::new();
        for s in mapped {
            out.push(s?);
        }
        Ok(out)
    }

    /// Games that had a session start in the last `days` days.
    pub fn recently_played(&self, days: i64) -> Result<Vec<i64>> {
        let cutoff = chrono::Utc::now().timestamp() - days * 86_400;
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT game_id FROM sessions WHERE started_at >= ?1")?;
        let rows = stmt.query_map(params![cutoff], |r| r.get::<_, i64>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Recompute `last_played` from sessions. Cheap enough to call on writes.
    fn touch_game_playtime(&self, started_at: i64, ended_at: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE games SET last_played = ?1
             WHERE id = (SELECT game_id FROM sessions ORDER BY id DESC LIMIT 1)
               AND (?1 IS NULL OR last_played IS NULL OR last_played < ?1)",
            params![ended_at.max(started_at)],
        )?;
        Ok(())
    }

    /// Clear the manual override and let session sums drive the total.
    pub fn set_manual_playtime(&self, game_id: i64, secs: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE games SET manual_playtime=?1, updated_at=?2 WHERE id=?3",
            params![secs, chrono::Utc::now().timestamp(), game_id],
        )?;
        Ok(())
    }

    pub fn reset_manual_playtime(&self, game_id: i64) -> Result<()> {
        self.set_manual_playtime(game_id, 0)
    }
}

fn split_list(raw: &str) -> Vec<String> {
    raw.split('|')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn row_to_game(row: &rusqlite::Row<'_>) -> rusqlite::Result<Game> {
    let launch_raw: String = row.get("launch")?;
    let launch: LaunchTarget = serde_json::from_str(&launch_raw).unwrap_or(LaunchTarget::None);

    let hltb_raw: Option<String> = row.get("hltb")?;
    let hltb = hltb_raw
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    let genres: String = row.get("genres")?;
    let platforms: String = row.get("platforms")?;
    let cover: Option<String> = row.get("cover_path")?;
    let install_dir: Option<String> = row.get("install_dir")?;

    Ok(Game {
        id: row.get("id")?,
        name: row.get("name")?,
        developer: row.get("developer")?,
        publisher: row.get("publisher")?,
        release_date: row.get("release_date")?,
        genres: split_list(&genres),
        platforms: split_list(&platforms),
        notes: row.get("notes")?,
        cover_path: cover.map(std::path::PathBuf::from),
        install_dir: install_dir.map(std::path::PathBuf::from),
        description: row.get("description")?,
        launch,
        hltb,
        manual_playtime_secs: row.get("manual_playtime")?,
        rating: row.get("rating")?,
        hidden: row.get::<_, i32>("hidden")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_played: row.get("last_played")?,
    })
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlaySession> {
    Ok(PlaySession {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        duration_secs: row.get("duration_secs")?,
        note: row.get("note")?,
        category: row.get("category")?,
        manual: row.get::<_, i32>("manual")? != 0,
        ended_by: row.get("ended_by")?,
    })
}

/// In-memory `LaunchTarget` for tests.
#[cfg(test)]
pub fn is_launch_configured(l: &LaunchTarget) -> bool {
    l.is_configured()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LaunchTarget;
    use std::path::{Path, PathBuf};

    fn temp_db(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("orbit-test-{name}.db"));
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(p.with_extension("db-wal"));
        let _ = std::fs::remove_file(p.with_extension("db-shm"));
        p
    }

    /// A version 1 database, as an install from before install folders existed.
    fn seed_v1(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE games (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT    NOT NULL,
                developer       TEXT    NOT NULL DEFAULT '',
                publisher       TEXT    NOT NULL DEFAULT '',
                release_date    TEXT,
                genres          TEXT    NOT NULL DEFAULT '',
                platforms       TEXT    NOT NULL DEFAULT '',
                notes           TEXT    NOT NULL DEFAULT '',
                cover_path      TEXT,
                description     TEXT    NOT NULL DEFAULT '',
                launch          TEXT    NOT NULL DEFAULT '{"kind":"none"}',
                hltb            TEXT,
                manual_playtime INTEGER NOT NULL DEFAULT 0,
                rating          INTEGER NOT NULL DEFAULT -1,
                hidden          INTEGER NOT NULL DEFAULT 0,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                last_played     INTEGER
            );
            CREATE TABLE sessions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                started_at    INTEGER NOT NULL,
                ended_at      INTEGER,
                duration_secs INTEGER NOT NULL DEFAULT 0,
                note          TEXT    NOT NULL DEFAULT '',
                category      TEXT    NOT NULL DEFAULT '',
                manual        INTEGER NOT NULL DEFAULT 0,
                ended_by      TEXT
            );
            INSERT INTO games (name, created_at, updated_at) VALUES ('Old Game', 1, 1);
            PRAGMA user_version = 1;
            "#,
        )
        .unwrap();
    }

    #[test]
    fn a_fresh_database_ends_at_the_current_version() {
        let lib = Library::open_in_memory().unwrap();
        let version: i64 = lib
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn a_fresh_database_has_the_install_column() {
        let lib = Library::open_in_memory().unwrap();
        let mut game = Game::new("Hades");
        game.install_dir = Some(PathBuf::from(r"D:\Games\Hades"));
        let id = lib.insert_game(&game).unwrap();

        let stored = lib.get_game(id).unwrap().unwrap();
        assert_eq!(stored.install_dir, game.install_dir);
    }

    #[test]
    fn a_version_1_database_upgrades_without_losing_games() {
        let path = temp_db("upgrade");
        seed_v1(&path);

        let lib = Library::open(&path).unwrap();
        let version: i64 = lib
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION, "migration 2 ran");

        // The game is still here and simply has no folder yet.
        let games = lib.list_games().unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].0.name, "Old Game");
        assert_eq!(games[0].0.install_dir, None);

        // And the column is usable from now on.
        let mut game = games[0].0.clone();
        game.install_dir = Some(PathBuf::from(r"E:\Library\Old Game"));
        lib.update_game(&game).unwrap();
        assert_eq!(
            lib.get_game(game.id).unwrap().unwrap().install_dir,
            game.install_dir
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn opening_twice_does_not_re_apply_migrations() {
        let path = temp_db("idempotent");
        {
            Library::open(&path).unwrap();
        }
        // The second open finds the schema already current, so the install
        // column must not be added a second time.
        let lib = Library::open(&path).unwrap();
        let game = Game::new("Twice");
        let id = lib.insert_game(&game).unwrap();
        assert!(lib.get_game(id).unwrap().is_some());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_game_round_trips_through_the_database() {
        let lib = Library::open_in_memory().unwrap();
        let mut game = Game::new("Celeste");
        game.developer = "Maddy".into();
        game.publisher = "Matt Makes Games".into();
        game.genres = vec!["Platformer".into()];
        game.platforms = vec!["PC".into()];
        game.notes = "good".into();
        game.description = "climb".into();
        game.install_dir = Some(PathBuf::from(r"D:\Games\Celeste"));
        game.rating = 4;
        game.launch = LaunchTarget::Executable {
            path: PathBuf::from(r"D:\Games\Celeste\Celeste.exe"),
            args: String::new(),
            working_dir: None,
        };
        let id = lib.insert_game(&game).unwrap();

        let stored = lib.get_game(id).unwrap().unwrap();
        assert_eq!(stored.name, "Celeste");
        assert_eq!(stored.developer, "Maddy");
        assert_eq!(stored.genres, vec!["Platformer".to_string()]);
        assert_eq!(stored.platforms, vec!["PC".to_string()]);
        assert_eq!(stored.notes, "good");
        assert_eq!(stored.description, "climb");
        assert_eq!(stored.install_dir, game.install_dir);
        assert_eq!(stored.rating, 4);
        assert!(is_launch_configured(&stored.launch));

        // An update rewrites the folder too.
        let mut moved = stored.clone();
        moved.install_dir = Some(PathBuf::from(r"F:\Games\Celeste"));
        moved.notes = "still good".into();
        lib.update_game(&moved).unwrap();

        let after = lib.get_game(id).unwrap().unwrap();
        assert_eq!(after.install_dir, moved.install_dir);
        assert_eq!(after.notes, "still good");
    }

    #[test]
    fn a_game_without_a_folder_survives_the_round_trip() {
        let lib = Library::open_in_memory().unwrap();
        let game = Game::new("No Folder");
        let id = lib.insert_game(&game).unwrap();
        assert_eq!(lib.get_game(id).unwrap().unwrap().install_dir, None);
    }
}
