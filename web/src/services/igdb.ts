import type { IgdbData } from '../types';
import { httpJson } from './native';

interface IgdbRaw {
  name?: string;
  summary?: string;
  genres?: { name: string }[];
  involved_companies?: { developer: boolean; company: { name: string } }[];
  first_release_date?: number;
  total_rating?: number;
  cover?: { image_id: string };
}

/**
 * IGDB requires a Twitch Client ID + App Access Token (https://api-docs.igdb.com).
 * Browsers are blocked by CORS – in the .exe requests go through Rust.
 */
export async function fetchIgdb(title: string, clientId: string, token: string): Promise<IgdbData> {
  if (clientId && token) {
    try {
      const body = `search "${title.replace(/"/g, '')}"; fields summary,genres.name,involved_companies.developer,involved_companies.company.name,first_release_date,total_rating,cover.image_id; limit 1;`;
      const data = await httpJson<IgdbRaw[]>('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body,
      });
      const g = data[0];
      if (g) {
        return {
          summary: g.summary ?? 'No summary available.',
          genres: g.genres?.map((x) => x.name) ?? [],
          developer: g.involved_companies?.find((c) => c.developer)?.company.name ?? 'Unknown',
          releaseYear: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
          rating: g.total_rating ? Math.round(g.total_rating) : null,
          coverUrl: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : undefined,
        };
      }
    } catch (e) {
      console.warn('IGDB request failed, using placeholder', e);
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  return {
    summary: `Metadata for "${title}" (preview mode). Add your IGDB credentials in Settings and run the Orbit .exe to fetch real info.`,
    genres: ['Unknown'],
    developer: 'Unknown',
    releaseYear: null,
    rating: null,
  };
}

/**
 * Offer the player the titles IGDB actually has, so a mistyped name does not
 * become a permanent entry. Returns the exact titles, best match first.
 */
export async function searchIgdb(title: string, clientId: string, token: string): Promise<string[]> {
  if (!clientId || !token) return [];
  try {
    const body = `search "${title.replace(/"/g, '')}"; fields name; limit 8;`;
    const data = await httpJson<IgdbRaw[]>('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body,
    });
    return data.map((g) => g.name).filter((n): n is string => Boolean(n));
  } catch (e) {
    console.warn('IGDB search failed', e);
    return [];
  }
}
