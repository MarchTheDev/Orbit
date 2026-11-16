import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = read('../src/components/SettingsView.tsx');
const tv = read('../src/components/TvMode.tsx');
const css = read('../src/index.css');
const edit = read('../src/components/detail/GameEditTab.tsx');
const launch = read('../src/components/detail/LaunchEditor.tsx');
const app = read('../src/App.tsx');
const native = read('../src-tauri/src/saves.rs');
const nativeLaunch = read('../src-tauri/src/launch.rs');
const session = read('../src-tauri/src/session.rs');

console.log('polish round 7 checks');
check('Backlog is visible in the Settings left navigation group',
  settings.includes("{ label: 'Library', ids: ['orbit-library', 'orbit-backlog'") && settings.includes('section.label'));
check('Stardeck settings no longer offer the ineffective Covers / Stage only shelf option',
  !tv.includes('label="Shelf"') && !tv.includes("cinema: value.cinema"));
check('Stardeck Deck focuses one cover at a time and arrow movement restores focus to the selected game',
  tv.includes('{[active].map((game)') && tv.includes('refocusSelectedCover.current = true') && tv.includes('coverOf(at)?.focus'));
check('Library controller focus is spatial and the title remains outside the cover focus outline',
  tv.includes('moveLibraryFocus') && tv.includes('data-tv-library-cover') && css.includes('.tv-library-game:focus-visible .tv-library-game-art'));
check('Deck and Library controls are centered and use the app-styled tab treatment',
  css.includes('.orbit-deck-pagetabs') && css.includes('left: 50%') && css.includes('.orbit-deck-pagetab[aria-pressed'));
check('Liquid Glass uses opaque app-colored panels across platforms',
  css.includes('html.orbit-glass :is(') && css.includes('background-color: var(--c-panel) !important') && css.includes('blur(28px) saturate(1.12)'));
check('Edit Game is divided into Details, Launch, Tools and Saves tabs',
  ['Details', 'Launch', 'Tools', 'Saves'].every((tab) => edit.includes(`'${tab.toLowerCase()}', '${tab}'`)) && edit.includes('role="tablist"'));
check('The Saves tab automatically searches and exposes the existing PCGamingWiki path suggestions',
  edit.includes('findSave(game.title, saveHintsOf(game))') && edit.includes('suggestSaves(game.title)') && app.includes('onSaveDir={(path)'));
check('Launch companions include programs, shell scripts, and browser pages',
  launch.includes('Add program or script') && launch.includes('Add web page') && launch.includes("['sh', 'exe', 'AppImage']") && nativeLaunch.includes('open_external_url') && session.includes('companion.url'));
check('Save discovery tries editionless and Roman-numeral title variants like GhostHunterPro',
  native.includes('definitive edition') && native.includes('Part I') && native.includes('save_search_tries_editionless_and_roman_numeral_title_variants'));
(globalThis).__orbitFailures = ((globalThis.__orbitFailures ?? 0) + failures);
