import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const library = read('../src/components/LibraryView.tsx');
const tv = read('../src/components/TvMode.tsx');
const tvService = read('../src/services/tv.ts');
const details = read('../src/components/TvDetails.tsx');
const css = read('../src/index.css');
const webart = read('../src-tauri/src/webart.rs');
const libRs = read('../src-tauri/src/lib.rs');
const capabilities = read('../src-tauri/capabilities/default.json');

check('the adaptive background follows the focused Observatory game, including the initial focus',
  app.includes('page === \'library\' ? libraryFocusId : selectedId') &&
    app.includes('setLibraryFocusId(id)') && library.includes('onFocus?.(focusId)'));

const enter = tv.slice(tv.indexOf("case 'Enter':"), tv.indexOf("case 'Tab':"));
check('Enter on a Stardeck cover opens the full details page rather than launching the game',
  enter.includes('openDetails(active)') && !enter.includes('start()'));
check('controller confirm on a game cover opens the full details page, not a launch',
  tv.includes('openDetails(target ?? active)') && tv.includes('openDetails(active)') &&
    !tv.includes('if (game.id === runningId) onStop();\n                            else onPlay(game);'));
check('a press on a deck cover opens its full details page',
  tv.includes('openDetails(game);'));
check('the carousel keeps a continuous shelf of covers around the selection',
  tv.includes('DECK_REACH') && tv.includes('deckTransform') && tv.includes('--deck-x'));

check('desktop mode and quit live in the Escape menu opened by the top-left hamburger',
  tv.includes('orbit-deck-hamburger') &&
    tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('Desktop mode') &&
    tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('Quit Orbit') &&
    !tv.includes('orbit-deck-exit-actions'));
check('TV detail scrolling has no transient scrollbar gutter',
  details.includes('tv-details-scroll') && css.includes('.tv-details-scroll::-webkit-scrollbar') &&
    css.includes('scrollbar-width: none;'));
check('Stardeck occupies the available dynamic viewport and restores only after fullscreen exits',
  css.includes('height: 100dvh') && css.includes('[data-orbit-tv] {') &&
    app.includes('await leaveFullscreen()') && app.includes('requestAnimationFrame') &&
    app.includes('await tvEnterPromise.current?.catch') &&
    tvService.includes('fullscreenRequestGeneration') && tvService.includes('pendingNativeFullscreen'));
// The black bar under Stardeck, and the window that came back with its bottom
// edge behind the taskbar, were the same two mistakes: a surface measured in
// viewport units the web view had not updated yet, and a frame height asked for
// as a client-area height.
check('the Stardeck surface is sized from its insets, not from a stale viewport unit',
  /\[data-orbit-tv\] \{[^}]*height: 100%;/.test(css) &&
    !/\[data-orbit-tv\] \{[^}]*height: 100vh/.test(css) &&
    tvService.includes('function remeasureViewport'));
check('the window is restored by its client area, so the frame fits above the taskbar',
  tvService.includes('window.innerSize()') &&
    tvService.includes('outer.height - inner.height') &&
    tvService.includes('frame.height - borderY') &&
    tvService.includes('const frame = {'));
check('the frame behind the page is painted the colour of the surface on it',
  tvService.includes('ROOM_COLOUR') && tvService.includes('DESK_COLOUR') &&
    tvService.includes('setBackgroundColor') &&
    capabilities.includes('core:window:allow-set-background-color') &&
    capabilities.includes('core:webview:allow-set-webview-background-color'));
check('a fullscreen the player asked for is not resized underneath them',
  tvService.includes('if (!ours && (await window.isFullscreen().catch(() => false)))'));
check('the opening window is fitted by its client area too',
  libRs.includes('window.inner_size()') && libRs.includes('frame_h.saturating_sub(border_h)'));
check('Stardeck Settings has a distinct screen treatment from desktop settings',
  app.includes('className="orbit-tv-config"') && css.includes('.orbit-tv-config .orbit-settings'));
check('symbol icons use accent colour without a matching filled tile',
  css.includes('background: transparent !important;') && css.includes('color: color-mix(in srgb, var(--c-accent)'));
check('web artwork token parsing tolerates DuckDuckGo query and JSON assignment formats',
  webart.includes('JSON-style') && webart.includes('r#"<script>{"vqd":"4-json_token"}</script>"#') &&
    webart.includes("vqd=''&vqd=4-real_token"));

(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
