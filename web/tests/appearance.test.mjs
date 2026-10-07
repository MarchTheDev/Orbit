import { FONTS } from '../src/data/themes.ts';

let failures = 0;
const check = (name, pass) => {
  console.log(`  ${pass ? 'ok   ' : 'FAIL '}${name}`);
  if (!pass) failures += 1;
};

console.log('font choices');
const orbitSans = FONTS.find((font) => font.id === 'system');
const humanist = FONTS.find((font) => font.id === 'humanist');
check('Humanist uses a distinct, screen-friendly font stack', humanist?.stack === 'Verdana, Geneva, sans-serif');
check('Humanist is not the Orbit Sans stack', !!humanist && !!orbitSans && humanist.stack !== orbitSans.stack);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
