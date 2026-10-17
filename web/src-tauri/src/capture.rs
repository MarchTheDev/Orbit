//! Screen capture that does not need ffmpeg.
//!
//! Windows copies the monitor with GDI. Linux does the same through the X11
//! root window. A recording is one H.264 `.mp4`. A replay stays in memory
//! until it is saved, so starting a game does not fill the disk.

use std::collections::VecDeque;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Enough for a long custom replay without letting one game fill the RAM.
const MAX_RING_BYTES: usize = 768 * 1024 * 1024;

static PAUSED: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

#[derive(Clone, Copy)]
pub struct Spec {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    pub jpeg_quality: u8,
}

struct Frame {
    width: u32,
    height: u32,
    bytes: Vec<u8>,
}

struct Ring {
    width: u32,
    height: u32,
    fps: u32,
    max_frames: usize,
    bytes: usize,
    frames: VecDeque<Vec<u8>>,
}

/// The last few seconds, kept in memory. Cloning shares the same frames.
#[derive(Clone)]
pub struct Buffer {
    inner: Arc<Mutex<Ring>>,
}

impl Buffer {
    pub fn new(fps: u32, keep: Duration) -> Self {
        let fps = fps.max(1);
        let seconds = keep.as_secs().max(1) as usize;
        Self {
            inner: Arc::new(Mutex::new(Ring {
                width: 0,
                height: 0,
                fps,
                max_frames: seconds.saturating_mul(fps as usize).max(fps as usize),
                bytes: 0,
                frames: VecDeque::new(),
            })),
        }
    }

    pub fn push_jpeg(&self, jpeg: Vec<u8>, width: u32, height: u32) {
        if jpeg.len() < 4 || width < 2 || height < 2 {
            return;
        }
        let mut ring = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if ring.width == 0 {
            ring.width = width;
            ring.height = height;
        }
        if ring.width != width || ring.height != height {
            return;
        }
        ring.bytes = ring.bytes.saturating_add(jpeg.len());
        ring.frames.push_back(jpeg);
        while ring.frames.len() > ring.max_frames || ring.bytes > MAX_RING_BYTES {
            let Some(old) = ring.frames.pop_front() else { break };
            ring.bytes = ring.bytes.saturating_sub(old.len());
        }
    }

    pub fn snapshot(&self, seconds: u32) -> Result<Kept, String> {
        let ring = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if ring.frames.is_empty() || ring.width == 0 {
            let error = last_error();
            if !error.is_empty() {
                return Err(error);
            }
            return Err("Nothing has been kept yet. The replay starts when a game is playing.".to_string());
        }
        let fps = ring.fps.max(1);
        let keep = (seconds.max(1) as usize).saturating_mul(fps as usize).max(1);
        let start = ring.frames.len().saturating_sub(keep);
        Ok(Kept {
            width: ring.width,
            height: ring.height,
            fps,
            frames: ring.frames.iter().skip(start).cloned().collect(),
        })
    }
}

pub struct Kept {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frames: Vec<Vec<u8>>,
}

pub struct Hold {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<(), String>>>,
    buffer: Option<Buffer>,
}

impl Hold {
    pub fn snapshot(&self, seconds: u32) -> Result<Kept, String> {
        self.buffer
            .as_ref()
            .ok_or_else(|| "Nothing has been kept yet. The replay starts when a game is playing.".to_string())?
            .snapshot(seconds)
    }
}

pub fn set_paused(paused: bool) {
    PAUSED.store(paused, Ordering::SeqCst);
}

pub fn last_error() -> String {
    LAST_ERROR.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
}

fn set_error(message: &str) {
    *LAST_ERROR.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = message.to_string();
}

pub fn available() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("DISPLAY").is_some()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        false
    }
}

