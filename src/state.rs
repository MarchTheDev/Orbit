use std::collections::HashMap;

use chrono::{DateTime, Local, NaiveDate, Utc};

use crate::models::{Game, LibrarySort, LibraryStats, PlaySession, PlaytimeSummary, Tag};

/// What a play action did. The UI shows this as a toast.
#[derive(Debug, Clone, PartialEq)]
pub enum PlayOutcome {
    Started {
        game: String,
    },
    Stopped {
        game: String,
        secs: i64,
    },
    /// Tracked to an open session, then the process exited on its own.
    AutoStopped {
        game: String,
        secs: i64,
    },
    NotConfigured(String),
    Failed(String),
}

impl PlayOutcome {
    pub fn message(&self) -> String {
        match self {
            Self::Started { game } => format!("Playing {game}"),
            Self::Stopped { game, secs } => {
                format!("Logged {} for {game}", crate::format::duration(*secs))
            }
            Self::AutoStopped { game, secs } => {
                format!("{game} exited; logged {}", crate::format::duration(*secs))
            }
            Self::NotConfigured(g) => format!("No launch setup for {g}"),
            Self::Failed(e) => e.clone(),
        }
    }
}

/// A session the app is currently timing, plus the OS process if any.
pub struct ActiveSession {
    pub session_id: i64,
    pub game_id: i64,
    pub game_name: String,
    /// Wall-clock start, used to compute elapsed without touching the clock twice.
    pub started_instant: std::time::Instant,
    pub child: Option<std::process::Child>,
    pub category: String,
}

impl ActiveSession {
    /// Seconds elapsed so far, derived from the monotonic instant.
    pub fn elapsed_secs(&self) -> i64 {
        self.started_instant.elapsed().as_secs() as i64
    }
}

/// All non-UI state and logic. The UI layer only reads and mutates this.
pub struct App {
    pub lib: crate::db::Library,
    pub settings: crate::config::Settings,
    pub paths: crate::paths::AppPaths,
    pub hltb: crate::hltb::HltbClient,
    pub igdb: Option<crate::igdb::IgdbClient>,
    pub theme: crate::theme::Theme,

    /// Games with their computed playtime, refreshed on every write.
    pub games: Vec<(Game, PlaytimeSummary)>,
    pub stats: LibraryStats,
    pub genres: Vec<Tag>,

    pub active: Option<ActiveSession>,
    pub search_query: String,
    pub sort: LibrarySort,
    /// When non-zero, the library is filtered to this genre.
    pub genre_filter: Option<String>,
    pub show_hidden: bool,
    pub last_outcome: Option<PlayOutcome>,
    pub last_error: Option<String>,
    pub startup_message: Option<String>,
    /// Set when a settings field changed and needs writing to disk.
    pub settings_dirty: bool,

    /// What is installed where, recomputed on demand by the storage page.
    pub storage: crate::storage::StorageOverview,
    /// The move currently running, if any.
    pub move_job: Option<MoveJob>,
    /// A library folder being typed but not yet added. Shared by the Storage and
    /// Settings pages so either can add a folder.
    pub folder_input: String,
}

/// A file copy running on a worker thread.
///
/// The work happens off the UI thread so a 40 GB move does not freeze the
/// window; this holds what the progress bar needs and the channel it reports on.
pub struct MoveJob {
    pub game_id: i64,
    pub total: u64,
    pub copied: u64,
    rx: std::sync::mpsc::Receiver<MoveEvent>,
}

/// What the move thread sends back.
pub enum MoveEvent {
    /// Bytes copied so far.
    Progress(u64),
    Finished(MoveDone),
    Failed(String),
}

/// A completed move: where the game now lives, plus anything to tell the player.
pub struct MoveDone {
    pub install_dir: std::path::PathBuf,
    pub message: Option<String>,
}

