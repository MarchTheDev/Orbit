/**
 * Game details.
 *
 * Nothing here needs setting up. The Steam store answers with a description,
 * genres, developer, release year and artwork and asks for no key at all, which
 * is what makes a dropped-in game fill itself out. IGDB has richer data, so it
 * is used instead once a Twitch application has been saved in Settings — Orbit
 * fetches and refreshes that token on its own — and a token pasted by hand in
 * an older version of Orbit is still honoured.
 */
import type { IgdbData, Settings } from '../types';
import { httpJson, metadataLookup, metadataSuggest, type MetaCredentials } from './native';

interface IgdbRaw {
  name?: string;
  summary?: string;
  genres?: { name: string }[];
  involved_companies?: { developer: boolean; company: { name: string } }[];
  first_release_date?: number;
  total_rating?: number;
  cover?: { image_id: string };
}

/** Pull the credentials out of the settings, ready for a lookup. */
export function metaCredentials(settings: Settings | null): MetaCredentials {
  return {
    clientId: settings?.igdbClientId ?? '',
    clientSecret: settings?.igdbClientSecret ?? '',
    token: settings?.igdbToken ?? '',
  };
}

/** Details for one title, whichever source is available. */
export async function fetchMetadata(title: string, credentials: MetaCredentials): Promise<IgdbData> {
  // A hand-pasted token cannot be refreshed, so it is only used when there is
  // no client secret to mint a proper one from.
  if (credentials.clientId && credentials.token && !credentials.clientSecret) {
    const direct = await viaPastedToken(title, credentials.clientId, credentials.token);
    if (direct) return direct;
  }
  return metadataLookup<IgdbData>(title, credentials);
}

/** Titles a store suggests while a name is being typed. */
export function searchTitles(title: string): Promise<string[]> {
  return metadataSuggest(title);
}

/**
 * The older path: an app-access token pasted into Settings by hand.
 *
 * Kept because it still works and throwing away a working setup would be
 * rude — but nothing new should use it, since those tokens expire.
 */
async function viaPastedToken(
  title: string,
  clientId: string,
  token: string,
): Promise<IgdbData | null> {
  try {
    const body = `search "${title.replace(/"/g, '')}"; fields summary,genres.name,involved_companies.developer,involved_companies.company.name,first_release_date,total_rating,cover.image_id; limit 1;`;
    const data = await httpJson<IgdbRaw[]>('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body,
    });
    const g = data[0];
    if (!g) return null;
    return {
      summary: g.summary ?? '',
      genres: g.genres?.map((x) => x.name) ?? [],
      developer: g.involved_companies?.find((c) => c.developer)?.company.name ?? '',
      releaseYear: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
      rating: g.total_rating ? Math.round(g.total_rating) : null,
      coverUrl: g.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : null,
      source: 'igdb',
    };
  } catch (e) {
    console.warn('the pasted IGDB token did not work', e);
    return null;
  }
}