pub fn save_picture(path: &Path, spec: Spec) -> Result<(), String> {
    let mut spec = spec;
    spec.jpeg_quality = spec.jpeg_quality.max(90);
    let frame = grab(spec)?;
    let jpeg = encode_jpeg(&frame.bytes, frame.width, frame.height, spec.jpeg_quality)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, jpeg).map_err(|error| error.to_string())
}

/// Windows can write an H.264 `.mp4` on its own. Other desktops use ffmpeg.
pub fn can_encode() -> bool {
    cfg!(windows)
}

pub fn start_recording(out: PathBuf, spec: Spec) -> Result<Hold, String> {
    if !can_encode() {
        return Err("This desktop records with ffmpeg.".to_string());
    }
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not start the recording: {error}"))?;
    }
    let _ = grab(spec)?;
    set_error("");
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let ready = Arc::new(Mutex::new(None));
    let signal = Arc::clone(&ready);
    let thread = thread::Builder::new()
        .name("orbit-capture".to_string())
        .spawn(move || run_recording(out, spec, flag, signal))
        .map_err(|error| format!("Could not start the recorder: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Some(message) = ready.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone() {
            if message.is_empty() {
                break;
            }
            stop.store(true, Ordering::SeqCst);
            let _ = thread.join();
            return Err(message);
        }
        if Instant::now() > deadline {
            stop.store(true, Ordering::SeqCst);
            let _ = thread.join();
            return Err("The recorder did not start.".to_string());
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(Hold { stop, thread: Some(thread), buffer: None })
}

pub fn start_buffer(keep: Duration, spec: Spec) -> Result<Hold, String> {
    let _ = grab(spec)?;
    set_error("");
    let buffer = Buffer::new(spec.fps, keep);
    let shared = buffer.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = thread::Builder::new()
        .name("orbit-capture".to_string())
        .spawn(move || run_buffer(shared, spec, flag))
        .map_err(|error| format!("Could not start the replay: {error}"))?;
    Ok(Hold { stop, thread: Some(thread), buffer: Some(buffer) })
}

pub fn finish(mut hold: Hold) -> Result<(), String> {
    hold.stop.store(true, Ordering::SeqCst);
    match hold.thread.take() {
        Some(thread) => thread.join().unwrap_or_else(|_| Err("The recorder stopped.".to_string())),
        None => Ok(()),
    }
}

/// Write one playable `.mp4`. An empty or tiny file is deleted, not left behind.
pub fn write_mp4(path: &Path, kept: &Kept) -> Result<(), String> {
    if kept.frames.is_empty() || kept.width < 2 || kept.height < 2 {
        return Err("The clip was empty.".to_string());
    }
    #[cfg(windows)]
    {
        return write_mp4_windows(path, kept);
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("This desktop saves the video with ffmpeg.".to_string())
    }
}

/// Remove the old per-second replay pieces. They are not videos.
pub fn sweep_replay_files(root: &Path) {
    let replay = root.join("replay");
    if let Ok(entries) = fs::read_dir(&replay) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|item| item.to_str()).unwrap_or("");
            if ext == "orb" || ext == "mkv" || ext == "txt" {
                let _ = fs::remove_file(path);
            }
        }
    }
    let _ = fs::remove_dir(&replay);
    let _ = fs::remove_dir_all(root.join("recording"));
}

fn signal_ready(ready: &Mutex<Option<String>>, message: &str) {
    *ready.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(message.to_string());
}

