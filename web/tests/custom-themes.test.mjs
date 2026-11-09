import { readFileSync } from 'node:fs';
import { themesFor, themeById, nativePalette, THEMES, FONTS } from '../src/data/themes.ts';
import { normalizeSettings } from '../src/services/storage.ts';

let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

const custom = {
  id: 'custom-test', name: 'Test Palette', bg: '#010203', panel: '#111213', panel2: '#212223',
  border: '#313233', text: '#f1f2f3', muted: '#a1a2a3', accent: '#414243', accent2: '#515253',
};
const all = themesFor([custom, { ...custom, id: THEMES[0].id, name: 'Collision' }]);
console.log('custom theme palettes');
check('saved custom palettes are appended to the built-ins', all.at(-1)?.id === custom.id);
check('custom themes cannot shadow a built-in id', all.filter((theme) => theme.id === THEMES[0].id).length === 1);
check('theme lookup resolves a custom palette', themeById(custom.id, [custom]).accent === custom.accent);
check('custom page background is independent of its surface colour', themeById(custom.id, [custom]).bg === '#010203' && themeById(custom.id, [custom]).panel === '#111213');
check('the native card receives the custom accent', nativePalette(custom.id, [custom]).accent === custom.accent);
check('older settings normalize with an empty custom theme list', Array.isArray(normalizeSettings({}).customThemes) && normalizeSettings({}).customThemes.length === 0);

const manager = readFileSync(new URL('../src/components/ThemeManagerPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
check('the manager provides create, edit, save/apply, and delete workflows', manager.includes('Create a theme') && manager.includes('const edit =') && manager.includes('Save and apply') && manager.includes('const remove ='));
check('the editor builds a palette from two colours and four independent styles, without a base theme', manager.includes('function paletteFromColors') && manager.includes("'graded'") && manager.includes("'dark'") && manager.includes("'light-graded'") && manager.includes("'light'") && manager.includes('primaryColor: primary') && manager.includes('secondaryColor: secondary') && !manager.includes('baseThemeId'));
check('custom dark and light surfaces are tinted clearly by the second colour', manager.includes("bg = mix('#f0f2f6', secondary, 0.09)") && manager.includes("panel2 = mix('#e9ebf0', secondary, 0.15)") && manager.includes("bg = mix('#090a0d', secondary, 0.16)") && manager.includes("panel2 = mix('#1d2028', secondary, 0.34)"));
check('the music bars blend the theme second colour with the main accent', css.includes('background: linear-gradient(to top, var(--c-accent), var(--c-accent2))'));
check('the custom editor exposes two native colour pickers and direct hex fields', manager.includes('Main colour') && manager.includes('Second colour') && manager.includes('type="color"') && manager.includes('aria-label={`${label} hex value`}') && manager.includes('Choose a colour; Orbit builds the rest'));
check('the new preview is a set of palette swatches rather than a mock Orbit screen', manager.includes('Generated palette') && manager.includes('PalettePreview') && manager.includes('Background') && manager.includes('Raised') && !manager.includes('Live app preview') && !manager.includes('Hollow Knight'));
check('the manager saves through the shared settings page state', manager.includes('setSettings(next)') && !manager.includes('saveSettings'));
check('the featured saved theme opens the in-app manager page', settings.includes('featuredCustomTheme') && settings.includes('Edit custom themes') && app.includes('ThemeManagerPage') && !app.includes('openThemeManager'));
check('Matisse EB is not offered as a selectable font', FONTS.every((font) => font.id !== 'matisse' && !font.stack.includes('Matisse EB')) && normalizeSettings({ fontFamily: 'matisse' }).fontFamily === 'system');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
