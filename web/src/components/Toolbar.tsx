import { LayoutGrid, List, Plus, Search, Gamepad2 } from 'lucide-react';
import type { Game, SortKey, ViewMode } from '../types';
import { cn } from '../utils/cn';
import { btnGhost } from './ui/Modal';

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
  /** Opens the Steam import dialog. */
  onSteam: () => void;
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
  onSteam,
}: Props) {
  return (
    <div className="mt-8 space-y-3 px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xs font-bold uppercase tracking-[0.25em] text-muted">
          Library · {count}
          {count !== total && <span className="text-muted/60"> of {total}</span>}
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="glass w-56 rounded-full py-2 pl-10 pr-4 text-sm outline-none focus:border-accent"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="glass rounded-full px-4 py-2 text-sm outline-none"
        >
          <option value="title">A–Z</option>
          <option value="lastPlayed">Last played</option>
          <option value="playtime">Playtime</option>
          <option value="added">Recently added</option>
          <option value="size">Size</option>
        </select>
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
        <button className={`${btnGhost} flex items-center gap-2`} onClick={onSteam}>
          <Gamepad2 className="size-4" />
          Steam library
        </button>
        <button
          onClick={onAdd}
          className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-accent to-accent2 text-white shadow-[0_0_20px_var(--c-accent)] transition hover:scale-110"
          title="Add game"
          aria-label="Add game"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
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
      </div>
    </div>
  );
}