impl App {
    pub fn new(
        lib: crate::db::Library,
        settings: crate::config::Settings,
        paths: crate::paths::AppPaths,
    ) -> Self {
        let theme = crate::theme::Theme::by_name(&settings.theme);
        let igdb = if settings.igdb_ready() {
            Some(crate::igdb::IgdbClient::new(
                &settings.twitch_client_id,
                &settings.twitch_client_secret,
            ))
        } else {
            None
        };

        let mut app = Self {
            lib,
            igdb,
            paths,
            hltb: crate::hltb::HltbClient::new(),
            theme,
            games: Vec::new(),
            stats: LibraryStats::default(),
            genres: Vec::new(),
            active: None,
            search_query: String::new(),
            sort: LibrarySort::default(),
            genre_filter: None,
            show_hidden: false,
            last_outcome: None,
            last_error: None,
            startup_message: None,
            settings_dirty: false,
            storage: crate::storage::StorageOverview {
                folders: Vec::new(),
                elsewhere: Vec::new(),
                elsewhere_bytes: 0,
            },
            move_job: None,
            folder_input: String::new(),
            settings,
        };
        app.reload();
        app.refresh_storage();
        app
    }

    /// Rebuild the in-memory library, stats, and genre list from the database.
    pub fn reload(&mut self) {
        match self.lib.list_games() {
            Ok(games) => self.games = games,
            Err(e) => self.last_error = Some(e.log_and_message("reload library")),
        }
        match self.lib.list_genres() {
            Ok(t) => self.genres = t,
            Err(e) => self.last_error = Some(e.log_and_message("reload genres")),
        }
        self.refresh_stats();
    }

    pub fn refresh_stats(&mut self) {
        let mut stats = LibraryStats {
            total_games: self.games.len(),
            ..Default::default()
        };
        for (_, summary) in &self.games {
            if summary.total_secs > 0 {
                stats.tracked_games += 1;
            }
            stats.total_secs += summary.total_secs;
            stats.sessions += summary.session_count;
        }
        stats.games_played_last_7_days = self.lib.recently_played(7).map(|v| v.len()).unwrap_or(0);
        stats.games_played_last_30_days =
            self.lib.recently_played(30).map(|v| v.len()).unwrap_or(0);
        self.stats = stats;
    }

    /// Effective playtime: the manual override when non-zero, else the sum.
    pub fn effective_playtime(game: &Game, summary: &PlaytimeSummary) -> i64 {
        if game.manual_playtime_secs > 0 {
            game.manual_playtime_secs
        } else {
            summary.total_secs
        }
    }

    /// Games after search, genre filter, hidden filter, and sort.
    pub fn visible_games(&self) -> Vec<&(Game, PlaytimeSummary)> {
        let q = self.search_query.trim().to_lowercase();
        let mut list: Vec<&(Game, PlaytimeSummary)> = self
            .games
            .iter()
            .filter(|(g, _)| self.show_hidden || !g.hidden)
            .filter(|(g, _)| match &self.genre_filter {
                Some(f) => g.genres.iter().any(|x| x == f),
                None => true,
            })
            .filter(|(g, _)| {
                if q.is_empty() {
                    true
                } else {
                    g.name.to_lowercase().contains(&q)
                        || g.developer.to_lowercase().contains(&q)
                        || g.genres.iter().any(|x| x.to_lowercase().contains(&q))
                        || g.platforms.iter().any(|x| x.to_lowercase().contains(&q))
                }
            })
            .collect();

        match self.sort {
            LibrarySort::Name => list.sort_by_key(|a| a.0.name.clone()),
            LibrarySort::LastPlayed => list.sort_by_key(|a| std::cmp::Reverse(a.1.last_play)),
            LibrarySort::Playtime => {
                list.sort_by_key(|a| std::cmp::Reverse(Self::effective_playtime(&a.0, &a.1)))
            }
            LibrarySort::DateAdded => list.sort_by_key(|a| std::cmp::Reverse(a.0.created_at)),
            LibrarySort::Rating => list.sort_by_key(|a| std::cmp::Reverse(a.0.rating)),
            LibrarySort::Hltb => list.sort_by(|a, b| {
                let x = a.0.hltb.map(|h| h.primary()).unwrap_or(0.0);
                let y = b.0.hltb.map(|h| h.primary()).unwrap_or(0.0);
                y.partial_cmp(&x).unwrap_or(std::cmp::Ordering::Equal)
            }),
        }
        list
    }

    // ---- storage --------------------------------------------------------

    /// Re-read folder sizes and drive figures.
    ///
    /// Walking the library is disk work, so the storage page calls this when it
    /// opens and after a move, rather than on every frame.
    pub fn refresh_storage(&mut self) {
        self.storage = crate::storage::overview(
            &self.settings.library_folders,
            self.settings.default_library_folder(),
            &self.games,
        );
    }

