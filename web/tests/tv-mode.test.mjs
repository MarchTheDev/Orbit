/**
 * TV mode: one rail of playable games, the way a console shows a library.
 *
 * Three things are checked here. What the rail is allowed to hold, because the
 * whole point of the rework is that a plan is not something you can sit down
 * and play. The order it is in, because the first game on it is the one the
 * page opens on. And the hub itself, because every control has to work with one
 * hand on a controller: an arrow key walks the rail and the page follows it,
 * Enter plays what it is on, Escape gives the screen back.
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
// jsdom lays nothing out and does not scroll, so the calls a browser makes
// while centring a cover are stubbed. Which cover ends up selected is what is
// being checked here, not where it was drawn.
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.Element.prototype.scrollTo = () => {};
dom.window.Element.prototype.scrollBy = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TvMode, backdropsFor, orderedForTv, playableGames } = await import('../src/components/TvMode.tsx');
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
const covers = () => [...document.querySelectorAll('[data-tv-cover]')];
const selected = () => document.querySelector('[data-orbit-tv] [aria-current="true"]')?.getAttribute('data-tv-cover') ?? null;
const title = () => document.querySelector('[data-orbit-tv] h1')?.textContent ?? '';
const buttonWith = (text) => [...document.querySelectorAll('[data-orbit-tv] button')].find((b) => b.textContent?.trim() === text);

console.log('only what can be played is on the rail');

const library = [
  { ...SAMPLE_GAMES[1], id: 'p1', title: 'Middle Of It', status: 'playing', lastPlayed: '2026-10-20T10:00:00.000Z' },
  { ...SAMPLE_GAMES[2], id: 'p2', title: 'Also Half Done', status: 'playing', lastPlayed: '2026-10-18T10:00:00.000Z' },
  { ...SAMPLE_GAMES[3], id: 'b', title: 'Put Down', status: 'backlog', lastPlayed: null, planned: false },
  // A plan: written down, owned or not, with nothing here to start.
  { ...SAMPLE_GAMES[0], id: 'w', title: 'Not Owned', status: 'backlog', planned: true, lastPlayed: null },
  // Owned but never installed, and never played: still a plan in Orbit's terms.
  { ...SAMPLE_GAMES[4], id: 'owned', title: 'Owned Elsewhere', status: 'backlog', planned: false, inLibrary: false, installDir: null, exePath: null, launch: { kind: 'none' }, sessionCount: 0, manualPlaySecs: 0, sizeBytes: 0, lastPlayed: null },
  { ...SAMPLE_GAMES[5], id: 'h', title: 'Hidden One', hidden: true, planned: false },
  // Added by hand by title: in the library, so it can be timed and played.
  { ...SAMPLE_GAMES[2], id: 'hand', title: 'Timed By Hand', inLibrary: true, planned: false, lastPlayed: null },
];
const shown = playableGames(library).map((game) => game.id);
check('a plan is not on the rail', !shown.includes('w'));
check('a game with nothing on the machine is not on the rail either', !shown.includes('owned'));
check('a hidden game stays hidden', !shown.includes('h'));
check('everything that can be started is', shown.join() === 'p1,p2,b,hand', shown.join());

console.log('the first game on the rail is the one you played last');

check('recently played leads, and the rest follow it',
  orderedForTv(library, 'recent').map((game) => game.id).join() === 'p1,p2,b,hand',
  orderedForTv(library, 'recent').map((game) => game.id).join());
check('A–Z is there for finding one particular game',
  orderedForTv(library, 'az').map((game) => game.title).join() ===
    'Also Half Done,Middle Of It,Put Down,Timed By Hand',
  orderedForTv(library, 'az').map((game) => game.title).join());
check('an empty library has an empty rail', orderedForTv([], 'recent').length === 0);

console.log('the picture behind the page is the sharp one');

const steamGame = {
  ...SAMPLE_GAMES[1],
  id: 'art',
  title: 'Art Test',
  meta: { ...SAMPLE_GAMES[1].meta, steamAppId: 1245620, backgroundUrl: 'https://store/background.jpg', headerUrl: 'https://store/header.jpg' },
};
const art = backdropsFor(steamGame);
check('the store’s big screen artwork is asked for first, not the header',
  art[0] === 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_hero.jpg', art[0]);
check('the library’s own pictures are the fallbacks', art.slice(1).join() === 'https://store/background.jpg,https://store/header.jpg');
check('a game from Steam by its launch target still gets it',
  backdropsFor({ ...steamGame, meta: { summary: '' }, launch: { kind: 'steam', appId: 220 } })[0].includes('/220/'));
check('a game with no store id has nothing to guess at', backdropsFor({ ...steamGame, meta: { summary: '' }, launch: { kind: 'none' } }).length === 0);

console.log('the hub: one rail, and the selected game all over the screen');

const played = [];
let stopped = 0;
let details = null;
let left = 0;
const root = createRoot(document.getElementById('root'));
/** A new mount each time, so one section's selection does not leak into the next. */
let mounts = 0;
const render = async (games, runningId = null) => {
  await act(async () => {
    root.render(
      createElement(TvMode, {
        key: ++mounts,
        games,
        runningId,
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
check('the hub fills the window rather than sitting in the page', !!document.querySelector('[data-orbit-tv]'));
check('every playable game is on one rail, and nothing else is',
  covers().length === 4, String(covers().length));
check('there are no shelves or category tabs to choose between first',
  !document.querySelector('[data-tv-shelf]') &&
    !['Up next', 'Favourites', 'Jump back in'].some((label) => document.body.textContent.includes(label)));
check('the page opens on the game you played last', title() === 'Middle Of It' && selected() === '0', `${title()} / ${selected()}`);
check('nothing labels the mode on the screen itself',
  !document.querySelector('[data-orbit-tv]')?.textContent?.includes('a controller drives'));
check('the top bar has no TV chip beside the name', !document.querySelector('[data-orbit-tv] header')?.textContent?.includes('TV'));
check('and that game has the rail’s focus', document.activeElement?.getAttribute('data-tv-cover') === '0');

await key('ArrowRight');
check('right walks the rail, and the page follows it',
  selected() === '1' && title() === 'Also Half Done', `${selected()} / ${title()}`);
await key('ArrowRight');
await key('ArrowRight');
await key('ArrowRight');
check('the rail wraps rather than stopping dead at the end', selected() === '0', String(selected()));
await key('ArrowLeft');
check('and wraps the other way', selected() === '3', String(selected()));

await key('Enter');
check('enter plays the game the hub is about', played.join() === 'hand', JSON.stringify(played));

await key('ArrowUp');
check('up reaches the buttons', document.activeElement?.getAttribute('data-tv-action') === 'play');
await key('ArrowRight');
check('right in the buttons goes to the next button, not the next game',
  document.activeElement?.getAttribute('data-tv-action') === 'details' &&
    document.activeElement?.getAttribute('data-tv-cover') === null,
  String(document.activeElement?.getAttribute('data-tv-action')));
check('and the game on screen did not change', selected() === '3', String(selected()));
await key('ArrowLeft');
check('left comes back to Play', document.activeElement?.getAttribute('data-tv-action') === 'play');
await key('ArrowDown');
check('down comes back to the rail', document.activeElement?.getAttribute('data-tv-cover') === '3');

await act(async () => {
  document.querySelector('[data-tv-cover="1"]').click();
});
check('clicking a cover selects it without playing it',
  title() === 'Also Half Done' && played.length === 1, `${title()} / ${played.length}`);

await act(async () => {
  buttonWith('Details').click();
});
check('details hands the game back to the app', details === 'p2', String(details));

// Enter belongs to a focused button when one is focused, or pressing it twice
// would both open the details and start the game behind them.
played.length = 0;
details = null;
await key('ArrowUp');
await key('ArrowRight');
await act(async () => {
  document.activeElement.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});
check('a focused button answers its own Enter/click', details === 'p2' && played.length === 0,
  `details ${details} / played ${played.length}`);

await key('Escape');
check('escape leaves TV mode', left === 1);

console.log('the rail can be read by name instead of by memory');

await render(library);
const sortButton = buttonWith('Recent');
check('the order the rail is in is on the page, and can be changed', !!sortButton);
check('the sort sits with the rail, not up in the top bar',
  sortButton.parentElement.closest('header') === null &&
    sortButton.closest('section') !== null);
await act(async () => {
  buttonWith('A–Z').click();
});
check('A–Z puts the rail in name order',
  covers().map((cover) => cover.getAttribute('title')).join() ===
    'Also Half Done,Middle Of It,Put Down,Timed By Hand',
  covers().map((cover) => cover.getAttribute('title')).join());
check('and says which order it is in', !!buttonWith('A–Z'));
check('switching order does not lose the rail', covers().length === 4);
// A long name is the one thing a rail cannot guess at: it gets two lines rather
// than an ellipsis on the first.
check('rail titles are allowed to wrap instead of being cut',
  !!document.querySelector('[data-tv-cover] span.line-clamp-2'));

console.log('a running game says so, and can be stopped from the hub');

await render(library, 'b');
const stop = document.querySelector('[data-orbit-tv] button[aria-label="Stop the session"]');
check('the game that is running is named at the top of the screen', !!stop);
await act(async () => {
  stop.click();
});
check('and stopping it is one press away', stopped === 1);

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
const before = gaveBack;
await leaveFullscreen();
check('leaving something that was never entered is not an error', gaveBack === before);

console.log('the button is in the top bar, beside the sound');

const nav = await import('../src/components/TopNav.tsx');
const source = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/components/TopNav.tsx', import.meta.url), 'utf8'),
);
check('the bar has a TV control that calls back out', typeof nav.TopNav === 'function' && source.includes('onTv'));
check('it sits beside the music control rather than at the far corner',
  source.indexOf('onClick={onTv}') < source.indexOf('<MusicButton'));

await act(async () => {
  await wait(20);
  root.unmount();
});

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
for (const [name, descriptor] of previousGlobals) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
