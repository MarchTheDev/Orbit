//! Screen capture that does not need ffmpeg.
//!
//! Windows copies the monitor with GDI and writes JPEG frames. Linux does the
//! same through the X11 root window. The clip is an MJPEG AVI, which a normal
//! player opens, so nothing has to be installed to record or to keep a replay.

use std::fs::{self, File};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CHUNK_MAGIC: &[u8; 4] = b"ORB1";

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

enum Job {
    Record { parts: PathBuf, out: PathBuf },
    Buffer { dir: PathBuf, keep: Duration },
}

pub struct Hold {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<(), String>>>,
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

pub fn start_recording(parts: PathBuf, out: PathBuf, spec: Spec) -> Result<Hold, String> {
    fs::create_dir_all(&parts).map_err(|error| format!("Could not start the recording: {error}"))?;
    let _ = grab(spec)?;
    set_error("");
    spawn(Job::Record { parts, out }, spec)
}

pub fn start_buffer(dir: PathBuf, keep: Duration, spec: Spec) -> Result<Hold, String> {
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let _ = grab(spec)?;
    set_error("");
    spawn(Job::Buffer { dir, keep }, spec)
}

pub fn finish(mut hold: Hold) -> Result<(), String> {
    hold.stop.store(true, Ordering::SeqCst);
    match hold.thread.take() {
        Some(thread) => thread.join().unwrap_or_else(|_| Err("The recorder stopped.".to_string())),
        None => Ok(()),
    }
}

pub fn clear_chunks(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("orb") {
            let _ = fs::remove_file(path);
        }
    }
}

pub fn has_recent(dir: &Path, seconds: u32) -> bool {
    let now = unix_millis();
    chunk_files(dir).any(|path| chunk_is_recent(&path, now, seconds))
}

pub fn save_recent(dir: &Path, seconds: u32, out: &Path) -> Result<Muxed, String> {
    let now = unix_millis();
    let files = chunk_files(dir)
        .filter(|path| chunk_is_recent(path, now, seconds))
        .collect::<Vec<_>>();
    if files.is_empty() {
        let error = last_error();
        if !error.is_empty() {
            return Err(error);
        }
        return Err("Nothing has been kept yet. The replay starts when a game is playing.".to_string());
    }
    mux_chunks(&files, out)
}

fn spawn(job: Job, spec: Spec) -> Result<Hold, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = thread::Builder::new()
        .name("orbit-capture".to_string())
        .spawn(move || run(job, spec, flag))
        .map_err(|error| format!("Could not start the recorder: {error}"))?;
    Ok(Hold { stop, thread: Some(thread) })
}

fn run(job: Job, spec: Spec, stop: Arc<AtomicBool>) -> Result<(), String> {
    let interval = Duration::from_millis(1000 / spec.fps.max(1) as u64);
    let mut second = Vec::new();
    let mut started = Instant::now();
    let mut size: Option<(u32, u32)> = None;
    let mut seq = 0u64;
    let mut last = None;
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let began = Instant::now();
        if PAUSED.load(Ordering::SeqCst) {
            // Hold the last game frame so the menu is not what gets saved.
            if let Some(jpeg) = last.clone() {
                second.push(jpeg);
            }
        } else {
            match grab_jpeg(spec, &mut size) {
                Ok(jpeg) => {
                    last = Some(jpeg.clone());
                    second.push(jpeg);
                    set_error("");
                }
                Err(error) => set_error(&error),
            }
        }
        if started.elapsed() >= Duration::from_secs(1) && !second.is_empty() {
            if let Some((width, height)) = size {
                flush_second(&job, &mut second, &mut seq, width, height, spec.fps.max(1));
            }
            started = Instant::now();
        }
        let spent = began.elapsed();
        if spent < interval {
            sleep_until(&stop, interval - spent);
        }
    }
    if !second.is_empty() {
        if let Some((width, height)) = size {
            flush_second(&job, &mut second, &mut seq, width, height, spec.fps.max(1));
        }
    }
    if let Job::Record { parts, out } = job {
        let files = chunk_files(&parts).collect::<Vec<_>>();
        let muxed = mux_chunks(&files, &out);
        let _ = fs::remove_dir_all(&parts);
        muxed.map(|_| ())
    } else {
        Ok(())
    }
}

