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
/// The page ignores a stick inside this. Matching it here means a value that
/// would not move the page is not treated as a held direction either.
const REST_DEAD: f32 = 0.45;

#[derive(Clone, Serialize)]
pub struct PadEvent {
    pub connected: bool,
    pub buttons: Vec<bool>,
    pub axes: Vec<f32>,
}

#[cfg(target_os = "linux")]
struct Published {
    connected: bool,
    buttons: Vec<bool>,
    axes: Vec<f32>,
    /// Presses since the page last asked. A tap shorter than the poll still counts.
    latched: Vec<bool>,
}

#[cfg(target_os = "linux")]
impl Published {
    const fn empty() -> Self {
        Self {
            connected: false,
            buttons: Vec::new(),
            axes: Vec::new(),
            latched: Vec::new(),
        }
    }
}

#[cfg(target_os = "linux")]
static LATEST: std::sync::Mutex<Published> = std::sync::Mutex::new(Published::empty());

/// The latest controller state. The page asks for this. Waiting for an event
/// is what made a working read look like a dead pad: the event never arrived.
pub fn poll() -> PadEvent {
    #[cfg(target_os = "linux")]
    {
        let Ok(mut slot) = LATEST.lock() else {
            return disconnected();
        };
        let mut buttons = if slot.buttons.is_empty() {
            vec![false; BUTTONS]
        } else {
            slot.buttons.clone()
        };
        for (index, latched) in slot.latched.iter().enumerate() {
            if *latched {
                if let Some(button) = buttons.get_mut(index) {
                    *button = true;
                }
            }
        }
        slot.latched.fill(false);
        return PadEvent {
            connected: slot.connected,
            buttons,
            axes: if slot.axes.is_empty() {
                vec![0.0; AXES]
            } else {
                slot.axes.clone()
            },
        };
    }
    #[cfg(not(target_os = "linux"))]
    {
        disconnected()
    }
}

fn disconnected() -> PadEvent {
    PadEvent {
        connected: false,
        buttons: vec![false; BUTTONS],
        axes: vec![0.0; AXES],
    }
}

#[cfg(target_os = "linux")]
fn publish(state: &State, connected: bool) {
    let Ok(mut slot) = LATEST.lock() else {
        return;
    };
    if !connected {
        *slot = Published::empty();
        return;
    }
    if slot.latched.len() != BUTTONS {
        slot.latched = vec![false; BUTTONS];
    }
    for (index, down) in state.buttons.iter().enumerate() {
        if *down {
            slot.latched[index] = true;
        }
    }
    slot.connected = true;
    slot.buttons = state.buttons.clone();
    slot.axes = state.axes.clone();
}

#[derive(Clone)]
struct State {
    buttons: Vec<bool>,
    axes: Vec<f32>,
}

/// What the device was doing the first time it was actually read.
///
/// That sample is the device sitting still. An empty receiver slot, a pad
/// that has not sent a report yet, and a hat whose neutral value is negative
/// all report the same thing as holding up, and the value never changes. It
/// is not a press. A stick that starts there is ignored until it has been
/// near the middle; a button that starts down is ignored until it comes up.
struct Calm {
    seen: bool,
    held_at_open: Vec<bool>,
    axis_ready: Vec<bool>,
}

impl Calm {
    fn new() -> Self {
        Self {
            seen: false,
            held_at_open: Vec::new(),
            axis_ready: Vec::new(),
        }
    }
}

