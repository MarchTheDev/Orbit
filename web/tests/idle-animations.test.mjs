/**
 * The decorative loops, and when they have to stop.
 *
 * The mark, the stars and the now-playing dot are infinite transforms. Left
 * running they ask the webview to keep producing frames even while a game has
 * the window, which is the CPU and GPU a player was losing. The music bars
 * already pause themselves. These three have to be paused from the shell,
 * because nothing else owns them.
 *
 * What is checked is the wiring, read from the files that contain it. A render
 * of App would need the whole native layer, and would still not prove the CSS
 * rule is the one that wins.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('decorative loops while a game has the window');

const css = read('web', 'src', 'index.css');
const idle = css.match(
  /\.orbit-idle \.orbit-spin-outer,[\s\S]*?\.orbit-idle \.orbit-pulse\s*\{[^}]*\}/,
);

check('one rule covers the four loops', idle !== null);
check(
  'the pause is a hard stop',
  !!idle && /animation:\s*none !important/.test(idle[0]),
  idle ? idle[0] : 'rule not found',
);
for (const selector of ['.orbit-spin-outer', '.orbit-spin-inner', '.orbit-twinkle', '.orbit-pulse']) {
  check(`it stops ${selector}`, !!idle && idle[0].includes(`.orbit-idle ${selector}`));
}

const app = read('web', 'src', 'App.tsx');
check(
  'the shell is idle when the window is not in front',
  /\$\{focused \? '' : ' orbit-idle'\}/.test(app),
);
check(
  'hidden counts as idle, not only blurred',
  /setFocused\(document\.hasFocus\(\) && !document\.hidden\)/.test(app),
);
check('focus brings the loops back', /addEventListener\('focus'/.test(app));
check('blur takes them away', /addEventListener\('blur'/.test(app));
check('a hidden window counts too', /addEventListener\('visibilitychange'/.test(app));
check('the listeners are removed', /removeEventListener\('blur'/.test(app) && /removeEventListener\('visibilitychange'/.test(app));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
