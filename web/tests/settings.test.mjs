import { DEFAULT_SETTINGS } from '../src/data/sampleGames.ts';

let failures = 0;
function check(name, ok) {
  console.log(`  ${ok ? 'ok   ' : 'FAIL '}${name}`);
  if (!ok) failures += 1;
}

console.log('startup and Windows integration defaults');
check('launch at sign-in is opt-in', DEFAULT_SETTINGS.launchOnStartup === false);
check('background launch is off unless requested', DEFAULT_SETTINGS.launchOnStartupBackground === false);
check('the .exe Explorer action is enabled by default', DEFAULT_SETTINGS.openExeInOrbit === true);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
