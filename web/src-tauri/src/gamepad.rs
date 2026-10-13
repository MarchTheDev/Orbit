//! A controller, read from the kernel when the web view never says one arrived.
//!
//! WebKitGTK often never fires `gamepadconnected`, and asking it
//! (`getGamepads`) can freeze the window the moment a pad is plugged in. This
//! thread reads the event node the session is allowed to open. A modern
//! desktop often has no `js*` node at all — joydev is not loaded — so a pad
//! is recognised by its button bits, not by that sibling. The old joystick
//! node is only a fallback. It does not use a hand-declared `fcntl` (that
//! call was undefined and could take the process down), and a device that
//! floods or looks broken is skipped so the window stays up.

use serde::Serialize;

#[cfg(target_os = "linux")]
use std::fs::{self, File};
#[cfg(target_os = "linux")]
use std::io::{self, Read};
#[cfg(target_os = "linux")]
use std::os::unix::ffi::OsStrExt;
#[cfg(target_os = "linux")]
use std::os::unix::io::{AsRawFd, FromRawFd};
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
        std::thread::spawn(move || {
            let app_for_fault = app.clone();
            let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| watch(app)));
            if ran.is_err() {
                log::error!("controller reader stopped after a fault so the window can stay up");
                let _ = app_for_fault.emit("orbit-gamepad", State::new().event(false));
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
    }
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
            let Some(file) = open_input(&path) else {
                log::info!(
                    "a controller is at {} but Orbit cannot read it",
                    path.display()
                );
                continue;
            };
            opened = true;
            log::info!("reading a controller from {}", path.display());
            // Unplugging is ordinary. A node that is not a pad is skipped so
            // the next one can be tried. The reader stays up either way: a
            // background retry cannot freeze the window, and stopping for
            // good is what made a plugged-in pad do nothing.
            if let Err(error) = run_device(&app, file, kind) {
                let _ = app.emit("orbit-gamepad", State::new().event(false));
                log::info!("controller stopped: {error}");
                // Not a pad. The next candidate is tried now, not after a
                // pause: the pause was long enough that a real controller
                // sitting behind a headset node never got a turn.
                if error.kind() == io::ErrorKind::InvalidData {
                    continue;
                }
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(if opened { 400 } else { 1500 }));
    }
}

#[cfg(target_os = "linux")]
fn run_device(app: &AppHandle, mut file: File, kind: DeviceKind) -> io::Result<()> {
    // A headset or consumer-control node shares the controller's name and
    // would otherwise be held forever, so the real pad never gets a turn.
    if matches!(kind, DeviceKind::Evdev) && gamepad_keys(&file) == Some(false) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "controller node is not a pad",
        ));
    }
    let ranges = if matches!(kind, DeviceKind::Evdev) {
        read_ranges(&file)
    } else {
        AxisRanges::standard()
    };
    let mut state = State::new();
    let mut drained = 0u32;
    loop {
        match read_event(&mut file, kind, &mut state, &ranges) {
            Ok(()) => {
                drained += 1;
                if drained > 512 {
                    break;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
            Err(error) => return Err(error),
        }
    }
    if too_many_buttons(&state) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "controller state is not a pad",
        ));
    }
    // The first report is the resting position. The page treats it as a
    // baseline, not as a press.
    let _ = app.emit("orbit-gamepad", state.event(true));
    let mut sent = state.clone();
    let mut last_emit = std::time::Instant::now();
    let mut window_start = std::time::Instant::now();
    let mut reads = 0u32;
    loop {
        if crate::quitting() {
            return Ok(());
        }
        if !wait_readable(&file, 400)? {
            continue;
        }
        read_event(&mut file, kind, &mut state, &ranges)?;
        reads += 1;
        if window_start.elapsed() >= Duration::from_secs(1) {
            // A stick at a thousand reports a second is ordinary. Tens of
            // thousands is a device that is not a pad, and that one is skipped.
            if reads > 8000 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "controller is flooding",
                ));
            }
            reads = 0;
            window_start = std::time::Instant::now();
        }
        if too_many_buttons(&state) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "controller state is not a pad",
            ));
        }
        let buttons_changed = state.buttons != sent.buttons;
        let axes_changed = state
            .axes
            .iter()
            .zip(sent.axes.iter())
            .any(|(now, then)| (now - then).abs() > 0.12);
        // A stick can wait. A button cannot: a tap shorter than the stick
        // interval would otherwise never reach the page. A quiet pad still
        // checks in, so a report that arrived before the page was listening
        // is not the only chance to say a controller is there.
        let due = should_emit(buttons_changed, axes_changed, last_emit.elapsed())
            || last_emit.elapsed() >= Duration::from_secs(2);
        if !due {
            continue;
        }
        let _ = app.emit("orbit-gamepad", state.event(true));
        sent = state.clone();
        last_emit = std::time::Instant::now();
    }
}

