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

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::capture;
use crate::notice::{Card, Icon, Palette};
use crate::process;

const WINDOW: &str = "overlay";

/// What the game-start card says. The game's name was there before; the player
/// had just picked it, so it told them nothing they did not already know.
const READY_TITLE: &str = "Overlay deployed in Orbit";

static OPEN: AtomicBool = AtomicBool::new(false);
static RESTING: AtomicBool = AtomicBool::new(false);
static HAS_PINS: AtomicBool = AtomicBool::new(false);
static IGNORE: AtomicBool = AtomicBool::new(false);
static CHECKING: AtomicBool = AtomicBool::new(false);
static ASKED: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static WATCHING: AtomicBool = AtomicBool::new(false);
/// When the last toggle was taken. A held shortcut repeats; one press is one.
static ASKED_AT: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// Whether this open said the game is covering the panel. Once per open.
static FRONT_WARNED: AtomicBool = AtomicBool::new(false);
/// How many times the front has been taken back for this open.
static FRONT_TRIES_CELL: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
/// What the panel's page said to on its last heartbeat, and when it opened.
static HEARD: Mutex<Option<std::time::Instant>> = Mutex::new(None);
static SHOWN_AT: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// When the panel was last rebuilt, so a page that keeps dying cannot loop.
static REVIVED: Mutex<Vec<std::time::Instant>> = Mutex::new(Vec::new());
const TOGGLE_GAP: Duration = Duration::from_millis(320);
/// How often an opened panel checks that it is still itself.
const PANEL_GUARD: Duration = Duration::from_millis(700);
/// How many times it takes the front back before it says why it cannot.
const FRONT_TRIES: u8 = 4;
/// A page that has never spoken gets longer than one that has gone quiet.
const PAGE_START: Duration = Duration::from_secs(7);
const PAGE_SILENT: Duration = Duration::from_secs(3);
/// Rebuilds allowed in a minute. Past this the panel is not coming back.
const REVIVALS: usize = 3;
static HITS: Mutex<Vec<HitBox>> = Mutex::new(Vec::new());

struct Live {
    enabled: bool,
    replay: bool,
    seconds: u32,
    lengths: Vec<u32>,
    keep: u32,
    quality: String,
    fps: u32,
    ffmpeg: String,
    /// Orbit's data directory; kept separate so replay cleanup never touches a custom capture folder.
    root: PathBuf,
    /// Per-kind output folders; default to the matching subfolders of `root`.
    screenshot_root: PathBuf,
    recording_root: PathBuf,
    replay_root: PathBuf,
    game: String,
    ready_notice: Option<String>,
    playing: bool,
    recording: Option<Child>,
    buffer: Option<Child>,
    #[cfg(target_os = "linux")]
    audio_buffer: Option<Child>,
    #[cfg(target_os = "linux")]
    audio_stop: Option<Arc<AtomicBool>>,
    #[cfg(target_os = "linux")]
    audio_thread: Option<thread::JoinHandle<()>>,
    native_recording: Option<capture::Hold>,
    native_buffer: Option<capture::Hold>,
    replay_frames: Option<capture::Buffer>,
    pipe_stop: Option<Arc<AtomicBool>>,
    recording_name: String,
    recording_path: PathBuf,
    note: String,
    /// The colours of the player's theme, for the native card.
    palette: Palette,
    /// The chime, for a capture that finishes after the panel is gone. The
    /// panel plays its own copy of this from the web view.
    shutter: bool,
    shutter_volume: u8,
    /// The panel could not be drawn over the game. Kept until the next open
    /// has said it, since nothing can be drawn over a fullscreen game.
    cover_note: bool,
}

struct Watch {
    both: bool,
    /// LB is the modifier for the capture shortcuts; RB only completes LB+RB.
    left_shoulder: bool,
    right_shoulder: bool,
    dpad_left: bool,
    dpad_right: bool,
    a: bool,
    b: bool,
    held: Option<&'static str>,
    ticks: u8,
    /// Whether the right stick was out of its dead zone on the last poll, so
    /// the one report that puts it back to rest is sent as well.
    stick_moving: bool,
}

/// A capture asked for from the pad, with the panel open.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Capture {
    Shot,
    Record,
    Replay,
}

struct Step {
    toggle: bool,
    action: Option<&'static str>,
    capture: Option<Capture>,
    /// The right stick, while it is being pushed or the moment it is let go.
    stick: Option<(f32, f32)>,
}

static LIVE: Mutex<Live> = Mutex::new(Live {
    enabled: true,
    replay: true,
    seconds: 30,
    lengths: Vec::new(),
    keep: 60,
    quality: String::new(),
    fps: 30,
    ffmpeg: String::new(),
    root: PathBuf::new(),
    screenshot_root: PathBuf::new(),
    recording_root: PathBuf::new(),
    replay_root: PathBuf::new(),
    game: String::new(),
    ready_notice: None,
    playing: false,
    recording: None,
    buffer: None,
    #[cfg(target_os = "linux")]
    audio_buffer: None,
    #[cfg(target_os = "linux")]
    audio_stop: None,
    #[cfg(target_os = "linux")]
    audio_thread: None,
    native_recording: None,
    native_buffer: None,
    replay_frames: None,
    pipe_stop: None,
    recording_name: String::new(),
    recording_path: PathBuf::new(),
    note: String::new(),
    palette: Palette::NEBULA,
    shutter: true,
    shutter_volume: 40,
    cover_note: false,
});
static GATE: Mutex<()> = Mutex::new(());
static PAD: Mutex<Watch> = Mutex::new(Watch {
    both: false,
    left_shoulder: false,
    right_shoulder: false,
    dpad_left: false,
    dpad_right: false,
    a: false,
    b: false,
    held: None,
    ticks: 0,
    stick_moving: false,
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
    pub lengths: Vec<u32>,
    pub quality: String,
    pub fps: u32,
    pub game: String,
    pub folder: String,
    pub note: String,
    pub ready_notice: Option<String>,
    /// The last open was covered by the game itself. Said inside the panel,
    /// because the card that tries to say it is behind the same window.
    pub cover_note: bool,
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

/// The panel is on screen, opened or resting against a pin. Both draw their own
/// toasts, so a native card would be a second copy of the same news.
pub fn panel_visible(app: &AppHandle) -> bool {
    app.get_webview_window(WINDOW)
        .is_some_and(|window| window.is_visible().unwrap_or(false))
}

/// Take the colours of the player's theme for the native card. The app sends
/// them when the theme changes; the defaults are Orbit's Nebula.
pub fn set_palette(panel: &str, text: &str, muted: &str, accent: &str) {
    let mut live = lock();
    let current = live.palette;
    live.palette = Palette {
        panel: parse_colour(panel).unwrap_or(current.panel),
        text: parse_colour(text).unwrap_or(current.text),
        muted: parse_colour(muted).unwrap_or(current.muted),
        accent: parse_colour(accent).unwrap_or(current.accent),
    };
}

fn parse_colour(value: &str) -> Option<u32> {
    let digits = value.trim().trim_start_matches('#');
    if digits.len() != 6 || !digits.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(digits, 16).ok()
}

/// A capture finished. When the panel is gone there is no toast left to show
/// it, so the card does: a save that was started before the overlay closed is
/// exactly the one the player is waiting to hear about.
pub fn announce_capture(app: &AppHandle, kind: &str, result: &Result<String, String>) {
    // A panel still on screen - open, or resting against a pin - draws its own
    // toast. Only a capture that outlives it needs the card.
    if panel_visible(app) {
        return;
    }
    let palette = lock().palette;
    let card = match result {
        Ok(text) => {
            let title = match kind {
                "screenshot" => "Screenshot saved",
                "replay" => "Replay saved",
                "recording" if text.starts_with("Saved the recording") => "Recording saved",
                "recording" => "Recording started",
                _ => "Saved to Gallery",
            };
            // The panel's toast uses the camera, the dot and the circular
            // arrow for these three; the card must not invent a fourth look
            // for the same save.
            let icon = match kind {
                "recording" => Icon::Record,
                "replay" => Icon::Replay,
                _ => Icon::Camera,
            };
            Card::ok(title, capture_detail(kind, text), palette).with_icon(icon)
        }
        Err(text) => Card::error("Capture failed", text, palette),
    };
    // The web view that would have played the chime is gone with the panel, so
    // the card brings its own.
    let (on, volume) = {
        let live = lock();
        (live.shutter, live.shutter_volume)
    };
    if on {
        play_chime(volume);
    }
    crate::notice::show(card);
}

/// The panel's three-note chime, for the one case the panel cannot play it:
/// a capture that finishes after its window is gone.
///
/// The notes are the same D-major arpeggio `src/services/shutter.ts` makes,
/// rendered here to a small in-memory WAV so `PlaySound` can play it without a
/// second web view. The image has to outlive the call because playback is
/// asynchronous, so it is kept in a static that is replaced only when the
/// volume changes.
#[cfg(windows)]
fn play_chime(volume: u8) {
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};

    static SOUND: Mutex<Option<(u8, &'static [u8])>> = Mutex::new(None);
    if volume == 0 {
        return;
    }
    let mut sound = SOUND.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if sound.as_ref().map(|(level, _)| *level) != Some(volume) {
        let bytes: &'static [u8] = Box::leak(chime_wav(volume).into_boxed_slice());
        *sound = Some((volume, bytes));
    }
    let Some((_, bytes)) = sound.as_ref() else { return };
    if bytes.len() < 44 {
        return;
    }
    unsafe {
        let _ = PlaySoundW(
            PCWSTR(bytes.as_ptr() as *const u16),
            None,
            SND_ASYNC | SND_MEMORY | SND_NODEFAULT,
        );
    }
}

#[cfg(not(windows))]
fn play_chime(_volume: u8) {}

/// A 16 bit mono WAV of the three notes, at the same level the panel uses.
#[cfg(windows)]
fn chime_wav(volume: u8) -> Vec<u8> {
    const RATE: u32 = 44_100;
    const SECONDS: f32 = 0.95;
    const ATTACK: f32 = 0.035;
    const RELEASE: f32 = 0.58;
    const ROOT: f32 = 293.66;
    // D4, F#4 and A4, each with its own peak and its own delay: the soft,
    // unhurried D-major arpeggio the shutter makes.
    const NOTES: [(f32, f32, f32); 3] = [(0.0, 0.13, 0.0), (4.0, 0.10, 0.11), (7.0, 0.075, 0.22)];

    let level = (volume.min(100) as f32 / 100.0) * 0.09;
    let count = (RATE as f32 * SECONDS) as usize;
    let mut samples = Vec::with_capacity(count);
    for index in 0..count {
        let time = index as f32 / RATE as f32;
        let mut sample = 0.0f32;
        for (semitones, peak, delay) in NOTES {
            let local = time - delay;
            if local <= 0.0 || local >= RELEASE {
                continue;
            }
            // A short bloom up to the peak, then a fade to a thousandth of it,
            // both exponential, the way the WebAudio envelope is written.
            let quietest = 0.0001f32;
            let ratio = quietest / peak;
            let envelope = if local < ATTACK {
                ratio.powf(1.0 - local / ATTACK)
            } else {
                ratio.powf((local - ATTACK) / (RELEASE - ATTACK))
            };
            let frequency = ROOT * 2f32.powf(semitones / 12.0);
            sample += peak * envelope * (std::f32::consts::TAU * frequency * time).sin();
        }
        samples.push((sample * level).clamp(-1.0, 1.0));
    }

    let data_len = (samples.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&((sample * i16::MAX as f32) as i16).to_le_bytes());
    }
    wav
}

/// The same quiet second line the panel's own toast uses.
fn capture_detail(kind: &str, text: &str) -> &'static str {
    if kind == "recording" && !text.starts_with("Saved the recording") {
        return "Your recording is underway";
    }
    if text.contains("Clipboard copy failed") {
        "Saved to Gallery · clipboard copy was not available"
    } else if text.contains("Copied to clipboard") {
        "Saved to Gallery · copied to clipboard"
    } else {
        "Saved to Gallery"
    }
}

