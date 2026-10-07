import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';
import { StorageView } from '../src/components/StorageView.tsx';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

const calls = [];
dom.window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'list_drives') return [];
      if (command === 'cached_sizes') return {};
      if (command === 'disk_space') return null;
      return undefined;
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

console.log('open a game folder from Storage');
const game = {
  ...SAMPLE_GAMES[0],
  installDir: 'D:\\Games\\Example',
  drive: 'D:',
};
const root = createRoot(document.getElementById('root'));
await act(async () => {
  root.render(createElement(StorageView, {
    games: [game],
    folders: [],
    setFolders: () => {},
    onMove: () => {},
    onImport: () => {},
  }));
});
const openControl = document.querySelector(`[aria-label="Open ${game.title} folder in the file manager"]`);
await act(async () => {
  openControl?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});
check('clicking the game in Storage opens its install folder',
  calls.some(({ command, args }) => command === 'open_game_folder' && args.path === game.installDir));
check('this Storage action opens the folder instead of selecting it in Explorer',
  !calls.some(({ command }) => command === 'reveal_in_explorer'));

await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