fn run_recording(out: PathBuf, spec: Spec, stop: Arc<AtomicBool>, ready: Arc<Mutex<Option<String>>>) -> Result<(), String> {
    let first = match grab(spec) {
        Ok(frame) => frame,
        Err(error) => {
            signal_ready(&ready, &error);
            return Err(error);
        }
    };
    let size = Some((first.width, first.height));
    let opened = open_writer(&out, first.width, first.height, spec.fps.max(1));
    let mut writer = match opened {
        Ok(writer) => writer,
        Err(error) => {
            signal_ready(&ready, &error);
            let _ = fs::remove_file(&out);
            return Err(error);
        }
    };
    signal_ready(&ready, "");
    let mut written = 0u32;
    if writer.push_bgra(&first.bytes).is_ok() {
        written += 1;
    }
    let mut last = first.bytes;
    let interval = Duration::from_millis(1000 / spec.fps.max(1) as u64);
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let began = Instant::now();
        if PAUSED.load(Ordering::SeqCst) {
            if writer.push_bgra(&last).is_ok() {
                written += 1;
            }
        } else {
            match grab(spec) {
                Ok(frame) => {
                    if size != Some((frame.width, frame.height)) {
                        set_error("The picture size changed, so this frame was skipped.");
                    } else if let Err(error) = writer.push_bgra(&frame.bytes) {
                        set_error(&error);
                    } else {
                        last = frame.bytes;
                        written += 1;
                        set_error("");
                    }
                }
                Err(error) => set_error(&error),
            }
        }
        let spent = began.elapsed();
        if spent < interval {
            sleep_until(&stop, interval - spent);
        }
    }
    let finished = writer.finish();
    if written == 0 || missing_video(&out) {
        let _ = fs::remove_file(&out);
        return Err(if last_error().is_empty() {
            "The recording was empty.".to_string()
        } else {
            last_error()
        });
    }
    finished
}

fn run_buffer(buffer: Buffer, spec: Spec, stop: Arc<AtomicBool>) -> Result<(), String> {
    let interval = Duration::from_millis(1000 / spec.fps.max(1) as u64);
    let mut size = None;
    let mut last: Option<(Vec<u8>, u32, u32)> = None;
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let began = Instant::now();
        if PAUSED.load(Ordering::SeqCst) {
            if let Some((jpeg, width, height)) = last.clone() {
                buffer.push_jpeg(jpeg, width, height);
            }
        } else {
            match grab_jpeg(spec, &mut size) {
                Ok(jpeg) => {
                    let (width, height) = size.unwrap_or((0, 0));
                    last = Some((jpeg.clone(), width, height));
                    buffer.push_jpeg(jpeg, width, height);
                    set_error("");
                }
                Err(error) => set_error(&error),
            }
        }
        let spent = began.elapsed();
        if spent < interval {
            sleep_until(&stop, interval - spent);
        }
    }
    Ok(())
}

