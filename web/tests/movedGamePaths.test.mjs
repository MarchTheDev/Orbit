import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';
import { movedGamePaths } from '../src/utils/movedGamePaths.ts';
import { rebasePath } from '../src/utils/paths.ts';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('paths after moving a game');
const oldRoot = 'C:\\Games\\Hades';
const newRoot = 'E:\\Library\\Hades';
const game = {
  ...SAMPLE_GAMES[0],
  drive: 'C:',
  installDir: oldRoot,
  exePath: `${oldRoot}\\Hades.exe`,
  launch: {
    kind: 'executable',
    path: `${oldRoot}\\bin\\HadesLauncher.exe`,
    args: '--start',
    workingDir: `${oldRoot}\\bin`,
  },
  coverPath: `${oldRoot}\\cover.png`,
  companions: [
    { path: `${oldRoot}\\tools\\overlay.exe`, args: '--quiet' },
    { path: 'C:\\Tools\\outside.exe', args: '' },
  ],
};
const moved = movedGamePaths(game, {
  installDir: `${newRoot}\\bin`,
  fromDir: oldRoot,
  toDir: newRoot,
});
check('keeps the recorded install directory under the destination game folder',
  moved.installDir === `${newRoot}\\bin`);
check('updates the executable shown in the library and the drive',
  moved.exePath === `${newRoot}\\Hades.exe` && moved.drive === 'E:');
check('updates the executable path and working directory that Play actually uses',
  moved.launch.kind === 'executable' &&
    moved.launch.path === `${newRoot}\\bin\\HadesLauncher.exe` &&
    moved.launch.workingDir === `${newRoot}\\bin`);
check('updates local covers and companion tools moved with the game',
  moved.coverPath === `${newRoot}\\cover.png` &&
    moved.companions[0].path === `${newRoot}\\tools\\overlay.exe`);
check('leaves companion tools outside the moved folder untouched',
  moved.companions[1].path === 'C:\\Tools\\outside.exe');
check('matches Windows paths regardless of case and separator spelling',
  rebasePath('c:/games/hades/bin/Hades.exe', oldRoot, newRoot) === `${newRoot}\\bin\\Hades.exe`);
check('does not rewrite a similarly named sibling folder',
  rebasePath('C:\\Games2\\Hades.exe', 'C:\\Games', newRoot) === 'C:\\Games2\\Hades.exe');
check('uses the destination platform separator for Unix paths',
  rebasePath('/mnt/old/Hades/bin/game', '/mnt/old/Hades', '/media/new/Hades') === '/media/new/Hades/bin/game');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
