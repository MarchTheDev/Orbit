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
const reshadeMod = read('../src-tauri/src/reshade.rs');

check('Stardeck splits the stage and an edge-to-edge lower shelf, with no inset strip under it',
  css.includes('flex: 1 1 58%') && css.includes('flex: 1 1 42%') && css.includes('orbit-deck-index-art') && css.includes('filter: blur(25px)') &&
    // The shelf reaches the window's own edges: no negative margin trick, and
    // no ruled border where it meets the stage.
    !/\.orbit-deck:not\(\.is-side\) \.orbit-deck-index \{[^}]*width: calc\(100% \+/.test(css) &&
    css.includes('orbit-deck-stagefade'));
check('Stardeck game changes animate with reduced-motion support and no stale backdrop lookup delay',
  css.includes('@keyframes deck-game-in') && css.includes('prefers-reduced-motion: reduce') && tv.includes('key={active.id}') && !tv.includes('setTimeout(() => {\n      void findTvBackdrop'));
check('Launch settings separate what starts with the game from another way to start it',
  edit.includes('activeTab === \'launch\'') && launchEditor.includes('Start alongside') && launchEditor.includes('Another way to launch it') &&
    launchEditor.includes("when: 'alternative'") && launchEditor.includes("when: 'alongside'") && types.includes("when?: 'alongside' | 'alternative'"));
check('a launch profile starts the game while a tool rides along, and neither is swept up by the other',
  session.includes('companion.is_alongside()') && lib.includes('fn start_game_alternative(') && lib.includes('profile.is_alongside()'));
check('the Play arrow offers named launches beside the tools, by name',
  gameDetail.includes('onRunLaunch?.(index)') && gameDetail.includes("companion.when === 'alternative'") && gameDetail.includes('Start it another way'));
check('the Play arrow offers saved companions and routes selected tracked utilities into a session',
  gameDetail.includes('aria-label="More launch options"') && gameDetail.includes('onRunCompanion?.(index)') && lib.includes('fn start_game_companion(') && lib.includes('companion.counts_as_playing') && session.includes('pub fn start_action('));
check('Edit Game exposes Proton on its own Linux-only page',
  edit.includes("desktopOs() === 'linux' && !hideLaunchSettings ? [['proton', 'Proton']]") && edit.includes('Proton for this game') && edit.includes('<WineSettings'));
check('ReShade is one switch, with the proxy guessed from the game and the original kept',
  edit.includes('Use ReShade with this game') && native.includes('setReshade') && lib.includes('fn reshade_state(') && lib.includes('fn reshade_set(') &&
    reshadeMod.includes('fn guess_proxies(') && reshadeMod.includes('fn pe_imports(') && reshadeMod.includes('.orbit-original') && reshadeMod.includes('RESHADE_VERSION'));
check('wide backdrop picker requests broad artwork and uses the generalized wide presentation',
  edit.includes('findBackdropArtwork(game.id)') && native.includes("'artwork_backdrops'") && portrait.includes("shape === 'wide'"));

(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