fn sleep_until(stop: &AtomicBool, duration: Duration) {
    let end = Instant::now() + duration;
    while Instant::now() < end {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn grab_jpeg(spec: Spec, size: &mut Option<(u32, u32)>) -> Result<Vec<u8>, String> {
    let frame = grab(spec)?;
    let (width, height) = *size.get_or_insert((frame.width, frame.height));
    let bytes = if frame.width == width && frame.height == height {
        frame.bytes
    } else {
        scale_bgra(&frame.bytes, frame.width, frame.height, width, height)
    };
    encode_jpeg(&bytes, width, height, spec.jpeg_quality)
}

fn grab(spec: Spec) -> Result<Frame, String> {
    grab_screen(spec)
}

fn encode_jpeg(bgra: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || width > u16::MAX as u32 || height > u16::MAX as u32 {
        return Err("The picture size could not be used.".to_string());
    }
    let quality = quality.clamp(1, 100);
    let mut bytes = Vec::new();
    jpeg_encoder::Encoder::new(&mut bytes, quality)
        .encode(bgra, width as u16, height as u16, jpeg_encoder::ColorType::Bgra)
        .map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("The picture could not be encoded.".to_string());
    }
    Ok(bytes)
}

#[cfg(windows)]
fn grab_screen(spec: Spec) -> Result<Frame, String> {
    use std::ffi::c_void;

    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
        SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, COLORONCOLOR, DIB_RGB_COLORS,
        HGDIOBJ, RGBQUAD, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    let (src_x, src_y, src_w, src_h) = unsafe { monitor_rect() };
    let (src_w, src_h) = if src_w > 1 && src_h > 1 {
        (src_w, src_h)
    } else {
        let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        (width, height)
    };
    if src_w < 2 || src_h < 2 {
        return Err("The screen size could not be read.".to_string());
    }
    let (width, height) = fit(src_w as u32, src_h as u32, spec.max_width, spec.max_height);
    unsafe {
        let screen = GetDC(None);
        if screen == Default::default() {
            return Err("The screen could not be opened.".to_string());
        }
        let memory = CreateCompatibleDC(Some(screen));
        if memory == Default::default() {
            ReleaseDC(None, screen);
            return Err("The screen could not be copied.".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen, width as i32, height as i32);
        if bitmap == Default::default() {
            let _ = DeleteDC(memory);
            ReleaseDC(None, screen);
            return Err("The screen could not be copied.".to_string());
        }
        let previous = SelectObject(memory, gdi_object(bitmap));
        SetStretchBltMode(memory, COLORONCOLOR);
        let copied = StretchBlt(
            memory,
            0,
            0,
            width as i32,
            height as i32,
            Some(screen),
            src_x,
            src_y,
            src_w,
            src_h,
            SRCCOPY,
        )
        .as_bool();
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                biSizeImage: (width * height * 4) as u32,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD::default()],
        };
        let rows = if copied {
            GetDIBits(
                memory,
                bitmap,
                0,
                height,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        if previous != HGDIOBJ::default() {
            SelectObject(memory, previous);
        }
        let _ = DeleteObject(gdi_object(bitmap));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if !copied || rows != height as i32 {
            return Err("The screen could not be copied.".to_string());
        }
        Ok(Frame { width, height, bytes: pixels })
    }
}

#[cfg(windows)]
fn gdi_object(bitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> windows::Win32::Graphics::Gdi::HGDIOBJ {
    // Both handles are a pointer. Copying the bits keeps the bitmap usable.
    unsafe { std::mem::transmute(bitmap) }
}

#[cfg(windows)]
unsafe fn monitor_rect() -> (i32, i32, i32, i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};

    let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..MONITORINFO::default()
    };
    if GetMonitorInfoW(monitor, &mut info).as_bool() {
        let rect = info.rcMonitor;
        return (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    }
    (0, 0, 0, 0)
}

#[cfg(target_os = "linux")]
fn grab_screen(spec: Spec) -> Result<Frame, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{get_image, ImageFormat};
    use x11rb::rust_connection::RustConnection;

    if std::env::var_os("DISPLAY").is_none() {
        return Err("This Wayland desktop cannot be recorded without ffmpeg. An X11 session records on its own.".to_string());
    }
    let (conn, screen_num) = RustConnection::connect(None).map_err(|error| {
        format!("The screen could not be opened. An X11 session records on its own. {error}")
    })?;
    let setup = conn.setup();
    let screen = setup.roots.get(screen_num).ok_or_else(|| "The screen could not be opened.".to_string())?;
    let width = screen.width_in_pixels;
    let height = screen.height_in_pixels;
    if width < 2 || height < 2 {
        return Err("The screen size could not be read.".to_string());
    }
    let max_bytes = (setup.maximum_request_length as usize * 4).saturating_sub(64);
    let row_bytes = width as usize * 4;
    if row_bytes == 0 || max_bytes < row_bytes {
        return Err("The screen is too wide to copy without ffmpeg.".to_string());
    }
    let rows = (max_bytes / row_bytes).clamp(1, height as usize) as u16;
    let mut raw = vec![0u8; width as usize * height as usize * 4];
    let mut y = 0u16;
    while y < height {
        let tile = rows.min(height - y);
        let reply = get_image(&conn, ImageFormat::Z_PIXMAP, screen.root, 0, y as i16, width, tile, u32::MAX)
            .map_err(|error| error.to_string())?
            .reply()
            .map_err(|error| error.to_string())?;
        let expect = width as usize * tile as usize * 4;
        if reply.data.len() < expect {
            return Err("This desktop returned a picture Orbit could not read. ffmpeg can still be used as a fallback.".to_string());
        }
        let start = y as usize * width as usize * 4;
        raw[start..start + expect].copy_from_slice(&reply.data[..expect]);
        y += tile;
    }
    let (out_w, out_h) = fit(width as u32, height as u32, spec.max_width, spec.max_height);
    let bytes = if out_w == width as u32 && out_h == height as u32 {
        raw
    } else {
        scale_bgra(&raw, width as u32, height as u32, out_w, out_h)
    };
    Ok(Frame { width: out_w, height: out_h, bytes })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn grab_screen(_spec: Spec) -> Result<Frame, String> {
    Err("Recording is not available on this system.".to_string())
}

pub fn fit(src_w: u32, src_h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let src_w = src_w.max(2);
    let src_h = src_h.max(2);
    let max_w = max_w.max(2);
    let max_h = max_h.max(2);
    let scale = (max_w as f64 / src_w as f64).min(max_h as f64 / src_h as f64).min(1.0);
    let mut width = ((src_w as f64) * scale).round() as u32;
    let mut height = ((src_h as f64) * scale).round() as u32;
    width = (width.max(2) / 2) * 2;
    height = (height.max(2) / 2) * 2;
    if width > src_w {
        width = (src_w / 2) * 2;
    }
    if height > src_h {
        height = (src_h / 2) * 2;
    }
    (width.max(2), height.max(2))
}

pub fn scale_bgra(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let need = src_w as usize * src_h as usize * 4;
    if src_w == dst_w && src_h == dst_h && src.len() >= need {
        return src[..need].to_vec();
    }
    let mut out = vec![0u8; dst_w as usize * dst_h as usize * 4];
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return out;
    }
    for y in 0..dst_h {
        let y0 = (y as u64 * src_h as u64) / dst_h as u64;
        let y1 = (((y as u64 + 1) * src_h as u64) / dst_h as u64).max(y0 + 1).min(src_h as u64);
        for x in 0..dst_w {
            let x0 = (x as u64 * src_w as u64) / dst_w as u64;
            let x1 = (((x as u64 + 1) * src_w as u64) / dst_w as u64).max(x0 + 1).min(src_w as u64);
            let mut blue = 0u64;
            let mut green = 0u64;
            let mut red = 0u64;
            let mut count = 0u64;
            for sy in y0..y1 {
                let row = sy as usize * src_w as usize * 4;
                for sx in x0..x1 {
                    let index = row + sx as usize * 4;
                    if index + 2 < src.len() {
                        blue += src[index] as u64;
                        green += src[index + 1] as u64;
                        red += src[index + 2] as u64;
                        count += 1;
                    }
                }
            }
            let offset = (y as usize * dst_w as usize + x as usize) * 4;
            if count > 0 {
                out[offset] = (blue / count) as u8;
                out[offset + 1] = (green / count) as u8;
                out[offset + 2] = (red / count) as u8;
                out[offset + 3] = 255;
            }
        }
    }
    out
}

fn missing_video(path: &Path) -> bool {
    fs::metadata(path).map(|meta| meta.len() < 32).unwrap_or(true)
}

fn open_writer(path: &Path, width: u32, height: u32, fps: u32) -> Result<Writer, String> {
    #[cfg(windows)]
    {
        return WindowsWriter::open(path, width, height, fps).map(Writer::Windows);
    }
    #[cfg(not(windows))]
    {
        let _ = (path, width, height, fps);
        Err("This desktop records with ffmpeg.".to_string())
    }
}

#[allow(dead_code)]
enum Writer {
    #[cfg(windows)]
    Windows(WindowsWriter),
    #[cfg(not(windows))]
    Missing,
}

impl Writer {
    fn push_bgra(&mut self, bgra: &[u8]) -> Result<(), String> {
        #[cfg(windows)]
        {
            match self {
                Writer::Windows(writer) => writer.push_bgra(bgra),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (self, bgra);
            Err("This desktop records with ffmpeg.".to_string())
        }
    }

    fn finish(self) -> Result<(), String> {
        match self {
            #[cfg(windows)]
            Writer::Windows(writer) => writer.finish(),
            #[cfg(not(windows))]
            Writer::Missing => Err("This desktop records with ffmpeg.".to_string()),
        }
    }
}

#[cfg(windows)]
fn write_mp4_windows(path: &Path, kept: &Kept) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut writer = WindowsWriter::open(path, kept.width, kept.height, kept.fps.max(1))?;
    let mut written = 0u32;
    for jpeg in &kept.frames {
        let (width, height, bgra) = match decode_jpeg(jpeg) {
            Ok(frame) => frame,
            Err(error) => {
                writer.abandon();
                let _ = fs::remove_file(path);
                return Err(error);
            }
        };
        if width != kept.width || height != kept.height || bgra.len() < kept.width as usize * kept.height as usize * 4 {
            continue;
        }
        if let Err(error) = writer.push_bgra(&bgra) {
            writer.abandon();
            let _ = fs::remove_file(path);
            return Err(error);
        }
        written += 1;
    }
    if written == 0 {
        writer.abandon();
        let _ = fs::remove_file(path);
        return Err("The clip was empty.".to_string());
    }
    if let Err(error) = writer.finish() {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    if missing_video(path) {
        let _ = fs::remove_file(path);
        return Err("The video file was empty.".to_string());
    }
    Ok(())
}

#[cfg(windows)]
struct WindowsWriter {
    writer: windows::Win32::Media::MediaFoundation::IMFSinkWriter,
    stream: u32,
    width: u32,
    height: u32,
    fps: u32,
    index: u64,
    open: bool,
}

#[cfg(windows)]
impl WindowsWriter {
    fn open(path: &Path, width: u32, height: u32, fps: u32) -> Result<Self, String> {
        use std::os::windows::ffi::OsStrExt;

        use windows::core::PCWSTR;
        use windows::Win32::Media::MediaFoundation::{
            MFCreateMediaType, MFCreateSinkWriterFromURL, MFStartup, IMFAttributes, IMFByteStream,
            MFVideoFormat_H264, MFVideoFormat_RGB32, MF_MT_AVG_BITRATE, MF_MT_DEFAULT_STRIDE, MF_MT_FIXED_SIZE_SAMPLES,
            MF_MT_SAMPLE_SIZE,
        };
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        if width < 2 || height < 2 || width % 2 == 1 || height % 2 == 1 {
            return Err("The picture size could not be used.".to_string());
        }
        let fps = fps.max(1);
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(0x0002_0070, 0).map_err(|error| format!("The video encoder could not start: {error}"))?;
        }
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        // `Param` is implemented for `Option<&T>`, not `Option<T>`.
        let writer = unsafe {
            MFCreateSinkWriterFromURL(PCWSTR(wide.as_ptr()), None::<&IMFByteStream>, None::<&IMFAttributes>)
        }
        .map_err(mf_fail)?;
        let bitrate = ((width as u64).saturating_mul(height as u64).saturating_mul(fps as u64) / 8)
            .clamp(1_500_000, 20_000_000) as u32;
        let stream = unsafe {
            let out_type = MFCreateMediaType().map_err(mf_fail)?;
            set_video(&out_type, &MFVideoFormat_H264, width, height, fps)?;
            out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(mf_fail)?;
            let stream = writer.AddStream(&out_type).map_err(mf_fail)?;
            let in_type = MFCreateMediaType().map_err(mf_fail)?;
            set_video(&in_type, &MFVideoFormat_RGB32, width, height, fps)?;
            in_type
                .SetUINT32(&MF_MT_DEFAULT_STRIDE, width.saturating_mul(4))
                .map_err(mf_fail)?;
            in_type.SetUINT32(&MF_MT_FIXED_SIZE_SAMPLES, 1).map_err(mf_fail)?;
            in_type
                .SetUINT32(&MF_MT_SAMPLE_SIZE, width.saturating_mul(height).saturating_mul(4))
                .map_err(mf_fail)?;
            writer.SetInputMediaType(stream, &in_type, None::<&IMFAttributes>).map_err(mf_fail)?;
            writer.BeginWriting().map_err(mf_fail)?;
            stream
        };
        Ok(Self { writer, stream, width, height, fps, index: 0, open: true })
    }

    fn push_bgra(&mut self, bgra: &[u8]) -> Result<(), String> {
        use windows::Win32::Media::MediaFoundation::{MFCreateMemoryBuffer, MFCreateSample};

        let expect = self.width as usize * self.height as usize * 4;
        if bgra.len() < expect {
            return Err("A frame was the wrong size.".to_string());
        }
        unsafe {
            let buffer = MFCreateMemoryBuffer(expect as u32).map_err(|error| error.to_string())?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None).map_err(|error| error.to_string())?;
            if ptr.is_null() {
                let _ = buffer.Unlock();
                return Err("A frame could not be copied.".to_string());
            }
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), ptr, expect);
            buffer.Unlock().map_err(|error| error.to_string())?;
            buffer.SetCurrentLength(expect as u32).map_err(|error| error.to_string())?;
            let sample = MFCreateSample().map_err(|error| error.to_string())?;
            sample.AddBuffer(&buffer).map_err(|error| error.to_string())?;
            let duration = 10_000_000i64 / self.fps.max(1) as i64;
            let when = self.index as i64 * duration;
            sample.SetSampleTime(when).map_err(|error| error.to_string())?;
            sample.SetSampleDuration(duration).map_err(|error| error.to_string())?;
            self.writer.WriteSample(self.stream, &sample).map_err(|error| error.to_string())?;
        }
        self.index += 1;
        Ok(())
    }

    fn finish(mut self) -> Result<(), String> {
        use windows::Win32::Media::MediaFoundation::MFShutdown;

        if !self.open {
            return Ok(());
        }
        self.open = false;
        let result = unsafe { self.writer.Finalize() }.map_err(|error| format!("The video could not be finished: {error}"));
        unsafe {
            let _ = MFShutdown();
        }
        result
    }

    fn abandon(&mut self) {
        use windows::Win32::Media::MediaFoundation::MFShutdown;

        if !self.open {
            return;
        }
        self.open = false;
        unsafe {
            let _ = self.writer.Finalize();
            let _ = MFShutdown();
        }
    }
}

