//! The background pad, played by the system rather than the web view.
//!
//! WebKitGTK's Web Audio graph often stays suspended, or builds a GStreamer
//! pipeline that never starts, and the app is then silent with no error the
//! player can see. A short stream of samples written to PipeWire, PulseAudio
//! or ALSA does not depend on that. Windows keeps using the web view, which
//! already plays there.

use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// Whether a player is running. The writer thread reads this every block.
static RUN: AtomicBool = AtomicBool::new(false);
/// Master level, 0 to 1, as bits of an f32.
static LEVEL: AtomicU32 = AtomicU32::new(0);
/// False while another window has the focus and the player asked for quiet.
static AUDIBLE: AtomicBool = AtomicBool::new(true);

struct Running {
    child: Child,
}

static PLAYER: Mutex<Option<Running>> = Mutex::new(None);

/// Start, reshape, or stop the pad.
///
/// `Ok(false)` means this machine has no player Orbit knows how to feed, and
/// the web view should try its own audio instead. `Ok(true)` means the request
/// was carried out, including turning the pad off.
pub fn set(enabled: bool, volume: f32, audible: bool) -> Result<bool, String> {
    let volume = volume.clamp(0.0, 1.0);
    if !enabled || volume <= 0.0 {
        stop();
        return Ok(true);
    }
    LEVEL.store(volume.to_bits(), Ordering::Relaxed);
    AUDIBLE.store(audible, Ordering::Relaxed);
    if RUN.load(Ordering::SeqCst) {
        return Ok(true);
    }
    let Some((mut child, stdin)) = open_sink() else {
        return Ok(false);
    };
    RUN.store(true, Ordering::SeqCst);
    std::thread::spawn(move || write_pad(stdin));
    // A player that exits at once is not a player. Give it a moment, then say
    // so, so the web view can try the other way rather than staying silent.
    std::thread::sleep(Duration::from_millis(120));
    if child.try_wait().ok().flatten().is_some() {
        stop();
        return Ok(false);
    }
    if let Ok(mut slot) = PLAYER.lock() {
        *slot = Some(Running { child });
    }
    Ok(true)
}

/// Stop the pad and the player process. Safe to call when nothing is playing.
pub fn stop() {
    RUN.store(false, Ordering::SeqCst);
    let child = PLAYER.lock().ok().and_then(|mut slot| slot.take());
    if let Some(mut running) = child {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

fn open_sink() -> Option<(Child, ChildStdin)> {
    // PipeWire first, then Pulse, then ALSA. Each reads raw little-endian
    // stereo from stdin, which is the only contract the writer relies on.
    let attempts: &[(&str, &[&str])] = &[
        (
            "pw-cat",
            &["--playback", "--format", "s16", "--rate", "44100", "--channels", "2", "-"],
        ),
        (
            "paplay",
            &[
                "--raw",
                "--rate=44100",
                "--format=s16le",
                "--channels=2",
                "-",
            ],
        ),
        ("aplay", &["-q", "-t", "raw", "-f", "S16_LE", "-r", "44100", "-c", "2", "-"]),
    ];
    for (program, args) in attempts {
        let mut cmd = Command::new(program);
        cmd.args(*args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Ok(mut child) = cmd.spawn() {
            if let Some(stdin) = child.stdin.take() {
                return Some((child, stdin));
            }
            let _ = child.kill();
        }
    }
    None
}

fn write_pad(mut stdin: ChildStdin) {
    const RATE: f64 = 44100.0;
    const FRAMES: usize = 1024;
    let mut t: u64 = 0;
    let mut buf = vec![0u8; FRAMES * 4];
    while RUN.load(Ordering::Relaxed) {
        let level = f32::from_bits(LEVEL.load(Ordering::Relaxed)) as f64;
        let audible = AUDIBLE.load(Ordering::Relaxed);
        for frame in 0..FRAMES {
            let sample = sample((t + frame as u64) as f64 / RATE, level, audible);
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
    let shaped = (tone * lfo * level * 0.16).clamp(-1.0, 1.0);
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
}
