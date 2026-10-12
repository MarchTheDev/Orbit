//! A controller, read from the kernel when the web view never says one arrived.
//!
//! WebKitGTK often never fires `gamepadconnected`, so a hook that waits for
//! that event waits forever. `/dev/input` is the same pad the browser would
//! have read. The thread blocks on the device: it does not poll while nothing
//! is plugged in, and it does not run a frame loop.

use serde::Serialize;

#[cfg(target_os = "linux")]
use std::fs::{self, File};
#[cfg(target_os = "linux")]
use std::io::{self, Read};
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::Duration;

use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Emitter;

const BUTTONS: usize = 16;
const AXES: usize = 4;

#[derive(Clone, Serialize)]
struct PadEvent {
    connected: bool,
    buttons: Vec<bool>,
    axes: Vec<f32>,
}

#[derive(Clone)]
struct State {
    buttons: Vec<bool>,
    axes: Vec<f32>,
}

impl State {
    fn new() -> Self {
        Self {
            buttons: vec![false; BUTTONS],
            axes: vec![0.0; AXES],
        }
    }

    fn event(&self, connected: bool) -> PadEvent {
        PadEvent {
            connected,
            buttons: self.buttons.clone(),
            axes: self.axes.clone(),
        }
    }
}

/// Watch for a controller and tell the page when one moves.
pub fn start(app: AppHandle) {
    #[cfg(target_os = "linux")]
    {
        std::thread::spawn(move || watch(app));
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "linux")]
enum DeviceKind {
    /// `/dev/input/js*`, 8-byte `js_event`.
    Joystick,
    /// `/dev/input/event*`, evdev `input_event`.
    Evdev,
}

#[cfg(target_os = "linux")]
fn watch(app: AppHandle) {
    while !crate::quitting() {
        let devices = find_devices();
        if devices.is_empty() {
            std::thread::sleep(Duration::from_millis(1500));
            continue;
        }
        let mut opened = false;
        for (path, kind) in devices {
            if let Some(file) = open_device(&path) {
                opened = true;
                if run_device(&app, file, kind).is_err() {
                    let _ = app.emit("orbit-gamepad", State::new().event(false));
                }
                break;
            }
            log::info!(
                "a controller is at {} but Orbit cannot read it",
                path.display()
            );
        }
        // A device that disappears, or that cannot be read, must not become a
        // tight loop. A live pad blocks inside `run_device` and never gets here.
        std::thread::sleep(Duration::from_millis(if opened { 400 } else { 1500 }));
    }
}

#[cfg(target_os = "linux")]
fn run_device(app: &AppHandle, mut file: File, kind: DeviceKind) -> io::Result<()> {
    let mut state = State::new();
    set_nonblocking(&file, true);
    loop {
        match read_one(&mut file, &kind, &mut state) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
            Err(error) => return Err(error),
        }
    }
    // The first report is the resting position, so a button that was already
    // down is not treated as a fresh press.
    let _ = app.emit("orbit-gamepad", state.event(true));
    set_nonblocking(&file, false);
    loop {
        if crate::quitting() {
            return Ok(());
        }
        read_one(&mut file, &kind, &mut state)?;
        let _ = app.emit("orbit-gamepad", state.event(true));
    }
}

