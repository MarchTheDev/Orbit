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
import { readFileSync } from 'node:fs';

const tvSource = readFileSync(new URL('../src/components/TvMode.tsx', import.meta.url), 'utf8');
const coverSource = readFileSync(new URL('../src/components/ui/Cover.tsx', import.meta.url), 'utf8');
const tvCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'KeyboardEvent', 'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
// The pad sends the arrow keys a keyboard would, and that code runs outside the
// jsdom window, so the constructors it needs are placed on the bundle's global.
Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent });
Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: dom.window.CustomEvent });
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
const render = async (games, runningId = null, extra = {}) => {
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
        ...extra,
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
check('the keys are not spelled out along the bottom any more',
  !document.querySelector('[data-orbit-tv] footer'));
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
await key('ArrowUp');
check('up from the buttons reaches the top bar, where the way out is',
  document.activeElement?.closest('[data-tv-topbar]') !== null);
check('and there is a button there that leaves TV mode',
  [...document.querySelectorAll('[data-tv-topbar] button')].some(
    (button) => button.getAttribute('aria-label') === 'Leave TV mode',
  ));
await key('ArrowRight');
check('right in the bar stays in the bar instead of walking the rail',
  document.activeElement?.closest('[data-tv-topbar]') !== null && selected() === '3');
await key('ArrowDown');
check('down out of the bar lands on the game\'s buttons',
  document.activeElement?.getAttribute('data-tv-action') === 'play');
await key('ArrowDown');
check('and down again comes back to the rail',
  document.activeElement?.getAttribute('data-tv-cover') === '3');

await act(async () => {
  document.querySelector('[data-tv-cover="1"]').click();
});
check('clicking a cover selects it without playing it',
  title() === 'Also Half Done' && played.length === 1, `${title()} / ${played.length}`);

// Enter belongs to a focused button when one is focused, or pressing it twice
// would both open the details and start the game behind it.
played.length = 0;
await key('ArrowUp');
await key('ArrowRight');
await key('Enter');
check('enter on a focused button is that button\'s own press',
  played.length === 0 && !document.querySelector('[data-tv-cover]'),
  `played ${played.length}`);

console.log('details is a page of the hub, not a way out of it');

check('Details shows the game in TV mode rather than leaving it',
  details === 'p2' && !document.querySelector('[data-tv-cover]'),
  `${details} / rail ${!!document.querySelector('[data-tv-cover]')}`);
const page = document.querySelector('[data-orbit-tv]');
check('the game\'s own page is on screen, at TV size',
  page.textContent.includes('Back to the rail') && !!page.querySelector('h1'));
check('it says what has been played of it',
  page.textContent.includes('played') || !!page.querySelector('h1'));
check('and how long the main story takes', page.textContent.toLowerCase().includes('main story'));
check('a pad or a keyboard lands on Back first', document.activeElement?.getAttribute('data-tv-action') === 'back');

// The page sits over the game's artwork, so its cards have to hold their own
// against whatever the picture is doing behind them.
const detailsSource = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/components/TvDetails.tsx', import.meta.url), 'utf8'),
);
check('the cards on a game\'s page are solid enough to read over artwork',
  !detailsSource.includes('bg-white/[0.0') && detailsSource.includes('bg-[#0d0b18]/85'));

await key('ArrowRight');
check('right moves between the page\'s own buttons', document.activeElement?.getAttribute('data-tv-action') === 'play');
await key('ArrowLeft');
check('and left comes back', document.activeElement?.getAttribute('data-tv-action') === 'back');

await key('Escape');
check('escape on a game\'s page goes back to the rail rather than out of TV mode',
  !!document.querySelector('[data-tv-cover]') && left === 0,
  `rail ${!!document.querySelector('[data-tv-cover]')} / left ${left}`);
check('and the rail is still on the game that was being read', selected() === '1', String(selected()));

await key('Escape');
check('escape leaves TV mode immediately without a closing animation',
  left === 1 && !document.querySelector('.tv-shutdown'),
  `left ${left} / shutdown ${!!document.querySelector('.tv-shutdown')}`);

console.log('a controller drives the same hub');

await render(library);
const pad = (name, detail) => {
  act(() => {
    window.dispatchEvent(new dom.window.CustomEvent(name, { detail }));
  });
};
played.length = 0;
await key('ArrowRight');
act(() => {
  window.dispatchEvent(new dom.window.CustomEvent('orbit-pad-play'));
});
check('Start on the controller plays the game the hub is about',
  played.join() === 'p2', JSON.stringify(played));

pad('orbit-pad-back');
await act(async () => wait(320));
check('Back on the controller leaves TV mode from the rail', left === 2, String(left));

// From a game's page the same press steps back to the rail, not out of the mode.
await render(library);
await act(async () => {
  buttonWith('Details').click();
});
pad('orbit-pad-back');
await act(async () => wait(20));
check('Back on a game\'s page returns to the rail', !!document.querySelector('[data-tv-cover]') && left === 2);

console.log('TV mode opens without entrance choreography');

await render(library);
check('it opens directly on the library without a boot veil',
  !document.querySelector('.tv-boot') && covers().length === 4 &&
    document.activeElement?.getAttribute('data-tv-cover') === '0');
