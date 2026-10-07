//! Orbit's native side.
//!
//! The React front end talks to Windows through the commands in this file:
//! starting games, noticing when they stop, moving a game between drives,
//! reading folders, and fetching metadata the browser is not allowed to reach.

mod achievements;
mod db;
#[cfg(windows)]
mod explorer;
mod format;
mod hltb;
mod launch;
mod launch_target;
mod launchers;
mod metadata;
mod session;
mod steam;
mod storage;
mod store;
mod update;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use db::{GameLogRow, GameRow, GameWrite, SessionRow, Stats};
use launch::FoundGame;
use launch_target::LaunchTarget;
use session::{ActiveView, Runner};
use storage::{DriveInfo, Moved, SizeCache};
use store::{Settings, Store};

/// What Orbit should do with its own window around a game.
///
/// The two choices are separate on purpose: some players want Orbit out of the
/// way while they play but want it back when the game closes, and some want it
/// gone in both directions.
#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicy {
    /// `nothing`, `minimize`, `tray` or `close`.
    #[serde(default)]
    pub on_launch: String,
    /// `nothing`, `show` or `quit`.
    #[serde(default)]
    pub on_close: String,
}

/// Everything the commands need, kept in one place by Tauri.
pub struct Orbit {
    db: Arc<db::Db>,
    runner: Runner,
    store: Store,
    /// Folder sizes measured once and remembered. See `storage::SizeCache`.
    sizes: SizeCache,
    /// What to do with the window when a game starts and when it closes. Kept
    /// here rather than read from disk at the moment it is needed, so the
    /// settings file is not read while a game is starting.
    policy: Arc<std::sync::Mutex<WindowPolicy>>,
}

const OPEN_EXE_REQUESTED_EVENT: &str = "open-exe-requested";

/// Startup visibility and handoff state shared with the single-instance callback.
struct StartupVisibility {
    start_in_background: bool,
    frontend_ready: Arc<AtomicBool>,
    show_requested: Arc<AtomicBool>,
}

/// Paths handed over by the Explorer action, including paths from a duplicate
/// invocation that arrived before the webview subscribed to its event.
struct PendingOpenExePaths(Arc<Mutex<Vec<String>>>);

/// Read the window behaviour out of the settings JSON.
fn policy_from_settings(settings: Option<&Settings>) -> WindowPolicy {
    settings
        .and_then(|s| s.get("window"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Do the thing the player asked for, to whatever state the window is in now.
pub(crate) fn apply_policy(app: &tauri::AppHandle, on_launch: bool, policy: WindowPolicy) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if on_launch {
        match policy.on_launch.as_str() {
            // A game is starting, so getting out of the way is the whole point.
            "minimize" => {
                let _ = window.minimize();
            }
            // Out of the way and off the taskbar. Only when the tray icon is
            // there to come back to; otherwise this is just a minimize.
            "tray" => {
                if TRAY_READY.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = window.hide();
                } else {
                    let _ = window.minimize();
                }
            }
            // Quitting is what the player asked for, warning and all: the time
            // up to this moment is written down first, by the session runner,
            // and nothing after it is tracked.
            "close" => app.exit(0),
            // Anything unrecognised, including a settings file written by an
            // older build, leaves the window alone.
            _ => {}
        }
    } else {
        match policy.on_close.as_str() {
            "show" => reveal_window(app),
            "quit" => app.exit(0),
            _ => {}
        }
    }
}

/// Whether the tray icon is really there.
///
/// Hiding the window is only safe when there is something left to click, so this
/// is set by `build_tray` once the icon exists and never before. A hidden window
/// with no tray is an app the player cannot get back, which is not a preference
/// anybody asked for.
static TRAY_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Put an icon in the notification area, with a way back to the window.
///
/// This is what makes "step aside while I play" possible: Orbit leaves the
/// screen, the game gets it, and the app is still one click away rather than
/// something that has to be found again in the taskbar.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show Orbit", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Orbit")
        .menu(&menu)
        // Left click belongs to the window; the menu is on the right button, as
        // it is for everything else in the notification area.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal_window(app),
            "quit" => {
                // Same as closing the window by hand: the clock stops and what
                // it counted is written down before the app goes.
                if let Some(orbit) = app.try_state::<Orbit>() {
                    orbit.runner.close_for_app_exit();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    TRAY_READY.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Bring Orbit back to the front, wherever it went.
pub(crate) fn reveal_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The app handle, for the code that has to move the window.
pub(crate) fn app_handle() -> Option<tauri::AppHandle> {
    APP.get().cloned()
}

/// The running session has ended; the UI should refresh that game.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEnded {
    session_id: i64,
    game_id: String,
}

/// The app handle, so a background task can push events without being handed one.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Tell the front end a session finished on its own.
pub(crate) fn emit_session_ended(view: &ActiveView, game_id: &str) {
    let Some(app) = APP.get() else { return };
    let _ = app.emit(
        "session-ended",
        SessionEnded {
            session_id: view.session_id,
            game_id: game_id.to_string(),
        },
    );
}

/// Progress of a move, pushed to the UI as it happens.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveProgress {
    copied: u64,
    total: u64,
}

// ------------------------------------------------------------------ the library

/// Every game in the library, with playtime worked out from its sessions.
#[tauri::command]
fn db_list_games(orbit: State<'_, Orbit>) -> Result<Vec<GameRow>, String> {
    orbit.db.list_games()
}

/// Save one game.
#[tauri::command]
fn db_upsert_game(orbit: State<'_, Orbit>, game: GameWrite) -> Result<(), String> {
    orbit.db.upsert_game(&game)
}

/// Forget a game and all of its sessions.
#[tauri::command]
fn db_delete_game(orbit: State<'_, Orbit>, id: String) -> Result<(), String> {
    orbit.db.delete_game(&id)
}

/// Empty the library.
#[tauri::command]
fn db_clear_library(orbit: State<'_, Orbit>) -> Result<(), String> {
    orbit.db.clear_library()
}

/// Every executable already in the library, so an import can skip them.
#[tauri::command]
fn db_known_exe_paths(orbit: State<'_, Orbit>) -> Result<Vec<String>, String> {
    orbit.db.known_exe_paths()
}

/// What pressing Play will actually do, so the detail page can say so.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchInfo {
    kind: String,
    label: String,
    /// False for "time only", where the player starts the game themselves.
    starts_something: bool,
    path: Option<String>,
}

