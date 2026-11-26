/**
 * Round eleven: the Journal is the player's, the plates go where the picture is,
 * and a search lands on the setting it named.
 *
 * Source checks, in the shape of the rounds before them. What is pinned here is
 * not a pixel: it is that each decision holds where it was made - launching a
 * game writes nothing, a Settings search result carries an anchor that exists,
 * the deck's sheet is sized for a sofa, and an icon is a tint rather than a
 * fill.
 */
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, ok) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
};
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/index.css');
const app = read('../src/App.tsx');
const tv = read('../src/components/TvMode.tsx');
const details = read('../src/components/TvDetails.tsx');
const settings = read('../src/components/SettingsView.tsx');
const library = read('../src/components/LibraryView.tsx');
const editDialog = read('../src/components/detail/GameEditDialog.tsx');
const navigation = read('../src/utils/settingsNavigation.ts');
const dbRs = read('../src-tauri/src/db.rs');

console.log('the Journal is written by the player');

check('a launch writes no "Started playing" line of its own',
  !app.includes("'Started playing'") && !app.includes('addGameLog(') &&
    app.includes("dispatchEvent(new Event('orbit-journal-changed'))"));

check('the one automatic line is the backend\'s, and only on the first launch',
  dbRs.includes('pub fn add_started_log_if_first') &&
    /SCHEMA_VERSION: i64 = 9/.test(dbRs) && dbRs.includes('fn upgrade_to_9'));

check('the cleanup keeps one line per game and playthrough, the earliest',
  /DELETE FROM game_logs[\s\S]{0,300}note = 'Started playing'[\s\S]{0,300}MIN\(id\)[\s\S]{0,300}GROUP BY game_id/.test(dbRs));

console.log('type gets a plate where the picture is, and nowhere else');

check('a page title is a title, not a boxed card', !/\.orbit-pagehead \{[^}]*backdrop-filter/.test(css));
check('nor does the sentence under it wear one',
  !/\.orbit-pagehead-lead \{[^}]*background: color-mix/.test(css) &&
    !/\.orbit-setsec-lead \{[^}]*background: color-mix/.test(css));
check('the game page\'s own words sit on a plate, because they sit on its art',
  library.includes('orbit-gamepage-plate') && /\.orbit-gamepage-plate \{[^}]*backdrop-filter/.test(css));

console.log('the Stardeck room');

check('no cover stands on a reflection of itself',
  !tv.includes('orbit-deck-floor') && !css.includes('.orbit-deck-floor'));
check('the room behind the covers is lit brighter than a dimmed cover',
  /\.orbit-deckbackdrop-layer \{[^}]*filter: blur\(\d+px\) saturate\([\d.]+\) brightness\(1\.\d+\)/.test(css));
check('the full details page is sized to be read from across the room, with tabs',
  details.includes('data-tv-game-title') && details.includes('role="tablist"') &&
    details.includes('overview') && details.includes('details') && details.includes('journal') &&
    details.includes('bg-[#0d0b18]/85'));

console.log('icons are a tint, never a fill');

check('the launcher and release marks are accent at a whisper',
  /\.orbit-launchentry-icon \{[^}]*background: color-mix\(in srgb, var\(--c-accent\) 9%, transparent\)/.test(css) &&
    /\.orbit-release-icon \{[^}]*background: color-mix\(in srgb, var\(--c-accent\) 9%, transparent\)/.test(css) &&
    !/\.orbit-launchentry-icon \{[^}]*var\(--c-accent\) 1[4-9]%/.test(css));

console.log('a Settings search is a way to one setting');

const entries = [...settings.matchAll(
  /\{ label: '([^']+)', section: '([^']+)', keywords: '([^']+)'(?:, anchor: '([^']+)')? \}/g,
)].map((match) => ({ label: match[1], section: match[2], anchor: match[4] }));
const derive = (label) => `set-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const anchors = new Set([
  ...[...settings.matchAll(/anchorFor\('([^']+)'\)/g)].map((match) => derive(match[1])),
  ...[...settings.matchAll(/anchor: '([^']+)'/g)].map((match) => match[1]),
]);

check('every result names a control that is on the page',
  entries.length > 30 && entries.every((item) => anchors.has(item.anchor ?? derive(item.label))));
check('a result is a press, and it carries the anchor it named',
  settings.includes('onClick={() => jump(id, entry.anchor)}'));
check('the jump travels to that control, not just the top of the card',
  settings.includes("const target = (anchor && document.getElementById(anchor)) || card;") &&
    settings.includes("scrollSettingsSectionToTop(target, 'smooth', { always: target !== card })"));
check('the control is marked for a moment, so the eye lands on it',
  settings.includes("target.classList.add('settings-spot')") && css.includes('.settings-spot'));
check('the scroll helper knows the difference between a card and a row',
  navigation.includes('always = false') && navigation.includes('if (!always && scroller.scrollTop <= 0'));

console.log('the game editor is tighter');

check('the dialog is a page about one game rather than a window the size of the library',
  editDialog.includes('panelClassName="orbit-modaledit"') &&
    /\.orbit-modaledit \{ max-width: 64rem; \}/.test(css));
check('a short page fills its width instead of stacking down one column',
  /\.orbit-settings-page \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(19rem/.test(css));
check('and the artwork is a header, not half the page',
  /\.orbit-gameart \{[^}]*height: clamp\(8rem, 18vh, 10\.5rem\)/.test(css));

if (failures) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
