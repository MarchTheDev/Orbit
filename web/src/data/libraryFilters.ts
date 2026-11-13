import type { LibraryFilter } from '../types';

/** The status chips above the library. */
export type Filter = LibraryFilter;
export type FilterDefinition = { id: Filter; label: string };

export const LIBRARY_FILTERS: FilterDefinition[] = [
  { id: 'all', label: 'All games' },
  { id: 'playing', label: 'Playing' },
  { id: 'completed', label: 'Completed' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'unplayed', label: 'Unplayed' },
  // Last, because it is the one nobody needs every day, and it is the only way
  // back to a game that has been hidden.
  { id: 'hidden', label: 'Hidden' },
];

/** A saved order can be from an older version; newly added filters go last. */
export function orderedLibraryFilters(order?: Filter[]): FilterDefinition[] {
  if (!order?.length) return LIBRARY_FILTERS;
  const byId = new Map(LIBRARY_FILTERS.map((item) => [item.id, item]));
  const seen = new Set<Filter>();
  const result: FilterDefinition[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      result.push(item);
      seen.add(id);
    }
  }
  for (const item of LIBRARY_FILTERS) if (!seen.has(item.id)) result.push(item);
  return result;
}
