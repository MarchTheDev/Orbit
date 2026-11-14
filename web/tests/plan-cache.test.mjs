/**
 * The two questions the planning page asks most often, asked once.
 *
 * A search and a game's times are each remembered by what was asked, promise
 * and all: the same question is answered from the first request rather than
 * beginning a second, which is what makes going back through a list of games,
 * or deleting a letter and typing it again, feel like nothing happened.
 */
import { fetchFacts, fetchMetadata, knownGames, searchGames } from '../src/services/metadata.ts';
import { fetchHltb, timesKnown } from '../src/services/hltb.ts';

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok   ' : 'FAIL '}${name}${!pass && detail ? `\n       ${detail}` : ''}`);
  if (!pass) failures += 1;
};

console.log('a search is remembered by its name');

const first = searchGames('Hollow Knight');
const same = searchGames('  hollow KNIGHT  ');
check('the same name asked twice is the same request, not two', first === same);
check('a different name is its own request', searchGames('Hades') !== first);

const found = await first;
check('the answer is kept for a list that wants it before the store replies again',
  knownGames('hollow knight') === found);
check('nothing is remembered for a name too short to ask about', knownGames('h') === undefined);

console.log('a game is not asked about twice');

const facts = fetchFacts(4242);
check('facts for one app id join the request already in flight', fetchFacts(4242) === facts);
check('facts for another app id are their own', fetchFacts(4243) !== facts);
await facts;

const times = fetchHltb('Hollow Knight');
check("a game's times join the request already in flight", fetchHltb('hollow KNIGHT') === times);
check('the times are known once they have been asked for', timesKnown('hollow knight'));
await times;

console.log('a lookup that is not a game is still a lookup');

check('an empty title is refused rather than asked about', await fetchHltb('  ').then(() => false, () => true));

console.log('the dialogs and pages still know their own shapes');

// The add dialog's own lookup is not cached: a player changing a title and
// changing it back should be able to ask for fresh details on purpose.
check('a deliberate metadata lookup is never answered from a cache',
  fetchMetadata('Hollow Knight') !== fetchMetadata('Hollow Knight'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
