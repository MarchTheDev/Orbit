//! A small panel over a game: a picture, a recording, or the last few seconds.
//!
//! Alt+X is a global shortcut. Start+Select is read here too, because a Windows
//! game in front does not deliver the browser pad, and asking that pad can
//! freeze the window. The handler for Alt+X only sets a flag. Creating the
//! panel from inside that handler can stall the shortcut lock.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "linux")]
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::process;

const WINDOW: &str = "overlay";
const SEGMENT_SECS: u32 = 5;

static OPEN: AtomicBool = AtomicBool::new(false);
static ASKED: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static WATCHING: AtomicBool = AtomicBool::new(false);

struct Live {
    enabled: bool,
    replay: bool,
    seconds: u32,
    quality: String,
    ffmpeg: String,
    root: PathBuf,
    game: String,
    playing: bool,
    recording: Option<Child>,
    buffer: Option<Child>,
    recording_name: String,
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
    ffmpeg: String::new(),
    root: PathBuf::new(),
    game: String::new(),
    playing: false,
    recording: None,
    buffer: None,
    recording_name: String::new(),
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
        .unwrap_or("normal");
    let ffmpeg = overlay
        .and_then(|item| item.get("ffmpeg"))
        .and_then(Value::as_str)
        .unwrap_or("");
    configure(None, enabled, replay, seconds, quality, ffmpeg);
}

