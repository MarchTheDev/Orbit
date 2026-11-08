import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../data/sampleGames';

export { DEFAULT_SETTINGS };

/**
 * Settings only. The library itself lives in SQLite on the Rust side, so this
 * is no longer where a game lives, only how the app is set up.
 */
export function normalizeSettings(stored: Partial<Settings>): Settings {
  return dropRetired({ ...DEFAULT_SETTINGS, ...stored });
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

/** IGDB and the old rsync destination are gone. Drop them so a later save does not keep the secrets. */
function dropRetired(settings: Settings): Settings {
  const next = { ...settings } as Settings & { igdbClientId?: string; igdbClientSecret?: string };
  delete next.igdbClientId;
  delete next.igdbClientSecret;
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