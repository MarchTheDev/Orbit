/**
 * Metadata as many fields with many owners, rather than one blob with one flag.
 *
 * The rework's whole point is that correcting one thing about a game does not
 * freeze the rest of it, and that a background lookup cannot undo a correction.
 * Both halves are checked here against the real merge, because the rules are
 * small enough to state exactly and easy to break by accident.
 */
import { readFileSync } from 'node:fs';
import {
  METADATA_FIELDS,
  coverIsWide,
  mergeMetadata,
  locksFromEdit,
  needsMetadata,
} from '../src/utils/metadataMerge.ts';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const record = (over = {}) => ({
  summary: '',
  genres: [],
  developer: '',
  releaseYear: null,
  rating: null,
  ...over,
});

console.log('metadata merge: a background fill only fills what is missing');

const sparse = record({ name: 'Hollow Knight', coverUrl: 'https://cdn/library_600x900_2x.jpg' });
const answer = record({
  name: 'Hollow Knight: Silksong',
  summary: 'A kingdom of silk and song.',
  genres: ['Metroidvania'],
  developer: 'Team Cherry',
  releaseYear: 2025,
  rating: 92,
  coverUrl: 'https://cdn/library_600x900_2x.jpg',
  source: 'steam',
});
const filled = mergeMetadata(sparse, answer, { mode: 'auto' });
check('an empty description, genre list, developer and year are filled',
  filled.summary === answer.summary && filled.genres.length === 1 &&
    filled.developer === 'Team Cherry' && filled.releaseYear === 2025 && filled.rating === 92);
check('a name that is already there is left alone', filled.name === 'Hollow Knight', String(filled.name));
check('the fill is stamped, so it is not asked for again on the next idle pass',
  typeof filled.fetchedAt === 'string' && !Number.isNaN(Date.parse(filled.fetchedAt)));
check('and each field remembers who supplied it',
  filled.fieldSources?.summary === 'steam' && filled.fieldSources?.developer === 'steam');

const good = record({ summary: 'Written by hand.', coverUrl: 'https://cdn/library_600x900_2x.jpg' });
check('a populated description survives a background answer that disagrees',
  mergeMetadata(good, answer, { mode: 'auto' }).summary === 'Written by hand.');

console.log('a wide header pretending to be a cover is the one thing auto replaces');

const wide = record({ coverUrl: 'https://cdn/header.jpg', steamAppId: '367520' });
check('a store header is recognised as wide', coverIsWide(wide));
check('a portrait from a grid is not', !coverIsWide(record({ coverUrl: 'https://steamgriddb.com/grid/1.png' })));
const portrait = record({ coverUrl: 'https://cdn/library_600x900_2x.jpg', coverSource: 'steamgriddb' });
const swapped = mergeMetadata(wide, portrait, { mode: 'auto' });
check('auto swaps the header for a real portrait', swapped.coverUrl === portrait.coverUrl);
check('and the artwork keeps its own provenance', swapped.coverSource === 'steamgriddb');
check('a portrait is never swapped for a header',
  mergeMetadata(portrait, wide, { mode: 'auto' }).coverUrl === portrait.coverUrl);

console.log('what the player corrected is locked, field by field');

const corrected = record({
  summary: 'My own words.',
  developer: 'Team Cherry',
  lockedFields: ['summary'],
  edited: true,
});
const refreshed = mergeMetadata(corrected, answer, { mode: 'manual' });
check('a locked description survives a manual refresh', refreshed.summary === 'My own words.');
check('an unlocked developer is refreshed by the same press', refreshed.developer === 'Team Cherry');
check('the lock is still there afterwards', refreshed.lockedFields?.includes('summary'));

const chosen = record({ coverUrl: 'file:///mine.png', coverUrlCustom: true, backgroundUrl: 'file:///back.png', backgroundUrlCustom: true });
const overArt = mergeMetadata(chosen, { ...answer, coverUrl: 'https://cdn/other.jpg', backgroundUrl: 'https://cdn/bg.jpg' }, { mode: 'manual' });
check('artwork chosen by the player is never replaced, even by a manual refresh',
  overArt.coverUrl === 'file:///mine.png' && overArt.backgroundUrl === 'file:///back.png');

const justLocked = mergeMetadata(corrected, answer, { mode: 'manual', justLocked: ['developer'] });
check('a field corrected in this very edit is locked before the merge runs',
  justLocked.developer === 'Team Cherry' && justLocked.lockedFields?.includes('developer'));

console.log('an older record with one edited flag is treated as player-owned');

const legacy = record({ summary: 'Typed in years ago.', developer: 'Team Cherry', edited: true });
const legacyFill = mergeMetadata(legacy, answer, { mode: 'manual' });
check('every field it already had is kept', legacyFill.summary === 'Typed in years ago.' && legacyFill.developer === 'Team Cherry');
check('and the gaps in it are still filled', legacyFill.releaseYear === 2025 && legacyFill.genres.length === 1);
check('those fields become explicit locks, so the next merge does not have to guess',
  legacyFill.lockedFields?.includes('summary') && legacyFill.lockedFields?.includes('developer'));

console.log('only what changed becomes a lock');

const before = record({ name: 'Hollow Knight', summary: 'Old words.', developer: 'Team Cherry' });
const after = { ...before, summary: 'New words.', steamAppId: '367520' };
const locks = locksFromEdit(before, after);
check('the corrected field is locked', locks.includes('summary'));
check('the untouched ones are not', !locks.includes('developer') && !locks.includes('name'));
check('choosing a catalogue match is not locking the app id', !locks.includes('steamAppId'));
check('every field the merge knows about is a field an edit can lock',
  METADATA_FIELDS.filter((field) => field !== 'steamAppId').every((field) => typeof field === 'string'));

console.log('a lookup is asked for when it is worth asking');

const game = (meta, over = {}) => ({ id: 'g', title: 'A Game', planned: false, ...over, meta });
check('a game with no record needs one', needsMetadata(game(undefined)));
check('a plan is not looked up', !needsMetadata(game(record({ summary: 'x', coverUrl: 'https://cdn/library_600x900_2x.jpg' }), { planned: true })));
check('a missing description asks', needsMetadata(game(record({ coverUrl: 'https://cdn/library_600x900_2x.jpg' }))));
check('a header standing in for a cover asks', needsMetadata(game(record({ summary: 'x', coverUrl: 'https://cdn/header.jpg' }))));
const complete = record({ summary: 'x', coverUrl: 'https://cdn/library_600x900_2x.jpg' });
check('a complete record fetched just now does not', !needsMetadata(game({ ...complete, fetchedAt: new Date().toISOString() })));
check('the same record a fortnight later does',
  needsMetadata(game({ ...complete, fetchedAt: new Date(Date.now() - 14 * 864e5).toISOString() })));
check('an older record with no stamp is kept until it is asked for', !needsMetadata(game(complete)));

console.log('adding a game keeps what was reviewed and still fills the rest');

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const handleAdd = app.slice(app.indexOf('const handleAdd'), app.indexOf('const handleAddRef'));
check('the add flow looks the game up rather than refusing to when details were reviewed',
  handleAdd.includes('fetchMetadata(g.title') && !handleAdd.includes('reviewedByPlayer'));
check('and what it finds goes through the per-field merge, not over the record',
  handleAdd.includes("updateGame(g.id, patch, 'auto')"));
const library = readFileSync(new URL('../src/hooks/useLibrary.ts', import.meta.url), 'utf8');
check('an automatic write is merged against what the game already had',
  library.includes("origin === 'auto'") && library.includes("mergeMetadata(target.meta, next.meta, { mode: 'auto' })"));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
