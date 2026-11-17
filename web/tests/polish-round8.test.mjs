import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/index.css');
const tv = read('../src/components/TvMode.tsx');
const edit = read('../src/components/detail/GameEditTab.tsx');
const launchEditor = read('../src/components/detail/LaunchEditor.tsx');
const gameDetail = read('../src/components/detail/GameDetail.tsx');
const types = read('../src/types.ts');
const session = read('../src-tauri/src/session.rs');
const lib = read('../src-tauri/src/lib.rs');
const native = read('../src/services/native.ts');
const portrait = read('../src/components/ui/PortraitBrowser.tsx');

check('Stardeck splits the stage and full-width lower library into complementary panels',
  css.includes('flex: 1 1 58%') && css.includes('flex: 1 1 42%') && css.includes('width: calc(100% + 40px)') && css.includes('orbit-deck-index-art') && css.includes('filter: blur(25px)'));
check('Stardeck game changes animate with reduced-motion support and no stale backdrop lookup delay',
  css.includes('@keyframes deck-game-in') && css.includes('prefers-reduced-motion: reduce') && tv.includes('key={active.id}') && !tv.includes('setTimeout(() => {\n      void findTvBackdrop'));
check('Start alongside lives in Launch settings and companion playtime is individually configurable',
  edit.includes('activeTab === \'launch\'') && launchEditor.includes('Start alongside') && launchEditor.includes('section !== \'tools\'') && launchEditor.includes('countsAsPlaying') && types.includes('countsAsPlaying?: boolean'));
check('the Play arrow offers saved companions and routes selected tracked utilities into a session',
  gameDetail.includes('aria-label="More launch options"') && gameDetail.includes('onRunCompanion?.(index)') && lib.includes('fn start_game_companion(') && lib.includes('companion.counts_as_playing') && session.includes('pub fn start_action('));
check('Edit Game exposes Proton on its own Linux-only page',
  edit.includes("desktopOs() === 'linux' && !hideLaunchSettings ? [['proton', 'Proton']]") && edit.includes('Proton for this game') && edit.includes('<WineSettings'));
check('ReShade supports status detection, adoption, updates, toggling, and restore backups',
  edit.includes('Install and manage') && edit.includes('Adopt existing') && edit.includes('Remove / restore') && native.includes('setReshadeEnabled') && lib.includes('fn reshade_status(') && lib.includes('fn adopt_reshade(') && lib.includes('fn set_reshade_enabled(') && lib.includes('fn remove_reshade(') && lib.includes('backup_reshade_original'));
check('wide backdrop picker requests broad artwork and uses the generalized wide presentation',
  edit.includes('findBackdropArtwork(game.id)') && native.includes("'artwork_backdrops'") && portrait.includes("shape === 'wide'"));

(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