fn calm_state(calm: &mut Calm, raw: &State) -> State {
    if !calm.seen {
        calm.seen = true;
        calm.held_at_open = raw.buttons.clone();
        calm.axis_ready = vec![false; raw.axes.len()];
    }
    let mut out = raw.clone();
    for (index, held) in calm.held_at_open.iter_mut().enumerate() {
        if !*held {
            continue;
        }
        if raw.buttons.get(index) == Some(&true) {
            if let Some(slot) = out.buttons.get_mut(index) {
                *slot = false;
            }
        } else {
            *held = false;
        }
    }
    for (index, ready) in calm.axis_ready.iter_mut().enumerate() {
        let value = raw.axes.get(index).copied().unwrap_or(0.0);
        if !*ready {
            if value.abs() <= REST_DEAD {
                *ready = true;
            } else if let Some(slot) = out.axes.get_mut(index) {
                *slot = 0.0;
            }
        }
    }
    out
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
            // A fault used to end the reader for the rest of the process, so
            // one bad node meant the pad never worked again until relaunch.
            while !crate::quitting() {
                let app_for_fault = app.clone();
                let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| watch(app.clone())));
                if ran.is_err() {
                    log::error!("controller reader faulted; trying again so the window can stay up");
                    let _ = app_for_fault.emit("orbit-gamepad", disconnected());
                    publish(&State::new(), false);
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
                break;
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
    let mut open: Vec<OpenPad> = Vec::new();
    let mut sent = State::new();
    let mut last_emit = std::time::Instant::now();
    let mut next_scan = std::time::Instant::now() - Duration::from_secs(3);
    let mut announced = false;
    while !crate::quitting() {
        // A silent node used to win the scan and be held forever, so the real
        // pad behind it never got a turn. Every pad is sampled, and a new one
        // can join without closing the one that is already open.
        if open.is_empty() || next_scan.elapsed() >= Duration::from_secs(2) {
            adopt_pads(&mut open);
            next_scan = std::time::Instant::now();
        }
        if open.is_empty() {
            if announced {
                publish(&State::new(), false);
                let _ = app.emit("orbit-gamepad", disconnected());
                announced = false;
            }
            std::thread::sleep(Duration::from_millis(1500));
            continue;
        }
        let mut merged = State::new();
        let mut live = false;
        let mut heard = false;
        open.retain_mut(|pad| match pad.sample() {
            Ok(fresh) => {
                if too_many_buttons(&pad.state) {
                    return false;
                }
                // The opening ioctl, or the burst a joystick sends when it is
                // opened, is the rest position. Baselining before that burst
                // arrives would treat the burst as the user holding up.
                if fresh {
                    pad.synced = true;
                }
                if pad.synced {
                    let presented = calm_state(&mut pad.calm, &pad.state);
                    merge_state(&mut merged, &presented);
                    heard = true;
                }
                live = true;
                true
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => true,
            Err(error) => {
                log::info!("controller stopped: {error}");
                false
            }
        });
        if !live {
            publish(&State::new(), false);
            let _ = app.emit("orbit-gamepad", disconnected());
            announced = false;
            std::thread::sleep(Duration::from_millis(400));
            continue;
        }
        if !heard {
            if announced {
                publish(&State::new(), false);
                let _ = app.emit("orbit-gamepad", disconnected());
                announced = false;
            }
            std::thread::sleep(Duration::from_millis(16));
            continue;
        }
        announced = true;
        note(&app, &merged, &mut sent, &mut last_emit, false);
        std::thread::sleep(Duration::from_millis(16));
    }
    publish(&State::new(), false);
}

#[cfg(target_os = "linux")]
struct OpenPad {
    key: PathBuf,
    file: File,
    kind: DeviceKind,
    state: State,
    ranges: AxisRanges,
    hid: Option<HidMap>,
    calm: Calm,
    /// False until a sample has actually been read. A joystick's first read
    /// is the init burst; baselining the empty state before that would make
    /// the burst look like a press.
    synced: bool,
}

#[cfg(target_os = "linux")]
impl OpenPad {
    /// `Ok(true)` once this sample read the device. An empty poll is not a reading.
    fn sample(&mut self) -> io::Result<bool> {
        match self.kind {
            DeviceKind::Evdev => {
                sample_evdev(&self.file, &mut self.state, &self.ranges)?;
                Ok(true)
            }
            DeviceKind::Joystick => {
                drain_stream(&mut self.file, self.kind, &mut self.state, &self.ranges)
            }
            DeviceKind::Hid => {
                let Some(map) = self.hid.as_ref() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "controller node is not a pad",
                    ));
                };
                drain_hid(&mut self.file, map, &mut self.state)
            }
        }
    }
}