#[cfg(target_os = "linux")]
fn too_many_buttons(state: &State) -> bool {
    state.buttons.iter().filter(|down| **down).count() > 6
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
enum DeviceKind {
    /// `/dev/input/js*`, a fixed 8-byte `js_event`.
    Joystick,
    /// `/dev/input/event*`. Button codes here are the same on every pad.
    Evdev,
}

#[cfg(target_os = "linux")]
fn find_devices() -> Vec<(PathBuf, DeviceKind)> {
    let mut best: std::collections::HashMap<PathBuf, (PathBuf, DeviceKind, i32)> =
        std::collections::HashMap::new();
    let mut consider = |path: PathBuf, kind: DeviceKind, score: i32| {
        if score <= 0 {
            return;
        }
        let key = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        match best.get(&key) {
            Some(slot) if slot.2 >= score => {}
            _ => {
                best.insert(key, (path, kind, score));
            }
        }
    };
    // udev's stable name. This is the node logind lets the logged-in user read.
    for dir in ["/dev/input/by-id", "/dev/input/by-path"] {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if !(name.contains("joystick") || name.contains("gamepad")) {
                continue;
            }
            let evdev = name.contains("event");
            consider(
                entry.path(),
                if evdev {
                    DeviceKind::Evdev
                } else {
                    DeviceKind::Joystick
                },
                if evdev { 60 } else { 20 },
            );
        }
    }
    if let Ok(text) = fs::read_to_string("/proc/bus/input/devices") {
        for (path, event_node, score) in pads_in_proc(&text) {
            consider(
                PathBuf::from(path),
                if event_node {
                    DeviceKind::Evdev
                } else {
                    DeviceKind::Joystick
                },
                score,
            );
        }
    }
    for (path, score) in pads_in_sys() {
        consider(path, DeviceKind::Evdev, score);
    }
    for index in 0..8 {
        let path = PathBuf::from(format!("/dev/input/js{index}"));
        if path.exists() {
            consider(path, DeviceKind::Joystick, 5);
        }
    }
    let mut ranked: Vec<_> = best.into_values().collect();
    ranked.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    ranked.into_iter().map(|(path, kind, _)| (path, kind)).collect()
}

#[cfg(target_os = "linux")]
fn open_input(path: &Path) -> Option<File> {
    match open_nonblocking(path) {
        Ok(file) => Some(file),
        // The node exists, but the session did not grant this process access.
        // logind can hand over an fd for a device on the user's seat.
        Err(error)
            if error.raw_os_error() == Some(libc::EACCES)
                || error.raw_os_error() == Some(libc::EPERM) =>
        {
            open_via_logind(path)
        }
        Err(_) => None,
    }
}

