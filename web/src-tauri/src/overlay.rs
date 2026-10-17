//! A fullscreen panel over a game: a picture, a recording, or the last few seconds.
//!
//! Alt+X is a global shortcut. Start+Select is read here too, because a Windows
//! game in front does not deliver the browser pad, and asking that pad can
//! freeze the window. The handler for Alt+X only sets a flag. Creating the
//! panel from inside that handler can stall the shortcut lock.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "linux")]
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::capture;
use crate::process;

const WINDOW: &str = "overlay";

static OPEN: AtomicBool = AtomicBool::new(false);
static ASKED: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static WATCHING: AtomicBool = AtomicBool::new(false);

struct Live {
    enabled: bool,
    replay: bool,
    seconds: u32,
    quality: String,
    fps: u32,
    ffmpeg: String,
    root: PathBuf,
    game: String,
    playing: bool,
    recording: Option<Child>,
    buffer: Option<Child>,
    native_recording: Option<capture::Hold>,
    native_buffer: Option<capture::Hold>,
    replay_frames: Option<capture::Buffer>,
    pipe_stop: Option<Arc<AtomicBool>>,
    recording_name: String,
    recording_path: PathBuf,
    note: String,
}

struct Watch {
    both: bool,
    page_left: bool,
    page_right: bool,
    a: bool,
    b: bool,
    held: Option<&'static str>,
    ticks: u8,
}

struct Step {
    toggle: bool,
    action: Option<&'static str>,
}

static LIVE: Mutex<Live> = Mutex::new(Live {
    enabled: true,
    replay: true,
    seconds: 30,
    quality: String::new(),
    fps: 30,
    ffmpeg: String::new(),
    root: PathBuf::new(),
    game: String::new(),
    playing: false,
    recording: None,
    buffer: None,
    native_recording: None,
    native_buffer: None,
    replay_frames: None,
    pipe_stop: None,
    recording_name: String::new(),
    recording_path: PathBuf::new(),
    note: String::new(),
});
static GATE: Mutex<()> = Mutex::new(());
static PAD: Mutex<Watch> = Mutex::new(Watch {
    both: false,
    page_left: false,
    page_right: false,
    a: false,
    b: false,
    held: None,
    ticks: 0,
});

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayStatus {
    pub enabled: bool,
    pub recording: bool,
    pub replay: bool,
    pub playing: bool,
    pub ffmpeg: bool,
    pub seconds: u32,
    pub quality: String,
    pub fps: u32,
    pub game: String,
    pub folder: String,
    pub note: String,
}

fn lock() -> std::sync::MutexGuard<'static, Live> {
    LIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn gate() -> std::sync::MutexGuard<'static, ()> {
    GATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn is_open() -> bool {
    OPEN.load(Ordering::SeqCst)
}

/// Alt+X and Start+Select both end here. The window work happens later, off
/// the shortcut handler, so that handler can return while its lock is still held.
pub fn request_toggle() {
    ASKED.store(true, Ordering::SeqCst);
}

