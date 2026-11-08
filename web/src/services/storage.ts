import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../data/sampleGames';

export { DEFAULT_SETTINGS };

/**
 * Settings only. The library itself lives in SQLite on the Rust side, so this
 * is no longer where a game lives, only how the app is set up.
 */
export function normalizeSettings(stored: Partial<Settings>): Settings {
  const normalized = dropRetired({ ...DEFAULT_SETTINGS, ...stored });
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

/** Retired providers and launch-time scans are removed so later saves cannot revive them. */
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