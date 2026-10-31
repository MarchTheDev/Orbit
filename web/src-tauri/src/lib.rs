//! Orbit's native side.
//!
//! The React front end talks to Windows through the commands in this file:
//! starting games, noticing when they stop, moving a game between drives,
//! reading folders, and fetching metadata the browser is not allowed to reach.

mod achievements;
mod capture;
mod audio;
mod media;
mod stats;
mod ambient;
mod db;
#[cfg(windows)]
mod explorer;
#[cfg(target_os = "linux")]
mod files_menu;
mod format;
mod gamepad;
mod hltb;
mod overlay;
mod launch;
mod launch_target;
mod launchers;
#[cfg(target_os = "linux")]
mod linux_window;
mod cloud;
mod metadata;
mod notice;
mod process;
mod proton;
mod saves;
mod session;
mod sgdb;
mod steam;
mod steam_stats;
mod storage;
mod store;
mod transfer;
mod update;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use db::{CurrentPlaythrough, GameLogRow, GameRow, GameWrite, PlaythroughRow, SessionRow, Stats};
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
    /// What the close button does. `quit` or `tray`. Empty means quit.
    #[serde(default)]
    pub on_app_close: String,
    /// Kept so a library saved with the old minimise choice still opens.
    /// The button itself is always the taskbar one now.
    #[serde(default)]
    #[allow(dead_code)]
    pub on_minimize: String,
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
/// How many cloud copies are running. Closing the process then can cut a copy in half.
static CLOUD_JOBS: AtomicUsize = AtomicUsize::new(0);
/// The player chose Close anyway, so the next close is allowed to finish.
static FORCE_QUIT: AtomicBool = AtomicBool::new(false);

/// Counts a cloud copy, and clears the corner ring when the last one ends.
///
/// The count lives on the command, not on a separate message from the window.
/// A message can arrive late, or not at all, and then every later close is refused.
struct CloudJob;
impl CloudJob {
    fn start() -> Self {
        CLOUD_JOBS.fetch_add(1, Ordering::SeqCst);
        CloudJob
    }
}
impl Drop for CloudJob {
    fn drop(&mut self) {
        let left = CLOUD_JOBS.fetch_sub(1, Ordering::SeqCst);
        if left == 1 {
            cloud::end_pulse();
        }
    }
}

fn watch_cloud(app: &tauri::AppHandle, up: bool, heading: &str) {
    let app = app.clone();
    cloud::begin_pulse(up, heading, Arc::new(move |pulse| {
        let _ = app.emit("cloud-transfer", &pulse);
    }));
}

/// Set once an exit has been asked for, so the minimise watcher can leave and
/// a second exit event does not start a second watchdog.
static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) fn quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

/// An exit has started. The pad reader and the titlebar hooks leave before the
/// window is torn down, so a close is not also a fault in one of those threads.
pub(crate) fn begin_quit() {
    QUITTING.store(true, Ordering::SeqCst);
}

/// Hide the window and take it off the taskbar. Unminimizing first is what
/// makes a Wayland compositor drop the minimized entry instead of keeping it.
fn withdraw_to_tray(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    linux_window::note_parked();
    let _ = window.set_skip_taskbar(true);
    let _ = window.unminimize();
    let _ = window.hide();
}

/// End the Linux process without letting WebKit tear the page down.
///
/// Destroying the view makes the page process abort in Mesa, and the desktop
/// shows that as a crash. The session is written first. The page process is
/// killed, then this process ends without glib's exit handlers.
#[cfg(target_os = "linux")]
fn finish_linux_quit(app: &tauri::AppHandle) {
    use tauri::Manager;
    begin_quit();
    if let Some(orbit) = app.try_state::<Orbit>() {
        orbit.runner.close_for_app_exit();
    }
    ambient::stop();
    if let Some(window) = app.get_webview_window("main") {
        linux_window::end_page(&window);
    }
    unsafe { libc::_exit(0) };
}

