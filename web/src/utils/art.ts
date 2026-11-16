import type { Game } from '../types';
import { fileSrc } from '../services/desktop';

const MAX_DECODED = 160;
const decoded = new Map<string, HTMLImageElement>();
const inflight = new Map<string, Promise<HTMLImageElement>>();
const missing = new Set<string>();
const resolved = new Map<string, string>();

function remember(src: string, image: HTMLImageElement) {
  decoded.delete(src);
  decoded.set(src, image);
  while (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value!);
}

export function decodeArtwork(src: string): Promise<HTMLImageElement> {
  const existing = decoded.get(src);
  if (existing?.complete && existing.naturalWidth > 0) {
    decoded.delete(src);
    decoded.set(src, existing);
    return Promise.resolve(existing);
  }
  const pending = inflight.get(src);
  if (pending) return pending;
  if (missing.has(src)) return Promise.reject(new Error('Artwork previously unavailable'));

  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  const request = image.decode()
    .then(() => {
      remember(src, image);
      return image;
    })
    .catch((error: unknown) => {
      missing.add(src);
      throw error;
    })
    .finally(() => inflight.delete(src));
  inflight.set(src, request);
  return request;
}

function steamAppId(game: Game): number | null {
  const metaId = game.meta?.steamAppId;
  if (typeof metaId === 'number' && metaId > 0) return metaId;
  const launch = game.launch as { kind?: string; appId?: number; steamAppId?: number };
  const launchId = launch.appId ?? launch.steamAppId;
  if (typeof launchId === 'number' && launchId > 0) return launchId;
  const all = [game.meta?.coverUrl, game.meta?.headerUrl, game.meta?.backgroundUrl].filter(Boolean).join(' ');
  const match = all.match(/\/apps\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

const steamAsset = (id: number, name: string) => `https://cdn.akamai.steamstatic.com/steam/apps/${id}/${name}`;

export function wideArtCandidates(game: Game): string[] {
  const id = steamAppId(game);
  const sources = [
    game.meta?.backgroundUrlCustom ? game.meta.backgroundUrl : null,
    ...(id ? [steamAsset(id, 'library_hero_2x.jpg'), steamAsset(id, 'library_hero.jpg'), steamAsset(id, 'page_bg_raw.jpg')] : []),
    game.meta?.backgroundUrl,
    game.meta?.headerUrl,
    game.meta?.coverUrl,
    game.coverPath ? fileSrc(game.coverPath) : null,
  ].filter((url): url is string => Boolean(url));
  return [...new Set(sources.filter((url) => !/page_bg_generated/i.test(url)))];
}

/** The widest picture, preferring sharp Steam hero art over the blurred page background. */
export function wideArt(game: Game): string | null {
  return wideArtCandidates(game)[0] ?? null;
}

export function coverArtCandidates(game: Game): string[] {
  const id = steamAppId(game);
  return [...new Set([
    game.coverPath ? fileSrc(game.coverPath) : null,
    (game.meta?.coverUrlCustom || game.meta?.edited) ? game.meta.coverUrl : null,
    ...(id ? [steamAsset(id, 'library_600x900_2x.jpg'), steamAsset(id, 'library_600x900.jpg')] : []),
    game.meta?.coverUrl,
    game.meta?.headerUrl,
    game.meta?.backgroundUrl,
  ].filter((url): url is string => Boolean(url)))];
}

/** Warm posters across the visible shelf; hero art is limited to the active item. */
export function prewarmLibraryArtwork(games: Game[], limit = 16, includeHeroes = false): void {
  for (const [index, game] of games.slice(0, limit).entries()) {
    const sources = [
      ...(includeHeroes || index === 0 ? [wideArtCandidates(game)[0]] : []),
      coverArtCandidates(game)[0],
    ].filter((src): src is string => Boolean(src));
    for (const src of sources) {
      if (!decoded.has(src) && !missing.has(src)) void decodeArtwork(src).catch(() => undefined);
    }
  }
}

/** Resolve first successful hero once; cache the winner and skip known 404s. */
export async function resolveWideArt(game: Game): Promise<string | null> {
  const candidates = wideArtCandidates(game);
  const key = candidates.join('|');
  const winner = resolved.get(key);
  if (winner) return winner;
  for (const candidate of candidates) {
    if (missing.has(candidate)) continue;
    try {
      await decodeArtwork(candidate);
      resolved.delete(key);
      resolved.set(key, candidate);
      if (resolved.size > 256) resolved.delete(resolved.keys().next().value!);
      return candidate;
    } catch { /* continue down fallback chain */ }
  }
  return null;
}