/// Alt+X and Start+Select both end here. The window work happens later, off
/// the shortcut handler, so that handler can return while its lock is still held.
pub fn request_toggle() {
    // Windows repeats a registered hotkey while it is held down. Without this
    // a slightly long press opened and closed the panel in the same moment,
    // which is the flash a player sees instead of the overlay.
    let now = std::time::Instant::now();
    {
        let mut last = ASKED_AT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if last.is_some_and(|at| now.duration_since(at) < TOGGLE_GAP) {
            return;
        }
        *last = Some(now);
    }
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
    let lengths = overlay
        .and_then(|item| item.get("lengths"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| item.as_u64()).map(|item| item as u32).collect::<Vec<_>>())
        .unwrap_or_default();
    let quality = overlay
        .and_then(|item| item.get("quality"))
        .and_then(Value::as_str)
        .unwrap_or("1080p");
    let fps = overlay.and_then(|item| item.get("fps")).and_then(Value::as_u64).unwrap_or(30) as u32;
    let ffmpeg = overlay
        .and_then(|item| item.get("ffmpeg"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let shutter = overlay.and_then(|item| item.get("shutter")).and_then(Value::as_bool).unwrap_or(true);
    let shutter_volume = overlay
        .and_then(|item| item.get("shutterVolume"))
        .and_then(Value::as_u64)
        .unwrap_or(40)
        .min(100) as u8;
    {
        let mut live = lock();
        live.shutter = shutter;
        live.shutter_volume = shutter_volume;
    }
    let screenshot_directory = overlay.and_then(|item| item.get("screenshotDirectory")).and_then(Value::as_str).unwrap_or("");
    let recording_directory = overlay.and_then(|item| item.get("recordingDirectory")).and_then(Value::as_str).unwrap_or("");
    let replay_directory = overlay.and_then(|item| item.get("replayDirectory")).and_then(Value::as_str).unwrap_or("");
    configure(None, enabled, replay, seconds, Some(&lengths), quality, fps, ffmpeg, screenshot_directory, recording_directory, replay_directory);
}

pub fn configure(
    app: Option<&AppHandle>,
    enabled: bool,
    replay: bool,
    seconds: u32,
    lengths: Option<&[u32]>,
    quality: &str,
    fps: u32,
    ffmpeg: &str,
    screenshot_directory: &str,
    recording_directory: &str,
    replay_directory: &str,
) {
    let seconds = clamp_seconds(seconds);
    let lengths = lengths.map(|items| {
        items.iter().copied().map(clamp_seconds).filter(|item| ![30, 45, 60].contains(item)).collect::<Vec<_>>()
    });
    let quality = quality_name(quality);
    let fps = picture_fps(fps);
    let (changed, stop, restart, hide) = {
        let mut live = lock();
        let recording = live.recording.is_some() || live.native_recording.is_some();
        // None means the extra lengths stay. A chip only changes what is saved.
        let lengths = match lengths {
            Some(items) => items,
            None => live.lengths.clone(),
        };
        let keep = keep_seconds(&lengths, seconds);
        let screenshot_root = configured_capture_dir(&live.root, screenshot_directory, "screenshots");
        let recording_root = configured_capture_dir(&live.root, recording_directory, "recordings");
        let replay_root = configured_capture_dir(&live.root, replay_directory, "replays");
        let capture_changed = live.screenshot_root != screenshot_root || live.recording_root != recording_root || live.replay_root != replay_root;
        live.screenshot_root = screenshot_root;
        live.recording_root = recording_root;
        live.replay_root = replay_root;
        let must_restart = live.keep != keep || live.quality != quality || live.fps != fps || live.replay != replay || live.enabled != enabled;
        let changed = must_restart || live.seconds != seconds || live.lengths != lengths || live.ffmpeg != ffmpeg || capture_changed;
        let hide = live.enabled && !enabled;
        live.enabled = enabled;
        live.replay = replay;
        live.seconds = seconds;
        live.lengths = lengths;
        live.keep = keep;
        live.quality = quality;
        live.fps = fps;
        live.ffmpeg = ffmpeg.to_string();
        let stop = live.playing && (!replay || !enabled);
        let restart = must_restart && live.playing && replay && enabled && !recording;
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
            // Hiding leaves the second web view running. Turning the overlay
            // off has to close that window, or its processes stay behind.
            close_panel(app);
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
        // A stale spool from a crash is cleared when the app starts. Do not
        // sweep here: a buffer that is already running still owns its file.
        if let Err(error) = start_buffer(true) {
            if !error.is_empty() {
                lock().note = error;
            }
        }
    }
}

/// Show a short notice after Orbit successfully starts a game. The main window
/// may already be minimized or hidden by the launch policy.
///
/// When the panel is on screen it picks the notice up from the next status
/// refresh. Otherwise a native card is drawn instead: showing the overlay
/// window for five seconds meant a second WebView2 instance, about 50 MB of
/// processes, on every game start.
pub fn ready_notice(app: &AppHandle) -> Result<(), String> {
    let panel = panel_visible(app);
    let palette = {
        let mut live = lock();
        if !live.enabled {
            return Ok(());
        }
        if panel {
            live.ready_notice = Some(READY_TITLE.to_string());
            return Ok(());
        }
        // Nothing should keep a notice waiting for the next time the panel opens.
        live.ready_notice = None;
        live.palette
    };
    // One line, and no second one to explain Alt+X: it was read once and
    // ignored every time after that.
    crate::notice::show(Card::ok(READY_TITLE, "", palette));
    Ok(())
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
    let (recording, audio) = {
        let mut live = lock();
        let recording = (
            live.recording.take(),
            live.buffer.take(),
            live.native_recording.take(),
            live.native_buffer.take(),
        );
        if let Some(stop) = live.pipe_stop.take() {
            stop.store(true, Ordering::SeqCst);
        }
        #[cfg(target_os = "linux")]
        let audio = {
            if let Some(stop) = live.audio_stop.take() {
                stop.store(true, Ordering::SeqCst);
            }
            (live.audio_buffer.take(), live.audio_thread.take())
        };
        #[cfg(not(target_os = "linux"))]
        let audio = ();
        live.replay_frames = None;
        (recording, audio)
    };
    #[cfg(not(target_os = "linux"))]
    let _ = audio;
    if let Some(child) = recording.0 {
        kill_now(child);
    }
    if let Some(child) = recording.1 {
        kill_now(child);
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(child) = audio.0 {
            kill_now(child);
        }
        if let Some(reader) = audio.1 {
            let _ = reader.join();
        }
    }
    if let Some(hold) = recording.2 {
        let _ = capture::finish(hold);
    }
    if let Some(hold) = recording.3 {
        let _ = capture::finish(hold);
    }
    // A file still held by a save that is finishing right now cannot be
    // removed yet; it is swept on the next start instead.
    capture::clear_replay_files(&replay_workspace());
}

/// Hide and destroy the overlay window. Hiding is not enough: a hidden window
/// is still a window, and that is what left the panel up after Orbit closed.
pub fn close_panel(app: &AppHandle) {
    if OPEN.load(Ordering::SeqCst) || RESTING.load(Ordering::SeqCst) {
        log::info!("overlay: the panel was closed");
    }
    OPEN.store(false, Ordering::SeqCst);
    RESTING.store(false, Ordering::SeqCst);
    *HEARD.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    *SHOWN_AT.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    FRONT_TRIES_CELL.store(0, Ordering::SeqCst);
    lock().ready_notice = None;
    HAS_PINS.store(false, Ordering::SeqCst);
    capture::set_paused(false);
    crate::stats::release();
    tell(app, "overlay-visible", "false");
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
        live.root = dir.clone();
        if live.screenshot_root.as_os_str().is_empty() {
            live.screenshot_root = dir.join("screenshots");
        }
        if live.recording_root.as_os_str().is_empty() {
            live.recording_root = dir.join("recordings");
        }
        if live.replay_root.as_os_str().is_empty() {
            live.replay_root = dir.join("replays");
        }
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

/// Start+Select, LB+RB and the LB shortcuts, from the pad thread. Everything
/// but Start+Select is only sent while the panel is open.
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
    // Every shortcut but Start+Select belongs to the opened panel. LB and RB
    // are ordinary game buttons: a shooter uses them every few seconds, and a
    // chord that also fired with the panel closed took a screenshot or stopped
    // a replay buffer in the middle of a match. Reading the pad is passive, so
    // a closed panel now costs the game nothing.
    if !is_open() {
        return;
    }
    if let Some(capture) = step.capture {
        // The panel runs the capture itself, so it gets the chime and its own
        // toast in the one place the player is already looking.
        if let Some(window) = app.get_webview_window(WINDOW) {
            let _ = window.emit("overlay-pad", capture_action(capture));
        }
        return;
    }
    // Movement belongs to the opened panel too. The right stick scrolls the box
    // that has the focus, the way it scrolls a page in the library. It is sent
    // continuously because a smooth scroll is not a series of presses.
    if let Some(window) = app.get_webview_window(WINDOW) {
        if let Some(stick) = step.stick {
            let _ = window.emit("overlay-pad-axes", stick);
        }
        if let Some(action) = step.action {
            let _ = window.emit("overlay-pad", action);
        }
    }
}

fn capture_action(capture: Capture) -> &'static str {
    match capture {
        Capture::Shot => "capture-shot",
        Capture::Record => "capture-record",
        Capture::Replay => "capture-replay",
    }
}

pub fn status() -> OverlayStatus {
    let mut live = lock();
    let folder = if live.recording_root.as_os_str().is_empty() {
        kind_dir_from(&live.root, "recordings")
    } else {
        live.recording_root.clone()
    };
    let ready_notice = live.ready_notice.take();
    // Said once. The page draws it as a toast and the next poll has nothing.
    let cover_note = std::mem::replace(&mut live.cover_note, false);
    OverlayStatus {
        enabled: live.enabled,
        recording: live.recording.is_some() || live.native_recording.is_some(),
        replay: live.replay,
        playing: live.playing,
        ffmpeg: capture::available() || find_ffmpeg(&live.ffmpeg).is_some(),
        seconds: live.seconds,
        lengths: replay_lengths(&live.lengths),
        quality: if live.quality.is_empty() { "1080p".to_string() } else { live.quality.clone() },
        fps: live.fps.max(30),
        game: live.game.clone(),
        folder: folder.to_string_lossy().to_string(),
        note: {
            let capture_error = capture::last_error();
            if !capture_error.is_empty() { capture_error } else { live.note.clone() }
        },
        ready_notice,
        cover_note,
    }
}

pub fn hide(app: &AppHandle) {
    log::info!("overlay: hide was asked for");
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

pub fn delete_item(path: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !allowed_capture(&path) {
        return Err("That file is not one of Orbit's captures.".to_string());
    }
    if !path.is_file() {
        return Err("That file is not there any more.".to_string());
    }
    fs::remove_file(&path).map_err(|error| format!("Could not delete that capture: {error}"))
}

pub fn copy_item(path: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !allowed_capture(&path) {
        return Err("That file is not one of Orbit's captures.".to_string());
    }
    if !path.is_file() {
        return Err("That capture is not there any more.".to_string());
    }
    let extension = path.extension().and_then(|item| item.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
        return Err("Only screenshots can be copied as images.".to_string());
    }
    #[cfg(windows)]
    {
        if extension == "png" {
            return copy_png_image_with_powershell(&path);
        }
        if screenshot_dib(&path).is_none() {
            return Err("Orbit could not read that screenshot as an image.".to_string());
        }
    }
    copy_capture_to_clipboard(&path)
}

pub fn gallery() -> Vec<GalleryItem> {
    let (screenshots, recordings, replays) = {
        let live = lock();
        let screenshots = if live.screenshot_root.as_os_str().is_empty() { live.root.join("screenshots") } else { live.screenshot_root.clone() };
        let recordings = if live.recording_root.as_os_str().is_empty() { live.root.join("recordings") } else { live.recording_root.clone() };
        let replays = if live.replay_root.as_os_str().is_empty() { live.root.join("replays") } else { live.replay_root.clone() };
        (screenshots, recordings, replays)
    };
    if screenshots.as_os_str().is_empty() && recordings.as_os_str().is_empty() && replays.as_os_str().is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    collect_kind(&screenshots, "screenshot", &mut found);
    collect_kind(&recordings, "recording", &mut found);
    collect_kind(&replays, "replay", &mut found);
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
    // On Windows the panel is excluded from every capture path by its display
    // affinity, so a picture taken from it is a picture of the game. Other
    // desktops have no such flag, so the panel steps aside for the one frame.
    #[cfg(not(windows))]
    let was_open = is_open();
    #[cfg(not(windows))]
    if was_open {
        conceal(app);
        thread::sleep(Duration::from_millis(180));
    }
    let result = take_shot(stamp);
    #[cfg(not(windows))]
    if was_open {
        show_window(app);
    }
    let _ = app;
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
        let copied = if path.as_os_str().is_empty() { String::new() } else { clipboard_note(&path) };
        let message = format!("Saved the recording as {name}.{copied}");
        remember(&Ok(message.clone()));
        return Ok(message);
    }
    drop(_held);
    // The panel stays up. Hiding it used to look like the overlay reloaded, and
    // pausing the grab made the game look frozen for as long as it was open.
    let _ = app;
    stop_buffer();
    let started = spawn_recording(stamp);
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
    // The clip is already written to its own file. Hiding the panel does not
    // change it, and it was what made a length button look like a reload.
    let _ = app;
    let result = save_kept(seconds, stamp);
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
    let mut guarded = std::time::Instant::now();
    loop {
        if STOP.load(Ordering::SeqCst) {
            break;
        }
        if ASKED.swap(false, Ordering::SeqCst) {
            // The call borrows this thread's handle. The callback needs its own.
            let panel = app.clone();
            let _ = app.run_on_main_thread(move || toggle_on_main(&panel));
        }
        // The panel is an ordinary topmost window, and a game can put itself
        // back in front of one. While the panel is open, keep it where the
        // player left it - and check that it is still there at all.
        if OPEN.load(Ordering::SeqCst) {
            if guarded.elapsed() >= PANEL_GUARD {
                guarded = std::time::Instant::now();
                let panel = app.clone();
                let _ = app.run_on_main_thread(move || guard_panel(&panel));
            }
        }
        if RESTING.load(Ordering::SeqCst)
            && !OPEN.load(Ordering::SeqCst)
            && !CHECKING.swap(true, Ordering::SeqCst)
        {
            let panel = app.clone();
            let posted = app.run_on_main_thread(move || {
                sync_click_through(&panel);
                CHECKING.store(false, Ordering::SeqCst);
            });
            if posted.is_err() {
                CHECKING.store(false, Ordering::SeqCst);
            }
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
    // A pinned panel is visible but not the opened overlay. Alt+X should open it.
    //
    // The panel's own state decides, not whether Windows gave it the focus.
    // A fullscreen game takes the focus back the moment the panel appears, and
    // asking `is_focused` then made Alt+X open the panel again instead of
    // closing it: the panel could not be closed and looked like a flash.
    if visible && !RESTING.load(Ordering::SeqCst) {
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
    // Leave capture protection off so Windows screenshot tools can include the
    // overlay. Orbit's own screen captures can include it as well.
    let window = tauri::WebviewWindowBuilder::new(app, WINDOW, tauri::WebviewUrl::App("index.html".into()))
        .title("Orbit overlay")
        .inner_size(1280.0, 720.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // Leave the overlay out of the pictures and videos Orbit itself takes,
        // and out of everyone else's too. On Windows this is
        // WDA_EXCLUDEFROMCAPTURE, so the game behind the panel is what the
        // capture sees.
        .content_protected(true)
        .visible(false)
        .focused(false)
        .center()
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .initialization_script(
            "window.__ORBIT_OVERLAY__=true;var orbitOverlayStyle=document.createElement('style');orbitOverlayStyle.textContent='html,body,#root{background:transparent!important;height:100%}body::before{display:none!important}';(document.head||document.documentElement).appendChild(orbitOverlayStyle);",
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

/// Build the panel before it is first asked for.
///
/// The first Alt+X used to pay for all of it: creating the window, starting
/// WebView2, loading the bundle and the first React render. That is the second
/// or two where the shortcut seems not to have registered. The work is done
/// here while the library sits idle instead, so the first open is as quick as
/// the ones after it. The window is created hidden, so it covers nothing, and
/// nothing that asks whether the panel is up sees it.
pub fn warm(app: &AppHandle) {
    if STOP.load(Ordering::SeqCst) || !lock().enabled {
        return;
    }
    let handle = app.clone();
    let _ = thread::Builder::new()
        .name("orbit-warm".to_string())
        .spawn(move || {
            // The library's own first paint comes first; this is the idle work
            // after it, not a competitor for the same CPU.
            thread::sleep(Duration::from_secs(3));
            if STOP.load(Ordering::SeqCst) {
                return;
            }
            let panel = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = ensure_window(&panel);
            });
        });
}

fn show_window(app: &AppHandle) {
    let Some(window) = ensure_window(app) else { return };
    // Keep the capture loop running while the panel is visible; pausing it
    // would repeat one frame for as long as the panel stayed open.
    RESTING.store(false, Ordering::SeqCst);
    IGNORE.store(false, Ordering::SeqCst);
    capture::set_paused(false);
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.set_focusable(true);
    cover_screen(&window);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    // `set_focus` can be refused for a process that does not own the
    // foreground. A hotkey press does hand that right over, so ask Windows
    // directly as a second try; a game that keeps the focus leaves the panel
    // unanswerable even though it is on screen.
    raise(&window);
    topmost(&window);
    FRONT_WARNED.store(false, Ordering::SeqCst);
    FRONT_TRIES_CELL.store(0, Ordering::SeqCst);
    *SHOWN_AT.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(std::time::Instant::now());
    heartbeat();
    OPEN.store(true, Ordering::SeqCst);
    log::info!("overlay: the panel opened");
    tell(app, "overlay-visible", "true");
    let _ = window.emit("overlay-shown", ());
    // A window built for this press has not loaded its page yet, so that first
    // event lands before anything is listening. Send it again once the page has
    // had time to mount: a panel that misses the event draws nothing, which is
    // a flash with no overlay behind it.
    let again = window.clone();
    let _ = thread::Builder::new()
        .name("orbit-overlay-shown".to_string())
        .spawn(move || {
            thread::sleep(Duration::from_millis(400));
            if is_open() && again.is_visible().unwrap_or(false) {
                // A game that took the foreground back in the meantime has the
                // panel behind it; the second look is a good moment to return.
                raise(&again);
                let _ = again.emit("overlay-shown", ());
            }
        });
}

/// Cover the monitor the game is on.
///
/// This used to be the primary monitor, always. On a desk with two screens the
/// game is often on the second one, and a panel that opens on the other screen
/// is not an overlay over the game: the player looks at the game, sees nothing,
/// and presses Alt+X again, which closes the panel again. That is the flash.
///
/// The game is the foreground window. With no game in front (Orbit itself, the
/// desktop) the panel goes to the monitor under the pointer, and the primary
/// screen is the last answer.
fn cover_screen(window: &tauri::WebviewWindow) {
    let monitors = window.available_monitors().unwrap_or_default();
    let chosen = game_monitor(&monitors)
        .or_else(|| monitor_at_cursor(window, &monitors))
        .or_else(|| {
            window
                .primary_monitor()
                .ok()
                .flatten()
                .and_then(|primary| monitors.iter().position(|item| item.position() == primary.position()))
        })
        .or_else(|| if monitors.is_empty() { None } else { Some(0) });
    let Some(index) = chosen else { return };
    let monitor = &monitors[index];
    let pos = monitor.position();
    let size = monitor.size();
    let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
    let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
}

/// The monitor that holds most of the window in front, if that window belongs
/// to another program. Orbit's own windows are not the game.
fn game_monitor(monitors: &[tauri::Monitor]) -> Option<usize> {
    let (left, top, right, bottom, _) = foreground_rect()?;
    monitor_for_rect(monitors, (left, top, right, bottom))
}

fn monitor_for_rect(monitors: &[tauri::Monitor], rect: (i32, i32, i32, i32)) -> Option<usize> {
    let (left, top, right, bottom) = rect;
    let mut best: Option<(i64, usize)> = None;
    for (index, monitor) in monitors.iter().enumerate() {
        let pos = monitor.position();
        let size = monitor.size();
        let x1 = left.max(pos.x);
        let y1 = top.max(pos.y);
        let x2 = right.min(pos.x.saturating_add(size.width as i32));
        let y2 = bottom.min(pos.y.saturating_add(size.height as i32));
        let area = (x2 - x1).max(0) as i64 * (y2 - y1).max(0) as i64;
        if area > 0 && best.map(|(best, _)| area > best).unwrap_or(true) {
            best = Some((area, index));
        }
    }
    best.map(|(_, index)| index)
}

fn monitor_at_cursor(window: &tauri::WebviewWindow, monitors: &[tauri::Monitor]) -> Option<usize> {
    let cursor = window.cursor_position().ok()?;
    let x = cursor.x.round() as i32;
    let y = cursor.y.round() as i32;
    monitors.iter().position(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        x >= pos.x
            && y >= pos.y
            && x < pos.x.saturating_add(size.width as i32)
            && y < pos.y.saturating_add(size.height as i32)
    })
}

/// The window in front: where it is, and whether it draws its own frame.
///
/// A game that fills a screen has no title bar, which is what tells it apart
/// from a maximised browser the player switched to on purpose.
type Front = (i32, i32, i32, i32, bool);

/// The window in front, when it is another program's.
#[cfg(windows)]
fn foreground_rect() -> Option<Front> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        GWL_STYLE, WS_CAPTION,
    };
    unsafe {
        let handle = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(handle, Some(&mut pid));
        // A null handle answers zero here, so this covers it too. Orbit's own
        // panel is not the game, and neither is a minimised window.
        if pid == 0 || pid == std::process::id() || IsIconic(handle).as_bool() {
            return None;
        }
        let mut rect = RECT::default();
        if GetWindowRect(handle, &mut rect).is_err() || rect.right <= rect.left || rect.bottom <= rect.top {
            return None;
        }
        let style = GetWindowLongW(handle, GWL_STYLE) as u32;
        let framed = style & WS_CAPTION.0 != 0;
        Some((rect.left, rect.top, rect.right, rect.bottom, !framed))
    }
}

#[cfg(not(windows))]
fn foreground_rect() -> Option<Front> {
    None
}

/// The page said it is alive.
///
/// The panel's own window can outlive the web view inside it: a crashed
/// renderer leaves the same rectangle on screen with nothing drawn in it, which
/// is exactly what an overlay that vanishes looks like. This is the proof that
/// the page is still there, and `guard_panel` is what acts when it stops.
pub fn heartbeat() {
    *HEARD.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(std::time::Instant::now());
}

/// Rebuild the panel's window and open it again.
fn revive(app: &AppHandle) {
    let allowed = {
        let mut done = REVIVED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = std::time::Instant::now();
        done.retain(|at| now.duration_since(*at) < Duration::from_secs(60));
        if done.len() >= REVIVALS {
            false
        } else {
            done.push(now);
            true
        }
    };
    if !allowed {
        // A page that dies three times in a minute is not going to hold.
        OPEN.store(false, Ordering::SeqCst);
        log::warn!("overlay: the panel did not stay loaded; leaving it closed");
        tell(app, "overlay-toast", "The overlay could not stay open. See Settings, then try again.");
        return;
    }
    log::warn!("overlay: the panel went away; rebuilding it");
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
        if window.destroy().is_err() {
            let _ = window.close();
        }
    }
    OPEN.store(false, Ordering::SeqCst);
    heartbeat();
    show_window(app);
}

/// While the panel is open, make sure it is still the thing the player is
/// looking at.
///
/// Three things can take an open panel away, and all three look the same from
/// the chair: the window is gone, the window is there but empty because its
/// web view died, or the game is in front of it. Each is dealt with here rather
/// than left to the player to notice.
fn guard_panel(app: &AppHandle) {
    if !OPEN.load(Ordering::SeqCst) || STOP.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_webview_window(WINDOW) else {
        log::warn!("overlay: the window is gone while the panel is open");
        revive(app);
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        log::warn!("overlay: the window was hidden while the panel is open");
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        raise(&window);
        heartbeat();
        let _ = window.emit("overlay-shown", ());
        return;
    }
    // The page has to have spoken. A slow first load is given longer than a
    // page that has already answered once and then went quiet.
    let quiet = HEARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .map(|at| at.elapsed());
    let since = SHOWN_AT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .map(|at| at.elapsed())
        .unwrap_or_default();
    let stale = match quiet {
        Some(silent) => silent >= PAGE_SILENT,
        None => since >= PAGE_START,
    };
    if stale {
        log::warn!(
            "overlay: the page stopped answering after {} ms; rebuilding",
            quiet.map(|at| at.as_millis()).unwrap_or_default()
        );
        revive(app);
        return;
    }
    // The window is healthy. The only thing left that can hide it is the game
    // painting over it.
    if !foreground_covers(&window) {
        return;
    }
    let tries = FRONT_TRIES_CELL.load(Ordering::SeqCst);
    if tries < FRONT_TRIES {
        // The first try is the foreground alone. After that the panel also
        // re-enters the top of the always-on-top group, which needs no right to
        // the foreground and so cannot be refused.
        raise(&window);
        if tries > 0 {
            let _ = window.set_always_on_top(false);
            let _ = window.set_always_on_top(true);
            topmost(&window);
        }
        FRONT_TRIES_CELL.store(tries + 1, Ordering::SeqCst);
        return;
    }
    if !FRONT_WARNED.swap(true, Ordering::SeqCst) {
        // Nothing Orbit draws can be put over a game that owns the screen, so
        // the words are kept for the next open, which the player does see.
        log::warn!("overlay: the game is holding the screen; the panel is behind it");
        lock().cover_note = true;
    }
}

/// Whether another program's window is in front and fills the monitor the
/// panel is on. Orbit's own windows do not count: the panel itself is one.
fn foreground_covers(window: &tauri::WebviewWindow) -> bool {
    let Some((left, top, right, bottom, frameless)) = foreground_rect() else { return false };
    // A maximised window has a title bar. A game filling the screen does not:
    // without this, alt-tabbing to any maximised program would look like a
    // fullscreen game and the panel would keep taking the front back.
    if !frameless {
        return false;
    }
    // The monitor the panel was put on. Not every driver answers
    // `current_monitor` for a window that is not focused, so the panel's own
    // rectangle is the fallback: it was sized to the monitor when it opened.
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| (monitor.position(), monitor.size()))
        .or_else(|| window.outer_position().ok().and_then(|at| {
            window
                .available_monitors()
                .unwrap_or_default()
                .into_iter()
                .find(|monitor| {
                    let pos = monitor.position();
                    let size = monitor.size();
                    at.x >= pos.x
                        && at.y >= pos.y
                        && at.x < pos.x.saturating_add(size.width as i32)
                        && at.y < pos.y.saturating_add(size.height as i32)
                })
                .map(|monitor| (monitor.position(), monitor.size()))
        }))
        .or_else(|| {
            window
                .available_monitors()
                .unwrap_or_default()
                .first()
                .map(|monitor| (monitor.position(), monitor.size()))
        });
    let Some((pos, size)) = monitor else { return false };
    let width = size.width as i32;
    let height = size.height as i32;
    if width <= 0 || height <= 0 {
        return false;
    }
    let x1 = left.max(pos.x);
    let y1 = top.max(pos.y);
    let x2 = right.min(pos.x.saturating_add(width));
    let y2 = bottom.min(pos.y.saturating_add(height));
    let across = (x2 - x1).max(0);
    let down = (y2 - y1).max(0);
    // Nine tenths is enough: a borderless game can be a few pixels short of the
    // monitor, while a windowed one never comes close.
    across * 10 >= width * 9 && down * 10 >= height * 9
}

