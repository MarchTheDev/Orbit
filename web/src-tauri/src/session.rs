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

use crate::db::{epoch_millis, now, Db, SessionRow, ENDED_FAILED, ENDED_MANUAL, ENDED_PROCESS};
use crate::launch::Sessions;
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
}

impl Runner {
    pub fn new(db: Arc<Db>) -> Self {
        Self {
            db,
            inner: Arc::new(Mutex::new(Inner {
                sessions: Sessions::default(),
                active: None,
            })),
        }
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

        let (pid, manual) = match self.lock()?.sessions.launch_target(target) {
            Ok(launched) => (launched.pid, launched.manual),
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
            manual,
        };

        {
            let mut inner = self.lock()?;
            inner.active = Some(Active {
                view: view.clone(),
                pid,
            });
        }

        // Only a process can end a session by itself. A Steam game, or one the
        // player starts themselves, is stopped by hand.
        if !manual {
            self.watch(session_id, game.id.clone(), pid);
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
        // Stopping a session has to close the game with it. A game Orbit only
        // timed, or asked Steam to start, has no process of ours to close, so
        // that case is a no-op rather than an error.
        if active.pid != 0 {
            if let Err(e) = self.lock()?.sessions.kill(active.pid) {
                log::warn!("could not close the game: {e}");
            }
        }
        Ok(Some(active.view))
    }

    /// The session in progress, if there is one, so a UI reload can pick it up.
    pub fn active(&self) -> Result<Option<ActiveView>, String> {
        if let Some(active) = &self.lock()?.active {
            return Ok(Some(active.view.clone()));
        }
        // The row outlives the process tracker only if the app was restarted
        // mid-session, which `Db::open` already closed.
        Ok(None)
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
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(POLL);
            loop {
                ticker.tick().await;

                // Two ways to stop watching. The process ending is the usual one.
                // The other is the player pressing Stop: that clears `active`,
                // closes the row and kills the process, so this task has nothing
                // left to do and must not sit here polling forever.
                let ended = match inner.lock() {
                    Ok(mut guard) => {
                        if !guard
                            .active
                            .as_ref()
                            .is_some_and(|a| a.view.session_id == session_id)
                        {
                            return;
                        }
                        matches!(guard.sessions.status(pid), Some(false))
                    }
                    Err(_) => return,
                };
                if !ended {
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

                // Tell the UI, so it can refresh the game and the totals.
                if let Some(view) = finished {
                    crate::emit_session_ended(&view, &game_id);
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
