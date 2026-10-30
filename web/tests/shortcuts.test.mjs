/**
 * The capture shortcuts: what the settings page draws, what the pad reads, and
 * what the keyboard registers.
 *
 * The page and the desktop side have to agree about three things - which button
 * completes a chord, which combination is registered, and what a missing value
 * means - so the shape is checked on both sides here. The Rust half cannot be
 * compiled in this checkout, so it is read rather than run.
 */
import { readFileSync } from 'node:fs';
import {
  CAPTURE_ACTIONS,
  DEFAULT_SHORTCUTS,
  PAD_BUTTONS,
  keyLabel,
  normalizeShortcuts,
  padButtonName,
  padChordLabel,
  shortcutForRegistration,
  shortcutFromEvent,
} from '../src/utils/shortcuts.ts';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('the shipped shortcuts are the ones the overlay always had');

check('three actions, in the order they are listed',
  CAPTURE_ACTIONS.map((action) => action.id).join() === 'shot,record,replay');
check('a controller takes a picture with LB and RB',
  DEFAULT_SHORTCUTS.pad.shot.hold === 4 && DEFAULT_SHORTCUTS.pad.shot.button === 5);
check('records with LB and left, replays with LB and right',
  DEFAULT_SHORTCUTS.pad.record.button === 14 && DEFAULT_SHORTCUTS.pad.replay.button === 15);
check('a keyboard uses keys a game is unlikely to want',
  DEFAULT_SHORTCUTS.keys.shot === 'F12' &&
    DEFAULT_SHORTCUTS.keys.record === 'Ctrl+F11' &&
    DEFAULT_SHORTCUTS.keys.replay === 'Ctrl+F10');

console.log('a shortcut is written the way a game writes one');

check('a chord reads as the two presses it is',
  padChordLabel({ hold: 4, button: 5 }) === 'LB + RB', padChordLabel({ hold: 4, button: 5 }));
check('a single button has no plus in it',
  padChordLabel({ hold: null, button: 0 }) === 'A', padChordLabel({ hold: null, button: 0 }));
check('an empty one says so rather than showing nothing',
  padChordLabel(undefined) === 'Not set' && keyLabel('') === 'Not set');
check('every button the pad can be given has a name',
  PAD_BUTTONS.every((button) => padButtonName(button.index) === button.label));
check('a button nobody has heard of is still readable',
  padButtonName(11) === 'Button 11');

console.log('a settings file that is old or edited by hand still works');

const half = normalizeShortcuts({ pad: { shot: { hold: null, button: 3 } }, keys: { replay: ' Ctrl+r ' } });
// Hand-written combinations are tidied into the form the system parses on the
// way in, so a file edited in a text editor can never register a shortcut that
// differs from the one it shows.
check('the values that are there are kept, written the way the system parses them',
  half.pad.shot.button === 3 && half.pad.shot.hold === null && half.keys.replay === 'Ctrl+KeyR',
  half.keys.replay);
check('the ones that are missing fall back to the shipped shortcut',
  half.pad.record.button === DEFAULT_SHORTCUTS.pad.record.button &&
    half.pad.replay.button === DEFAULT_SHORTCUTS.pad.replay.button &&
    half.keys.shot === DEFAULT_SHORTCUTS.keys.shot);
check('nothing at all is the shipped shortcuts',
  JSON.stringify(normalizeShortcuts(undefined)) === JSON.stringify(normalizeShortcuts(DEFAULT_SHORTCUTS)));
check('a button this pad does not have is not a chord',
  normalizeShortcuts({ pad: { shot: { hold: 4, button: 99 } } }).pad.shot.button === 5);
check('and a chord whose two halves are the same button is one press',
  normalizeShortcuts({ pad: { shot: { hold: 5, button: 5 } } }).pad.shot.hold === null);
check('spaces where a combination should be count as none',
  normalizeShortcuts({ keys: { shot: '   ' } }).keys.shot === '');

console.log('a recorded key press becomes a combination');

check('a plain key is its own name', shortcutFromEvent({ key: 'F12' }) === 'F12');
check('a letter is stored as its key and drawn as its letter',
  shortcutFromEvent({ key: 's', ctrlKey: true }) === 'Ctrl+KeyS' &&
    keyLabel('Ctrl+KeyS') === 'Ctrl + S',
  `${shortcutFromEvent({ key: 's', ctrlKey: true })} / ${keyLabel('Ctrl+KeyS')}`);
