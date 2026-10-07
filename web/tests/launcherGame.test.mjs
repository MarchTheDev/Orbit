import { gameFromLauncher, newLauncherGames, normalizeInstallPath } from '../src/utils/launcherGame.ts';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const row = (launcher, name, installDir) => ({
  launcher,
  name,
  installDir,
  exePath: null,
  sizeBytes: 0,
});
const existing = [{ title: 'Already owned', installDir: 'C:\\Games\\Owned' }];
const found = [
  row('Epic Games', 'Already owned', 'C:\\Games\\Owned'),
  row('GOG Galaxy', 'A new game', 'D:\\Games\\New'),
  row('EA app', 'A NEW GAME', 'E:\\Games\\Duplicate title'),
  row('Ubisoft Connect', 'Another game', 'f:/games/another/'),
];

console.log('local launcher import preparation');
check('normalizes Windows paths independent of separators and case', normalizeInstallPath('C:/Games/Test/') === 'c:\\games\\test');
check(
  'skips games already known by install path or title and de-duplicates a scan',
  newLauncherGames(found, existing).map((game) => game.name).join(',') === 'A new game,Another game',
);
const imported = gameFromLauncher(row('Epic Games', 'Timer-only game', 'C:\\Games\\Timer'));
check('keeps imported games timer-only until the player chooses a launch target', imported.launch.kind === 'none' && imported.exePath === null);
check('puts the imported game in the Library and keeps its install folder', imported.inLibrary === true && imported.installDir === 'C:\\Games\\Timer');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
