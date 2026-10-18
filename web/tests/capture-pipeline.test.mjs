/** Capture must keep audio, preserve real-time pacing, and stay within a bounded replay footprint. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const capture = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'capture.rs'), 'utf8');
const audio = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'audio.rs'), 'utf8');
const overlay = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'overlay.rs'), 'utf8');
const settings = readFileSync(path.join(root, 'web', 'src', 'components', 'SettingsView.tsx'), 'utf8');

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

check('the video and audio replay ring share one 96 MiB cap', /MAX_RING_BYTES:\s*usize\s*=\s*96\s*\*\s*1024\s*\*\s*1024/.test(capture));
check('Linux capture scales each tile into the output without a full-screen BGRA staging buffer', !linuxGrab.includes('let mut raw = vec!') && linuxGrab.includes('bytes.resize(') && linuxGrab.includes('for dst_x in 0..out_w'));
check('recording and replay capture reuse their raw frame buffers', capture.includes('grab_with_buffer(spec, std::mem::take(&mut scratch))') && capture.includes('fn grab_jpeg(spec: Spec, size: &mut Option<(u32, u32)>, scratch: &mut Vec<u8>)') && capture.includes('pixels.resize('));
check('replay snapshots share compressed frames instead of cloning their payloads', capture.includes('VecDeque<Arc<[u8]>>') && capture.includes('.skip(start).cloned().collect()'));
check('WASAPI loopback reads the default system output', capture.includes('AUDCLNT_STREAMFLAGS_LOOPBACK') && capture.includes('GetDefaultAudioEndpoint(eRender, eConsole)'));
check('Windows MP4 output declares and writes an AAC audio stream', capture.includes('MFAudioFormat_AAC') && capture.includes('writer.WriteSample(self.audio_stream, &sample)'));
check('the built-in recording rejects a silent replay buffer', capture.includes('No system audio was captured, so Orbit did not save a silent replay.'));
const noAudioStart = capture.indexOf('if audio_written == 0 {');
const noAudioEnd = capture.indexOf('\n    }', noAudioStart);
const noAudioBlock = capture.slice(noAudioStart, noAudioEnd < 0 ? undefined : noAudioEnd);
check('silent recordings are deleted and report a concise replacement error', !capture.includes('No system audio samples were captured, so Orbit did not keep a silent recording.') && noAudioBlock.includes('fs::remove_file(&out)') && noAudioBlock.includes('System audio could not be captured, so the recording was not saved.'));
check('queued Windows recording audio has a hard memory cap and failed audio discards the file', capture.includes('MAX_PENDING_AUDIO_BYTES: usize = 16 * 1024 * 1024') && capture.includes('queue_pending_audio') && capture.includes('audio_write_failed') && capture.includes('recording was not saved'));
check('Windows audio polling balances every COM apartment initialization on early returns', /impl Drop for ComApartment[\s\S]*?CoUninitialize/.test(audio) && ['windows_list_inner', 'windows_set_inner', 'windows_devices', 'windows_use_device'].every((name) => new RegExp(`unsafe fn ${name}[\\s\\S]*?ComApartment::enter\(\)`).test(audio)));
check('the FFmpeg recording maps the Linux system-output monitor to AAC', ffmpegRecording.includes('system_audio_monitor()') && ffmpegRecording.includes('"-f", "pulse", "-i"') && ffmpegRecording.includes('"-map", "1:a:0"') && ffmpegRecording.includes('"aac"'));
check('the FFmpeg recording path does not explicitly disable audio', !ffmpegRecording.includes('"-an"'));
check('the replay frame pipe is paced at the selected real-time frame rate', pipeBuffer.includes('format!("fps={},{}"') && capture.includes('while next_frame <= now') && capture.includes('next_frame += interval'));
check('replay encoding combines buffered video and audio into one MP4', replayEncoder.includes('write_audio_wav') && replayEncoder.includes('"1:a:0"') && replayEncoder.includes('"aac"'));
check('Windows recording interleaves loopback packets against the video timeline', capture.includes('queue_pending_audio(&mut pending_audio') && capture.includes('flush_audio_samples(') && capture.includes('audio_time >= video_end_ticks'));
check('Windows replay interleaves MP4 samples in presentation-time order', capture.includes('if video_time <= audio_time'));
check('the overlay window is protected from capture on Windows', overlay.includes('.content_protected(true)') && overlay.includes('WDA_EXCLUDEFROMCAPTURE'));
check('capture settings accurately explain system-output audio and microphone behavior', settings.includes('Recordings and replays use system-output audio when available; the microphone is not captured.') && !settings.includes('Game sound is not recorded yet.'));
check('Linux audio capture workers are stopped and joined during app shutdown', overlay.includes('live.audio_buffer.take()') && overlay.includes('live.audio_thread.take()') && overlay.includes('if let Some(reader) = audio.1') && overlay.includes('reader.join()'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