check('the order is always the same',
  shortcutFromEvent({ key: 'k', shiftKey: true, altKey: true, ctrlKey: true }) === 'Ctrl+Alt+Shift+KeyK',
  shortcutFromEvent({ key: 'k', shiftKey: true, altKey: true, ctrlKey: true }));
check('a number key is a digit a player recognises',
  shortcutFromEvent({ key: '7', ctrlKey: true }) === 'Ctrl+Digit7' &&
    keyLabel('Ctrl+Digit7') === 'Ctrl + 7');
check('the shipped keys are drawn without changes',
  keyLabel('F12') === 'F12' && keyLabel('Ctrl+F11') === 'Ctrl + F11');
check('a modifier on its own is not a shortcut',
  shortcutFromEvent({ key: 'Control', ctrlKey: true }) === null &&
    shortcutFromEvent({ key: 'Shift', shiftKey: true }) === null);
check('a key whose name is a plus is refused, not mangled',
  shortcutFromEvent({ key: '+', code: 'NumpadAdd', ctrlKey: true }) === null &&
    shortcutFromEvent({ key: '+', code: 'Equal', shiftKey: true }) === 'Shift+Equal');
check('a dead key is not a shortcut either',
  shortcutFromEvent({ key: 'Dead' }) === null && shortcutFromEvent({ key: 'Unidentified' }) === null);

console.log('the same combination is registered the way the system expects');

check('a letter becomes a key code',
  shortcutForRegistration('Ctrl+S') === 'Ctrl+KeyS', shortcutForRegistration('Ctrl+S'));
check('a function key is left alone', shortcutForRegistration('F12') === 'F12');
check('the modifier order is kept',
  shortcutForRegistration('Ctrl+Alt+Shift+K') === 'Ctrl+Alt+Shift+KeyK');
check('the keys with names of their own are translated',
  shortcutForRegistration('Ctrl+Space') === 'Ctrl+Space' &&
    shortcutForRegistration('Alt+Tab') === 'Alt+Tab' &&
    shortcutForRegistration('Ctrl+Up') === 'Ctrl+ArrowUp');
check('nothing is registered for nothing', shortcutForRegistration('') === '');
check('a combination the player cleared stays cleared',
  normalizeShortcuts({ keys: { shot: '' } }).keys.shot === '' &&
    normalizeShortcuts({ keys: { shot: '' } }).keys.record === 'Ctrl+F11');
check('a key nobody set is not drawn as a key',
  keyLabel('') === 'Not set');

console.log('the desktop side reads the same shape');

const rust = readFileSync(new URL('../src-tauri/src/overlay.rs', import.meta.url), 'utf8');
const settingsUi = readFileSync(new URL('../src/components/ShortcutEditor.tsx', import.meta.url), 'utf8');
const settingsView = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
check('the pad chords come from the settings, not from constants in the pad loop',
  rust.includes('let shortcuts = lock().shortcuts.clone();') &&
    rust.includes('take_step(&mut watch, buttons, axes, &shortcuts)'));
check('and the shipped ones are the same three the page draws',
  rust.includes('Chord::new(Some(4), 5)') &&
    rust.includes('Chord::new(Some(4), 14)') &&
    rust.includes('Chord::new(Some(4), 15)'));
