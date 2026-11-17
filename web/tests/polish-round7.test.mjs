import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const settings = read('../src/components/SettingsView.tsx');
const tv = read('../src/components/TvMode.tsx');
const css = read('../src/index.css');
const edit = read('../src/components/detail/GameEditTab.tsx');
const launch = read('../src/components/detail/LaunchEditor.tsx');
const cover = read('../src/components/ui/Cover.tsx');
const copy = read('../src/components/CopySettings.tsx');
const tvService = read('../src/services/tv.ts');
const app = read('../src/App.tsx');
const native = read('../src-tauri/src/saves.rs');
const nativeLaunch = read('../src-tauri/src/launch.rs');
const nativeLib = read('../src-tauri/src/lib.rs');
const session = read('../src-tauri/src/session.rs');

console.log('polish round 7 checks');
check('Backlog is visible in the Settings left navigation group',
  settings.includes("{ label: 'Library', ids: ['orbit-library', 'orbit-backlog'") && settings.includes('section.label'));
check('Stardeck settings no longer offer the ineffective Covers / Stage only shelf option',
  !tv.includes('label="Shelf"') && !tv.includes("cinema: value.cinema"));
check('Stardeck keeps the focused cover central with book-roll neighbors and precise arrow focus',
  tv.includes('deckCards.map(({ game, index: n, position })') && tv.includes('data-deck-position={position}') && css.includes("[data-deck-position='-1']") && css.includes("[data-deck-position='1']") && tv.includes('refocusSelectedCover.current = true') && tv.includes('coverOf(at)?.focus'));
check('Known artwork renders immediately while nearby and high-resolution sources are warmed',
  tv.includes('wideArtImmediateFallback(active)') && tv.includes('warmImage(wideArtImmediateFallback(game) ?? first)') && cover.includes('setDisplaySrc(src)') && cover.includes("fetchPriority={loading === 'eager' ? 'high' : 'auto'}"));
check('Library controller focus is spatial and the title remains outside the cover focus outline',
  tv.includes('moveLibraryFocus') && tv.includes('data-tv-library-cover') && css.includes('.tv-library-game:focus-visible .tv-library-game-art'));
check('Deck and Library controls are centered and use the app-styled tab treatment',
  css.includes('.orbit-deck-pagetabs') && css.includes('left: 50%') && css.includes('.orbit-deck-pagetab[aria-pressed'));
check('Liquid Glass uses opaque app-colored panels across platforms',
  css.includes('html.orbit-glass :is(') && css.includes('background-color: var(--c-panel) !important') && css.includes('blur(28px) saturate(1.12)'));
check('Edit Game is divided into Details, Launch, Tools and Saves tabs without the old title hero or numbered sections',
  ['Details', 'Launch', 'Tools', 'Saves'].every((tab) => edit.includes(`'${tab.toLowerCase()}', '${tab}'`)) && edit.includes('role="tablist"') && !edit.includes('orbit-edit-face') && css.includes('.orbit-editsection-title::before { content: none; }'));
check('The editor no longer exposes the Not owned yet option or Notes field and uses Settings-style switches',
  !edit.includes('Not owned yet') && !edit.includes('<MarkdownEditor') && edit.includes('role="switch"') && edit.includes('className="orbit-switch"'));
check('Artwork uses paired cover/backdrop previews with simpler file, online, and URL controls',
  edit.includes('orbit-art-workbench') && edit.includes('<PortraitBrowser') && edit.includes('Enter a backdrop URL') && css.includes('.orbit-art-choice-preview.is-cover'));
check('Saves opens its folder and removes the redundant status line and help paragraph',
  edit.includes('Open folder') && edit.includes('revealInExplorer(savePath)') && !edit.includes('Saved folder:') && !edit.includes('Orbit searches this game’s common folders'));
check('Export selection uses an outline-only state rather than a filled accent overlay',
  copy.includes("'border-accent bg-transparent text-fg") && !copy.includes('border-accent bg-accent/15'));
check('The Saves tab automatically searches and exposes the existing PCGamingWiki path suggestions',
  edit.includes('findSave(game.title, saveHintsOf(game))') && edit.includes('suggestSaves(game.title)') && app.includes('onSaveDir={(path)'));
check('Launch companions include programs, shell scripts, browser pages, and separate arguments',
  launch.includes('Program or script') && launch.includes('Web page') && launch.includes("['sh', 'exe', 'AppImage']") && launch.includes('Arguments') && nativeLaunch.includes('command_for_path(path)') && session.includes('companion.url'));
check('Tools are one ReShade switch: on, off, or your own DLL, with nothing to configure first',
  edit.includes('Use ReShade with this game') && edit.includes('setReshade(game.id, next)') && edit.includes('Use a ReShade DLL I already have') &&
    !edit.includes('Graphics API') && !edit.includes('Adopt existing') &&
    nativeLib.includes('fn reshade_state(') && nativeLib.includes('fn reshade_set(') && nativeLib.includes('fn reshade_use_file('));
check('Save discovery tries editionless and Roman-numeral title variants like GhostHunterPro',
  native.includes('definitive edition') && native.includes('Part I') && native.includes('save_search_tries_editionless_and_roman_numeral_title_variants'));
(globalThis).__orbitFailures = ((globalThis.__orbitFailures ?? 0) + failures);