/// Open every node that is actually a pad. A node already open stays open.
#[cfg(target_os = "linux")]
fn adopt_pads(open: &mut Vec<OpenPad>) {
    let mut saw_translated = open.iter().any(|pad| !matches!(pad.kind, DeviceKind::Hid));
    for (path, kind, named) in find_devices() {
        // A raw report is only the fallback. Holding it beside the event node
        // would publish a second, wrong reading of the same press.
        if matches!(kind, DeviceKind::Hid) && saw_translated {
            continue;
        }
        let key = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if open.iter().any(|pad| pad.key == key) {
            continue;
        }
        let Some(file) = open_input(&path, named) else {
            if named {
                log::info!(
                    "a controller is at {} but Orbit cannot read it",
                    path.display()
                );
            }
            continue;
        };
        match kind {
            DeviceKind::Evdev => {
                match gamepad_keys(&file) {
                    Some(true) => {}
                    Some(false) => continue,
                    None if !named && !path_looks_like_pad(&path) => continue,
                    None => {}
                }
                let ranges = read_ranges(&file);
                let mut state = State::new();
                if sample_evdev(&file, &mut state, &ranges).is_err() || too_many_buttons(&state) {
                    continue;
                }
                saw_translated = true;
                log::info!("reading a controller from {}", path.display());
                open.push(OpenPad {
                    key,
                    file,
                    kind,
                    state,
                    ranges,
                    hid: None,
                    calm: Calm::new(),
                    synced: false,
                });
            }
            DeviceKind::Joystick => {
                saw_translated = true;
                log::info!("reading a controller from {}", path.display());
                open.push(OpenPad {
                    key,
                    file,
                    kind,
                    state: State::new(),
                    ranges: AxisRanges::standard(),
                    hid: None,
                    calm: Calm::new(),
                    synced: false,
                });
            }
            DeviceKind::Hid => {
                let Some(desc) = read_hid_descriptor(&file) else {
                    continue;
                };
                let Some(map) = parse_hid_descriptor(&desc) else {
                    continue;
                };
                log::info!("reading a controller from {}", path.display());
                open.push(OpenPad {
                    key,
                    file,
                    kind,
                    state: State::new(),
                    ranges: AxisRanges::standard(),
                    hid: Some(map),
                    calm: Calm::new(),
                    synced: false,
                });
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn merge_state(into: &mut State, from: &State) {
    for (slot, down) in from.buttons.iter().enumerate() {
        if *down {
            if let Some(button) = into.buttons.get_mut(slot) {
                *button = true;
            }
        }
    }
    for (slot, value) in from.axes.iter().enumerate() {
        if let Some(axis) = into.axes.get_mut(slot) {
            if value.abs() > axis.abs() {
                *axis = *value;
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn drain_stream(
    file: &mut File,
    kind: DeviceKind,
    state: &mut State,
    ranges: &AxisRanges,
) -> io::Result<bool> {
    let mut read_any = false;
    for _ in 0..64 {
        match read_event(file, kind, state, ranges) {
            Ok(()) => read_any = true,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(read_any),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => return Ok(read_any),
            Err(error) => return Err(error),
        }
    }
    Ok(read_any)
}

#[cfg(target_os = "linux")]
fn drain_hid(file: &mut File, map: &HidMap, state: &mut State) -> io::Result<bool> {
    let mut buf = [0u8; 256];
    let mut read_any = false;
    for _ in 0..32 {
        match file.read(&mut buf) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "controller went away",
                ));
            }
            Ok(n) => {
                *state = decode_hid_report(map, &buf[..n]);
                read_any = true;
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(read_any),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => return Ok(read_any),
            Err(error) => return Err(error),
        }
    }
    Ok(read_any)
}

#[cfg(target_os = "linux")]
fn path_looks_like_pad(path: &Path) -> bool {
    let name = path.to_string_lossy().to_ascii_lowercase();
    name.contains("joystick") || name.contains("gamepad") || name.contains("controller")
}

#[cfg(target_os = "linux")]
fn sample_evdev(file: &File, state: &mut State, ranges: &AxisRanges) -> io::Result<()> {
    let bits = read_key_state(file)?;
    for button in &mut state.buttons {
        *button = false;
    }
    for axis in &mut state.axes {
        *axis = 0.0;
    }
    // Gamepad codes (0x130) and the older joystick codes (0x120). A pad that
    // only has the second set used to count as connected and then never move.
    for code in 0x120u16..0x140 {
        if key_bit(&bits, code) {
            if let Some(index) = evdev_button(code) {
                state.buttons[index] = true;
            }
        }
    }
    for code in [0x220u16, 0x221, 0x222, 0x223] {
        if key_bit(&bits, code) {
            if let Some(index) = evdev_button(code) {
                state.buttons[index] = true;
            }
        }
    }
    let _ = ranges;
    put_stick(file, state, 0, 0, 0);
    put_stick(file, state, 1, 1, 1);
    // Right stick is RX/RY on a modern pad. A generic joystick uses Z/RZ, and
    // only when that axis actually crosses zero — a trigger starts at zero.
    put_stick(file, state, 2, 3, 2);
    put_stick(file, state, 3, 4, 5);
    if let Some(info) = read_abs_info(file, 16) {
        set_hat(state, true, hat_value(info.value));
    }
    if let Some(info) = read_abs_info(file, 17) {
        set_hat(state, false, hat_value(info.value));
    }
    Ok(())
}

/// Write one stick. `fallback` is used only when `primary` is not on the device
/// and the substitute crosses zero. A trigger starts at zero and must not steer.
#[cfg(target_os = "linux")]
fn put_stick(file: &File, state: &mut State, slot: usize, primary: u16, fallback: u16) {
    let info = if let Some(info) = read_abs_info(file, primary) {
        info
    } else if primary != fallback {
        match read_abs_info(file, fallback) {
            Some(info) if info.minimum < 0 => info,
            _ => return,
        }
    } else {
        return;
    };
    if let Some(axis) = state.axes.get_mut(slot) {
        *axis = norm_range(info.value, (info.minimum, info.maximum));
    }
}

#[cfg(target_os = "linux")]
fn hat_value(value: i32) -> i16 {
    if value < 0 {
        -32767
    } else if value > 0 {
        32767
    } else {
        0
    }
}

#[cfg(target_os = "linux")]
fn read_key_state(file: &File) -> io::Result<[u8; 96]> {
    let mut bits = [0u8; 96];
    let size = bits.len() as u64;
    // EVIOCGKEY(len) = _IOC(_IOC_READ, 'E', 0x18, len)
    let request = (2u64 << 30) | (size << 16) | ((b'E' as u64) << 8) | 0x18;
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), request as libc::Ioctl, bits.as_mut_ptr()) };
    if rc < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(bits)
}

#[cfg(target_os = "linux")]
fn note(
    app: &AppHandle,
    state: &State,
    sent: &mut State,
    last_emit: &mut std::time::Instant,
    force: bool,
) {
    publish(state, true);
    let buttons_changed = state.buttons != sent.buttons;
    let axes_changed = state
        .axes
        .iter()
        .zip(sent.axes.iter())
        .any(|(now, then)| (now - then).abs() > 0.12);
    let due = force
        || should_emit(buttons_changed, axes_changed, last_emit.elapsed())
        || last_emit.elapsed() >= Duration::from_secs(2);
    if !due {
        return;
    }
    let _ = app.emit("orbit-gamepad", state.event(true));
    *sent = state.clone();
    *last_emit = std::time::Instant::now();
}

#[cfg(target_os = "linux")]
fn read_hid_descriptor(file: &File) -> Option<Vec<u8>> {
    let mut size: i32 = 0;
    let size_request = (2u64 << 30) | (4u64 << 16) | ((b'H' as u64) << 8) | 0x01;
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), size_request as libc::Ioctl, &mut size) };
    if rc < 0 || size <= 0 || size > 4096 {
        return None;
    }
    let mut buf = vec![0u8; 4 + 4096];
    buf[..4].copy_from_slice(&(size as u32).to_ne_bytes());
    let request = (2u64 << 30) | ((buf.len() as u64) << 16) | ((b'H' as u64) << 8) | 0x02;
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), request as libc::Ioctl, buf.as_mut_ptr()) };
    if rc < 0 {
        return None;
    }
    let n = u32::from_ne_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    let n = n.min(4096);
    Some(buf[4..4 + n].to_vec())
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
    /// `/dev/hidraw*`, for a pad the kernel never turned into an event node.
    Hid,
}