fn remember_minimize_policy(policy: &WindowPolicy) {
    // The minimise button is the window's own. There is no setting that turns
    // it into a hide, so the hook must not take the window off the taskbar.
    #[cfg(target_os = "linux")]
    {
        let _ = policy;
        linux_window::set_armed(false);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = policy;
    }
}

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
                if cloud_blocks_quit() {
                    ask_to_wait(app);
                    return;
                }
                // Same as closing the window by hand: the clock stops and what
                // it counted is written down before the app goes.
                quit_now(app);
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

    // Without an icon the entry is there but nothing is drawn, and most panels
    // show that as no entry at all. Say so, and do not count the tray as ready:
    // a hidden window with an invisible way back is the same as no way back.
    let has_icon = match app.default_window_icon().cloned() {
        Some(icon) => {
            tray = tray.icon(icon);
            true
        }
        None => {
            log::warn!("no window icon available, so the tray entry may be invisible");
            false
        }
    };
    tray.build(app)?;
    TRAY_READY.store(has_icon, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Bring Orbit back to the front, wherever it went.
pub(crate) fn reveal_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    #[cfg(target_os = "linux")]
    linux_window::note_revealed();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
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
    overlay::game_stopped();
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
            LaunchTarget::Wine { .. } => "wine",
            LaunchTarget::Lutris { .. } => "lutris",
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

/// Clear the journal entries of one playthrough. Other runs stay.
#[tauri::command]
fn clear_playthrough_logs(
    orbit: State<'_, Orbit>,
    game_id: String,
    playthrough_id: String,
) -> Result<(), String> {
    orbit.db.clear_playthrough_logs(&game_id, &playthrough_id)
}

/// The run each game is currently on, so a list can count that run.
#[tauri::command]
fn list_current_playthroughs(orbit: State<'_, Orbit>) -> Result<Vec<CurrentPlaythrough>, String> {
    orbit.db.list_current_playthroughs()
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

/// The runs of one game. Each one has its own journal and its own notes.
#[tauri::command]
fn list_playthroughs(orbit: State<'_, Orbit>, game_id: String) -> Result<Vec<PlaythroughRow>, String> {
    orbit.db.list_playthroughs(&game_id)
}

#[tauri::command]
fn add_playthrough(orbit: State<'_, Orbit>, game_id: String, name: String) -> Result<PlaythroughRow, String> {
    orbit.db.add_playthrough(&game_id, &name)
}

#[tauri::command]
fn rename_playthrough(orbit: State<'_, Orbit>, id: String, name: String) -> Result<(), String> {
    orbit.db.rename_playthrough(&id, &name)
}

#[tauri::command]
fn delete_playthrough(orbit: State<'_, Orbit>, id: String) -> Result<PlaythroughRow, String> {
    orbit.db.delete_playthrough(&id)
}

#[tauri::command]
fn set_current_playthrough(orbit: State<'_, Orbit>, id: String) -> Result<PlaythroughRow, String> {
    orbit.db.set_current_playthrough(&id)
}

#[tauri::command]
fn write_playthrough_notes(
    orbit: State<'_, Orbit>,
    game_id: String,
    playthrough_id: Option<String>,
    notes: String,
) -> Result<(), String> {
    orbit
        .db
        .write_playthrough_notes(&game_id, playthrough_id.as_deref(), &notes)
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
    let started = orbit.runner.start(
        &game.id,
        category.as_deref().unwrap_or("Main story"),
        &target,
    )?;
    // A timer with no program has nothing on screen to keep. A launched game does.
    if !matches!(target, LaunchTarget::None) {
        overlay::game_started(&game.title);
    }
    Ok(started)
}

#[tauri::command]
fn overlay_configure(
    app: tauri::AppHandle,
    enabled: bool,
    replay: bool,
    seconds: u32,
    lengths: Option<Vec<u32>>,
    quality: Option<String>,
    fps: Option<u32>,
    ffmpeg: String,
    screenshot_directory: String,
    recording_directory: String,
    replay_directory: String,
    game_only: bool,
) {
    overlay::configure(
        Some(&app),
        enabled,
        replay,
        seconds,
        lengths.as_deref(),
        quality.as_deref().unwrap_or("1080p"),
        fps.unwrap_or(30),
        &ffmpeg,
        &screenshot_directory,
        &recording_directory,
        &replay_directory,
        game_only,
    );
}

#[tauri::command]
async fn media_now() -> Vec<media::NowPlaying> {
    tauri::async_runtime::spawn_blocking(media::now).await.unwrap_or_default()
}

#[tauri::command]
async fn media_control(id: String, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || media::control(&id, &action))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn overlay_mode() -> overlay::OverlayMode {
    overlay::mode()
}

#[tauri::command]
fn overlay_pins(has: bool) {
    overlay::set_pins(has);
}

#[tauri::command]
fn overlay_hits(boxes: Vec<overlay::HitBox>) {
    overlay::set_hits(boxes);
}

/// The page has a press down, so the panel keeps the pointer until it ends.
#[tauri::command]
fn overlay_hold(on: bool) {
    overlay::set_hold(on);
}

#[tauri::command]
fn overlay_show_pins(app: tauri::AppHandle) {
    overlay::show_pins(&app);
}

#[tauri::command]
fn audio_apps() -> Result<Vec<audio::AppAudio>, String> {
    audio::list()
}

#[tauri::command]
fn audio_set(id: String, volume: u8, muted: bool) -> Result<(), String> {
    audio::set(&id, volume, muted)
}

#[tauri::command]
fn audio_devices() -> Result<Vec<audio::AudioDevice>, String> {
    audio::devices()
}

#[tauri::command]
fn audio_use_device(id: String, kind: String) -> Result<(), String> {
    audio::use_device(&id, &kind)
}

#[tauri::command]
fn audio_set_named(name: String, volume: u8, muted: bool) -> Result<(), String> {
    audio::set_named(&name, volume, muted)
}

#[tauri::command]
fn machine_stats(want_fps: bool) -> stats::MachineStats {
    stats::sample(want_fps)
}

/// Whether the last run ended while the panel was reading live stats.
///
/// The main window asks once at startup. When it is true, it turns the reading
/// off in the saved settings and says so: an overlay that opens and stays is
/// worth more than an FPS number.
#[tauri::command]
fn live_stats_suspect() -> bool {
    stats::suspect()
}

/// Add the overlay's notes under the journal notes for the game that is running.
///
/// The words are not kept on the overlay. Closing the game throws the draft
/// away. Saving puts them under what was already written, with a blank line
/// between, so an earlier note is not replaced.
#[tauri::command]
fn append_playthrough_notes(app: tauri::AppHandle, orbit: State<'_, Orbit>, notes: String) -> Result<(), String> {
    let notes = notes.trim().to_string();
    if notes.is_empty() {
        return Ok(());
    }
    let active = orbit.runner.active()?.ok_or_else(|| "Start the game before saving a note.".to_string())?;
    let existing = orbit.db.game(&active.game_id)?.map(|game| game.notes).unwrap_or_default();
    let joined = db::Db::join_notes(&existing, &notes);
    orbit.db.write_playthrough_notes(&active.game_id, None, &joined)?;
    let _ = app.emit(
        "playthrough-notes",
        serde_json::json!({ "gameId": active.game_id, "notes": joined }),
    );
    Ok(())
}

/// The overlay cannot write settings. It asks the main window to open them.
#[tauri::command]
fn overlay_open_settings(app: tauri::AppHandle) {
    overlay::hide(&app, "the settings button");
    reveal_window(&app);
    let _ = app.emit("overlay-open-settings", ());
}

#[tauri::command]
fn overlay_playing(title: String) {
    overlay::game_started(&title);
}

#[tauri::command]
async fn overlay_ready_notice(app: tauri::AppHandle) -> Result<(), String> {
    // The launch path calls this immediately after the game starts. Do not build
    // or show a WebView from the synchronous invoke handler: queue the native
    // window work onto Tauri's main thread and wait off-thread for its result.
    tauri::async_runtime::spawn_blocking(move || {
        let (notice_tx, notice_rx) = std::sync::mpsc::channel();
        let notice_app = app.clone();
        app.run_on_main_thread(move || {
            let _ = notice_tx.send(overlay::ready_notice(&notice_app));
        })
        .map_err(|error| error.to_string())?;

        notice_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|error| format!("The game-start notice could not be displayed: {error}"))?
    })
    .await
    .map_err(|error| format!("The game-start notice task failed: {error}"))?
}

#[tauri::command]
fn overlay_status() -> overlay::OverlayStatus {
    overlay::status()
}

/// The panel's page saying it is still drawn.
///
/// A WebView2 renderer that dies leaves the native window on screen with
/// nothing in it, which cannot be told apart from an overlay that closed
/// itself. The thread that keeps the panel in front uses this to know the
/// difference and rebuilds the window when the answer stops.
#[tauri::command]
fn overlay_alive() {
    overlay::heartbeat();
}

/// A capture outlives the panel that asked for it. The panel shows its own
/// toast while it is on screen; when it has closed in the meantime, the answer
/// is drawn by the native card instead, so a save never finishes in silence.
// The announcement happens inside the blocking task, not after its `await`.
// Closing the overlay destroys the web view that asked for the capture, which
// drops the command's future: anything after the await would never run, and a
// save started just before the panel closed would finish silently.
#[tauri::command]
async fn overlay_shot(app: tauri::AppHandle, stamp: String) -> Result<String, String> {
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = overlay::shot(&worker, &stamp);
        overlay::announce_capture(&worker, "screenshot", &outcome);
        outcome
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn overlay_record(app: tauri::AppHandle, stamp: String) -> Result<String, String> {
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = overlay::record(&worker, &stamp);
        overlay::announce_capture(&worker, "recording", &outcome);
        outcome
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn overlay_replay(app: tauri::AppHandle, seconds: u32, stamp: String) -> Result<String, String> {
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = overlay::save_replay(&worker, seconds, &stamp);
        overlay::announce_capture(&worker, "replay", &outcome);
        outcome
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The colours of the player's theme, for the native card. Called by the main
/// window when settings load and whenever the theme changes.
#[tauri::command]
fn overlay_theme(panel: String, text: String, muted: String, accent: String) {
    overlay::set_palette(&panel, &text, &muted, &accent);
}

#[tauri::command]
fn overlay_hide(app: tauri::AppHandle, reason: Option<String>) {
    // The page says which of its own ways out was taken. Without that, every
    // report of a panel closing itself read the same: "the page asked".
    overlay::hide(&app, reason.as_deref().unwrap_or("no reason given"));
}

#[tauri::command]
fn overlay_folder() -> Result<String, String> {
    overlay::open_folder()
}

/// Where screenshots, recordings and replays are being written.
///
/// The page cannot guess these: the defaults are the machine's own Pictures and
/// Videos folders, which only the desktop side knows how to find.
#[tauri::command]
fn overlay_capture_dirs() -> overlay::CaptureDirs {
    let (screenshots, recordings, replays) = overlay::capture_dirs();
    overlay::CaptureDirs { screenshots, recordings, replays }
}

#[tauri::command]
fn overlay_open_kind(kind: String) -> Result<String, String> {
    overlay::open_kind(&kind)
}

#[tauri::command]
fn overlay_open(path: String) -> Result<(), String> {
    overlay::open_item(&path)
}

#[tauri::command]
fn overlay_delete(path: String) -> Result<(), String> {
    overlay::delete_item(&path)
}

#[tauri::command]
fn overlay_copy(path: String) -> Result<(), String> {
    overlay::copy_item(&path)
}

#[tauri::command]
fn overlay_gallery() -> Vec<overlay::GalleryItem> {
    overlay::gallery()
}

/// Stop the running session and write the time into the library.
#[tauri::command]
fn stop_session(orbit: State<'_, Orbit>, session_id: i64) -> Result<Option<ActiveView>, String> {
    let stopped = orbit.runner.stop(session_id)?;
    if stopped.is_some() {
        overlay::game_stopped();
    }
    Ok(stopped)
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
    // The panel is built while the library is idle, so its first open does
    // not have to wait for a web view to start.
    overlay::warm(&app);
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

#[tauri::command]
fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

/// Set or remove Orbit's user-level `.exe` Explorer verb.
#[tauri::command]
fn set_exe_context_menu(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        explorer::set_context_menu(enabled)
    }
    #[cfg(target_os = "linux")]
    {
        files_menu::set_context_menu(enabled)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = enabled;
        Err("The right-click menu is only available on Windows and Linux".into())
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
    #[cfg(target_os = "linux")]
    linux_window::note_shown();
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // A minimized window still counts as visible, so returning here left the
    // open sitting in the taskbar. Tray Show unminimizes, which is why that
    // one was immediate. Do the same here, and only skip the focus steal when
    // the window is already up.
    let minimized = window.is_minimized().unwrap_or(false);
    let _ = window.unminimize();
    let _ = window.set_skip_taskbar(false);
    if window.is_visible().unwrap_or(false) && !minimized {
        return;
    }
    if let Err(e) = window.show() {
        log::warn!("could not show the window: {e}");
        return;
    }
    let _ = window.unminimize();
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

/// The controller the page asks for. Linux does not wait for an event that
/// the web view may never hear.
#[tauri::command]
fn gamepad_poll() -> gamepad::PadEvent {
    gamepad::poll()
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/",
            env!("CARGO_PKG_VERSION"),
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

/// The factsheet the planning sheet shows for a store app id.
///
/// Bonker's cache of the Steam catalogue carries it, with Steam's own page
/// filling the gaps - the answer needs no key from the player either way.
#[tauri::command]
async fn game_facts(app_id: u64) -> Result<metadata::Facts, String> {
    metadata::facts(app_id).await
}

/// Everything Orbit can find out about a game with no setup at all.
///
/// The Steam store needs no key. SteamGridDB is asked for a portrait only when
/// the store has none and the player has put a key in Settings.
///
/// An app id is passed when the caller has one, an import by Steam id, say,
/// in which case the store page is read directly and the title can be blank,
/// because the page carries its own name.
#[tauri::command]
async fn metadata_lookup(
    orbit: State<'_, Orbit>,
    title: String,
    app_id: Option<u64>,
) -> Result<metadata::Meta, String> {
    let mut meta = metadata::lookup_or_app(&title, app_id).await?;
    if meta.cover_url.is_none() {
        let name = meta.name.clone().unwrap_or_else(|| title.clone());
        if let Some(url) = first_portrait(&orbit, &name, meta.steam_app_id.or(app_id)).await {
            meta.cover_url = Some(url);
        }
    }
    Ok(meta)
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
    /// Portrait covers. A page is one screen of them.
    picks: Vec<metadata::ArtworkPick>,
    page: u32,
    has_more: bool,
}

/// The pictures the store has for a game, for a cover that crops badly.
///
/// Playnite's answer to a cut-off cover is to offer the alternatives, and that
/// is the honest one here too: Orbit cannot know which crop suits a tile it did
/// not draw, so the player picks.
#[tauri::command]
async fn artwork_candidates(orbit: State<'_, Orbit>, game_id: String, page: Option<u32>) -> Result<Artwork, String> {
    let game = orbit
        .db
        .game(&game_id)?
        .ok_or_else(|| "That game is not in the library any more.".to_string())?;

    // A game added from a folder has no store id of its own, so the title is
    // asked about. That is also the moment the id becomes worth keeping.
    artwork_for(&orbit, &game.title, steam_app_id(&game), page.unwrap_or(0)).await
}

/// Pictures for a game that has not been saved yet, so Add Game can offer
/// another cover than the one the catalogue picked first.
#[tauri::command]
async fn artwork_choices(
    orbit: State<'_, Orbit>,
    title: String,
    app_id: Option<u64>,
    page: Option<u32>,
) -> Result<Artwork, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Name the game before looking for covers.".into());
    }
    artwork_for(orbit.inner(), title, app_id, page.unwrap_or(0)).await
}

async fn artwork_for(orbit: &Orbit, title: &str, known: Option<u64>, page: u32) -> Result<Artwork, String> {
    let app_id = match known {
        Some(id) => Some(id),
        None => metadata::app_id_for(title).await,
    };
    let settings = orbit.store.load_settings();
    let mut picks = Vec::new();
    let mut has_more = false;
    let mut cover_error = None;

    // Steam's own portrait is the no-key default, and it only belongs on the
    // first page. Later pages are more community covers, not the same capsule.
    if page == 0 {
        if let Some(id) = app_id {
            if let Ok(found) = metadata::artwork(id).await {
                picks.extend(found.into_iter().filter(|pick| pick.kind == "portrait"));
            }
            // Big titles still have the old portrait file. Smaller ones, such as
            // a new Steam release, only have it on the hashed path Bonker caches.
            if picks.is_empty() {
                picks.extend(metadata::bonker_portraits(id).await);
            }
        }
    }

    if let Some(key) = setting_text(&settings, "sgdbApiKey") {
        match sgdb::portraits(app_id, title, &key, page).await {
            Ok(found) => {
                has_more = found.has_more;
                for pick in found.picks {
                    if !picks.iter().any(|have| have.url == pick.url) {
                        picks.push(pick);
                    }
                }
            }
            Err(e) => {
                log::warn!("SteamGridDB offered nothing: {e}");
                if e.contains("refused") {
                    return Err(e);
                }
                cover_error = Some(e);
            }
        }
    }

    if picks.is_empty() {
        if let Some(reason) = cover_error {
            return Err(reason);
        }
        if page == 0 {
            return Err(format!(
                "Orbit could not find a portrait cover for \"{title}\". A cover can still be chosen by hand."
            ));
        }
    }
    Ok(Artwork {
        app_id: known.or(app_id),
        picks,
        page,
        has_more,
    })
}

/// The first portrait SteamGridDB can offer, for a game whose store page has
/// no library capsule. Heroes and wide banners are not covers.
async fn first_portrait(orbit: &Orbit, title: &str, app_id: Option<u64>) -> Option<String> {
    let settings = orbit.store.load_settings();
    let key = setting_text(&settings, "sgdbApiKey")?;
    sgdb::portraits(app_id, title, &key, 0)
        .await
        .ok()
        .and_then(|found| found.picks.into_iter().next())
        .map(|pick| pick.url)
}

/// Read fresh each time, because the share of players who have each one moves.
///
/// Two sources, best first. The Steam client's own stats files hold the list
/// and the moment each one was unlocked, offline, with no key, no login and no
/// public profile — so for a game played through Steam on this machine that is
/// the whole answer, and nothing is asked of anybody. The community page is the
/// fallback for a game with no local schema; it lists the achievements and
/// their rarity but cannot say who has them, so the ticks stay the player's own
/// and are carried over.
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

    let settings = orbit.store.load_settings();
    let extra: Vec<String> = setting_text(&settings, "steamPath")
        .map(|path| vec![path])
        .unwrap_or_default();

    // The client's own files come first. They are offline, need no key and no
    // public profile, and they carry the moment each achievement happened,
    // which is more than any of the other sources can say.
    let local = tokio::task::spawn_blocking(move || steam_stats::read_any(app_id, &extra))
        .await
        .unwrap_or_else(|e| {
            log::warn!("reading Steam's stats files failed: {e}");
            None
        });

    // Unlock times worth believing, and where they came from. `None` means no
    // source had an answer, so the player's own ticks stand.
    let mut known: Option<std::collections::HashMap<String, u64>> = None;

    let mut fetched = match local {
        Some(found) => {
            let mut rows: Vec<achievements::Achievement> = found
                .rows
                .into_iter()
                .map(|row| achievements::Achievement {
                    id: row.id,
                    name: row.name,
                    description: row.description,
                    icon: steam_stats::icon_url(app_id, &row.icon),
                    // The schema says what the achievements are, not how rare
                    // they are. That is a separate, public, keyless question.
                    percent: 0.0,
                    unlocked: row.unlocked_at > 0,
                    unlocked_at: row.unlocked_at,
                })
                .collect();
            for (id, percent) in steam_stats::global_percentages(app_id).await {
                if let Some(row) = rows.iter_mut().find(|row| row.id == id) {
                    row.percent = percent;
                }
            }
            // Only believe "nothing here is unlocked" when the client actually
            // said who is signed in. Otherwise this install's answer is silence,
            // and silence is not the same as no.
            if found.knows_account {
                known = Some(
                    rows.iter()
                        .filter(|row| row.unlocked_at > 0)
                        .map(|row| (row.id.clone(), row.unlocked_at))
                        .collect(),
                );
            }
            rows
        }
        None => achievements::fetch(app_id).await?,
    };

    // What the player ticked comes back with a fresh list; a new achievement
    // arrives locked, which is the honest default.
    let ticked: std::collections::HashSet<String> = game
        .achievements
        .iter()
        .filter(|a| a.get("unlocked").and_then(|v| v.as_bool()).unwrap_or(false))
        .filter_map(|a| a.get("id").and_then(|v| v.as_str()).map(str::to_string))
        .collect();
    let when: std::collections::HashMap<String, u64> = game
        .achievements
        .iter()
        .filter_map(|a| {
            let id = a.get("id")?.as_str()?;
            let at = a.get("unlockedAt")?.as_u64()?;
            (at > 0).then_some((id.to_string(), at))
        })
        .collect();

    for row in &mut fetched {
        match &known {
            Some(found) => {
                row.unlocked = found.contains_key(&row.id);
                row.unlocked_at = found.get(&row.id).copied().unwrap_or(0);
            }
            None => {
                row.unlocked = ticked.contains(&row.id);
                // A time read earlier is worth keeping, even though a tick done
                // by hand has none.
                row.unlocked_at = when.get(&row.id).copied().unwrap_or(0);
            }
        }
    }
    Ok(fetched)
}

/// A non-blank string setting, read from the settings file.
///
/// Settings is a bag of JSON rather than a struct, so every optional field is
/// picked out the same way: present, a string, and not just spaces.
fn setting_text(settings: &Option<Settings>, key: &str) -> Option<String> {
    settings
        .as_ref()?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Put one game's notes in the order they were dragged into.
#[tauri::command]
fn reorder_game_logs(orbit: State<'_, Orbit>, game_id: String, ids: Vec<i64>) -> Result<(), String> {
    orbit.db.reorder_game_logs(&game_id, &ids)
}

/// The player's installed Steam games, for the import dialog.
///
/// `extra_paths` is where the player says Steam is, from Settings. On Linux, and
/// inside a sandbox, Steam is often somewhere Orbit cannot work out from the
/// machine, and the answer to that is to be told rather than to guess harder.
#[tauri::command]
async fn steam_library(extra_paths: Option<Vec<String>>) -> Result<Vec<steam::SteamGame>, String> {
    let extra = extra_paths.unwrap_or_default();
    tokio::task::spawn_blocking(move || steam::installed_games(&extra))
        .await
        .map_err(|e| format!("Could not read the Steam library: {e}"))?
}

/// Installed games described by one launcher's local manifests or Windows records.
///
/// This read-only scan runs only after a player selects a launcher, or when that
/// specific library is enabled for startup. It never contacts a launcher service.
#[tauri::command]
async fn launcher_games(
    launcher: Option<String>,
    path: Option<String>,
) -> Result<Vec<launchers::LauncherGame>, String> {
    tokio::task::spawn_blocking(move || {
        launchers::installed_games(launcher.as_deref(), path.as_deref())
    })
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

fn cloud_blocks_quit() -> bool {
    CLOUD_JOBS.load(Ordering::SeqCst) > 0 && !FORCE_QUIT.load(Ordering::SeqCst)
}

fn ask_to_wait(app: &tauri::AppHandle) {
    reveal_window(app);
    let _ = app.emit("cloud-transfer-close", ());
}

fn quit_now(app: &tauri::AppHandle) {
    overlay::close_panel(app, "Orbit is quitting");
    if let Some(orbit) = app.try_state::<Orbit>() {
        orbit.runner.close_for_app_exit();
    }
    #[cfg(target_os = "linux")]
    {
        finish_linux_quit(app);
    }
    #[cfg(not(target_os = "linux"))]
    {
        app.exit(0);
    }
}

/// Close anyway. The copy may be left unfinished.
#[tauri::command]
fn cloud_quit(app: tauri::AppHandle) {
    FORCE_QUIT.store(true, Ordering::SeqCst);
    quit_now(&app);
}

/// Save the settings to disk.
#[tauri::command]
fn save_settings(orbit: State<'_, Orbit>, settings: Settings) -> Result<(), String> {
    if let Ok(mut policy) = orbit.policy.lock() {
        *policy = policy_from_settings(Some(&settings));
        remember_minimize_policy(&policy);
    }
    remember_wine(Some(&settings));
    let music = settings
        .get("sound")
        .and_then(|sound| sound.get("file"))
        .and_then(|file| file.as_str())
        .map(str::trim)
        .filter(|file| !file.is_empty())
        .map(str::to_string);
    transfer::forget_unused_music(orbit.store.root(), music.as_deref());
    overlay::apply_settings(&settings);
    orbit.store.save_settings(&settings)
}

fn remember_wine(_settings: Option<&Settings>) {
    // The settings field is gone. A path saved from it must not override the
    // lookup, because there is no longer a place to clear it.
    launch_target::set_wine_fallback("");
}

/// Where Orbit keeps its files, so the settings screen can show it.
#[tauri::command]
fn data_dir(orbit: State<'_, Orbit>) -> String {
    orbit.store.root().to_string_lossy().to_string()
}

/// Whether this copy carries its own files, beside the program.
#[tauri::command]
fn data_portable(app: tauri::AppHandle) -> bool {
    storage::portable(&app)
}

/// The Proton builds already on this machine, plus the ones Orbit fetched.
#[tauri::command]
fn proton_builds(app: tauri::AppHandle) -> Vec<proton::ProtonBuild> {
    proton::installed(&app)
}

/// The newest Proton-GE releases GitHub has, for the picker.
#[tauri::command]
async fn proton_ge_releases(app: tauri::AppHandle) -> Result<Vec<proton::GeRelease>, String> {
    proton::ge_releases(&app).await
}

/// Fetch one Proton-GE release into Orbit's own runners folder.
#[tauri::command]
async fn proton_install(app: tauri::AppHandle, tag: String, url: String) -> Result<String, String> {
    proton::install_ge(&app, tag, url).await
}

/// Take back a build Orbit downloaded. A Steam build is not Orbit's to remove.
#[tauri::command]
fn proton_remove(app: tauri::AppHandle, path: String) -> Result<(), String> {
    proton::remove_build(&app, &path)
}

/// The capture shortcuts the system refused, so Settings can say which.
#[tauri::command]
fn overlay_refused_shortcuts() -> Vec<String> {
    overlay::refused_keys()
}

/// How far this machine's clock is from UTC, in minutes, as the page reads it.
///
/// The page says once at startup. A capture taken by a shortcut is named on the
/// desktop side - a game in front means the library window is minimised, and a
/// minimised web view must not be what a screenshot waits for - so the local
/// time has to reach this side some other way.
#[tauri::command]
fn clock_offset(minutes: i32) {
    overlay::set_clock_offset(minutes);
}

/// Play the background pad through the system. False means the web view should try.
#[tauri::command]
fn ambient_set(enabled: bool, volume: f32, audible: bool) -> Result<bool, String> {
    // Windows and macOS already play through the web view. Feeding a second
    // player there would be two copies of the same pad.
    #[cfg(target_os = "linux")]
    {
        ambient::set(enabled, volume, audible)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (enabled, volume, audible);
        Ok(false)
    }
}

/// Stop the system player. The exit path calls this too, so a quit cannot
/// leave `pw-cat` running after the window has gone.
#[tauri::command]
fn ambient_stop() {
    ambient::stop();
}

/// Play a file the player picked. False means the web view should try.
#[tauri::command]
fn ambient_file(path: String, volume: f32, audible: bool) -> Result<bool, String> {
    ambient::play_file(&path, volume, audible)
}

/// What is in a copy, before anything is changed.
#[tauri::command]
fn preview_copy(path: String) -> Result<transfer::CopyPreview, String> {
    transfer::preview(&path)
}

/// Write a copy. Settings always, including signed-in clouds. Journal and
/// sessions only when asked.
#[tauri::command]
fn export_copy(
    orbit: State<'_, Orbit>,
    path: String,
    settings: Settings,
    journal: bool,
    sessions: bool,
) -> Result<transfer::ExportInfo, String> {
    transfer::export_file(&orbit.db, orbit.store.root(), &path, settings, journal, sessions)
}

/// Bring a copy in. Settings are applied by the caller after a confirm, so
/// this command never replaces them on its own. Cloud sign-in is written only
/// when the caller is bringing settings in, so the list and the login stay together.
#[tauri::command]
fn import_copy(
    orbit: State<'_, Orbit>,
    path: String,
    journal: bool,
    sessions: bool,
    clouds: bool,
) -> Result<transfer::CopyResult, String> {
    transfer::import_file(&orbit.db, orbit.store.root(), &path, journal, sessions, clouds)
}

/// Copy a picked music file into Orbit's own folder and return that path.
#[tauri::command]
fn remember_music(orbit: State<'_, Orbit>, source: String) -> Result<String, String> {
    transfer::remember_music(orbit.store.root(), &source)
}

#[tauri::command]
fn saves_status(orbit: State<'_, Orbit>, backup_root: Option<String>) -> saves::SaveStatus {
    saves::status(orbit.store.root(), backup_root.as_deref())
}

#[tauri::command]
async fn cloud_status(orbit: State<'_, Orbit>) -> Result<cloud::CloudStatus, String> {
    // An async command that borrows app state has to return a Result, or the
    // desktop build stops before it starts. The path is copied first so that
    // borrow is not held while the version check waits on the network.
    let root = orbit.store.root().to_path_buf();
    Ok(cloud::status(&root).await)
}

/// Download rclone into Orbit's folder. Nothing is installed on the system.
#[tauri::command]
async fn cloud_fetch(orbit: State<'_, Orbit>, replace: Option<bool>) -> Result<String, String> {
    cloud::fetch(orbit.store.root(), replace.unwrap_or(false)).await
}

/// Stop a sign-in that is still waiting. Closing the browser tab does this too.
#[tauri::command]
fn cloud_cancel() {
    cloud::cancel_sign_in();
}

#[tauri::command]
async fn cloud_connect(
    app: tauri::AppHandle,
    orbit: State<'_, Orbit>,
    provider: String,
    host: String,
    user: String,
    password: String,
    url: String,
    extra: Option<bool>,
    folder: Option<String>,
    name: Option<String>,
    code: Option<String>,
    mailbox: Option<String>,
) -> Result<String, String> {
    let data = orbit.store.root().to_path_buf();
    let remote_name = name.filter(|item| !item.is_empty()).unwrap_or_else(|| {
        if extra.unwrap_or(false) { "orbit-next".into() } else { "orbit".into() }
    });
    let folder = folder.unwrap_or_else(|| "Orbit".into());
    let code = code.unwrap_or_default();
    let mailbox = mailbox.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        // Said before the permission prompt, so the window explains it.
        #[cfg(windows)]
        if cloud::auth_port_needs_help() {
            let _ = app.emit("cloud-auth", serde_json::json!({ "freeing": true }));
        }
        cloud::connect(
            &data,
            &provider,
            &host,
            &user,
            &password,
            &url,
            &remote_name,
            &folder,
            &code,
            &mailbox,
            &|link| {
                // One opener, and it is the normal browser: a tab, not a separate
                // window. A second open spends the sign-in and asks for it again.
                let opened = if cloud::may_open_sign_in(link) {
                    cloud::remember_sign_in_page();
                    app.opener().open_url(link, None::<&str>).is_ok()
                } else {
                    false
                };
                let _ = app.emit("cloud-auth", serde_json::json!({ "url": link, "opened": opened }));
            },
            &|text| {
                if text == "signed-in" {
                    let _ = app.emit("cloud-auth", serde_json::json!({ "signedIn": true }));
                } else if text == "closed" {
                    let _ = app.emit("cloud-auth", serde_json::json!({ "closed": true }));
                } else {
                    let _ = app.emit("cloud-auth", serde_json::json!({ "note": text }));
                }
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cloud_remotes(orbit: State<'_, Orbit>) -> Result<Vec<String>, String> {
    cloud::remotes(orbit.store.root())
}

#[tauri::command]
async fn cloud_attach(orbit: State<'_, Orbit>, remote: String, folder: Option<String>) -> Result<(), String> {
    let data = orbit.store.root().to_path_buf();
    let folder = folder.unwrap_or_else(|| "Orbit".into());
    tokio::task::spawn_blocking(move || cloud::attach(&data, &remote, &folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cloud_copy(
    app: tauri::AppHandle,
    orbit: State<'_, Orbit>,
    up: bool,
    remote: String,
    own: bool,
    backup_root: Option<String>,
    folder: Option<String>,
    only: Option<Vec<cloud::CloudGame>>,
) -> Result<String, String> {
    let data = orbit.store.root().to_path_buf();
    let heading = if up { "Sending to the cloud" } else { "Restoring from the cloud" };
    tokio::task::spawn_blocking(move || {
        let _job = CloudJob::start();
        watch_cloud(&app, up, heading);
        cloud::copy(
            &data,
            backup_root.as_deref(),
            &remote,
            own,
            up,
            folder.as_deref(),
            only.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Move the copies to another path on the same cloud.
#[tauri::command]
async fn cloud_move(
    app: tauri::AppHandle,
    orbit: State<'_, Orbit>,
    remote: String,
    own: bool,
    from: String,
    to: String,
) -> Result<String, String> {
    let data = orbit.store.root().to_path_buf();
    tokio::task::spawn_blocking(move || {
        let _job = CloudJob::start();
        watch_cloud(&app, true, "Moving on the cloud");
        cloud::move_folder(&data, &remote, own, &from, &to)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy the cloud folder onto another remote. Neither sign-in is replaced.
#[tauri::command]
async fn cloud_transfer(
    app: tauri::AppHandle,
    orbit: State<'_, Orbit>,
    from_remote: String,
    from_own: bool,
    to_remote: String,
    to_own: bool,
    folder: Option<String>,
) -> Result<String, String> {
    let data = orbit.store.root().to_path_buf();
    tokio::task::spawn_blocking(move || {
        let _job = CloudJob::start();
        watch_cloud(&app, true, "Copying between clouds");
        cloud::transfer(
            &data,
            &from_remote,
            from_own,
            &to_remote,
            to_own,
            folder.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Use the waiting second cloud, and drop the one that was in use.
#[tauri::command]
fn cloud_adopt(orbit: State<'_, Orbit>) -> Result<String, String> {
    cloud::adopt(orbit.store.root())
}

/// Drop a second sign-in that was only used to copy across.
#[tauri::command]
fn cloud_drop_next(orbit: State<'_, Orbit>) -> Result<(), String> {
    cloud::drop_next(orbit.store.root())
}

/// The service's own web page, or nothing for a server.
#[tauri::command]
fn cloud_page(orbit: State<'_, Orbit>, remote: String, own: bool, provider: String) -> Option<String> {
    cloud::page(orbit.store.root(), &remote, own, &provider)
}

/// A second sign-in waiting to be used, or nothing.
#[tauri::command]
fn cloud_pending(orbit: State<'_, Orbit>) -> Option<String> {
    cloud::pending(orbit.store.root())
}

#[tauri::command]
fn cloud_forget(orbit: State<'_, Orbit>, remote: Option<String>) -> Result<(), String> {
    match remote.filter(|name| !name.is_empty()) {
        Some(name) => cloud::forget_one(orbit.store.root(), &name),
        None => cloud::forget(orbit.store.root()),
    }
}

#[tauri::command]
fn saves_backup(
    orbit: State<'_, Orbit>,
    game_id: String,
    title: String,
    save_dir: Option<String>,
    install_dir: Option<String>,
    prefix: Option<String>,
    steam_app_id: Option<u32>,
    publisher: Option<String>,
    backup_root: Option<String>,
) -> Result<saves::SaveBackup, String> {
    saves::backup(
        orbit.store.root(),
        &game_id,
        &title,
        save_dir.as_deref(),
        &save_hints(install_dir.as_deref(), prefix.as_deref(), steam_app_id),
        publisher.as_deref(),
        backup_root.as_deref(),
    )
}

#[tauri::command]
fn saves_restore(
    orbit: State<'_, Orbit>,
    game_id: String,
    title: String,
    save_dir: Option<String>,
    install_dir: Option<String>,
    prefix: Option<String>,
    steam_app_id: Option<u32>,
    publisher: Option<String>,
    backup_root: Option<String>,
) -> Result<String, String> {
    saves::restore(
        orbit.store.root(),
        &game_id,
        &title,
        save_dir.as_deref(),
        &save_hints(install_dir.as_deref(), prefix.as_deref(), steam_app_id),
        publisher.as_deref(),
        backup_root.as_deref(),
    )
}

fn save_hints<'a>(
    install_dir: Option<&'a str>,
    prefix: Option<&'a str>,
    steam_app_id: Option<u32>,
) -> saves::Hints<'a> {
    saves::Hints {
        install_dir,
        prefix,
        steam_app_id,
    }
}

/// Look for the save folder. Nothing extra is installed to do this.
#[tauri::command]
fn saves_find(
    title: String,
    install_dir: Option<String>,
    prefix: Option<String>,
    steam_app_id: Option<u32>,
) -> Option<String> {
    saves::detect(
        &title,
        &save_hints(install_dir.as_deref(), prefix.as_deref(), steam_app_id),
    )
    .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn saves_list(
    orbit: State<'_, Orbit>,
    game_id: String,
    title: String,
    publisher: Option<String>,
    backup_root: Option<String>,
) -> Vec<saves::SaveBackup> {
    saves::list(
        orbit.store.root(),
        &game_id,
        &title,
        publisher.as_deref(),
        backup_root.as_deref(),
    )
}

/// Ask PCGamingWiki where a game usually keeps its saves. The API needs no key.
#[tauri::command]
async fn saves_suggest(title: String) -> Result<Vec<String>, String> {
    let page = saves::wiki_title(&title);
    if page.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!(
        "https://www.pcgamingwiki.com/w/api.php?action=parse&page={page}&prop=wikitext&format=json&redirects=1"
    );
    let client = reqwest::Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION"), " (save path lookup)"))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let value = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not reach PCGamingWiki: {e}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("PCGamingWiki did not answer in a form Orbit can read: {e}"))?;
    if value.get("error").is_some() {
        return Ok(Vec::new());
    }
    let wikitext = value
        .pointer("/parse/wikitext/*")
        .and_then(|text| text.as_str())
        .unwrap_or("");
    Ok(saves::paths_from_wikitext(wikitext))
}

/// How much space Orbit's own files take.
#[tauri::command]
async fn data_dir_size(orbit: State<'_, Orbit>) -> Result<u64, String> {
    let root = orbit.store.root().to_path_buf();
    tokio::task::spawn_blocking(move || storage::dir_size(&root))
        .await
        .map_err(|e| format!("Could not measure the data folder: {e}"))
}

/// Open a folder with one file in it selected, so a path in the UI is one click
/// from the files.
///
/// Windows and macOS both have a "show me this one file" verb. Linux has only
/// "open this folder", so the folder is what opens; on Orbit's own data folder
/// that is the same thing, since the folder was the path all along. This used to
/// run `explorer` on every platform, which on Linux is a program that does not
/// exist, and the button simply did nothing.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("{path} is not there any more."));
    }

    #[cfg(windows)]
    let spawned = process::command("explorer").arg("/select,").arg(&target).spawn();

    #[cfg(target_os = "macos")]
    let spawned = process::command("open").arg("-R").arg(&target).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = {
        // No select verb to reach for. A folder opens as itself; a file opens
        // the folder it is in, which is the closest thing to being selected.
        let folder = if target.is_dir() {
            target.clone()
        } else {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.clone())
        };
        process::command("xdg-open").arg(folder).spawn()
    };

    spawned
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

/// Open a game's install folder itself in the system file manager.
#[tauri::command]
fn open_game_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Err(format!("{path} is not there any more."));
    }

    #[cfg(windows)]
    let result = process::command("explorer").arg(&target).spawn();
    #[cfg(target_os = "macos")]
    let result = process::command("open").arg(&target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = process::command("xdg-open").arg(&target).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Could not open the game folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before GTK starts. GTK 3 copies the program name into the Wayland app id,
    // and KWin draws the orange W when that id matches no desktop file.
    #[cfg(target_os = "linux")]
    linux_window::prepare();

    // Before anything WebKit touches, too. On Wayland with the proprietary
    // NVIDIA driver, the compositor's explicit-sync path can strand a surface
    // after its first frames - a window that flashes up and then never paints
    // again. This is the stack's standard answer (and can only lose its job
    // to a value the user set themselves).
    #[cfg(target_os = "linux")]
    if linux_window::wayland_backend()
        && linux_window::nvidia_driver()
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
    {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Orbit")
                .args(["--autostart"])
                .build(),
        )
        .setup(move |app| {
            // Portable copies keep everything beside the program; an install
            // keeps it where the desktop puts an application's data.
            let root = storage::root(app.handle());
            // Read the note the last run may have left behind: it says whether
            // the panel went away while it was reading live stats.
            stats::install(&root);
            let store = Store::new(root);
            let db = Arc::new(
                db::Db::open(&store.root().join("orbit.db")).map_err(std::io::Error::other)?,
            );
            let saved_settings = store.load_settings();
            if let Some(settings) = saved_settings.as_ref() {
                overlay::apply_settings(settings);
            }
            let music = saved_settings.as_ref().and_then(|settings| {
                settings
                    .get("sound")
                    .and_then(|sound| sound.get("file"))
                    .and_then(|file| file.as_str())
                    .map(str::trim)
                    .filter(|file| !file.is_empty())
                    .map(str::to_string)
            });
            transfer::forget_unused_music(store.root(), music.as_deref());
            let policy = Arc::new(Mutex::new(policy_from_settings(saved_settings.as_ref())));
            remember_wine(saved_settings.as_ref());
            let start_in_background = started_by_autostart
                && saved_settings.as_ref().is_some_and(|settings| {
                    settings.get("launchOnStartup").and_then(serde_json::Value::as_bool) == Some(true)
                        && settings
                            .get("launchOnStartupBackground")
                            .and_then(serde_json::Value::as_bool)
                            == Some(true)
                });

            // Keep the right-click action in sync with the saved preference and
            // this install's path. Old settings did not have the field, so the
            // first launch opts in by default as the UI does.
            #[cfg(any(windows, target_os = "linux"))]
            {
                let enabled = saved_settings
                    .as_ref()
                    .and_then(|settings| settings.get("openExeInOrbit"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true);
                #[cfg(windows)]
                let result = explorer::set_context_menu(enabled);
                #[cfg(target_os = "linux")]
                let result = files_menu::set_context_menu(enabled);
                if let Err(error) = result {
                    log::warn!("could not update the Open in Orbit menu: {error}");
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
                    // Start from what the last run found, if it is still recent
                    // enough to believe. A week is long enough for a library to
                    // have moved on and short enough that the numbers are not
                    // fiction; anything older is walked again from scratch.
                    const FRESH_FOR: u64 = 7 * 24 * 60 * 60;
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    if let Some((measured_at, known)) = store.load_sizes() {
                        if now.saturating_sub(measured_at) < FRESH_FOR {
                            cache.seed(known);
                        }
                    }

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
                    if let Err(error) = store.save_sizes(now, &cache.snapshot()) {
                        log::warn!("could not remember the folder sizes: {error}");
                    }
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
                    // Linux often takes long enough to draw that a six-second
                    // wait finishes the opening before the window is even up.
                    let wait = if cfg!(target_os = "linux") {
                        std::time::Duration::from_millis(800)
                    } else {
                        std::time::Duration::from_secs(6)
                    };
                    std::thread::sleep(wait);
                    if !start_in_background || show_requested.load(Ordering::SeqCst) {
                        show_main_window(&handle);
                    }
                });
            }

            app.manage(Orbit { db, runner, store, sizes, policy: Arc::clone(&policy) });

            if let Ok(current) = policy.lock() {
                remember_minimize_policy(&current);
            }
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                linux_window::install(&window);
                // The titlebar button is not always built on the first visit.
                // Retry on the GTK thread until it is, then stop.
                let handle = app.handle().clone();
                let tries = std::rc::Rc::new(std::cell::Cell::new(0u8));
                glib::timeout_add_local(std::time::Duration::from_millis(300), move || {
                    if quitting() || linux_window::closing() {
                        return glib::ControlFlow::Break;
                    }
                    let n = tries.get();
                    tries.set(n.saturating_add(1));
                    if let Some(window) = handle.get_webview_window("main") {
                        linux_window::install(&window);
                    }
                    if linux_window::ready() || n > 40 {
                        glib::ControlFlow::Break
                    } else {
                        glib::ControlFlow::Continue
                    }
                });
            }
            gamepad::start(app.handle().clone());

            // The close button. Hiding is only done when the player asked for
            // the tray and the icon is actually there; otherwise the window
            // closes and the exit path below finishes the process.
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                let policy = Arc::clone(&policy);
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            let hide = policy
                                .lock()
                                .map(|current| current.on_app_close == "tray")
                                .unwrap_or(false)
                                && TRAY_READY.load(Ordering::SeqCst);
                            // Hiding to the tray keeps the process, so a copy can finish.
                            // Quitting does not. Ask before a quit that would cut one off.
                            if !hide && cloud_blocks_quit() {
                                api.prevent_close();
                                ask_to_wait(&handle);
                                return;
                            }
                            // The overlay is its own window. Closing Orbit has to close it too,
                            // or the panel stays up and keeps working on its own.
                            overlay::close_panel(&handle, "Orbit's window was closed");
                            if hide {
                                api.prevent_close();
                                if let Some(window) = handle.get_webview_window("main") {
                                    withdraw_to_tray(&window);
                                }
                            } else {
                                // Leave before GTK destroys the view. On Linux that
                                // destroy is what the desktop reports as a crash.
                                #[cfg(target_os = "linux")]
                                {
                                    api.prevent_close();
                                    finish_linux_quit(&handle);
                                }
                            }
                        }
                        // Some compositors report a minimise as a zero size
                        // instead of an iconified state. Same destination.
                        #[cfg(target_os = "linux")]
                        tauri::WindowEvent::Resized(size)
                            if size.width == 0 && size.height == 0 && !linux_window::is_parked() =>
                        {
                            // A zero-size report is a minimise on some compositors.
                            // Leave it on the taskbar. The close button is what
                            // can hide to the tray.
                            let _ = size;
                        }
                        _ => {}
                    }
                });
            }

            if let Err(error) = overlay::install(app.handle()) {
                log::warn!("overlay was not ready: {error}");
            }
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
            clear_playthrough_logs,
            list_current_playthroughs,
            add_game_log,
            update_game_log,
            delete_game_log,
            list_playthroughs,
            add_playthrough,
            rename_playthrough,
            delete_playthrough,
            set_current_playthrough,
            write_playthrough_notes,
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
            is_linux,
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
            game_facts,
            achievements_fetch,
            artwork_candidates,
            artwork_choices,
            reorder_game_logs,
            steam_library,
            launcher_games,
            folder_programs,
            load_settings,
            save_settings,
            cloud_quit,
            data_dir,
            data_portable,
            clock_offset,
            overlay_refused_shortcuts,
            proton_builds,
            proton_ge_releases,
            proton_install,
            proton_remove,
            data_dir_size,
            ambient_set,
            ambient_stop,
            ambient_file,
            preview_copy,
            export_copy,
            import_copy,
            remember_music,
            gamepad_poll,
            saves_status,
            cloud_status,
            cloud_fetch,
            cloud_connect,
            cloud_cancel,
            cloud_remotes,
            cloud_attach,
            cloud_copy,
            cloud_move,
            cloud_transfer,
            cloud_adopt,
            cloud_drop_next,
            cloud_page,
            cloud_pending,
            cloud_forget,
            saves_backup,
            saves_restore,
            saves_list,
            saves_find,
            saves_suggest,
            reveal_in_explorer,
            open_game_folder,
            overlay_configure,
            overlay_mode,
            overlay_pins,
            overlay_hits,
            overlay_hold,
            overlay_show_pins,
            media_now,
            media_control,
            audio_apps,
            audio_set,
            audio_devices,
            audio_use_device,
            audio_set_named,
            machine_stats,
            live_stats_suspect,
            append_playthrough_notes,
            overlay_open_settings,
            overlay_playing,
            overlay_ready_notice,
            overlay_status,
            overlay_alive,
            overlay_theme,
            overlay_shot,
            overlay_record,
            overlay_replay,
            overlay_hide,
            overlay_folder,
            overlay_capture_dirs,
            overlay_open_kind,
            overlay_open,
            overlay_delete,
            overlay_copy,
            overlay_gallery,
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
                // A system player started for the pad has to die with the app.
                // process::exit below does not run destructors, and on Linux it
                // also runs the handlers that abort. The page is killed first.
                ambient::stop();
                overlay::close_panel(app, "Orbit is quitting");
                overlay::shutdown();
                // WebKitGTK's page process aborts in its own exit, which the
                // desktop shows as a crash. Kill that process, then end this
                // one without those handlers if the window path did not already.
                // The swap keeps a second exit event from starting a second watchdog.
                let first = !QUITTING.swap(true, Ordering::SeqCst);
                if first && matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                    #[cfg(target_os = "linux")]
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            linux_window::end_page(&window);
                        }
                        std::thread::spawn(|| {
                            std::thread::sleep(std::time::Duration::from_millis(200));
                            unsafe { libc::_exit(0) };
                        });
                    }
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
