//! The session that is running right now.
//!
//! The database row and the game process are tied together here rather than in
//! the front end, so closing the game ends the session by itself, the time
//! always lands on the right game, and a crash cannot leave a clock running
//! forever.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::db::{
    epoch_millis, now, Db, SessionRow, ENDED_APP_CLOSED, ENDED_FAILED, ENDED_MANUAL, ENDED_PROCESS,
};
use crate::WindowPolicy;
use crate::launch::{Sessions, Verdict};
use crate::launch_target::LaunchTarget;

/// How often the watched process is checked.
const POLL: Duration = Duration::from_secs(2);

/// The session the player is in, as the front end sees it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveView {
    pub session_id: i64,
    pub game_id: String,
    pub game_title: String,
    /// Unix seconds, so a UI reload can pick the clock back up.
    pub started_at: i64,
    /// The same moment in milliseconds, for a clock that ticks without drifting
    /// against rounding.
    pub started_at_ms: i64,
    /// True when Orbit started nothing and the player must stop the session.
    pub manual: bool,
}

#[derive(Clone)]
struct Active {
    view: ActiveView,
    pid: u32,
}

struct Inner {
    sessions: Sessions,
    active: Option<Active>,
}

pub struct Runner {
    db: Arc<Db>,
    /// Shared with the watcher task, which needs to reach the same tracker.
    inner: Arc<Mutex<Inner>>,
    /// What to do with Orbit's own window while a game runs, and after it.
    policy: Arc<Mutex<WindowPolicy>>,
}

impl Runner {
    pub fn new(db: Arc<Db>, policy: Arc<Mutex<WindowPolicy>>) -> Self {
        Self {
            db,
            inner: Arc::new(Mutex::new(Inner {
                sessions: Sessions::default(),
                active: None,
            })),
            policy,
        }
    }

    /// What the player asked Orbit's window to do, read under the lock.
    fn window_policy(&self) -> WindowPolicy {
        self.policy
            .lock()
            .map(|p| p.clone())
            .unwrap_or_default()
    }

    /// Do the window half of a game starting, and of one closing.
    ///
    /// Kept on the Rust side because the game can close while the interface is
    /// not looking, and because the "quit" choice has to happen even if nothing
    /// in the UI is listening any more.
    fn nudge_window(&self, on_launch: bool) {
        let Some(app) = crate::app_handle() else { return };
        let policy = self.window_policy();
        // Quitting on launch means the time up to now is all there will ever be,
        // so the row is closed before the app goes.
        if on_launch && policy.on_launch == "close" {
            if let Ok(Some(open)) = self.db.current_session() {
                let _ = self.db.close_session(open.id, now(), ENDED_MANUAL);
            }
        }
        crate::apply_policy(&app, on_launch, policy);
    }

    /// Start a session for a game, and start the game if it has a target.
    ///
    /// If the game cannot be started the session row is closed again, so a
    /// failed launch leaves nothing behind.
    pub fn start(
        &self,
        game_id: &str,
        category: &str,
        target: &LaunchTarget,
    ) -> Result<ActiveView, String> {
        let game = self
            .db
            .game(game_id)?
            .ok_or_else(|| "That game is not in the library any more.".to_string())?;

        // The first launch of a game writes its own note, so the log starts
        // itself off with the date the player began. Done before the session
        // exists, which is what makes "first" mean first, and never allowed to
        // stop a launch.
        match self.db.add_started_log_if_first(&game.id, now()) {
            Ok(true) => log::info!("wrote the first-play note for {}", game.title),
            Ok(false) => {}
            Err(e) => log::warn!("could not write the first-play note: {e}"),
        }

        // The row is opened first, so the session exists even for a game Orbit
        // only times, and a failure below has something to roll back.
        let session_id = self.db.open_session(&game.id, now(), category)?;

        // The game's own folder is what says whether it is still running once
        // the process Orbit started has handed off, and it is the only signal at
        // all for a game Steam starts.
        let install_dir = game.install_dir.as_deref().map(std::path::Path::new);

        let launched = match self.lock()?.sessions.launch_target(target, install_dir) {
            Ok(launched) => launched,
            Err(e) => {
                // Never leave a session that will not be stopped by anything.
                let _ = self.db.close_session(session_id, now(), ENDED_FAILED);
                return Err(e);
            }
        };

        // Companion programs ride along with the game: started after it, and
        // never watched, so their exit cannot end the session. One failing is
        // worth a line in the log but not a failed launch.
        for companion in &game.companions {
            let path = std::path::Path::new(&companion.path);
            if let Err(e) = crate::launch::spawn_detached(path, &companion.args) {
                log::warn!("companion {} did not start: {e}", companion.path);
            } else {
                log::info!("started companion {}", companion.path);
            }
        }

        let view = ActiveView {
            session_id,
            game_id: game.id.clone(),
            game_title: game.title.clone(),
            started_at: now(),
            started_at_ms: epoch_millis(),
            manual: launched.manual,
        };

        {
            let mut inner = self.lock()?;
            inner.active = Some(Active {
                view: view.clone(),
                pid: launched.pid,
            });
        }

        // The game is up, so Orbit can get out of the way if that is what the
        // player asked for.
        self.nudge_window(true);

        // Watching the folder is what lets a session end by itself, however the
        // game was started. A game with no folder to watch, and no process of
        // Orbit's, is stopped by hand.
        if launched.watched {
            self.watch(session_id, game.id.clone(), launched.pid);
        }

        Ok(view)
    }

