import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS, SAMPLE_GAMES } from '../src/data/sampleGames.ts';
import {
  buildPersonalCalendarGrid,
  getUnreleasedBacklogGames,
  parseGameRelease,
} from '../src/utils/releaseCalendar.ts';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('polish round 3 checks');

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const librarySrc = readFileSync(new URL('../src/components/LibraryView.tsx', import.meta.url), 'utf8');
const statsSrc = readFileSync(new URL('../src/components/StatisticsView.tsx', import.meta.url), 'utf8');
const viewerSrc = readFileSync(new URL('../src/components/ui/CaptureViewerModal.tsx', import.meta.url), 'utf8');
const dragSrc = readFileSync(new URL('../src/hooks/useDragReorder.ts', import.meta.url), 'utf8');
const settingsSrc = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');

// 1 & 4. Unified CaptureViewerModal + custom OrbitVideoPlayer
check(
  'Observatory and Album both use CaptureViewerModal instead of legacy orbit-lightbox or native video controls',
  librarySrc.includes('<CaptureViewerModal') &&
    !librarySrc.includes('orbit-lightbox') &&
    statsSrc.includes('<CaptureViewerModal') &&
    viewerSrc.includes('orbit-vplayer') &&
    viewerSrc.includes('orbit-vplayer-scrub') &&
    !viewerSrc.includes('<video controls'),
);

check(
  'LibraryView Escape handler guards against open CaptureViewerModal',
  librarySrc.includes('document.body.dataset.orbitViewerOpen') &&
    viewerSrc.includes('stopImmediatePropagation()'),
);

// 2. Playtime by day inspector height stability & Other games chip height
check(
  'Playtime-by-day inspector reserves resting height matching game chips and unifies Other games chip height',
  /\.orbit-activity-inspector\s*\{[^}]*min-height:\s*60px;/s.test(css) &&
    /\.orbit-activity-inspect-chip\s*\{[^}]*height:\s*40px;[^}]*min-height:\s*40px;/s.test(css),
);

// 5. useDragReorder baseline layout snapshot & drag-handle button support
check(
  'useDragReorder snapshots untransformed slot baselines once and permits [data-orbit-drag-handle] buttons',
  dragSrc.includes('captureBaseLayout') &&
    dragSrc.includes('packVerticalTops') &&
    dragSrc.includes("target?.closest('[data-orbit-drag-handle]')"),
);

// 6. Release calendar utilities & Settings toggle
const refNow = new Date(2026, 10, 16); // Nov 16, 2026
const exactUpcoming = parseGameRelease(
  {
    ...SAMPLE_GAMES[0],
    meta: { ...SAMPLE_GAMES[0].meta, releaseDate: 'Dec 11, 2026', comingSoon: true, releaseYear: 2026 },
  },
  refNow,
);
const alreadyReleased = parseGameRelease(
  {
    ...SAMPLE_GAMES[1],
    planned: false,
    meta: { ...SAMPLE_GAMES[1].meta, releaseDate: 'Feb 25, 2022', comingSoon: false, releaseYear: 2022 },
  },
  refNow,
);

check(
  'parseGameRelease distinguishes future exact dates from past releases',
  exactUpcoming.unreleased === true &&
    exactUpcoming.isoDay === '2026-12-11' &&
    exactUpcoming.daysUntil === 25 &&
    alreadyReleased.unreleased === false,
);

const unreleasedList = getUnreleasedBacklogGames(SAMPLE_GAMES, false, [], [], refNow);
const decGrid = buildPersonalCalendarGrid(2026, 11, unreleasedList, refNow);
check(
  'buildPersonalCalendarGrid builds a Monday-first 7-column grid placing unreleased Backlog games on their release day',
  unreleasedList.length === 1 &&
    decGrid.length % 7 === 0 &&
    decGrid.some((cell) => cell.isoDay === '2026-12-11' && cell.entries.length === 1),
);

check(
  'Settings enables showBacklogCalendar by default and exposes the toggle in Library and Backlog',
  DEFAULT_SETTINGS.showBacklogCalendar === true &&
    settingsSrc.includes('Show upcoming release calendar on Backlog') &&
    settingsSrc.includes('settings.showBacklogCalendar !== false'),
);

