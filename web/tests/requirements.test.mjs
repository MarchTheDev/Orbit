/**
 * What runs it, read as rows.
 *
 * The store sends its requirements as one long line with labels buried in it,
 * and this turns that into the short list the planning page shows - and lifts
 * out the room the game takes, which is the number a plan is checked against a
 * full disk with.
 */
import {
  parseRequirements,
  storageOf,
  withoutStorage,
} from '../src/utils/requirements.ts';

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok   ' : 'FAIL '}${name}${!pass && detail ? `\n       ${detail}` : ''}`);
  if (!pass) failures += 1;
};

console.log('a wall of text becomes a short list');

// The shape the store actually sends: one line, no breaks, a "Minimum:" in
// front, and every label riding on the value before it.
const steam =
  'Minimum: OS: Windows 10 64-bit Processor: Intel Core i5-8400 Memory: 12 GB RAM ' +
  'Graphics: NVIDIA GeForce GTX 1060 DirectX: Version 12 Storage: 60 GB available space ' +
  'Additional Notes: an SSD is recommended';
const rows = parseRequirements(steam);
const labels = rows.map((row) => row.label);
check('every part is its own row',
  JSON.stringify(labels) === JSON.stringify(['OS', 'Processor', 'Memory', 'Graphics', 'DirectX', 'Storage', 'Additional notes']),
  JSON.stringify(labels));
check('a value ends where the next label begins', rows[0].value === 'Windows 10 64-bit', rows[0]?.value);
check('the space in a value is kept', rows[1].value === 'Intel Core i5-8400', rows[1]?.value);
check('"Minimum:" is not a requirement of its own', !labels.includes('Minimum'));

const broken =
  'OS: Windows 11\nProcessor: Ryzen 5 3600\nMemory: 16 GB RAM\nGraphics: RTX 2060\nStorage: 120 GB';
check('line breaks make no difference to the reading',
  JSON.stringify(parseRequirements(broken).map((row) => row.label)) ===
    JSON.stringify(['OS', 'Processor', 'Memory', 'Graphics', 'Storage']));

console.log('the store’s other words for the same things');

const odd = parseRequirements('Hard Drive: 8 GB available space Video Card: 2 GB VRAM Sound Card: DirectX compatible');
check('"Hard Drive" is the room it takes',
  storageOf(odd)?.size === '8 GB', JSON.stringify(odd));
check('"Video Card" is the graphics card', odd.some((row) => row.label === 'Graphics'));
check('a sound card is kept as its own row', odd.some((row) => row.label === 'Sound card'));

console.log('the room it takes, on its own');

check('a size is lifted out of the sentence', storageOf(rows)?.size === '60 GB', JSON.stringify(storageOf(rows)));
check('"available space" is not repeated back as a requirement', storageOf(rows)?.note === '');
check('a decimal is kept as written',
  storageOf([{ label: 'Storage', value: '1.5 GB available space' }])?.size === '1.5 GB');
check('a size written without a space still reads',
  storageOf([{ label: 'Storage', value: '150GB' }])?.size === '150 GB');
check('megabytes are not mistaken for gigabytes',
  storageOf([{ label: 'Storage', value: '700 MB' }])?.size === '700 MB');
check('something worth knowing underneath is kept',
  storageOf([{ label: 'Storage', value: '60 GB SSD required' }])?.note === 'SSD required');
check('a game with no stated room has none to show', storageOf(odd.filter((row) => row.label === 'Storage')) !== null);

console.log('nothing is invented');

check('a text with no labels is left for the page to print as it is',
  parseRequirements('Requires a computer, a monitor and some patience').length === 0);
check('an empty text is nothing at all', parseRequirements('   ').length === 0);
check('a label with no value after it is not a row',
  parseRequirements('OS: Windows 10 Storage: ').map((row) => row.label).join() === 'OS');
check('the same part twice is only read once',
  parseRequirements('Memory: 8 GB RAM Memory: 16 GB RAM').length === 1);
check('the room it takes is not repeated in the list',
  !withoutStorage(rows).some((row) => row.label === 'Storage'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
