//! Screen capture that does not need ffmpeg.
//!
//! Windows copies the monitor with GDI. Linux does the same through the X11
//! root window. A recording is one H.264 `.mp4`. The rolling replay is kept in
//! a small temporary file instead of in memory, so a game session costs a few
//! kilobytes of RAM rather than a hundred megabytes, and the file is removed
//! as soon as the session ends.

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// The rolling replay lives in these two circular files. They grow only as far
/// as the kept frames reach, so a short session leaves a small file behind.
const VIDEO_SPOOL_BYTES: u64 = 256 * 1024 * 1024;
const AUDIO_SPOOL_BYTES: u64 = 32 * 1024 * 1024;
const AUDIO_SAMPLE_RATE: u32 = 48_000;
const AUDIO_CHANNELS: usize = 2;
const AUDIO_BYTES_PER_FRAME: usize = AUDIO_CHANNELS * 2;
#[cfg(windows)]
const MAX_PENDING_AUDIO_BYTES: usize = 16 * 1024 * 1024;
#[cfg(any(windows, test))]
const MAX_PENDING_VIDEO_SAMPLES: u64 = 2;

#[cfg(any(windows, test))]
fn pending_video_samples(received: u64, processed: u64) -> u64 {
    received.saturating_sub(processed)
}

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

/// One circular file. Records are written end to end and the file is never
/// allowed to write over a record that is still part of the replay, so a saved
/// clip can be read back while the capture thread keeps working.
struct Spool {
    path: PathBuf,
    capacity: u64,
    state: Mutex<SpoolState>,
}

struct SpoolState {
    file: Option<File>,
    /// Bytes written since the file was made, padding included. The file
    /// offset is `written % capacity`. Counting from the start of the file,
    /// rather than keeping only an offset, is what lets the ring tell which
    /// records a wrap is about to land on.
    written: u64,
}

impl Spool {
    fn create(dir: &Path, name: &str, capacity: u64) -> Result<Arc<Self>, String> {
        fs::create_dir_all(dir).map_err(|error| format!("The replay buffer could not be prepared: {error}"))?;
        let path = dir.join(name);
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|error| format!("The replay buffer could not be prepared: {error}"))?;
        Ok(Arc::new(Self {
            path,
            capacity: capacity.max(1),
            state: Mutex::new(SpoolState { file: Some(file), written: 0 }),
        }))
    }

    fn capacity(&self) -> u64 {
        self.capacity
    }

    /// Where a record of `len` bytes would start. A record never crosses the
    /// end of the file: one that will not fit in the tail starts on the next
    /// lap, so every record reads back as one contiguous run.
    fn position(&self, len: u64) -> u64 {
        let written = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .written;
        Self::place(written, self.capacity, len)
    }

    fn place(written: u64, capacity: u64, len: u64) -> u64 {
        let offset = written % capacity;
        if offset.saturating_add(len) > capacity {
            written.saturating_add(capacity - offset)
        } else {
            written
        }
    }

    /// Write one record and report where it landed. The caller has already
    /// dropped the records this write would land on.
    fn append(&self, bytes: &[u8]) -> Result<(u64, u32), String> {
        let len = bytes.len() as u64;
        if len == 0 || len > self.capacity {
            return Err("A replay record was too large for the replay buffer.".to_string());
        }
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let at = Self::place(state.written, self.capacity, len);
        let offset = at % self.capacity;
        let Some(file) = state.file.as_mut() else {
            return Err("The replay buffer is no longer available.".to_string());
        };
        file.seek(SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        state.written = at.saturating_add(len);
        Ok((at, len as u32))
    }

    fn read(&self, at: u64, len: u32) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0u8; len as usize];
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(file) = state.file.as_mut() else {
            return Err("The replay buffer is no longer available.".to_string());
        };
        file.seek(SeekFrom::Start(at % self.capacity)).map_err(|error| error.to_string())?;
        file.read_exact(&mut bytes).map_err(|error| error.to_string())?;
        Ok(bytes)
    }
}

impl Drop for Spool {
    fn drop(&mut self) {
        // Close the handle before asking Windows to unlink the file.
        if let Ok(state) = self.state.get_mut() {
            let _ = state.file.take();
        }
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Clone, Copy)]
struct FrameRef {
    at: u64,
    len: u32,
}

#[derive(Clone, Copy)]
struct AudioRef {
    at: u64,
    len: u32,
    first_frame: usize,
    frames: usize,
}

/// What the ring has to know about a stored record to keep the file honest.
trait Record {
    fn at(&self) -> u64;
    fn frames(&self) -> usize;
}

impl Record for FrameRef {
    fn at(&self) -> u64 {
        self.at
    }
    fn frames(&self) -> usize {
        1
    }
}

impl Record for AudioRef {
    fn at(&self) -> u64 {
        self.at
    }
    fn frames(&self) -> usize {
        self.frames
    }
}

/// Drop every record the next write would land on.
///
/// A circular file reuses the bytes one lap behind the write point. Checking
/// only that the live records fit in the file is not enough: with records of
/// different sizes the write head can land partway into an older record while
/// the totals still fit, which silently corrupts the frames a saved clip is
/// about to read. So the write position is compared with the records
/// themselves.
fn make_room<T: Record>(queue: &mut VecDeque<T>, capacity: u64, at: u64, len: u64) -> usize {
    if at < capacity {
        // Still on the first lap: the write lands in space nothing is using.
        return 0;
    }
    let low = at - capacity;
    // The window ends before `at` because no record is larger than the file.
    let high = low.saturating_add(len);
    let mut frames = 0;
    loop {
        let safe = queue.front().map(|front| front.at() >= high).unwrap_or(true);
        if safe {
            break;
        }
        let Some(old) = queue.pop_front() else { break };
        frames = frames.saturating_add(old.frames());
    }
    frames
}

struct Ring {
    width: u32,
    height: u32,
    fps: u32,
    max_frames: usize,
    frames: VecDeque<FrameRef>,
    audio: VecDeque<AudioRef>,
    audio_frames: usize,
    dir: PathBuf,
    video: Option<Arc<Spool>>,
    sound: Option<Arc<Spool>>,
}

/// The last few seconds, kept in a temporary file. Only the record index stays
/// in memory, so the cost of a running replay does not grow with the preview.
#[derive(Clone)]
pub struct Buffer {
    inner: Arc<Mutex<Ring>>,
}

static SPOOL_SERIAL: AtomicU64 = AtomicU64::new(0);

fn new_spool(dir: &Path, kind: &str, capacity: u64) -> Result<Arc<Spool>, String> {
    let serial = SPOOL_SERIAL.fetch_add(1, Ordering::Relaxed);
    let name = format!("live-{}-{serial}-{kind}.spool", std::process::id());
    Spool::create(dir, &name, capacity)
}

impl Buffer {
    pub fn new(dir: &Path, fps: u32, keep: Duration) -> Result<Self, String> {
        Self::with_files(dir, fps, keep, VIDEO_SPOOL_BYTES, AUDIO_SPOOL_BYTES)
    }

    fn with_files(dir: &Path, fps: u32, keep: Duration, video_bytes: u64, audio_bytes: u64) -> Result<Self, String> {
        let fps = fps.max(1);
        let seconds = keep.as_secs().max(1) as usize;
        let dir = dir.to_path_buf();
        let video = new_spool(&dir, "video", video_bytes)?;
        let sound = Some(new_spool(&dir, "audio", audio_bytes)?);
        Ok(Self {
            inner: Arc::new(Mutex::new(Ring {
                width: 0,
                height: 0,
                fps,
                max_frames: seconds.saturating_mul(fps as usize).max(fps as usize),
                frames: VecDeque::new(),
                audio: VecDeque::new(),
                audio_frames: 0,
                dir,
                video: Some(video),
                sound,
            })),
        })
    }

