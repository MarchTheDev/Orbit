/**
 * TV mode: the library as something to sit in front of.
 *
 * Two things are checked here. The shelves, because their order *is* the page -
 * what am I in the middle of, what did I put down, what did I mean to play - and
 * because a shelf that quietly drops a hidden game or repeats one is a shelf
 * nobody can trust. And the hub itself, because every control on it has to work
 * with one hand on a controller: an arrow key moves the highlight, Enter plays
 * what it is on, Escape leaves, and the game the page is about follows the
 * highlight without anything being clicked.
 */
import { JSDOM } from 'jsdom';
import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
dom.window.Node.prototype.attachEvent = () => {};
dom.window.Node.prototype.detachEvent = () => {};
// jsdom lays nothing out, so the two calls a browser makes while bringing a
// tile into view do not exist there. They are the only part of the hub that
// cannot be tested this way - what is tested is which tile ends up focused.
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.Element.prototype.scrollBy = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TvMode, tvShelves } = await import('../src/components/TvMode.tsx');
const { enterFullscreen, leaveFullscreen, fullscreenError } = await import('../src/services/tv.ts');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const key = async (name) => {
  await act(async () => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
  await wait(10);
};
const tiles = () => [...document.querySelectorAll('[data-tv-tile]')];
const focused = () => document.activeElement?.getAttribute('data-tv-tile') ?? null;
const heroTitle = () => document.querySelector('[data-orbit-tv] h1')?.textContent ?? '';

console.log('the shelves answer one question each');

const sample = (at) => SAMPLE_GAMES[at];
const library = [
  { ...sample(1), id: 'p1', title: 'Middle Of It', status: 'playing', favorite: false, lastPlayed: '2026-10-20T10:00:00.000Z' },
  { ...sample(2), id: 'p2', title: 'Also Half Done', status: 'playing', favorite: false, lastPlayed: '2026-10-18T10:00:00.000Z' },
  { ...sample(3), id: 'b', title: 'Put Down', status: 'backlog', favorite: false, lastPlayed: null, planned: false },
  { ...sample(0), id: 'w', title: 'Not Owned', status: 'backlog', favorite: false, planned: true, lastPlayed: null },
  { ...sample(4), id: 'f', title: 'Loved', status: 'completed', favorite: true, lastPlayed: null },
  { ...sample(5), id: 'h', title: 'Hidden One', hidden: true, favorite: false },
];
const shelves = tvShelves(library);
const ids = (name) => shelves.find((shelf) => shelf.id === name)?.games.map((game) => game.id) ?? [];
check('what is being played comes first', shelves[0]?.id === 'playing' && ids('playing').join() === 'p1,p2');
check('then what was played most recently',
  ids('recent').join() === 'p1,p2', ids('recent').join());
check('then what is waiting', ids('backlog').join() === 'b');
check('what is only planned is its own shelf, not mixed in with owned games',
  ids('wanted').join() === 'w' && !ids('backlog').includes('w'));
check('favourites are gathered', ids('favourites').join() === 'f', ids('favourites').join());
check('everything is there, by name, so a shelf can be scanned rather than read',
  ids('all').join() === 'p2,f,p1,w,b', ids('all').join());
check('a hidden game is in the library but not on the hub', ids('all').includes('h') === false);
check('an empty shelf is not drawn', tvShelves([library[2]]).every((shelf) => shelf.games.length > 0));

console.log('the hub: a shelf of pictures, and one game held out');

const played = [];
let stopped = 0;
let details = null;
let left = 0;
const root = createRoot(document.getElementById('root'));
const render = async (games) => {
  await act(async () => {
    root.render(
      createElement(TvMode, {
        games,
        runningId: null,
        sound: undefined,
        setSound: () => {},
        showMusic: false,
        showBars: false,
        onPlay: (game) => played.push(game.id),
        onStop: () => {
          stopped += 1;
        },
        onDetails: (game) => {
          details = game.id;
        },
        onExit: () => {
          left += 1;
        },
        onOpenSettings: () => {},
      }),
    );
  });
  await act(async () => wait(40));
};

await render(library);
check('it fills the window rather than sitting in the page', !!document.querySelector('[data-orbit-tv]'));
check('the shelves are drawn', document.querySelectorAll('[data-tv-shelf]').length === shelves.length);
check('the first tile is where a couch starts', focused() === '0:0', String(focused()));
check('the page is about that game', heroTitle() === 'Middle Of It', heroTitle());

await key('ArrowRight');
check('right moves along the shelf, and takes the page with it',
  focused() === '0:1' && heroTitle() === 'Also Half Done', `${focused()} / ${heroTitle()}`);
await key('ArrowDown');
check('down moves to the next shelf', focused()?.startsWith('1:') === true, String(focused()));
await key('ArrowUp');
check('up goes back', focused()?.startsWith('0:') === true, String(focused()));

// Play is the console's one button: Enter on the highlighted game.
await key('Enter');
check('enter plays the game the hub is about', played.length === 1, JSON.stringify(played));
await key('Escape');
check('escape leaves TV mode', left === 1);

await act(async () => {
  document.querySelector('[data-tv-tile="0:1"]').click();
});
check('clicking a tile shows it without playing it', played.length === 1 && heroTitle() === 'Also Half Done', heroTitle());

const detailButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Details'));
await act(async () => {
  detailButton.click();
});
check('details hands the game back to the app', details !== null);

// A game nobody owns has nothing to start, so the hub does not offer to.
const plannedOnly = [library[3]];
await render(plannedOnly);
const playButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play');
check('a planned game is shown, with Play clearly not on offer',
  !!playButton && playButton.disabled === true);
check('and it says why', !!document.querySelector('[data-orbit-tv]')?.textContent?.includes('not owned yet'));

console.log('leaving fullscreen gives the window back');

let asked = 0;
let gaveBack = 0;
dom.window.document.documentElement.requestFullscreen = async () => {
  asked += 1;
};
dom.window.document.exitFullscreen = async () => {
  gaveBack += 1;
};
check('the whole screen is asked for', (await enterFullscreen()) === true && asked === 1);
await leaveFullscreen();
check('and given back on the way out', gaveBack === 1);
dom.window.document.documentElement.requestFullscreen = async () => {
  throw new Error('denied');
};
check('a browser that refuses leaves nothing broken',
  (await enterFullscreen()) === false && fullscreenError() === 'denied');
// Nothing was entered, so nothing should be exited.
const before = gaveBack;
await leaveFullscreen();
check('leaving something that was never entered is not an error', gaveBack === before);

root.unmount();

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
for (const [name, descriptor] of previousGlobals) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
