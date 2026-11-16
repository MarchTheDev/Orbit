import type { Game } from '../types';
import { fileSrc } from '../services/desktop';

const MAX_DECODED = 64;
const decoded = new Map<string, HTMLImageElement>();
const missing = new Set<string>();
const resolved = new Map<string, string>();

function remember(src: string, image: HTMLImageElement) {
  decoded.delete(src);
  decoded.set(src, image);
  while (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value!);
}

export async function decodeArtwork(src: string): Promise<HTMLImageElement> {
  const existing = decoded.get(src);
  if (existing?.complete && existing.naturalWidth > 0) {
    decoded.delete(src);
    decoded.set(src, existing);
    return existing;
  }
  if (missing.has(src)) throw new Error('Artwork previously unavailable');
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  try {
    await image.decode();
    remember(src, image);
    return image;
  } catch (error) {
    missing.add(src);
    throw error;
  }
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
    ...(id ? [steamAsset(id, 'library_hero_2x.jpg'), steamAsset(id, 'library_hero.jpg'), steamAsset(id, 'page_bg_raw.jpg')] : []),
    game.meta?.backgroundUrl,
    game.meta?.headerUrl,
    game.meta?.coverUrl,
    game.coverPath ? fileSrc(game.coverPath) : null,
  ].filter((url): url is string => Boolean(url));
  return [...new Set(sources.filter((url) => !/page_bg_generated/i.test(url)))];
}

/** The widest available picture, with high-resolution Steam hero art first. */
export function wideArt(game: Game): string | null {
  return wideArtCandidates(game)[0] ?? null;
}

export function coverArtCandidates(game: Game): string[] {
  const id = steamAppId(game);
  return [...new Set([
    game.coverPath ? fileSrc(game.coverPath) : null,
    ...(id ? [steamAsset(id, 'library_600x900_2x.jpg'), steamAsset(id, 'library_600x900.jpg')] : []),
    game.meta?.coverUrl,
    game.meta?.headerUrl,
    game.meta?.backgroundUrl,
  ].filter((url): url is string => Boolean(url)))];
}

/** Warm artwork for the visible shelf, prioritizing heroes and covers near the front. */
export function prewarmLibraryArtwork(games: Game[], limit = 12): void {
  for (const game of games.slice(0, limit)) {
    // First-choice hero and poster only: warming every fallback for every game
    // would trade a small transition flash for a burst of unnecessary traffic.
    const sources = [wideArtCandidates(game)[0], coverArtCandidates(game)[0]].filter((src): src is string => Boolean(src));
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
      resolved.set(key, candidate);
      return candidate;
    } catch { /* continue down fallback chain */ }
  }
  return null;
}
