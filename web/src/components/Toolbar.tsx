import { ArrowDownUp, Eye, EyeOff, LayoutGrid, List, Orbit, Plus, Rows3 } from 'lucide-react';
import type { LibraryFilter, SortKey, ViewMode } from '../types';
import { SearchField } from './ui/SearchField';
import { Select } from './ui/Select';
import { cn } from '../utils/cn';

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
  setView: (v: ViewMode) => void;
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

export function Toolbar({
  total,
  filter,
  setFilter,
  query,
  setQuery,
  view,
  setView,
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
    <div className="relative z-10 mb-3.5 mt-1 space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        {/* The filter row reads left to right the way the design drew it, and
            scrolls rather than wrapping onto a second line when the window is
            narrow. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" role="group" aria-label="Library filters">
          {categories.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn('chip shrink-0', filter === f.id && 'is-active')}
            >
              {f.label}
              {f.id === 'all' && <span className="orbit-num rounded-md bg-black/15 px-1.5 py-px text-[9.5px]">{total}</span>}
            </button>
          ))}
          {sort === 'manual' && view !== 'focus' && (
            <span className="ml-2 flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
              <ArrowDownUp className="size-3.5" />
              Drag a game to move it in your order
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* The bar's search opens the palette; Focus has no second field. In
              the grid and the list this one filters the visible games as you type. */}
          {view !== 'focus' && <SearchField value={query} onChange={setQuery} placeholder="Search games" />}

          <div className="orbit-segmented" role="group" aria-label="How the library is drawn">
            {(
              [
                ['focus', Orbit, 'Focus'],
                ['grid', LayoutGrid, 'Grid'],
                ['list', List, 'List'],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => setView(mode)}
                title={label}
                aria-label={label}
                aria-pressed={view === mode}
              >
                <Icon className="size-4" strokeWidth={1.8} />
              </button>
            ))}
          </div>

          {view !== 'focus' && (
            <button
              onClick={onToggleHero}
              aria-pressed={showHero}
              title={showHero ? 'Hide Jump back in panel' : 'Show Jump back in panel'}
              className="orbit-square-btn !h-9 !w-9"
            >
              {showHero ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}

          <Select
            value={sort}
            onChange={setSort}
            className="!rounded-[10px] !px-3 !py-2 text-xs"
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
              className="flex items-center gap-2.5 rounded-[10px] border border-line py-1.5 pl-3 pr-3.5 text-muted"
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
            className="orbit-square-btn !h-9 !w-9"
            title="Add game"
            aria-label="Add game"
          >
            <Plus className="size-[18px]" strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  );
}