#[cfg(target_os = "linux")]
fn find_devices() -> Vec<(PathBuf, DeviceKind)> {
    let mut found = Vec::new();
    for dir in ["/dev/input/by-id", "/dev/input/by-path"] {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with("-event-joystick") {
                found.push((entry.path(), DeviceKind::Evdev));
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    for index in 0..8 {
        let path = PathBuf::from(format!("/dev/input/js{index}"));
        if path.exists() {
            found.push((path, DeviceKind::Joystick));
        }
    }
    found
}

#[cfg(target_os = "linux")]
fn open_device(path: &Path) -> Option<File> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .ok()
        .or_else(|| File::open(path).ok())
}

#[cfg(target_os = "linux")]
fn read_one(file: &mut File, kind: &DeviceKind, state: &mut State) -> io::Result<()> {
    match kind {
        DeviceKind::Joystick => {
            let mut buf = [0u8; 8];
            file.read_exact(&mut buf)?;
            apply_js(state, buf[6], buf[7], i16::from_le_bytes([buf[4], buf[5]]));
        }
        DeviceKind::Evdev => {
            let size = if cfg!(target_pointer_width = "64") { 24 } else { 16 };
            let mut buf = vec![0u8; size];
            file.read_exact(&mut buf)?;
            let n = buf.len();
            let value = i32::from_le_bytes([buf[n - 4], buf[n - 3], buf[n - 2], buf[n - 1]]);
            let code = u16::from_le_bytes([buf[n - 6], buf[n - 5]]);
            let kind = u16::from_le_bytes([buf[n - 8], buf[n - 7]]);
            apply_evdev(state, kind, code, value);
        }
    }
    Ok(())
}

/// Linux `js_event`: type 1 is a button, type 2 is an axis. The high bit marks
/// the burst sent when the device is opened.
fn apply_js(state: &mut State, type_raw: u8, number: u8, value: i16) {
    let kind = type_raw & 0x7f;
    if kind == 1 {
        if let Some(index) = js_button(number) {
            if let Some(slot) = state.buttons.get_mut(index) {
                *slot = value != 0;
            }
        }
    } else if kind == 2 {
        apply_js_axis(state, number, value);
    }
}

/// joydev numbers for an Xbox-style pad, written as the buttons the page
/// already understands: 0 activate, 1 back, 9 play, 12–15 the d-pad.
fn js_button(number: u8) -> Option<usize> {
    Some(match number {
        0 => 0,
        1 => 1,
        2 => 2,
        3 => 3,
        4 => 4,
        5 => 5,
        6 => 8,
        7 => 9,
        9 => 10,
        10 => 11,
        other => return (other as usize).checked_sub(0).filter(|index| *index < BUTTONS),
    })
}

fn apply_js_axis(state: &mut State, number: u8, value: i16) {
    let scaled = (value as f32 / 32767.0).clamp(-1.0, 1.0);
    match number {
        0 => state.axes[0] = scaled,
        1 => state.axes[1] = scaled,
        3 => state.axes[2] = scaled,
        4 => state.axes[3] = scaled,
        6 => set_hat(state, true, value),
        7 => set_hat(state, false, value),
        _ => {}
    }
}

fn set_hat(state: &mut State, horizontal: bool, value: i16) {
    let (negative, positive) = if horizontal { (14, 15) } else { (12, 13) };
    state.buttons[negative] = value < -1000;
    state.buttons[positive] = value > 1000;
}

/// evdev codes. These are stable across pads; joydev's button numbers are not.
fn apply_evdev(state: &mut State, kind: u16, code: u16, value: i32) {
    const EV_KEY: u16 = 1;
    const EV_ABS: u16 = 3;
    if kind == EV_KEY {
        if let Some(index) = evdev_button(code) {
            state.buttons[index] = value != 0;
        }
    } else if kind == EV_ABS {
        apply_evdev_axis(state, code, value);
    }
}

fn evdev_button(code: u16) -> Option<usize> {
    Some(match code {
        0x130 => 0, // BTN_SOUTH
        0x131 => 1, // BTN_EAST
        0x134 => 2, // BTN_WEST
        0x133 => 3, // BTN_NORTH
        0x136 => 4, // BTN_TL
        0x137 => 5, // BTN_TR
        0x13a => 8, // BTN_SELECT
        0x13b => 9, // BTN_START
        0x13d => 10,
        0x13e => 11,
        0x220 => 12, // BTN_DPAD_UP
        0x221 => 13,
        0x222 => 14,
        0x223 => 15,
        _ => return None,
    })
}

fn apply_evdev_axis(state: &mut State, code: u16, value: i32) {
    let pressed = |value: i32| if value < 0 { -32767 } else if value > 0 { 32767 } else { 0 };
    match code {
        0 => state.axes[0] = norm_axis(value),
        1 => state.axes[1] = norm_axis(value),
        3 => state.axes[2] = norm_axis(value),
        4 => state.axes[3] = norm_axis(value),
        // Buttons only. Also writing the stick axis would step twice for one press.
        16 => set_hat(state, true, pressed(value)),
        17 => set_hat(state, false, pressed(value)),
        _ => {}
    }
}

fn norm_axis(value: i32) -> f32 {
    (value as f32 / 32767.0).clamp(-1.0, 1.0)
}

#[cfg(target_os = "linux")]
fn set_nonblocking(file: &File, on: bool) {
    const F_GETFL: i32 = 3;
    const F_SETFL: i32 = 4;
    const O_NONBLOCK: i32 = 0x800;
    unsafe {
        let flags = fcntl(file.as_raw_fd(), F_GETFL);
        if flags < 0 {
            return;
        }
        let flags = if on { flags | O_NONBLOCK } else { flags & !O_NONBLOCK };
        fcntl(file.as_raw_fd(), F_SETFL, flags);
    }
}

#[cfg(target_os = "linux")]
extern "C" {
    fn fcntl(fd: i32, cmd: i32, ...) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_xbox_start_button_means_play() {
        let mut state = State::new();
        apply_js(&mut state, 1, 7, 1);
        assert!(state.buttons[9]);
        assert!(!state.buttons[0]);
    }

    #[test]
    fn the_south_button_activates_and_the_east_button_goes_back() {
        let mut state = State::new();
        apply_evdev(&mut state, 1, 0x130, 1);
        apply_evdev(&mut state, 1, 0x131, 1);
        assert!(state.buttons[0]);
        assert!(state.buttons[1]);
    }

    #[test]
    fn a_hat_is_a_direction() {
        let mut state = State::new();
        apply_js_axis(&mut state, 7, -32767);
        assert!(state.buttons[12]);
        apply_js_axis(&mut state, 6, 32767);
        assert!(state.buttons[15]);
    }

    #[test]
    fn a_stick_crosses_the_page_dead_zone() {
        let mut state = State::new();
        apply_js_axis(&mut state, 0, -20000);
        assert!(state.axes[0] < -0.45);
    }
}
