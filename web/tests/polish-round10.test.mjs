/**
 * Round ten: the deck is only the covers, the editor says one thing per page,
 * and a search actually has something to show.
 *
 * These are source checks rather than rendered ones, in the same shape as the
 * rounds before them: what is being pinned is that a decision made in this
 * round stays made - the sheet does not creep back onto the deck by default,
 * the sidebar does not shrink back to a mouse-sized panel, and the artwork
 * picker keeps asking more than one source.
 */
import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/index.css');
const tv = read('../src/components/TvMode.tsx');
const settings = read('../src/components/SettingsView.tsx');
const edit = read('../src/components/detail/GameEditTab.tsx');
const launch = read('../src/components/detail/LaunchEditor.tsx');
const picker = read('../src/components/detail/ArtworkPicker.tsx');
const adaptive = read('../src/components/AdaptiveBackdrop.tsx');
const library = read('../src/components/LibraryView.tsx');
const tvService = read('../src/services/tv.ts');
const libRs = read('../src-tauri/src/lib.rs');
const webart = read('../src-tauri/src/webart.rs');

check('the selected game’s panel is shut until its cover is pressed',
  tv.includes('const [sheetOpen, setSheetOpen] = useState(false)') &&
    tv.includes('{sheetOpen && (') && tv.includes('setSheetOpen((open) => !open)') &&
    tv.includes('onClose={() => setSheetOpen(false)}'));

check('and there is no glow behind its cover, and no name under a deck cover',
  !tv.includes('orbit-decksheet-glow') && !css.includes('.orbit-decksheet-glow {') &&
    !tv.includes('orbit-deck-name'));

check('the covers stand on a reflection of themselves',
  tv.includes('orbit-deck-floor') && css.includes('.orbit-deck-floor') &&
    /\.orbit-deck \.orbit-deck-floor \{[^}]*mask-image/.test(css));

check('the room behind the deck is glass, still blurred hard',
  tv.includes('orbit-deckbackdrop-glass') && css.includes('.orbit-deckbackdrop-glass') &&
    css.includes('filter: blur(64px) saturate(1.3) brightness(1.02)'));

check('Escape opens a menu sized for a television, with no About page in it',
  /\.orbit-deckside \{[^}]*width: min\(34rem/.test(css) &&
    !tv.includes('About Stardeck') && !tv.includes("'about'") &&
    tv.includes('Back to desktop'));

check('leaving Stardeck gives back only the fullscreen Orbit itself took',
  tvService.includes('let weWentFullscreen = false') &&
    tvService.includes('if (ours && (await window.isFullscreen().catch(() => false)))'));

check('icons are drawn in a tint of the accent rather than filled with it',
  css.includes('.orbit-setnav-icon,') &&
    /\.orbit-setsec-icon,[\s\S]{0,320}color: color-mix\(in srgb, var\(--c-accent\) 68%, var\(--c-muted\)\)/.test(css) &&
    !/\.orbit-play \{[\s\S]{0,400}linear-gradient\(135deg, color-mix\(in srgb, var\(--c-accent\) 92%/.test(css));

check('a body of text over artwork has its own backing, a title does not',
  /\.orbit-setsec-lead \{[\s\S]{0,700}background: color-mix\(in srgb, var\(--c-bg\) 62%/.test(css) &&
    /\.orbit-pagehead-lead \{[\s\S]{0,700}background: color-mix\(in srgb, var\(--c-bg\) 62%/.test(css) &&
    !/\.orbit-setsec-head h2 \{[\s\S]{0,200}background:/.test(css) &&
    !/\.orbit-pagehead h1 \{[\s\S]{0,200}background:/.test(css));

check('the settings lens belongs to its field, and a search names what it found inside a section',
  settings.includes('orbit-setsearch-lens') && css.includes('.orbit-setsearch-lens') &&
    settings.includes('matchingItems') && settings.includes('orbit-setnav-found') &&
    css.includes('.orbit-setnav-found'));

check('the editor has an Extra page between Launch and Tools',
  edit.includes("type Page = 'game' | 'launch' | 'extra' | 'tools' | 'wine' | 'saves'") &&
    edit.indexOf("label: 'Launch'") < edit.indexOf("label: 'Extra'") &&
    edit.indexOf("label: 'Extra'") < edit.indexOf("label: 'Tools'") &&
    edit.includes('section="extra"'));

check('Alternative launch is named as such, and Tools carries ReShade',
  launch.includes('Alternative launch') && !launch.includes('Another way to launch it') &&
    edit.includes('Use ReShade with this game'));

check('the artwork picker asks the stores and the web, in the slot’s own shape',
  picker.includes('Starts with the game') === false &&
    edit.includes('findWebWideArt') && edit.includes('findBackdropArtwork') &&
    libRs.includes('artwork_web_wide') && libRs.includes('webart::wide_covers') &&
    webart.includes('pub async fn wide_covers') && webart.includes('fn landscapes'));

check('a cover search offers the web beside the store instead of only when it is empty',
  /if page == 0 \{\s*\n\s*match webart::covers/.test(libRs));

check('the game page’s facts are one panel in two columns, with the folder on its own line',
  library.includes('orbit-gamepage-facts') && library.includes('orbit-fact-wide') &&
    css.includes('.orbit-gamepage-facts .orbit-facts') &&
    /\.orbit-gamepage-facts \.orbit-facts \{[\s\S]{0,200}grid-template-columns: repeat\(2/.test(css));

check('the app’s background follows a game’s banner, not its poster',
  adaptive.includes('wideArtImmediateFallback') && adaptive.includes('resolveWideArt') &&
    adaptive.indexOf('wideArtImmediateFallback(game)') < adaptive.indexOf('coverArtCandidates(game)[0]'));

if (failures) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
