import { playtimeToSeconds, splitPlaytime } from '../src/utils/format.ts';

let failures = 0;
const check = (name, pass) => {
  console.log(`  ${pass ? 'ok   ' : 'FAIL '}${name}`);
  if (!pass) failures += 1;
};

console.log('editing total playtime as hours, minutes, and seconds');
check(
  'splits a stored total into three fields',
  JSON.stringify(splitPlaytime(3 * 3600 + 17 * 60 + 42)) === JSON.stringify({ hours: 3, minutes: 17, seconds: 42 }),
);
check('keeps totals over a day in the hours field', splitPlaytime(27 * 3600).hours === 27);
check(
  'combines the three fields back into seconds',
  playtimeToSeconds({ hours: 3, minutes: 17, seconds: 42 }) === 3 * 3600 + 17 * 60 + 42,
);
check('accepts a zero total', playtimeToSeconds({ hours: 0, minutes: 0, seconds: 0 }) === 0);
check('rejects minutes above 59', playtimeToSeconds({ hours: 1, minutes: 60, seconds: 0 }) === null);
check('rejects seconds above 59', playtimeToSeconds({ hours: 1, minutes: 0, seconds: 60 }) === null);
check('rejects fractional fields', playtimeToSeconds({ hours: 1.5, minutes: 0, seconds: 0 }) === null);
check('rejects totals outside the safe integer range', playtimeToSeconds({ hours: Number.MAX_SAFE_INTEGER, minutes: 0, seconds: 0 }) === null);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
