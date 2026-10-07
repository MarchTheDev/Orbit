import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useSession } from '../src/hooks/useSession.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

const scheduled = new Map();
const fakeHandles = new Set();
let nextHandle = 1;
const realSetTimeout = dom.window.setTimeout.bind(dom.window);
const realClearTimeout = dom.window.clearTimeout.bind(dom.window);
dom.window.setTimeout = (callback, delay, ...args) => {
  if (delay === 10_000) {
    const handle = nextHandle++;
    scheduled.set(handle, () => callback(...args));
    fakeHandles.add(handle);
    return handle;
  }
  return realSetTimeout(callback, delay, ...args);
};
dom.window.clearTimeout = (handle) => {
  if (fakeHandles.delete(handle)) {
    scheduled.delete(handle);
    return;
  }
  realClearTimeout(handle);
};

dom.window.__TAURI__ = {
  core: {
    invoke: async (command) => {
      if (command === 'active_session') return null;
      if (command === 'start_session') throw new Error('C:\\Games\\Missing\\game.exe is not there any more.');
      return undefined;
    },
  },
};

let play;
function Harness() {
  const session = useSession(() => {});
  play = session.play;
  return createElement('p', { 'data-testid': 'error' }, session.error ?? '');
}

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('launch errors dismiss themselves');
const root = createRoot(document.getElementById('root'));
await act(async () => root.render(createElement(Harness)));
await act(async () => play('missing-game'));
const error = document.querySelector('[data-testid="error"]');
check('shows the missing-game error after launch fails', error?.textContent?.includes('is not there any more.'));
check('schedules the error to disappear after ten seconds', scheduled.size === 1);
const [handle, dismiss] = scheduled.entries().next().value ?? [];
if (handle !== undefined) {
  scheduled.delete(handle);
  await act(async () => dismiss());
}
check('removes the error after the timeout fires', document.querySelector('[data-testid="error"]')?.textContent === '');

await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