pub fn apply_settings(value: &Value) {
    let overlay = value.get("overlay");
    let enabled = overlay
        .and_then(|item| item.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let replay = overlay
        .and_then(|item| item.get("replay"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let seconds = overlay
        .and_then(|item| item.get("seconds"))
        .and_then(Value::as_u64)
        .unwrap_or(30) as u32;
    let quality = overlay
        .and_then(|item| item.get("quality"))
        .and_then(Value::as_str)
        .unwrap_or("1080p");
    let fps = overlay.and_then(|item| item.get("fps")).and_then(Value::as_u64).unwrap_or(30) as u32;
    let ffmpeg = overlay
        .and_then(|item| item.get("ffmpeg"))
        .and_then(Value::as_str)
        .unwrap_or("");
    configure(None, enabled, replay, seconds, quality, fps, ffmpeg);
}

pub fn configure(
    app: Option<&AppHandle>,
    enabled: bool,
    replay: bool,
    seconds: u32,
    quality: &str,
    fps: u32,
    ffmpeg: &str,
) {
    let seconds = clamp_seconds(seconds);
    let quality = quality_name(quality);
    let fps = picture_fps(fps);
    let (changed, stop, restart, hide) = {
        let mut live = lock();
        let recording = live.recording.is_some() || live.native_recording.is_some();
        let changed = live.enabled != enabled
            || live.replay != replay
            || live.seconds != seconds
            || live.quality != quality
            || live.fps != fps
            || live.ffmpeg != ffmpeg;
        let hide = live.enabled && !enabled;
        live.enabled = enabled;
        live.replay = replay;
        live.seconds = seconds;
        live.quality = quality;
        live.fps = fps;
        live.ffmpeg = ffmpeg.to_string();
        let stop = live.playing && (!replay || !enabled);
        let restart = changed && live.playing && replay && enabled && !recording;
        (changed, stop, restart, hide)
    };
    if !changed && app.is_none() {
        return;
    }
    if stop {
        stop_buffer();
    } else if restart {
        // The length changed, so the running buffer has to start again.
        stop_buffer();
        let _ = start_buffer(true);
    }
    if hide {
        if let Some(app) = app {
            hide_window(app);
        }
    }
}

pub fn game_started(title: &str) {
    let restart = {
        let mut live = lock();
        let same = live.playing
            && live.game == safe_name(title)
            && (live.buffer.is_some() || live.native_buffer.is_some());
        live.game = safe_name(title);
        live.playing = true;
        !same
    };
    if restart {
        let root = lock().root.clone();
        if !root.as_os_str().is_empty() {
            capture::sweep_replay_files(&root);
        }
        if let Err(error) = start_buffer(true) {
            if !error.is_empty() {
                lock().note = error;
            }
        }
    }
}

pub fn game_stopped() {
    {
        let mut live = lock();
        live.playing = false;
    }
    stop_buffer();
}

pub fn shutdown() {
    STOP.store(true, Ordering::SeqCst);
    let recording = {
        let mut live = lock();
        let recording = live.recording.take();
        let buffer = live.buffer.take();
        let native_recording = live.native_recording.take();
        let native_buffer = live.native_buffer.take();
        if let Some(stop) = live.pipe_stop.take() {
            stop.store(true, Ordering::SeqCst);
        }
        live.replay_frames = None;
        (recording, buffer, native_recording, native_buffer)
    };
    if let Some(child) = recording.0 {
        kill_now(child);
    }
    if let Some(child) = recording.1 {
        kill_now(child);
    }
    if let Some(hold) = recording.2 {
        let _ = capture::finish(hold);
    }
    if let Some(hold) = recording.3 {
        let _ = capture::finish(hold);
    }
}

/// Hide and destroy the overlay window. Hiding is not enough: a hidden window
/// is still a window, and that is what left the panel up after Orbit closed.
pub fn close_panel(app: &AppHandle) {
    OPEN.store(false, Ordering::SeqCst);
    capture::set_paused(false);
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
        if window.destroy().is_err() {
            let _ = window.close();
        }
    }
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    if let Ok(dir) = app.path().app_data_dir() {
        capture::sweep_replay_files(&dir);
        let mut live = lock();
        live.root = dir;
    }
    // The panel is built on the first Alt+X, not during startup. A second
    // webview here would compete with the boot animation.
    if WATCHING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let app = app.clone();
    thread::Builder::new()
        .name("orbit-overlay".to_string())
        .spawn(move || watch(app))
        .map_err(|error| format!("could not watch the overlay shortcut: {error}"))?;
    Ok(())
}

/// Start+Select, from the pad thread. Navigation is only sent while the panel is up.
pub fn on_pad(app: &AppHandle, buttons: &[bool], axes: &[f32]) {
    let step = {
        let mut watch = PAD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let step = take_step(&mut watch, buttons, axes);
        // A stick already held must not start stepping the moment the panel opens.
        if !is_open() {
            watch.ticks = 0;
        }
        step
    };
    if step.toggle {
        request_toggle();
        return;
    }
    let Some(action) = step.action else { return };
    if !is_open() {
        return;
    }
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.emit("overlay-pad", action);
    }
}

pub fn status() -> OverlayStatus {
    let live = lock();
    let folder = kind_dir_from(&live.root, "recordings");
    OverlayStatus {
        enabled: live.enabled,
        recording: live.recording.is_some() || live.native_recording.is_some(),
        replay: live.replay,
        playing: live.playing,
        ffmpeg: capture::available() || find_ffmpeg(&live.ffmpeg).is_some(),
        seconds: live.seconds,
        quality: if live.quality.is_empty() { "1080p".to_string() } else { live.quality.clone() },
        fps: live.fps.max(30),
        game: live.game.clone(),
        folder: folder.to_string_lossy().to_string(),
        note: {
            let capture_error = capture::last_error();
            if !capture_error.is_empty() { capture_error } else { live.note.clone() }
        },
    }
}

pub fn hide(app: &AppHandle) {
    hide_window(app);
}

pub fn open_folder() -> Result<String, String> {
    open_kind("recordings")
}

pub fn open_kind(kind: &str) -> Result<String, String> {
    let dir = kind_dir(kind_name(kind))?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the folder: {error}"))?;
    launch_path(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

pub fn open_item(path: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !allowed_capture(&path) {
        return Err("That file is not one of Orbit's captures.".to_string());
    }
    if !path.is_file() {
        return Err("That file is not there.".to_string());
    }
    launch_path(&path)
}

pub fn gallery() -> Vec<GalleryItem> {
    let root = lock().root.clone();
    if root.as_os_str().is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    collect_kind(&root.join("screenshots"), "screenshot", &mut found);
    collect_kind(&root.join("recordings"), "recording", &mut found);
    collect_kind(&root.join("replays"), "replay", &mut found);
    found.sort_by(|left, right| right.0.cmp(&left.0));
    found.into_iter().take(36).map(|(_, item)| item).collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItem {
    pub kind: String,
    pub name: String,
    pub game: String,
    pub path: String,
}

pub fn shot(app: &AppHandle, stamp: &str) -> Result<String, String> {
    let was_open = is_open();
    if was_open {
        hide_window(app);
        thread::sleep(Duration::from_millis(180));
    }
    let result = take_shot(stamp);
    if was_open {
        show_window(app);
    }
    remember(&result);
    result
}

pub fn record(app: &AppHandle, stamp: &str) -> Result<String, String> {
    let _held = gate();
    let running = lock().recording.is_some() || lock().native_recording.is_some();
    if running {
        let child = lock().recording.take();
        let native = lock().native_recording.take();
        drop(_held);
        if let Some(child) = child {
            stop_child(child);
        }
        let native_result = native.map(capture::finish);
        if should_buffer() {
            let _ = start_buffer(false);
        }
        if let Some(Err(error)) = native_result {
            remember(&Err(error.clone()));
            return Err(error);
        }
        let path = lock().recording_path.clone();
        if !path.as_os_str().is_empty() {
            if let Err(error) = require_video(&path) {
                remember(&Err(error.clone()));
                return Err(error);
            }
        }
        let name = {
            let live = lock();
            if live.recording_name.is_empty() {
                "the recording".to_string()
            } else {
                live.recording_name.clone()
            }
        };
        let message = format!("Saved the recording as {name}.");
        remember(&Ok(message.clone()));
        return Ok(message);
    }
    drop(_held);
    let was_open = is_open();
    if was_open {
        hide_window(app);
        thread::sleep(Duration::from_millis(180));
    }
    stop_buffer();
    let started = spawn_recording(stamp);
    if started.is_err() && was_open {
        show_window(app);
    }
    let message = started.map(|_| "Recording.".to_string());
    remember(&message);
    message
}

pub fn save_replay(app: &AppHandle, seconds: u32, stamp: &str) -> Result<String, String> {
    let seconds = clamp_seconds(seconds);
    if lock().recording.is_some() || lock().native_recording.is_some() {
        let message = "A recording is running. Stop it before saving the last few seconds.".to_string();
        remember(&Err(message.clone()));
        return Err(message);
    }
    let was_open = is_open();
    if was_open {
        hide_window(app);
        thread::sleep(Duration::from_millis(180));
    }
    // The frames stay in memory. Stopping the buffer first would discard them.
    let result = save_kept(seconds, stamp);
    if was_open {
        show_window(app);
    }
    remember(&result);
    result
}

fn remember(result: &Result<String, String>) {
    let mut live = lock();
    live.note = match result {
        Ok(text) => text.clone(),
        Err(text) => text.clone(),
    };
}

fn should_buffer() -> bool {
    let live = lock();
    live.playing && live.replay && live.enabled && live.recording.is_none() && live.native_recording.is_none()
}

fn watch(app: AppHandle) {
    let mut slot = 0u32;
    let mut connected = false;
    loop {
        if STOP.load(Ordering::SeqCst) {
            break;
        }
        if ASKED.swap(false, Ordering::SeqCst) {
            // The call borrows this thread's handle. The callback needs its own.
            let panel = app.clone();
            let _ = app.run_on_main_thread(move || toggle_on_main(&panel));
        }
        #[cfg(windows)]
        {
            if let Some((buttons, axes)) = read_xinput(&mut slot) {
                connected = true;
                on_pad(&app, &buttons, &axes);
            } else if connected {
                connected = false;
                on_pad(&app, &[false; 16], &[0.0; 4]);
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (&app, &mut slot, &mut connected);
        }
        thread::sleep(Duration::from_millis(40));
    }
}

fn toggle_on_main(app: &AppHandle) {
    if STOP.load(Ordering::SeqCst) {
        return;
    }
    if !lock().enabled {
        tell(app, "overlay-toast", "The overlay is off. Turn it on in Settings.");
        return;
    }
    let Some(window) = ensure_window(app) else {
        tell(app, "overlay-toast", "The overlay could not open.");
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        hide_window(app);
    } else {
        show_window(app);
    }
}

fn ensure_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if STOP.load(Ordering::SeqCst) {
        return None;
    }
    if let Some(window) = app.get_webview_window(WINDOW) {
        return Some(window);
    }
    let window = tauri::WebviewWindowBuilder::new(app, WINDOW, tauri::WebviewUrl::App("index.html".into()))
        .title("Orbit overlay")
        .inner_size(1280.0, 720.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .center()
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .initialization_script(
            "window.__ORBIT_OVERLAY__=true;var orbitOverlayStyle=document.createElement('style');orbitOverlayStyle.textContent='html,body,#root{background:transparent!important;height:100%}';(document.head||document.documentElement).appendChild(orbitOverlayStyle);",
        )
        .build()
        .map_err(|error| {
            log::warn!("overlay window was not created: {error}");
            error
        })
        .ok()?;
    cover_screen(&window);
    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        // Do not prevent this close. Holding the panel open is what left the
        // main window unable to quit, and a second window must not do that.
        if matches!(event, tauri::WindowEvent::Destroyed) {
            mark_hidden(&app_for_close);
        }
    });
    Some(window)
}

fn show_window(app: &AppHandle) {
    let Some(window) = ensure_window(app) else { return };
    // Pause before the panel is visible, so the replay does not keep the menu.
    capture::set_paused(true);
    cover_screen(&window);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    OPEN.store(true, Ordering::SeqCst);
    tell(app, "overlay-visible", "true");
    let _ = window.emit("overlay-shown", ());
}

fn cover_screen(window: &tauri::WebviewWindow) {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let pos = monitor.position();
    let size = monitor.size();
    let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
    let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
}

fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
    mark_hidden(app);
}

fn mark_hidden(app: &AppHandle) {
    OPEN.store(false, Ordering::SeqCst);
    capture::set_paused(false);
    tell(app, "overlay-visible", "false");
}

fn tell(app: &AppHandle, event: &str, payload: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, payload);
    }
}

