/** Keep capture notices centered independently of their entrance animation. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const overlay = readFileSync(path.join(root, 'web', 'src', 'components', 'OverlayView.tsx'), 'utf8');
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
  /fixed inset-x-0 top-12 z-\[100\] flex justify-center/.test(overlay),
);
const toastCss = css.slice(css.indexOf('@keyframes orbit-toast'));
check(
  'the toast animation does not apply a second horizontal centering transform',
  !/translate3d\(\s*-50%/.test(toastCss) && !/\.orbit-toast\s*\{[^}]*left:\s*50%/s.test(toastCss),
);
check('the toast styling uses Orbit theme accents', css.includes('.orbit-toast-card') && css.includes('--toast-accent: var(--c-accent)'));
check(
  'screenshot, recording, replay, and game-ready states have distinct labels',
  ['ORBIT · SCREENSHOT', 'ORBIT · RECORDING', 'ORBIT · REPLAY', 'ORBIT · READY'].every((label) => overlay.includes(label)),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