#[cfg(windows)]
fn set_video(
    kind: &windows::Win32::Media::MediaFoundation::IMFMediaType,
    subtype: &windows::core::GUID,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<(), String> {
    use windows::Win32::Media::MediaFoundation::{
        MFMediaType_Video, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
        MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE,
    };

    unsafe {
        kind.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(mf_fail)?;
        kind.SetGUID(&MF_MT_SUBTYPE, subtype).map_err(mf_fail)?;
        kind.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height)).map_err(mf_fail)?;
        kind.SetUINT64(&MF_MT_FRAME_RATE, pack(fps.max(1), 1)).map_err(mf_fail)?;
        kind.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1)).map_err(mf_fail)?;
        // Progressive. The named constant is a newtype, and the attribute is a plain number.
        kind.SetUINT32(&MF_MT_INTERLACE_MODE, 2).map_err(mf_fail)?;
    }
    Ok(())
}

#[cfg(windows)]
fn mf_fail(error: windows::core::Error) -> String {
    use windows::Win32::Media::MediaFoundation::MFShutdown;

    unsafe {
        let _ = MFShutdown();
    }
    format!("The video file could not be opened: {error}")
}

#[cfg(windows)]
fn pack(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | low as u64
}

fn decode_jpeg(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    let pixels = decoder.decode().map_err(|error| format!("A frame could not be read: {error}"))?;
    let info = decoder.info().ok_or_else(|| "A frame could not be read.".to_string())?;
    let width = info.width as u32;
    let height = info.height as u32;
    if width < 2 || height < 2 {
        return Err("A frame could not be read.".to_string());
    }
    let bgra = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => {
            let mut out = Vec::with_capacity((pixels.len() / 3) * 4);
            for pixel in pixels.chunks_exact(3) {
                out.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
            }
            out
        }
        jpeg_decoder::PixelFormat::L8 => {
            let mut out = Vec::with_capacity(pixels.len() * 4);
            for gray in pixels {
                out.extend_from_slice(&[gray, gray, gray, 255]);
            }
            out
        }
        _ => return Err("A frame could not be read.".to_string()),
    };
    Ok((width, height, bgra))
}