fn take_shot(stamp: &str) -> Result<String, String> {
    let dir = game_dir("screenshots")?;
    if capture::available() {
        let path = clip_path(&dir, &lock().game, stamp, "jpg");
        if capture::save_picture(&path, current_spec()).is_ok() {
            return Ok(saved_name("Saved the picture as", &path));
        }
    }
    let path = clip_path(&dir, &lock().game, stamp, "png");
    #[cfg(windows)]
    if powershell_shot(&path).is_ok() {
        return Ok(saved_name("Saved the picture as", &path));
    }
    #[cfg(target_os = "linux")]
    if linux_shot(&path).is_ok() {
        return Ok(saved_name("Saved the picture as", &path));
    }
    if let Some(ffmpeg) = find_ffmpeg(&lock().ffmpeg) {
        if ffmpeg_shot(&ffmpeg, &path).is_ok() {
            return Ok(saved_name("Saved the picture as", &path));
        }
    }
    Err("Orbit could not take a picture of the screen.".to_string())
}

#[cfg(windows)]
fn powershell_shot(path: &Path) -> Result<(), String> {
    let script = std::env::temp_dir().join("orbit-shot.ps1");
    fs::write(
        &script,
        "param([string]$Out)\r\n\
Add-Type -AssemblyName System.Windows.Forms\r\n\
Add-Type -AssemblyName System.Drawing\r\n\
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen\r\n\
if ($bounds.Width -lt 1 -or $bounds.Height -lt 1) { throw 'The screen size could not be read.' }\r\n\
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height\r\n\
$g = [System.Drawing.Graphics]::FromImage($bmp)\r\n\
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)\r\n\
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)\r\n\
$g.Dispose(); $bmp.Dispose()\r\n",
    )
    .map_err(|error| error.to_string())?;
    let output = process::command("powershell")
        .arg("-NoProfile")
        .arg("-STA")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script)
        .arg("-Out")
        .arg(path)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() && path.is_file() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(target_os = "linux")]
