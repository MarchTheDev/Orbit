/**
 * Where the overlay puts what it captures.
 *
 * A screenshot is a picture and a recording is a video, so they belong in the
 * machine's own Pictures and Videos folders, in an Orbit folder, in a folder
 * named after the game - not inside the app's private data directory, where
 * only Orbit can find them. The desktop side resolves those folders; the page
 * cannot guess them, so it asks. These checks read both halves, because the
 * Rust one cannot be compiled here.
 */
import { readFileSync } from 'node:fs';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const rust = read('../src-tauri/src/overlay.rs');
const lib = read('../src-tauri/src/lib.rs');
const native = read('../src/services/native.ts');
const settings = read('../src/components/SettingsView.tsx');

console.log('the defaults are the folders the machine already uses');

check('a screenshot goes to Pictures', /picture_dir\(\)/.test(rust));
check('a recording and a replay go to Videos', /video_dir\(\)/.test(rust));
check('each one lands in an Orbit folder', /pictures\.join\("Orbit"\)/.test(rust));
check('recordings and replays are told apart inside it',
  rust.includes('videos.join("Orbit").join("Recordings")') &&
    rust.includes('videos.join("Orbit").join("Replays")'));
check('and the game gets a folder of its own inside that',
  /fn game_dir\(kind: &str\)[\s\S]{0,160}safe_name\(&capture_name\(\)\)/.test(rust));
check('a machine with no Pictures folder still gets one',
  rust.includes('home.join("Pictures")') && rust.includes('home.join("Videos")'));
check('and the app data folder is only the last resort',
  /fn capture_defaults[\s\S]{0,900}app_data_dir\(\)[\s\S]{0,80}unwrap_or_default/.test(rust));

console.log('choosing nothing keeps the default that was already resolved');

check('a chosen folder still wins',
  /fn configured_capture_dir\(current: &Path, root: &Path, selected: &str, kind: &str\) -> PathBuf \{\s*if !selected\.trim\(\)\.is_empty\(\) \{\s*PathBuf::from\(selected\.trim\(\)\)/.test(rust));
check('an empty choice does not drag the captures back into app data',
  /else if !current\.as_os_str\(\)\.is_empty\(\) \{\s*current\.to_path_buf\(\)/.test(rust));
check('and the settings send keeps the resolved folders',
  /let current = \(live\.screenshot_root\.clone\(\), live\.recording_root\.clone\(\), live\.replay_root\.clone\(\)\);/.test(rust));

console.log('the page shows those folders rather than making one up');

check('the desktop side can be asked for them', /fn overlay_capture_dirs\(\)/.test(lib));
check('and the command is registered', /overlay_capture_dirs,/.test(lib));
check('the page has a way to call it', /export function overlayCaptureDirs\(\)/.test(native));
check('the capture cards show what came back',
  settings.includes('overlayCaptureDirs()') && settings.includes('defaults?.[folder.kind]'));
check('the note says where they go',
  settings.includes('Screenshots go to your Pictures folder'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