check('the backdrop does not scale or transition when the selected game changes',
  !tvSource.includes('scale-[1.02]') && !tvSource.includes('scale-[1.06]') &&
    !tvSource.includes('duration-700'));
check('TV artwork keeps a stable fit and warms nearby images before selection changes',
  !tvSource.includes('key={src}') && !tvSource.includes('key={`soft-${game.id}`}') &&
    /fit="cover"[\s\S]{0,180}loading="eager"/.test(tvSource) &&
    tvSource.includes('warmCover(game)') && tvSource.includes('warmImage(first)') &&
    coverSource.includes('const current = failures.identity === identity'));
check('TV covers cannot be dragged and keep one crop while images load',
  tvSource.includes('draggable={false}') &&
    tvSource.includes('onDragStart={(event) => event.preventDefault()}') &&
    tvSource.includes('fit="cover"'));
check('TV mode has no entrance, exit, or child transitions',
  !tvCss.includes('@keyframes tv-in') && !tvCss.includes('@keyframes tv-out') &&
    /\.tv-root,\s*\n\.tv-root \*/.test(tvCss) &&
    /animation: none !important;[\s\S]*?transition: none !important;/.test(tvCss));

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
  covers().map((cover) => cover.getAttribute('aria-label')).join() ===
    'Also Half Done,Middle Of It,Put Down,Timed By Hand',
  covers().map((cover) => cover.getAttribute('aria-label')).join());
check('and says which order it is in', !!buttonWith('A–Z'));
check('switching order does not lose the rail', covers().length === 4);
// A long name is the one thing a rail cannot guess at: it gets two lines rather
// than an ellipsis on the first.
check('rail titles are allowed to wrap instead of being cut',
  !!document.querySelector('[data-tv-cover] span.line-clamp-2'));
check('the rail carries no title attribute, so no badge appears over a name',
  document.querySelectorAll('[data-tv-cover][title]').length === 0);
// The ring is drawn on the artwork, in the theme's own accent, for hover and
// selection alike - and never around the name underneath.
const css = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'),
);
const rule = (selector) => {
  const at = css.indexOf(selector);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};
const hoverRule = rule('.tv-cover:hover > span:first-child');
const selectedRule = rule(".tv-cover[aria-current='true'] > span:first-child");
check('hovering a cover speaks the theme accent', hoverRule.includes('var(--c-accent)'), hoverRule);
check('and selecting one speaks the same accent', selectedRule.includes('var(--c-accent)'), selectedRule);
check('the accent is the theme variable, not a colour of its own',
  !rule('.tv-cover').includes('139,92,246'));
const coverFocusRule = /html\.orbit-pad \.tv-root \.tv-cover\.orbit-pad-focus,\s*\nhtml\.orbit-pad \.tv-root \.tv-cover:focus \{([^}]*)\}/.exec(css);
check('a controller rings the cover and not the button around its name',
  !!coverFocusRule &&
    coverFocusRule[1].includes('box-shadow: none') &&
    coverFocusRule[1].includes('outline: none'),
  coverFocusRule?.[1]);
check('while the artwork inside it keeps the pad mark',
  css.includes('html.orbit-pad .tv-root .tv-cover.orbit-pad-focus > span:first-child'));