#[tauri::command]
fn launch_info(launch: serde_json::Value) -> LaunchInfo {
    let target = LaunchTarget::parse(Some(&launch.to_string()));
    LaunchInfo {
        kind: match target {
            LaunchTarget::None => "none",
            LaunchTarget::Executable { .. } => "executable",
            LaunchTarget::Steam { .. } => "steam",
        }
        .to_string(),
        label: target.label(),
        starts_something: target.starts_something(),
        path: target
            .primary_path()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

/// Change only how a game is launched, leaving the rest of it alone.
#[tauri::command]
fn set_launch_target(
    orbit: State<'_, Orbit>,
    id: String,
    launch: serde_json::Value,
) -> Result<(), String> {
    // Round-tripped through the type, so the column only ever holds a kind
    // Orbit knows how to run.
    let target = LaunchTarget::parse(Some(&launch.to_string()));
    orbit.db.set_launch(&id, &json_of(&target))
}

/// Set the playtime the player wants to see, with the sessions left alone.
#[tauri::command]
fn set_playtime(orbit: State<'_, Orbit>, id: String, total_secs: i64) -> Result<(), String> {
    orbit.db.set_playtime(&id, total_secs)
}

// ------------------------------------------------------------------- game log

/// Everything the player has written about one game.
#[tauri::command]
fn list_game_logs(orbit: State<'_, Orbit>, game_id: String) -> Result<Vec<GameLogRow>, String> {
    orbit.db.list_game_logs(&game_id)
}

/// Every note in the library, newest first, with its game's title attached.
#[tauri::command]
fn list_all_logs(
    orbit: State<'_, Orbit>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<GameLogRow>, String> {
    orbit
        .db
        .list_all_logs(limit.unwrap_or(500), offset.unwrap_or(0))
}

#[tauri::command]
fn count_logs(orbit: State<'_, Orbit>) -> Result<i64, String> {
    orbit.db.count_logs()
}

/// Clear only the Journal entries for one game; general notes remain untouched.
#[tauri::command]
fn clear_game_logs(orbit: State<'_, Orbit>, game_id: String) -> Result<(), String> {
    orbit.db.clear_game_logs(&game_id)
}

/// Write a note against a game.
#[tauri::command]
fn add_game_log(
    orbit: State<'_, Orbit>,
    game_id: String,
    at: i64,
    secs: i64,
    note: String,
    details: String,
) -> Result<GameLogRow, String> {
    orbit.db.add_game_log(&game_id, at, secs, &note, &details)
}

/// Correct a note that is already written.
#[tauri::command]
fn update_game_log(
    orbit: State<'_, Orbit>,
    id: i64,
    at: i64,
    secs: i64,
    note: String,
    details: String,
) -> Result<(), String> {
    orbit.db.update_game_log(id, at, secs, &note, &details)
}

/// Remove a note.
#[tauri::command]
fn delete_game_log(orbit: State<'_, Orbit>, id: i64) -> Result<(), String> {
    orbit.db.delete_game_log(id)
}

/// The same object the type serialises to, as a `Value` for the database.
fn json_of(target: &LaunchTarget) -> serde_json::Value {
    serde_json::from_str(&target.to_json()).unwrap_or(serde_json::json!({"kind": "none"}))
}

/// Everything Orbit can work out about a program on disk.
///
/// This is what turns a path the player picked into a game entry: the folder
/// around it, how big it is, which drive, and any cover art that came with it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExeInfo {
    exe_path: String,
    /// The folder the program is in, which is usually but not always the
    /// install folder: many games keep their binary in a `bin` subfolder.
    install_dir: String,
    drive: String,
    size_bytes: u64,
    cover_path: Option<String>,
    /// A name to start from, cleaned up from the file name.
    title: String,
}

#[tauri::command]
async fn exe_info(exe_path: String) -> Result<ExeInfo, String> {
    let path = PathBuf::from(&exe_path);
    if !path.is_file() {
        return Err(format!("There is no file at {exe_path}"));
    }
    let install_dir = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let cover_path = launch_target::nearby_cover(&path).map(|p| p.to_string_lossy().to_string());
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().replace(['_', '-'], " "))
        .unwrap_or_default();

    // Measuring a whole install can take a while, so it happens off the UI
    // thread.
    let measure_dir = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| path.clone());
    let size_bytes = tokio::task::spawn_blocking(move || storage::dir_size(&measure_dir))
        .await
        .map_err(|e| format!("Could not measure that folder: {e}"))?;

    Ok(ExeInfo {
        exe_path,
        install_dir,
        drive: storage::drive_of(&path),
        size_bytes,
        cover_path,
        title,
    })
}

