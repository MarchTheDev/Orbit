import { gameFolderFromExecutable, gameTitleFromExecutable, gameTitleFromPath } from '../src/utils/gameTitle.ts';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('game names guessed from program paths');
check(
  'uses the game folder rather than a Windows launcher name',
  gameTitleFromExecutable('C:\\Games\\Hades v1.382-win\\Hades.exe') === 'Hades',
  gameTitleFromExecutable('C:\\Games\\Hades v1.382-win\\Hades.exe'),
);
check(
  'walks up past binary folders',
  gameTitleFromExecutable('/home/player/Library/Example Game/Binaries/Win64/ExampleGame-Win64-Shipping.exe') === 'Example Game',
  gameTitleFromExecutable('/home/player/Library/Example Game/Binaries/Win64/ExampleGame-Win64-Shipping.exe'),
);
check(
  'normalizes a dropped game folder when it contains no executable',
  gameTitleFromPath('C:\\Games\\Hades v1.382-win') === 'Hades',
  gameTitleFromPath('C:\\Games\\Hades v1.382-win'),
);
check(
  'falls back to the executable name for a generic library folder',
  gameTitleFromExecutable('C:\\Games\\Control.exe') === 'Control',
  gameTitleFromExecutable('C:\\Games\\Control.exe'),
);
check(
  "finds the game's install root above bin",
  gameFolderFromExecutable('C:\\Games\\Hades\\bin\\Hades.exe') === 'C:\\Games\\Hades',
  gameFolderFromExecutable('C:\\Games\\Hades\\bin\\Hades.exe'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