pub fn configure(
    app: Option<&AppHandle>,
    enabled: bool,
    replay: bool,
    seconds: u32,
    quality: &str,
    ffmpeg: &str,
) {
    let seconds = clamp_seconds(seconds);
    let quality = quality_name(quality);
    let (changed, stop, restart, hide) = {
        let mut live = lock();
        let changed = live.enabled != enabled
            || live.replay != replay
            || live.seconds != seconds
            || live.quality != quality
            || live.ffmpeg != ffmpeg;
        let hide = live.enabled && !enabled;
        live.enabled = enabled;
        live.replay = replay;
        live.seconds = seconds;
        live.quality = quality;
        live.ffmpeg = ffmpeg.to_string();
        let stop = live.playing && (!replay || !enabled);
        let restart = changed && live.playing && replay && enabled && live.recording.is_none();
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
        let same = live.playing && live.game == safe_name(title) && live.buffer.is_some();
        live.game = safe_name(title);
        live.playing = true;
        !same
    };
    if restart {
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
        (recording, buffer)
    };
    if let Some(child) = recording.0 {
        kill_now(child);
    }
    if let Some(child) = recording.1 {
        kill_now(child);
    }
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    if let Ok(dir) = app.path().app_data_dir() {
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
    let folder = clips_dir_from(&live.root);
    OverlayStatus {
        enabled: live.enabled,
        recording: live.recording.is_some(),
        replay: live.replay,
        playing: live.playing,
        ffmpeg: find_ffmpeg(&live.ffmpeg).is_some(),
        seconds: live.seconds,
        game: live.game.clone(),
        folder: folder.to_string_lossy().to_string(),
        note: live.note.clone(),
    }
}

pub fn hide(app: &AppHandle) {
    hide_window(app);
}

pub fn open_folder() -> Result<String, String> {
    let dir = clips_dir()?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the clips folder: {error}"))?;
    open_dir(&dir)?;
    Ok(dir.to_string_lossy().to_string())
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
    let running = lock().recording.is_some();
    if running {
        let child = lock().recording.take();
        drop(_held);
        if let Some(child) = child {
            stop_child(child);
        }
        if should_buffer() {
            let _ = start_buffer(false);
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
        thread::sleep(Duration::from_millis(120));
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
    if lock().recording.is_some() {
        let message = "A recording is running. Stop it before saving the last few seconds.".to_string();
        remember(&Err(message.clone()));
        return Err(message);
    }
    let was_open = is_open();
    if was_open {
        hide_window(app);
        thread::sleep(Duration::from_millis(180));
    }
    stop_buffer();
    let result = concat_replay(seconds, stamp);
    if should_buffer() {
        let _ = start_buffer(false);
    }
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
    live.playing && live.replay && live.enabled && live.recording.is_none()
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
    if let Some(window) = app.get_webview_window(WINDOW) {
        return Some(window);
    }
    let window = tauri::WebviewWindowBuilder::new(app, WINDOW, tauri::WebviewUrl::App("index.html".into()))
        .title("Orbit overlay")
        .inner_size(440.0, 560.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .center()
        .background_color(tauri::window::Color(20, 18, 42, 255))
        .initialization_script("window.__ORBIT_OVERLAY__=true")
        .build()
        .map_err(|error| {
            log::warn!("overlay window was not created: {error}");
            error
        })
        .ok()?;
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
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    OPEN.store(true, Ordering::SeqCst);
    tell(app, "overlay-visible", "true");
    let _ = window.emit("overlay-shown", ());
}

fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
    mark_hidden(app);
}

fn mark_hidden(app: &AppHandle) {
    OPEN.store(false, Ordering::SeqCst);
    tell(app, "overlay-visible", "false");
}

fn tell(app: &AppHandle, event: &str, payload: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, payload);
    }
}

fn take_shot(stamp: &str) -> Result<String, String> {
    let dir = clips_dir()?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the clips folder: {error}"))?;
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
    let ffmpeg = find_ffmpeg(&lock().ffmpeg).ok_or_else(ffmpeg_missing)?;
    let dir = clips_dir()?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the clips folder: {error}"))?;
    let path = clip_path(&dir, &lock().game, stamp, "mp4");
    let mut command = process::command(&ffmpeg);
    command.arg("-y");
    push_grab(&mut command, Some(quality_fps(&lock().quality)))?;
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
    live.recording = Some(child);
    Ok(())
}

fn start_buffer(clear: bool) -> Result<(), String> {
    let _held = gate();
    {
        let live = lock();
        if live.buffer.is_some() || live.recording.is_some() {
            return Ok(());
        }
        if !live.playing || !live.replay || !live.enabled {
            return Ok(());
        }
    }
    let ffmpeg = match find_ffmpeg(&lock().ffmpeg) {
        Some(path) => path,
        None => return Ok(()),
    };
    let dir = replay_dir()?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    if clear {
        clear_segments(&dir);
    }
    let wrap = segment_wrap(lock().seconds);
    let mut command = process::command(&ffmpeg);
    command.arg("-y");
    let quality = lock().quality.clone();
    push_grab(&mut command, Some(quality_fps(&quality)))?;
    command.arg("-an");
    push_encode(&mut command, &quality);
    command.args([
        "-g",
        quality_gop(&quality),
        "-f",
        "segment",
        "-segment_time",
        &SEGMENT_SECS.to_string(),
        "-segment_wrap",
        &wrap.to_string(),
        "-reset_timestamps",
        "1",
        "-segment_format",
        "matroska",
        "seg_%03d.mkv",
    ]);
    command
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command.spawn().map_err(|error| error.to_string())?;
    lock().buffer = Some(child);
    Ok(())
}

fn stop_buffer() {
    let _held = gate();
    if let Some(child) = lock().buffer.take() {
        stop_child(child);
    }
}

fn concat_replay(seconds: u32, stamp: &str) -> Result<String, String> {
    let ffmpeg = find_ffmpeg(&lock().ffmpeg).ok_or_else(ffmpeg_missing)?;
    let dir = replay_dir()?;
    let mut files = segment_files(&dir);
    if files.is_empty() {
        return Err("Nothing has been kept yet. The replay starts when a game is playing.".to_string());
    }
    let need = segments_needed(seconds);
    let short = files.len() < need;
    if files.len() > need {
        files = files.split_off(files.len() - need);
    }
    let clips = clips_dir()?;
    fs::create_dir_all(&clips).map_err(|error| format!("Could not create the clips folder: {error}"))?;
    let path = clip_path(&clips, &format!("{} last {seconds}s", lock().game), stamp, "mp4");
    if let Err(error) = concat_files(&ffmpeg, &files, &path) {
        if files.len() < 2 {
            return Err(error);
        }
        files.pop();
        concat_files(&ffmpeg, &files, &path)?;
    }
    let name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "the clip".to_string());
    if short {
        Ok(format!("Saved what was kept, which is shorter than {seconds} seconds, as {name}."))
    } else {
        Ok(format!("Saved the last {seconds} seconds as {name}."))
    }
}