/// Look for cover art next to a game.
#[tauri::command]
fn find_cover(exe_path: String) -> Option<String> {
    launch_target::nearby_cover(Path::new(&exe_path)).map(|p| p.to_string_lossy().to_string())
}

/// Which library folder a game belongs to, and the game's own folder inside it.
///
/// `None` means the game is installed somewhere Orbit was not told about, so it
/// is never moved or deleted.
#[tauri::command]
fn resolve_game_folder(folders: Vec<String>, install_dir: String) -> Option<String> {
    storage::game_folder(&folders, Path::new(&install_dir)).map(|p| p.to_string_lossy().to_string())
}

// ------------------------------------------------------------------- the sessions

/// Start a session, and start the game if it has a launch target.
#[tauri::command]
fn start_session(
    orbit: State<'_, Orbit>,
    game_id: String,
    category: Option<String>,
) -> Result<ActiveView, String> {
    let game = orbit
        .db
        .game(&game_id)?
        .ok_or_else(|| "That game is not in the library.".to_string())?;
    let target = LaunchTarget::parse(Some(&game.launch.to_string()));
    orbit.runner.start(
        &game.id,
        category.as_deref().unwrap_or("Main story"),
        &target,
    )
}

/// Stop the running session and write the time into the library.
#[tauri::command]
fn stop_session(orbit: State<'_, Orbit>, session_id: i64) -> Result<Option<ActiveView>, String> {
    orbit.runner.stop(session_id)
}

/// The session in progress, so a reloaded window picks the clock back up.
#[tauri::command]
fn active_session(orbit: State<'_, Orbit>) -> Result<Option<ActiveView>, String> {
    orbit.runner.active()
}

/// Sessions newest first, a page at a time.
#[tauri::command]
fn list_sessions(
    orbit: State<'_, Orbit>,
    limit: Option<i64>,
    offset: Option<i64>,
    game_id: Option<String>,
) -> Result<Vec<SessionRow>, String> {
    orbit
        .db
        .list_sessions(limit.unwrap_or(50), offset.unwrap_or(0), game_id.as_deref())
}

/// How many sessions there are, for paging.
#[tauri::command]
fn count_sessions(orbit: State<'_, Orbit>, game_id: Option<String>) -> Result<i64, String> {
    orbit.db.count_sessions(game_id.as_deref())
}

/// Edit a session: when it started, how long it ran, and its category and note.
#[tauri::command]
fn update_session(
    orbit: State<'_, Orbit>,
    id: i64,
    started_at: i64,
    duration_secs: i64,
    category: String,
    note: String,
) -> Result<(), String> {
    orbit
        .db
        .update_session(id, started_at, duration_secs, &category, &note)
}