/// Put the window at the front of the always-on-top group without asking for
/// the foreground. This is the part that cannot be refused.
#[cfg(windows)]
fn topmost(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };
    if let Ok(handle) = window.hwnd() {
        unsafe {
            let _ = SetWindowPos(
                handle,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[cfg(not(windows))]
fn topmost(_window: &tauri::WebviewWindow) {}

/// Put the panel in front of the game, and let it take the keyboard.
#[cfg(windows)]
fn raise(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    if let Ok(handle) = window.hwnd() {
        unsafe {
            let _ = SetForegroundWindow(handle);
        }
    }
}

#[cfg(not(windows))]
fn raise(_window: &tauri::WebviewWindow) {}

/// Hide even a pinned panel, for the one moment a picture is taken.
#[cfg(not(windows))]
fn conceal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
}

fn hide_window(app: &AppHandle) {
    if HAS_PINS.load(Ordering::SeqCst) {
        rest_window(app);
        return;
    }
    // A hidden panel is still a web view. Closing it drops those processes
    // until the overlay is opened again. A pinned box has to stay.
    close_panel(app);
}

fn rest_window(app: &AppHandle) {
    log::info!("overlay: the panel is resting against its pins");
    OPEN.store(false, Ordering::SeqCst);
    RESTING.store(true, Ordering::SeqCst);
    FRONT_TRIES_CELL.store(0, Ordering::SeqCst);
    capture::set_paused(false);
    if let Some(window) = ensure_window(app) {
        cover_screen(&window);
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focusable(false);
        let _ = window.set_ignore_cursor_events(true);
        IGNORE.store(true, Ordering::SeqCst);
        let _ = window.emit("overlay-rest", ());
    }
    tell(app, "overlay-visible", "false");
}

fn mark_hidden(app: &AppHandle) {
    log::info!("overlay: the panel's window was destroyed");
    OPEN.store(false, Ordering::SeqCst);
    *HEARD.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    *SHOWN_AT.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    FRONT_TRIES_CELL.store(0, Ordering::SeqCst);
    capture::set_paused(false);
    tell(app, "overlay-visible", "false");
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.emit("overlay-hidden", ());
    }
}

fn tell(app: &AppHandle, event: &str, payload: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, payload);
    }
}

