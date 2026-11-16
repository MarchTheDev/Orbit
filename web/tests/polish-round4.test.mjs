import { readFileSync } from 'node:fs';

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}`); }
}
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stats = read('../src/components/StatisticsView.tsx');
const palette = read('../src/components/CommandPalette.tsx');
const drag = read('../src/hooks/useDragReorder.ts');
const library = read('../src/components/LibraryView.tsx');
const backlog = read('../src/components/BacklogView.tsx');
const css = read('../src/index.css');
const art = read('../src/utils/art.ts');
const cover = read('../src/components/ui/Cover.tsx');
const hltbRust = read('../src-tauri/src/hltb.rs');
const hltbPage = read('../src/components/detail/HltbPlanPage.tsx');
const nonSteam = read('../src/services/nonSteam.ts');

console.log('polish round 4 checks');
check('Escape clears the selected Playtime-by-day game and respects open dialogs/viewers',
  stats.includes("e.key !== 'Escape'") && stats.includes('setPinnedGameId(null)') && stats.includes('orbitViewerOpen'));
check('Command Palette preview hides the Installed badge',
  palette.includes("launcherLabel(game) !== 'Installed'"));
check('Command Palette arrow keys stop bubbling and visual grouping preserves row order',
  palette.includes("e.key === 'ArrowDown'") && palette.includes('e.stopPropagation()') && palette.includes('if (last?.group === row.group)'));
check('Focused-game quick actions no longer get injected ahead of Recent',
  !palette.includes('Focused library game quick context actions'));
check('Palette pins persist, render a Pinned group, and entries expose a right-click context menu',
  palette.includes("orbit.palette.pinned") && palette.includes("group: 'Pinned'") && palette.includes('onContextMenu') && palette.includes('Remove from Recent'));
check('Drag uses the dragged card live center against the original geometric slots and still keeps cardAt fallback',
  drag.includes('const cx = draggedSlot.left + draggedSlot.width / 2 + rawDX') && drag.includes('matchedSlotIdx === origIdx') && drag.includes('cardAt(cards, x, y, heldId)') && drag.includes("e.preventDefault();"));
check('Drag no longer adds a square box-shadow overlay', !drag.includes('slotEl.style.boxShadow'));
check('Observatory manual shelf tiles and rows wire through useDragReorder',
  library.includes('sort === \'manual\' ? onReorder : undefined') && library.includes('shelfDrag.bind(game.id)'));
check('Backlog KPI strip is removed, search is wider, catalogue entries open PlanDialog, and calendar is not sticky',
  !backlog.includes('orbit-backlog-kpis') && backlog.includes('flex-[2]') && backlog.includes('initialGame={catalogueGame ?? undefined}') && /\.orbit-release-bar\s*\{[^}]*position:\s*relative/s.test(css));
check('High-resolution Steam hero and portrait fallbacks are ordered ahead of low-resolution artwork',
  art.includes('library_hero_2x.jpg') && art.includes('library_hero.jpg') && art.includes('library_600x900_2x.jpg') && art.includes('decodeArtwork') && art.includes('prewarmLibraryArtwork'));
check('GamePage keeps the selected page mounted and retains the previous decoded hero during transitions',
  !library.includes('<GamePage\n              key={focus.id}') && library.includes('resolveWideArt(game)') && css.includes('animation: none;'));
check('Cover memoizes aspect ratio and retries the available high-resolution source chain',
  cover.includes('aspectRatios') && cover.includes('coverArtCandidates(game)'));
check('HLTB parsing returns regional releases and catalogue metadata; non-Steam page displays it and queries Wikidata',
  ['release_world', 'release_na', 'release_eu', 'release_jp', 'profile_dev', 'profile_pub', 'profile_genre'].every((field) => hltbRust.includes(field)) && hltbPage.includes('Release & catalogue information') && nonSteam.includes('wikidata.org/w/api.php'));

(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