    /// Add a library folder and create it if it is missing.
    /// Add a library folder and create it if it is missing.
    ///
    /// A blank or relative path is refused with a reason the UI can show, since
    /// a folder that silently does nothing is worse than no folder.
    pub fn add_library_folder(&mut self, path: &str) -> std::result::Result<(), String> {
        let path = path.trim();
        if path.is_empty() {
            return Err("Type a folder path first.".into());
        }
        if !std::path::Path::new(path).is_absolute() {
            return Err(format!("{path} is not a full path."));
        }
        if !self.settings.add_library_folder(path) {
            return Err("That folder is already in your library.".into());
        }
        if let Err(e) = std::fs::create_dir_all(path) {
            // Kept anyway: a drive that is not plugged in yet is still worth
            // listing rather than losing the setting.
            self.last_error = Some(format!("Could not create {path}: {e}"));
        }
        self.mark_settings_dirty();
        self.refresh_storage();
        Ok(())
    }

    /// The typed folder, committed by `add_typed_folder`.
    pub fn add_typed_folder(&mut self) -> std::result::Result<(), String> {
        let typed = std::mem::take(&mut self.folder_input);
        match self.add_library_folder(&typed) {
            Ok(()) => Ok(()),
            Err(e) => {
                // Put the text back so it can be corrected.
                self.folder_input = typed;
                Err(e)
            }
        }
    }

    pub fn remove_library_folder(&mut self, path: &str) {
        self.settings.remove_library_folder(path);
        self.mark_settings_dirty();
        self.refresh_storage();
    }

    pub fn set_default_folder(&mut self, path: &str) {
        if self.settings.set_default_folder(path) {
            self.mark_settings_dirty();
            // The storage page marks the default folder, so it has to hear
            // about this rather than wait for a rescan.
            self.refresh_storage();
        }
    }

    /// Is this move still allowed? Checked before the worker starts and again
    /// before the folder is updated, so a refusal needs no extra message.
    pub fn can_move_game(&self, game: &Game, to: &str) -> std::result::Result<(), String> {
        if self.move_job.is_some() {
            return Err("Another game is already moving.".into());
        }
        if self.active.as_ref().is_some_and(|a| a.game_id == game.id) {
            return Err("Stop the running session before moving this game.".into());
        }
        if !self
            .settings
            .library_folders
            .iter()
            .any(|f| crate::storage::same_path(std::path::Path::new(f), std::path::Path::new(to)))
        {
            return Err(format!("{to} is not one of your library folders."));
        }
        if !self.settings.library_folders.iter().any(|f| {
            game.install_dir
                .as_deref()
                .is_some_and(|d| crate::storage::game_folder(std::slice::from_ref(f), d).is_some())
        }) {
            return Err(
                "This game is outside your library folders, so Orbit does not move it.".into(),
            );
        }
        Ok(())
    }

    /// Start moving a game to another library folder, on a worker thread.
    pub fn start_move(&mut self, game_id: i64, to: &str) -> std::result::Result<(), String> {
        let Some((game, _)) = self.games.iter().find(|(g, _)| g.id == game_id).cloned() else {
            return Err("That game is no longer in the library.".into());
        };
        self.can_move_game(&game, to)?;

        let folders = self.settings.library_folders.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker_game = game.clone();
        let dest = to.to_string();
        let total = worker_game
            .install_dir
            .as_deref()
            .and_then(|d| crate::storage::game_folder(&folders, d))
            .map(|d| crate::storage::dir_size(&d))
            .unwrap_or(0);

        std::thread::Builder::new()
            .name("orbit-move".into())
            .spawn(move || {
                let report = tx.clone();
                let result = crate::storage::move_game(&worker_game, &folders, &dest, &mut |n| {
                    let _ = report.send(MoveEvent::Progress(n));
                });
                match result {
                    Ok(moved) => {
                        let _ = tx.send(MoveEvent::Finished(MoveDone {
                            install_dir: moved.install_dir,
                            message: moved.message,
                        }));
                    }
                    Err(e) => {
                        let _ = tx.send(MoveEvent::Failed(e.log_and_message("move game")));
                    }
                }
            })
            .map_err(|e| format!("Could not start the move: {e}"))?;

        self.move_job = Some(MoveJob {
            game_id,
            total,
            copied: 0,
            rx,
        });
        Ok(())
    }