fn concat_files(ffmpeg: &Path, files: &[PathBuf], out: &Path) -> Result<(), String> {
    if files.is_empty() {
        return Err("Nothing has been kept yet.".to_string());
    }
    let list = out.with_extension("list.txt");
    let mut text = String::new();
    for file in files {
        text.push_str(&concat_line(file));
    }
    fs::write(&list, text).map_err(|error| error.to_string())?;
    let mut command = process::command(ffmpeg);
    command
        .args(["-y", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list)
        .arg("-an");
    push_encode(&mut command, &lock().quality);
    let status = command
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&list);
    if status.success() && out.is_file() {
        Ok(())
    } else {
        let _ = fs::remove_file(out);
        Err("The last few seconds could not be saved.".to_string())
    }
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

fn clips_dir() -> Result<PathBuf, String> {
    let root = lock().root.clone();
    if root.as_os_str().is_empty() {
        return Err("Orbit is still starting.".to_string());
    }
    Ok(clips_dir_from(&root))
}

fn clips_dir_from(root: &Path) -> PathBuf {
    root.join("clips")
}

fn replay_dir() -> Result<PathBuf, String> {
    let root = lock().root.clone();
    if root.as_os_str().is_empty() {
        return Err("Orbit is still starting.".to_string());
    }
    Ok(root.join("replay"))
}

fn clear_segments(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("mkv") {
            let _ = fs::remove_file(path);
        }
    }
}

fn segment_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("mkv") {
            continue;
        }
        let len = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if len < 1024 {
            continue;
        }
        let modified = entry.metadata().and_then(|meta| meta.modified()).unwrap_or(UNIX_EPOCH);
        files.push((modified, path));
    }
    files.sort_by_key(|(modified, _)| *modified);
    files.into_iter().map(|(_, path)| path).collect()
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

fn concat_line(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
    format!("file '{text}'\n")
}

fn open_dir(folder: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let result = process::command("explorer").arg(folder).spawn();
    #[cfg(target_os = "macos")]
    let result = process::command("open").arg(folder).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = process::command("xdg-open").arg(folder).spawn();
    result.map(|_| ()).map_err(|error| format!("Could not open the clips folder: {error}"))
}

fn ffmpeg_missing() -> String {
    "Recording needs ffmpeg, and Orbit did not find it. Install it, or set its path in Settings → Overlay.".to_string()
}

fn pressed(buttons: &[bool], index: usize) -> bool {
    buttons.get(index).copied().unwrap_or(false)
}

/// The same edges the library uses: A activates, B goes back, and a stick
/// crossing the dead zone counts once. Holding a direction repeats. LB and RB
/// jump between the clips and the app volumes. Start+Select is the overlay itself.
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
        "lighter" | "sharper" => raw.to_string(),
        _ => "normal".to_string(),
    }
}

pub(crate) fn quality_fps(quality: &str) -> &'static str {
    if quality == "lighter" { "15" } else { "30" }
}

pub(crate) fn quality_gop(quality: &str) -> &'static str {
    if quality == "lighter" { "15" } else { "30" }
}

fn quality_encode(quality: &str) -> (&'static str, &'static str) {
    match quality {
        "lighter" => ("ultrafast", "28"),
        "sharper" => ("veryfast", "18"),
        _ => ("ultrafast", "23"),
    }
}

fn quality_scale(quality: &str) -> Option<&'static str> {
    if quality == "lighter" { Some("scale=1280:-2") } else { None }
}

pub(crate) fn clamp_seconds(value: u32) -> u32 {
    value.clamp(5, 300)
}

pub(crate) fn buffer_seconds(chosen: u32) -> u32 {
    clamp_seconds(chosen).max(60)
}

pub(crate) fn segment_wrap(chosen: u32) -> u32 {
    buffer_seconds(chosen) / SEGMENT_SECS + 2
}

pub(crate) fn segments_needed(seconds: u32) -> usize {
    (clamp_seconds(seconds) as usize) / SEGMENT_SECS as usize + 1
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
        assert_eq!(segment_wrap(30), 14);
        assert_eq!(segments_needed(30), 7);
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
    fn lighter_is_the_small_picture() {
        assert_eq!(quality_name("sharper"), "sharper");
        assert_eq!(quality_name("nope"), "normal");
        assert_eq!(quality_fps("lighter"), "15");
        assert_eq!(quality_scale("lighter"), Some("scale=1280:-2"));
        assert_eq!(quality_scale("normal"), None);
    }
}