fn flush_second(job: &Job, frames: &mut Vec<Vec<u8>>, seq: &mut u64, width: u32, height: u32, fps: u32) {
    if frames.is_empty() || width == 0 || height == 0 {
        frames.clear();
        return;
    }
    let (dir, keep) = match job {
        Job::Record { parts, .. } => (parts.clone(), None),
        Job::Buffer { dir, keep } => (dir.clone(), Some(*keep)),
    };
    *seq += 1;
    let path = dir.join(format!("{:020}-{:06}.orb", unix_millis(), *seq));
    if let Err(error) = write_chunk(&path, width, height, fps, frames) {
        set_error(&error);
    }
    frames.clear();
    if let Some(keep) = keep {
        drop_old(&dir, keep);
    }
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

struct Chunk {
    width: u32,
    height: u32,
    fps: u32,
    frames: Vec<Vec<u8>>,
}

fn write_chunk(path: &Path, width: u32, height: u32, fps: u32, frames: &[Vec<u8>]) -> Result<(), String> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(CHUNK_MAGIC);
    push_u32(&mut bytes, width);
    push_u32(&mut bytes, height);
    push_u32(&mut bytes, fps.max(1));
    push_u32(&mut bytes, frames.len() as u32);
    for frame in frames {
        push_u32(&mut bytes, frame.len() as u32);
        bytes.extend_from_slice(frame);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn read_chunk(path: &Path) -> Result<Chunk, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() < 20 || &bytes[..4] != CHUNK_MAGIC {
        return Err("A replay piece could not be read.".to_string());
    }
    let width = read_u32(&bytes, 4);
    let height = read_u32(&bytes, 8);
    let fps = read_u32(&bytes, 12).max(1);
    let count = read_u32(&bytes, 16) as usize;
    let mut frames = Vec::with_capacity(count.min(240));
    let mut cursor = 20usize;
    for _ in 0..count {
        if cursor + 4 > bytes.len() {
            break;
        }
        let len = read_u32(&bytes, cursor) as usize;
        cursor += 4;
        if len > 12 * 1024 * 1024 || cursor + len > bytes.len() {
            return Err("A replay piece could not be read.".to_string());
        }
        frames.push(bytes[cursor..cursor + len].to_vec());
        cursor += len;
    }
    if frames.is_empty() {
        return Err("A replay piece was empty.".to_string());
    }
    Ok(Chunk { width, height, fps, frames })
}

fn chunk_files(dir: &Path) -> impl Iterator<Item = PathBuf> {
    let mut files = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("orb"))
        .collect::<Vec<_>>();
    files.sort();
    files.into_iter()
}

pub fn chunk_is_recent(path: &Path, now_ms: u64, seconds: u32) -> bool {
    let Some(name) = path.file_name().and_then(|item| item.to_str()) else { return false };
    let Some(stamp) = name.split('-').next().and_then(|item| item.parse::<u64>().ok()) else { return false };
    let window = seconds.max(1) as u64 * 1000 + 1500;
    stamp + window >= now_ms && stamp <= now_ms + 2000
}

fn drop_old(dir: &Path, keep: Duration) {
    let now = unix_millis();
    let keep_ms = keep.as_millis() as u64;
    for path in chunk_files(dir) {
        let Some(name) = path.file_name().and_then(|item| item.to_str()) else { continue };
        let Some(stamp) = name.split('-').next().and_then(|item| item.parse::<u64>().ok()) else { continue };
        if stamp + keep_ms < now {
            let _ = fs::remove_file(path);
        }
    }
}

pub struct Muxed {
    pub frames: usize,
    pub fps: u32,
}