check('a chord fires on the edge of the whole chord, not once per poll',
  /fn fired\(&self, buttons: &\[bool\], prev: &\[bool\]\) -> bool \{[\s\S]{0,120}all_down\(buttons\) && !self\.all_down\(prev\)/.test(rust));
check('the keyboard is read on Windows, where a registered hotkey can be refused',
  // RegisterHotKey gives a combination to one program. The ones a screenshot
  // shortcut wants are the ones every launcher and chat app already holds, so
  // the registration failed or was refused and the key did nothing at all.
  rust.includes('fn watch_keys(') &&
    rust.includes('GetAsyncKeyState') &&
    rust.includes('fn parse_key_chord(') &&
    /#\[cfg\(windows\)\]\s*\{?[\s\S]{0,400}install_registered_keys/.test(rust));
check('and the other desktops still register it with the system',
  rust.includes('global_shortcut().on_shortcut(') &&
    rust.includes('fn install_keys') &&
    rust.includes('#[cfg(not(windows))]\nfn install_registered_keys'));
check('a key name is read the way the settings page writes one',
  rust.includes('0x70 + number - 1') && rust.includes('strip_prefix("KEY")'));
check('a combination turned off is not registered at all',
  /filter\(\|\(_, key\)\| !key\.is_empty\(\)\)/.test(rust));
check('and re-registered when the settings change',
  /if let Some\(app\) = app \{\s*install_keys\(app\);/.test(rust));
check('a shortcut pressed with a game in front is taken on the desktop side',
  // The library window is minimised while a game runs, and a minimised web
  // view is exactly the thing that does not run - so the capture must not be
  // handed to it.
  rust.includes('fn capture_from_shortcut(') &&
    /Capture::Shot => \("screenshot", shot\(app, &stamp\)\)/.test(rust) &&
    !rust.includes('overlay-hotkey'));
check('the pad can take a capture with the panel closed',
  /if !is_open\(\) \{[\s\S]{0,160}capture_from_shortcut\(app, capture\)/.test(rust));
check('the file is named in the player\'s own time, told once by the page',
  rust.includes('pub fn set_clock_offset(') &&
    rust.includes('fn stamp_now()') &&
    readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').includes('setClockOffset(new Date().getTimezoneOffset())'));
check('a panel on screen draws that toast itself, and refreshes its gallery',
  rust.includes('pub const CAPTURED_EVENT: &str = "overlay-captured"') &&
    readFileSync(new URL('../src/components/OverlayView.tsx', import.meta.url), 'utf8').includes("'overlay-captured'"));
check('a click on empty glass reaches the game without putting the panel away',
  !readFileSync(new URL('../src/components/OverlayView.tsx', import.meta.url), 'utf8').includes(
    "overlayHide('a click on an empty spot')",
  ) &&
    // The same hit-test protects interactive boxes in the open and resting
    // states; a press beginning in a box remains captured until release.
    /let ignore = !HOLD\.load\(Ordering::SeqCst\) && !cursor_over_hits\(&window\);/.test(rust) &&
    /fn cursor_over_hits[\s\S]{0,250}let x = cursor\.x;[\s\S]{0,60}let y = cursor\.y;/.test(rust) &&
    !/fn cursor_over_hits[\s\S]{0,350}outer_position\(\)/.test(rust));
check('the overlay-opening keyboard shortcut is configurable without changing Start + Select',
  settingsView.includes("openShortcut={overlay?.openShortcut ?? 'Alt+X'}") &&
    settingsView.includes('onOpenShortcutChange={(openShortcut) => setOverlay({ openShortcut })}') &&
    settingsUi.includes('Start + Select remains the controller chord') &&
    rust.includes('live.open_shortcut.as_deref().unwrap_or("Alt+X").trim().to_string()') &&
    rust.includes('ShortcutState::Released => shortcut_released()') &&
    /let \(wanted, wanted_toggle\): \(\[String; 3\], String\)/.test(rust) &&
    rust.includes('if now && !toggle_down') &&
    rust.includes('else if !now && toggle_down') &&
    rust.includes('parse_key_chord(&wanted_toggle)'));
check('the settings page shows both a controller and a keyboard column',
  settingsUi.includes('Controller') && settingsUi.includes('Keyboard'));
check('what is saved is the shape the page and the desktop side share',
  types.includes('export interface PadChord') && types.includes('shortcuts?: OverlayShortcuts;'));

console.log('a portable copy keeps everything beside the program');

const storage = readFileSync(new URL('../src-tauri/src/storage.rs', import.meta.url), 'utf8');
const release = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
check('portable is decided by a marker beside the program, not by its name',
  storage.includes('orbit.portable') && storage.includes('fn portable'));
check('and its files go in a data folder next to it',
  storage.includes('dir.join("data")') && storage.includes('pub fn root'));
check('a folder that cannot be written to falls back to the usual one',
  storage.includes('app_data_dir()'));
check('the captures go there too', storage.includes('pub fn portable_capture_root'));
check('the library, the database and the settings all use that one root',
  readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8').includes('storage::root(app.handle())'));
check('both portable archives ship the marker',
  release.includes('$portable/orbit.portable') && release.includes('"$portable/orbit.portable"'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
