import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const settings = read('../src/components/SettingsView.tsx');
const library = read('../src/hooks/useLibrary.ts');
const rust = read('../../web/src-tauri/src/overlay.rs');
const gamepad = read('../../web/src-tauri/src/gamepad.rs');
const lib = read('../../web/src-tauri/src/lib.rs');

let failures = 0;
function check(name, okay, detail = '') {
  if (okay) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('Linux builds leave the in-game overlay inactive');
check('native Linux Settings replaces controls with an unavailable notice',
  settings.includes("const overlayUnavailable = native && desktopOs() === 'linux'") &&
    settings.includes('The in-game overlay is turned off on Linux for now.') &&
    /overlayUnavailable \? \([\s\S]{0,500}OverlaySettings settings=\{settings\}/.test(settings));
check('overlay-specific search controls are hidden on native Linux',
  /const searchItems = overlayUnavailable[\s\S]{0,180}item\.section !== 'orbit-overlay' \|\| item\.label === 'Overlay'/.test(settings) &&
    settings.includes('? searchItems.filter('));
check('the app does not configure, pin, or announce the overlay on Linux',
  /const overlayAvailable = !isNative\(\) \|\| desktopOs\(\) !== 'linux'/.test(app) &&
    app.includes('if (!isNative() || !overlayAvailable || !settings) return;') &&
    app.includes('void overlayConfigure({') &&
    app.includes('if (!booted || !isNative() || !overlayAvailable || !settings) return;') &&
    app.includes('void overlayShowPins()') &&
    /if \(overlayAvailable && launchedFromOrbit/.test(app));
check('theme changes do not contact the disabled Linux overlay',
  (library.match(/if \(desktopOs\(\) !== 'linux'\) void overlayTheme/g) ?? []).length === 2);
check('Linux overlay settings remain saved rather than being reset',
  settings.includes('Your existing overlay preferences are preserved'));

check('the Linux native install does not start the overlay watcher',
  /#\[cfg\(target_os = "linux"\)\]\s*pub fn install\(_app: &AppHandle\)[\s\S]{0,500}Ok\(\(\)\)\s*}\s*#\[cfg\(not\(target_os = "linux"\)\)\]\s*pub fn install/.test(rust));
check('Linux ignores overlay configuration and settings application',
  /#\[cfg\(target_os = "linux"\)\]\s*pub fn apply_settings\(_value: &Value\) \{\}/.test(rust) &&
    /#\[cfg\(target_os = "linux"\)\]\s*pub fn configure\([\s\S]{0,500}_game_only: bool,[\s\S]{0,40}\) \{\}/.test(rust));
check('a game start cannot launch Linux replay capture',
  /#\[cfg\(target_os = "linux"\)\]\s*pub fn game_started\(_title: &str\) \{\}/.test(rust));
check('the Linux overlay is not warmed or registered from controller input',
  /#\[cfg\(target_os = "linux"\)\]\s*pub fn warm\(_app: &AppHandle\) \{\}/.test(rust) &&
    /#\[cfg\(target_os = "linux"\)\]\s*pub fn on_pad\(_app: &AppHandle, _buttons: &\[bool\], _axes: &\[f32\]\) \{\}/.test(rust));
check('Start+Select passes through on Linux but remains available elsewhere',
  /#\[cfg\(target_os = "linux"\)\]\s*let combo = false;/.test(gamepad) &&
    /#\[cfg\(not\(target_os = "linux"\)\)\]\s*let combo = state\.buttons\.get\(9\)/.test(gamepad) &&
    gamepad.includes('if combo || crate::overlay::is_open() {'));
check('Linux cannot create an overlay window even if an overlay command is called',
  /#\[cfg\(target_os = "linux"\)\]\s*fn ensure_window\(_app: &AppHandle\) -> Option<tauri::WebviewWindow> \{\s*None\s*\}/.test(rust) &&
    !lib.includes('ORBIT_X11_SWITCHED'));
check('other platforms keep the existing overlay implementation',
  rust.includes('#[cfg(not(target_os = "linux"))]\npub fn install(app: &AppHandle)') &&
    rust.includes('#[cfg(not(target_os = "linux"))]\npub fn game_started(title: &str)'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