    pub fn push_jpeg(&self, jpeg: &[u8], width: u32, height: u32) {
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
        let len = jpeg.len() as u64;
        let Some(video) = ring.video.clone() else { return };
        if len > video.capacity() {
            return;
        }
        // Keep the requested length: the oldest frame goes once the window is
        // full. Room is made before the write, never after it.
        while ring.frames.len() >= ring.max_frames {
            if ring.frames.pop_front().is_none() {
                break;
            }
        }
        let at = video.position(len);
        make_room(&mut ring.frames, video.capacity(), at, len);
        match video.append(jpeg) {
            Ok((at, len)) => {
                ring.frames.push_back(FrameRef { at, len });
            }
            Err(error) => set_error(&error),
        }
    }

    /// Add interleaved 48 kHz stereo signed-16 PCM to the rolling replay.
    pub fn push_audio_pcm(&self, bytes: Vec<u8>) {
        let usable = bytes.len() / AUDIO_BYTES_PER_FRAME * AUDIO_BYTES_PER_FRAME;
        if usable == 0 {
            return;
        }
        let bytes = &bytes[..usable];
        let frames = usable / AUDIO_BYTES_PER_FRAME;
        let mut ring = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        trim_audio(&mut *ring, usable as u64);
        let Some(sound) = ring.sound.clone() else { return };
        match sound.append(bytes) {
            Ok((at, len)) => {
                ring.audio_frames = ring.audio_frames.saturating_add(frames);
                ring.audio.push_back(AudioRef { at, len, first_frame: 0, frames });
            }
            Err(error) => set_error(&error),
        }
    }

    pub fn snapshot(&self, seconds: u32) -> Result<Kept, String> {
        let mut ring = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if ring.frames.is_empty() || ring.width == 0 {
            let error = last_error();
            if !error.is_empty() {
                return Err(error);
            }
            return Err("Nothing has been kept yet. The replay starts when a game is playing.".to_string());
        }
        let fps = ring.fps.max(1);
        let keep = (seconds.max(1) as usize).saturating_mul(fps as usize).max(1);
        let audio_video_frames = ring.audio_frames.saturating_mul(fps as usize) / AUDIO_SAMPLE_RATE as usize;
        let keep = if ring.audio_frames > 0 { keep.min(audio_video_frames.max(1)) } else { keep };
        let start = ring.frames.len().saturating_sub(keep);
        let frames: Vec<FrameRef> = ring.frames.iter().skip(start).copied().collect();
        let audio_wanted = frames.len().saturating_mul(AUDIO_SAMPLE_RATE as usize) / fps as usize;
        let mut audio_left = audio_wanted.min(ring.audio_frames);
        let mut audio = Vec::new();
        for chunk in ring.audio.iter().rev() {
            if audio_left == 0 {
                break;
            }
            let take = audio_left.min(chunk.frames);
            audio.push(AudioRef {
                at: chunk.at,
                len: chunk.len,
                first_frame: chunk.first_frame + chunk.frames - take,
                frames: take,
            });
            audio_left -= take;
        }
        audio.reverse();
        let covered = audio_wanted.min(ring.audio_frames) - audio_left;
        let (width, height) = (ring.width, ring.height);
        let video = ring.video.clone();
        let sound = ring.sound.clone();
        // The clip gets the files that are already written, and the capture
        // thread starts a fresh pair. Encoding then cannot read a record that
        // the next minute of play has already needed to reuse.
        ring.renew()?;
        drop(ring);
        Ok(Kept {
            width,
            height,
            fps,
            video,
            frames,
            sound,
            audio,
            audio_frames: covered,
        })
    }
}

impl Ring {
    /// Replace both files with empty ones, keeping the frame size.
    fn renew(&mut self) -> Result<(), String> {
        let video = new_spool(&self.dir, "video", VIDEO_SPOOL_BYTES)?;
        let sound = new_spool(&self.dir, "audio", AUDIO_SPOOL_BYTES)?;
        self.video = Some(video);
        self.sound = Some(sound);
        self.frames.clear();
        self.audio_frames = 0;
        self.audio.clear();
        Ok(())
    }
}

fn trim_audio(ring: &mut Ring, incoming: u64) {
    let audio_limit = ring.max_frames.saturating_mul(AUDIO_SAMPLE_RATE as usize) / ring.fps.max(1) as usize;
    // Keep the audio inside the same window as the pictures.
    while ring.audio_frames > audio_limit {
        let Some(front) = ring.audio.front_mut() else { break };
        let remove = ring.audio_frames.saturating_sub(audio_limit).min(front.frames);
        if remove == 0 {
            break;
        }
        front.first_frame += remove;
        front.frames -= remove;
        ring.audio_frames -= remove;
        if front.frames == 0 {
            ring.audio.pop_front();
        }
    }
    // Then make sure the incoming record does not land on one still in use.
    let Some(sound) = ring.sound.clone() else { return };
    let at = sound.position(incoming);
    let frames = make_room(&mut ring.audio, sound.capacity(), at, incoming);
    ring.audio_frames = ring.audio_frames.saturating_sub(frames);
}

pub struct Kept {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    video: Option<Arc<Spool>>,
    frames: Vec<FrameRef>,
    sound: Option<Arc<Spool>>,
    audio: Vec<AudioRef>,
    audio_frames: usize,
}

impl Kept {
    #[cfg(test)]
    fn empty() -> Self {
        Self {
            width: 0,
            height: 0,
            fps: 30,
            video: None,
            frames: Vec::new(),
            sound: None,
            audio: Vec::new(),
            audio_frames: 0,
        }
    }

    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// Read one compressed frame back from the clip's file.
    pub fn frame(&self, index: usize) -> Result<Vec<u8>, String> {
        let spool = self.video.as_ref().ok_or_else(|| "The clip was empty.".to_string())?;
        let frame = self.frames.get(index).ok_or_else(|| "A replay frame was missing.".to_string())?;
        spool.read(frame.at, frame.len)
    }

    pub fn audio_chunk_count(&self) -> usize {
        self.audio.len()
    }

    /// Read one audio chunk and trim it to the part the clip keeps.
    pub fn audio_chunk(&self, index: usize) -> Result<(Vec<u8>, usize), String> {
        let spool = self.sound.as_ref().ok_or_else(|| "The clip had no audio.".to_string())?;
        let chunk = self.audio.get(index).ok_or_else(|| "The buffered audio was incomplete.".to_string())?;
        let bytes = spool.read(chunk.at, chunk.len)?;
        let start = chunk.first_frame.saturating_mul(AUDIO_BYTES_PER_FRAME);
        let end = start.saturating_add(chunk.frames.saturating_mul(AUDIO_BYTES_PER_FRAME));
        let slice = bytes
            .get(start..end)
            .ok_or_else(|| "The buffered audio was incomplete.".to_string())?;
        Ok((slice.to_vec(), chunk.frames))
    }

    pub fn has_audio(&self) -> bool {
        self.audio_frames > 0
    }
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

