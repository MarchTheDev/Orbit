import { gameFolderFromExecutable, gameFolderFromScan, gameTitleFromExecutable, gameTitleFromPath } from '../src/utils/gameTitle.ts';

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
  'drops a known release suffix from a scanned game folder',
  gameTitleFromPath('D:\\Games\\Red-Dead-Redemption-2-Anker') === 'Red Dead Redemption 2',
  gameTitleFromPath('D:\\Games\\Red-Dead-Redemption-2-Anker'),
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
check(
  'groups a whole-drive scan beneath a Games folder by the actual game folder',
  gameFolderFromScan('D:\\Games\\Red Dead Redemption 2\\Binaries\\x64\\RDR2.exe', 'D:\\') === 'D:\\Games\\Red Dead Redemption 2',
  gameFolderFromScan('D:\\Games\\Red Dead Redemption 2\\Binaries\\x64\\RDR2.exe', 'D:\\'),
);
check(
  'groups Steam executables beneath the game after library containers',
  gameFolderFromScan('D:\\SteamLibrary\\steamapps\\common\\Ocarina of Time\\bin\\game.exe', 'D:\\') === 'D:\\SteamLibrary\\steamapps\\common\\Ocarina of Time',
  gameFolderFromScan('D:\\SteamLibrary\\steamapps\\common\\Ocarina of Time\\bin\\game.exe', 'D:\\'),
);
check(
  'uses slash separators when scanning a selected folder on Unix',
  gameFolderFromScan('/mnt/Games/Another Game/bin/game', '/mnt/Games') === '/mnt/Games/Another Game',
  gameFolderFromScan('/mnt/Games/Another Game/bin/game', '/mnt/Games'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