    /// How far the running move has got, 0.0 to 1.0.
    pub fn move_progress(&self) -> f32 {
        let Some(job) = self.move_job.as_ref() else {
            return 0.0;
        };
        if job.total == 0 {
            0.0
        } else {
            (job.copied as f64 / job.total as f64).clamp(0.0, 1.0) as f32
        }
    }

    /// Collect move results. Returns true when the library changed.
    ///
    /// A finished move points the game at its new folder before the sizes are
    /// re-read, so the storage page and the editor agree with the disk.
    pub fn poll_move(&mut self) -> bool {
        let Some(job) = self.move_job.as_mut() else {
            return false;
        };
        let mut changed = false;
        let mut finished = None;
        while let Ok(event) = job.rx.try_recv() {
            match event {
                MoveEvent::Progress(n) => job.copied += n,
                MoveEvent::Finished(done) => finished = Some(Ok(done)),
                MoveEvent::Failed(e) => finished = Some(Err(e)),
            }
        }
        if let Some(result) = finished {
            let job = self.move_job.take();
            match result {
                Ok(MoveDone {
                    install_dir,
                    message,
                }) => {
                    if let Some(job) = &job {
                        if let Some((game, _)) = self
                            .games
                            .iter()
                            .find(|(g, _)| g.id == job.game_id)
                            .cloned()
                        {
                            let mut g = game.clone();
                            g.install_dir = Some(install_dir);
                            changed = self.update_game(&g);
                        }
                    }
                    // A move that left the old folder behind is still a success,
                    // but the player needs to know about the leftover.
                    if let Some(msg) = message {
                        self.startup_message = Some(msg);
                    }
                }
                Err(e) => self.last_error = Some(e),
            }
            self.refresh_storage();
        }
        changed
    }

    // ---- game CRUD ------------------------------------------------------

