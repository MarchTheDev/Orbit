/**
 * The move, kept out of the dialog that starts it.
 *
 * What this pins down is the part that is easy to get wrong and invisible in a
 * screenshot: that a copy carries on when nothing is mounted to watch it, that
 * the numbers only ever go forwards, and that a folder Orbit cannot measure
 * stays "unknown" instead of quietly becoming zero per cent.
 */
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';
import { useGameMove } from '../src/hooks/useGameMove.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

// The move itself is held open here, so a test can report progress into it and
// decide when and how it ends - which is the only way to look at the middle of
// a copy rather than only its two ends.
let onProgressEvent = null;
let settleMove = null;
let moveCalls = [];

dom.window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
      if (command !== 'move_game') return undefined;
      moveCalls.push(args);
      return new Promise((resolve, reject) => {
        settleMove = { resolve, reject };
      });
    },
  },
  event: {
    listen: async (name, handler) => {
      if (name === 'move-progress') onProgressEvent = handler;
      return () => {
        onProgressEvent = null;
      };
    },
  },
};

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

/** The hook, mounted, with everything it answers kept where a test can read it. */
let hook = null;
let applied = [];
function Harness() {
  hook = useGameMove((gameId, paths) => applied.push({ gameId, paths }));
  return null;
}

const game = {
  ...SAMPLE_GAMES[0],
  id: 'game-1',
  title: 'Hades',
  installDir: 'C:\\Games\\Hades',
  exePath: 'C:\\Games\\Hades\\Hades.exe',
  drive: 'C:',
};
const folders = ['C:\\Games', 'E:\\Library'];

const container = dom.window.document.getElementById('root');
const root = createRoot(container);

console.log('a move that outlives its dialog');
await act(async () => {
  root.render(createElement(Harness));
});
check('nothing is moving to start with', hook.job === null);
check('and nothing is reported as running', hook.running === false);

await act(async () => {
  void hook.start(game, 'E:\\Library', folders);
});
check('starting a move puts one on the board', hook.job?.state === 'running', JSON.stringify(hook.job));
check('it is running', hook.running === true);
check('for the game that was asked for', hook.job?.gameId === 'game-1');
check('with no number yet, rather than a false zero', hook.job?.progress === null, `got ${hook.job?.progress}`);
check(
  'and the native side was told where from and where to',
  moveCalls.length === 1 &&
    moveCalls[0].installDir === 'C:\\Games\\Hades' &&
    moveCalls[0].toFolder === 'E:\\Library',
  JSON.stringify(moveCalls[0]),
);

console.log('\nthe numbers');
const report = (copied, total) =>
  act(async () => {
    onProgressEvent?.({ payload: { copied, total } });
  });

await report(250, 1000);
check('a quarter of the way along reads as a quarter', hook.job?.progress === 0.25, `got ${hook.job?.progress}`);
await report(500, 1000);
check('and half reads as half', hook.job?.progress === 0.5);
await report(300, 1000);
check('an out-of-order report cannot pull the ring backwards', hook.job?.progress === 0.5, `got ${hook.job?.progress}`);
await report(2000, 1000);
check('nor can one past the end go beyond it', hook.job?.progress === 1, `got ${hook.job?.progress}`);
await report(0, 0);
check('a folder that cannot be measured goes back to unknown, not to zero', hook.job?.progress === null);
await report(750, 1000);
check('and a real number afterwards is believed again', hook.job?.progress === 0.75, `got ${hook.job?.progress}`);

console.log('\nputting it away while it runs');
await act(async () => {
  hook.dismiss();
});
check('a running move is not something dismiss can lose', hook.job !== null && hook.job.state === 'running');

console.log('\nfinishing');
await act(async () => {
  settleMove.resolve({
    // `toDir` is the destination game folder, not the library folder above it,
    // which is what makes the paths inside the game land in the right place.
    installDir: 'E:\\Library\\Hades',
    fromDir: 'C:\\Games\\Hades',
    toDir: 'E:\\Library\\Hades',
    message: null,
  });
});
check('the move is done', hook.job?.state === 'done', JSON.stringify(hook.job));
check('the ring is full', hook.job?.progress === 1);
check('and it says where the game ended up', hook.job?.dir === 'E:\\Library\\Hades');
check('it is no longer running', hook.running === false);
check(
  'the library was told about every path that moved with it',
  applied.length === 1 && applied[0].gameId === 'game-1' && applied[0].paths.installDir === 'E:\\Library\\Hades',
  JSON.stringify(applied[0]),
);
check(
  'including the program that starts it',
  applied[0]?.paths.exePath === 'E:\\Library\\Hades\\Hades.exe',
  applied[0]?.paths.exePath,
);

await act(async () => {
  hook.dismiss();
});
check('a finished move can be put away', hook.job === null);

console.log('\nfailing');
await act(async () => {
  void hook.start(game, 'E:\\Library', folders);
});
await report(100, 1000);
await act(async () => {
  settleMove.reject(new Error('E:\\Library is not there any more.'));
});
check('a move that fails says so', hook.job?.state === 'error', JSON.stringify(hook.job));
check('with the reason', hook.job?.error === 'E:\\Library is not there any more.', hook.job?.error);
check('the library was not told about a move that did not happen', applied.length === 1, `applied ${applied.length}`);
await act(async () => {
  hook.dismiss();
});
check('and it can be put away too', hook.job === null);

await act(async () => {
  root.unmount();
});
for (const name of globalNames) {
  const previous = previousGlobals.get(name);
  if (previous) Object.defineProperty(globalThis, name, previous);
  else delete globalThis[name];
}

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