    pub fn buffer(&self) -> Option<Buffer> {
        self.buffer.clone()
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

pub fn start_buffer(keep: Duration, spec: Spec, dir: PathBuf) -> Result<Hold, String> {
    let _ = grab(spec)?;
    set_error("");
    let buffer = Buffer::new(&dir, spec.fps, keep)?;
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
    if kept.frame_count() == 0 || kept.width < 2 || kept.height < 2 {
        return Err("The clip was empty.".to_string());
    }
    if !kept.has_audio() {
        return Err("No system audio was captured, so Orbit did not save a silent replay.".to_string());
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

/// Write the buffered PCM as a temporary WAV input for ffmpeg-based encoders.
pub fn write_audio_wav(path: &Path, kept: &Kept) -> Result<(), String> {
    if !kept.has_audio() {
        return Err("No system audio was captured.".to_string());
    }
    let data_bytes = kept.audio_frames.checked_mul(AUDIO_BYTES_PER_FRAME)
        .and_then(|size| u32::try_from(size).ok())
        .ok_or_else(|| "The audio clip was too large to save.".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = fs::File::create(path).map_err(|error| error.to_string())?;
    file.write_all(b"RIFF").map_err(|error| error.to_string())?;
    file.write_all(&(36u32.saturating_add(data_bytes)).to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(b"WAVEfmt ").map_err(|error| error.to_string())?;
    file.write_all(&16u32.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&1u16.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&(AUDIO_CHANNELS as u16).to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&AUDIO_SAMPLE_RATE.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&(AUDIO_SAMPLE_RATE * AUDIO_BYTES_PER_FRAME as u32).to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&(AUDIO_BYTES_PER_FRAME as u16).to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(&16u16.to_le_bytes()).map_err(|error| error.to_string())?;
    file.write_all(b"data").map_err(|error| error.to_string())?;
    file.write_all(&data_bytes.to_le_bytes()).map_err(|error| error.to_string())?;
    for index in 0..kept.audio_chunk_count() {
        let (bytes, _frames) = kept.audio_chunk(index)?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Remove replay files nothing owns any more. A crash, a killed process, or a
/// quit in the middle of a save can leave one behind, and a 256 MB file has no
/// business outliving the session that wrote it.
pub fn clear_replay_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|item| item.to_str()) == Some("spool") {
            let _ = fs::remove_file(path);
        }
    }
    let _ = fs::remove_dir(dir);
}

/// Remove old per-second replay pieces from version 1.1, and a spool file that
/// a crash left behind. Neither is a saved clip.
pub fn sweep_replay_files(root: &Path) {
    let replay = root.join("replay");
    if let Ok(entries) = fs::read_dir(&replay) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|item| item.to_str()).unwrap_or("");
            if ext == "orb" || ext == "mkv" || ext == "txt" || ext == "spool" {
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
    #[cfg(windows)]
    let recording_epoch = Instant::now();
    let mut written = 0u32;
    match writer.push_bgra(&first.bytes) {
        Ok(true) => written += 1,
        Ok(false) => {}
        Err(error) => set_error(&error),
    }
    #[cfg(windows)]
    let mut timeline_frames = 1u64;
    #[cfg(windows)]
    let mut audio = match SystemAudio::open() {
        Ok(audio) => audio,
        Err(error) => {
            let _ = writer.finish();
            let _ = fs::remove_file(&out);
            signal_ready(&ready, &error);
            return Err(error);
        }
    };
    #[cfg(windows)]
    let audio_offset = recording_epoch.elapsed();
    #[cfg(windows)]
    writer.set_audio_offset(audio_offset);
    #[cfg(windows)]
    let audio_offset_ticks = (audio_offset.as_nanos() / 100).min(i64::MAX as u128) as i64;
    signal_ready(&ready, "");
    #[cfg(windows)]
    let mut audio_active = true;
    #[cfg(windows)]
    let mut audio_write_failed = false;
    #[cfg(windows)]
    let mut audio_written = 0usize;
    #[cfg(windows)]
    let mut pending_audio = VecDeque::new();
    #[cfg(windows)]
    let mut pending_audio_bytes = 0usize;
    let mut last = first.bytes;
    let mut scratch = Vec::new();
    let interval = frame_interval(spec.fps);
    #[cfg(windows)]
    let video_duration_ticks = 10_000_000i64 / spec.fps.max(1) as i64;
    #[cfg(windows)]
    let mut next_frame = recording_epoch + interval;
    #[cfg(not(windows))]
    let mut next_frame = Instant::now() + interval;
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        #[cfg(windows)]
        if audio_active {
            if let Err(error) = audio.drain(|pcm, frames| {
                queue_pending_audio(&mut pending_audio, &mut pending_audio_bytes, pcm, frames, MAX_PENDING_AUDIO_BYTES)
            }) {
                set_error(&error);
                audio_active = false;
                audio_write_failed = true;
                pending_audio.clear();
            }
        }
        let captured = if PAUSED.load(Ordering::SeqCst) {
            None
        } else {
            Some(grab_with_buffer(spec, std::mem::take(&mut scratch)))
        };
        #[cfg(windows)]
        if audio_active {
            if let Err(error) = audio.drain(|pcm, frames| {
                queue_pending_audio(&mut pending_audio, &mut pending_audio_bytes, pcm, frames, MAX_PENDING_AUDIO_BYTES)
            }) {
                set_error(&error);
                audio_active = false;
                audio_write_failed = true;
                pending_audio.clear();
            }
        }
        let now = Instant::now();

        // The capture call can take longer than a frame interval, especially at
        // 4K. Fill elapsed slots with the previous picture so playback follows
        // real time; if the encoder queue is full, drop a frame but keep its
        // presentation slot so audio and duration stay synchronized.
        while next_frame <= now && !stop.load(Ordering::SeqCst) {
            #[cfg(windows)]
            if !audio_write_failed {
                let next_video_ticks = timeline_frames
                    .saturating_mul(video_duration_ticks as u64)
                    .min(i64::MAX as u64) as i64;
                if let Err(error) = flush_audio_samples(
                    &mut writer,
                    &mut pending_audio,
                    &mut pending_audio_bytes,
                    &mut audio_written,
                    audio_offset_ticks,
                    next_video_ticks,
                ) {
                    set_error(&error);
                    audio_active = false;
                    audio_write_failed = true;
                    pending_audio.clear();
                }
            }
            match writer.push_bgra(&last) {
                Ok(true) => written += 1,
                Ok(false) => {}
                Err(error) => set_error(&error),
            }
            #[cfg(windows)]
            {
                timeline_frames = timeline_frames.saturating_add(1);
            }
            next_frame += interval;
        }

        if let Some(result) = captured {
            match result {
                Ok(mut frame) if size == Some((frame.width, frame.height)) => {
                    // Keep two reusable pixel buffers instead of allocating a
                    // full-resolution BGRA frame on every capture tick.
                    std::mem::swap(&mut last, &mut frame.bytes);
                    scratch = frame.bytes;
                    #[cfg(windows)]
                    if audio_active {
                        set_error("");
                    }
                    #[cfg(not(windows))]
                    set_error("");
                }
                Ok(frame) => {
                    scratch = frame.bytes;
                    set_error("The picture size changed, so this frame was skipped.");
                }
                Err(error) => set_error(&error),
            }
        }
        sleep_until(&stop, next_frame);
    }
    #[cfg(windows)]
    if audio_active {
        if let Err(error) = audio.drain(|pcm, frames| {
            queue_pending_audio(&mut pending_audio, &mut pending_audio_bytes, pcm, frames, MAX_PENDING_AUDIO_BYTES)
        }) {
            set_error(&error);
            audio_write_failed = true;
            pending_audio.clear();
        }
    }
    #[cfg(windows)]
    if !audio_write_failed {
        let video_end_ticks = timeline_frames
            .saturating_mul(video_duration_ticks as u64)
            .min(i64::MAX as u64) as i64;
        if let Err(error) = flush_audio_samples(
            &mut writer,
            &mut pending_audio,
            &mut pending_audio_bytes,
            &mut audio_written,
            audio_offset_ticks,
            video_end_ticks,
        ) {
            set_error(&error);
            audio_write_failed = true;
        }
    }
    #[cfg(windows)]
    {
        pending_audio.clear();
    }
    let finished = writer.finish();
    #[cfg(windows)]
    if audio_write_failed {
        let _ = fs::remove_file(&out);
        let message = last_error();
        return Err(if message.is_empty() {
            "System audio could not be kept with the recording, so the recording was not saved.".to_string()
        } else {
            message
        });
    }
    #[cfg(windows)]
    if audio_written == 0 {
        let _ = fs::remove_file(&out);
        return Err("System audio could not be captured, so the recording was not saved.".to_string());
    }
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

#[cfg(any(windows, test))]
fn queue_pending_audio(
    pending: &mut VecDeque<(Vec<u8>, usize)>,
    pending_bytes: &mut usize,
    pcm: Vec<u8>,
    frames: usize,
    max_bytes: usize,
) -> Result<(), String> {
    let next_bytes = pending_bytes.saturating_add(pcm.len());
    if next_bytes > max_bytes {
        return Err("System audio could not keep up with the recording, so the recording was not saved.".to_string());
    }
    *pending_bytes = next_bytes;
    pending.push_back((pcm, frames));
    Ok(())
}

#[cfg(windows)]
fn flush_audio_samples(
    writer: &mut Writer,
    pending: &mut VecDeque<(Vec<u8>, usize)>,
    pending_bytes: &mut usize,
    audio_written: &mut usize,
    audio_offset_ticks: i64,
    video_end_ticks: i64,
) -> Result<(), String> {
    while !pending.is_empty() {
        let audio_time = audio_offset_ticks.saturating_add(
            (*audio_written as i64).saturating_mul(10_000_000) / AUDIO_SAMPLE_RATE as i64,
        );
        if audio_time >= video_end_ticks {
            break;
        }
        let (pcm, frames) = pending.pop_front().expect("the queue is not empty");
        *pending_bytes = pending_bytes.saturating_sub(pcm.len());
        writer.push_audio(&pcm, frames)?;
        *audio_written = (*audio_written).saturating_add(frames);
    }
    Ok(())
}

fn run_buffer(buffer: Buffer, spec: Spec, stop: Arc<AtomicBool>) -> Result<(), String> {
    #[cfg(windows)]
    let mut audio = match SystemAudio::open() {
        Ok(audio) => audio,
        Err(error) => {
            set_error(&error);
            return Err(error);
        }
    };
    #[cfg(windows)]
    let mut audio_active = true;
    let interval = frame_interval(spec.fps);
    let mut size = None;
    let mut last: Option<(Vec<u8>, u32, u32)> = None;
    let mut scratch = Vec::new();
    let mut next_frame = Instant::now();
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        #[cfg(windows)]
        if audio_active {
            if let Err(error) = audio.drain(|pcm, _frames| {
                buffer.push_audio_pcm(pcm);
                Ok(())
            }) {
                set_error(&error);
                audio_active = false;
            }
        }
        let captured = if PAUSED.load(Ordering::SeqCst) { None } else { Some(grab_jpeg(spec, &mut size, &mut scratch)) };
        #[cfg(windows)]
        if audio_active {
            if let Err(error) = audio.drain(|pcm, _frames| {
                buffer.push_audio_pcm(pcm);
                Ok(())
            }) {
                set_error(&error);
                audio_active = false;
            }
        }
        let now = Instant::now();

        if let Some((jpeg, width, height)) = last.as_ref() {
            while next_frame <= now && !stop.load(Ordering::SeqCst) {
                buffer.push_jpeg(jpeg, *width, *height);
                next_frame += interval;
            }
        }

        if let Some(result) = captured {
            match result {
                Ok(jpeg) => {
                    let (width, height) = size.unwrap_or((0, 0));
                    if last.is_none() {
                        buffer.push_jpeg(&jpeg, width, height);
                        next_frame = now + interval;
                    }
                    last = Some((jpeg, width, height));
                    #[cfg(windows)]
                    if audio_active {
                        set_error("");
                    }
                    #[cfg(not(windows))]
                    set_error("");
                }
                Err(error) => set_error(&error),
            }
        }
        if last.is_none() && next_frame <= now {
            // Don't spin if capture fails or the overlay is visible before the
            // first frame arrives.
            next_frame = now + interval;
        }
        sleep_until(&stop, next_frame);
    }
    #[cfg(windows)]
    if audio_active {
        if let Err(error) = audio.drain(|pcm, _frames| {
            buffer.push_audio_pcm(pcm);
            Ok(())
        }) {
            set_error(&error);
        }
    }
    Ok(())
}

fn frame_interval(fps: u32) -> Duration {
    Duration::from_nanos(1_000_000_000 / fps.max(1) as u64)
}

fn sleep_until(stop: &AtomicBool, deadline: Instant) {
    while Instant::now() < deadline {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        thread::sleep(Duration::from_millis(1));
    }
}

fn grab_jpeg(spec: Spec, size: &mut Option<(u32, u32)>, scratch: &mut Vec<u8>) -> Result<Vec<u8>, String> {
    let frame = grab_with_buffer(spec, std::mem::take(scratch))?;
    let (width, height) = *size.get_or_insert((frame.width, frame.height));
    let encoded = if frame.width == width && frame.height == height {
        encode_jpeg(&frame.bytes, width, height, spec.jpeg_quality)
    } else {
        let scaled = scale_bgra(&frame.bytes, frame.width, frame.height, width, height);
        encode_jpeg(&scaled, width, height, spec.jpeg_quality)
    };
    *scratch = frame.bytes;
    encoded
}

fn grab(spec: Spec) -> Result<Frame, String> {
    grab_with_buffer(spec, Vec::new())
}

fn grab_with_buffer(spec: Spec, buffer: Vec<u8>) -> Result<Frame, String> {
    grab_screen(spec, buffer)
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
fn grab_screen(spec: Spec, mut pixels: Vec<u8>) -> Result<Frame, String> {
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
        pixels.resize(width as usize * height as usize * 4, 0);
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
fn grab_screen(spec: Spec, mut bytes: Vec<u8>) -> Result<Frame, String> {
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
    let (out_w, out_h) = fit(width as u32, height as u32, spec.max_width, spec.max_height);
    bytes.resize(out_w as usize * out_h as usize * 4, 0);
    let mut y = 0u16;
    let mut dst_y = 0u32;
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
        let tile_end = y + tile;
        while dst_y < out_h {
            let src_y = (dst_y as u64 * height as u64 / out_h as u64) as usize;
            if src_y >= tile_end as usize {
                break;
            }
            if src_y < y as usize {
                return Err("This desktop returned picture rows out of order.".to_string());
            }
            let src_row = (src_y - y as usize) * row_bytes;
            let dst_row = dst_y as usize * out_w as usize * 4;
            for dst_x in 0..out_w {
                let src_x = (dst_x as u64 * width as u64 / out_w as u64) as usize;
                let source = src_row + src_x * 4;
                let target = dst_row + dst_x as usize * 4;
                bytes[target..target + 4].copy_from_slice(&reply.data[source..source + 4]);
            }
            dst_y += 1;
        }
        y += tile;
    }
    if dst_y != out_h {
        return Err("The picture could not be scaled to Orbit's capture size.".to_string());
    }
    Ok(Frame { width: out_w, height: out_h, bytes })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn grab_screen(_spec: Spec, _buffer: Vec<u8>) -> Result<Frame, String> {
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
    /// Return `false` when the encoder is already holding two video samples.
    /// Advance the output timeline without adding another full-size sample.
    fn push_bgra(&mut self, bgra: &[u8]) -> Result<bool, String> {
        #[cfg(windows)]
        {
            match self {
                Writer::Windows(writer) if writer.video_queue_full() => {
                    writer.skip_video_frame();
                    Ok(false)
                }
                Writer::Windows(writer) => writer.push_bgra(bgra).map(|()| true),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (self, bgra);
            Err("This desktop records with ffmpeg.".to_string())
        }
    }

    #[cfg(windows)]
    fn push_audio(&mut self, pcm: &[u8], frames: usize) -> Result<(), String> {
        match self {
            Writer::Windows(writer) => writer.push_audio(pcm, frames),
        }
    }

    #[cfg(windows)]
    fn set_audio_offset(&mut self, offset: Duration) {
        match self {
            Writer::Windows(writer) => writer.set_audio_offset(offset),
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

/// Block until the sink writer holds fewer than `MAX_PENDING_VIDEO_SAMPLES`
/// full-size pictures. This is the replay's memory ceiling: two 1080p samples
/// instead of one for every frame in the clip.
#[cfg(windows)]
fn wait_for_video_room(writer: &WindowsWriter) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while writer.video_queue_full() {
        if Instant::now() > deadline {
            return Err("The video encoder fell behind while the replay was being saved.".to_string());
        }
        thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

#[cfg(windows)]
fn write_mp4_windows(path: &Path, kept: &Kept) -> Result<(), String> {
    if !kept.has_audio() {
        return Err("No system audio was captured, so Orbit did not save a silent replay.".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut writer = WindowsWriter::open(path, kept.width, kept.height, kept.fps.max(1))?;
    let mut written = 0u32;
    let mut video_index = 0usize;
    let mut audio_index = 0usize;
    let mut audio_sample_index = 0usize;
    let fps = kept.fps.max(1) as u128;
    let audio_count = kept.audio_chunk_count();
    // One decoded picture, reused for every frame. The old loop allocated a
    // fresh full-resolution buffer per frame, which is what pushed the process
    // past half a gigabyte while a replay was being encoded.
    let mut bgra = Vec::new();
    while video_index < kept.frame_count() || audio_index < audio_count {
        let video_time = if video_index < kept.frame_count() {
            video_index as u128 * 10_000_000 / fps
        } else {
            u128::MAX
        };
        let audio_time = if audio_index < audio_count {
            audio_sample_index as u128 * 10_000_000 / AUDIO_SAMPLE_RATE as u128
        } else {
            u128::MAX
        };
        if video_time <= audio_time {
            let jpeg = match kept.frame(video_index) {
                Ok(jpeg) => jpeg,
                Err(error) => {
                    writer.abandon();
                    let _ = fs::remove_file(path);
                    return Err(error);
                }
            };
            let (width, height) = match decode_jpeg_into(&jpeg, &mut bgra) {
                Ok(size) => size,
                Err(error) => {
                    writer.abandon();
                    let _ = fs::remove_file(path);
                    return Err(error);
                }
            };
            if width != kept.width || height != kept.height || bgra.len() < kept.width as usize * kept.height as usize * 4 {
                writer.abandon();
                let _ = fs::remove_file(path);
                return Err("A replay frame was the wrong size.".to_string());
            }
            // Wait for the sink writer to drain before handing it another
            // full-size sample. Without this the encoder queue grows with the
            // clip and the save balloons in memory.
            if let Err(error) = wait_for_video_room(&writer) {
                writer.abandon();
                let _ = fs::remove_file(path);
                return Err(error);
            }
            if let Err(error) = writer.push_bgra(&bgra) {
                writer.abandon();
                let _ = fs::remove_file(path);
                return Err(error);
            }
            written += 1;
            video_index += 1;
        } else {
            let (pcm, frames) = match kept.audio_chunk(audio_index) {
                Ok(chunk) => chunk,
                Err(error) => {
                    writer.abandon();
                    let _ = fs::remove_file(path);
                    return Err(error);
                }
            };
            if let Err(error) = writer.push_audio(&pcm, frames) {
                writer.abandon();
                let _ = fs::remove_file(path);
                return Err(error);
            }
            audio_sample_index += frames;
            audio_index += 1;
        }
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
struct SystemAudio {
    client: Option<windows::Win32::Media::Audio::IAudioClient>,
    capture: Option<windows::Win32::Media::Audio::IAudioCaptureClient>,
    sample_rate: u32,
    channels: usize,
    bits: u16,
    block_align: usize,
    is_float: bool,
    phase: f64,
    previous: Option<[f32; 2]>,
}

#[cfg(windows)]
impl SystemAudio {
    fn open() -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| format!("System audio capture could not start: {error}"))?;
        match unsafe { Self::open_initialized() } {
            Ok(audio) => Ok(audio),
            Err(error) => {
                unsafe { CoUninitialize() };
                Err(error)
            }
        }
    }

    unsafe fn open_initialized() -> Result<Self, String> {
        use windows::Win32::Media::Audio::{
            eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
            AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};

        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(audio_error)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(audio_error)?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(audio_error)?;
        let format_ptr = client.GetMixFormat().map_err(audio_error)?;
        if format_ptr.is_null() {
            return Err("The system audio format could not be read.".to_string());
        }
        let parsed = (|| {
            let format = unsafe { std::ptr::read_unaligned(format_ptr) };
            let extensible = format.wFormatTag == 0xFFFE && format.cbSize >= 22;
            let subtype = if extensible {
                let offset = std::mem::size_of::<windows::Win32::Media::Audio::WAVEFORMATEX>() + 6;
                let subtype_ptr = unsafe { (format_ptr as *const u8).add(offset) as *const windows::core::GUID };
                Some(unsafe { std::ptr::read_unaligned(subtype_ptr) })
            } else {
                None
            };
            let is_float = format.wFormatTag == 3 || subtype.map(|guid| audio_subtype(guid, 3)).unwrap_or(false);
            let is_pcm = format.wFormatTag == 1 || subtype.map(|guid| audio_subtype(guid, 1)).unwrap_or(false);
            let channels = format.nChannels as usize;
            let bits = format.wBitsPerSample;
            let block_align = format.nBlockAlign as usize;
            let sample_rate = format.nSamplesPerSec;
            let bytes_per_sample = (bits as usize + 7) / 8;
            if (!is_float && !is_pcm)
                || (is_float && bits != 32)
                || !matches!(bits, 8 | 16 | 24 | 32)
                || sample_rate == 0
                || channels == 0
                || block_align < channels.saturating_mul(bytes_per_sample)
            {
                return Err("The system audio format is not supported by Orbit.".to_string());
            }
            Ok((sample_rate, channels, bits, block_align, is_float))
        })();
        let (sample_rate, channels, bits, block_align, is_float) = match parsed {
            Ok(format) => format,
            Err(error) => {
                CoTaskMemFree(Some(format_ptr as *const _));
                return Err(error);
            }
        };
        let initialized = client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            10_000_000,
            0,
            format_ptr,
            None,
        );
        CoTaskMemFree(Some(format_ptr as *const _));
        initialized.map_err(audio_error)?;
        let capture: IAudioCaptureClient = client.GetService().map_err(audio_error)?;
        client.Start().map_err(audio_error)?;
        Ok(Self {
            client: Some(client),
            capture: Some(capture),
            sample_rate,
            channels,
            bits,
            block_align,
            is_float,
            phase: 0.0,
            previous: None,
        })
    }

    fn drain(&mut self, mut emit: impl FnMut(Vec<u8>, usize) -> Result<(), String>) -> Result<(), String> {
        loop {
            let frames = unsafe {
                self.capture
                    .as_ref()
                    .ok_or_else(|| "System audio capture is no longer available.".to_string())?
                    .GetNextPacketSize()
            }
            .map_err(audio_error)?;
            if frames == 0 {
                break;
            }
            let mut data = std::ptr::null_mut();
            let mut available = 0u32;
            let mut flags = 0u32;
            unsafe {
                self.capture
                    .as_ref()
                    .ok_or_else(|| "System audio capture is no longer available.".to_string())?
                    .GetBuffer(&mut data, &mut available, &mut flags, None, None)
                    .map_err(audio_error)?;
            }
            let pcm = if available == 0 {
                Vec::new()
            } else if flags & 0x2 != 0 || data.is_null() {
                self.convert_packet(None, available as usize)
            } else {
                let len = (available as usize).saturating_mul(self.block_align);
                let source = unsafe { std::slice::from_raw_parts(data, len) };
                self.convert_packet(Some(source), available as usize)
            };
            let no_data = available == 0;
            let released = unsafe {
                self.capture
                    .as_ref()
                    .ok_or_else(|| "System audio capture is no longer available.".to_string())?
                    .ReleaseBuffer(available)
            }
            .map_err(audio_error);
            released?;
            if no_data {
                break;
            }
            if !pcm.is_empty() {
                let output_frames = pcm.len() / AUDIO_BYTES_PER_FRAME;
                emit(pcm, output_frames)?;
            }
        }
        Ok(())
    }

    fn convert_packet(&mut self, source: Option<&[u8]>, frames: usize) -> Vec<u8> {
        if frames == 0 {
            return Vec::new();
        }
        let bytes_per_sample = (self.bits as usize + 7) / 8;
        let mut current = Vec::with_capacity(frames);
        for frame in 0..frames {
            let sample = if let Some(source) = source {
                let read = |channel| self.read_channel(source, frame, channel, bytes_per_sample);
                let mut left = read(0);
                let mut right = if self.channels > 1 { read(1) } else { left };
                if self.channels > 2 {
                    let center = read(2) * 0.5;
                    left += center;
                    right += center;
                }
                if self.channels > 3 {
                    let lfe = read(3) * 0.2;
                    left += lfe;
                    right += lfe;
                }
                if self.channels > 4 {
                    left += read(4) * 0.5;
                }
                if self.channels > 5 {
                    right += read(5) * 0.5;
                }
                if self.channels > 6 {
                    left += read(6) * 0.5;
                }
                if self.channels > 7 {
                    right += read(7) * 0.5;
                }
                [left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0)]
            } else {
                [0.0, 0.0]
            };
            current.push(sample);
        }
        let Some(last) = current.last().copied() else { return Vec::new() };
        let previous = self.previous.unwrap_or(current[0]);
        let step = self.sample_rate as f64 / AUDIO_SAMPLE_RATE as f64;
        let mut position = self.phase;
        let mut pcm = Vec::with_capacity(((frames as f64 / step).ceil() as usize + 1) * AUDIO_BYTES_PER_FRAME);
        while position <= (frames - 1) as f64 {
            let floor = position.floor();
            let low_index = floor as isize;
            let fraction = (position - floor) as f32;
            let low = if low_index < 0 { previous } else { current[low_index as usize] };
            let high_index = low_index + 1;
            let high = if high_index < 0 {
                previous
            } else if high_index as usize >= frames {
                last
            } else {
                current[high_index as usize]
            };
            for channel in 0..AUDIO_CHANNELS {
                let value = low[channel] + (high[channel] - low[channel]) * fraction;
                let sample = (value.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
                pcm.extend_from_slice(&sample.to_le_bytes());
            }
            position += step;
        }
        self.phase = position - frames as f64;
        self.previous = Some(last);
        pcm
    }

    fn read_channel(&self, source: &[u8], frame: usize, channel: usize, bytes_per_sample: usize) -> f32 {
        let offset = frame
            .saturating_mul(self.block_align)
            .saturating_add(channel.saturating_mul(bytes_per_sample));
        let Some(sample) = source.get(offset..offset.saturating_add(bytes_per_sample)) else { return 0.0 };
        if self.is_float {
            let value = f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
            return if value.is_finite() { value.clamp(-1.0, 1.0) } else { 0.0 };
        }
        match self.bits {
            8 => (sample[0] as f32 - 128.0) / 128.0,
            16 => i16::from_le_bytes([sample[0], sample[1]]) as f32 / 32_768.0,
            24 => {
                let packed = (sample[0] as i32) | ((sample[1] as i32) << 8) | ((sample[2] as i32) << 16);
                ((packed << 8) >> 8) as f32 / 8_388_608.0
            }
            32 => i32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]) as f32 / 2_147_483_648.0,
            _ => 0.0,
        }
    }
}

#[cfg(windows)]
impl Drop for SystemAudio {
    fn drop(&mut self) {
        use windows::Win32::System::Com::CoUninitialize;

        if let Some(client) = self.client.as_ref() {
            unsafe {
                let _ = client.Stop();
            }
        }
        // Release every COM interface while the apartment is still initialized.
        drop(self.capture.take());
        drop(self.client.take());
        unsafe { CoUninitialize(); }
    }
}

#[cfg(windows)]
fn audio_subtype(guid: windows::core::GUID, subtype: u32) -> bool {
    guid.data1 == subtype
        && guid.data2 == 0
        && guid.data3 == 0x0010
        && guid.data4 == [0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71]
}

#[cfg(windows)]
fn audio_error(error: windows::core::Error) -> String {
    format!("System audio could not be captured: {error}")
}

#[cfg(windows)]
struct MfRuntime;

#[cfg(windows)]
impl MfRuntime {
    fn start() -> Result<Self, String> {
        use windows::Win32::Media::MediaFoundation::MFStartup;
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| format!("The video encoder could not start: {error}"))?;
            if let Err(error) = MFStartup(0x0002_0070, 0) {
                CoUninitialize();
                return Err(format!("The video encoder could not start: {error}"));
            }
        }
        Ok(Self)
    }
}

#[cfg(windows)]
impl Drop for MfRuntime {
    fn drop(&mut self) {
        use windows::Win32::Media::MediaFoundation::MFShutdown;
        use windows::Win32::System::Com::CoUninitialize;

        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

#[cfg(windows)]
struct WindowsWriter {
    writer: Option<windows::Win32::Media::MediaFoundation::IMFSinkWriter>,
    runtime: Option<MfRuntime>,
    stream: u32,
    audio_stream: u32,
    width: u32,
    height: u32,
    fps: u32,
    index: u64,
    audio_index: u64,
    audio_offset: i64,
    open: bool,
}

#[cfg(windows)]
impl WindowsWriter {
    fn open(path: &Path, width: u32, height: u32, fps: u32) -> Result<Self, String> {
        use std::os::windows::ffi::OsStrExt;

        use windows::core::PCWSTR;
        use windows::Win32::Media::MediaFoundation::{
            MFCreateMediaType, MFCreateSinkWriterFromURL, IMFAttributes, IMFByteStream,
            MFAudioFormat_AAC, MFAudioFormat_PCM, MFMediaType_Audio, MFVideoFormat_H264, MFVideoFormat_RGB32,
            MF_MT_ALL_SAMPLES_INDEPENDENT, MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE,
            MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE,
            MF_MT_DEFAULT_STRIDE, MF_MT_FIXED_SIZE_SAMPLES,
            MF_MT_MAJOR_TYPE, MF_MT_SAMPLE_SIZE, MF_MT_SUBTYPE,
        };
        if width < 2 || height < 2 || width % 2 == 1 || height % 2 == 1 {
            return Err("The picture size could not be used.".to_string());
        }
        let fps = fps.max(1);
        // This guard outlives the sink writer. If setup fails partway through,
        // local COM interfaces are released before Media Foundation shuts down.
        let runtime = MfRuntime::start()?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        // `Param` is implemented for `Option<&T>`, not `Option<T>`.
        let writer = unsafe {
            MFCreateSinkWriterFromURL(PCWSTR(wide.as_ptr()), None::<&IMFByteStream>, None::<&IMFAttributes>)
        }
        .map_err(mf_fail)?;
        let bitrate = ((width as u64).saturating_mul(height as u64).saturating_mul(fps as u64) / 8)
            .clamp(1_500_000, 20_000_000) as u32;
        let (stream, audio_stream) = unsafe {
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

            let audio_out = MFCreateMediaType().map_err(mf_fail)?;
            audio_out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(mf_fail)?;
            audio_out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC).map_err(mf_fail)?;
            audio_out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS as u32).map_err(mf_fail)?;
            audio_out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE).map_err(mf_fail)?;
            audio_out.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(mf_fail)?;
            audio_out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 16_000).map_err(mf_fail)?;
            audio_out.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 1).map_err(mf_fail)?;
            audio_out.SetUINT32(&MF_MT_AVG_BITRATE, 128_000).map_err(mf_fail)?;
            let audio_stream = writer.AddStream(&audio_out).map_err(mf_fail)?;
            let audio_in = MFCreateMediaType().map_err(mf_fail)?;
            audio_in.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(mf_fail)?;
            audio_in.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM).map_err(mf_fail)?;
            audio_in.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS as u32).map_err(mf_fail)?;
            audio_in.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE).map_err(mf_fail)?;
            audio_in.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(mf_fail)?;
            audio_in.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, AUDIO_BYTES_PER_FRAME as u32).map_err(mf_fail)?;
            audio_in
                .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AUDIO_SAMPLE_RATE * AUDIO_BYTES_PER_FRAME as u32)
                .map_err(mf_fail)?;
            audio_in.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1).map_err(mf_fail)?;
            writer
                .SetInputMediaType(audio_stream, &audio_in, None::<&IMFAttributes>)
                .map_err(mf_fail)?;
            writer.BeginWriting().map_err(mf_fail)?;
            (stream, audio_stream)
        };
        Ok(Self {
            writer: Some(writer),
            runtime: Some(runtime),
            stream,
            audio_stream,
            width,
            height,
            fps,
            index: 0,
            audio_index: 0,
            audio_offset: 0,
            open: true,
        })
    }