#[cfg(target_os = "linux")]
fn open_nonblocking(path: &Path) -> io::Result<File> {
    // Read only, and non-blocking from the start. `O_NONBLOCK` is passed to
    // `open` so nothing has to call `fcntl` afterwards. Opening for write can
    // take the device away from the desktop.
    let bytes = path.as_os_str().as_bytes();
    let c_path = std::ffi::CString::new(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let fd = unsafe {
        libc::open(
            c_path.as_ptr(),
            libc::O_RDONLY | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

/// `org.freedesktop.login1.Session.TakeDevice` for a node this user cannot open.
#[cfg(target_os = "linux")]
fn open_via_logind(path: &Path) -> Option<File> {
    let meta = fs::metadata(path).ok()?;
    let rdev = std::os::unix::fs::MetadataExt::rdev(&meta);
    let major = linux_dev_major(rdev);
    let minor = linux_dev_minor(rdev);
    let conn = gtk::gio::bus_get_sync(
        gtk::gio::BusType::System,
        None::<&gtk::gio::Cancellable>,
    )
    .ok()?;
    let reply_type = gtk::glib::VariantTy::new("(hb)").ok()?;
    let params = gtk::glib::prelude::ToVariant::to_variant(&(major, minor));
    let (variant, fds) = conn
        .call_with_unix_fd_list_sync(
            Some("org.freedesktop.login1"),
            "/org/freedesktop/login1/session/auto",
            "org.freedesktop.login1.Session",
            "TakeDevice",
            Some(&params),
            Some(reply_type),
            gtk::gio::DBusCallFlags::NONE,
            800,
            None::<&gtk::gio::UnixFDList>,
            None::<&gtk::gio::Cancellable>,
        )
        .ok()?;
    let index = variant
        .child_value(0)
        .get::<gtk::glib::variant::Handle>()?
        .0;
    let raw = gtk::gio::prelude::UnixFDListExtManual::get(&fds, index).ok()?;
    let flags = unsafe { libc::fcntl(raw, libc::F_GETFL) };
    if flags >= 0 {
        unsafe {
            libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }
    let fd_flags = unsafe { libc::fcntl(raw, libc::F_GETFD) };
    if fd_flags >= 0 {
        unsafe {
            libc::fcntl(raw, libc::F_SETFD, fd_flags | libc::FD_CLOEXEC);
        }
    }
    Some(unsafe { File::from_raw_fd(raw) })
}

/// glibc's `major()` / `minor()` for a Linux dev_t. Done here so a libc that
/// does not export the macros still builds.
#[cfg(target_os = "linux")]
fn linux_dev_major(dev: u64) -> u32 {
    (((dev >> 8) & 0xfff) | ((dev >> 32) & !0xfff)) as u32
}

#[cfg(target_os = "linux")]
fn linux_dev_minor(dev: u64) -> u32 {
    ((dev & 0xff) | ((dev >> 12) & !0xff)) as u32
}

#[cfg(target_os = "linux")]
fn wait_readable(file: &File, timeout_ms: i32) -> io::Result<bool> {
    let mut pollfd = libc::pollfd {
        fd: file.as_raw_fd(),
        events: libc::POLLIN as libc::c_short,
        revents: 0,
    };
    let ready = unsafe { libc::poll(&mut pollfd, 1, timeout_ms) };
    if ready < 0 {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::Interrupted {
            return Ok(false);
        }
        return Err(error);
    }
    let revents = i32::from(pollfd.revents);
    let bad = i32::from(libc::POLLERR) | i32::from(libc::POLLHUP) | i32::from(libc::POLLNVAL);
    if (revents & bad) != 0 {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "controller went away",
        ));
    }
    Ok(ready > 0)
}

#[cfg(target_os = "linux")]
fn read_event(file: &mut File, kind: DeviceKind, state: &mut State, ranges: &AxisRanges) -> io::Result<()> {
    match kind {
        DeviceKind::Joystick => {
            let mut buf = [0u8; 8];
            file.read_exact(&mut buf)?;
            apply_js(
                state,
                buf[6],
                buf[7],
                i16::from_le_bytes([buf[4], buf[5]]),
            );
        }
        DeviceKind::Evdev => {
            // The kernel event is 24 bytes on the 64-bit builds Orbit ships.
            // `size_of::<input_event>()` follows the libc struct, which is not
            // the same layout on every toolchain, and a mismatch shifts every
            // button code so a real pad looks like it never moved.
            let mut buf = [0u8; 24];
            file.read_exact(&mut buf)?;
            let (kind, code, value) = parse_evdev_event(&buf);
            apply_evdev_ranged(state, kind, code, value, ranges);
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
    state.buttons[negative] = hat_down(value, false);
    state.buttons[positive] = hat_down(value, true);
}

/// A hat is a direction. The joystick API usually uses ±32767, but some pads
/// report the same axis as -1, 0, or 1, and a threshold of 1000 misses those.
fn hat_down(value: i16, positive: bool) -> bool {
    if value == 0 {
        return false;
    }
    if value.abs() <= 1 {
        return if positive { value > 0 } else { value < 0 };
    }
    if positive {
        value > 1000
    } else {
        value < -1000
    }
}

/// Stick reports can wait. A button press cannot, or a short tap never arrives.
fn should_emit(buttons_changed: bool, axes_changed: bool, elapsed: std::time::Duration) -> bool {
    buttons_changed || (axes_changed && elapsed >= std::time::Duration::from_millis(80))
}

/// Joysticks listed in `/proc/bus/input/devices`.
///
/// The bool is true for an event node. A pad is a block with gamepad button
/// bits, a controller-like name, or a `js*` handler. Requiring the `js*`
/// sibling missed every pad on a desktop where joydev is not loaded, which is
/// the usual desktop now.
fn pads_in_proc(text: &str) -> Vec<(String, bool, i32)> {
    let mut found = Vec::new();
    for block in text.split("\n\n") {
        let mut name = String::new();
        let mut key_bits = String::new();
        let mut events = Vec::new();
        let mut joys = Vec::new();
        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("N: Name=") {
                name = rest.trim_matches('"').to_string();
            } else if let Some(rest) = line.strip_prefix("B: KEY=") {
                key_bits = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("H: Handlers=") {
                for token in rest.split_whitespace() {
                    if let Some(index) = token.strip_prefix("event") {
                        if !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()) {
                            events.push(token.to_string());
                        }
                    } else if let Some(index) = token.strip_prefix("js") {
                        if !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()) {
                            joys.push(token.to_string());
                        }
                    }
                }
            }
        }
        let score = pad_score(&name, &key_bits, !joys.is_empty());
        if score <= 0 {
            continue;
        }
        for token in events {
            found.push((format!("/dev/input/{token}"), true, score + 15));
        }
        for token in joys {
            found.push((format!("/dev/input/{token}"), false, score));
        }
    }
    found
}

/// Event nodes `/proc` did not describe, read from sysfs. Same button-bit test.
#[cfg(target_os = "linux")]
fn pads_in_sys() -> Vec<(PathBuf, i32)> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/class/input") else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("event") {
            continue;
        }
        let device = entry.path().join("device");
        let key = fs::read_to_string(device.join("capabilities/key")).unwrap_or_default();
        let dev_name = fs::read_to_string(device.join("name")).unwrap_or_default();
        let score = pad_score(&dev_name, &key, false);
        if score > 0 {
            found.push((PathBuf::from(format!("/dev/input/{name}")), score));
        }
    }
    found
}

