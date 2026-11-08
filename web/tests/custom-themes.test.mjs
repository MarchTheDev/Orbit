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
check('the native card receives the custom accent', nativePalette(custom.id, [custom]).accent === custom.accent);
check('older settings normalize with an empty custom theme list', Array.isArray(normalizeSettings({}).customThemes) && normalizeSettings({}).customThemes.length === 0);

const manager = readFileSync(new URL('../src/components/ThemeManagerPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
check('the manager provides create, edit, save/apply, and delete workflows', manager.includes('Create a theme') && manager.includes('const edit =') && manager.includes('Save and apply') && manager.includes('const remove ='));
check('the editor uses four coordinated colours and derives background, border, muted and contrast colours', manager.includes("key: 'panel'") && manager.includes("key: 'accent2'") && manager.includes('function derivePalette') && !manager.includes("key: 'bg'") && !manager.includes("key: 'border'"));
check('colour controls use a styled swatch and compact hex input', manager.includes('opacity-0') && manager.includes('rounded-2xl border border-line bg-panel2/50'));
check('the manager saves through the shared settings page state', manager.includes('setSettings(next)') && !manager.includes('saveSettings'));
check('the featured saved theme opens the in-app manager page', settings.includes('featuredCustomTheme') && settings.includes('Edit custom themes') && app.includes('ThemeManagerPage') && !app.includes('openThemeManager'));
check('Matisse EB is offered as a local font stack without bundling a third-party font', FONTS.some((font) => font.id === 'matisse' && font.stack.includes('Matisse EB') && font.sample.includes('if installed')));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
