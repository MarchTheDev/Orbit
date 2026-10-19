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
  'the capture note is one compact card: a tinted icon square, a line of text, and nothing else',
  /orbit-toast-chip grid size-8 shrink-0 place-items-center rounded-xl border/.test(overlay) &&
    /orbit-toast-icon size-4/.test(overlay) &&
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
  'the icon square is tinted by the same accent as the card',
  /\.orbit-toast-chip\s*\{[^}]*var\(--toast-accent\)/s.test(css) &&
    /\.orbit-toast-card\s*\{[^}]*--toast-accent:\s*var\(--c-accent\)/s.test(css),
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
  'the library note is the same flat card, with a tinted icon square and no gradient',
  /orbit-note pointer-events-auto/.test(app) &&
    /orbit-note-icon mt-px grid size-5 shrink-0 place-items-center rounded-md/.test(app) &&
    /\.orbit-note-icon--ok/.test(css) &&
    /\.orbit-note-icon--error/.test(css) &&
    !app.includes('bg-gradient-to-br from-panel/98') &&
    !app.includes('bg-gradient-to-br from-rose-950/95'),
);

console.log('the controller picks a box before it reaches into one');
check(
  'a box gets a ring of its own, drawn outside the card',
  overlay.includes('orbit-box-focus') && /html\.orbit-pad \.orbit-box-focus\s*\{[^}]*outline: 2px solid var\(--c-accent\)/s.test(css),
);
check(
  'the ring starts on a box, and A steps inside it',
  /type PadTarget = BoxId \| 'bar';/.test(overlay) &&
    overlay.includes("type PadFocus = { level: 'box' | 'inside'; id: PadTarget } | null;") &&
    /const enterBox = \(id: PadTarget\) => \{[\s\S]*?setPad\(\{ level: 'inside', id \}\)/.test(overlay),
);
check(
  'B backs out of a box before it closes the overlay',
  /action === 'back'[\s\S]*?focus\?\.level === 'inside'[\s\S]*?leaveBox\(focus\.id\)/.test(overlay),
);
check(
  'directions pick the nearest control or box instead of walking a list',
  overlay.includes('padNearest(origin, targets.map((entry) => entry.box), direction)') &&
    overlay.includes("import { padNearest } from '../utils/gamepad';") &&
    padSource.includes('export function padNearest('),
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
  notice.includes('orbit-mark-mask.bin') && notice.includes('draw_mark(') && notice.includes('CHIP'),
);
check(
  'the card takes the colours of the player theme',
  notice.includes('pub struct Palette') &&
    settingsSource.includes('nativePalette(loadedSettings.theme)') &&
    settingsSource.includes('void overlayTheme(nativePalette(resolved.theme))'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