fn linux_shot(path: &Path) -> Result<(), String> {
    let attempts: &[(&str, &[&str])] = &[
        ("grim", &[]),
        ("gnome-screenshot", &["-f"]),
        ("scrot", &[]),
    ];
    for (program, prefix) in attempts {
        let Some(bin) = which(program) else { continue };
        let mut command = process::command(bin);
        command.args(*prefix).arg(path);
        if command.status().map(|status| status.success()).unwrap_or(false) && path.is_file() {
            return Ok(());
        }
    }
    Err("no screenshot tool".to_string())
}

fn ffmpeg_shot(ffmpeg: &Path, path: &Path) -> Result<(), String> {
    let mut command = process::command(ffmpeg);
    command.arg("-y");
    push_grab(&mut command, None)?;
    if let Some(scale) = quality_scale(&lock().quality) {
        command.args(["-vf", scale]);
    }
    command.args(["-frames:v", "1"]).arg(path);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let status = command.status().map_err(|error| error.to_string())?;
    if status.success() && path.is_file() {
        Ok(())
    } else {
        Err("ffmpeg could not take the picture.".to_string())
    }
}

fn spawn_recording(stamp: &str) -> Result<(), String> {
    if capture::available() {
        match spawn_native_recording(stamp) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if find_ffmpeg(&lock().ffmpeg).is_none() {
                    return Err(if capture::can_encode() { error } else { ffmpeg_missing() });
                }
                lock().note = format!("Built-in capture could not start, so ffmpeg is being used. {error}");
            }
        }
    } else if find_ffmpeg(&lock().ffmpeg).is_none() {
        return Err(capture_missing());
    }
    spawn_ffmpeg_recording(stamp)
}

fn spawn_native_recording(stamp: &str) -> Result<(), String> {
    let dir = game_dir("recordings")?;
    let path = clip_path(&dir, &lock().game, stamp, "mp4");
    let spec = current_spec();
    let hold = capture::start_recording(path.clone(), spec)?;
    let name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "recording.mp4".to_string());
    let mut live = lock();
    live.recording_name = name;
    live.recording_path = path;
    live.native_recording = Some(hold);
    Ok(())
}

fn spawn_ffmpeg_recording(stamp: &str) -> Result<(), String> {
    let ffmpeg = find_ffmpeg(&lock().ffmpeg).ok_or_else(ffmpeg_missing)?;
    let dir = game_dir("recordings")?;
    let path = clip_path(&dir, &lock().game, stamp, "mp4");
    let mut command = process::command(&ffmpeg);
    command.arg("-y");
    push_grab(&mut command, Some(quality_fps(lock().fps)))?;
    let quality = lock().quality.clone();
    command.arg("-an");
    push_encode(&mut command, &quality);
    command.args(["-movflags", "+frag_keyframe+empty_moov+default_base_moof"]);
    command.arg(&path);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let child = command.spawn().map_err(|error| format!("Could not start ffmpeg: {error}"))?;
    thread::sleep(Duration::from_millis(250));
    let mut child = child;
    if let Ok(Some(_)) = child.try_wait() {
        let _ = fs::remove_file(&path);
        return Err("ffmpeg stopped before the recording started.".to_string());
    }
    let mut live = lock();
    live.recording_name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "recording.mp4".to_string());
    live.recording_path = path;
    live.recording = Some(child);
    Ok(())
}

