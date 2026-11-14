/**
 * The window has to draw something.
 *
 * A `const` used before its declaration is not a type error worth trusting here:
 * TypeScript caught it on the day, but the app was still built and shipped, and
 * the only symptom was a window that opened to nothing. Two things are checked,
 * because either alone would have missed it.
 *
 * First, the real app is mounted in jsdom and the library has to render a page.
 * That runs the same modules the window runs, so a throw during the first render
 * fails here instead of being found by hand. Second, the shell is wrapped in the
 * crash screen, so even a page that throws late leaves a window with words in it
 * and a way back rather than an empty rectangle.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const entry = read('../src/main.tsx');
const crash = read('../src/components/ui/CrashScreen.tsx');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('a broken screen still shows a window');

check(
  'the root is wrapped in the crash screen, not rendered bare',
  /<CrashScreen>\s*<Root \/>\s*<\/CrashScreen>/.test(entry.replace(/\r/g, '')),
);
check(
  'the crash screen names the error and offers both ways out',
  crash.includes('getDerivedStateFromError') &&
    crash.includes('componentDidCatch') &&
    crash.includes('{error.message || String(error)}') &&
    crash.includes('Try again') &&
    crash.includes('window.location.reload()'),
);
check(
  'and it stays inside the window the app already has',
  crash.includes('min-h-screen') && !crash.includes('createPortal'),
);

// The whole app, mounted the way the window mounts it. Native calls are absent
// in jsdom, so the services fall back exactly as they do in a browser build.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const globals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  KeyboardEvent: dom.window.KeyboardEvent,
  CustomEvent: dom.window.CustomEvent,
  MouseEvent: dom.window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
// jsdom lays nothing out and brings no observers, and the library asks both for
// the size of a shelf and for its artwork. Neither is what is being checked.
dom.window.Node.prototype.attachEvent = () => {};
dom.window.Node.prototype.detachEvent = () => {};
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.Element.prototype.scrollTo = () => {};
dom.window.Element.prototype.scrollBy = () => {};
dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
dom.window.HTMLMediaElement.prototype.pause = () => {};
dom.window.matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
dom.window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
for (const raf of ['requestAnimationFrame', 'cancelAnimationFrame']) {
  const name = raf;
  dom.window[name] = name === 'requestAnimationFrame'
    ? (cb) => setTimeout(() => cb(Date.now()), 0)
    : (id) => clearTimeout(id);
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;

const out = path.join('.test-build', 'shell.mjs');
await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: out,
  // React and Tailwind's stylesheet stay outside: the bundle only has to run.
  external: ['jsdom', 'react', 'react-dom', 'react-dom/client', 'react-dom/server', 'lucide-react'],
  loader: { '.css': 'empty' },
  plugins: [
    {
      // Vite supplies the version at build time; here a fixed one is enough.
      name: 'stub-version',
      setup(plugin) {
        plugin.onResolve({ filter: /^virtual:orbit-version$/ }, () => ({ path: 'version', namespace: 'stub' }));
        plugin.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const APP_VERSION = "0.0.0-test";',
          loader: 'js',
        }));
      },
    },
  ],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'silent',
});

let thrown = null;
try {
  // React's development build reports an error boundary catching a crash, and a
  // crash that the boundary did *not* catch as an uncaught exception. Both are
  // collected rather than printed.
  const onError = (event) => {
    thrown = event.error ?? event.message;
    event.preventDefault?.();
  };
  dom.window.addEventListener('error', onError);
  await import(`${path.resolve(out)}?${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 900));
  dom.window.removeEventListener('error', onError);
} catch (error) {
  thrown = error;
}

const html = dom.window.document.body.innerHTML;
check('mounting the app does not throw', thrown === null, thrown ? String(thrown) : '');
check(
  'the library draws a page of its own',
  html.includes('orbit-library') && html.includes('orbit-topbar'),
  `${html.length} bytes drawn`,
);
check(
  'and no crash screen is showing',
  !html.includes('Something in this screen broke'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