/// Higher is a more likely pad. Zero is not a pad: keyboards and touchpads stay
/// closed so a keypress is not also a navigation.
fn pad_score(name: &str, key_bits: &str, has_js: bool) -> i32 {
    let lower = name.to_ascii_lowercase();
    if lower.contains("touchpad")
        || lower.contains("mouse")
        || lower.contains("keyboard")
        || lower.contains("trackpoint")
    {
        return 0;
    }
    let gamepad_bits = bitmap_has_bit(key_bits, 0x130)
        || bitmap_has_bit(key_bits, 0x131)
        || bitmap_has_bit(key_bits, 0x120)
        || bitmap_has_bit(key_bits, 0x220);
    let named = lower.contains("controller")
        || lower.contains("gamepad")
        || lower.contains("joystick")
        || lower.contains("xbox")
        || lower.contains("dualshock")
        || lower.contains("dualsense")
        || lower.contains("nintendo")
        || lower.contains("8bitdo");
    if !gamepad_bits && !named && !has_js {
        return 0;
    }
    let mut score = 0;
    if gamepad_bits {
        score += 80;
    }
    if named {
        score += 20;
    }
    if has_js {
        score += 10;
    }
    score
}

/// `/proc` prints the capability bitmap most-significant word first, and skips
/// empty high words. Counting from the right is the low bits.
fn bitmap_has_bit(text: &str, bit: u32) -> bool {
    let words: Vec<&str> = text.split_whitespace().filter(|word| !word.is_empty()).collect();
    if words.is_empty() {
        return false;
    }
    let width = (std::mem::size_of::<usize>() * 8) as u32;
    let from_low = (bit / width) as usize;
    if from_low >= words.len() {
        return false;
    }
    let word = words[words.len() - 1 - from_low];
    let value = u64::from_str_radix(word, 16).unwrap_or(0);
    let shift = bit % width;
    if shift >= 64 {
        return false;
    }
    value & (1u64 << shift) != 0
}