check('the ring goes around the artwork, not the name under it',
  css.includes('.tv-cover:hover > span:first-child') &&
    !/\.tv-cover[^\n]*span\s*\{/.test(css.slice(css.indexOf('.tv-cover:hover'), css.indexOf('@media (prefers-reduced-motion'))));
const coverSpan = document.querySelectorAll('[data-tv-cover]')[1]?.querySelector('span');
check('the hub enters and exits without animation',
  !css.includes('@keyframes tv-in') && !css.includes('@keyframes tv-out') &&
    /\.tv-root,\s*\n\.tv-root \*/.test(css) &&
    /animation: none !important;[\s\S]*?transition: none !important;/.test(css));
check('and the markup leaves the colour to that one rule',
  !/group-hover:border|border-accent|shadow-\[/.test(coverSpan?.className ?? ''),
  String(coverSpan?.className));

console.log('a running game says so, and can be stopped from the hub');

await render(library, 'b');
const stop = document.querySelector('[data-orbit-tv] button[aria-label="Stop the session"]');
check('the game that is running is named at the top of the screen', !!stop);
await act(async () => {
  stop.click();
});
check('and stopping it is one press away', stopped === 1);

console.log('the bar along the top is a place you can walk to and leave from');

await render(library, null, { showMusic: true });
await key('ArrowUp');
await key('ArrowUp');
const inBar = () => document.activeElement?.closest('[data-tv-topbar]') !== null;
check('up twice from the rail reaches the bar', inBar());
const sound = document.activeElement;
check('the bar holds the sound as well as the way out',
  document.querySelectorAll('[data-tv-topbar] button').length >= 2);
await key('ArrowRight');
check('right moves along the bar rather than into the rail',
  inBar() && document.activeElement !== sound && selected() === '0');
check('and the way out is one of the stops on it',
  document.activeElement?.getAttribute('aria-label') === 'Leave TV mode',
  String(document.activeElement?.getAttribute('aria-label')));

played.length = 0;
const leftBeforeTopBar = left;
await key('Enter');
await act(async () => wait(320));
check('enter there is a click, not a game starting behind it',
  left === leftBeforeTopBar + 1 && played.length === 0,
  `left ${left} / played ${played.length}`);

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

console.log('a d-pad walks the rail, not the page behind it');

const { useGamepad } = await import('../src/hooks/useGamepad.ts');
const Pad = () => {
  useGamepad();
  return null;
};
await render(library);
const padHost = document.body.appendChild(document.createElement('div'));
const padRoot = createRoot(padHost);

// jsdom reports itself as Linux, which is the desktop path: the page asks the
// window for the pad's state instead of reading the browser's gamepad API. That
// is the path this checks - the one a controller on this machine actually uses.
let padNow = { connected: false, buttons: Array(16).fill(false), axes: [0, 0, 0, 0] };
const press = (index) => {
  const buttons = Array(16).fill(false);
  buttons[index] = true;
  padNow = { connected: true, buttons, axes: [0, 0, 0, 0] };
};
/** Letting go. The same button twice without this is one press, not two. */
const release = async () => {
  padNow = { connected: true, buttons: Array(16).fill(false), axes: [0, 0, 0, 0] };
  await act(async () => {
    await wait(120);
  });
};
dom.window.__TAURI__ = { core: { invoke: async () => padNow } };
// jsdom has no window manager, so the hook's "is this window in front" question
// has to be answered for it: a couch player is looking at this window.
const hadFocus = dom.window.document.hasFocus;
dom.window.document.hasFocus = () => true;

// The pad arrives connected and still: that reading is the baseline, not a push.
padNow = { connected: true, buttons: Array(16).fill(false), axes: [0, 0, 0, 0] };
await act(async () => {
  padRoot.render(createElement(Pad));
});
await act(async () => {
  await wait(140);
});
check('a pad that is connected and sitting still leaves the rail where it is',
  selected() === '0', String(selected()));

press(15);
await act(async () => {
  await wait(140);
});
check('right on the d-pad moves the rail on', selected() === '1', String(selected()));
check('and the page follows it', title() === 'Also Half Done', title());

press(14);
await act(async () => {
  await wait(140);
});
check('left walks it back', selected() === '0', String(selected()));

await release();
press(12);
await act(async () => {
  await wait(140);
});
check('up reaches the game\'s own buttons',
  document.activeElement?.getAttribute('data-tv-action') === 'play',
  String(document.activeElement?.getAttribute('data-tv-action')));

await release();
press(15);
await act(async () => {
  await wait(140);
});
check('and right moves between those buttons rather than off the rail',
  document.activeElement?.getAttribute('data-tv-action') === 'details',
  String(document.activeElement?.getAttribute('data-tv-action')));

await release();
press(12);
await act(async () => {
  await wait(140);
});
check('up again reaches the top bar, where the way out is',
  document.activeElement?.closest('[data-tv-topbar]') !== null);

await release();
press(13);
await act(async () => {
  await wait(140);
});
await release();
press(13);
await act(async () => {
  await wait(140);
});
check('down out of the bar walks back to the rail',
  document.activeElement?.getAttribute('data-tv-cover') === '0',
  String(document.activeElement?.getAttribute('data-tv-cover')));

// A game's page is driven by the same presses: its two buttons, then Back.
await release();
press(12);
await act(async () => {
  await wait(140);
});
await release();
press(15);
await act(async () => {
  await wait(140);
});
await release();
await release();
press(0);
await act(async () => {
  await wait(140);
});
check('a confirm press on Details opens the game\'s page, still in TV mode',
  !document.querySelector('[data-tv-cover]') && !!document.querySelector('[data-tv-action="back"]'));
await release();
press(1);
await act(async () => {
  await wait(140);
});
check('and Back returns to the rail rather than leaving the mode',
  !!document.querySelector('[data-tv-cover]'), String(left));

await act(async () => {
  padRoot.unmount();
  await wait(20);
});
padHost.remove();
delete dom.window.__TAURI__;
dom.window.document.hasFocus = hadFocus;

console.log('the button is in the top bar, beside the sound');

const nav = await import('../src/components/TopNav.tsx');
const source = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/components/TopNav.tsx', import.meta.url), 'utf8'),
);
check('the bar has a TV control that calls back out', typeof nav.TopNav === 'function' && source.includes('onTv'));
check('it sits beside the music control rather than at the far corner',
  source.indexOf('onClick={onTv}') < source.indexOf('<MusicButton'));
check('the TV button is a plain television, drawn like the icons beside it',
  /aria-label="TV mode"/.test(source) &&
    !/orbit-tv-button|box-shadow|gradient/.test(source.slice(source.indexOf('onClick={onTv}'), source.indexOf('onClick={onTv}') + 400)),
  source.slice(source.indexOf('onClick={onTv}'), source.indexOf('onClick={onTv}') + 400));

await act(async () => {
  await wait(20);
  root.unmount();
});

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
for (const [name, descriptor] of previousGlobals) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