/// Width and height from a JPEG, so a piped frame can join the replay without a decoder.
pub fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut index = 2usize;
    while index + 8 < bytes.len() {
        if bytes[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
            let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]) as u32;
            if width >= 2 && height >= 2 {
                return Some((width, height));
            }
            return None;
        }
        if marker == 0xD8 || marker == 0xD9 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            index += 2;
            continue;
        }
        if index + 3 >= bytes.len() {
            break;
        }
        let len = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
        if len < 2 {
            break;
        }
        index += 2 + len;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_jpeg() -> Vec<u8> {
        let mut pixels = vec![0u8; 16 * 16 * 4];
        for pixel in pixels.chunks_exact_mut(4) {
            pixel[2] = 220;
            pixel[3] = 255;
        }
        encode_jpeg(&pixels, 16, 16, 80).unwrap()
    }

    #[test]
    fn a_smaller_screen_is_not_stretched_and_stays_even() {
        assert_eq!(fit(1366, 768, 3840, 2160), (1366, 768));
        assert_eq!(fit(1920, 1080, 1280, 720), (1280, 720));
        assert_eq!(fit(2560, 1440, 1920, 1080), (1920, 1080));
        assert_eq!(fit(3440, 1440, 1920, 1080).0 % 2, 0);
        assert_eq!(fit(3440, 1440, 1920, 1080).1 % 2, 0);
    }

    #[test]
    fn scaling_averages_a_block() {
        let src = [10, 0, 0, 255, 30, 0, 0, 255, 50, 0, 0, 255, 70, 0, 0, 255];
        let out = scale_bgra(&src, 2, 2, 1, 1);
        assert_eq!(out[0], 40);
        assert_eq!(out[3], 255);
    }

    #[test]
    fn the_replay_keeps_only_the_asked_length() {
        let buffer = Buffer::new(2, Duration::from_secs(2));
        let jpeg = sample_jpeg();
        for _ in 0..6 {
            buffer.push_jpeg(jpeg.clone(), 16, 16);
        }
        assert_eq!(buffer.snapshot(2).unwrap().frames.len(), 4);
        assert_eq!(buffer.snapshot(1).unwrap().frames.len(), 2);
    }

    #[test]
    fn a_frame_round_trips_and_reports_its_size() {
        let jpeg = sample_jpeg();
        assert_eq!(jpeg_size(&jpeg), Some((16, 16)));
        let (width, height, bgra) = decode_jpeg(&jpeg).unwrap();
        assert_eq!((width, height), (16, 16));
        assert_eq!(bgra.len(), 16 * 16 * 4);
        assert!(bgra[2] > 100);
    }

    #[test]
    fn an_empty_clip_is_not_written() {
        let kept = Kept { width: 16, height: 16, fps: 30, frames: Vec::new() };
        assert!(write_mp4(Path::new("unused.mp4"), &kept).is_err());
    }
}