    fn video_queue_full(&self) -> bool {
        use windows::Win32::Media::MediaFoundation::MF_SINK_WRITER_STATISTICS;

        let Some(writer) = self.writer.as_ref() else { return false };
        let mut stats = MF_SINK_WRITER_STATISTICS::default();
        stats.cb = std::mem::size_of::<MF_SINK_WRITER_STATISTICS>() as u32;
        if unsafe { writer.GetStatistics(self.stream, &mut stats) }.is_err() {
            return false;
        }
        pending_video_samples(stats.qwNumSamplesReceived, stats.qwNumSamplesProcessed) >= MAX_PENDING_VIDEO_SAMPLES
    }

    fn skip_video_frame(&mut self) {
        self.index = self.index.saturating_add(1);
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
            self.writer
                .as_ref()
                .ok_or_else(|| "The video writer is no longer available.".to_string())?
                .WriteSample(self.stream, &sample)
                .map_err(|error| error.to_string())?;
        }
        self.index += 1;
        Ok(())
    }

    fn set_audio_offset(&mut self, offset: Duration) {
        self.audio_offset = (offset.as_nanos() / 100).min(i64::MAX as u128) as i64;
    }

    fn push_audio(&mut self, pcm: &[u8], frames: usize) -> Result<(), String> {
        use windows::Win32::Media::MediaFoundation::{MFCreateMemoryBuffer, MFCreateSample};

        let expected = frames.saturating_mul(AUDIO_BYTES_PER_FRAME);
        if frames == 0 {
            return Ok(());
        }
        if pcm.len() < expected {
            return Err("An audio packet was incomplete.".to_string());
        }
        unsafe {
            let buffer = MFCreateMemoryBuffer(expected as u32).map_err(|error| error.to_string())?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None).map_err(|error| error.to_string())?;
            if ptr.is_null() {
                let _ = buffer.Unlock();
                return Err("An audio packet could not be copied.".to_string());
            }
            std::ptr::copy_nonoverlapping(pcm.as_ptr(), ptr, expected);
            buffer.Unlock().map_err(|error| error.to_string())?;
            buffer.SetCurrentLength(expected as u32).map_err(|error| error.to_string())?;
            let sample = MFCreateSample().map_err(|error| error.to_string())?;
            sample.AddBuffer(&buffer).map_err(|error| error.to_string())?;
            let scale = 10_000_000i64;
            let rate = AUDIO_SAMPLE_RATE as i64;
            let when = self.audio_offset.saturating_add((self.audio_index as i64).saturating_mul(scale) / rate);
            let duration = (frames as i64).saturating_mul(scale) / rate;
            sample.SetSampleTime(when).map_err(|error| error.to_string())?;
            sample.SetSampleDuration(duration.max(1)).map_err(|error| error.to_string())?;
            self.writer
                .as_ref()
                .ok_or_else(|| "The video writer is no longer available.".to_string())?
                .WriteSample(self.audio_stream, &sample)
                .map_err(|error| error.to_string())?;
        }
        self.audio_index = self.audio_index.saturating_add(frames as u64);
        Ok(())
    }

    fn finish(mut self) -> Result<(), String> {
        if !self.open {
            self.release_runtime();
            return Ok(());
        }
        self.open = false;
        let result = self
            .writer
            .as_ref()
            .ok_or_else(|| "The video writer is no longer available.".to_string())
            .and_then(|writer| unsafe { writer.Finalize() }.map_err(|error| format!("The video could not be finished: {error}")));
        self.release_runtime();
        result
    }

    fn abandon(&mut self) {
        if self.open {
            self.open = false;
            if let Some(writer) = self.writer.as_ref() {
                let _ = unsafe { writer.Finalize() };
            }
        }
        self.release_runtime();
    }

    fn release_runtime(&mut self) {
        // The sink writer owns encoder and sample buffers. Release it before
        // shutting Media Foundation down or leaving its COM apartment.
        drop(self.writer.take());
        drop(self.runtime.take());
    }
}