pub fn mux_chunks(files: &[PathBuf], out: &Path) -> Result<Muxed, String> {
    let mut width = 0u32;
    let mut height = 0u32;
    let mut fps = 30u32;
    let mut count = 0u32;
    let mut max_frame = 0u32;
    let mut loaded = Vec::new();
    for file in files {
        let chunk = read_chunk(file)?;
        if loaded.is_empty() {
            width = chunk.width;
            height = chunk.height;
            fps = chunk.fps.max(1);
        }
        for frame in chunk.frames {
            max_frame = max_frame.max(frame.len() as u32);
            count += 1;
            loaded.push(frame);
        }
    }
    if loaded.is_empty() {
        return Err("The clip was empty.".to_string());
    }
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = File::create(out).map_err(|error| error.to_string())?;
    write_avi_to(&mut file, width, height, fps, count, max_frame, loaded.into_iter().map(Ok))?;
    Ok(Muxed { frames: count as usize, fps })
}

fn write_avi_to<W: Write + Seek>(
    out: &mut W,
    width: u32,
    height: u32,
    fps: u32,
    count: u32,
    max_frame: u32,
    frames: impl Iterator<Item = Result<Vec<u8>, String>>,
) -> Result<(), String> {
    let fps = fps.max(1);
    let mut header = Vec::new();
    header.extend_from_slice(b"RIFF");
    push_u32(&mut header, 0);
    header.extend_from_slice(b"AVI ");
    let hdrl_at = header.len();
    header.extend_from_slice(b"LIST");
    push_u32(&mut header, 0);
    header.extend_from_slice(b"hdrl");
    header.extend_from_slice(b"avih");
    push_u32(&mut header, 56);
    push_u32(&mut header, 1_000_000 / fps);
    push_u32(&mut header, max_frame.saturating_mul(fps));
    push_u32(&mut header, 0);
    push_u32(&mut header, 0x110);
    push_u32(&mut header, count);
    push_u32(&mut header, 0);
    push_u32(&mut header, 1);
    push_u32(&mut header, max_frame);
    push_u32(&mut header, width);
    push_u32(&mut header, height);
    header.extend_from_slice(&[0u8; 16]);
    let strl_at = header.len();
    header.extend_from_slice(b"LIST");
    push_u32(&mut header, 0);
    header.extend_from_slice(b"strl");
    header.extend_from_slice(b"strh");
    push_u32(&mut header, 56);
    header.extend_from_slice(b"vids");
    header.extend_from_slice(b"MJPG");
    push_u32(&mut header, 0);
    header.extend_from_slice(&0u16.to_le_bytes());
    header.extend_from_slice(&0u16.to_le_bytes());
    push_u32(&mut header, 0);
    push_u32(&mut header, 1);
    push_u32(&mut header, fps);
    push_u32(&mut header, 0);
    push_u32(&mut header, count);
    push_u32(&mut header, max_frame);
    push_u32(&mut header, u32::MAX);
    push_u32(&mut header, 0);
    header.extend_from_slice(&0i16.to_le_bytes());
    header.extend_from_slice(&0i16.to_le_bytes());
    header.extend_from_slice(&(width.min(i16::MAX as u32) as i16).to_le_bytes());
    header.extend_from_slice(&(height.min(i16::MAX as u32) as i16).to_le_bytes());
    header.extend_from_slice(b"strf");
    push_u32(&mut header, 40);
    push_u32(&mut header, 40);
    push_u32(&mut header, width);
    push_u32(&mut header, height);
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&24u16.to_le_bytes());
    header.extend_from_slice(b"MJPG");
    push_u32(&mut header, width.saturating_mul(height).saturating_mul(3));
    push_u32(&mut header, 0);
    push_u32(&mut header, 0);
    push_u32(&mut header, 0);
    push_u32(&mut header, 0);
    let strl_size = (header.len() - strl_at - 8) as u32;
    header[strl_at + 4..strl_at + 8].copy_from_slice(&strl_size.to_le_bytes());
    let hdrl_size = (header.len() - hdrl_at - 8) as u32;
    header[hdrl_at + 4..hdrl_at + 8].copy_from_slice(&hdrl_size.to_le_bytes());
    let movi_at = header.len();
    header.extend_from_slice(b"LIST");
    push_u32(&mut header, 0);
    header.extend_from_slice(b"movi");
    out.write_all(&header).map_err(|error| error.to_string())?;
    let mut index = Vec::new();
    let mut written = 0u32;
    for frame in frames {
        let frame = frame?;
        let pos = out.stream_position().map_err(|error| error.to_string())? as u32;
        let mut chunk = Vec::with_capacity(frame.len() + 8);
        chunk.extend_from_slice(b"00dc");
        push_u32(&mut chunk, frame.len() as u32);
        chunk.extend_from_slice(&frame);
        if frame.len() % 2 == 1 {
            chunk.push(0);
        }
        out.write_all(&chunk).map_err(|error| error.to_string())?;
        index.extend_from_slice(b"00dc");
        push_u32(&mut index, 0x10);
        push_u32(&mut index, pos - movi_at as u32);
        push_u32(&mut index, frame.len() as u32);
        written += 1;
    }
    if written == 0 {
        return Err("The clip was empty.".to_string());
    }
    let movi_end = out.stream_position().map_err(|error| error.to_string())?;
    let movi_size = (movi_end as u64 - movi_at as u64 - 8) as u32;
    out.seek(SeekFrom::Start(movi_at as u64 + 4)).map_err(|error| error.to_string())?;
    out.write_all(&movi_size.to_le_bytes()).map_err(|error| error.to_string())?;
    out.seek(SeekFrom::Start(movi_end)).map_err(|error| error.to_string())?;
    out.write_all(b"idx1").map_err(|error| error.to_string())?;
    out.write_all(&(index.len() as u32).to_le_bytes()).map_err(|error| error.to_string())?;
    out.write_all(&index).map_err(|error| error.to_string())?;
    let end = out.stream_position().map_err(|error| error.to_string())?;
    if end > u32::MAX as u64 {
        return Err("The recording is too long for one clip. Stop it sooner.".to_string());
    }
    out.seek(SeekFrom::Start(4)).map_err(|error| error.to_string())?;
    out.write_all(&((end as u32) - 8).to_le_bytes()).map_err(|error| error.to_string())?;
    Ok(())
}

