import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';
import { GameGrid } from '../src/components/GameGrid.tsx';
import { GameList } from '../src/components/GameList.tsx';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const game = { ...SAMPLE_GAMES[0], id: 'favorite-test', title: 'Favorite Test', favorite: true };
const root = createRoot(document.getElementById('root'));
const noop = () => {};
const props = {
  selectedId: null,
  onSelect: noop,
  onEdit: noop,
  onToggleFavorite: noop,
  onPlay: noop,
};

async function verify(component, viewName, extra) {
  await act(async () => {
    root.render(createElement(component, {
      ...props,
      games: [{ ...game, favorite: false }],
      ...extra,
    }));
  });
  const initialEmptyStar = document.querySelector(`[aria-label="Add ${game.title} to favorites"]`);
  check(`${viewName} keeps a never-favorited game's quick star available`,
    !!initialEmptyStar && !initialEmptyStar.className.includes('pointer-events-none'));

  await act(async () => {
    root.render(createElement(component, { ...props, games: [game], ...extra }));
  });
  const before = document.querySelector(`[aria-label="Remove ${game.title} from favorites"]`);
  await act(async () => {
    root.render(createElement(component, {
      ...props,
      games: [{ ...game, favorite: false }],
      ...extra,
    }));
  });
  const after = document.querySelector(`[aria-label="Add ${game.title} to favorites"]`);
  check(`${viewName} removes the empty star when a favorite prop changes to false`, !!before && !after);
}

function ClickHarness({ component: Component, extra }) {
  const [favorite, setFavorite] = useState(true);
  return createElement(Component, {
    ...props,
    games: [{ ...game, favorite }],
    onToggleFavorite: () => setFavorite((current) => !current),
    ...extra,
  });
}

async function verifyClick(component, viewName, extra) {
  await act(async () => root.render(createElement(ClickHarness, { component, extra, key: viewName })));
  const button = document.querySelector(`[aria-label="Remove ${game.title} from favorites"]`);
  await act(async () => {
    button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  const remainingEmptyStar = document.querySelector(`[aria-label="Add ${game.title} to favorites"]`);
  check(`${viewName} removes the star immediately after clicking to unfavorite`,
    !!button && !remainingEmptyStar,
    remainingEmptyStar?.parentElement?.parentElement?.outerHTML ?? 'star was removed');
}

console.log('quick favorite star dismissal');
await verify(GameGrid, 'Grid', { scale: 100, coverTint: true });
await verify(GameList, 'List', { scale: 100 });
await verifyClick(GameGrid, 'Grid', { scale: 100, coverTint: true });
await verifyClick(GameList, 'List', { scale: 100 });
await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
