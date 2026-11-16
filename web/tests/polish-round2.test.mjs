import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const settingsSrc = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
const librarySrc = readFileSync(new URL('../src/components/LibraryView.tsx', import.meta.url), 'utf8');
const statsSrc = readFileSync(new URL('../src/components/StatisticsView.tsx', import.meta.url), 'utf8');
const logsSrc = readFileSync(new URL('../src/components/LogsView.tsx', import.meta.url), 'utf8');
const gameLogSrc = readFileSync(new URL('../src/components/detail/GameLogView.tsx', import.meta.url), 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
});
const globalNames = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'localStorage',
  'requestAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: dom.window.HTMLInputElement });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (cb) => setTimeout(cb, 0),
});
dom.window.Node.prototype.attachEvent = () => {};
dom.window.Node.prototype.detachEvent = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { applyTheme, THEMES } = await import('../src/data/themes.ts');
const { CommandPalette } = await import('../src/components/CommandPalette.tsx');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('polish round 2 checks');

// 1. Border-only selection overlay on Fonts & Themes
check(
  'font and theme selection overlays are unfilled border rings',
  /\.orbit-fontrow\[data-chosen\]::after\s*\{[^}]*background:\s*transparent/s.test(css) &&
    /\.orbit-themecard\[data-chosen\]::after\s*\{[^}]*background:\s*transparent/s.test(css),
);

// 2. Period control contrast & --c-on-accent luminance
check('no undefined --c-onaccent variable remains in CSS', !css.includes('var(--c-onaccent)'));
check(
  'active period buttons use --c-on-accent on --c-accent',
  /\.orbit-period button\[aria-pressed='true'\][^{]*\{[^}]*background:\s*var\(--c-accent\);[^}]*color:\s*var\(--c-on-accent\);/s.test(css),
);
applyTheme('orbital');
check(
  'Orbital bright lime accent gets dark ink on accent',
  document.documentElement.style.getPropertyValue('--c-on-accent') === '#141a06',
);
applyTheme('custom-bright', [
  {
    ...THEMES[0],
    id: 'custom-bright',
    name: 'Custom Bright',
    accent: '#fef08a',
    onAccent: undefined,
  },
]);
check(
  'bright custom accent without explicit onAccent computes dark ink',
  document.documentElement.style.getPropertyValue('--c-on-accent') === '#14161a',
);

// 3. Official metadata source brand icons
check(
  'MetadataSources uses official simple-icons brand paths',
  settingsSrc.includes("from 'simple-icons'") &&
    settingsSrc.includes('siSteam.path') &&
    settingsSrc.includes('siLutris.path') &&
    settingsSrc.includes('siRetroarch.path') &&
    settingsSrc.includes('siProtondb.path') &&
    settingsSrc.includes('siIgdb.path'),
);

// 4. Collapsible view menu animation + removal of "Fill the row"
check(
  'Fill the row is removed from LibraryView and CSS',
  !librarySrc.includes('Fill the row') &&
    !librarySrc.includes('shelfFill') &&
    !css.includes('.orbit-shelf-grid.is-filled'),
);
check(
  'CollapsibleGroup uses animated CSS grid collapse wrapper',
  librarySrc.includes('orbit-viewgroup-collapse') &&
    css.includes('grid-template-rows: 0fr;') &&
    css.includes('grid-template-rows: 1fr;'),
);

// 5. Journal left-side game list + redesigned game interior
check(
  'Journal restores left-hand game list sidebar and redesigned game workspace',
  logsSrc.includes('lg:grid-cols-[18.5rem_1fr]') &&
    !logsSrc.includes('orbit-journal-v2') &&
    logsSrc.includes('orbit-jworkspace') &&
    gameLogSrc.includes('orbit-jcard') &&
    gameLogSrc.includes('orbit-jdraft'),
);

// 6. Playtime by day stacked per-game bar chart
check(
  'StatisticsView renders stacked per-game bar chart instead of vertical day table',
  statsSrc.includes('orbit-activity') &&
    statsSrc.includes('CHART_SERIES') &&
    statsSrc.includes('orbit-activity-legend') &&
    !statsSrc.includes('orbit-playtime-grid'),
);

// 7. Library Filters button does not mount width-expanding count text when genre is selected
check(
  'Library Filters button uses fixed-size indicator instead of inline count badge',
  librarySrc.includes("cn('chip shrink-0', facetCount > 0 && 'is-filtered')") &&
    librarySrc.includes('orbit-filter-dot') &&
    !librarySrc.includes('{facetCount}\n                </span>'),
);

// 8. Heronite-style smart CommandPalette (`play:`, filtering, launch, and Level 2 game actions)
const root = createRoot(document.getElementById('root'));
let playedId = null;
let editedId = null;
let closedCount = 0;

const testGames = SAMPLE_GAMES.slice(0, 4).map((g, idx) => ({
  ...g,
  id: `g-${idx}`,
  title: idx === 0 ? 'Hades' : idx === 1 ? 'Hollow Knight' : idx === 2 ? 'Celeste' : 'Elden Ring',
  planned: false,
  inLibrary: true,
  hidden: false,
}));

const renderPalette = async (initialQuery) => {
  await act(async () => {
    root.render(
      createElement(CommandPalette, {
        open: true,
        initialQuery,
        games: testGames,
        onClose: () => {
          closedCount += 1;
        },
        onPage: () => {},
        onGame: () => {},
        onEditGame: (id) => {
          editedId = id;
        },
        onUpdateGame: () => {},
        onSettings: () => {},
        onAdd: () => {},
        onAddFolder: () => {},
        onPlay: (id) => {
          playedId = id;
        },
      }),
    );
  });
};

await renderPalette('play:');
check(
  'typing "play:" shows Play game mode badge and lists playable games',
  document.body.textContent.includes('Play game') &&
    document.body.textContent.includes('Play Hades') &&
    document.body.textContent.includes('Play Hollow Knight'),
);

await renderPalette('play: hollow');
check(
  'typing "play: hollow" narrows playable games to Hollow Knight',
  document.body.textContent.includes('Play Hollow Knight') &&
    !document.body.textContent.includes('Play Celeste'),
);

const dialog = document.querySelector('[role="dialog"]');
await act(async () => {
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
check('pressing Enter in play: mode launches the selected game', playedId === 'g-1' && closedCount === 1);

await renderPalette('celeste settings');
check(
  'trailing verb "celeste settings" offers Celeste settings…',
  document.body.textContent.includes('Celeste settings…'),
);
await act(async () => {
  document.querySelector('[role="dialog"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
check('pressing Enter on "celeste settings" opens GameEditDialog for Celeste', editedId === 'g-2');

await renderPalette('elden');
const drillBtn = document.querySelector('[aria-label="Actions for Elden Ring"]');
check('game row exposes Level 2 drilldown button', Boolean(drillBtn));
await act(async () => {
  drillBtn?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});
check(
  'drilling into a game shows its Level 2 actions and status options',
  document.body.textContent.includes('Status: Playing') &&
    document.body.textContent.includes('Edit game settings…'),
);

await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