#[cfg(target_os = "linux")]
fn find_devices() -> Vec<(PathBuf, DeviceKind, bool)> {
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
    // An unclassified pad is still an event node. Opening it and asking what
    // buttons it has is cheaper than missing it because the name did not match.
    if let Ok(entries) = fs::read_dir("/dev/input") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(index) = name.strip_prefix("event") else {
                continue;
            };
            if !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()) {
                consider(entry.path(), DeviceKind::Evdev, 3);
            }
        }
    }
    if let Ok(entries) = fs::read_dir("/dev") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Below every event node the kernel already translated. A raw
            // report we misread would otherwise be held instead of that node.
            if name.starts_with("hidraw") {
                consider(entry.path(), DeviceKind::Hid, 1);
            }
        }
    }
    let mut ranked: Vec<_> = best.into_values().collect();
    ranked.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    // Score 5 and up was named as a pad or is a `js*` node. Below that is an
    // unclassified event node or a raw device, probed only when this process
    // can already open it.
    ranked
        .into_iter()
        .map(|(path, kind, score)| (path, kind, score >= 5))
        .collect()
}

#[cfg(target_os = "linux")]
fn open_input(path: &Path, session: bool) -> Option<File> {
    match open_nonblocking(path) {
        Ok(file) => Some(file),
        // The node exists, but the session did not grant this process access.
        // logind can hand over an fd for a device on the user's seat. That call
        // pauses the device, so it is only made for a node already known to be
        // a pad. Asking it of every event node pauses the mouse.
        Err(error)
            if session
                && (error.raw_os_error() == Some(libc::EACCES)
                    || error.raw_os_error() == Some(libc::EPERM)) =>
        {
            if crate::quitting() {
                return None;
            }
            // A fault in the session bus must not end the scan. The next node
            // may be one this process can already open. GTK is not safe to
            // call from this thread once the window is going away.
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| open_via_logind(path)))
                .ok()
                .flatten()
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
        DeviceKind::Hid => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "controller node is not a pad",
            ));
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
    // Success is 0. Treating that as failure skipped every real pad whose
    // path was `/dev/input/eventN`, which is the node most controllers have.
    if rc < 0 {
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
    // BTN_TRIGGER and the buttons after it are the joystick range. They use
    // the same numbers the old joystick node does, so one mapping covers both.
    if (0x120..0x130).contains(&code) {
        return js_button((code - 0x120) as u8);
    }
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
fn read_abs_info(file: &File, code: u16) -> Option<libc::input_absinfo> {
    let mut info = libc::input_absinfo {
        value: 0,
        minimum: 0,
        maximum: 0,
        fuzz: 0,
        flat: 0,
        resolution: 0,
    };
    let size = std::mem::size_of::<libc::input_absinfo>() as libc::c_ulong;
    let request = (2u64 << 30)
        | ((size as u64) << 16)
        | ((b'E' as u64) << 8)
        | (0x40 + code as u64);
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), request as libc::Ioctl, &mut info) };
    if rc < 0 {
        return None;
    }
    if info.maximum <= info.minimum {
        info.minimum = -32767;
        info.maximum = 32767;
    }
    Some(info)
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

