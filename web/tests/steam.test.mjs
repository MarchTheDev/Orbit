import { isSteamGame, storeAppId } from '../src/utils/steam.ts';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const storeLookupOnly = {
  title: 'A locally installed game',
  launch: { kind: 'executable', path: '/games/example/game', args: '', workingDir: '/games/example' },
  meta: { steamAppId: 12345, source: 'steam' },
};
const realSteamImport = {
  title: 'A Steam library game',
  launch: { kind: 'steam', appId: 12345 },
  meta: { steamAppId: 12345, source: 'steam' },
};

console.log('Steam imports and Steam catalogue matches');
check('a catalogue lookup is not classified as a Steam import', !isSteamGame(storeLookupOnly));
check('a Steam launch target is classified as an import', isSteamGame(realSteamImport));
check('catalogue app ids remain available for store features', storeAppId(storeLookupOnly) === 12345);
check('Steam launch targets supply their own app id', storeAppId(realSteamImport) === 12345);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
