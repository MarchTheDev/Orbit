/**
 * A cloud cover is a card in a grid, not a row in a list.
 * Dropping on the card under the pointer is that card's place.
 */
import { cardAt, takePlace } from '../src/utils/reorder.ts';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const cards = [
  { id: 'a', left: 0, top: 0, width: 100, height: 140 },
  { id: 'b', left: 110, top: 0, width: 100, height: 140 },
  { id: 'c', left: 0, top: 150, width: 100, height: 140 },
];

check('a card on the same row is not the first card', cardAt(cards, 150, 40, 'a') === 'b');
check('the card under the pointer is the target', cardAt(cards, 20, 170, 'a') === 'c');
check('the card being dragged is not a target', cardAt(cards, 20, 20, 'a') === 'b' || cardAt(cards, 20, 20, 'a') === null);
check('a drop on the dragged card itself is not a move', cardAt([{ id: 'a', left: 0, top: 0, width: 100, height: 140 }], 20, 20, 'a') === null);
check('dropping on a card takes its place', takePlace(['a', 'b', 'c'], 'a', 'c').join(',') === 'b,c,a');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