    pub fn add_game(&mut self, game: Game) -> i64 {
        match self.lib.insert_game(&game) {
            Ok(id) => {
                tracing::info!(id, name = %game.name, "added game");
                self.reload();
                id
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("add game"));
                0
            }
        }
    }

    pub fn update_game(&mut self, game: &Game) -> bool {
        let mut g = game.clone();
        g.updated_at = chrono::Utc::now().timestamp();
        match self.lib.update_game(&g) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("update game"));
                false
            }
        }
    }

    pub fn delete_game(&mut self, id: i64) -> bool {
        // Refuse to delete the game that is being timed right now.
        if self.active.as_ref().is_some_and(|a| a.game_id == id) {
            self.last_error = Some("Stop the running session before deleting this game.".into());
            return false;
        }
        match self.lib.delete_game(id) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("delete game"));
                false
            }
        }
    }

    pub fn game_by_id(&self, id: i64) -> Option<&Game> {
        self.games.iter().find(|(g, _)| g.id == id).map(|(g, _)| g)
    }

    pub fn sessions_for(&self, game_id: i64) -> Vec<PlaySession> {
        self.lib.list_sessions(Some(game_id)).unwrap_or_default()
    }

    /// Replace a game's notes without touching anything else.
    pub fn save_notes(&mut self, game_id: i64, notes: &str) -> bool {
        match self.game_by_id(game_id) {
            Some(g) => {
                let mut g = g.clone();
                g.notes = notes.to_string();
                self.update_game(&g)
            }
            None => false,
        }
    }

    // ---- playtime -------------------------------------------------------

    /// Begin timing a game, optionally launching it.
    pub fn start_play(&mut self, game_id: i64, category: &str, launch: bool) -> PlayOutcome {
        if self.active.is_some() {
            return PlayOutcome::Failed("A session is already running.".into());
        }
        let Some((game, _)) = self.games.iter().find(|(g, _)| g.id == game_id).cloned() else {
            return PlayOutcome::Failed("That game is no longer in the library.".into());
        };

        if launch && !game.launch.is_configured() {
            return PlayOutcome::NotConfigured(game.name.clone());
        }

        let started_at = chrono::Utc::now().timestamp();
        let session_id = match self.lib.start_session(game_id, started_at, category) {
            Ok(id) => id,
            Err(e) => return PlayOutcome::Failed(e.log_and_message("start session")),
        };

        let child = if launch && self.settings.track_playtime {
            match crate::launch::spawn(&game.launch) {
                Ok(c) => c,
                Err(e) => {
                    // Roll back the open session so the library stays consistent.
                    let _ =
                        self.lib
                            .stop_session(session_id, chrono::Utc::now().timestamp(), "failed");
                    self.reload();
                    return PlayOutcome::Failed(e.log_and_message("launch game"));
                }
            }
        } else {
            None
        };

        tracing::info!(game = %game.name, session = session_id, "session started");
        self.active = Some(ActiveSession {
            session_id,
            game_id,
            game_name: game.name.clone(),
            started_instant: std::time::Instant::now(),
            child,
            category: category.to_string(),
        });

        PlayOutcome::Started { game: game.name }
    }

    /// Stop the running session and write its duration.
    pub fn stop_play(&mut self) -> PlayOutcome {
        let Some(active) = self.active.take() else {
            return PlayOutcome::Failed("Nothing is running.".into());
        };
        let ended_at = chrono::Utc::now().timestamp();
        let secs = match self.lib.stop_session(active.session_id, ended_at, "manual") {
            Ok(s) => s,
            Err(e) => return PlayOutcome::Failed(e.log_and_message("stop session")),
        };
        tracing::info!(game = %active.game_name, secs, "session stopped");
        self.reload();
        PlayOutcome::Stopped {
            game: active.game_name,
            secs,
        }
    }

    /// Called each frame. Detects a launched process exiting on its own.
    ///
    /// Returns true when the library changed, so the caller can repaint.
    pub fn poll_active(&mut self) -> bool {
        let Some(mut active) = self.active.take() else {
            return false;
        };
        let Some(child) = active.child.as_mut() else {
            // No child process: an open session only ends manually.
            self.active = Some(active);
            return false;
        };
        match child.try_wait() {
            Ok(Some(_)) => {
                let ended_at = chrono::Utc::now().timestamp();
                let secs = active.elapsed_secs();
                if let Err(e) = self
                    .lib
                    .stop_session(active.session_id, ended_at, "process exit")
                {
                    self.last_error = Some(e.log_and_message("auto stop"));
                    self.active = Some(active);
                    return false;
                }
                tracing::info!(game = %active.game_name, secs, "auto-stopped on process exit");
                self.reload();
                self.last_outcome = Some(PlayOutcome::AutoStopped {
                    game: active.game_name,
                    secs,
                });
                true
            }
            Ok(None) => {
                self.active = Some(active);
                false
            }
            Err(e) => {
                tracing::error!(error = %e, "could not check the launched process");
                self.last_error = Some(format!("Could not check the game process: {e}"));
                self.active = Some(active);
                false
            }
        }
    }

    /// Add a hand-written log entry from the detail view's form.
    pub fn add_manual_entry(&mut self, entry: crate::ui::detail::LogEntry) -> bool {
        self.log_manual(
            entry.game_id,
            entry.date,
            entry.hours,
            entry.minutes,
            &entry.note,
            &entry.category,
        )
    }

    /// Add a hand-written log entry, e.g. "17h completed, DLC 2h".
    pub fn log_manual(
        &mut self,
        game_id: i64,
        when: NaiveDate,
        hours: f64,
        minutes: i64,
        note: &str,
        category: &str,
    ) -> bool {
        let secs = (hours * 3600.0).round() as i64 + minutes * 60;
        if secs <= 0 {
            self.last_error = Some("Enter a duration greater than zero.".into());
            return false;
        }
        let Some(started_at) = when.and_hms_opt(12, 0, 0).and_then(|d| {
            chrono::TimeZone::from_local_datetime(&Local, &d)
                .single()
                .map(|dt| dt.timestamp())
        }) else {
            self.last_error = Some("That date is not valid on this machine's timezone.".into());
            return false;
        };

        match self
            .lib
            .add_manual_session(game_id, started_at, secs, note, category)
        {
            Ok(_) => {
                tracing::info!(game_id, secs, "manual session added");
                self.reload();
                true
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("add manual session"));
                false
            }
        }
    }

    /// Overwrite a session's stored values.
    pub fn edit_session(&mut self, session: PlaySession) -> bool {
        if session.duration_secs < 0 {
            self.last_error = Some("Duration cannot be negative.".into());
            return false;
        }
        match self.lib.update_session(&session) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("edit session"));
                false
            }
        }
    }

    pub fn delete_session(&mut self, id: i64) -> bool {
        match self.lib.delete_session(id) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("delete session"));
                false
            }
        }
    }

    /// Set or clear the manual playtime override for a game.
    pub fn set_manual_total(&mut self, game_id: i64, secs: i64) -> bool {
        let r = if secs == 0 {
            self.lib.reset_manual_playtime(game_id)
        } else {
            self.lib.set_manual_playtime(game_id, secs)
        };
        match r {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.last_error = Some(e.log_and_message("set manual playtime"));
                false
            }
        }
    }

    /// Close a session left open by a crash on the previous run.
    pub fn recover_open_session(&mut self) {
        match self.lib.has_open_session() {
            Ok(Some(id)) => {
                let now = chrono::Utc::now().timestamp();
                match self.lib.recover_stale_session(id, now) {
                    Ok(secs) => {
                        tracing::warn!(id, secs, "recovered session left open by a previous run");
                        self.startup_message =
                            Some(format!("Recovered an unfinished session of {} that was left open when Orbit last closed.", crate::format::duration(secs)));
                        self.reload();
                    }
                    Err(e) => {
                        self.last_error = Some(e.log_and_message("recover session"));
                    }
                }
            }
            Ok(None) => {}
            Err(e) => {
                self.last_error = Some(e.log_and_message("check for open session"));
            }
        }
    }

    // ---- settings -------------------------------------------------------

    pub fn set_theme(&mut self, name: &str) {
        self.settings.theme = name.to_string();
        self.theme = crate::theme::Theme::by_name(name);
        self.mark_settings_dirty();
    }

    /// Ask for a settings write at the end of the current frame, so a slider
    /// drag does not hit the disk on every mouse-move.
    pub fn mark_settings_dirty(&mut self) {
        self.settings_dirty = true;
    }

    /// Write settings if something asked for it.
    pub fn flush_settings(&mut self) {
        if std::mem::take(&mut self.settings_dirty) {
            if let Err(e) = self.settings.save(&self.paths) {
                self.last_error = Some(format!("Could not save settings: {e}"));
            }
        }
    }

    /// Push the current palette into egui.
    pub fn apply_theme(&self, ctx: &egui::Context) {
        self.theme.apply(ctx);
    }

    /// Rebuild the IGDB client after credentials change.
    pub fn refresh_igdb(&mut self) {
        self.igdb = if self.settings.igdb_ready() {
            Some(crate::igdb::IgdbClient::new(
                &self.settings.twitch_client_id,
                &self.settings.twitch_client_secret,
            ))
        } else {
            None
        };
    }

    /// Merge IGDB metadata into an existing game, preserving local fields.
    pub fn apply_igdb(&mut self, game_id: i64, meta: &Game) -> bool {
        let Some(existing) = self.game_by_id(game_id) else {
            return false;
        };
        let mut g = existing.clone();
        g.description = meta.description.clone();
        g.developer = meta.developer.clone();
        g.publisher = meta.publisher.clone();
        g.release_date = meta.release_date.clone();
        g.genres = meta.genres.clone();
        g.platforms = meta.platforms.clone();
        if g.rating < 0 {
            g.rating = meta.rating;
        }
        self.update_game(&g)
    }

    /// Look up Steam app IDs by store search page scraping is avoided; the
    /// user enters the id directly. This just validates the shape.
    pub fn parse_steam_id(text: &str) -> Option<u32> {
        let digits: String = text
            .trim()
            .rsplit('/')
            .next()
            .unwrap_or("")
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect();
        digits.parse().ok()
    }
}

/// Categories offered when logging time.
pub fn default_categories() -> Vec<&'static str> {
    vec![
        "Main story",
        "DLC",
        "Multiplayer",
        "Co-op",
        "Side content",
        "Replay",
        "Mods",
        "Other",
    ]
}

/// Per-category playtime totals for one game.
pub fn totals_by_category(sessions: &[PlaySession]) -> Vec<(String, i64)> {
    let mut map: HashMap<String, i64> = HashMap::new();
    for s in sessions {
        if s.duration_secs <= 0 {
            continue;
        }
        let key = if s.category.is_empty() {
            "Uncategorised".to_string()
        } else {
            s.category.clone()
        };
        *map.entry(key).or_default() += s.duration_secs;
    }
    let mut out: Vec<(String, i64)> = map.into_iter().collect();
    out.sort_by_key(|(_, secs)| std::cmp::Reverse(*secs));
    out
}

/// `DateTime` helper used by the log editor.
pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Format a session start for display.
pub fn when(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .map(|d| d.with_timezone(&Local).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "—".into())
}
