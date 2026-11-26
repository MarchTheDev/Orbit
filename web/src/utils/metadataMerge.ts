import type { Game, MetaData } from '../types';

/**
 * Metadata as a record, not a blob.
 *
 * Heronite's lesson is that a game's details are many independent fields with
 * independent owners. Orbit used to treat `meta.edited` as one switch: correcting
 * a cover froze the description, the year and the genres forever, and a failed
 * lookup could still replace a good record with a worse one. These helpers keep
 * the ownership per field instead.
 */

export const METADATA_FIELDS = [
  'name',
  'summary',
  'genres',
  'developer',
  'releaseYear',
  'releaseDate',
  'rating',
  'coverUrl',
  'headerUrl',
  'backgroundUrl',
  'steamAppId',
] as const;

export type MetadataField = (typeof METADATA_FIELDS)[number];

const empty = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

export function baseMeta(meta?: MetaData): MetaData {
  return {
    summary: '',
    genres: [],
    developer: '',
    releaseYear: null,
    rating: null,
    ...meta,
  };
}

/** A wide store header masquerading as a portrait cover. */
export function coverIsWide(meta?: MetaData): boolean {
  const cover = meta?.coverUrl ?? '';
  if (!cover) return false;
  if (/library_600x900|library_capsule/i.test(cover)) return false;
  if (/steamgriddb\.com|images\.igdb\.com/i.test(cover)) return false;
  return /header|capsule|background/i.test(cover) || Boolean(meta?.steamAppId);
}

export interface MergeOptions {
  /** `auto` fills gaps; `manual` refreshes everything the player has not locked. */
  mode: 'auto' | 'manual';
  /** Fields the player just corrected, locked even if the record predates locks. */
  justLocked?: string[];
}

/**
 * Merge a provider answer into the record Orbit already keeps.
 *
 * Locked fields and player-chosen artwork survive both modes. In `auto` mode a
 * populated field is only replaced when it is a known-bad wide cover and the
 * answer brings a real portrait. In `manual` mode unlocked fields are refreshed.
 */
export function mergeMetadata(
  current: MetaData | undefined,
  incoming: MetaData | undefined,
  { mode, justLocked = [] }: MergeOptions,
): MetaData {
  const base = baseMeta(current);
  if (!incoming) return base;

  const locked = new Set([...(base.lockedFields ?? []), ...justLocked]);
  // Records made before per-field locks existed used one `edited` flag. Treat
  // every populated field on such a record as player-owned until they say
  // otherwise, so an old correction is never quietly undone by a background fill.
  if (base.edited && !base.lockedFields) {
    for (const field of METADATA_FIELDS) {
      if (!empty(base[field])) locked.add(field);
    }
  }
  if (base.coverUrlCustom) locked.add('coverUrl');
  if (base.backgroundUrlCustom) locked.add('backgroundUrl');

  const next: MetaData = { ...base };
  const sources: Record<string, string> = { ...(base.fieldSources ?? {}) };

  for (const field of METADATA_FIELDS) {
    const value = incoming[field];
    if (empty(value)) continue;
    if (locked.has(field)) continue;

    const have = base[field];
    const shouldTake =
      mode === 'manual' ||
      empty(have) ||
      (field === 'coverUrl' && coverIsWide(base) && !coverIsWide(incoming));

    if (!shouldTake) continue;
    // The assignment is per-field; the cast keeps the union of MetaData's many
    // optional shapes from turning this loop into eleven separate branches.
    (next as unknown as Record<string, unknown>)[field] = value;
    const source = incoming.fieldSources?.[field] ?? incoming.source;
    if (source) sources[field] = source;
  }

  // Artwork provenance travels with the artwork itself.
  if (!locked.has('coverUrl') && incoming.coverUrl && next.coverUrl === incoming.coverUrl) {
    next.coverSource = incoming.coverSource ?? next.coverSource;
  }
  if (!locked.has('backgroundUrl') && incoming.backgroundUrl && next.backgroundUrl === incoming.backgroundUrl) {
    next.backgroundSource = incoming.backgroundSource ?? next.backgroundSource;
  }

  next.fieldSources = sources;
  next.lockedFields = [...locked];
  next.edited = locked.size > 0 || base.edited;
  next.fetchedAt = new Date().toISOString();
  if (incoming.matchConfidence) next.matchConfidence = incoming.matchConfidence;
  if (incoming.matchTitle !== undefined) next.matchTitle = incoming.matchTitle;
  if (incoming.source && incoming.source !== 'none') next.source = incoming.source;
  return next;
}

/** Which fields a player changed, so only those become locked. */
export function locksFromEdit(before: MetaData | undefined, after: MetaData): string[] {
  const old = baseMeta(before);
  const locks = new Set(old.lockedFields ?? []);
  for (const field of METADATA_FIELDS) {
    if (field === 'steamAppId') continue; // choosing a match is not locking the id
    if (JSON.stringify(old[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
      locks.add(field);
    }
  }
  if (after.coverUrlCustom) locks.add('coverUrl');
  if (after.backgroundUrlCustom) locks.add('backgroundUrl');
  return [...locks];
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Whether a background lookup is worth making for this game right now. */
export function needsMetadata(game: Game): boolean {
  const meta = game.meta;
  if (!meta) return true;
  if (game.planned) return false;
  const missing = empty(meta.summary) || empty(meta.coverUrl) || coverIsWide(meta);
  if (missing) return true;
  if (!meta.fetchedAt) return false; // an older record is kept until asked for
  return Date.now() - Date.parse(meta.fetchedAt) > WEEK;
}
