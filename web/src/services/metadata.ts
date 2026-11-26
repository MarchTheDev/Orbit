/**
 * Game details, asked once and remembered.
 *
 * The store is quick but not free, and the pages that read it are ones a player
 * moves through: back to a list, into another game, back again to the first.
 * Answers are therefore kept in memory for the life of the window and on disk
 * for the next one, keyed by the catalogue id when there is one and by the
 * normalized title otherwise. A second look at the same game is drawn from the
 * cache instead of from the network, and a lookup already in flight is joined
 * rather than started again.
 *
 * Merging is field-level (see utils/metadataMerge): a background fill never
 * replaces a field the player corrected, and a manual refresh replaces only the
 * fields that are still unlocked.
 */
import type { Game, GameFacts, GameSuggestion, MetaData } from '../types';
import { gameFacts, gameSuggestions, metadataLookup, metadataSuggest } from './native';
import { clearHltbCache } from './hltb';
import { mergeMetadata, needsMetadata } from '../utils/metadataMerge';

const KEPT = 80;
const CACHE_KEY = 'orbit.metadata.cache.v2';
const CACHE_TTL = 6 * 60 * 60 * 1000;

export const normalizeTitle = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const keyOf = (title: string, appId?: number | null): string =>
  appId ? `app:${appId}` : `title:${normalizeTitle(title)}`;

interface CacheEntry {
  at: number;
  meta: MetaData;
}

function readCache(): Map<string, CacheEntry> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]') as [string, CacheEntry][];
    if (!Array.isArray(raw)) return new Map();
    const now = Date.now();
    return new Map(raw.filter(([, entry]) => entry && now - entry.at < CACHE_TTL));
  } catch {
    return new Map();
  }
}

const disk = readCache();
const inflight = new Map<string, Promise<MetaData>>();
const titleSuggestions = new Map<string, Promise<string[]>>();
const searches = new Map<string, Promise<GameSuggestion[]>>();
const answers = new Map<string, GameSuggestion[]>();
const facts = new Map<string, Promise<GameFacts>>();

function persist(): void {
  try {
    const entries = [...disk.entries()].slice(-KEPT);
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* A locked-down browser keeps the cache for this session only. */
  }
}

function remembered<T>(kept: Map<string, Promise<T>>, key: string, ask: () => Promise<T>): Promise<T> {
  const known = kept.get(key);
  if (known) return known;
  const started = ask().catch((error: unknown) => {
    kept.delete(key);
    throw error;
  });
  kept.set(key, started);
  while (kept.size > KEPT) {
    const oldest = kept.keys().next();
    if (oldest.done) break;
    kept.delete(oldest.value);
  }
  return started;
}

export interface FetchOptions {
  force?: boolean;
}

/** Details for one title, or one catalogue id when the match is already known. */
export function fetchMetadata(title: string, appId?: number | null, { force = false }: FetchOptions = {}): Promise<MetaData> {
  const clean = title.trim();
  const key = keyOf(clean, appId);
  if (!clean && !appId) return Promise.reject(new Error('No title to look up.'));

  if (!force) {
    const cached = disk.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL) return Promise.resolve(cached.meta);
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const started = metadataLookup<MetaData>(clean, appId ?? undefined)
    .then((meta) => {
      // A browser-preview stand-in is not a catalogue answer worth keeping.
      if (meta && meta.source !== 'estimate' && meta.source !== 'none') {
        disk.set(key, { at: Date.now(), meta });
        while (disk.size > KEPT) {
          const oldest = disk.keys().next();
          if (oldest.done) break;
          disk.delete(oldest.value);
        }
        persist();
      }
      return meta;
    })
    .catch((error: unknown) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, started);
  void started.finally(() => {
    if (inflight.get(key) === started) inflight.delete(key);
  });
  return started;
}

/**
 * Refresh one game's record, keeping every field the player owns.
 *
 * `auto` is the quiet background fill; `manual` is the editor's Refresh button.
 * Both return the merged record, or null when the store had nothing to add.
 */
export async function refreshGameMetadata(
  game: Game,
  mode: 'auto' | 'manual' = 'manual',
  options: FetchOptions = {},
): Promise<MetaData | null> {
  const appId = game.meta?.steamAppId ?? (game.launch.kind === 'steam' ? game.launch.appId : null);
  const found = await fetchMetadata(game.title, appId, options);
  if (!found) return null;
  return mergeMetadata(game.meta, found, { mode });
}

/** Whether the background queue should ask about this game. */
export { needsMetadata };

/** Titles a store suggests while a name is being typed. */
export function searchTitles(title: string): Promise<string[]> {
  const key = normalizeTitle(title);
  if (key.length < 2) return Promise.resolve([]);
  return remembered(titleSuggestions, key, () => metadataSuggest(title.trim()));
}

/** Forget cached answers after source settings or provider credentials change. */
export function clearMetadataCache(): void {
  titleSuggestions.clear();
  searches.clear();
  answers.clear();
  facts.clear();
  inflight.clear();
  disk.clear();
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Nothing to forget if storage was never available. */
  }
  clearHltbCache();
}

/** The games a title suggests, as games with pictures rather than names. */
export function searchGames(title: string): Promise<GameSuggestion[]> {
  const key = normalizeTitle(title);
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

export function knownGames(title: string): GameSuggestion[] | undefined {
  const key = normalizeTitle(title);
  if (!key) return undefined;
  return answers.get(key);
}

/** Everything the store can say about a game before it is anyone's. */
export function fetchFacts(appId: number): Promise<GameFacts> {
  return remembered(facts, String(appId), () => gameFacts(appId));
}

export function factsKnown(appId: number): boolean {
  return facts.has(String(appId));
}
