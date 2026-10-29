/** Capture must keep audio, preserve real-time pacing, and stay within a bounded replay footprint. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const capture = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'capture.rs'), 'utf8');
const audio = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'audio.rs'), 'utf8');
const overlay = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'overlay.rs'), 'utf8');
const settings = readFileSync(path.join(root, 'web', 'src', 'components', 'SettingsView.tsx'), 'utf8');
const notice = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'notice.rs'), 'utf8');
const stats = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'stats.rs'), 'utf8');
const lib = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'lib.rs'), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`);
  }
}

const ffmpegRecording = overlay.slice(overlay.indexOf('fn spawn_ffmpeg_recording'), overlay.indexOf('fn start_buffer'));
const pipeBuffer = overlay.slice(overlay.indexOf('fn start_pipe_buffer'), overlay.indexOf('fn stop_buffer'));
const linuxGrabStart = capture.indexOf('#[cfg(target_os = "linux")]\nfn grab_screen');
const linuxGrab = capture.slice(linuxGrabStart, capture.indexOf('pub fn fit', linuxGrabStart));
const replayEncoder = overlay.slice(overlay.indexOf('fn ffmpeg_from_jpegs'), overlay.indexOf('fn read_jpeg_pipe'));
const readyNotice = overlay.slice(overlay.indexOf('pub fn ready_notice'), overlay.indexOf('pub fn game_stopped'));
const windowsWriterStart = capture.indexOf('impl WindowsWriter');
const windowsWriterEnd = capture.indexOf('fn set_video(', windowsWriterStart);
const windowsWriter = capture.slice(windowsWriterStart, windowsWriterEnd);
const systemAudioDropStart = capture.indexOf('impl Drop for SystemAudio');
const systemAudioDropEnd = capture.indexOf('fn audio_subtype', systemAudioDropStart);
const systemAudioDrop = capture.slice(systemAudioDropStart, systemAudioDropEnd);

check(
  'the rolling replay is a bounded temporary file, not a memory ring',
  /const VIDEO_SPOOL_BYTES:\s*u64\s*=\s*256\s*\*\s*1024\s*\*\s*1024/.test(capture) &&
    /const AUDIO_SPOOL_BYTES:\s*u64\s*=\s*32\s*\*\s*1024\s*\*\s*1024/.test(capture) &&
    !capture.includes('MAX_RING_BYTES'),
);
check('the replay buffer writes into a circular file and reads records back', capture.includes('struct Spool') && capture.includes('fn append(&self, bytes: &[u8])') && capture.includes('fn read(&self, at: u64, len: u32)'));
check('a snapshot keeps its own files so encoding cannot read a reused record', capture.includes('fn renew(&mut self)') && /ring\.renew\(\)\?;/.test(capture));
check(
  'a wrapped replay file drops exactly the records the next write would land on',
  capture.includes('fn make_room') &&
    capture.includes('fn position(&self, len: u64) -> u64') &&
    capture.includes('Self::place(written, self.capacity, len)') &&
    capture.includes('video.position(len)') &&
    capture.includes('sound.position(incoming)') &&
    !capture.includes('ring.bytes.saturating_add(len) > VIDEO_SPOOL_BYTES'),
);
check('a replay save waits for the encoder queue instead of growing with the clip', capture.includes('fn wait_for_video_room') && /wait_for_video_room\(&writer\)/.test(capture));
check('a replay save decodes every frame into one reused buffer', capture.includes('fn decode_jpeg_into(bytes: &[u8], out: &mut Vec<u8>)') && /decode_jpeg_into\(&jpeg, &mut bgra\)/.test(capture));
check('Linux capture scales each tile into the output without a full-screen BGRA staging buffer', !linuxGrab.includes('let mut raw = vec!') && linuxGrab.includes('bytes.resize(') && linuxGrab.includes('for dst_x in 0..out_w'));
check('recording and replay capture reuse their raw frame buffers', capture.includes('grab_with_buffer(spec, std::mem::take(&mut scratch))') && capture.includes('fn grab_jpeg(spec: Spec, size: &mut Option<(u32, u32)>, scratch: &mut Vec<u8>)') && capture.includes('pixels.resize('));
check('replay snapshots keep only offsets, so a long clip costs no memory', capture.includes('struct FrameRef') && capture.includes('.skip(start).copied().collect()'));
check('the game-start notice does not create a second web view', readyNotice.includes('crate::notice::show') && !readyNotice.includes('ensure_window') && !/window\.show\(\)/.test(readyNotice));
check(
  'the FPS box waits for the panel and does not hammer the display for a duplication',
  stats.includes('const FRAMES_FIRST: Duration = Duration::from_millis(1400)') &&
    stats.includes('const FRAMES_RETRY: Duration = Duration::from_secs(2)') &&
    /if since\.elapsed\(\) < wait \{\n                    return None;/.test(stats) &&
    // A refused or lost duplication is not reopened on every 200 ms poll.
    !/FramePull::Dead => \{[\s\S]{0,400}self\.inner = WindowsFrames::open\(\);/.test(stats) &&
    stats.includes('self.tried = Some(Instant::now());') &&
    stats.includes('stats: desktop frames are readable') &&
    stats.includes('stats: the desktop duplication was refused'),
);
check('the game-start notice is a native, click-through card', notice.includes('CreateWindowExW') && notice.includes('WS_EX_TRANSPARENT') && notice.includes('WS_EX_NOACTIVATE') && !notice.includes('WebviewWindow'));
check(
  'a replay save waits for the encoder to make progress, not for a fixed clock',
  capture.includes('fn video_progress(&self)') &&
    capture.includes('const STALLED: Duration = Duration::from_secs(15)') &&
    capture.includes('last_progress = Instant::now()') &&
    !capture.includes('let deadline = Instant::now() + Duration::from_secs(30)'),
);
check(
  'the sink writer asks for a hardware encoder and falls back to software',
  capture.includes('MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS') &&
    capture.includes('Self::open_with(path, width, height, fps, false)'),
);
check(
  'starting a replay probes the screen with a small picture, not a full frame',
  capture.includes('let probe = Spec { max_width: 320, max_height: 180, ..spec };') &&
    capture.includes('let _ = grab(probe)?;'),
);
check(
  'closing the overlay closes the performance counters that watch every GPU engine',
  stats.includes('fn gpu_release()') && stats.includes('PdhCloseQuery(query.query)') && stats.includes('gpu_release();'),
);
check('WASAPI loopback reads the default system output', capture.includes('AUDCLNT_STREAMFLAGS_LOOPBACK') && capture.includes('GetDefaultAudioEndpoint(eRender, eConsole)'));
check('Windows MP4 output declares and writes an AAC audio stream', capture.includes('MFAudioFormat_AAC') && capture.includes('WriteSample(self.audio_stream, &sample)'));
check('the built-in recording rejects a silent replay buffer', capture.includes('No system audio was captured, so Orbit did not save a silent replay.'));
const noAudioStart = capture.indexOf('if audio_written == 0 {');
const noAudioEnd = capture.indexOf('\n    }', noAudioStart);
const noAudioBlock = capture.slice(noAudioStart, noAudioEnd < 0 ? undefined : noAudioEnd);
check('silent recordings are deleted and report a concise replacement error', !capture.includes('No system audio samples were captured, so Orbit did not keep a silent recording.') && noAudioBlock.includes('fs::remove_file(&out)') && noAudioBlock.includes('System audio could not be captured, so the recording was not saved.'));
check('queued Windows recording audio has a hard memory cap and failed audio discards the file', capture.includes('MAX_PENDING_AUDIO_BYTES: usize = 16 * 1024 * 1024') && capture.includes('queue_pending_audio') && capture.includes('audio_write_failed') && capture.includes('recording was not saved'));
const writerRelease = windowsWriter.indexOf('drop(self.writer.take())');
const runtimeRelease = windowsWriter.indexOf('drop(self.runtime.take())');
check('the Windows sink writer is released before Media Foundation and COM shut down', writerRelease >= 0 && runtimeRelease > writerRelease && capture.includes('struct MfRuntime'));
check('Windows recording bounds pending video samples and advances the real-time timeline when dropping frames', capture.includes('MAX_PENDING_VIDEO_SAMPLES: u64 = 2') && capture.includes('GetStatistics(self.stream, &mut stats)') && capture.includes('writer.skip_video_frame()') && capture.includes('timeline_frames = timeline_frames.saturating_add(1)'));
const captureClientRelease = systemAudioDrop.indexOf('drop(self.capture.take())');
const audioClientRelease = systemAudioDrop.indexOf('drop(self.client.take())');
const audioComShutdown = systemAudioDrop.indexOf('CoUninitialize();');
check('WASAPI interfaces are released before their COM apartment is uninitialized', captureClientRelease >= 0 && audioClientRelease > captureClientRelease && audioComShutdown > audioClientRelease);
check('Windows audio polling balances every COM apartment initialization on early returns', /impl Drop for ComApartment[\s\S]*?CoUninitialize/.test(audio) && ['windows_list_inner', 'windows_set_inner', 'windows_devices', 'windows_use_device'].every((name) => new RegExp(`unsafe fn ${name}[\\s\\S]*?ComApartment::enter\(\)`).test(audio)));
check('the FFmpeg recording maps the Linux system-output monitor to AAC', ffmpegRecording.includes('system_audio_monitor()') && ffmpegRecording.includes('"-f", "pulse", "-i"') && ffmpegRecording.includes('"-map", "1:a:0"') && ffmpegRecording.includes('"aac"'));
check('the FFmpeg recording path does not explicitly disable audio', !ffmpegRecording.includes('"-an"'));
check('the Linux replay pipe is deliberately capped at 720p and 15 fps to keep the desktop responsive', pipeBuffer.includes('replay_spec().fps.max(1)') && pipeBuffer.includes('scale=1280:-2') && overlay.includes('spec.fps = spec.fps.min(15)') && capture.includes('while next_frame <= now') && capture.includes('next_frame += interval'));
check('taking a screenshot no longer hides and remaps the live overlay', !overlay.slice(overlay.indexOf('pub fn shot('), overlay.indexOf('pub fn record(')).includes('conceal(') && !overlay.slice(overlay.indexOf('pub fn shot('), overlay.indexOf('pub fn record(')).includes('show_window('));
check('replay encoding combines buffered video and audio into one MP4', replayEncoder.includes('write_audio_wav') && replayEncoder.includes('"1:a:0"') && replayEncoder.includes('"aac"'));
check('Windows recording interleaves loopback packets against the video timeline', capture.includes('queue_pending_audio(&mut pending_audio') && capture.includes('flush_audio_samples(') && capture.includes('audio_time >= video_end_ticks'));
check('Windows replay interleaves MP4 samples in presentation-time order', capture.includes('if video_time <= audio_time'));
check(
  'the overlay is left out of pictures and videos, so a recording shows the game',
  overlay.includes('.content_protected(true)') &&
    notice.includes('WDA_EXCLUDEFROMCAPTURE') &&
    !overlay.includes('exclude_from_capture('),
);
check('capture settings accurately explain system-output audio and microphone behavior', settings.includes('Recordings and replays use system-output audio when available; the microphone is not captured.') && !settings.includes('Game sound is not recorded yet.'));
check('Linux audio capture workers are stopped and joined during app shutdown', overlay.includes('live.audio_buffer.take()') && overlay.includes('live.audio_thread.take()') && overlay.includes('if let Some(reader) = audio.1') && overlay.includes('reader.join()'));

check(
  'a capture that outlives the panel still reports itself',
  /pub fn announce_capture/.test(overlay) &&
    // A panel on screen (open or resting) has its own toast; a closed one
    // gets the card.
    overlay.includes('if panel_visible(app)') &&
    overlay.includes('Card::error("Capture failed"') &&
    // Announced from inside the blocking task, so closing the panel - and
    // dropping the command's future - cannot swallow it.
    /spawn_blocking\(move \|\| \{[\s\S]*?overlay::announce_capture\(&worker, "screenshot", &outcome\)/.test(lib) &&
    /overlay::announce_capture\(&worker, "recording", &outcome\)/.test(lib) &&
    /overlay::announce_capture\(&worker, "replay", &outcome\)/.test(lib),
);
check(
  'a capture announced with no panel on screen brings its own chime',
  overlay.includes('play_chime(volume)') &&
    overlay.includes('play_chime(volume)') &&
    overlay.includes('fn chime_wav(') &&
    overlay.includes('PlaySoundW(') &&
    // The same three notes as the web chime, and the same setting.
    overlay.includes('const ROOT: f32 = 293.66') &&
    overlay.includes('live.shutter') &&
    overlay.includes('live.shutter_volume'),
);
check(
  'the game-start card is a themed Orbit card with the mark, not a plain rectangle',
  notice.includes('orbit-mark-mask.bin') &&
    notice.includes('draw_mark(') &&
    notice.includes('pub struct Palette') &&
    lib.includes('fn overlay_theme(') &&
    lib.includes('overlay::set_palette'),
);
check(
  'the card is composited from an antialiased, premultiplied bitmap',
  // GDI+ paints it and UpdateLayeredWindow puts it on screen, so the rounded
  // corners and the type are smooth instead of a clipped region and GDI text.
  notice.includes('GdiplusStartup') &&
    notice.includes('GdipFillPath') &&
    notice.includes('GdipDrawString') &&
    notice.includes('UpdateLayeredWindow') &&
    notice.includes('PREMULTIPLIED_ARGB') &&
    // Drawn at the monitor's own scale, not stretched by the compositor.
    notice.includes('GetDpiForWindow') &&
    !notice.includes('CreateRoundRectRgn'),
);
check(
  'the card is the panel toast: same width, corners, type and icon column',
  notice.includes('const WIDTH: f32 = 352.0;') &&
    notice.includes('const HEIGHT: f32 = 64.0;') &&
    notice.includes('const RADIUS: f32 = 16.0;') &&
    notice.includes('const ICON_BOX: f32 = 24.0;') &&
    notice.includes('const TITLE_SIZE: f32 = 13.0;') &&
    notice.includes('const DETAIL_SIZE: f32 = 11.0;') &&
    !notice.includes('CHIP'),
);
check(
  'a capture card uses the same icon the panel toast uses for it',
  notice.includes('pub enum Icon') &&
    notice.includes('Icon::Camera') &&
    notice.includes('Icon::Record') &&
    notice.includes('Icon::Replay') &&
    notice.includes('pub fn with_icon(mut self, icon: Icon)') &&
    overlay.includes('Card::ok(title, capture_detail(kind, text), palette).with_icon(icon)') &&
    /let icon = match kind \{[\s\S]*?"recording" => Icon::Record[\s\S]*?"replay" => Icon::Replay/.test(overlay),
);
check(
  'the capture chords are the ones the settings page draws, not a hardcoded trio',
  overlay.includes('pub const SHIPPED_PAD: [Chord; 3]') &&
    overlay.includes('Chord::new(Some(4), 5)') &&
    overlay.includes('Chord::new(Some(4), 14)') &&
    overlay.includes('Chord::new(Some(4), 15)') &&
    overlay.includes('Some(Capture::Shot)') &&
    overlay.includes('Some(Capture::Record)') &&
    overlay.includes('Some(Capture::Replay)') &&
    overlay.includes('"capture-shot"') &&
    overlay.includes('"capture-record"') &&
    overlay.includes('"capture-replay"'),
);
check(
  'a capture chord works with the panel closed, and is taken on the desktop side',
  // The panel is not built until Alt+X is pressed, and a screenshot of the
  // game is taken while the game is in front - so the chord cannot wait for a
  // panel that will never open. Nor can it be handed to the library window:
  // with a game in front that window is minimised, and a minimised web view
  // does not run. The capture happens here.
  /if !is_open\(\) \{[\s\S]{0,200}capture_from_shortcut\(app, capture\);/.test(overlay) &&
    overlay.includes('fn capture_from_shortcut(') &&
    !overlay.includes('fn spawn_capture(') &&
    !overlay.includes('orbit-pad-capture') &&
    // Start+Select still opens and closes the panel with it closed; the toggle
    // is answered before that gate.
    /if step\.toggle \{\s*request_toggle\("the pad's Start\+Select"\);\s*return;\s*\}[\s\S]*?if !is_open\(\)/.test(overlay),
);
check(
  'the right stick is read from XInput and sent while the panel is open',
  overlay.includes('state.Gamepad.sThumbRX') &&
    overlay.includes('vec![x, y, rx, ry]') &&
    overlay.includes('window.emit("overlay-pad-axes"') &&
    // One idle report after the stick is let go, so the scroll stops.
    overlay.includes('if moving || watch.stick_moving'),
);
check(
  'the panel is built before it is first asked for, so the first Alt+X is quick',
  /pub fn warm\(app: &AppHandle\)/.test(overlay) &&
    overlay.includes('thread::Builder::new()\n        .name("orbit-warm"') &&
    overlay.includes('ensure_window(&panel)') &&
    lib.includes('overlay::warm(&app);'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