// DOM integration checks
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
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CaptureViewerModal } = await import('../src/components/ui/CaptureViewerModal.tsx');
const { CommandPalette } = await import('../src/components/CommandPalette.tsx');
const { BacklogView } = await import('../src/components/BacklogView.tsx');

const root = createRoot(document.getElementById('root'));

// A. CaptureViewerModal Esc isolation test
let parentEscFired = false;
let viewerClosed = false;
const parentListener = (e) => {
  if (e.key === 'Escape') parentEscFired = true;
};
window.addEventListener('keydown', parentListener);

await act(async () => {
  root.render(
    createElement(CaptureViewerModal, {
      item: { path: '/tmp/shot1.png', name: 'shot1.png', kind: 'screenshot', at: 1700000000, bytes: 204800 },
      items: [{ path: '/tmp/shot1.png', name: 'shot1.png', kind: 'screenshot', at: 1700000000, bytes: 204800 }],
      resolveGame: () => ({ game: SAMPLE_GAMES[1], title: SAMPLE_GAMES[1].title }),
      onSelect: () => {},
      onClose: () => {
        viewerClosed = true;
      },
    }),
  );
});

await act(async () => {
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
});
window.removeEventListener('keydown', parentListener);

check(
  'pressing Escape with CaptureViewerModal open closes only the viewer and blocks parent Escape handlers',
  viewerClosed === true && parentEscFired === false,
);

// B. CommandPalette clicking/selecting a game opens Level-2 per-game actions
let openedDetailsId = null;
let paletteClosed = 0;
await act(async () => {
  root.render(
    createElement(CommandPalette, {
      open: true,
      initialQuery: 'elden',
      games: SAMPLE_GAMES,
      onClose: () => {
        paletteClosed += 1;
      },
      onPage: () => {},
      onGame: (id) => {
        openedDetailsId = id;
      },
      onEditGame: () => {},
      onUpdateGame: () => {},
      onSettings: () => {},
      onAdd: () => {},
      onAddFolder: () => {},
      onPlay: () => {},
    }),
  );
});

const paletteDialog = document.querySelector('[role="dialog"]');
await act(async () => {
  paletteDialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});

check(
  'selecting a game in CommandPalette opens Level-2 per-game actions instead of closing the palette',
  paletteClosed === 0 &&
    openedDetailsId === null &&
    document.body.textContent.includes('Open game details') &&
    document.body.textContent.includes('Edit game settings…') &&
    document.body.textContent.includes('Status: Playing'),
);

// C. BacklogView Personal Release Calendar conditional rendering
const renderBacklog = async (games, showReleaseCalendar) => {
  await act(async () => {
    root.render(
      createElement(BacklogView, {
        games,
        onSelect: () => {},
        onEdit: () => {},
        onStatus: () => {},
        onAdd: () => {},
        onUpdate: () => {},
        onRemove: () => {},
        fetchMetadata: false,
        syncLibrary: false,
        backlogOn: [],
        backlogOff: [],
        onBacklogMembership: () => {},
        myOrder: [],
        setMyOrder: () => {},
        showReleaseCalendar,
      }),
    );
  });
};

await renderBacklog(SAMPLE_GAMES, true);
check(
  'BacklogView renders Personal Release Calendar bottom bar when an unreleased Backlog game exists and setting is on',
  Boolean(document.querySelector('[data-orbit-release-calendar]')) &&
    document.body.textContent.includes('Personal Release Calendar'),
);

await renderBacklog(SAMPLE_GAMES, false);
check(
  'BacklogView hides Personal Release Calendar bottom bar when showReleaseCalendar is turned off in Settings',
  !document.querySelector('[data-orbit-release-calendar]'),
);

const onlyReleasedGames = SAMPLE_GAMES.filter((g) => !g.planned);
await renderBacklog(onlyReleasedGames, true);
check(
  'BacklogView hides Personal Release Calendar bottom bar when all Backlog games are already released',
  !document.querySelector('[data-orbit-release-calendar]'),
);

await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