/// `EVIOCGBIT(EV_KEY)`. `Some(false)` is a node that is positively not a pad.
/// `None` means the ioctl failed, so the caller still tries to read it.
#[cfg(target_os = "linux")]
fn gamepad_keys(file: &File) -> Option<bool> {
    let mut bits = [0u8; 96];
    let size = bits.len() as u64;
    let request = (2u64 << 30) | (size << 16) | ((b'E' as u64) << 8) | (0x20 + 1);
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), request as libc::Ioctl, bits.as_mut_ptr()) };
    if rc <= 0 {
        return None;
    }
    Some(key_bit(&bits, 0x130) || key_bit(&bits, 0x120) || key_bit(&bits, 0x220))
}

/// Type, code, and value of a 64-bit kernel `input_event`.
fn parse_evdev_event(buf: &[u8]) -> (u16, u16, i32) {
    (
        u16::from_le_bytes([buf[16], buf[17]]),
        u16::from_le_bytes([buf[18], buf[19]]),
        i32::from_le_bytes([buf[20], buf[21], buf[22], buf[23]]),
    )
}

fn key_bit(bits: &[u8], code: u16) -> bool {
    let index = code as usize;
    let byte = index / 8;
    if byte >= bits.len() {
        return false;
    }
    bits[byte] & (1 << (index % 8)) != 0
}

/// evdev codes. These are stable across pads; joydev's button numbers are not.
fn apply_evdev(state: &mut State, kind: u16, code: u16, value: i32) {
    apply_evdev_ranged(state, kind, code, value, &AxisRanges::standard());
}

fn apply_evdev_ranged(state: &mut State, kind: u16, code: u16, value: i32, ranges: &AxisRanges) {
    const EV_KEY: u16 = 1;
    const EV_ABS: u16 = 3;
    if kind == EV_KEY {
        if let Some(index) = evdev_button(code) {
            state.buttons[index] = value != 0;
        }
    } else if kind == EV_ABS {
        apply_evdev_axis_ranged(state, code, value, ranges);
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
    apply_evdev_axis_ranged(state, code, value, &AxisRanges::standard());
}

fn apply_evdev_axis_ranged(state: &mut State, code: u16, value: i32, ranges: &AxisRanges) {
    let pressed = |value: i32| if value < 0 { -32767 } else if value > 0 { 32767 } else { 0 };
    match code {
        0 => state.axes[0] = norm_range(value, ranges.left_x),
        1 => state.axes[1] = norm_range(value, ranges.left_y),
        3 => state.axes[2] = norm_range(value, ranges.right_x),
        4 => state.axes[3] = norm_range(value, ranges.right_y),
        // Buttons only. Also writing the stick axis would step twice for one press.
        16 => set_hat(state, true, pressed(value)),
        17 => set_hat(state, false, pressed(value)),
        _ => {}
    }
}

struct AxisRanges {
    left_x: (i32, i32),
    left_y: (i32, i32),
    right_x: (i32, i32),
    right_y: (i32, i32),
}

impl AxisRanges {
    fn standard() -> Self {
        Self {
            left_x: (-32767, 32767),
            left_y: (-32767, 32767),
            right_x: (-32767, 32767),
            right_y: (-32767, 32767),
        }
    }
}

/// Map a raw axis into -1..1. Pads do not agree on the raw range: some use
/// ±32767, some use 0..255, and dividing everything by 32767 makes the second
/// kind look like the stick never left the middle.
#[cfg(target_os = "linux")]
fn read_ranges(file: &File) -> AxisRanges {
    AxisRanges {
        left_x: read_abs(file, 0),
        left_y: read_abs(file, 1),
        right_x: read_abs(file, 3),
        right_y: read_abs(file, 4),
    }
}

#[cfg(target_os = "linux")]
fn read_abs(file: &File, code: u16) -> (i32, i32) {
    let mut info = libc::input_absinfo {
        value: 0,
        minimum: 0,
        maximum: 0,
        fuzz: 0,
        flat: 0,
        resolution: 0,
    };
    // `_IOR('E', 0x40 + axis, struct input_absinfo)`. Done by hand so a missing
    // libc constant cannot fail the build. The shift is unsigned: `2 << 30` as
    // a signed integer overflows.
    let size = std::mem::size_of::<libc::input_absinfo>() as libc::c_ulong;
    let request = (2u64 << 30)
        | ((size as u64) << 16)
        | ((b'E' as u64) << 8)
        | (0x40 + code as u64);
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), request as libc::Ioctl, &mut info) };
    if rc < 0 || info.maximum <= info.minimum {
        return (-32767, 32767);
    }
    (info.minimum, info.maximum)
}