fn start_buffer(_clear: bool) -> Result<(), String> {
    let _held = gate();
    {
        let live = lock();
        if live.buffer.is_some() || live.native_buffer.is_some() || live.recording.is_some() || live.native_recording.is_some() {
            return Ok(());
        }
        if !live.playing || !live.replay || !live.enabled {
            return Ok(());
        }
    }
    if capture::available() {
        match start_native_buffer() {
            Ok(()) => return Ok(()),
            Err(error) => {
                if find_ffmpeg(&lock().ffmpeg).is_none() {
                    return Err(error);
                }
            }
        }
    } else if find_ffmpeg(&lock().ffmpeg).is_none() {
        return Err(capture_missing());
    }
    start_pipe_buffer()
}

fn start_native_buffer() -> Result<(), String> {
    let keep = Duration::from_secs(buffer_seconds(lock().seconds) as u64 + 2);
    let hold = capture::start_buffer(keep, current_spec())?;
    lock().native_buffer = Some(hold);
    Ok(())
}

/// ffmpeg's pictures stay in memory. Nothing is written until the player saves.
fn start_pipe_buffer() -> Result<(), String> {
    let ffmpeg = match find_ffmpeg(&lock().ffmpeg) {
        Some(path) => path,
        None => return Ok(()),
    };
    let keep = Duration::from_secs(buffer_seconds(lock().seconds) as u64 + 2);
    let fps = lock().fps.max(1);
    let buffer = capture::Buffer::new(fps, keep);
    let mut command = process::command(&ffmpeg);
    command.arg("-y");
    push_grab(&mut command, Some(quality_fps(fps)))?;
    command.arg("-an");
    if let Some(scale) = quality_scale(&lock().quality) {
        command.args(["-vf", scale]);
    }
    command.args(["-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let Some(stdout) = child.stdout.take() else {
        kill_now(child);
        return Err("ffmpeg did not open a picture stream.".to_string());
    };
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let shared = buffer.clone();
    thread::Builder::new()
        .name("orbit-replay".to_string())
        .spawn(move || read_jpeg_pipe(stdout, shared, flag))
        .map_err(|error| error.to_string())?;
    let mut live = lock();
    live.buffer = Some(child);
    live.pipe_stop = Some(stop);
    live.replay_frames = Some(buffer);
    Ok(())
}

fn stop_buffer() {
    let _held = gate();
    if let Some(stop) = lock().pipe_stop.take() {
        stop.store(true, Ordering::SeqCst);
    }
    if let Some(child) = lock().buffer.take() {
        stop_child(child);
    }
    if let Some(hold) = lock().native_buffer.take() {
        let _ = capture::finish(hold);
    }
    lock().replay_frames = None;
}

fn save_kept(seconds: u32, stamp: &str) -> Result<String, String> {
    let kept = {
        let live = lock();
        if let Some(hold) = live.native_buffer.as_ref() {
            hold.snapshot(seconds)
        } else if let Some(buffer) = live.replay_frames.as_ref() {
            buffer.snapshot(seconds)
        } else {
            Err("Nothing has been kept yet. The replay starts when a game is playing.".to_string())
        }
    }?;
    let dir = game_dir("replays")?;
    let path = clip_path(&dir, &format!("{} last {seconds}s", lock().game), stamp, "mp4");
    encode_kept(&path, &kept)?;
    let name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "the clip".to_string());
    let covered = kept.frames.len() as u32 / kept.fps.max(1);
    if covered + 1 < seconds {
        return Ok(format!("Saved what was kept, which is shorter than {seconds} seconds, as {name}."));
    }
    Ok(format!("Saved the last {seconds} seconds as {name}."))
}

fn encode_kept(path: &Path, kept: &capture::Kept) -> Result<(), String> {
    if capture::can_encode() {
        match capture::write_mp4(path, kept) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let _ = fs::remove_file(path);
                if find_ffmpeg(&lock().ffmpeg).is_none() {
                    return Err(error);
                }
            }
        }
    }
    let ffmpeg = find_ffmpeg(&lock().ffmpeg).ok_or_else(|| {
        "The video could not be saved. Orbit could not encode it, and ffmpeg is not installed.".to_string()
    })?;
    ffmpeg_from_jpegs(&ffmpeg, path, kept)
}

fn ffmpeg_from_jpegs(ffmpeg: &Path, path: &Path, kept: &capture::Kept) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let rate = kept.fps.max(1).to_string();
    let mut command = process::command(ffmpeg);
    command.args(["-y", "-f", "image2pipe", "-framerate"]);
    command.arg(&rate);
    command.args([
        "-i",
        "pipe:0",
        "-an",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]);
    command.arg(path);
    command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| format!("Could not start ffmpeg: {error}"))?;
    let write_result = child.stdin.as_mut().ok_or_else(|| "ffmpeg did not accept the pictures.".to_string()).and_then(|stdin| {
        for frame in &kept.frames {
            stdin.write_all(frame).map_err(|error| error.to_string())?;
        }
        Ok(())
    });
    drop(child.stdin.take());
    let status = child.wait().map_err(|error| error.to_string());
    if let Err(error) = write_result {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    if status.map(|item| item.success()).unwrap_or(false) && !missing_video(path) {
        return Ok(());
    }
    let _ = fs::remove_file(path);
    Err("The video file was empty.".to_string())
}

fn read_jpeg_pipe(mut stdout: impl Read, buffer: capture::Buffer, stop: Arc<AtomicBool>) {
    let mut pending = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    while !stop.load(Ordering::SeqCst) {
        let read = match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(_) => break,
        };
        pending.extend_from_slice(&chunk[..read]);
        while let Some(jpeg) = take_jpeg(&mut pending) {
            if let Some((width, height)) = capture::jpeg_size(&jpeg) {
                buffer.push_jpeg(jpeg, width, height);
            }
        }
        if pending.len() > 8 * 1024 * 1024 {
            pending.clear();
        }
    }
}

