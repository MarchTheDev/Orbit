import { ArrowDownUp, LayoutGrid, List, Plus, Rows3 } from 'lucide-react';
import type { Game, SortKey, ViewMode } from '../types';
import { cn } from '../utils/cn';
import { SearchField } from './ui/SearchField';
import { Select } from './ui/Select';

/** The status chips above the library. */
export type Filter = 'all' | 'favorites' | Game['status'] | 'unplayed';

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
  /** How big the covers are drawn, as a percentage of the base size. */
  scale: number;
  setScale: (n: number) => void;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'playing', label: 'Playing' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'completed', label: 'Completed' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'unplayed', label: 'Unplayed' },
];

export function Toolbar({
  count,
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
  scale,
  setScale,
}: Props) {
  return (
    <div className="mt-8 space-y-3 px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xs font-bold uppercase tracking-[0.25em] text-muted">
          Library · {count}
          {count !== total && <span className="text-muted/60"> of {total}</span>}
        </h2>

        <SearchField value={query} onChange={setQuery} />

        <Select
          value={sort}
          onChange={setSort}
          className="!rounded-full !px-4 !py-2 text-sm"
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

        {/* How big the covers are drawn. Two views share it, so the library
            looks the same size whichever way it is read. */}
        <label
          className="glass flex items-center gap-2 rounded-full py-1.5 pl-3.5 pr-4 text-muted"
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
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-line accent-[var(--c-accent)]"
            aria-label="Cover size"
          />
        </label>

        <div className="glass flex rounded-full p-1">
          {(
            [
              ['grid', LayoutGrid, 'Catalog'],
              ['list', List, 'List'],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              title={label}
              aria-label={label}
              aria-pressed={view === v}
              className={cn('grid size-8 place-items-center rounded-full', view === v ? 'bg-fg text-bg' : 'text-muted hover:text-fg')}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>

        <button
          onClick={onAdd}
          className="btn-accent grid size-10 place-items-center rounded-full"
          title="Add game"
          aria-label="Add game"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition',
              filter === f.id ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:border-accent/60',
            )}
          >
            {f.label}
          </button>
        ))}
        {sort === 'manual' && (
          <span className="ml-1 flex items-center gap-1.5 text-[11px] text-muted">
            <ArrowDownUp className="size-3.5" />
            Drag a game to move it in your order
          </span>
        )}
      </div>
    </div>
  );
}