#[cfg(windows)]
impl Drop for WindowsWriter {
    fn drop(&mut self) {
        self.abandon();
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
    format!("The video file could not be opened: {error}")
}

#[cfg(windows)]
fn pack(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | low as u64
}

pub(crate) fn decode_jpeg(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut out = Vec::new();
    let (width, height) = decode_jpeg_into(bytes, &mut out)?;
    Ok((width, height, out))
}

/// Decode one JPEG into a caller-owned BGRA buffer.
///
/// Encoding a replay decodes a picture for every frame in the clip. Handing the
/// same buffer back in keeps the largest allocation out of that loop: only the
/// decoder's own RGB picture is still created per frame.
pub(crate) fn decode_jpeg_into(bytes: &[u8], out: &mut Vec<u8>) -> Result<(u32, u32), String> {
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    let pixels = decoder.decode().map_err(|error| format!("A frame could not be read: {error}"))?;
    let info = decoder.info().ok_or_else(|| "A frame could not be read.".to_string())?;
    let width = info.width as u32;
    let height = info.height as u32;
    if width < 2 || height < 2 {
        return Err("A frame could not be read.".to_string());
    }
    match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => {
            out.clear();
            out.resize(pixels.len() / 3 * 4, 0);
            for (index, pixel) in pixels.chunks_exact(3).enumerate() {
                let at = index * 4;
                out[at] = pixel[2];
                out[at + 1] = pixel[1];
                out[at + 2] = pixel[0];
                out[at + 3] = 255;
            }
        }
        jpeg_decoder::PixelFormat::L8 => {
            out.clear();
            out.resize(pixels.len() * 4, 0);
            for (index, gray) in pixels.iter().enumerate() {
                let at = index * 4;
                out[at] = *gray;
                out[at + 1] = *gray;
                out[at + 2] = *gray;
                out[at + 3] = 255;
            }
        }
        _ => return Err("A frame could not be read.".to_string()),
    }
    Ok((width, height))
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
    fn pending_audio_cannot_grow_past_its_memory_limit() {
        let mut pending = VecDeque::new();
        let mut bytes = 0;
        queue_pending_audio(&mut pending, &mut bytes, vec![1; 4], 1, 4).unwrap();
        let error = queue_pending_audio(&mut pending, &mut bytes, vec![2], 1, 4).unwrap_err();
        assert!(error.contains("recording was not saved"));
        assert_eq!(pending.len(), 1);
        assert_eq!(bytes, 4);
    }

