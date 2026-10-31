import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/data/sampleGames.ts';
import { normalizeSettings } from '../src/services/storage.ts';

const copySettings = readFileSync(new URL('../src/components/CopySettings.tsx', import.meta.url), 'utf8');
const libraryHook = readFileSync(new URL('../src/hooks/useLibrary.ts', import.meta.url), 'utf8');

let failures = 0;
function check(name, ok) {
  console.log(`  ${ok ? 'ok   ' : 'FAIL '}${name}`);
  if (!ok) failures += 1;
}

console.log('startup and Windows integration defaults');
check('launch at sign-in is opt-in', DEFAULT_SETTINGS.launchOnStartup === false);
check('background launch is off unless requested', DEFAULT_SETTINGS.launchOnStartupBackground === false);
check('the .exe Explorer action is enabled by default', DEFAULT_SETTINGS.openExeInOrbit === true);

console.log('settings in an Orbit copy');
const exported = {
  theme: 'eclipse',
  openExeInOrbit: false,
  launchOnStartup: true,
  launchOnStartupBackground: true,
  updatePrerelease: true,
  futureSetting: { nested: true },
  backlogOn: ['planned-game'],
  window: { onLaunch: 'minimize', onClose: 'show', onAppClose: 'tray', onMinimize: 'tray' },
  sound: { enabled: true, volume: 0.2, unfocused: true, file: '/music/theme.ogg' },
  overlay: {
    gameOnly: true,
    openShortcut: 'Ctrl+F9',
    layoutRevision: 2,
    layout: { fps: { x: 80, y: 40, w: 210, h: 60, pinned: true } },
    lengths: [15, 90],
    shortcuts: {
      pad: { shot: { hold: 4, button: 2 }, record: { hold: 4, button: 3 }, replay: { hold: 4, button: 1 } },
      keys: { shot: 'F12', record: 'Ctrl+F9', replay: 'Alt+F9' },
    },
  },
};
const imported = normalizeSettings(exported);
check('new overlay, shortcut, layout, sound, backlog, and system settings survive import normalization',
  imported.overlay?.gameOnly === true && imported.overlay.openShortcut === 'Ctrl+F9' &&
    imported.overlay.layout?.fps?.pinned === true && imported.overlay.lengths?.[1] === 90 &&
    imported.overlay.shortcuts?.keys.record === 'Ctrl+F9' && imported.sound?.file === '/music/theme.ogg' &&
    imported.launchOnStartupBackground === true && imported.openExeInOrbit === false &&
    imported.backlogOn?.[0] === 'planned-game' && imported.window.onMinimize === 'tray' &&
    imported.futureSetting?.nested === true);
const oldImport = normalizeSettings({ theme: 'nebula' });
check('settings absent from an older copy do not retain stale target-only values',
  !('overlay' in oldImport) && !('sound' in oldImport) && !('proton' in oldImport));
check('the copy exports the whole settings object and import replaces it with defaults for new fields',
  copySettings.includes('exportCopy(path, settings, journal, sessions)') &&
    copySettings.includes('replaceSettings(imported)') &&
    libraryHook.includes('const next = normalizeSettings(incoming)'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