    /// Stop the running session, whoever asked.
    pub fn stop(&self, session_id: i64) -> Result<Option<ActiveView>, String> {
        let active = {
            let mut inner = self.lock()?;
            inner.active.take()
        };
        let Some(active) = active else {
            // Nothing is being tracked, but the row may still be open from a
            // previous run of the app.
            if let Some(open) = self.db.current_session()? {
                if open.id == session_id {
                    self.db.close_session(session_id, now(), ENDED_MANUAL)?;
                    return Ok(Some(view_of(&open, true)));
                }
            }
            return Ok(None);
        };
        if active.view.session_id != session_id {
            // Somebody else's session: put it back and leave it alone.
            self.lock()?.active = Some(active);
            return Ok(None);
        }

        self.db.close_session(session_id, now(), ENDED_MANUAL)?;
        // Stopping by hand counts as the game ending, so a player who asked for
        // Orbit back when a game closes gets it back here too.
        self.nudge_window(false);
        // Stopping a session has to close the game with it. A game Orbit only
        // timed, or asked Steam to start, has no process of ours to close, so
        // that case is a no-op rather than an error.
        if active.pid != 0 {
            if let Err(e) = self.lock()?.sessions.kill(active.pid) {
                log::warn!("could not close the game: {e}");
            }
        } else {
            // A game Orbit only watched the folder for: there is no process of
            // ours to close, so the clock simply stops.
            self.lock()?.sessions.forget(active.pid);
        }
        Ok(Some(active.view))
    }

    /// The session in progress, if there is one, so a UI reload can pick it up.
    ///
    /// A session row can outlive the tracker: the app may have been restarted
    /// while a game was running, or the game may be one Steam started. Either
    /// way it is real time played, so it comes back as a session the player can
    /// stop rather than being forgotten. That is where the evening's playtime
    /// gets counted instead of being tidied away.
    pub fn active(&self) -> Result<Option<ActiveView>, String> {
        if let Some(active) = &self.lock()?.active {
            return Ok(Some(active.view.clone()));
        }
        Ok(self.db.current_session()?.map(|row| view_of(&row, true)))
    }

    /// Close whatever is running because Orbit itself is closing.
    ///
    /// The time up to this moment is real, so it is written down: a session left
    /// open would look like a crash, and the catch-up on the next launch would
    /// either credit a whole night of playtime or none of it.
    pub fn close_for_app_exit(&self) {
        let active = match self.inner.lock() {
            Ok(mut inner) => inner.active.take(),
            Err(_) => None,
        };
        if let Some(active) = active {
            let _ = self.db.close_session(active.view.session_id, now(), ENDED_APP_CLOSED);
            return;
        }
        if let Ok(Some(open)) = self.db.current_session() {
            let _ = self.db.close_session(open.id, now(), ENDED_APP_CLOSED);
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner
            .lock()
            .map_err(|_| "The session list is not usable.".to_string())
    }

    /// Watch a process and close its session when it goes.
    fn watch(&self, session_id: i64, game_id: String, pid: u32) {
        let db = Arc::clone(&self.db);
        let inner = Arc::clone(&self.inner);
        let policy = self.window_policy();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(POLL);
            loop {
                ticker.tick().await;

                // Two ways to stop watching. The process ending is the usual one.
                // The other is the player pressing Stop: that clears `active`,
                // closes the row and kills the process, so this task has nothing
                // left to do and must not sit here polling forever.
                let verdict = match inner.lock() {
                    Ok(mut guard) => {
                        if !guard
                            .active
                            .as_ref()
                            .is_some_and(|a| a.view.session_id == session_id)
                        {
                            return;
                        }
                        guard.sessions.check(pid)
                    }
                    Err(_) => return,
                };

                // Nothing left to watch, either because Orbit never started this
                // process or because the game is running where it cannot see it.
                // The session stays open for the player to stop; this loop has
                // nothing to do and gets out of the way.
                if matches!(verdict, None | Some(Verdict::Unwatched)) {
                    if let Ok(mut guard) = inner.lock() {
                        guard.sessions.forget(pid);
                    }
                    return;
                }
                if matches!(verdict, Some(Verdict::Running)) {
                    continue;
                }

                let _ = db.close_session(session_id, now(), ENDED_PROCESS);
                let finished = match inner.lock() {
                    Ok(mut guard) => {
                        guard.sessions.forget(pid);
                        guard.active.take().map(|a| a.view)
                    }
                    Err(_) => None,
                };

                // Tell the UI, so it can refresh the game and the totals, and
                // give the window whatever the player asked for now the game is
                // over: many players want Orbit back the moment they stop.
                if let Some(view) = finished {
                    crate::emit_session_ended(&view, &game_id);
                }
                if let Some(app) = crate::app_handle() {
                    crate::apply_policy(&app, false, policy);
                }
                return;
            }
        });
    }
}

fn view_of(row: &SessionRow, manual: bool) -> ActiveView {
    ActiveView {
        session_id: row.id,
        game_id: row.game_id.clone(),
        game_title: row.game_title.clone(),
        started_at: row.started_at,
        started_at_ms: row.started_at * 1000,
        manual,
    }
}
