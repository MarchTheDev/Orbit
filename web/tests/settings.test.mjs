import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/data/sampleGames.ts';
import { normalizeSettings } from '../src/services/storage.ts';

const copySettings = readFileSync(new URL('../src/components/CopySettings.tsx', import.meta.url), 'utf8');
const libraryHook = readFileSync(new URL('../src/hooks/useLibrary.ts', import.meta.url), 'utf8');
const settingsView = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const addGameModal = readFileSync(new URL('../src/components/modals/AddGameModal.tsx', import.meta.url), 'utf8');

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
  syncJournal: false,
  journalOn: ['journal-game'],
  scanPath: 'C:\\Games',
  scanOnLaunch: true,
  theGamesDbApiKey: 'local-api-key',
  customThemes: [{ id: 'custom-coral', name: 'Coral', bg: '#100000', panel: '#200000', panel2: '#300000', border: '#400000', text: '#ffffff', muted: '#aaaaaa', accent: '#ff6677', accent2: '#ffaa88' }],
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
    captureShortcutsOutsideOverlay: true,
  },
};
const imported = normalizeSettings(exported);
check('overlay, sound, backlog, Journal, drive-scan, theme, and system settings survive import normalization',
  imported.overlay?.gameOnly === true && imported.overlay.openShortcut === 'Ctrl+F9' &&
    imported.overlay.layout?.fps?.pinned === true && imported.overlay.lengths?.[1] === 90 &&
    imported.overlay.shortcuts?.keys.record === 'Ctrl+F9' && imported.overlay.captureShortcutsOutsideOverlay === true && imported.sound?.file === '/music/theme.ogg' &&
    imported.launchOnStartupBackground === true && imported.openExeInOrbit === false &&
    imported.backlogOn?.[0] === 'planned-game' && imported.window.onMinimize === 'tray' &&
    imported.syncJournal === false && imported.journalOn?.[0] === 'journal-game' &&
    imported.scanPath === 'C:\\Games' && imported.customThemes?.[0]?.id === 'custom-coral' &&
    imported.futureSetting?.nested === true);
check('retired startup-scan and TheGamesDB settings are removed from saved settings',
  !('scanOnLaunch' in imported) && !('theGamesDbApiKey' in imported));
const libraries = settingsView.slice(settingsView.indexOf('id="orbit-libraries"'), settingsView.indexOf('id="orbit-details"'));
const driveCardAt = libraries.indexOf('Drive or folder');
check('Steam is followed by a manually-scanned Drive or folder card styled like the launcher cards',
  driveCardAt > libraries.indexOf("launcher.id === 'Steam'") && libraries.includes('onClick={onScanDrive}') &&
    libraries.includes('block text-sm font-semibold text-fg">Drive or folder') &&
    libraries.includes('block text-[11px] text-muted">Scan manually') &&
    !libraries.slice(driveCardAt, libraries.indexOf('</button>', driveCardAt)).includes('Rescan on Orbit launch') &&
    addGameModal.includes('<HardDrive className="size-5" />') && app.includes('onScanDrive={() => {') && !app.includes('driveScanChecked'));
check('drive scans do not run automatically on Orbit launch',
  !settingsView.includes('Review new programs at startup') && !app.includes('settings.scanOnLaunch'));
const oldImport = normalizeSettings({ theme: 'nebula' });
check('settings absent from an older copy do not retain stale target-only values',
  !('overlay' in oldImport) && !('sound' in oldImport) && !('proton' in oldImport));
check('the copy exports the whole settings object and import replaces it with defaults for new fields',
  copySettings.includes('exportCopy(path, settings, journal, sessions)') &&
    copySettings.includes('replaceSettings(imported)') &&
    libraryHook.includes('let next = normalizeSettings(incoming)'));
check('Journal and Backlog sync snapshot prior memberships and apply to new Library entries only',
  libraryHook.includes('syncMembershipSeeded !== true') && libraryHook.includes('const syncNewEntries') &&
    libraryHook.includes('next.syncJournal !== false') && libraryHook.includes('next.syncBacklog === true'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