#[derive(Clone, Copy)]
enum HidKind {
    Button(usize),
    Axis(usize),
    Hat,
}

struct HidField {
    report_id: u8,
    bit: u32,
    size: u32,
    min: i32,
    max: i32,
    kind: HidKind,
}

struct HidMap {
    fields: Vec<HidField>,
    has_report_id: bool,
}

/// A HID gamepad, the node left when the kernel never created an event device.
fn parse_hid_descriptor(desc: &[u8]) -> Option<HidMap> {
    #[derive(Clone, Copy)]
    struct Globals {
        usage_page: u16,
        report_size: u32,
        report_count: u32,
        report_id: u8,
        logical_min: i32,
        logical_max: i32,
    }
    let mut globals = Globals {
        usage_page: 0,
        report_size: 0,
        report_count: 0,
        report_id: 0,
        logical_min: 0,
        logical_max: 0,
    };
    let mut stack = Vec::new();
    let mut usages = Vec::new();
    let mut usage_min = 0u32;
    let mut usage_max = 0u32;
    let mut bit_offset = 0u32;
    let mut has_report_id = false;
    let mut fields = Vec::new();
    let mut application = 0u16;
    let mut i = 0;
    while i < desc.len() {
        let prefix = desc[i];
        i += 1;
        if prefix == 0xfe {
            if i + 1 >= desc.len() {
                break;
            }
            let len = desc[i] as usize;
            i += 2 + len;
            continue;
        }
        let size = match prefix & 0x03 {
            0 => 0,
            1 => 1,
            2 => 2,
            _ => 4,
        };
        if i + size > desc.len() {
            break;
        }
        let mut raw = 0i32;
        for byte in 0..size {
            raw |= (desc[i + byte] as i32) << (8 * byte);
        }
        i += size;
        let type_ = (prefix >> 2) & 0x03;
        let tag = prefix >> 4;
        match (type_, tag) {
            (1, 0) => globals.usage_page = raw as u16,
            (1, 1) => globals.logical_min = sign_extend(raw, size),
            (1, 2) => globals.logical_max = sign_extend(raw, size),
            (1, 7) => globals.report_size = raw as u32,
            (1, 8) => {
                globals.report_id = raw as u8;
                has_report_id = true;
                bit_offset = 0;
            }
            (1, 9) => globals.report_count = raw as u32,
            (1, 10) => stack.push(globals),
            (1, 11) => {
                if let Some(saved) = stack.pop() {
                    globals = saved;
                }
            }
            (2, 0) => usages.push(raw as u32),
            (2, 1) => usage_min = raw as u32,
            (2, 2) => usage_max = raw as u32,
            (0, 10) => {
                if raw == 1 {
                    let usage = usages.first().copied().unwrap_or(0);
                    let page = if usage > 0xffff {
                        (usage >> 16) as u16
                    } else {
                        globals.usage_page
                    };
                    let id = (usage & 0xffff) as u16;
                    if page == 0x01 {
                        application = id;
                    }
                }
                usages.clear();
                usage_min = 0;
                usage_max = 0;
            }
            (0, 12) => {
                usages.clear();
                usage_min = 0;
                usage_max = 0;
            }
            (0, 8) | (0, 9) | (0, 11) => {
                let constant = raw & 1 != 0;
                let count = globals.report_count;
                let width = globals.report_size;
                if type_ == 0 && tag == 8 && !constant {
                    let local = if usage_min > 0 && usage_max >= usage_min {
                        (usage_min..=usage_max).collect::<Vec<_>>()
                    } else {
                        usages.clone()
                    };
                    for n in 0..count {
                        let usage = if local.len() == 1 {
                            local[0]
                        } else {
                            local.get(n as usize).copied().unwrap_or(0)
                        };
                        let page = if usage > 0xffff {
                            (usage >> 16) as u16
                        } else {
                            globals.usage_page
                        };
                        let id = (usage & 0xffff) as u16;
                        if let Some(kind) = hid_kind(page, id) {
                            let mut min = globals.logical_min;
                            let mut max = globals.logical_max;
                            // A one-byte 0xFF is 255 on the pads that write it
                            // that way. It is -1 only when the minimum is negative.
                            if max < min && min >= 0 {
                                max = (max as u32 & 0xff) as i32;
                            }
                            if max < min {
                                min = 0;
                                max = 255;
                            }
                            fields.push(HidField {
                                report_id: globals.report_id,
                                bit: bit_offset,
                                size: width,
                                min,
                                max,
                                kind,
                            });
                        }
                        bit_offset += width;
                    }
                } else {
                    bit_offset += width * count;
                }
                usages.clear();
                usage_min = 0;
                usage_max = 0;
            }
            _ => {}
        }
    }
    // A mouse also has buttons. Only a gamepad or joystick collection is a pad,
    // or a click in another program would also move Orbit.
    let gamepad = application == 0x04 || application == 0x05;
    if !gamepad || fields.is_empty() {
        return None;
    }
    Some(HidMap { fields, has_report_id })
}

