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
check('the keyboard combinations are registered with the system',
  rust.includes('global_shortcut().on_shortcut(') && rust.includes('fn install_keys'));
check('a combination turned off is not registered at all',
  /filter\(\|\(_, key\)\| !key\.is_empty\(\)\)/.test(rust));
check('and re-registered when the settings change',
  /if let Some\(app\) = app \{\s*install_keys\(app\);/.test(rust));
check('a shortcut pressed with no panel asks the library window to take it',
  rust.includes('pub const HOTKEY_EVENT: &str = "overlay-hotkey"') &&
    rust.includes('fn request_capture('));
check('the pad can take a capture with the panel closed',
  /if !is_open\(\) \{[\s\S]{0,160}request_capture\(capture\)/.test(rust));
check('the page listens for that, and runs the same captures the panel does',
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').includes("listen<string>('overlay-hotkey'"));
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
