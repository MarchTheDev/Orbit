//! Orbit's native side.
//!
//! The React front end talks to Windows through the commands in this file:
//! starting games, noticing when they stop, moving a game between drives,
//! reading folders, and fetching metadata the browser is not allowed to reach.

mod db;
mod format;
mod hltb;
mod launch;
mod launch_target;
mod metadata;
mod session;
mod storage;
mod store;

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use db::{GameLogRow, GameRow, GameWrite, SessionRow, Stats};
use launch::FoundGame;
use launch_target::LaunchTarget;
use session::{ActiveView, Runner};
use storage::{DriveInfo, Moved};
use store::{Settings, Store};

/// Everything the commands need, kept in one place by Tauri.
pub struct Orbit {
    db: Arc<db::Db>,
    runner: Runner,
    store: Store,
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
            LaunchTarget::Emulator { .. } => "emulator",
        }
        .to_string(),
        label: target.label(),
        starts_something: target.starts_something(),
        path: target
            .primary_path()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

/// Pull an app id out of a pasted Steam store link, or return `None`.
#[tauri::command]
fn parse_steam_id(text: String) -> Option<u32> {
    launch_target::parse_steam_id(&text)
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

/// Write a note against a game.
#[tauri::command]
fn add_game_log(
    orbit: State<'_, Orbit>,
    game_id: String,
    at: i64,
    secs: i64,
    note: String,
) -> Result<GameLogRow, String> {
    orbit.db.add_game_log(&game_id, at, secs, &note)
}

/// Correct a note that is already written.
#[tauri::command]
fn update_game_log(
    orbit: State<'_, Orbit>,
    id: i64,
    at: i64,
    secs: i64,
    note: String,
) -> Result<(), String> {
    orbit.db.update_game_log(id, at, secs, &note)
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
#[tauri::command]
async fn folder_size(path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || storage::dir_size(Path::new(&path)))
        .await
        .map_err(|e| format!("Could not measure that folder: {e}"))
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
/// Used for IGDB, which has no CORS headers, and anything else that needs a
/// header the page cannot set.
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
/// The Steam store needs no key, which is the path every game takes by default.
/// IGDB is richer and used instead when the player has saved a Twitch app; the
/// token behind it is minted and refreshed here, so nothing expires on them.
#[tauri::command]
async fn metadata_lookup(
    title: String,
    igdb_client_id: Option<String>,
    igdb_client_secret: Option<String>,
) -> Result<metadata::Meta, String> {
    let igdb = match (igdb_client_id, igdb_client_secret) {
        (Some(id), Some(secret))
            if !id.trim().is_empty() && !secret.trim().is_empty() =>
        {
            Some((id, secret))
        }
        _ => None,
    };
    metadata::lookup(&title, igdb).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        // The folder and file pickers behind every Browse button.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("Orbit"));
            let store = Store::new(root);
            let db = Arc::new(
                db::Db::open(&store.root().join("orbit.db")).map_err(std::io::Error::other)?,
            );
            let runner = Runner::new(Arc::clone(&db));
            let _ = APP.set(app.handle().clone());
            app.manage(Orbit { db, runner, store });
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
            add_game_log,
            update_game_log,
            delete_game_log,
            launch_info,
            parse_steam_id,
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
            list_drives,
            folder_size,
            scan_folder,
            move_game,
            disk_space,
            drive_of,
            http_request,
            hltb_search,
            metadata_lookup,
            metadata_suggest,
            load_settings,
            save_settings,
            data_dir,
            data_dir_size,
            reveal_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while building Orbit");
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
    fn drives_come_back_with_a_readable_size() {
        let drives = storage::list_drives();
        assert!(!drives.is_empty(), "this machine has at least one drive");
        assert!(drives.iter().all(|d| d.drive.ends_with(':')));
        assert!(
            drives.iter().any(|d| d.total > 0),
            "at least one drive reports its size"
        );
    }
}