fn take_jpeg(bytes: &mut Vec<u8>) -> Option<Vec<u8>> {
    let start = bytes.windows(2).position(|window| window == [0xFF, 0xD8])?;
    let rest = bytes.get(start + 2..)?;
    let end = rest.windows(2).position(|window| window == [0xFF, 0xD9])?;
    let until = start + 2 + end + 2;
    let jpeg = bytes[start..until].to_vec();
    bytes.drain(..until);
    Some(jpeg)
}

fn require_video(path: &Path) -> Result<(), String> {
    if missing_video(path) {
        let _ = fs::remove_file(path);
        return Err("The recording file was empty.".to_string());
    }
    Ok(())
}

fn missing_video(path: &Path) -> bool {
    fs::metadata(path).map(|meta| meta.len() < 32).unwrap_or(true)
}

fn current_spec() -> capture::Spec {
    let live = lock();
    let (max_width, max_height) = picture_size(&live.quality);
    capture::Spec {
        max_width,
        max_height,
        fps: live.fps.max(1),
        jpeg_quality: jpeg_quality(&live.quality),
    }
}

fn capture_missing() -> String {
    #[cfg(target_os = "linux")]
    if std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return "This Wayland desktop cannot be recorded without ffmpeg. An X11 session records on its own.".to_string();
    }
    "Orbit could not capture the screen, and ffmpeg is not installed.".to_string()
}

fn push_grab(command: &mut std::process::Command, fps: Option<&str>) -> Result<(), String> {
    #[cfg(windows)]
    {
        command.args(["-f", "gdigrab"]);
        if let Some(fps) = fps {
            command.args(["-framerate", fps]);
        }
        command.args(["-i", "desktop"]);
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Err("Recording on this Wayland desktop needs an X11 display, or ffmpeg could not grab the screen.".to_string());
        }
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
        let source = if display.contains('.') { display } else { format!("{display}.0") };
        command.args(["-f", "x11grab"]);
        if let Some(fps) = fps {
            command.args(["-framerate", fps]);
        }
        command.arg("-i").arg(source);
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (command, fps);
        Err("Recording is not available on this system.".to_string())
    }
}

fn push_encode(command: &mut std::process::Command, quality: &str) {
    if let Some(scale) = quality_scale(quality) {
        command.args(["-vf", scale]);
    }
    let (preset, crf) = quality_encode(quality);
    command.args(["-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p"]);
}

fn stop_child(mut child: Child) {
    #[cfg(target_os = "linux")]
    {
        unsafe { libc::kill(child.id() as i32, libc::SIGINT) };
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(2) {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(40));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn kill_now(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn find_ffmpeg(configured: &str) -> Option<PathBuf> {
    let configured = configured.trim();
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some(path);
        }
    }
    which("ffmpeg")
}

pub(crate) fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let plain = dir.join(name);
        if plain.is_file() {
            return Some(plain);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{name}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

fn data_root() -> Result<PathBuf, String> {
    let root = lock().root.clone();
    if root.as_os_str().is_empty() {
        return Err("Orbit is still starting.".to_string());
    }
    Ok(root)
}

fn kind_name(kind: &str) -> &'static str {
    match kind {
        "screenshots" | "screenshot" | "shots" => "screenshots",
        "replays" | "replay" => "replays",
        _ => "recordings",
    }
}

fn kind_dir(kind: &str) -> Result<PathBuf, String> {
    Ok(kind_dir_from(&data_root()?, kind_name(kind)))
}

fn kind_dir_from(root: &Path, kind: &str) -> PathBuf {
    root.join(kind_name(kind))
}

fn game_dir(kind: &str) -> Result<PathBuf, String> {
    let game = {
        let name = lock().game.clone();
        if name.trim().is_empty() {
            "Desktop".to_string()
        } else {
            name
        }
    };
    let dir = kind_dir(kind)?.join(safe_name(&game));
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the folder: {error}"))?;
    Ok(dir)
}

fn collect_kind(dir: &Path, kind: &str, found: &mut Vec<(SystemTime, GalleryItem)>) {
    let Ok(games) = fs::read_dir(dir) else { return };
    for game in games.flatten() {
        let game_path = game.path();
        if !game_path.is_dir() {
            continue;
        }
        let game_name = game.file_name().to_string_lossy().to_string();
        let Ok(files) = fs::read_dir(&game_path) else { continue };
        for file in files.flatten() {
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            let ext = path.extension().and_then(|item| item.to_str()).unwrap_or("").to_ascii_lowercase();
            let kept = if kind == "screenshot" {
                ext == "jpg" || ext == "jpeg" || ext == "png"
            } else {
                ext == "mp4"
            };
            if !kept {
                continue;
            }
            let modified = file.metadata().and_then(|meta| meta.modified()).unwrap_or(UNIX_EPOCH);
            found.push((
                modified,
                GalleryItem {
                    kind: kind.to_string(),
                    name: path.file_name().map(|item| item.to_string_lossy().to_string()).unwrap_or_default(),
                    game: game_name.clone(),
                    path: path.to_string_lossy().to_string(),
                },
            ));
        }
    }
}

fn allowed_capture(path: &Path) -> bool {
    let Ok(path) = path.canonicalize() else { return false };
    let Ok(root) = data_root() else { return false };
    for folder in ["screenshots", "recordings", "replays"] {
        let Ok(base) = root.join(folder).canonicalize() else { continue };
        if path.starts_with(&base) {
            return true;
        }
    }
    false
}

fn clip_path(dir: &Path, name: &str, stamp: &str, ext: &str) -> PathBuf {
    dir.join(format!("{} {}.{}", safe_name(name), safe_stamp(stamp), ext))
}

fn saved_name(prefix: &str, path: &Path) -> String {
    let name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "the picture".to_string());
    format!("{prefix} {name}.")
}

