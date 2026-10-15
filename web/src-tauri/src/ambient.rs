//! The background pad, played by the system rather than the web view.
//!
//! WebKitGTK's Web Audio graph often stays suspended, or builds a GStreamer
//! pipeline that never starts, and the app is then silent with no error the
//! player can see. A synthesised pad through the system sink does not depend
//! on that graph. It is the same open chord the web view plays on Windows,
//! not a bass drone. A player that exits, or that never accepts a sample, is
//! not reported as playing: the web view should try instead of staying mute.
//! Windows keeps using the web view, which already plays there.

use std::io::Write;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::process;

/// Whether a player is running. The writer thread reads this every block.
static RUN: AtomicBool = AtomicBool::new(false);
/// Master level, 0 to 1, as bits of an f32. The raw writer reads this live.
static LEVEL: AtomicU32 = AtomicU32::new(0);
/// 0 none, 1 GStreamer, 2 a raw sink. GStreamer bakes the level into the pipeline.
static KIND: AtomicU8 = AtomicU8::new(0);
/// The level the running GStreamer pipeline was started with.
static LAUNCHED: AtomicU32 = AtomicU32::new(0);

const KIND_GST: u8 = 1;
const KIND_PCM: u8 = 2;
#[cfg(target_os = "linux")]
const KIND_FILE: u8 = 3;
/// Bumped whenever the player is stopped, so a file loop from the previous
/// track cannot restart itself over the new one.
static FILE_GEN: AtomicU64 = AtomicU64::new(0);

struct Running {
    child: Child,
}

static PLAYER: Mutex<Option<Running>> = Mutex::new(None);
static BUSY: Mutex<()> = Mutex::new(());

/// Start, reshape, or stop the pad.
///
/// `Ok(false)` means this machine has no player Orbit knows how to feed, and
/// the web view should try its own audio instead. `Ok(true)` means the request
/// was carried out, including turning the pad off.
pub fn set(enabled: bool, volume: f32, audible: bool) -> Result<bool, String> {
    // Windows plays the web view's own chord. A system tone here would replace
    // it, which is not the sound that release already had.
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (enabled, volume, audible);
        return Ok(false);
    }
    #[cfg(target_os = "linux")]
    {
    let _guard = BUSY.lock().unwrap_or_else(|poison| poison.into_inner());
    let volume = volume.clamp(0.0, 1.0);
    if !enabled || volume <= 0.0 || !audible {
        stop_locked();
        // Silence was asked for. Saying so keeps the web view from starting a
        // second copy the moment the window looks away.
        return Ok(true);
    }
    LEVEL.store(volume.to_bits(), Ordering::Relaxed);
    if RUN.load(Ordering::SeqCst) {
        let kind = KIND.load(Ordering::SeqCst);
        if kind == KIND_PCM {
            return Ok(true);
        }
        if kind == KIND_GST && LAUNCHED.load(Ordering::SeqCst) == volume.to_bits() {
            return Ok(true);
        }
    }
    stop_locked();
    // The raw writer moves through the same chords as the Windows pad.
    // GStreamer is the still chord, used only when no raw player will take it.
    if start_pcm(volume) || start_gst(volume) {
        return Ok(true);
    }
    Ok(false)
    }
}

/// Stop the pad and the player process. Safe to call when nothing is playing.
pub fn stop() {
    let _guard = BUSY.lock().unwrap_or_else(|poison| poison.into_inner());
    stop_locked();
}

fn stop_locked() {
    RUN.store(false, Ordering::SeqCst);
    KIND.store(0, Ordering::SeqCst);
    FILE_GEN.fetch_add(1, Ordering::SeqCst);
    let child = PLAYER.lock().ok().and_then(|mut slot| slot.take());
    if let Some(mut running) = child {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

/// Play a file the player picked, looping it, through the same system sink as
/// the chord. `Ok(false)` means this machine should try the web view instead.
///
/// The chord is stopped first. The two are never played together.
pub fn play_file(path: &str, volume: f32, audible: bool) -> Result<bool, String> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (path, volume, audible);
        Ok(false)
    }
    #[cfg(target_os = "linux")]
    {
        play_file_linux(path, volume, audible)
    }
}