fn take_shot(stamp: &str) -> Result<String, String> {
    let dir = game_dir("screenshots")?;
    if capture::available() {
        let path = clip_path(&dir, &capture_name_for_dir(&dir), stamp, "jpg");
        if capture::save_picture(&path, current_spec()).is_ok() {
            return saved_picture(&path);
        }
    }
    let path = clip_path(&dir, &capture_name_for_dir(&dir), stamp, "png");
    #[cfg(windows)]
    if powershell_shot(&path).is_ok() {
        return saved_picture(&path);
    }
    #[cfg(target_os = "linux")]
    if linux_shot(&path).is_ok() {
        return saved_picture(&path);
    }
    if let Some(ffmpeg) = find_ffmpeg(&lock().ffmpeg) {
        if ffmpeg_shot(&ffmpeg, &path).is_ok() {
            return saved_picture(&path);
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

#[cfg(target_os = "linux")]
fn system_audio_monitor() -> Option<String> {
    let direct = process::command("pactl").args(["get-default-sink"]).output().ok();
    let sink = direct
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let output = process::command("pactl").arg("info").output().ok()?;
            if !output.status.success() {
                return None;
            }
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| line.strip_prefix("Default Sink:").map(str::trim).map(str::to_string))
                .filter(|value| !value.is_empty())
        })?;
    Some(format!("{sink}.monitor"))
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
    let path = clip_path(&dir, &capture_name_for_dir(&dir), stamp, "mp4");
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
    #[cfg(windows)]
    return Err("Orbit could not start its built-in audio recorder, and the ffmpeg fallback cannot preserve system audio.".to_string());

    let ffmpeg = find_ffmpeg(&lock().ffmpeg).ok_or_else(ffmpeg_missing)?;
    let dir = game_dir("recordings")?;
    let path = clip_path(&dir, &capture_name_for_dir(&dir), stamp, "mp4");
    let mut command = process::command(&ffmpeg);
    command.arg("-y");
    push_grab(&mut command, Some(quality_fps(lock().fps)))?;
    #[cfg(target_os = "linux")]
    {
        let source = system_audio_monitor().ok_or_else(|| {
            "Orbit could not find the system-audio monitor. A PulseAudio-compatible output is required for audio capture.".to_string()
        })?;
        command.args(["-thread_queue_size", "512", "-f", "pulse", "-i"]).arg(source);
        command.args(["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "160k"]);
    }
    let quality = lock().quality.clone();
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
            #[cfg(windows)]
            Err(error) => return Err(error),
            #[cfg(not(windows))]
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

/// The rolling replay is a temporary file, not a memory ring. Keeping it in
/// Orbit's own folder lets a crash leave nothing in a game directory, and the
/// files are removed as soon as the session ends.
fn replay_workspace() -> PathBuf {
    let root = lock().root.clone();
    if root.as_os_str().is_empty() {
        std::env::temp_dir().join("orbit-replay")
    } else {
        root.join("replay")
    }
}

fn start_native_buffer() -> Result<(), String> {
    lock().note.clear();
    let keep = Duration::from_secs(lock().keep.max(1) as u64 + 2);
    let hold = capture::start_buffer(keep, current_spec(), replay_workspace())?;
    #[cfg(target_os = "linux")]
    let audio = {
        let Some(ffmpeg) = find_ffmpeg(&lock().ffmpeg) else {
            let _ = capture::finish(hold);
            return Err("System audio replay needs ffmpeg with PulseAudio input support.".to_string());
        };
        let Some(buffer) = hold.buffer() else {
            let _ = capture::finish(hold);
            return Err("The replay buffer could not be opened.".to_string());
        };
        match start_replay_audio(&ffmpeg, buffer) {
            Ok(audio) => Some(audio),
            Err(error) => {
                let _ = capture::finish(hold);
                return Err(error);
            }
        }
    };
    let mut live = lock();
    live.native_buffer = Some(hold);
    #[cfg(target_os = "linux")]
    if let Some((child, stop, thread)) = audio {
        live.audio_buffer = Some(child);
        live.audio_stop = Some(stop);
        live.audio_thread = Some(thread);
    }
    Ok(())
}

/// ffmpeg's pictures go into the same temporary replay file as the native path.
/// Nothing is kept as a finished video until the player saves one.
fn start_pipe_buffer() -> Result<(), String> {
    lock().note.clear();
    let ffmpeg = match find_ffmpeg(&lock().ffmpeg) {
        Some(path) => path,
        None => return Ok(()),
    };
    let keep = Duration::from_secs(lock().keep.max(1) as u64 + 2);
    let fps = lock().fps.max(1);
    let buffer = capture::Buffer::new(&replay_workspace(), fps, keep)?;
    let mut command = process::command(&ffmpeg);
    command.arg("-y");
    push_grab(&mut command, Some(quality_fps(fps)))?;
    // This worker pipes JPEG frames only; system audio is captured into the same
    // replay file by the companion PCM worker below.
    command.arg("-an");
    let scale = quality_scale(&lock().quality).unwrap_or("");
    let filter = if scale.is_empty() {
        format!("fps={}", quality_fps(fps))
    } else {
        format!("fps={},{}", quality_fps(fps), scale)
    };
    command.args(["-vf", &filter]);
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
    let _reader = match thread::Builder::new()
        .name("orbit-replay".to_string())
        .spawn(move || read_jpeg_pipe(stdout, shared, flag))
    {
        Ok(reader) => reader,
        Err(error) => {
            kill_now(child);
            return Err(format!("Could not start the picture buffer: {error}"));
        }
    };
    #[cfg(target_os = "linux")]
    let audio = match start_replay_audio(&ffmpeg, buffer.clone()) {
        Ok(audio) => audio,
        Err(error) => {
            kill_now(child);
            return Err(error);
        }
    };
    let mut live = lock();
    live.buffer = Some(child);
    live.pipe_stop = Some(stop);
    live.replay_frames = Some(buffer);
    #[cfg(target_os = "linux")]
    {
        live.audio_buffer = Some(audio.0);
        live.audio_stop = Some(audio.1);
        live.audio_thread = Some(audio.2);
    }
    Ok(())
}

fn stop_buffer() {
    let _held = gate();
    #[cfg(target_os = "linux")]
    if let Some(stop) = lock().audio_stop.take() {
        stop.store(true, Ordering::SeqCst);
    }
    #[cfg(target_os = "linux")]
    if let Some(child) = lock().audio_buffer.take() {
        stop_child(child);
    }
    #[cfg(target_os = "linux")]
    if let Some(reader) = lock().audio_thread.take() {
        let _ = reader.join();
    }
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
    // The buffer removes its own files, but a file written by a process that
    // died before it could clean up is still on disk. Nothing is playing now,
    // so anything left in the folder is rubbish.
    capture::clear_replay_files(&replay_workspace());
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
    let path = clip_path(&dir, &format!("{} last {seconds}s", capture_name_for_dir(&dir)), stamp, "mp4");
    encode_kept(&path, &kept)?;
    let name = path
        .file_name()
        .map(|item| item.to_string_lossy().to_string())
        .unwrap_or_else(|| "the clip".to_string());
    let covered = kept.frame_count() as u32 / kept.fps.max(1);
    let copied = clipboard_note(&path);
    if covered + 1 < seconds {
        return Ok(format!("Saved what was kept, which is shorter than {seconds} seconds, as {name}.{copied}"));
    }
    Ok(format!("Saved the last {seconds} seconds as {name}.{copied}"))
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
    if !kept.has_audio() {
        return Err("No system audio was captured, so Orbit did not save a silent replay.".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let audio_path = path.with_extension("orbit-audio.wav");
    if let Err(error) = capture::write_audio_wav(&audio_path, kept) {
        let _ = fs::remove_file(&audio_path);
        return Err(error);
    }
    let rate = kept.fps.max(1).to_string();
    let mut command = process::command(ffmpeg);
    command.args(["-y", "-f", "image2pipe", "-framerate"]);
    command.arg(&rate);
    command.args(["-i", "pipe:0", "-i"]).arg(&audio_path);
    command.args([
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
    ]);
    command.arg(path);
    command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&audio_path);
            return Err(format!("Could not start ffmpeg: {error}"));
        }
    };
    let write_result = child.stdin.as_mut().ok_or_else(|| "ffmpeg did not accept the pictures.".to_string()).and_then(|stdin| {
        for index in 0..kept.frame_count() {
            let frame = kept.frame(index)?;
            stdin.write_all(&frame).map_err(|error| error.to_string())?;
        }
        Ok(())
    });
    drop(child.stdin.take());
    let status = child.wait().map_err(|error| error.to_string());
    if let Err(error) = write_result {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(&audio_path);
        return Err(error);
    }
    let succeeded = status.map(|item| item.success()).unwrap_or(false) && !missing_video(path);
    let _ = fs::remove_file(&audio_path);
    if succeeded {
        return Ok(());
    }
    let _ = fs::remove_file(path);
    Err("The video file was empty.".to_string())
}

#[cfg(target_os = "linux")]
fn start_replay_audio(
    ffmpeg: &Path,
    buffer: capture::Buffer,
) -> Result<(Child, Arc<AtomicBool>, thread::JoinHandle<()>), String> {
    let monitor = system_audio_monitor().ok_or_else(|| {
        "Orbit could not find the system-audio monitor. A PulseAudio-compatible output is required for replay audio.".to_string()
    })?;
    let mut command = process::command(ffmpeg);
    command.args(["-hide_banner", "-loglevel", "error", "-thread_queue_size", "512", "-f", "pulse", "-i"]);
    command.arg(monitor);
    command.args(["-ac", "2", "-ar", "48000", "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"]);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| format!("Could not start system-audio capture: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        kill_now(child);
        return Err("ffmpeg did not open a system-audio stream.".to_string());
    };
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let reader = match thread::Builder::new()
        .name("orbit-audio-replay".to_string())
        .spawn(move || read_audio_pipe(stdout, buffer, flag))
    {
        Ok(reader) => reader,
        Err(error) => {
            kill_now(child);
            return Err(format!("Could not start the audio buffer: {error}"));
        }
    };
    Ok((child, stop, reader))
}

#[cfg(target_os = "linux")]
fn read_audio_pipe(mut stdout: impl Read, buffer: capture::Buffer, stop: Arc<AtomicBool>) {
    let mut pending = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut captured_frames = 0usize;
    loop {
        let read = match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(_) => break,
        };
        pending.extend_from_slice(&chunk[..read]);
        let aligned = pending.len() / 4 * 4;
        if aligned > 0 {
            let pcm: Vec<u8> = pending.drain(..aligned).collect();
            captured_frames = captured_frames.saturating_add(aligned / 4);
            buffer.push_audio_pcm(pcm);
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
    }
    if !stop.load(Ordering::SeqCst) {
        lock().note = if captured_frames == 0 {
            "The system-audio stream ended before Orbit captured any audio.".to_string()
        } else {
            "The system-audio stream stopped unexpectedly; saved replays may be shorter.".to_string()
        };
    }
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
                buffer.push_jpeg(&jpeg, width, height);
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

fn configured_capture_dir(root: &Path, selected: &str, kind: &str) -> PathBuf {
    if selected.trim().is_empty() {
        if root.as_os_str().is_empty() { PathBuf::new() } else { root.join(kind) }
    } else {
        PathBuf::from(selected.trim())
    }
}

fn kind_name(kind: &str) -> &'static str {
    match kind {
        "screenshots" | "screenshot" | "shots" => "screenshots",
        "replays" | "replay" => "replays",
        _ => "recordings",
    }
}

fn kind_dir(kind: &str) -> Result<PathBuf, String> {
    let name = kind_name(kind);
    let live = lock();
    let selected = match name {
        "screenshots" => &live.screenshot_root,
        "replays" => &live.replay_root,
        _ => &live.recording_root,
    };
    if !selected.as_os_str().is_empty() {
        return Ok(selected.clone());
    }
    if live.root.as_os_str().is_empty() {
        return Err("Orbit is still starting.".to_string());
    }
    Ok(live.root.join(name))
}

fn kind_dir_from(root: &Path, kind: &str) -> PathBuf {
    root.join(kind_name(kind))
}

fn capture_label(game: &str, playing: bool) -> String {
    if playing && !game.trim().is_empty() {
        game.to_string()
    } else {
        "Desktop".to_string()
    }
}

fn capture_name() -> String {
    let live = lock();
    capture_label(&live.game, live.playing)
}

fn capture_name_for_dir(dir: &Path) -> String {
    dir.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(capture_name)
}

fn game_dir(kind: &str) -> Result<PathBuf, String> {
    let dir = kind_dir(kind)?.join(safe_name(&capture_name()));
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
    for kind in ["screenshots", "recordings", "replays"] {
        let Ok(base) = kind_dir(kind) else { continue };
        let Ok(base) = base.canonicalize() else { continue };
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

fn saved_picture(path: &Path) -> Result<String, String> {
    Ok(format!("{}{}", saved_name("Saved the picture as", path), clipboard_note(path)))
}

fn clipboard_note(path: &Path) -> String {
    match copy_capture_to_clipboard(path) {
        Ok(()) => " Copied to clipboard.".to_string(),
        Err(error) => format!(" Clipboard copy failed: {error}"),
    }
}

/// Copy the saved media as a file, so Paste works in Explorer/Finder and in apps
/// that accept file attachments. On Windows, screenshots also get a native image
/// format for apps that expect pixels rather than a file.
#[cfg(windows)]
fn screenshot_dib(path: &Path) -> Option<Vec<u8>> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if extension != "jpg" && extension != "jpeg" {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let (width, height, bgra) = capture::decode_jpeg(&bytes).ok()?;
    dib_24bit(width, height, &bgra)
}

#[cfg(windows)]
fn dib_24bit(width: u32, height: u32, bgra: &[u8]) -> Option<Vec<u8>> {
    let width_usize = usize::try_from(width).ok()?;
    let height_usize = usize::try_from(height).ok()?;
    if width_usize == 0 || height_usize == 0 || width_usize > i32::MAX as usize || height_usize > i32::MAX as usize {
        return None;
    }
    let pixels = width_usize.checked_mul(height_usize)?;
    if bgra.len() != pixels.checked_mul(4)? {
        return None;
    }
    let row_bytes = width_usize.checked_mul(3)?;
    let stride = row_bytes.checked_add(3)? & !3;
    let image_bytes = stride.checked_mul(height_usize)?;
    let image_size = u32::try_from(image_bytes).ok()?;
    let mut dib = Vec::with_capacity(40usize.checked_add(image_bytes)?);
    dib.extend_from_slice(&40u32.to_le_bytes());
    dib.extend_from_slice(&(width as i32).to_le_bytes());
    dib.extend_from_slice(&(height as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes());
    dib.extend_from_slice(&24u16.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    dib.extend_from_slice(&image_size.to_le_bytes());
    dib.extend_from_slice(&0i32.to_le_bytes());
    dib.extend_from_slice(&0i32.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes());
    for row in (0..height_usize).rev() {
        let begin = row * width_usize * 4;
        for pixel in bgra[begin..begin + width_usize * 4].chunks_exact(4) {
            dib.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
        }
        let padding = stride - row_bytes;
        let end = dib.len().checked_add(padding)?;
        dib.resize(end, 0);
    }
    Some(dib)
}

#[cfg(windows)]
fn copy_png_image_with_powershell(path: &Path) -> Result<(), String> {
    let escaped = path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; $image = [System.Drawing.Image]::FromFile('{escaped}'); try {{ [System.Windows.Forms.Clipboard]::SetImage($image) }} finally {{ $image.Dispose() }}"
    );
    let output = process::command("powershell")
        .args(["-NoProfile", "-STA", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| format!("Could not start PowerShell to copy the image: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() { "PowerShell could not copy the image.".to_string() } else { detail })
    }
}

#[cfg(windows)]
fn copy_capture_to_clipboard(path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(owner: *mut c_void) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, data: *mut c_void) -> *mut c_void;
        fn CloseClipboard() -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }

    let allocate = |bytes: &[u8]| -> Result<*mut c_void, String> {
        let memory = unsafe { GlobalAlloc(0x0002 | 0x0040, bytes.len()) }; // GMEM_MOVEABLE | GMEM_ZEROINIT
        if memory.is_null() {
            return Err("Windows could not allocate clipboard memory.".to_string());
        }
        let data = unsafe { GlobalLock(memory) };
        if data.is_null() {
            unsafe { GlobalFree(memory); }
            return Err("Windows could not lock clipboard memory.".to_string());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), data.cast::<u8>(), bytes.len());
            GlobalUnlock(memory);
        }
        Ok(memory)
    };

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.extend([0, 0]);
    let header_size = 20u32; // DROPFILES: DWORD, POINT, BOOL, BOOL.
    let mut file_data = Vec::with_capacity(header_size as usize + wide.len() * 2);
    file_data.extend_from_slice(&header_size.to_le_bytes());
    file_data.extend_from_slice(&0i32.to_le_bytes());
    file_data.extend_from_slice(&0i32.to_le_bytes());
    file_data.extend_from_slice(&0i32.to_le_bytes());
    file_data.extend_from_slice(&1i32.to_le_bytes());
    for unit in wide {
        file_data.extend_from_slice(&unit.to_le_bytes());
    }
    let file_memory = allocate(&file_data)?;
    let image_dib = screenshot_dib(path);
    let extension = path.extension().and_then(|item| item.to_str()).unwrap_or("").to_ascii_lowercase();
    if image_dib.is_none() && extension == "png" && copy_png_image_with_powershell(path).is_ok() {
        unsafe { GlobalFree(file_memory); }
        return Ok(());
    }
    let image_memory = image_dib.and_then(|dib| allocate(&dib).ok()).unwrap_or(std::ptr::null_mut());
    if unsafe { OpenClipboard(std::ptr::null_mut()) } == 0 {
        unsafe {
            GlobalFree(file_memory);
            if !image_memory.is_null() {
                GlobalFree(image_memory);
            }
        }
        return Err("Windows clipboard is busy.".to_string());
    }
    let emptied = unsafe { EmptyClipboard() } != 0;
    let file_stored = emptied && !unsafe { SetClipboardData(15, file_memory) }.is_null(); // CF_HDROP
    let image_stored = emptied && !image_memory.is_null() && !unsafe { SetClipboardData(8, image_memory) }.is_null(); // CF_DIB
    unsafe { CloseClipboard(); }
    if !file_stored {
        unsafe {
            GlobalFree(file_memory);
        }
    }
    if !image_memory.is_null() && !image_stored {
        unsafe {
            GlobalFree(image_memory);
        }
    }
    if file_stored || image_stored {
        Ok(())
    } else {
        Err("Windows could not copy the file to the clipboard.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn copy_capture_to_clipboard(path: &Path) -> Result<(), String> {
    let extension = path.extension().and_then(|item| item.to_str()).unwrap_or("").to_ascii_lowercase();
    let image_type = match extension.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        _ => None,
    };
    if let Some(image_type) = image_type {
        if let Ok(image) = fs::read(path) {
            let mut last = String::new();
            let wayland_args = ["--type", image_type];
            let x11_args = ["-selection", "clipboard", "-t", image_type, "-i"];
            for (program, args) in [("wl-copy", &wayland_args[..]), ("xclip", &x11_args[..])] {
                match send_clipboard(program, args, &image) {
                    Ok(()) => return Ok(()),
                    Err(error) => last = error,
                }
            }
            if !last.is_empty() {
                log::debug!("could not copy screenshot pixels, trying the file instead: {last}");
            }
        }
    }
    let uri = file_uri(path)?;
    let files = format!("copy\n{uri}\n");
    let uri_list = format!("{uri}\r\n");
    let mut last = String::new();
    for (program, args, data) in [
        ("wl-copy", & ["--type", "x-special/gnome-copied-files"][..], files.as_bytes()),
        ("xclip", & ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-i"][..], files.as_bytes()),
        ("wl-copy", & ["--type", "text/uri-list"][..], uri_list.as_bytes()),
        ("xclip", & ["-selection", "clipboard", "-t", "text/uri-list", "-i"][..], uri_list.as_bytes()),
    ] {
        match send_clipboard(program, args, data) {
            Ok(()) => return Ok(()),
            Err(error) => last = error,
        }
    }
    Err(if last.is_empty() { "No desktop clipboard helper was found.".to_string() } else { last })
}

#[cfg(target_os = "macos")]
fn copy_capture_to_clipboard(path: &Path) -> Result<(), String> {
    let escaped = path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let image_class = match path.extension().and_then(|item| item.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => Some("PNGf"),
        "jpg" | "jpeg" => Some("JPEG"),
        _ => None,
    };
    if let Some(class) = image_class {
        let script = format!("set the clipboard to (read (POSIX file \"{escaped}\") as «class {class}»)");
        if process::command("osascript").arg("-e").arg(script).output().is_ok_and(|output| output.status.success()) {
            return Ok(());
        }
    }
    let script = format!("set the clipboard to (POSIX file \"{escaped}\" as alias)");
    if process::command("osascript").arg("-e").arg(script).output().is_ok_and(|output| output.status.success()) {
        return Ok(());
    }
    let uri = file_uri(path)?;
    send_clipboard("pbcopy", &[], uri.as_bytes())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn copy_capture_to_clipboard(_path: &Path) -> Result<(), String> {
    Err("File clipboard support is not available on this system.".to_string())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn send_clipboard(program: &str, args: &[&str], data: &[u8]) -> Result<(), String> {
    let mut child = process::command(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;
    let mut input = child.stdin.take().ok_or_else(|| format!("Could not write to {program}."))?;
    input.write_all(data).map_err(|error| format!("Could not write to the clipboard: {error}"))?;
    drop(input);
    let output = child.wait_with_output().map_err(|error| format!("Could not finish {program}: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if error.is_empty() { format!("{program} could not copy the file.") } else { error })
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn file_uri(path: &Path) -> Result<String, String> {
    let path = path.canonicalize().map_err(|error| format!("Could not locate the saved file: {error}"))?;
    let raw = path.to_string_lossy();
    let mut uri = String::from("file://");
    for byte in raw.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(byte) {
            uri.push(*byte as char);
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }
    Ok(uri)
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
/// crossing the dead zone counts once. Holding a direction repeats. Start+Select
/// is the overlay itself. LB is the modifier for the capture shortcuts:
/// LB+RB is a screenshot, LB+Left and LB+Right are record and replay. With LB
/// down the stick and A/B keep quiet, so a shortcut cannot also move the ring.
/// RB alone is the pad's right click, the way a mouse opens a capture's menu.
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
    let shoulder = pressed(buttons, 4);
    let trigger = pressed(buttons, 5);
    // R on its own is the pad's right click: the gallery menu on the tile the
    // ring is on. It has to be read before `right_shoulder` is updated below.
    let menu = trigger && !watch.right_shoulder;
    let dpad_left = pressed(buttons, 14);
    let dpad_right = pressed(buttons, 15);
    // An edge on the second button of a chord, so holding it does not fire
    // again every poll.
    let shot = shoulder && trigger && !(watch.left_shoulder && watch.right_shoulder);
    let record = shoulder && dpad_left && !(watch.left_shoulder && watch.dpad_left);
    let replay = shoulder && dpad_right && !(watch.left_shoulder && watch.dpad_right);
    watch.left_shoulder = shoulder;
    watch.right_shoulder = trigger;
    watch.dpad_left = dpad_left;
    watch.dpad_right = dpad_right;
    let capture = if toggle {
        None
    } else if shot {
        Some(Capture::Shot)
    } else if record {
        Some(Capture::Record)
    } else if replay {
        Some(Capture::Replay)
    } else {
        None
    };
    let dir = direction(up, down, left, right);
    // A stick already over is not a press. Record it before the panel opens,
    // or the next poll would move the first button. Holding it repeats.
    let repeated = if shoulder {
        // The direction is treated as already dealt with, so letting LB go while
        // still holding it does not step the ring.
        watch.held = dir;
        watch.ticks = 0;
        None
    } else {
        repeating(watch, dir)
    };
    let a = pressed(buttons, 0);
    let b = pressed(buttons, 1);
    let action = if toggle || capture.is_some() {
        None
    } else if let Some(dir) = repeated {
        Some(dir)
    } else if !shoulder && a && !watch.a {
        Some("activate")
    } else if !shoulder && b && !watch.b {
        Some("back")
    } else if !shoulder && menu {
        Some("menu")
    } else {
        None
    };
    watch.a = a;
    watch.b = b;
    // The right stick is streamed, not stepped: the page turns it into a
    // scroll. One idle report is sent too, or the scroll would keep its last
    // speed after the stick is let go.
    let right_x = axes.get(2).copied().unwrap_or(0.0);
    let right_y = axes.get(3).copied().unwrap_or(0.0);
    let moving = right_x.abs() > 0.12 || right_y.abs() > 0.12;
    let stick = if moving || watch.stick_moving { Some((right_x, right_y)) } else { None };
    watch.stick_moving = moving;
    Step { toggle, action, capture, stick }
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayMode {
    pub open: bool,
    pub resting: bool,
}

pub fn mode() -> OverlayMode {
    OverlayMode {
        open: OPEN.load(Ordering::SeqCst),
        resting: RESTING.load(Ordering::SeqCst),
    }
}

pub fn set_pins(has: bool) {
    HAS_PINS.store(has, Ordering::SeqCst);
}

pub fn set_hits(boxes: Vec<HitBox>) {
    *HITS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = boxes;
}

/// A pinned box should already be on screen when Orbit opens, without Alt+X.
pub fn show_pins(app: &AppHandle) {
    if STOP.load(Ordering::SeqCst) || OPEN.load(Ordering::SeqCst) || !lock().enabled {
        return;
    }
    HAS_PINS.store(true, Ordering::SeqCst);
    rest_window(app);
}


fn sync_click_through(app: &AppHandle) {
    if !RESTING.load(Ordering::SeqCst) || OPEN.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_webview_window(WINDOW) else { return };
    let over = cursor_over_hits(&window);
    let ignore = !over;
    if IGNORE.swap(ignore, Ordering::SeqCst) == ignore {
        return;
    }
    let _ = window.set_ignore_cursor_events(ignore);
    let _ = window.set_focusable(!ignore);
}

fn cursor_over_hits(window: &tauri::WebviewWindow) -> bool {
    let Ok(cursor) = window.cursor_position() else { return false };
    let Ok(origin) = window.outer_position() else { return false };
    let x = cursor.x - origin.x as f64;
    let y = cursor.y - origin.y as f64;
    let hits = HITS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    hits.iter().any(|hit| x >= hit.x && y >= hit.y && x <= hit.x + hit.w && y <= hit.y + hit.h)
}

fn replay_lengths(extra: &[u32]) -> Vec<u32> {
    let mut all = vec![30u32, 45, 60];
    for length in extra {
        let length = clamp_seconds(*length);
        if !all.contains(&length) {
            all.push(length);
        }
    }
    all.sort_unstable();
    all
}

pub(crate) fn clamp_seconds(value: u32) -> u32 {
    value.clamp(5, 300)
}

/// How many seconds to keep in memory. Switching among lengths that already fit
/// must not restart the grab.
pub(crate) fn keep_seconds(lengths: &[u32], selected: u32) -> u32 {
    let mut keep = clamp_seconds(selected).max(60);
    for length in lengths {
        keep = keep.max(clamp_seconds(*length));
    }
    keep
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
        // The right stick scrolls. Same axes as the browser pad: 2 is across,
        // 3 is down, so the sign of Y is flipped the same way.
        let rx = state.Gamepad.sThumbRX as f32 / 32767.0;
        let ry = -(state.Gamepad.sThumbRY as f32 / 32767.0);
        Some((buttons, vec![x, y, rx, ry]))
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
    fn a_desktop_capture_does_not_reuse_the_last_game_title() {
        assert_eq!(capture_label("Previously Opened", false), "Desktop");
        assert_eq!(capture_label("", true), "Desktop");
        assert_eq!(capture_label("Currently Playing", true), "Currently Playing");
    }

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
        assert_eq!(keep_seconds(&[], 30), 60);
        assert_eq!(keep_seconds(&[90, 120], 30), 120);
        assert_eq!(clamp_seconds(1), 5);
        assert_eq!(clamp_seconds(900), 300);
    }

    #[test]
    fn start_and_select_open_once_until_they_are_released() {
        let mut watch = Watch {
            both: false,
            left_shoulder: false,
            right_shoulder: false,
            dpad_left: false,
            dpad_right: false,
            a: false,
            b: false,
            held: None,
            ticks: 0,
            stick_moving: false,
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
        assert!(first.capture.is_none());
    }

    /// The shortcuts, and only once per press.
    #[test]
    fn the_shoulder_shortcuts_fire_on_the_second_button() {
        let mut watch = Watch {
            both: false,
            left_shoulder: false,
            right_shoulder: false,
            dpad_left: false,
            dpad_right: false,
            a: false,
            b: false,
            held: None,
            ticks: 0,
            stick_moving: false,
        };
        let mut buttons = vec![false; 16];
        let axes = [0.0, 0.0];
        buttons[4] = true;
        assert!(take_step(&mut watch, &buttons, &axes).capture.is_none());
        buttons[5] = true;
        assert_eq!(take_step(&mut watch, &buttons, &axes).capture, Some(Capture::Shot));
        assert!(take_step(&mut watch, &buttons, &axes).capture.is_none());
        buttons[5] = false;
        buttons[4] = false;
        take_step(&mut watch, &buttons, &axes);
        buttons[4] = true;
        assert!(take_step(&mut watch, &buttons, &axes).capture.is_none());
        // LB plus the left d-pad is a recording, and it must not also move the ring.
        buttons[14] = true;
        let step = take_step(&mut watch, &buttons, &axes);
        assert_eq!(step.capture, Some(Capture::Record));
        assert!(step.action.is_none());
        buttons[14] = false;
        buttons[15] = true;
        assert_eq!(take_step(&mut watch, &buttons, &axes).capture, Some(Capture::Replay));
        assert!(take_step(&mut watch, &buttons, &axes).capture.is_none());
    }

    /// R on its own is the pad's right click, and it is still one press.
    #[test]
    fn the_right_shoulder_alone_is_the_menu() {
        let mut watch = Watch {
            both: false,
            left_shoulder: false,
            right_shoulder: false,
            dpad_left: false,
            dpad_right: false,
            a: false,
            b: false,
            held: None,
            ticks: 0,
            stick_moving: false,
        };
        let mut buttons = vec![false; 16];
        let axes = [0.0, 0.0];
        buttons[5] = true;
        let step = take_step(&mut watch, &buttons, &axes);
        assert_eq!(step.action, Some("menu"));
        assert!(step.capture.is_none());
        // Held, it does not keep opening menus.
        assert!(take_step(&mut watch, &buttons, &axes).action.is_none());
        // With LB down the same button is the screenshot, never the menu.
        buttons[5] = false;
        take_step(&mut watch, &buttons, &axes);
        buttons[4] = true;
        take_step(&mut watch, &buttons, &axes);
        buttons[5] = true;
        let step = take_step(&mut watch, &buttons, &axes);
        assert_eq!(step.capture, Some(Capture::Shot));
        assert!(step.action.is_none());
    }

    #[test]
    fn the_theme_colour_parser_takes_a_hex_triplet() {
        assert_eq!(parse_colour("#8b5cf6"), Some(0x8b_5c_f6));
        assert_eq!(parse_colour("14122a"), Some(0x14_12_2a));
        assert_eq!(parse_colour("#12345"), None);
        assert_eq!(parse_colour("nope"), None);
    }

    #[test]
    fn a_held_direction_waits_and_then_repeats() {
        let mut watch = Watch {
            both: false,
            left_shoulder: false,
            right_shoulder: false,
            dpad_left: false,
            dpad_right: false,
            a: false,
            b: false,
            held: None,
            ticks: 0,
            stick_moving: false,
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
