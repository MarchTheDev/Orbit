import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const palette = read('../src/components/CommandPalette.tsx');
const backlog = read('../src/components/BacklogView.tsx');
const stats = read('../src/components/StatisticsView.tsx');
const settings = read('../src/components/SettingsView.tsx');
const art = read('../src/utils/art.ts');
const edit = read('../src/components/detail/GameEditTab.tsx');
const library = read('../src/hooks/useLibrary.ts');
const css = read('../src/index.css');

console.log('polish round 5 checks');
check('Command Palette right-click menu is compact and offers Edit game, not a favorite toggle',
  palette.includes('w-44 rounded-lg') && palette.includes('text-[13px]') && palette.includes('Edit game') && !palette.includes('>Toggle favorite</button>'));
check('Command Palette right preview pane has a clickable favorite star',
  palette.includes('onToggleFavorite={onToggleFavorite}') && palette.includes('<Star className="size-4"'));
check('Backlog sort and reordering applies across all lanes, and owned library matches retire wishlist duplicates',
  ['playing', 'completed', 'dropped'].every((lane) => backlog.includes(`sortByOrder(owned.filter((g) => g.status === '${lane}'`)) && backlog.includes('sortByOrder(allPlanned.filter(match))') && backlog.includes('resolvedOwnedPlans') && backlog.includes('onBacklogMembership(ownedMatch.id, true)') && (backlog.match(/onMove=\{move\}/g) ?? []).length >= 6);
check('Backlog release calendar only appears in All lanes; wishlist naming and spacing are updated',
  backlog.includes('laneFilter === \'all\'') && backlog.includes('title="Wishlist / Planned"') && css.includes('margin: 18px 0 22px') && css.includes('gap: 14px'));
check('Calendar surface is flat and non-sticky',
  /\.orbit-release-bar\s*\{[^}]*position:\s*relative/s.test(css) && !/\.orbit-release-bar\s*\{[^}]*backdrop-filter:\s*blur/s.test(css));
check('Journal sync settings have their own Settings section',
  settings.includes("{ id: 'orbit-journal', label: 'Journal' }") && settings.includes('id="orbit-journal"') && settings.includes('Add new games to Journal'));
check('Captures for a selected game render once and are separated by capture day',
  !stats.includes('Captures for {byFolder.get(albumGame)') && stats.includes('dayLabelOf(item)') && stats.includes('orbit-album-day-label'));
check('Observatory game info no longer shows a Steam app ID',
  !read('../src/components/LibraryView.tsx').includes('Steam app ${game.meta.steamAppId}'));
check('Player-picked art is retained above generated artwork and auto metadata preserves custom sources',
  art.includes('coverUrlCustom') && art.includes('backgroundUrlCustom') && edit.includes('coverUrlCustom:') && library.includes('target.meta.coverUrlCustom'));
(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
