/** Keep capture notices centered independently of their entrance animation. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const overlay = readFileSync(path.join(root, 'web', 'src', 'components', 'OverlayView.tsx'), 'utf8');
const app = readFileSync(path.join(root, 'web', 'src', 'App.tsx'), 'utf8');
const css = readFileSync(path.join(root, 'web', 'src', 'index.css'), 'utf8');
const notice = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'notice.rs'), 'utf8');
const settingsSource = readFileSync(path.join(root, 'web', 'src', 'hooks', 'useLibrary.ts'), 'utf8');
const padSource = readFileSync(path.join(root, 'web', 'src', 'utils', 'gamepad.ts'), 'utf8');
const confirmDialog = readFileSync(path.join(root, 'web', 'src', 'components', 'ui', 'ConfirmDialog.tsx'), 'utf8');
const overlaySource = readFileSync(path.join(root, 'web', 'src-tauri', 'src', 'overlay.rs'), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`);
  }
}

check(
  'the toast sits in a full-width, centered fixed wrapper',
  /fixed inset-x-0 top-8 z-\[100\] flex justify-center/.test(overlay),
);
const toastCss = css.slice(css.indexOf('@keyframes orbit-toast'));
check(
  'the toast animation does not apply a second horizontal centering transform',
  !/translate3d\(\s*-50%/.test(toastCss) && !/\.orbit-toast\s*\{[^}]*left:\s*50%/s.test(toastCss),
);
check('the toast styling uses Orbit theme accents', css.includes('.orbit-toast-card') && css.includes('--toast-accent: var(--c-accent)'));
check('the toast no longer draws the glowing left rail', !overlay.includes('orbit-toast-edge') && !css.includes('.orbit-toast-edge'));
check(
  'the capture note is one compact card: an icon, a line of text, and nothing else',
  /orbit-toast-icon grid size-6 shrink-0 place-items-center/.test(overlay) &&
    !overlay.includes('orbit-toast-chip') &&
    !css.includes('.orbit-toast-chip') &&
    !overlay.includes('orbit-toast-orbit') &&
    !overlay.includes('orbit-toast-indicator') &&
    !overlay.includes('orbit-toast-progress') &&
    !overlay.includes('ORBIT · '),
);
check(
  'the capture note is bounded to a small width and uses the app card radius',
  /orbit-toast-card flex max-w-\[22rem\] items-center gap-3 rounded-2xl/.test(overlay) &&
    !overlay.includes('rounded-[10px]'),
);
check(
  'the icon is the accent colour itself, with no square or border behind it',
  /\.orbit-toast-icon\s*\{[^}]*color:\s*var\(--toast-accent\)/s.test(css) &&
    /\.orbit-toast-card\s*\{[^}]*--toast-accent:\s*var\(--c-accent\)/s.test(css) &&
    !/\.orbit-toast-icon\s*\{[^}]*(background|border)/s.test(css),
);
check(
  'the capture note fades away after three and a half seconds',
  /orbit-toast 3\.6s/.test(css) && /const TOAST_MS = 3600/.test(overlay),
);
check(
  'a failed capture stays long enough to read, even with confirmations off',
  /const ERROR_TOAST_MS = 6500/.test(overlay) &&
    /kind === 'error' \? ERROR_TOAST_MS : TOAST_MS/.test(overlay) &&
    /animation-duration: 6\.5s/.test(css) &&
    /kind !== 'error' && settingsRef\.current\?\.overlay\?\.captureToast === false/.test(overlay) &&
    /flash\('Capture failed', message, 'error'\)/.test(overlay),
);
check(
  'a screenshot, a recording and a replay are the same card in the panel too',
  /\.orbit-toast-card--gallery \{\s*--toast-accent: var\(--c-accent2\);\s*\}/.test(css) &&
    !/\.orbit-toast-card--recording[^{]*\{[^}]*--c-accent2/s.test(css) &&
    !/\.orbit-toast-card--replay[^{]*\{[^}]*--c-accent2/s.test(css),
);
check(
  'the library note is the same flat card, with a bare coloured icon and no gradient',
  /orbit-note pointer-events-auto/.test(app) &&
    /orbit-note-icon mt-px grid size-5 shrink-0 place-items-center/.test(app) &&
    /\.orbit-note-icon--ok/.test(css) &&
    /\.orbit-note-icon--error/.test(css) &&
    !/\.orbit-note-icon--(ok|error)\s*\{[^}]*background/s.test(css) &&
    !app.includes('bg-gradient-to-br from-panel/98') &&
    !app.includes('bg-gradient-to-br from-rose-950/95'),
);

console.log('the controller picks a box before it reaches into one');
check(
  'a box gets a ring of its own, sitting on the card border',
  overlay.includes('orbit-box-focus') &&
    /html\.orbit-pad \.orbit-box-focus\s*\{[^}]*outline: 2px solid var\(--c-accent\)[^}]*outline-offset: 0/s.test(css),
);
check(
  'the ring round a capture button is round the icon, not the label',
  /html\.orbit-pad \[data-pad-icon\]\.orbit-pad-focus\s*\{[^}]*box-shadow: none/s.test(css) &&
    /\[data-pad-icon\]\.orbit-pad-focus \[data-pad-ring\]\s*\{[^}]*outline: 2px solid var\(--c-accent\)/s.test(css) &&
    /data-overlay\s*\n\s*data-pad-icon/s.test(overlay) &&
    /data-pad-ring/s.test(overlay),
);
check(
  'the card rises and fades instead of appearing in one frame',
  notice.includes('WS_EX_LAYERED') &&
    notice.includes('UpdateLayeredWindow') &&
    notice.includes('SourceConstantAlpha: 0') &&
    notice.includes('let entering = (opened.elapsed().as_secs_f32() / ENTER)') &&
    notice.includes('let leaving = (remaining / LEAVE)') &&
    notice.includes('point.y = top - offset'),
);
check(
  'the ring starts on a box, and A steps inside it',
  /type PadTarget = BoxId \| 'bar';/.test(overlay) &&
    overlay.includes("type PadFocus = { level: 'box' | 'inside'; id: PadTarget } | null;") &&
    /const enterBox = \(id: PadTarget\) => \{[\s\S]*?setPad\(\{ level: 'inside', id \}\)/.test(overlay),
);
check(
  'B backs out of a box, and closes the overlay while it is only hovering',
  /action === 'back'[\s\S]*?focus\?\.level === 'inside'[\s\S]*?leaveBox\(focus\.id\)/.test(overlay) &&
    /action === 'back'[\s\S]*?void overlayHide\(\);/.test(overlay) &&
    !overlay.includes('nextBox('),
);
check(
  'directions pick the nearest control or box instead of walking a list',
  overlay.includes('padNearest(origin, targets.map((entry) => entry.box), direction)') &&
    overlay.includes("import { padNearest } from '../utils/gamepad';") &&
    padSource.includes('export function padNearest('),
);
check(
  'R is the pad right click: it opens the menu on the tile under the ring',
  overlay.includes("data-capture={item.path}") &&
    /function menuButtons\(\)/.test(overlay) &&
    overlay.includes("'[role=\"menu\"] [role=\"menuitem\"]:not([disabled])'") &&
    /const openGalleryMenu = \(node: HTMLElement\): boolean => \{/.test(overlay) &&
    overlay.includes("if (action === 'menu')") &&
    overlay.includes("openGalleryMenu(active)") &&
    // The ring is put back on the tile when the menu closes.
    /const closeGalleryMenu = \(\) => \{/.test(overlay) &&
    overlay.includes('focusPad(anchor)'),
);
check(
  'the menu and the delete dialog are answerable with the pad',
  /if \(galleryMenuRef\.current\) \{/.test(overlay) &&
    overlay.includes('listStep(menuButtons()') &&
    overlay.includes('item.click();') &&
    /if \(deleteTargetRef\.current\) \{/.test(overlay) &&
    /function dialogButtons\(\)/.test(overlay) &&
    overlay.includes('button[data-overlay]') &&
    overlay.includes('<ConfirmDialog\n          pad') &&
    confirmDialog.includes('data-overlay={pad || undefined}'),
);
check(
  'the game-start toast names the overlay, not the game, and has no Alt+X line',
  overlay.includes("const READY_TITLE = 'Overlay deployed in Orbit'") &&
    overlay.includes("setToast({ title: status?.readyNotice || READY_TITLE, detail: '', kind: 'ready' })") &&
    !overlay.includes('Game started') &&
    !overlay.includes('Press Alt+X to open Orbit Overlay') &&
    overlaySource.includes('const READY_TITLE: &str = "Overlay deployed in Orbit"') &&
    overlaySource.includes('Card::ok(READY_TITLE, "", palette)') &&
    !overlaySource.includes('Card::ok(&title') &&
    !overlaySource.includes('Orbit Overlay is ready') &&
    !app.includes('Ready for captures. Press Alt+X to open it.') &&
    app.includes("announce({ text: 'Overlay deployed in Orbit' })") &&
    app.includes('overlayReadyNotice().catch(fallbackNotice)'),
);
check(
  'the pad rings a menu row and a dialog answer before it focuses them',
  /function focusPad\(next: HTMLElement\) \{\n  markPad\(next\);\n  if \(document\.activeElement !== next\) next\.focus\(\);/.test(overlay) &&
    /function listStep[\s\S]{0,400}focusPad\(next\)/.test(overlay) &&
    /function focusFirst[\s\S]{0,400}focusPad\(first\)/.test(overlay) &&
    !/first\.focus\(\);\n    markPad\(first\)/.test(overlay) &&
    css.includes('html.orbit-pad [role="menu"] button:focus-visible') &&
    css.includes('html.orbit-pad .modal-panel-enter button:focus-visible') &&
    // The ring is drawn at the control's own corner, not a curve that reshapes it.
    css.includes('html.orbit-pad [role="menu"] .orbit-pad-focus') &&
    css.includes('html.orbit-pad .modal-panel-enter .orbit-pad-focus') &&
    /html\.orbit-pad \.modal-panel-enter \.orbit-pad-focus \{\n  box-shadow: none;\n  outline: 2px solid var\(--c-accent\);\n  outline-offset: 1px;\n  border-radius: 0\.5rem;/.test(css),
);
check(
  'the panel covers the monitor the game is on, not whichever one Windows calls primary',
  overlaySource.includes('fn game_monitor(monitors: &[tauri::Monitor]) -> Option<usize>') &&
    overlaySource.includes('fn monitor_for_rect(') &&
    overlaySource.includes('fn monitor_at_cursor(') &&
    overlaySource.includes('GetForegroundWindow') &&
    overlaySource.includes('GetWindowRect') &&
    // Orbit's own window is not the game.
    overlaySource.includes('pid == std::process::id()') &&
    /fn cover_screen[\s\S]{0,900}game_monitor\(&monitors\)/.test(overlaySource) &&
    /fn cover_screen[\s\S]{0,1200}monitor_at_cursor\(window, &monitors\)/.test(overlaySource) &&
    // The primary monitor is only the last answer now.
    !/fn cover_screen[\s\S]{0,200}let monitor = window\n\s*\.primary_monitor/.test(overlaySource),
);
check(
  'Alt+X toggles the panel it opened instead of trusting the focus Windows gave it',
  /fn toggle_on_main[\s\S]{0,1400}if visible && !RESTING\.load\(Ordering::SeqCst\)/.test(overlaySource) &&
    !overlaySource.includes('let focused = window.is_focused()') &&
    // A refused set_focus is retried against the window handle directly.
    overlaySource.includes('SetForegroundWindow') &&
    /fn show_window[\s\S]{0,900}raise\(&window\)/.test(overlaySource),
);
check(
  'the panel is told it is open even when its page loads after the first event',
  /fn show_window[\s\S]{0,1600}let again = window\.clone\(\)/.test(overlaySource) &&
    overlaySource.includes('if is_open() && again.is_visible().unwrap_or(false)') &&
    overlaySource.includes('thread::sleep(Duration::from_millis(400))'),
);
check(
  'a held shortcut is one toggle, not a flicker',
  overlaySource.includes('static ASKED_AT: Mutex<Option<std::time::Instant>>') &&
    overlaySource.includes('const TOGGLE_GAP: Duration = Duration::from_millis(320)') &&
    /now\.duration_since\(at\) < TOGGLE_GAP/.test(overlaySource) &&
    /fn request_toggle[\s\S]{0,700}ASKED\.store\(true/.test(overlaySource),
);
check(
  'the pad shortcuts share the capture buttons',
  overlay.includes("if (action === 'capture-shot')") &&
    overlay.includes('captureRef.current.shot()') &&
    overlay.includes("if (action === 'capture-record')") &&
    overlay.includes("if (action === 'capture-replay')"),
);
check(
  'the right stick scrolls the box that has the focus, smoothly',
  overlay.includes("listen<[number, number]>('overlay-pad-axes'") &&
    overlay.includes('target.scrollBy({ left: across * dt, top: down * dt })') &&
    overlay.includes("root?.querySelector<HTMLElement>('[data-overlay-scroll]')"),
);
check(
  'the game-start card carries the Orbit mark, not an empty square',
  notice.includes('orbit-mark-mask.bin') && notice.includes('draw_mark(') && notice.includes('Icon::Mark'),
);
check(
  'the card draws the mark from a cropped high-resolution mask, lifted for its size',
  notice.includes('const MARK_SIZE: usize = 256;') &&
    notice.includes('const MARK_DRAW: f32 = 22.0;') &&
    notice.includes('powf(0.85)'),
);
check(
  'the card has no chip behind its icon either',
  !notice.includes('CHIP') &&
    notice.includes('const ICON_BOX: f32 = 24.0;') &&
    // `box` is a reserved word; the icon column is called a column.
    /let text_left = column_left \+ column \+ GAP \* scale/.test(notice) &&
    !/\blet box\b/.test(notice),
);
check(
  'the card takes the colours of the player theme',
  notice.includes('pub struct Palette') &&
    settingsSource.includes('nativePalette(loadedSettings.theme)') &&
    settingsSource.includes('void overlayTheme(nativePalette(resolved.theme))'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
