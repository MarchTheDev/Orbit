import type { HltbGameDetails } from '../types';

const cache = new Map<string, Promise<Partial<HltbGameDetails>>>();
const WIKIDATA = 'https://www.wikidata.org/w/api.php';

function claimDate(entity: any): string | null {
  const raw = entity?.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/[+-](\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return null;
  const [, year, month, day] = match;
  return month === '00' || day === '00' ? year : `${year}-${month}-${day}`;
}

async function enrich(title: string): Promise<Partial<HltbGameDetails>> {
  const searchUrl = new URL(WIKIDATA);
  searchUrl.search = new URLSearchParams({ action: 'wbsearchentities', search: title, language: 'en', format: 'json', limit: '5', origin: '*' }).toString();
  const searchResponse = await fetch(searchUrl, { signal: AbortSignal.timeout(6500) });
  if (!searchResponse.ok) throw new Error('Wikidata lookup failed');
  const found = await searchResponse.json() as { search?: Array<{ id: string; label?: string; description?: string }> };
  const target = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidate = (found.search ?? []).find((item) => item.label?.toLowerCase().replace(/[^a-z0-9]/g, '') === target)
    ?? (found.search ?? []).find((item) => /video game|game/i.test(item.description ?? ''));
  if (!candidate) return {};
  const entityUrl = new URL(WIKIDATA);
  entityUrl.search = new URLSearchParams({ action: 'wbgetentities', ids: candidate.id, props: 'labels|claims|sitelinks', languages: 'en', format: 'json', origin: '*' }).toString();
  const entityResponse = await fetch(entityUrl, { signal: AbortSignal.timeout(6500) });
  if (!entityResponse.ok) throw new Error('Wikidata entity lookup failed');
  const payload = await entityResponse.json() as { entities?: Record<string, any> };
  const entity = payload.entities?.[candidate.id];
  if (!entity) return {};
  const labelIds = ['P178', 'P123', 'P136'].flatMap((property) => (entity.claims?.[property] ?? []).map((claim: any) => claim?.mainsnak?.datavalue?.value?.id).filter(Boolean));
  const labelMap: Record<string, string> = {};
  if (labelIds.length) {
    const labelsUrl = new URL(WIKIDATA);
    labelsUrl.search = new URLSearchParams({ action: 'wbgetentities', ids: [...new Set(labelIds)].join('|'), props: 'labels', languages: 'en', format: 'json', origin: '*' }).toString();
    const labelResponse = await fetch(labelsUrl, { signal: AbortSignal.timeout(6500) });
    if (labelResponse.ok) {
      const labels = await labelResponse.json() as { entities?: Record<string, any> };
      for (const [id, value] of Object.entries(labels.entities ?? {})) labelMap[id] = value.labels?.en?.value ?? '';
    }
  }
  const values = (property: string) => (entity.claims?.[property] ?? []).map((claim: any) => labelMap[claim?.mainsnak?.datavalue?.value?.id]).filter(Boolean).slice(0, 5);
  const result: Partial<HltbGameDetails> = {
    releaseDate: claimDate(entity),
    developers: values('P178'),
    publishers: values('P123'),
    genres: values('P136'),
  };
  const wikiTitle = entity.sitelinks?.enwiki?.title;
  if (wikiTitle) {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
    try {
      const summaryResponse = await fetch(summaryUrl, { signal: AbortSignal.timeout(6500) });
      if (summaryResponse.ok) {
        const summary = await summaryResponse.json() as { extract?: string };
        result.wikipediaSummary = summary.extract ?? null;
      }
    } catch { /* Wikidata facts remain useful without Wikipedia. */ }
  }
  return result;
}

/** Public, keyless enrichment for non-Steam catalogue entries. */
export function fetchNonSteamFacts(title: string): Promise<Partial<HltbGameDetails>> {
  const key = title.trim().toLowerCase();
  if (!key) return Promise.resolve({});
  const existing = cache.get(key);
  if (existing) return existing;
  const request = enrich(title.trim()).catch(() => ({}));
  cache.set(key, request);
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  return request;
}