#[tauri::command]
fn delete_session(orbit: State<'_, Orbit>, id: i64) -> Result<(), String> {
    orbit.db.delete_session(id)
}

/// Record time by hand, for playing somewhere Orbit cannot see.
#[tauri::command]
fn log_manual_session(
    orbit: State<'_, Orbit>,
    game_id: String,
    started_at: i64,
    duration_secs: i64,
    category: String,
    note: String,
) -> Result<(), String> {
    orbit
        .db
        .log_manual_session(&game_id, started_at, duration_secs, &category, &note)
}

/// Library-wide totals for the statistics row.
/// Put the window on screen, once there is something in it to look at.
///
/// The window is created hidden, because a webview that has not drawn yet shows
/// as a frame of empty window: on a slow start that is a flash of the wrong
/// colour between the launcher and the opening animation. The front end asks for
/// the window as soon as it has painted; nothing is shown before that.
#[tauri::command]
fn window_ready(app: tauri::AppHandle, startup: State<'_, StartupVisibility>) {
    startup.frontend_ready.store(true, Ordering::SeqCst);
    if !startup.start_in_background || startup.show_requested.load(Ordering::SeqCst) {
        show_main_window(&app);
    }
}

/// Pull the queued paths opened through Explorer, then clear the queue.
#[tauri::command]
fn take_open_exe_paths(pending: State<'_, PendingOpenExePaths>) -> Vec<String> {
    match pending.0.lock() {
        Ok(mut paths) => std::mem::take(&mut *paths),
        Err(error) => {
            log::warn!("could not read queued Explorer paths: {error}");
            Vec::new()
        }
    }
}

/// Whether the native app is running on Windows.
#[tauri::command]
fn is_windows() -> bool {
    cfg!(windows)
}

/// Set or remove Orbit's user-level `.exe` Explorer verb.
#[tauri::command]
fn set_exe_context_menu(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        explorer::set_context_menu(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("The Explorer context-menu integration is only available on Windows".into())
    }
}

/// `Open in Orbit` can be an initial launch or a second invocation. The first
/// argument is Orbit's executable; only the value following our own switch is
/// treated as a game path.
fn open_exe_paths_from_args(args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--open-in-orbit" {
            if let Some(path) = args.get(index + 1) {
                paths.push(path.clone());
                index += 1;
            }
        } else if let Some(path) = args[index].strip_prefix("--open-in-orbit=") {
            if !path.is_empty() {
                paths.push(path.to_string());
            }
        }
        index += 1;
    }
    paths
}

/// Show the main window, and put it in front, if it is not already up.
///
/// Called by the front end when it has drawn, and again from a timer in case it
/// never gets that far: an app that never shows a window at all would be a worse
/// failure than one that flashes.
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(true) {
        return;
    }
    if let Err(e) = window.show() {
        log::warn!("could not show the window: {e}");
        return;
    }
    let _ = window.set_focus();
}

/// Bring the window forward for a second invocation, waiting for the front end
/// to paint if the request arrives while Orbit is still starting.
fn request_main_window(
    app: &tauri::AppHandle,
    frontend_ready: &AtomicBool,
    show_requested: &AtomicBool,
) {
    show_requested.store(true, Ordering::SeqCst);
    if frontend_ready.load(Ordering::SeqCst) {
        reveal_window(app);
    }
}

#[tauri::command]
fn library_stats(orbit: State<'_, Orbit>) -> Result<Stats, String> {
    orbit.db.stats()
}

// --------------------------------------------------------------------- storage

/// Every drive Orbit can put games on, with room to spare.
#[tauri::command]
fn list_drives() -> Vec<DriveInfo> {
    storage::list_drives()
}

/// How much room a folder takes on disk.
///
/// Answered from the cache when it is already known, which is the usual case:
/// sizes are measured in the background when Orbit starts, so opening a page
/// that shows them does not start a walk of the disk.
#[tauri::command]
async fn folder_size(orbit: State<'_, Orbit>, path: String) -> Result<u64, String> {
    if let Some(size) = orbit.sizes.get(&path) {
        return Ok(size);
    }
    let cache = orbit.sizes.clone();
    tokio::task::spawn_blocking(move || cache.measure(&[path]).into_values().next().unwrap_or(0))
        .await
        .map_err(|e| format!("Could not measure that folder: {e}"))
}

/// Every size already measured, so a page can show them without asking twice.
#[tauri::command]
fn cached_sizes(orbit: State<'_, Orbit>) -> std::collections::HashMap<String, u64> {
    orbit.sizes.snapshot()
}