fn sign_extend(value: i32, size: usize) -> i32 {
    match size {
        1 if value & 0x80 != 0 => value | !0xff,
        2 if value & 0x8000 != 0 => value | !0xffff,
        _ => value,
    }
}

fn hid_kind(page: u16, usage: u16) -> Option<HidKind> {
    match page {
        0x09 => {
            let index = usage.saturating_sub(1) as usize;
            if index < 16 {
                Some(HidKind::Button(hid_button_index(index)))
            } else {
                None
            }
        }
        0x01 => match usage {
            0x30 => Some(HidKind::Axis(0)),
            0x31 => Some(HidKind::Axis(1)),
            0x33 => Some(HidKind::Axis(2)),
            0x34 => Some(HidKind::Axis(3)),
            0x39 => Some(HidKind::Hat),
            _ => None,
        },
        _ => None,
    }
}

/// Generic HID face buttons are 1 south, 2 east, 3 west, 4 north, then the
/// shoulders and start. The d-pad arrives as a hat, not as a later button.
fn hid_button_index(index: usize) -> usize {
    match index {
        0 => 0,
        1 => 1,
        2 => 2,
        3 => 3,
        4 => 4,
        5 => 5,
        6 => 8,
        7 => 9,
        8 => 10,
        9 => 11,
        other => other.min(BUTTONS - 1),
    }
}