fn launch_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let result = process::command("cmd").arg("/C").arg("start").arg("").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let result = process::command("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = process::command("xdg-open").arg(path).spawn();
    result.map(|_| ()).map_err(|error| format!("Could not open that: {error}"))
}

fn ffmpeg_missing() -> String {
    "Recording needs ffmpeg, and Orbit did not find it. Install it, or set its path in Settings → Overlay.".to_string()
}

fn pressed(buttons: &[bool], index: usize) -> bool {
    buttons.get(index).copied().unwrap_or(false)
}

/// The same edges the library uses: A activates, B goes back, and a stick
/// crossing the dead zone counts once. Holding a direction repeats. LB jumps to
/// the app volumes and RB jumps to the gallery. Start+Select is the overlay itself.
fn take_step(watch: &mut Watch, buttons: &[bool], axes: &[f32]) -> Step {
    let both = pressed(buttons, 9) && pressed(buttons, 8);
    let toggle = both && !watch.both;
    watch.both = both;
    let y = axes.get(1).copied().unwrap_or(0.0);
    let x = axes.first().copied().unwrap_or(0.0);
    let up = pressed(buttons, 12) || y < -0.45;
    let down = pressed(buttons, 13) || y > 0.45;
    let left = pressed(buttons, 14) || x < -0.45;
    let right = pressed(buttons, 15) || x > 0.45;
    let page_left = pressed(buttons, 4);
    let page_right = pressed(buttons, 5);
    let a = pressed(buttons, 0);
    let b = pressed(buttons, 1);
    let shoulder = if page_left && !watch.page_left {
        Some("page-left")
    } else if page_right && !watch.page_right {
        Some("page-right")
    } else {
        None
    };
    watch.page_left = page_left;
    watch.page_right = page_right;
    // A stick already over is not a press. Record it before the panel opens,
    // or the next poll would move the first button. Holding it repeats.
    let repeated = repeating(watch, direction(up, down, left, right));
    let action = if toggle {
        None
    } else if let Some(page) = shoulder {
        Some(page)
    } else if let Some(dir) = repeated {
        Some(dir)
    } else if a && !watch.a {
        Some("activate")
    } else if b && !watch.b {
        Some("back")
    } else {
        None
    };
    watch.a = a;
    watch.b = b;
    Step { toggle, action }
}

fn direction(up: bool, down: bool, left: bool, right: bool) -> Option<&'static str> {
    if up {
        Some("up")
    } else if down {
        Some("down")
    } else if left {
        Some("left")
    } else if right {
        Some("right")
    } else {
        None
    }
}

/// The overlay watch polls about every 40ms. The first press is immediate.
/// The next one waits, then it repeats quickly while the stick stays over.
fn repeating(watch: &mut Watch, dir: Option<&'static str>) -> Option<&'static str> {
    if dir != watch.held {
        watch.held = dir;
        watch.ticks = 0;
        return dir;
    }
    let dir = dir?;
    watch.ticks = watch.ticks.saturating_add(1);
    if watch.ticks == 8 || (watch.ticks > 8 && (watch.ticks - 8) % 3 == 0) {
        Some(dir)
    } else {
        None
    }
}

pub(crate) fn quality_name(raw: &str) -> String {
    match raw {
        "720p" | "1080p" | "1440p" | "4k" => raw.to_string(),
        "lighter" => "720p".to_string(),
        "sharper" => "1440p".to_string(),
        "2160p" | "2160" => "4k".to_string(),
        _ => "1080p".to_string(),
    }
}

pub(crate) fn picture_size(quality: &str) -> (u32, u32) {
    match quality_name(quality).as_str() {
        "720p" => (1280, 720),
        "1440p" => (2560, 1440),
        "4k" => (3840, 2160),
        _ => (1920, 1080),
    }
}

pub(crate) fn picture_fps(raw: u32) -> u32 {
    if raw >= 60 { 60 } else { 30 }
}

fn jpeg_quality(quality: &str) -> u8 {
    match quality_name(quality).as_str() {
        "720p" => 78,
        "1440p" => 66,
        "4k" => 56,
        _ => 72,
    }
}

pub(crate) fn quality_fps(fps: u32) -> &'static str {
    if picture_fps(fps) >= 60 { "60" } else { "30" }
}

fn quality_encode(quality: &str) -> (&'static str, &'static str) {
    match quality_name(quality).as_str() {
        "720p" => ("ultrafast", "28"),
        "1440p" => ("veryfast", "20"),
        "4k" => ("veryfast", "23"),
        _ => ("ultrafast", "23"),
    }
}