    #[test]
    fn pending_video_samples_saturate_when_the_encoder_has_caught_up() {
        assert_eq!(pending_video_samples(8, 6), 2);
        assert_eq!(pending_video_samples(4, 7), 0);
        assert_eq!(MAX_PENDING_VIDEO_SAMPLES, 2);
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

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orbit-capture-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_replay_keeps_only_the_asked_length() {
        let dir = test_dir("length");
        let buffer = Buffer::new(&dir, 2, Duration::from_secs(2)).unwrap();
        let jpeg = sample_jpeg();
        for _ in 0..6 {
            buffer.push_jpeg(&jpeg, 16, 16);
        }
        let kept = buffer.snapshot(2).unwrap();
        assert_eq!(kept.frame_count(), 4);
        assert_eq!(kept.frame(0).unwrap(), jpeg);
        assert_eq!(kept.frame(3).unwrap(), jpeg);

        let dir = test_dir("length-short");
        let buffer = Buffer::new(&dir, 2, Duration::from_secs(2)).unwrap();
        for _ in 0..6 {
            buffer.push_jpeg(&jpeg, 16, 16);
        }
        assert_eq!(buffer.snapshot(1).unwrap().frame_count(), 2);
    }

    #[test]
    fn a_snapshot_starts_a_fresh_pair_of_replay_files() {
        let dir = test_dir("renew");
        let buffer = Buffer::new(&dir, 2, Duration::from_secs(2)).unwrap();
        let jpeg = sample_jpeg();
        for _ in 0..4 {
            buffer.push_jpeg(&jpeg, 16, 16);
        }
        let kept = buffer.snapshot(2).unwrap();
        assert_eq!(kept.frame_count(), 4);
        // The clip owns what was kept; the running buffer starts empty.
        assert!(buffer.snapshot(2).is_err());
        buffer.push_jpeg(&jpeg, 16, 16);
        let second = buffer.snapshot(1).unwrap();
        assert_eq!(second.frame_count(), 1);
        // Even after another renewal, the first clip still owns its file.
        assert_eq!(kept.frame(0).unwrap(), jpeg);
        assert_eq!(second.frame(0).unwrap(), jpeg);
    }

    #[test]
    fn replay_snapshots_keep_audio_for_the_video_window() {
        let dir = test_dir("audio");
        let buffer = Buffer::new(&dir, 2, Duration::from_secs(2)).unwrap();
        let jpeg = sample_jpeg();
        for _ in 0..4 {
            buffer.push_jpeg(&jpeg, 16, 16);
        }
        let second = vec![0u8; AUDIO_SAMPLE_RATE as usize * AUDIO_BYTES_PER_FRAME];
        buffer.push_audio_pcm(second.clone());
        buffer.push_audio_pcm(second);

        let kept = buffer.snapshot(1).unwrap();
        assert_eq!(kept.frame_count(), 2);
        assert_eq!(kept.audio_frames, AUDIO_SAMPLE_RATE as usize);
        assert!(kept.has_audio());
        let (pcm, frames) = kept.audio_chunk(0).unwrap();
        assert_eq!(frames, AUDIO_SAMPLE_RATE as usize);
        assert_eq!(pcm.len(), frames * AUDIO_BYTES_PER_FRAME);
    }

    #[test]
    fn a_circular_spool_wraps_without_losing_whole_records() {
        let dir = test_dir("spool");
        let spool = Spool::create(&dir, "round.spool", 64).unwrap();
        assert_eq!(spool.append(&[1u8; 20]).unwrap(), (0, 20));
        assert_eq!(spool.append(&[2u8; 20]).unwrap(), (20, 20));
        assert_eq!(spool.read(0, 20).unwrap(), vec![1u8; 20]);
        assert_eq!(spool.read(20, 20).unwrap(), vec![2u8; 20]);
        // A record that would cross the end starts again at the beginning.
        assert_eq!(spool.append(&[3u8; 30]).unwrap(), (64, 30));
        assert_eq!(spool.read(64, 30).unwrap(), vec![3u8; 30]);
    }

    /// Records of different sizes are what the replay really holds. Counting
    /// only live bytes let the write head land inside a live record as soon as
    /// the file wrapped, which is what made a saved replay fail to decode about
    /// half a minute into a game.
    #[test]
    fn a_replay_that_fills_its_file_still_returns_whole_frames() {
        let dir = test_dir("ring-wrap");
        // Small files, so the wrap happens inside a short test. The code path
        // is the same one the real 256 MB file uses.
        let buffer = Buffer::with_files(&dir, 30, Duration::from_secs(20), 4096, 2048).unwrap();
        let mut pushed = Vec::new();
        for step in 0..300u32 {
            let len = 13 + (step.wrapping_mul(29) % 71) as usize;
            let tag = (step % 251) as u8;
            buffer.push_jpeg(&vec![tag; len], 16, 16);
            pushed.push(tag);
        }
        let kept = buffer.snapshot(20).unwrap();
        assert!(kept.frame_count() > 4);
        let first = pushed.len() - kept.frame_count();
        for index in 0..kept.frame_count() {
            let frame = kept.frame(index).unwrap();
            assert!(
                frame.iter().all(|byte| *byte == pushed[first + index]),
                "frame {index} was overwritten by a later lap"
            );
        }
    }

    #[test]
    fn a_replay_that_fills_its_audio_file_keeps_whole_chunks() {
        let dir = test_dir("audio-wrap");
        let buffer = Buffer::with_files(&dir, 30, Duration::from_secs(20), 4096, 1024).unwrap();
        buffer.push_jpeg(&[9u8; 16], 16, 16);
        let mut pushed = Vec::new();
        for step in 0..80u32 {
            let frames = 90 + (step % 40) as usize;
            let tag = (step % 251) as u8;
            buffer.push_audio_pcm(vec![tag; frames * AUDIO_BYTES_PER_FRAME]);
            pushed.push(tag);
        }
        let kept = buffer.snapshot(1).unwrap();
        assert!(kept.audio_chunk_count() > 1);
        let first = pushed.len() - kept.audio_chunk_count();
        for index in 0..kept.audio_chunk_count() {
            let (pcm, frames) = kept.audio_chunk(index).unwrap();
            assert_eq!(pcm.len(), frames * AUDIO_BYTES_PER_FRAME);
            assert!(
                pcm.iter().all(|byte| *byte == pushed[first + index]),
                "audio chunk {index} was overwritten by a later lap"
            );
        }
    }

    #[test]
    fn a_wrapped_spool_never_writes_into_a_live_record() {
        let dir = test_dir("wrap-live");
        let capacity = 4096;
        let spool = Spool::create(&dir, "wrap.spool", capacity).unwrap();
        let mut records: VecDeque<FrameRef> = VecDeque::new();
        let mut tags: VecDeque<u8> = VecDeque::new();
        for step in 0..400u32 {
            let len = 13 + (step.wrapping_mul(37) % 89) as usize;
            let tag = (step % 251) as u8;
            let bytes = vec![tag; len];
            let at = spool.position(len as u64);
            let dropped = make_room(&mut records, capacity, at, len as u64);
            for _ in 0..dropped {
                tags.pop_front();
            }
            let (at, len) = spool.append(&bytes).unwrap();
            records.push_back(FrameRef { at, len });
            tags.push_back(tag);
            for (record, written) in records.iter().zip(tags.iter()) {
                let read = spool.read(record.at, record.len).unwrap();
                assert!(
                    read.iter().all(|item| item == written),
                    "step {step}: the record at {} no longer holds what was written",
                    record.at
                );
            }
            // Nothing older than one lap may stay in the index.
            let oldest = spool.position(0).saturating_sub(capacity);
            assert!(records.iter().all(|record| record.at > oldest));
        }
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
        let kept = Kept::empty();
        assert!(write_mp4(Path::new("unused.mp4"), &kept).is_err());
        assert_eq!(kept.frame_count(), 0);
        assert!(!kept.has_audio());
    }
}
