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

check('the adaptive background follows the focused Observatory game, including the initial focus',
  app.includes('page === \'library\' ? libraryFocusId : selectedId') &&
    app.includes('setLibraryFocusId(id)') && library.includes('onFocus?.(focusId)'));

const enter = tv.slice(tv.indexOf("case 'Enter':"), tv.indexOf("case 'Tab':"));
check('Enter on a Stardeck cover opens details rather than launching the game',
  enter.includes('revealLibraryDetails()') && enter.includes('revealSheet()') && !enter.includes('start()'));
check('controller confirm on a game cover opens details; only a focused action button clicks',
  tv.includes("focused?.closest<HTMLElement>('[data-tv-action]')") &&
    tv.includes("focused?.matches('[data-tv-cover]')") && !tv.includes('if (game.id === runningId) onStop();\n                            else onPlay(game);'));

check('desktop mode and quit are explicit Stardeck controls outside the Escape menu',
  tv.includes('orbit-deck-exit-actions') && tv.includes('aria-label="Return to desktop mode"') &&
    tv.includes('aria-label="Quit Orbit"') &&
    !tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('onExit'));
check('TV detail scrolling has no transient scrollbar gutter',
  details.includes('tv-details-scroll') && css.includes('.tv-details-scroll::-webkit-scrollbar') &&
    css.includes('scrollbar-width: none;'));
check('Stardeck occupies the available dynamic viewport and restores only after fullscreen exits',
  css.includes('height: 100dvh') && css.includes('[data-orbit-tv] {') &&
    app.includes('await leaveFullscreen()') && app.includes('requestAnimationFrame'));
check('Stardeck Settings has a distinct screen treatment from desktop settings',
  app.includes('className="orbit-tv-config"') && css.includes('.orbit-tv-config .orbit-settings'));
check('symbol icons use accent colour without a matching filled tile',
  css.includes('background: transparent !important;') && css.includes('color: color-mix(in srgb, var(--c-accent)'));
check('web artwork token parsing tolerates DuckDuckGo query and JSON assignment formats',
  webart.includes('JSON-style') && webart.includes('r#"<script>{"vqd":"4-json_token"}</script>"#') &&
    webart.includes('then vqd=4-real_token'));

(globalThis).__orbitFailures = ((globalThis).__orbitFailures ?? 0) + failures;