#[cfg(target_os = "linux")]
fn play_file_linux(path: &str, volume: f32, audible: bool) -> Result<bool, String> {
    let _guard = BUSY.lock().unwrap_or_else(|poison| poison.into_inner());
    let volume = volume.clamp(0.0, 1.0);
    if !audible || volume <= 0.0 {
        stop_locked();
        return Ok(true);
    }
    let path = path.trim();
    if path.is_empty() || path.contains("://") || path.contains('\0') {
        return Err("Choose a music file on this computer.".into());
    }
    if !std::path::Path::new(path).is_file() {
        return Err("That music file is not there.".into());
    }
    // Stopping first also retires any loop that was restarting the previous file.
    stop_locked();
    let Some(child) = spawn_file(path, volume) else {
        return Ok(false);
    };
    let gen = FILE_GEN.load(Ordering::SeqCst);
    RUN.store(true, Ordering::SeqCst);
    KIND.store(KIND_FILE, Ordering::SeqCst);
    remember(child, KIND_FILE, volume);
    let owned = path.to_string();
    std::thread::spawn(move || file_loop(owned, volume, gen));
    Ok(true)
}

#[cfg(target_os = "linux")]
fn spawn_file(path: &str, volume: f32) -> Option<Child> {
    let program = find_program("gst-launch-1.0")?;
    let uri = file_uri(path);
    let vol = format!("{:.3}", sink_volume(volume));
    let mut cmd = process::command(program);
    cmd.args(["-q", "playbin", &format!("uri={uri}"), &format!("volume={vol}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    // A file the plugins cannot decode exits immediately. A real track is still
    // going after this, which is the only signal gst-launch gives us.
    std::thread::sleep(Duration::from_millis(280));
    if child.try_wait().ok().flatten().is_some() {
        let _ = child.wait();
        return None;
    }
    Some(child)
}

#[cfg(target_os = "linux")]
fn file_loop(path: String, volume: f32, gen: u64) {
    loop {
        if FILE_GEN.load(Ordering::SeqCst) != gen || !RUN.load(Ordering::SeqCst) || KIND.load(Ordering::SeqCst) != KIND_FILE {
            break;
        }
        let finished = {
            let mut slot = match PLAYER.lock() {
                Ok(slot) => slot,
                Err(_) => break,
            };
            let Some(running) = slot.as_mut() else {
                break;
            };
            match running.child.try_wait() {
                Ok(Some(_)) => {
                    slot.take();
                    true
                }
                Ok(None) => false,
                Err(_) => {
                    slot.take();
                    true
                }
            }
        };
        if !finished {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        }
        if FILE_GEN.load(Ordering::SeqCst) != gen || !RUN.load(Ordering::SeqCst) {
            break;
        }
        let Some(child) = spawn_file(&path, volume) else {
            break;
        };
        if FILE_GEN.load(Ordering::SeqCst) != gen || !RUN.load(Ordering::SeqCst) {
            let mut child = child;
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        remember(child, KIND_FILE, volume);
    }
}

#[cfg(target_os = "linux")]
fn file_uri(path: &str) -> String {
    let mut out = String::from("file://");
    for ch in path.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '/' | '-' | '_' | '.' | '~' => out.push(ch),
            _ => {
                let mut buf = [0u8; 4];
                for byte in ch.encode_utf8(&mut buf).bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}

/// A quiet chord through the plugins the packages already ask for. No file.
fn gst_args(volume: f32) -> Vec<String> {
    let vol = format!("{:.3}", sink_volume(volume));
    // The same open voicing as the Windows pad: a quiet low note, then the
    // notes that actually sit in the middle. A 65 Hz drone is what sounded
    // too deep next to that release.
    vec![
        "-q".into(),
        "audiotestsrc".into(),
        "wave=sine".into(),
        "freq=146.83".into(),
        "volume=0.16".into(),
        "is-live=true".into(),
        "!".into(),
        "audiomixer".into(),
        "name=mix".into(),
        "!".into(),
        "volume".into(),
        format!("volume={vol}"),
        "!".into(),
        "audioconvert".into(),
        "!".into(),
        "audioresample".into(),
        "!".into(),
        "autoaudiosink".into(),
        "audiotestsrc".into(),
        "wave=sine".into(),
        "freq=164.81".into(),
        "volume=0.12".into(),
        "is-live=true".into(),
        "!".into(),
        "mix.".into(),
        "audiotestsrc".into(),
        "wave=sine".into(),
        "freq=246.94".into(),
        "volume=0.08".into(),
        "is-live=true".into(),
        "!".into(),
        "mix.".into(),
        "audiotestsrc".into(),
        "wave=sine".into(),
        "freq=329.63".into(),
        "volume=0.05".into(),
        "is-live=true".into(),
        "!".into(),
        "mix.".into(),
    ]
}

/// The slider's low half was a whisper. Lift it so the default is easy to hear
/// without the top of the slider becoming a shout.
fn sink_volume(volume: f32) -> f32 {
    (0.18 + volume * 0.62).clamp(0.0, 0.85)
}

fn start_gst(volume: f32) -> bool {
    // The chord first. A single tone if that pipeline will not link, which is
    // still the pad rather than silence.
    launch_gst(volume, &gst_args(volume)) || launch_gst(volume, &gst_tone(volume))
}

fn gst_tone(volume: f32) -> Vec<String> {
    let vol = format!("{:.3}", sink_volume(volume));
    ["-q", "audiotestsrc", "wave=sine", "freq=196.00", "is-live=true"]
        .into_iter()
        .map(str::to_string)
        .chain([format!("volume={vol}")])
        .chain(["!", "audioconvert", "!", "audioresample", "!", "autoaudiosink"].into_iter().map(str::to_string))
        .collect()
}

fn launch_gst(volume: f32, args: &[String]) -> bool {
    let Some(program) = find_program("gst-launch-1.0") else {
        return false;
    };
    let mut cmd = process::command(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    std::thread::sleep(Duration::from_millis(220));
    if child.try_wait().ok().flatten().is_some() {
        let _ = child.kill();
        let _ = child.wait();
        return false;
    }
    remember(child, KIND_GST, volume);
    true
}

fn start_pcm(volume: f32) -> bool {
    let Some((mut child, stdin)) = open_sink() else {
        return false;
    };
    RUN.store(true, Ordering::SeqCst);
    LEVEL.store(volume.to_bits(), Ordering::Relaxed);
    std::thread::spawn(move || write_pad(stdin));
    std::thread::sleep(Duration::from_millis(160));
    if child.try_wait().ok().flatten().is_some() {
        RUN.store(false, Ordering::SeqCst);
        let _ = child.kill();
        let _ = child.wait();
        return false;
    }
    remember(child, KIND_PCM, volume);
    true
}

fn remember(child: Child, kind: u8, volume: f32) {
    RUN.store(true, Ordering::SeqCst);
    KIND.store(kind, Ordering::SeqCst);
    LAUNCHED.store(volume.to_bits(), Ordering::SeqCst);
    LEVEL.store(volume.to_bits(), Ordering::Relaxed);
    if let Ok(mut slot) = PLAYER.lock() {
        *slot = Some(Running { child });
    }
}

fn find_program(name: &str) -> Option<std::path::PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for dir in ["/usr/bin", "/bin", "/usr/local/bin"] {
        let candidate = std::path::PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn open_sink() -> Option<(Child, ChildStdin)> {
    // PipeWire first, then Pulse, then ALSA. Each reads raw little-endian
    // stereo from stdin, which is the only contract the writer relies on.
    // A player that does not accept a block is not a player: claiming it was
    // left the app silent, because the web view then stayed off.
    let attempts: &[(&str, &[&str])] = &[
        (
            "pw-cat",
            &["--playback", "--raw", "--format", "s16", "--rate", "44100", "--channels", "2", "-"],
        ),
        (
            "pw-cat",
            &["--playback", "--format", "s16", "--rate", "44100", "--channels", "2", "-"],
        ),
        (
            "paplay",
            &["--raw", "--rate=44100", "--format=s16le", "--channels=2", "-"],
        ),
        ("aplay", &["-q", "-t", "raw", "-f", "S16_LE", "-r", "44100", "-c", "2", "-"]),
    ];
    for (program, args) in attempts {
        let Some(path) = find_program(program) else {
            continue;
        };
        let mut cmd = process::command(path);
        cmd.args(*args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let Ok(mut child) = cmd.spawn() else {
            continue;
        };
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            continue;
        };
        let block = tone_block(0.4);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let ok = stdin.write_all(&block).is_ok();
            let _ = tx.send((ok, stdin));
        });
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok((true, stdin)) => {
                if child.try_wait().ok().flatten().is_none() {
                    return Some((child, stdin));
                }
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    None
}

fn tone_block(level: f64) -> Vec<u8> {
    const FRAMES: usize = 1024;
    let mut buf = vec![0u8; FRAMES * 4];
    for frame in 0..FRAMES {
        let sample = sample(frame as f64 / 44100.0, level, true);
        let bytes = sample.to_le_bytes();
        let at = frame * 4;
        buf[at] = bytes[0];
        buf[at + 1] = bytes[1];
        buf[at + 2] = bytes[0];
        buf[at + 3] = bytes[1];
    }
    buf
}

fn write_pad(mut stdin: ChildStdin) {
    const RATE: f64 = 44100.0;
    const FRAMES: usize = 1024;
    let mut t: u64 = 0;
    let mut buf = vec![0u8; FRAMES * 4];
    while RUN.load(Ordering::Relaxed) {
        let level = f32::from_bits(LEVEL.load(Ordering::Relaxed)) as f64;
        for frame in 0..FRAMES {
            let sample = sample((t + frame as u64) as f64 / RATE, level, true);
            let bytes = sample.to_le_bytes();
            let at = frame * 4;
            buf[at] = bytes[0];
            buf[at + 1] = bytes[1];
            buf[at + 2] = bytes[0];
            buf[at + 3] = bytes[1];
        }
        t += FRAMES as u64;
        if stdin.write_all(&buf).is_err() {
            break;
        }
    }
    RUN.store(false, Ordering::SeqCst);
}

/// C3, the same root the Windows pad uses. The low octave is present, quietly.
const ROOT: f64 = 130.8128;

/// Open voicings from the web pad. The first number is semitones from C3.
const CHORDS: [[(i32, f64); 5]; 4] = [
    [(-12, 0.023), (-5, 0.016), (2, 0.013), (4, 0.010), (11, 0.008)],
    [(-10, 0.021), (-3, 0.014), (2, 0.012), (4, 0.010), (9, 0.008)],
    [(-3, 0.021), (2, 0.014), (4, 0.012), (7, 0.010), (11, 0.008)],
    [(-5, 0.021), (2, 0.015), (4, 0.012), (9, 0.010), (11, 0.008)],
];

fn note(semitones: i32) -> f64 {
    ROOT * 2f64.powf(semitones as f64 / 12.0)
}

fn chord_mix(t: f64, chord: usize) -> f64 {
    let tau = std::f64::consts::TAU;
    CHORDS[chord % 4]
        .iter()
        .map(|(semitones, level)| (t * note(*semitones) * tau).sin() * level)
        .sum()
}

/// A soft chime an octave or two up, on the same slow clock as the web pad.
fn sparkle(t: f64) -> f64 {
    let period = 8.0;
    let phase = t % period;
    if phase > 5.2 {
        return 0.0;
    }
    let semis = [24, 19, 26, 21, 28, 16][((t / period) as usize) % 6];
    let env = (-phase / 1.6).exp() * (1.0 - (-phase / 0.04).exp());
    (t * note(semis) * std::f64::consts::TAU).sin() * env * 0.04
}

/// The Windows chord, written as samples. Loud enough to hear, not a bass drone.
fn sample(t: f64, level: f64, audible: bool) -> i16 {
    if !audible || level <= 0.0 {
        return 0;
    }
    let cycle = 18.0;
    let pos = t % (cycle * 4.0);
    let index = (pos / cycle) as usize;
    let into = pos % cycle;
    let blend = if into < 7.8 { into / 7.8 } else { 1.0 };
    let pad = chord_mix(t, index.wrapping_sub(1)) * (1.0 - blend) + chord_mix(t, index) * blend;
    let lfo = 0.9 + 0.1 * (t * 0.12).sin();
    // The web levels are oscillator gains. Scaled so the default slider matches
    // that pad, and still stays under a game.
    let shaped = ((pad * 3.2 + sparkle(t)) * lfo * level).clamp(-1.0, 1.0);
    (shaped * i16::MAX as f64) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_silence() {
        assert_eq!(sample(1.0, 0.0, true), 0);
        assert_eq!(sample(1.0, 0.4, false), 0);
    }

    #[test]
    fn a_playing_pad_is_not_a_flat_line() {
        // A tenth of a second apart. Two samples a hundredth of a second apart
        // can round to the same quiet number, which is not a stuck tone.
        let heard = [0.2, 0.8, 1.7, 3.1].map(|t| sample(t, 0.5, true));
        assert!(
            heard.windows(2).any(|pair| pair[0] != pair[1]),
            "the pad should move, got {heard:?}"
        );
        assert!(
            heard.iter().all(|sample| sample.abs() < 8000),
            "the pad stays under a game, got {heard:?}"
        );
    }

    #[test]
    fn the_system_pad_is_synthesised() {
        let args = gst_args(0.35);
        let joined = args.join(" ");
        assert!(joined.contains("audiotestsrc"));
        assert!(joined.contains("autoaudiosink"));
        assert!(joined.contains("freq=164.81"));
        assert!(!joined.contains("freq=65.41"));
        assert!(!joined.contains(".wav"));
        assert!(!joined.contains(".mp3"));
    }

    #[test]
    fn the_default_slider_is_not_a_whisper() {
        assert!(sink_volume(0.35) > 0.3);
    }
}
