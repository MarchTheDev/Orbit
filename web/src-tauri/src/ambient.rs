//! The background pad, played by the system rather than the web view.
//!
//! WebKitGTK's Web Audio graph often stays suspended, or builds a GStreamer
//! pipeline that never starts, and the app is then silent with no error the
//! player can see. A synthesised pad through the system sink does not depend
//! on that graph. A player that exits, or that never accepts a sample, is not
//! reported as playing: the web view should try instead of staying mute.
//! Windows keeps using the web view, which already plays there.

use std::io::Write;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
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
    if start_gst(volume) || start_pcm(volume) {
        return Ok(true);
    }
    Ok(false)
}

/// Stop the pad and the player process. Safe to call when nothing is playing.
pub fn stop() {
    let _guard = BUSY.lock().unwrap_or_else(|poison| poison.into_inner());
    stop_locked();
}

fn stop_locked() {
    RUN.store(false, Ordering::SeqCst);
    KIND.store(0, Ordering::SeqCst);
    let child = PLAYER.lock().ok().and_then(|mut slot| slot.take());
    if let Some(mut running) = child {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

/// A quiet chord through the plugins the packages already ask for. No file.
fn gst_args(volume: f32) -> Vec<String> {
    let vol = format!("{:.3}", sink_volume(volume));
    vec![
        "-q".into(),
        "audiotestsrc".into(),
        "wave=sine".into(),
        "freq=65.41".into(),
        "volume=0.22".into(),
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
        "freq=98".into(),
        "volume=0.12".into(),
        "is-live=true".into(),
        "!".into(),
        "mix.".into(),
        "audiotestsrc".into(),
        "wave=sine".into(),
        "freq=130.81".into(),
        "volume=0.07".into(),
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
    ["-q", "audiotestsrc", "wave=sine", "freq=82.41", "is-live=true"]
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

/// A quiet C major pad. Loud enough to be heard, quiet enough to sit under a game.
fn sample(t: f64, level: f64, audible: bool) -> i16 {
    if !audible || level <= 0.0 {
        return 0;
    }
    let tau = std::f64::consts::TAU;
    let lfo = 0.82 + 0.18 * (t * 0.12).sin();
    let tone = (t * 65.406 * tau).sin() * 0.55
        + (t * 98.0 * tau).sin() * 0.28
        + (t * 130.813 * tau).sin() * 0.16;
    // 0.16 of the slider was a whisper on a system sink. This is still under
    // a game at the volumes the slider offers.
    let shaped = (tone * lfo * level * 0.38).clamp(-1.0, 1.0);
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
        let a = sample(0.01, 0.5, true);
        let b = sample(0.02, 0.5, true);
        assert_ne!(a, b);
        assert!(a.abs() < 8000, "the pad stays under a game, got {a}");
    }

    #[test]
    fn the_system_pad_is_synthesised() {
        let args = gst_args(0.35);
        let joined = args.join(" ");
        assert!(joined.contains("audiotestsrc"));
        assert!(joined.contains("autoaudiosink"));
        assert!(!joined.contains(".wav"));
        assert!(!joined.contains(".mp3"));
    }

    #[test]
    fn the_default_slider_is_not_a_whisper() {
        assert!(sink_volume(0.35) > 0.3);
    }
}
