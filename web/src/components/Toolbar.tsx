import { ArrowDownUp, Eye, EyeOff, LayoutGrid, List, Plus, Rows3 } from 'lucide-react';
import type { LibraryFilter, SortKey, ViewMode } from '../types';
import { cn } from '../utils/cn';
import { SearchField } from './ui/SearchField';
import { Select } from './ui/Select';

export type Filter = LibraryFilter;
export type FilterDefinition = { id: Filter; label: string };

interface Props {
  count: number;
  total: number;
  filter: Filter;
  setFilter: (filter: Filter) => void;
  query: string;
  setQuery: (query: string) => void;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  onAdd: () => void;
  showHero: boolean;
  onToggleHero: () => void;
  scale: number;
  setScale: (scale: number) => void;
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
  { id: 'hidden', label: 'Hidden' },
];

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
  const filters = orderedLibraryFilters(filterOrder).filter((item) => !hidden.has(item.id));
  const categories = filters.length > 0 ? filters : [LIBRARY_FILTERS[0]];

  return (
    <section className="orbit-library-toolbar mx-6 mt-5 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="mr-auto min-w-[130px]">
          <h2 className="text-sm font-semibold">Games</h2>
          <p className="mt-0.5 text-[10px] text-muted">
            {count} shown{count !== total ? ` of ${total}` : ''}
          </p>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="Search games" className="min-w-[180px] flex-1 sm:flex-none" inputClassName="w-full sm:w-56" />
        <Select
          value={sort}
          onChange={setSort}
          ariaLabel="Sort games"
          options={[
            { value: 'title', label: 'Title A to Z' },
            { value: 'lastPlayed', label: 'Last played' },
            { value: 'playtime', label: 'Playtime' },
            { value: 'added', label: 'Recently added' },
            { value: 'size', label: 'Size' },
            { value: 'manual', label: 'My order' },
          ]}
        />
        <button
          type="button"
          onClick={onToggleHero}
          aria-pressed={showHero}
          title={showHero ? 'Hide continue playing panel' : 'Show continue playing panel'}
          className="orbit-tool-button hidden items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5 py-2 text-[11px] text-muted hover:text-fg lg:flex"
        >
          {showHero ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          <span>Continue panel</span>
        </button>
        <label className="orbit-tool-button hidden items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5 py-2 text-muted xl:flex" title="Cover size">
          <Rows3 className="size-4" />
          <input type="range" min={70} max={170} step={5} value={scale} onChange={(event) => setScale(Number(event.target.value))} className="h-1 w-20 cursor-pointer accent-[var(--c-accent)]" aria-label="Cover size" />
        </label>
        <div className="flex rounded-lg border border-line bg-panel2 p-1" role="group" aria-label="Library view">
          {([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([mode, Icon, label]) => (
            <button
              type="button"
              key={mode}
              onClick={() => setView(mode)}
              title={label}
              aria-label={label}
              aria-pressed={view === mode}
              className={cn('grid size-7 place-items-center rounded-md', view === mode ? 'bg-accent text-white' : 'text-muted hover:text-fg')}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
        <button type="button" onClick={onAdd} className="btn-accent flex h-9 items-center gap-2 rounded-lg px-3 text-xs" title="Add game">
          <Plus className="size-4" /> <span>Add game</span>
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        {categories.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setFilter(item.id)}
            aria-pressed={filter === item.id}
            className={cn('rounded-md px-2.5 py-1.5 text-[10px] font-medium', filter === item.id ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2 hover:text-fg')}
          >
            {item.label}
          </button>
        ))}
        {sort === 'manual' && <span className="ml-1 flex items-center gap-1.5 text-[10px] text-muted"><ArrowDownUp className="size-3.5" /> Drag to arrange</span>}
      </div>
    </section>
  );
}
