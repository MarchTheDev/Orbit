import type { HltbData } from '../types';
import { hltbSearch } from './native';

/**
 * HowLongToBeat, asked once per game.
 *
 * The desktop app already keeps its answers, but the trip to Rust is still a
 * trip, and the planning page asks as soon as it opens - then again for every
 * game looked at on the way back to one already seen. Remembering the promise
 * here means a game's times are in hand the moment they are wanted the second
 * time, whether or not the first answer has landed yet.
 */
const times = new Map<string, Promise<HltbData>>();

/** How many games' times are kept: a waiting list, not a website's catalogue. */
const KEPT = 60;

/**
 * HowLongToBeat has no official API. In the .exe, Rust scrapes the same search
 * endpoint the website uses and caches the answer; in a browser preview the
 * bridge returns a deterministic estimate so the UI still has something to show.
 */
export function fetchHltb(title: string): Promise<HltbData> {
  const key = title.trim().toLowerCase();
  if (!key) return Promise.reject(new Error('No title to search for.'));
  const known = times.get(key);
  if (known) return known;
  // A game nobody has times for is a question that may yet be answered as the
  // site's index grows, so that answer is not kept while a real one is.
  const started = hltbSearch<HltbData>(title.trim()).catch((error: unknown) => {
    times.delete(key);
    throw error;
  });
  times.set(key, started);
  while (times.size > KEPT) {
    const oldest = times.keys().next();
    if (oldest.done) break;
    times.delete(oldest.value);
  }
  return started;
}

/** The times already in hand, for a row that should not wait to paint. */
export function timesKnown(title: string): boolean {
  return times.has(title.trim().toLowerCase());
}