/// Measure a list of folders again, walking the disk for each one.
///
/// This is the Refresh button: it forgets what it knew and measures again, so a
/// game that grew by twenty gigabytes is reported as it is now.
#[tauri::command]
async fn refresh_sizes(
    orbit: State<'_, Orbit>,
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, u64>, String> {
    let cache = orbit.sizes.clone();
    cache.clear();
    tokio::task::spawn_blocking(move || cache.measure(&paths))
        .await
        .map_err(|e| format!("Could not measure those folders: {e}"))
}

/// Look through a folder for things that look like games.
#[tauri::command]
async fn scan_folder(path: String, max_depth: Option<usize>) -> Result<Vec<FoundGame>, String> {
    let depth = max_depth.unwrap_or(2).min(6);
    tokio::task::spawn_blocking(move || launch::scan_folder(Path::new(&path), depth))
        .await
        .map_err(|e| format!("Could not read that folder: {e}"))
}

/// Move a game to another library folder, reporting progress as it goes.
///
/// Only folders Orbit has been told about are valid targets, and only games
/// already inside one of them can be moved, so this can never touch something
/// the player put somewhere else.
#[tauri::command]
async fn move_game(
    app: tauri::AppHandle,
    install_dir: String,
    to_folder: String,
    folders: Vec<String>,
) -> Result<Moved, String> {
    let handle = app.clone();
    tokio::task::spawn_blocking(move || {
        storage::move_game(
            Path::new(&install_dir),
            &folders,
            &to_folder,
            &mut |copied, total| {
                let _ = handle.emit("move-progress", MoveProgress { copied, total });
            },
        )
    })
    .await
    .map_err(|e| format!("The move could not be started: {e}"))?
}

/// Free and total bytes on the drive holding a path.
#[tauri::command]
fn disk_space(path: String) -> Option<(u64, u64)> {
    storage::disk_space(Path::new(&path))
}

/// The drive a path is on, as `D:`.
#[tauri::command]
fn drive_of(path: String) -> String {
    storage::drive_of(Path::new(&path))
}

// ------------------------------------------------------------------- metadata

/// Make an HTTP request the browser would not be allowed to make.
///
/// Kept for requests that need a header a page cannot set, and for the ones a
/// browser would block outright. Nothing in Orbit needs it today; the store and
/// HowLongToBeat are both fetched in Rust.
#[tauri::command]
async fn http_request(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/0.1",
            " (game library tracker)"
        ))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let method = method.unwrap_or_else(|| "GET".into());
    let mut req = client.request(
        reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("{method} is not a method Orbit knows"))?,
        &url,
    );
    for (name, value) in headers.unwrap_or_default() {
        req = req.header(name, value);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let response = req.send().await.map_err(|e| format!("{e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("{e}"))?;
    if !status.is_success() {
        return Err(format!("{url} answered {status}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("That reply was not JSON: {e}"))
}

/// Completion-time estimates from HowLongToBeat.
#[tauri::command]
async fn hltb_search(title: String) -> Result<hltb::HltbData, String> {
    hltb::lookup(&title).await
}

/// Everything Orbit can find out about a game with no setup at all.
///
/// The Steam store needs no key and nothing to configure: there is no second
/// provider, and so nothing that can expire or need a login.
///
/// An app id is passed when the caller has one, an import by Steam id, say,
/// in which case the store page is read directly and the title can be blank,
/// because the page carries its own name.
#[tauri::command]
async fn metadata_lookup(title: String, app_id: Option<u64>) -> Result<metadata::Meta, String> {
    metadata::lookup_or_app(&title, app_id).await
}

/// Every program in a folder, so an import can ask which one is the game.
#[tauri::command]
fn folder_programs(path: String, max_depth: Option<usize>) -> Vec<launch::FolderProgram> {
    launch::folder_programs(Path::new(&path), max_depth.unwrap_or(3))
}

/// A partial title, as the games the store suggests for it, with pictures.
#[tauri::command]
async fn metadata_cards(title: String) -> Result<Vec<metadata::Card>, String> {
    metadata::suggest_cards(&title).await
}

/// Every achievement the game's Steam Community page lists.
///
/// The Steam app a library game belongs to.
///
/// Kept in the details when the game was looked up, and in the launch target
/// when it came in from Steam. A game that has neither is one Orbit only knows
/// by name, which is not enough for an achievement list or for artwork.
fn steam_app_id(game: &GameRow) -> Option<u64> {
    game.meta
        .as_ref()
        .and_then(|m| m.get("steamAppId"))
        .and_then(|v| v.as_u64())
        .or_else(|| match &game.launch {
            serde_json::Value::Object(map) => map.get("appId").and_then(|v| v.as_u64()),
            _ => None,
        })
}

/// What an artwork lookup found.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Artwork {
    /// The store's id, so the game can remember which app it is from now on.
    app_id: Option<u64>,
    /// Every picture the store has, each one saying what sort of picture it is,
    /// so the front end offers them in groups instead of guessing from the URL.
    picks: Vec<metadata::ArtworkPick>,
}

/// The pictures the store has for a game, for a cover that crops badly.
///
/// Playnite's answer to a cut-off cover is to offer the alternatives, and that
/// is the honest one here too: Orbit cannot know which crop suits a tile it did
/// not draw, so the player picks.
#[tauri::command]
async fn artwork_candidates(orbit: State<'_, Orbit>, game_id: String) -> Result<Artwork, String> {
    let game = orbit
        .db
        .game(&game_id)?
        .ok_or_else(|| "That game is not in the library any more.".to_string())?;

    // A game added from a folder has no store id of its own, so the title is
    // asked about. That is also the moment the id becomes worth keeping.
    let known = steam_app_id(&game);
    let app_id = match known {
        Some(id) => Some(id),
        None => metadata::app_id_for(&game.title).await,
    };
    let Some(app_id) = app_id else {
        return Err(format!(
            "Orbit could not find \"{}\" in the store. A cover can still be chosen by hand.",
            game.title
        ));
    };

    let picks = metadata::artwork(app_id).await?;
    Ok(Artwork {
        app_id: known.or(Some(app_id)),
        picks,
    })
}

/// Read fresh each time, because the share of players who have each one moves.
/// Whether an achievement is ticked is the player's own mark and is kept in the
/// library, so this never overwrites that.
#[tauri::command]
async fn achievements_fetch(orbit: State<'_, Orbit>, game_id: String) -> Result<Vec<achievements::Achievement>, String> {
    let game = orbit
        .db
        .game(&game_id)?
        .ok_or_else(|| "That game is not in the library any more.".to_string())?;
    let app_id = match steam_app_id(&game) {
        Some(id) => id,
        // A game added from a folder is remembered by title only, so the store
        // is asked which app it is before the list can be read.
        None => metadata::app_id_for(&game.title).await.ok_or_else(|| {
            "Orbit could not find this game in the store, so there is no achievement list to read."
                .to_string()
        })?,
    };

    let mut fetched = achievements::fetch(app_id).await?;

    // What the player ticked comes back with the fresh list; a new achievement
    // arrives locked, which is the honest default.
    let ticked: std::collections::HashSet<String> = game
        .achievements
        .iter()
        .filter(|a| a.get("unlocked").and_then(|v| v.as_bool()).unwrap_or(false))
        .filter_map(|a| a.get("id").and_then(|v| v.as_str()).map(str::to_string))
        .collect();
    for row in &mut fetched {
        row.unlocked = ticked.contains(&row.id);
    }
    Ok(fetched)
}

/// Put one game's notes in the order they were dragged into.
#[tauri::command]
fn reorder_game_logs(orbit: State<'_, Orbit>, game_id: String, ids: Vec<i64>) -> Result<(), String> {
    orbit.db.reorder_game_logs(&game_id, &ids)
}

/// The player's installed Steam games, for the import dialog.
#[tauri::command]
async fn steam_library() -> Result<Vec<steam::SteamGame>, String> {
    tokio::task::spawn_blocking(steam::installed_games)
        .await
        .map_err(|e| format!("Could not read the Steam library: {e}"))?
}

/// Installed games described by one launcher's local manifests or Windows records.
///
/// This read-only scan runs only after a player selects a launcher, or when that
/// specific library is enabled for startup. It never contacts a launcher service.
#[tauri::command]
async fn launcher_games(launcher: Option<String>) -> Result<Vec<launchers::LauncherGame>, String> {
    tokio::task::spawn_blocking(move || launchers::installed_games(launcher.as_deref()))
        .await
        .map_err(|e| format!("Could not scan game launchers: {e}"))?
}

/// Titles the store suggests for a partial name, for the Add dialog.
#[tauri::command]
async fn metadata_suggest(title: String) -> Result<Vec<String>, String> {
    metadata::suggest(&title).await
}

// ------------------------------------------------------------------- settings

/// The saved settings, or `None` the first time Orbit runs.
#[tauri::command]
fn load_settings(orbit: State<'_, Orbit>) -> Option<Settings> {
    orbit.store.load_settings()
}

/// Save the settings to disk.
#[tauri::command]
fn save_settings(orbit: State<'_, Orbit>, settings: Settings) -> Result<(), String> {
    if let Ok(mut policy) = orbit.policy.lock() {
        *policy = policy_from_settings(Some(&settings));
    }
    orbit.store.save_settings(&settings)
}

/// Where Orbit keeps its files, so the settings screen can show it.
#[tauri::command]
fn data_dir(orbit: State<'_, Orbit>) -> String {
    orbit.store.root().to_string_lossy().to_string()
}

/// How much space Orbit's own files take.
#[tauri::command]
async fn data_dir_size(orbit: State<'_, Orbit>) -> Result<u64, String> {
    let root = orbit.store.root().to_path_buf();
    tokio::task::spawn_blocking(move || storage::dir_size(&root))
        .await
        .map_err(|e| format!("Could not measure the data folder: {e}"))
}

/// Open a folder in Explorer, so a path in the UI is one click from the files.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("{path} is not there any more."));
    }
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open Explorer: {e}"))
}

/// Open a game's install folder itself in the system file manager.
#[tauri::command]
fn open_game_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(format!("{path} is not there any more."));
    }

    #[cfg(windows)]
    let result = std::process::Command::new("explorer").arg(&target).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&target).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Could not open the game folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_args: Vec<String> = std::env::args().collect();
    let started_by_autostart = initial_args.iter().any(|arg| arg == "--autostart");
    let pending_paths = Arc::new(Mutex::new(open_exe_paths_from_args(&initial_args)));
    let pending_for_single_instance = Arc::clone(&pending_paths);
    let pending_for_setup = Arc::clone(&pending_paths);
    let frontend_ready = Arc::new(AtomicBool::new(false));
    let show_requested = Arc::new(AtomicBool::new(false));
    let frontend_ready_for_single_instance = Arc::clone(&frontend_ready);
    let show_requested_for_single_instance = Arc::clone(&show_requested);
    let frontend_ready_for_setup = Arc::clone(&frontend_ready);
    let show_requested_for_setup = Arc::clone(&show_requested);

    tauri::Builder::default()
        // Register first so Explorer launches are handed to this process before
        // any other plugin attempts to open a second copy of Orbit.
        .plugin(tauri_plugin_single_instance::init(move |app, args, _cwd| {
            let paths = open_exe_paths_from_args(&args);
            if !paths.is_empty() {
                match pending_for_single_instance.lock() {
                    Ok(mut pending) => pending.extend(paths),
                    Err(error) => log::error!("could not queue Explorer paths: {error}"),
                }
                if let Err(error) = app.emit(OPEN_EXE_REQUESTED_EVENT, ()) {
                    log::warn!("could not notify the webview about an Explorer request: {error}");
                }
            }
            request_main_window(app, &frontend_ready_for_single_instance, &show_requested_for_single_instance);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        // The folder and file pickers behind every Browse button.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Orbit")
                .args(["--autostart"])
                .build(),
        )
        .setup(move |app| {
            let root = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("Orbit"));
            let store = Store::new(root);
            let db = Arc::new(
                db::Db::open(&store.root().join("orbit.db")).map_err(std::io::Error::other)?,
            );
            let saved_settings = store.load_settings();
            let policy = Arc::new(Mutex::new(policy_from_settings(saved_settings.as_ref())));
            let start_in_background = started_by_autostart
                && saved_settings.as_ref().is_some_and(|settings| {
                    settings.get("launchOnStartup").and_then(serde_json::Value::as_bool) == Some(true)
                        && settings
                            .get("launchOnStartupBackground")
                            .and_then(serde_json::Value::as_bool)
                            == Some(true)
                });

            // Keep the Explorer action in sync with the saved preference and
            // this install's path. Old settings did not have the field, so the
            // first launch opts in by default as the UI does.
            #[cfg(windows)]
            {
                let enabled = saved_settings
                    .as_ref()
                    .and_then(|settings| settings.get("openExeInOrbit"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true);
                if let Err(error) = explorer::set_context_menu(enabled) {
                    log::warn!("could not update the Explorer context menu: {error}");
                }
            }

            let runner = Runner::new(Arc::clone(&db), Arc::clone(&policy));
            let sizes = SizeCache::default();
            let _ = APP.set(app.handle().clone());

            // Sizes are measured once, in the background, right after launch:
            // waiting for them here would hold the window back, and walking the
            // disk every time the Storage page opens would make that page crawl
            // on the drives where it matters most. Nothing is measured twice.
            {
                let db = Arc::clone(&db);
                let store = store.clone();
                let cache = sizes.clone();
                std::thread::spawn(move || {
                    let mut paths: Vec<String> = store
                        .load_settings()
                        .and_then(|s| s.get("libraryFolders").cloned())
                        .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                        .unwrap_or_default();
                    if let Ok(games) = db.list_games() {
                        for game in games {
                            if let Some(dir) = game.install_dir {
                                paths.push(dir);
                            }
                        }
                    }
                    paths.sort();
                    paths.dedup();
                    cache.measure(&paths);
                });
            }

            // The tray is allowed to fail: background launch is only safe when
            // there is a tray icon to bring the hidden window back.
            let tray_ready = match build_tray(app.handle()) {
                Ok(()) => true,
                Err(error) => {
                    log::warn!("no tray icon this run: {error}");
                    false
                }
            };
            let background_requested = start_in_background;
            let start_in_background = background_requested && tray_ready;
            if background_requested && !tray_ready {
                log::warn!("could not start Orbit hidden because its tray icon is unavailable");
            }

            app.manage(StartupVisibility {
                start_in_background,
                frontend_ready: Arc::clone(&frontend_ready_for_setup),
                show_requested: Arc::clone(&show_requested_for_setup),
            });
            app.manage(PendingOpenExePaths(Arc::clone(&pending_for_setup)));

            // Normally the front end reveals itself after its first paint. If
            // it never gets that far, keep the same visible fallback; a genuine
            // background start stays hidden unless another instance requested it.
            {
                let handle = app.handle().clone();
                let show_requested = Arc::clone(&show_requested_for_setup);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(6));
                    if !start_in_background || show_requested.load(Ordering::SeqCst) {
                        show_main_window(&handle);
                    }
                });
            }

            app.manage(Orbit { db, runner, store, sizes, policy });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_list_games,
            db_upsert_game,
            db_delete_game,
            db_clear_library,
            db_known_exe_paths,
            set_launch_target,
            set_playtime,
            list_game_logs,
            list_all_logs,
            count_logs,
            clear_game_logs,
            add_game_log,
            update_game_log,
            delete_game_log,
            launch_info,
            exe_info,
            find_cover,
            resolve_game_folder,
            start_session,
            stop_session,
            active_session,
            list_sessions,
            count_sessions,
            update_session,
            delete_session,
            log_manual_session,
            library_stats,
            window_ready,
            take_open_exe_paths,
            is_windows,
            set_exe_context_menu,
            list_drives,
            folder_size,
            cached_sizes,
            refresh_sizes,
            scan_folder,
            move_game,
            disk_space,
            drive_of,
            http_request,
            update::download_update,
            update::run_update,
            update::forget_update,
            hltb_search,
            metadata_lookup,
            metadata_suggest,
            metadata_cards,
            achievements_fetch,
            artwork_candidates,
            reorder_game_logs,
            steam_library,
            launcher_games,
            folder_programs,
            load_settings,
            save_settings,
            data_dir,
            data_dir_size,
            reveal_in_explorer,
            open_game_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Orbit")
        // The clock has to stop when the app does, however the app is closed.
        //
        // Only the tray's own Quit used to write down a running session, so
        // closing the window with the X left the row open: on the next start it
        // looked like a game still being played, with a clock counting up from
        // whenever it had begun. This is the one place every exit goes through,
        // so every exit stops the clock.
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(orbit) = app.try_state::<Orbit>() {
                    orbit.runner.close_for_app_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drive_is_named_the_way_a_player_would_say_it() {
        assert_eq!(storage::drive_of(Path::new(r"D:\Games\Hades")), "D:");
        assert_eq!(storage::drive_of(Path::new(r"c:\games")), "C:");
    }

    #[test]
    fn explorer_arguments_only_capture_paths_after_our_switch() {
        let args = vec![
            "Orbit.exe".to_string(),
            "--autostart".to_string(),
            "--open-in-orbit".to_string(),
            r"C:\Games\A game.exe".to_string(),
            r"--open-in-orbit=D:\Games\Another.exe".to_string(),
        ];
        assert_eq!(
            open_exe_paths_from_args(&args),
            vec![
                r"C:\Games\A game.exe".to_string(),
                r"D:\Games\Another.exe".to_string(),
            ]
        );
    }

    #[test]
    fn drives_come_back_with_a_readable_size() {
        let drives = storage::list_drives();
        // Drive letters are how Windows names a disk. Anywhere else there are
        // no letters to list, and the library keeps its folders by path
        // instead, so an empty answer is the right one rather than a fault.
        if !cfg!(windows) {
            assert!(drives.is_empty(), "there are no drive letters here");
            return;
        }
        assert!(!drives.is_empty(), "this machine has at least one drive");
        assert!(drives.iter().all(|d| d.drive.ends_with(':')));
        assert!(
            drives.iter().any(|d| d.total > 0),
            "at least one drive reports its size"
        );
    }
}