fn quality_scale(quality: &str) -> Option<&'static str> {
    match quality_name(quality).as_str() {
        "720p" => Some("scale=1280:-2"),
        "1440p" => Some("scale=2560:-2"),
        "4k" => Some("scale=3840:-2"),
        _ => Some("scale=1920:-2"),
    }
}

pub(crate) fn clamp_seconds(value: u32) -> u32 {
    value.clamp(5, 300)
}

pub(crate) fn buffer_seconds(chosen: u32) -> u32 {
    clamp_seconds(chosen).max(60)
}

pub(crate) fn safe_name(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_alphanumeric() || ch == ' ' || ch == '-' || ch == '_' {
            out.push(ch);
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "Orbit".to_string()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn safe_stamp(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '-' || *ch == ' ')
        .take(20)
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.len() >= 8 {
        cleaned
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_else(|_| "clip".to_string())
    }
}

#[cfg(windows)]
fn read_xinput(slot: &mut u32) -> Option<(Vec<bool>, Vec<f32>)> {
    use windows::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};

    fn read_index(index: u32) -> Option<(Vec<bool>, Vec<f32>)> {
        let mut state = XINPUT_STATE::default();
        let code = unsafe { XInputGetState(index, &mut state) };
        if code != 0 {
            return None;
        }
        let flags = state.Gamepad.wButtons.0;
        let mut buttons = vec![false; 16];
        buttons[0] = flags & 0x1000 != 0;
        buttons[1] = flags & 0x2000 != 0;
        buttons[4] = flags & 0x0100 != 0;
        buttons[5] = flags & 0x0200 != 0;
        buttons[8] = flags & 0x0020 != 0;
        buttons[9] = flags & 0x0010 != 0;
        buttons[12] = flags & 0x0001 != 0;
        buttons[13] = flags & 0x0002 != 0;
        buttons[14] = flags & 0x0004 != 0;
        buttons[15] = flags & 0x0008 != 0;
        let x = state.Gamepad.sThumbLX as f32 / 32767.0;
        // The library treats a negative Y as up. XInput's up is positive.
        let y = -(state.Gamepad.sThumbLY as f32 / 32767.0);
        Some((buttons, vec![x, y, 0.0, 0.0]))
    }

    if let Some(read) = read_index(*slot) {
        return Some(read);
    }
    for index in 0..4 {
        if let Some(read) = read_index(index) {
            *slot = index;
            return Some(read);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_cannot_leave_the_clips_folder() {
        assert_eq!(safe_name("Fortune Mill"), "Fortune Mill");
        assert_eq!(safe_name("../etc/passwd"), "etcpasswd");
        assert_eq!(safe_name("   "), "Orbit");
        assert_eq!(safe_name("A:B*C"), "ABC");
    }

    #[test]
    fn the_buffer_covers_the_three_buttons_and_a_longer_custom_length() {
        assert_eq!(buffer_seconds(30), 60);
        assert_eq!(buffer_seconds(45), 60);
        assert_eq!(buffer_seconds(90), 90);
        assert_eq!(clamp_seconds(1), 5);
        assert_eq!(clamp_seconds(900), 300);
    }

    #[test]
    fn start_and_select_open_once_until_they_are_released() {
        let mut watch = Watch {
            both: false,
            page_left: false,
            page_right: false,
            a: false,
            b: false,
            held: None,
            ticks: 0,
        };
        let mut buttons = vec![false; 16];
        buttons[8] = true;
        buttons[9] = true;
        let first = take_step(&mut watch, &buttons, &[0.0, 0.0]);
        let held = take_step(&mut watch, &buttons, &[0.0, 0.0]);
        buttons[8] = false;
        buttons[9] = false;
        let released = take_step(&mut watch, &buttons, &[0.0, 0.0]);
        buttons[8] = true;
        buttons[9] = true;
        let again = take_step(&mut watch, &buttons, &[0.0, 0.0]);
        assert!(first.toggle);
        assert!(!held.toggle);
        assert!(!released.toggle);
        assert!(again.toggle);
        assert!(first.action.is_none());
    }

    #[test]
    fn a_held_direction_waits_and_then_repeats() {
        let mut watch = Watch {
            both: false,
            page_left: false,
            page_right: false,
            a: false,
            b: false,
            held: None,
            ticks: 0,
        };
        let axes = [1.0, 0.0];
        assert_eq!(take_step(&mut watch, &[false; 16], &axes).action, Some("right"));
        assert!(take_step(&mut watch, &[false; 16], &axes).action.is_none());
        for _ in 0..6 {
            assert!(take_step(&mut watch, &[false; 16], &axes).action.is_none());
        }
        assert_eq!(take_step(&mut watch, &[false; 16], &axes).action, Some("right"));
    }

    #[test]
    fn quality_picks_a_resolution() {
        assert_eq!(quality_name("lighter"), "720p");
        assert_eq!(quality_name("normal"), "1080p");
        assert_eq!(quality_name("sharper"), "1440p");
        assert_eq!(quality_name("4k"), "4k");
        assert_eq!(quality_name("nope"), "1080p");
        assert_eq!(picture_size("4k"), (3840, 2160));
        assert_eq!(picture_size("1080p"), (1920, 1080));
        assert_eq!(picture_fps(60), 60);
        assert_eq!(picture_fps(15), 30);
        assert_eq!(quality_fps(60), "60");
        assert_eq!(quality_scale("720p"), Some("scale=1280:-2"));
        assert_eq!(quality_scale("1080p"), Some("scale=1920:-2"));
    }
}
