/** Keep capture notices centered independently of their entrance animation. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const overlay = readFileSync(path.join(root, 'web', 'src', 'components', 'OverlayView.tsx'), 'utf8');
const app = readFileSync(path.join(root, 'web', 'src', 'App.tsx'), 'utf8');
const css = readFileSync(path.join(root, 'web', 'src', 'index.css'), 'utf8');

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
  'the capture note is one compact card: small icon, a line of text, and nothing else',
  /orbit-toast-icon size-4 shrink-0/.test(overlay) &&
    !overlay.includes('orbit-toast-orbit') &&
    !overlay.includes('orbit-toast-indicator') &&
    !overlay.includes('orbit-toast-progress') &&
    !overlay.includes('ORBIT · '),
);
check(
  'the capture note is bounded to a small width',
  /orbit-toast-card flex max-w-\[21rem\] items-center gap-2\.5 rounded-\[10px\]/.test(overlay),
);
check(
  'the capture note fades away after three and a half seconds',
  /orbit-toast 3\.6s/.test(css) && /setToast\(null\), 3600\)/.test(overlay),
);
check(
  'the library note is the same flat card, not a gradient panel',
  /orbit-note pointer-events-auto/.test(app) && !app.includes('bg-gradient-to-br from-panel/98') && !app.includes('bg-gradient-to-br from-rose-950/95'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