fn decode_hid_report(map: &HidMap, report: &[u8]) -> State {
    let mut state = State::new();
    if report.is_empty() {
        return state;
    }
    let id = if map.has_report_id { report[0] } else { 0 };
    for field in &map.fields {
        if map.has_report_id && field.report_id != id {
            continue;
        }
        let bit = field.bit + if map.has_report_id { 8 } else { 0 };
        let raw = hid_signed(hid_bits(report, bit, field.size), field.size, field.min);
        match field.kind {
            HidKind::Button(index) => {
                if let Some(button) = state.buttons.get_mut(index) {
                    *button = raw != 0;
                }
            }
            HidKind::Axis(index) => {
                if let Some(axis) = state.axes.get_mut(index) {
                    *axis = norm_range(raw, (field.min, field.max));
                }
            }
            HidKind::Hat => {
                let dirs = hat_dirs(raw, field.min, field.max);
                state.buttons[12] = dirs[0];
                state.buttons[13] = dirs[1];
                state.buttons[14] = dirs[2];
                state.buttons[15] = dirs[3];
            }
        }
    }
    state
}

fn hid_bits(report: &[u8], bit: u32, size: u32) -> i32 {
    if size == 0 || size > 32 {
        return 0;
    }
    let mut value = 0i32;
    for offset in 0..size {
        let pos = bit + offset;
        let byte = (pos / 8) as usize;
        if byte >= report.len() {
            break;
        }
        if report[byte] & (1 << (pos % 8)) != 0 {
            value |= 1 << offset;
        }
    }
    value
}

fn hid_signed(value: i32, size: u32, min: i32) -> i32 {
    if min < 0 && (1..32).contains(&size) {
        let sign = 1i32 << (size - 1);
        if value & sign != 0 {
            return value | (!0 << size);
        }
    }
    value
}

