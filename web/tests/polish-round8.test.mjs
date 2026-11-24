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
const picker = read('../src/components/detail/ArtworkPicker.tsx');
const reshadeMod = read('../src-tauri/src/reshade.rs');

check('Stardeck is one row of covers over the selected game\'s own blurred cover',
  css.includes('.orbit-deckbackdrop-layer') && /\.orbit-deckbackdrop-layer \{[^}]*filter: blur\(\d+px\)/.test(css) &&
    // The row takes everything the window has: a fixed share left a strip of
    // the shell's own colour under the covers.
    /\.orbit-deck \.orbit-deck-index \{[^}]*flex: 1 1 auto/.test(css) &&
    css.includes('.orbit-decksheet'));
check('Stardeck game changes fade the room and cross-fade the panel, with reduced-motion support',
  css.includes('@keyframes deck-game-in') && css.includes('@keyframes deck-backdrop-in') &&
    css.includes('prefers-reduced-motion: reduce') && tv.includes('key={game.id}') && !tv.includes('findTvBackdrop'));
check('Launch settings merge starts-with-game tools and alternative launches into one page',
  edit.includes("page === 'launch'") && !edit.includes("page === 'extra'") &&
    edit.includes('section="all"') && launchEditor.includes('Starts with the game') && launchEditor.includes('Alternative launch') &&
    launchEditor.includes("section === 'all' || section === 'launch'") &&
    launchEditor.includes("section === 'all' || section === 'launch' || section === 'extra'") &&
    launchEditor.includes("when: 'alternative'") && launchEditor.includes("when: 'alongside'") &&
    launchEditor.includes('Add arguments') && types.includes("when?: 'alongside' | 'alternative'"));
check('a launch profile starts the game while a tool rides along, and neither is swept up by the other',
  session.includes('companion.is_alongside()') && lib.includes('fn start_game_alternative(') && lib.includes('profile.is_alongside()'));
check('the Play arrow offers named launches beside the tools, by name',
  gameDetail.includes('onRunLaunch?.(index)') && gameDetail.includes("companion.when === 'alternative'") && gameDetail.includes('Start it another way'));
check('the Play arrow offers saved companions and routes selected tracked utilities into a session',
  gameDetail.includes('aria-label="More launch options"') && gameDetail.includes('onRunCompanion?.(index)') && lib.includes('fn start_game_companion(') && lib.includes('companion.counts_as_playing') && session.includes('pub fn start_action('));
check('Edit Game exposes Proton on its own Linux-only page',
  edit.includes("id: 'wine', label: 'Wine', hidden: hideLaunchSettings || desktopOs() !== 'linux'") && edit.includes('<WineSettings'));
check('ReShade is one switch, with the proxy guessed from the game and the original kept',
  edit.includes('Use ReShade with this game') && native.includes('setReshade') && lib.includes('fn reshade_state(') && lib.includes('fn reshade_set(') &&
    reshadeMod.includes('fn guess_proxies(') && reshadeMod.includes('fn pe_imports(') && reshadeMod.includes('.orbit-original') && reshadeMod.includes('RESHADE_VERSION'));
check('wide backdrop picker requests broad artwork and uses the generalized wide presentation',
  edit.includes('findBackdropArtwork(game.id)') && native.includes("'artwork_backdrops'") && portrait.includes("shape === 'wide'") &&
    picker.includes('shape: ArtShape') && picker.includes("'is-wide'"));

(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
