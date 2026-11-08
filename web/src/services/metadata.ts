/**
 * Game details.
 *
 * Steam answers with a description, genres, developer, release year and artwork
 * and asks for no key. A cover from SteamGridDB or IGDB is added only when
 * those keys are in Settings, and only when Steam has no portrait.
 *
 * Nothing here is asked twice. The store is quick but not free, and the pages
 * that read it are ones a player moves through: back to a list, into another
 * game, back again to the first. So an answer is kept for the life of the
 * window, and a second look at the same game is drawn from memory instead of
 * from the network. That is also what makes looking ahead of a click possible:
 * a suggestion being pointed at can be asked about before it is chosen, and
 * choosing it then opens on an answer that is already there.
 */
import type { GameFacts, GameSuggestion, MetaData } from '../types';
import { gameFacts, gameSuggestions, metadataLookup, metadataSuggest } from './native';

/**
 * How many answers each of these keeps.
 *
 * Enough for a session's worth of browsing - a waiting list is dozens of games,
 * not thousands - and small enough that a long evening of typing names into the
 * planning search cannot grow it without end.
 */
const KEPT = 40;

/** The key a title is remembered under: case and stray spaces do not matter. */
const keyOf = (title: string) => title.trim().toLowerCase();

/**
 * A promise kept by its key, which is the point: a second ask about something
 * already being fetched joins the first rather than starting another.
 *
 * A failure is not kept. A store that did not answer is a question still open,
 * and the next attempt should be a real one rather than the same refusal.
 */
function remembered<T>(kept: Map<string, Promise<T>>, key: string, ask: () => Promise<T>): Promise<T> {
  const known = kept.get(key);
  if (known) return known;
  const started = ask().catch((error: unknown) => {
    kept.delete(key);
    throw error;
  });
  kept.set(key, started);
  // Oldest first: a Map hands back its keys in the order they went in, and a
  // promise that has already settled is still the answer to its question.
  while (kept.size > KEPT) {
    const oldest = kept.keys().next();
    if (oldest.done) break;
    kept.delete(oldest.value);
  }
  return started;
}

const searches = new Map<string, Promise<GameSuggestion[]>>();
const answers = new Map<string, GameSuggestion[]>();
const facts = new Map<string, Promise<GameFacts>>();

/**
 * Details for one title.
 *
 * With an app id the store page is read directly, which also brings the game's
 * proper name, that is what makes importing by id work when the id is all the
 * player has.
 */
export function fetchMetadata(title: string, appId?: number): Promise<MetaData> {
  return metadataLookup<MetaData>(title, appId);
}

/** Titles a store suggests while a name is being typed. */
export function searchTitles(title: string): Promise<string[]> {
  return metadataSuggest(title);
}

/**
 * The games a title suggests, as games with pictures rather than names.
 *
 * The same search is never run twice: typing a name, then a letter more, then
 * deleting that letter again, puts the first answer back on screen at once.
 * The caller still has to ignore an answer that arrives after a newer question
 * was asked - this only saves the round trip, it does not order them.
 */
export function searchGames(title: string): Promise<GameSuggestion[]> {
  const key = keyOf(title);
  if (!key) return Promise.resolve([]);
  return remembered(searches, key, () =>
    gameSuggestions(title.trim()).then((found) => {
      answers.set(key, found);
      while (answers.size > KEPT) {
        const oldest = answers.keys().next();
        if (oldest.done) break;
        answers.delete(oldest.value);
      }
      return found;
    }),
  );
}

/**
 * The answer to a search already asked, when there is one, for showing at once
 * instead of an empty list while the rest of the typing settles.
 */
export function knownGames(title: string): GameSuggestion[] | undefined {
  const key = keyOf(title);
  if (!key) return undefined;
  return answers.get(key);
}

/**
 * Everything the store can say about a game before it is anyone's.
 *
 * The planning sheet's whole page: description, prices, the people behind it,
 * how it was received, screenshots and trailers. Bonker's cache of the Steam
 * catalogue answers, the store page fills the gaps.
 *
 * Asking for an app id that is already being fetched joins that fetch, so
 * pointing at a suggestion while the search settles costs nothing and the page
 * opens on what arrived in the meantime.
 */
export function fetchFacts(appId: number): Promise<GameFacts> {
  return remembered(facts, String(appId), () => gameFacts(appId));
}

/** Whether this game's page is already in memory, so opening it will be quick. */
export function factsKnown(appId: number): boolean {
  return facts.has(String(appId));
}