/// Hat positions run clockwise from up. A range of 8 or more keeps a null at
/// the low end; a range of 0..7 uses 0 as up.
fn hat_dirs(value: i32, min: i32, max: i32) -> [bool; 4] {
    if value < min || value > max {
        return [false; 4];
    }
    let wide = max - min >= 8;
    if wide && value == min {
        return [false; 4];
    }
    let pos = if wide { value - min - 1 } else { value - min };
    let pos = pos.rem_euclid(8);
    [
        pos == 7 || pos == 0 || pos == 1,
        pos == 3 || pos == 4 || pos == 5,
        pos == 5 || pos == 6 || pos == 7,
        pos == 1 || pos == 2 || pos == 3,
    ]
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
    fn a_joystick_trigger_is_the_same_press_as_the_south_button() {
        let mut state = State::new();
        apply_evdev(&mut state, 1, 0x120, 1);
        assert!(state.buttons[0]);
        assert!(!state.buttons[1]);
        // A mouse button is not a pad press, so a click cannot steer the page.
        apply_evdev(&mut state, 1, 0x110, 0);
        let mut mouse = State::new();
        apply_evdev(&mut mouse, 1, 0x110, 1);
        assert!(mouse.buttons.iter().all(|down| !down));
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

    #[test]
    fn a_hid_report_presses_the_south_button_and_moves_the_stick() {
        let desc = [
            0x05, 0x01, 0x09, 0x05, 0xa1, 0x01, 0x09, 0x30, 0x09, 0x31, 0x15, 0x00, 0x25, 0xff, 0x75,
            0x08, 0x95, 0x02, 0x81, 0x02, 0x05, 0x09, 0x19, 0x01, 0x29, 0x04, 0x15, 0x00, 0x25, 0x01,
            0x75, 0x01, 0x95, 0x04, 0x81, 0x02, 0xc0,
        ];
        let map = parse_hid_descriptor(&desc).expect("gamepad descriptor");
        let state = decode_hid_report(&map, &[255, 128, 0x01]);
        assert!(state.buttons[0]);
        assert!(!state.buttons[1]);
        assert!(state.axes[0] > 0.9);
        assert!(state.axes[1].abs() < 0.05);
        assert_eq!(hat_dirs(0, 0, 7), [true, false, false, false]);
        assert_eq!(hat_dirs(0, 0, 8), [false, false, false, false]);
        let mouse = [
            0x05, 0x01, 0x09, 0x02, 0xa1, 0x01, 0x09, 0x30, 0x09, 0x31, 0x15, 0x00, 0x26, 0xff, 0x00,
            0x75, 0x08, 0x95, 0x02, 0x81, 0x02, 0x05, 0x09, 0x19, 0x01, 0x29, 0x03, 0x15, 0x00, 0x25,
            0x01, 0x75, 0x01, 0x95, 0x03, 0x81, 0x02, 0xc0,
        ];
        assert!(parse_hid_descriptor(&mouse).is_none());
    }

    #[test]
    fn an_axis_parked_at_open_is_not_holding_up() {
        // A 0..255 axis the kernel has not reported yet sits at 0, which is
        // full up. An empty slot sits at the negative rail. Neither is a press.
        assert!(norm_range(0, (0, 255)) < -0.9);
        let mut calm = Calm::new();
        let mut stuck = State::new();
        stuck.axes[1] = -1.0;
        stuck.buttons[12] = true;
        let first = calm_state(&mut calm, &stuck);
        assert!(first.axes[1].abs() < 0.01);
        assert!(!first.buttons[12]);
        let still = calm_state(&mut calm, &stuck);
        assert!(still.axes[1].abs() < 0.01);
        assert!(!still.buttons[12]);
    }

    #[test]
    fn a_parked_axis_works_after_it_returns_to_the_middle() {
        let mut calm = Calm::new();
        let mut stuck = State::new();
        stuck.axes[1] = -1.0;
        let _ = calm_state(&mut calm, &stuck);
        let mid = calm_state(&mut calm, &State::new());
        assert!(mid.axes[1].abs() < 0.01);
        let mut up = State::new();
        up.axes[1] = -0.8;
        assert!(calm_state(&mut calm, &up).axes[1] < -0.45);
    }

    #[test]
    fn a_resting_stick_still_moves_on_the_first_push() {
        let mut calm = Calm::new();
        let _ = calm_state(&mut calm, &State::new());
        let mut up = State::new();
        up.axes[1] = -0.8;
        up.buttons[0] = true;
        let moved = calm_state(&mut calm, &up);
        assert!(moved.axes[1] < -0.45);
        assert!(moved.buttons[0]);
    }

    #[test]
    fn a_button_held_at_open_counts_only_after_it_is_released() {
        let mut calm = Calm::new();
        let mut held = State::new();
        held.buttons[12] = true;
        assert!(!calm_state(&mut calm, &held).buttons[12]);
        assert!(!calm_state(&mut calm, &State::new()).buttons[12]);
        let mut again = State::new();
        again.buttons[12] = true;
        assert!(calm_state(&mut calm, &again).buttons[12]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_parked_pad_does_not_outrank_a_real_one() {
        let mut calm = Calm::new();
        let mut stuck = State::new();
        stuck.axes[1] = -1.0;
        stuck.buttons[12] = true;
        let phantom = calm_state(&mut calm, &stuck);
        let mut real = State::new();
        real.axes[0] = 0.7;
        real.buttons[15] = true;
        let mut merged = State::new();
        merge_state(&mut merged, &phantom);
        merge_state(&mut merged, &real);
        assert!(merged.axes[1].abs() < 0.01);
        assert!(!merged.buttons[12]);
        assert!(merged.axes[0] > 0.45);
        assert!(merged.buttons[15]);
    }
}