fn norm_range(value: i32, range: (i32, i32)) -> f32 {
    let (min, max) = range;
    if max <= min {
        return 0.0;
    }
    let span = (max - min) as f32;
    let mid = (max as f32 + min as f32) / 2.0;
    ((value as f32 - mid) / (span / 2.0)).clamp(-1.0, 1.0)
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

    #[test]
    fn a_hat_reported_as_one_is_still_a_direction() {
        let mut state = State::new();
        apply_js_axis(&mut state, 7, -1);
        assert!(state.buttons[12]);
        assert!(!state.buttons[13]);
    }

    #[test]
    fn a_byte_sized_stick_still_reaches_the_edge() {
        let mut state = State::new();
        let ranges = AxisRanges {
            left_x: (0, 255),
            left_y: (0, 255),
            right_x: (0, 255),
            right_y: (0, 255),
        };
        apply_evdev_axis_ranged(&mut state, 0, 255, &ranges);
        assert!(state.axes[0] > 0.9);
        apply_evdev_axis_ranged(&mut state, 0, 128, &ranges);
        assert!(state.axes[0].abs() < 0.05);
    }

    #[test]
    fn a_button_is_sent_immediately_and_a_stick_waits() {
        let wait = std::time::Duration::from_millis(10);
        assert!(should_emit(true, false, wait));
        assert!(!should_emit(false, true, wait));
        assert!(should_emit(false, true, std::time::Duration::from_millis(80)));
    }

    #[test]
    fn proc_lists_the_event_node_before_the_caller_falls_back() {
        let text = "\
N: Name=\"AT Translated Set 2 keyboard\"
H: Handlers=sysrq kbd event0 leds

N: Name=\"Xbox Wireless Controller\"
H: Handlers=event5 js0
";
        let pads = pads_in_proc(text);
        assert_eq!(pads.len(), 2);
        assert_eq!(pads[0].0, "/dev/input/event5");
        assert!(pads[0].1);
        assert_eq!(pads[1].0, "/dev/input/js0");
        assert!(!pads[1].1);
        assert!(pads[0].2 > pads[1].2);
    }

    #[test]
    fn a_pad_without_a_joystick_node_is_still_a_pad() {
        let text = "\
N: Name=\"Wireless Controller\"
H: Handlers=event3
B: KEY=7cdb000000000000 0 0 0 0

N: Name=\"Synaptics TouchPad\"
H: Handlers=event2 mouse0
B: KEY=e520 10000 0 0 0
";
        let pads = pads_in_proc(text);
        assert_eq!(pads.len(), 1);
        assert_eq!(pads[0].0, "/dev/input/event3");
        assert!(bitmap_has_bit("7cdb000000000000 0 0 0 0", 0x130));
        let mut event = [0u8; 24];
        event[16] = 1;
        event[18] = 0x30;
        event[19] = 0x01;
        event[20] = 1;
        let (kind, code, value) = parse_evdev_event(&event);
        assert_eq!((kind, code, value), (1, 0x130, 1));
        assert!(!bitmap_has_bit("e520 10000 0 0 0", 0x130));
        assert_eq!(pad_score("AT Translated Set 2 keyboard", "", false), 0);
    }
}