fn push_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn read_u32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap_or([0, 0, 0, 0]))
}

fn unix_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

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
    fn a_clip_is_an_avi_whose_index_points_at_the_frames() {
        let jpeg = sample_jpeg();
        let mut cursor = Cursor::new(Vec::new());
        write_avi_to(&mut cursor, 16, 16, 30, 2, jpeg.len() as u32, [Ok(jpeg.clone()), Ok(jpeg)].into_iter()).unwrap();
        let bytes = cursor.into_inner();
        assert!(bytes.starts_with(b"RIFF"));
        assert_eq!(&bytes[8..12], b"AVI ");
        assert!(bytes.windows(4).any(|window| window == b"MJPG"));
        let idx = bytes.windows(4).position(|window| window == b"idx1").unwrap();
        let offset = u32::from_le_bytes(bytes[idx + 16..idx + 20].try_into().unwrap()) as usize;
        let movi = bytes.windows(4).position(|window| window == b"movi").unwrap();
        let list = movi - 8;
        assert_eq!(&bytes[list + offset..list + offset + 4], b"00dc");
    }

    #[test]
    fn only_the_recent_seconds_are_kept() {
        let now = 10_000_000u64;
        let old = PathBuf::from("0000000000000001000-000000.orb");
        let recent = PathBuf::from("0000000000000009000-000001.orb");
        assert!(!chunk_is_recent(&old, now, 3));
        assert!(chunk_is_recent(&recent, now, 3));
    }

    #[test]
    fn a_chunk_round_trips() {
        let dir = std::env::temp_dir().join(format!("orbit-chunk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let jpeg = sample_jpeg();
        let path = dir.join("0000000000000001000-000001.orb");
        write_chunk(&path, 16, 16, 30, &[jpeg.clone()]).unwrap();
        let read = read_chunk(&path).unwrap();
        assert_eq!(read.width, 16);
        assert_eq!(read.frames[0], jpeg);
        let _ = fs::remove_dir_all(&dir);
    }
}
