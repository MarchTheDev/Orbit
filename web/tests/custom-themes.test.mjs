import { readFileSync } from 'node:fs';
import { themesFor, themeById, nativePalette, THEMES } from '../src/data/themes.ts';
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

const manager = readFileSync(new URL('../src/components/ThemeManagerWindow.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const rust = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
check('the manager provides create, edit, save/apply, and delete workflows', manager.includes('Create a theme') && manager.includes('const edit =') && manager.includes('Save and apply') && manager.includes('const remove ='));
check('the manager writes settings and notifies the main window', manager.includes('saveSettings(next)') && manager.includes("emit('theme-manager-saved', next)"));
check('the manager is mounted as a distinct window route', main.includes("theme-manager") && main.includes('ThemeManagerWindow'));
check('the desktop exposes a separate theme-manager window command', rust.includes('fn open_theme_manager') && rust.includes('"theme-manager"') && rust.includes('open_theme_manager,'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
