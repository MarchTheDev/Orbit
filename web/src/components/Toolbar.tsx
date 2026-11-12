import { ArrowDownUp, Eye, EyeOff, Plus, Rows3 } from 'lucide-react';
import type { LibraryFilter, SortKey, ViewMode } from '../types';
import { SearchField } from './ui/SearchField';
import { Select } from './ui/Select';

/** The status chips above the library. */
export type Filter = LibraryFilter;
export type FilterDefinition = { id: Filter; label: string };

interface Props {
  count: number;
  total: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  query: string;
  setQuery: (q: string) => void;
  view: ViewMode;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  onAdd: () => void;
  showHero: boolean;
  onToggleHero: () => void;
  /** How big the covers are drawn, as a percentage of the base size. */
  scale: number;
  setScale: (n: number) => void;
  filterOrder?: Filter[];
  hiddenFilters?: Filter[];
}

export const LIBRARY_FILTERS: FilterDefinition[] = [
  { id: 'all', label: 'All' },
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

export function Toolbar({
  count,
  total,
  filter,
  setFilter,
  query,
  setQuery,
  view,
  sort,
  setSort,
  onAdd,
  showHero,
  onToggleHero,
  scale,
  setScale,
  filterOrder,
  hiddenFilters = [],
}: Props) {
  const hidden = new Set(hiddenFilters);
  const visibleFilters = orderedLibraryFilters(filterOrder).filter((item) => !hidden.has(item.id));
  const categories = visibleFilters.length > 0 ? visibleFilters : [LIBRARY_FILTERS[0]];

  return (
    <div className="mt-6 space-y-3 px-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="mr-auto flex items-baseline gap-2.5">
          <span className="orbit-kicker">Browse</span>
          <span className="orbit-num text-xs text-muted">
            {count}
            {count !== total && <span className="text-muted/60"> / {total}</span>}
          </span>
        </h2>

        <SearchField value={query} onChange={setQuery} placeholder="Search games" />

        {view !== 'focus' && (
          <button
            onClick={onToggleHero}
            aria-pressed={showHero}
            title={showHero ? 'Hide Jump back in panel' : 'Show Jump back in panel'}
            className="flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-xs font-medium text-muted transition hover:text-fg"
          >
            {showHero ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            <span className="hidden xl:inline">{showHero ? 'Hide' : 'Show'} Jump back in</span>
          </button>
        )}

        <Select
          value={sort}
          onChange={setSort}
          className="!rounded-xl !px-3.5 !py-2 text-sm"
          ariaLabel="How the library is ordered"
          options={[
            { value: 'title', label: 'A-Z' },
            { value: 'lastPlayed', label: 'Last played' },
            { value: 'playtime', label: 'Playtime' },
            { value: 'added', label: 'Recently added' },
            { value: 'size', label: 'Size' },
            { value: 'manual', label: 'My order (drag to arrange)' },
          ]}
        />

        {/* How big the covers are drawn. Focus sizes its own stage, so the
            control only appears where the covers are actually in a grid. */}
        {view !== 'focus' && (
          <label
            className="flex items-center gap-2.5 rounded-xl border border-line py-1.5 pl-3.5 pr-4 text-muted"
            title="Cover size"
          >
            <Rows3 className="size-4" />
            <input
              type="range"
              min={70}
              max={170}
              step={5}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="orbit-range w-20 cursor-pointer"
              aria-label="Cover size"
            />
          </label>
        )}

        <button
          onClick={onAdd}
          className="btn-accent grid size-9 place-items-center"
          title="Add game"
          aria-label="Add game"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className="chip"
          >
            {f.label}
          </button>
        ))}
        {sort === 'manual' && view !== 'focus' && (
          <span className="ml-2 flex items-center gap-1.5 text-[11px] text-muted">
            <ArrowDownUp className="size-3.5" />
            Drag a game to move it in your order
          </span>
        )}
      </div>
    </div>
  );
}
