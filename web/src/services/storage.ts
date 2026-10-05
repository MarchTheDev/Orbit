import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../data/sampleGames';

export { DEFAULT_SETTINGS };

/**
 * Settings only. The library itself lives in SQLite on the Rust side, so this
 * is no longer where a game lives — only how the app is set up.
 */
export async function loadSettings(): Promise<Settings> {
  const t = (window as Window & { __TAURI__?: { core: { invoke: <T>(c: string) => Promise<T> } } }).__TAURI__;
  if (t) {
    const stored = await t.core.invoke<Partial<Settings> | null>('load_settings');
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }
  try {
    const raw = localStorage.getItem('orbit.settings');
    return { ...DEFAULT_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const t = (window as Window & { __TAURI__?: { core: { invoke: <T>(c: string, a: unknown) => Promise<T> } } }).__TAURI__;
  if (t) {
    await t.core.invoke<void>('save_settings', { settings });
    return;
  }
  localStorage.setItem('orbit.settings', JSON.stringify(settings));
}