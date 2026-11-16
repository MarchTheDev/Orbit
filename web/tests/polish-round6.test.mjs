import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const art = read('../src/utils/art.ts');
const library = read('../src/components/LibraryView.tsx');
const palette = read('../src/components/CommandPalette.tsx');
const backlog = read('../src/components/BacklogView.tsx');
const settings = read('../src/components/SettingsView.tsx');
const app = read('../src/App.tsx');
const stats = read('../src/components/StatisticsView.tsx');
const tv = read('../src/components/TvMode.tsx');
const tvService = read('../src/services/tv.ts');
const css = read('../src/index.css');

console.log('polish round 6 checks');
const wideCandidates = art.slice(art.indexOf('export function wideArtCandidates'), art.indexOf('/** A known usable source'));
check('wide-art fallbacks never stretch a portrait cover across the hero',
  !wideCandidates.includes('coverUrl') && !wideCandidates.includes('coverPath') && library.includes('wideArtImmediateFallback(game)') && library.includes('stageArt.gameId === game.id'));
check('right-click palette menu is narrower and uses larger text',
  palette.includes('w-44 rounded-lg') && palette.includes('text-[13px]'));
check('Backlog has no rank numbers on cards',
  !backlog.includes('orbit-num absolute left-1 top-1') && !backlog.includes('`#${index + 1}`'));
check('Backlog is its own Settings category and carries its own controls',
  settings.includes("{ id: 'orbit-backlog', label: 'Backlog' }") && settings.includes('id="orbit-backlog"') && settings.includes('showBacklogCalendar'));
check('Settings Open the album selects the Album tab directly',
  app.includes("setStatsTab('album'); setPage('statistics')"));
check('All games Album art previews a small set of game covers',
  stats.includes('orbit-album-all-covers') && stats.includes('albumGames.slice(0, 4)') && css.includes('.orbit-album-all-cover'));
check('Stardeck has a persisted Deck / Library page switch, controller page event, and a library grid',
  tv.includes('orbit.stardeck.lastPage') && tv.includes('orbit-pad-page') && tv.includes('aria-label="Stardeck library"') && tv.includes('grid-cols-[repeat(auto-fill'));
check('Stardeck settings choose what appears below Library covers',
  tv.includes("coverLabel: 'name' | 'info' | 'none'") && tv.includes('Under library covers') && tv.includes("prefs.coverLabel === 'none'"));
check('Fullscreen exit restores the saved native window bounds',
  tvService.includes('previousNativeBounds') && tvService.includes('new PhysicalSize(bounds.width, bounds.height)') && tvService.includes('new PhysicalPosition(bounds.x, bounds.y)'));
(globalThis).__orbitFailures = ((globalThis.__orbitFailures ?? 0) + failures);
