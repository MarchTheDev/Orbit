import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/index.css');
const tv = read('../src/components/TvMode.tsx');
const settings = read('../src/components/SettingsView.tsx');
const app = read('../src/App.tsx');
const types = read('../src/types.ts');
const tvService = read('../src/services/tv.ts');
const library = read('../src/components/LibraryView.tsx');
const adaptive = read('../src/components/AdaptiveBackdrop.tsx');

check('Stardeck has no top bar, and Deck and Library float on the picture as pills',
  !css.includes('.orbit-deck-topbar') && tv.includes('data-tv-pills') &&
    tv.includes('orbit-deck-pillbtn') && css.includes('.orbit-deck-pills'));

check('Escape opens a hamburger menu with desktop mode and Quit Orbit actions inside it',
  css.includes('.orbit-deckside') && /justify-content: flex-start/.test(css) &&
    tv.includes('aria-label="Stardeck menu"') && tv.includes('className="orbit-deck-hamburger"') &&
    tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('Desktop mode') &&
    tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('Quit Orbit') &&
    !tv.includes('aria-label="Quit Orbit"') && !tv.includes('aria-label="Return to desktop mode"') &&
    !tv.includes('Reset Stardeck to its defaults') && tv.includes('Orbit settings') && tv.includes('Add a game'));

check('the selected game is a floating sheet on the left, not a strip under the row',
  css.includes('.orbit-decksheet') && /\.orbit-decksheet \{[^}]*left:/.test(css) &&
    tv.includes('data-deck-sheet') && tv.includes('<GameSheet') &&
    !tv.includes('orbit-deck-stage'));

check('the sheet carries Play, the star, the game settings and the full page',
  tv.includes('data-tv-action="play"') && tv.includes('data-tv-action="favourite"') &&
    tv.includes('data-tv-action="edit"') && tv.includes('data-tv-action="details"'));

check('the room is lit by the selected game’s cover, blurred and cross-fading',
  tv.includes('function DeckBackdrop') && css.includes('.orbit-deckbackdrop-layer') &&
    /\.orbit-deckbackdrop-layer \{[^}]*filter: blur\(\d+px\)/.test(css) && css.includes('@keyframes deck-backdrop-in'));

check('the app’s background can follow the game, and off is today’s look',
  types.includes('adaptiveBackground?: boolean') && app.includes('<AdaptiveBackdrop') &&
    adaptive.includes('orbit-adaptive-layer') && settings.includes('Background follows the game') &&
    css.includes('.orbit-adaptive-shade'));

// Round eleven took the plates off the flat pages and put one where the type
// really is over a picture: the game's hero and Stardeck's own overlays.
check('type that sits on artwork gets a plate behind it, and a page title does not',
  /\.orbit-gamepage-plate \{[^}]*backdrop-filter/.test(css) &&
    /\.orbit-setsec-head \{[^}]*backdrop-filter/.test(css) && css.includes('.orbit-deck-plate') &&
    !/\.orbit-pagehead \{[^}]*backdrop-filter/.test(css));

check('the settings rail is a column of icon tiles and the search filters it',
  settings.includes("icon: Palette") && settings.includes('orbit-setnav-icon') &&
    settings.includes('matchingSections') && settings.includes('shownSections') &&
    !settings.includes('searchResults.map') && css.includes('.orbit-setnav-icon'));

check('the Observatory shelf tints on hover and carries the star, with no native tooltip',
  library.includes('function ShelfTile') && library.includes('useHoverTint') &&
    library.includes('orbit-shelf-star') && css.includes('.orbit-shelf-tint') &&
    !/orbit-shelf-tile[\\s\\S]{0,400}title=\{game\\.title\\}/.test(library));

check('the window’s placement survives Stardeck, so leaving never hands back a fullscreen box',
  tvService.includes("const BOUNDS_KEY = 'orbit.window.bounds'") &&
    tvService.includes('rememberBounds(previousNativeBounds)') &&
    tvService.includes('previousNativeBounds ?? savedBounds()'));

if (failures) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\nevery check passed');
