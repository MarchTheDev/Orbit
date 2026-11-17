import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../data/sampleGames';

export { DEFAULT_SETTINGS };

/**
 * Settings only. The library itself lives in SQLite on the Rust side, so this
 * is no longer where a game lives, only how the app is set up.
 */
export function normalizeSettings(stored: Partial<Settings>): Settings {
  let normalized = dropRetired({ ...DEFAULT_SETTINGS, ...stored });
  normalized = ensureMetadataSources(normalized);
  if (!['system', 'rounded', 'serif', 'mono', 'humanist', 'book'].includes(String(normalized.fontFamily ?? 'system'))) {
    normalized.fontFamily = 'system';
  }
  return normalized;
}

export async function loadSettings(): Promise<Settings> {
  const t = (window as Window & { __TAURI__?: { core: { invoke: <T>(c: string) => Promise<T> } } }).__TAURI__;
  if (t) {
    const stored = await t.core.invoke<Partial<Settings> | null>('load_settings');
    return normalizeSettings(stored ?? {});
  }
  try {
    const raw = localStorage.getItem('orbit.settings');
    return normalizeSettings(raw ? (JSON.parse(raw) as Partial<Settings>) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * The metadata source list, rebuilt around the built-in sources Orbit ships.
 *
 * What a source *is* - its name, and the line under it - belongs to this build,
 * not to the copy that was saved months ago. Those two fields have changed
 * wording several times, and one of the old lines ("— needs key above") was a
 * leftover from a version that read its key from somewhere else entirely: it
 * was never true, and no amount of new releases cleared it, because the saved
 * copy of the list was being trusted. So a built-in source keeps the two things
 * that are the player's - whether it is on, and any URL they gave it - and
 * takes its label and note from the defaults above. Custom sources, which are
 * entirely the player's, are left exactly as they are.
 */
function ensureMetadataSources(settings: Settings): Settings {
  const fallback = (DEFAULT_SETTINGS as Settings).metadataSources ?? [];
  const stored = Array.isArray(settings.metadataSources) ? settings.metadataSources : [];
  if (stored.length === 0) {
    settings.metadataSources = fallback.map((source) => ({ ...source }));
    return settings;
  }
  const kept = stored
    .filter((source) => source && typeof source.id === 'string' && source.id.trim() !== '')
    .map((source) => {
      const builtin = fallback.find((candidate) => candidate.id === source.id);
      if (!builtin) {
        // A source the player added keeps everything they typed, except the
        // one housekeeping line an old build wrote into the note field.
        if (source.note && /needs?\s+key/i.test(source.note)) {
          const { note, ...rest } = source;
          return note === 'Custom' ? source : rest;
        }
        return source;
      }
      return {
        ...builtin,
        // The player's decisions survive; the wording does not.
        enabled: source.enabled !== false,
        ...(source.url ? { url: source.url } : {}),
      };
    });
  // A built-in the saved list predates is added rather than left out, so a
  // source Orbit has always had cannot go missing because of an old save.
  for (const source of fallback) {
    if (!kept.some((candidate) => candidate.id === source.id)) kept.push({ ...source });
  }
  settings.metadataSources = kept;
  return settings;
}
function dropRetired(settings: Settings): Settings {
  const next = { ...settings } as Settings & {
    igdbClientId?: string;
    igdbClientSecret?: string;
    theGamesDbApiKey?: string;
    scanOnLaunch?: boolean;
  };
  delete next.igdbClientId;
  delete next.igdbClientSecret;
  delete next.theGamesDbApiKey;
  delete next.scanOnLaunch;
  if (next.saves) {
    const saves = { ...next.saves } as NonNullable<Settings['saves']> & { syncTo?: string };
    delete saves.syncTo;
    next.saves = saves;
  }
  return next;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const t = (window as Window & { __TAURI__?: { core: { invoke: <T>(c: string, a: unknown) => Promise<T> } } }).__TAURI__;
  if (t) {
    await t.core.invoke<void>('save_settings', { settings });
    return;
  }
  localStorage.setItem('orbit.settings', JSON.stringify(settings));
}