import { readFileSync } from 'node:fs';
import { launcherOn } from '../src/data/launchers.ts';

let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

console.log('OS-specific Add Game library choices');
check('Windows excludes Linux-only libraries but keeps cross-platform Heroic', !launcherOn('Lutris', 'windows') && launcherOn('Heroic Games Library', 'windows'));
check('Linux excludes Windows-only libraries', !launcherOn('Epic Games', 'linux') && !launcherOn('Xbox', 'linux') && !launcherOn('EA app', 'linux'));
check('Steam remains available on both desktops', launcherOn('Steam', 'windows') && launcherOn('Steam', 'linux'));
const addGame = readFileSync(new URL('../src/components/modals/AddGameModal.tsx', import.meta.url), 'utf8');
check('the Add Game picker filters its launcher rows by the current desktop OS', addGame.includes('LAUNCHERS.filter((launcher) => launcherOn(launcher.id, desktopOs()))'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
