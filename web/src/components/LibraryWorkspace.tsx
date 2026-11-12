import { useEffect, useMemo, useState } from 'react';
import { Clock3, Disc3, Gamepad2, Grid2X2, Info, List, MapPin, Pencil, Play, Plus, Star, Square } from 'lucide-react';
import type { Game, LibraryFilter, Session, Settings, SortKey, ViewMode } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { inLibraryShelf } from '../utils/library';
import { listSessions } from '../services/native';
import { cn } from '../utils/cn';
import { orderedLibraryFilters } from './Toolbar';
import { SearchField } from './ui/SearchField';
import { Select } from './ui/Select';
import { Cover } from './ui/Cover';
import { GameGrid } from './GameGrid';
import { GameList } from './GameList';

interface Props {
  games: Game[];
  collection: Game[];
  settings: Settings;
  filter: LibraryFilter;
  setFilter: (filter: LibraryFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  scale: number;
  setScale: (scale: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  runningId: string | null;
  showArtwork: boolean;
  onReorder?: (fromId: string, toId: string, after: boolean) => void;
}

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Planned' },
  { value: 'playing', label: 'Playing' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
] as const;

const SORT_OPTIONS = [
  { value: 'title', label: 'Title, A to Z' },
  { value: 'lastPlayed', label: 'Recently played' },
  { value: 'playtime', label: 'Most played' },
  { value: 'added', label: 'Recently added' },
  { value: 'size', label: 'Install size' },
  { value: 'manual', label: 'Custom order' },
] as const;

function labelFor(filter: LibraryFilter): string {
  return filter === 'all' ? 'Everything' : filter === 'favorites' ? 'Favorites' : filter === 'unplayed' ? 'Not played' : filter === 'hidden' ? 'Hidden' : filter[0].toUpperCase() + filter.slice(1);
}

function sourceLabel(game: Game): string {
  if (game.launch.kind === 'steam') return 'Steam';
  if (game.launch.kind === 'lutris') return 'Lutris';
  if (game.launch.kind === 'wine') return game.launch.proton ? 'Proton / Wine' : 'Wine';
  if (game.launch.kind === 'executable') return 'Local executable';
  if (game.installDir) return 'Local install';
  return 'Manual tracking';
}

export function LibraryWorkspace({
  games,
  collection,
  settings,
  filter,
  setFilter,
  query,
  setQuery,
  sort,
  setSort,
  view,
  setView,
  scale,
  setScale,
  selectedId,
  onSelect,
  onDetails,
  onEdit,
  onToggleFavorite,
  onPlay,
  onStop,
  onAdd,
  onUpdate,
  runningId,
  showArtwork,
  onReorder,
}: Props) {
  const filters = orderedLibraryFilters(settings.libraryFilterOrder)
    .filter(({ id }) => !(settings.hiddenLibraryFilters ?? []).includes(id));
  const counts = useMemo(() => {
    const result: Partial<Record<LibraryFilter, number>> = {};
    for (const item of filters) {
      result[item.id] = collection.filter((game) => {
        if (item.id === 'all') return !game.hidden;
        if (item.id === 'favorites') return game.favorite && !game.hidden;
        if (item.id === 'unplayed') return game.sessionCount === 0 && !game.hidden;
        if (item.id === 'hidden') return !!game.hidden;
        return game.status === item.id && !game.hidden;
      }).length;
    }
    return result;
  }, [collection, filters]);
  const selected = games.find((game) => game.id === selectedId) ?? games[0] ?? null;
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const playing = selected ? runningId === selected.id : false;

  useEffect(() => {
    if (!selected) {
      setRecentSessions([]);
      return;
    }
    let current = true;
    void listSessions(3, 0, selected.id).then((rows) => {
      if (current) setRecentSessions(rows);
    }).catch(() => {
      if (current) setRecentSessions([]);
    });
    return () => { current = false; };
  }, [selected?.id, selected?.sessionCount]);

  if (!selected) {
    return (
      <div className="library-workspace library-empty-state">
        <div className="library-empty-card">
          <span className="library-empty-icon"><Disc3 size={22} /></span>
          <p className="library-eyebrow">YOUR COLLECTION</p>
          <h2>{collection.length ? 'No games in this view' : 'Start your collection'}</h2>
          <p>{collection.length ? 'Try a different category or search.' : 'Add a game to build your library. Orbit keeps your games, activity, and notes together.'}</p>
          <button type="button" onClick={onAdd} className="library-primary-button"><Plus size={16} /> Add a game</button>
        </div>
      </div>
    );
  }

  return (
    <div className="library-workspace">
      <div className="library-commandbar">
        <div className="library-command-title">
          <p className="library-eyebrow">COLLECTION</p>
          <h2>Library <span>{collection.length}</span></h2>
        </div>
        <div className="library-command-actions">
          <SearchField value={query} onChange={setQuery} placeholder="Find a game" className="library-search" inputClassName="w-full" />
          <Select value={sort} onChange={setSort} ariaLabel="Sort games" options={SORT_OPTIONS} className="library-sort" />
          <div className="library-view-switch" role="group" aria-label="Collection layout">
            <button type="button" aria-label="Poster grid" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={15} /></button>
            <button type="button" aria-label="Compact list" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} /></button>
          </div>
          <button type="button" onClick={onAdd} className="library-primary-button"><Plus size={16} /><span>Add game</span></button>
        </div>
      </div>

      <div className="library-workspace-grid">
        <aside className="library-filter-rail" aria-label="Library categories">
          <div className="library-filter-heading">
            <p className="library-eyebrow">BROWSE BY</p>
            <span>{games.length} shown</span>
          </div>
          <div className="library-filter-list">
            {filters.map(({ id }) => (
              <button type="button" key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} className={cn('library-filter-option', filter === id && 'is-active')}>
                <span className={`library-filter-dot filter-${id}`} />
                <span>{labelFor(id)}</span>
                <small>{counts[id] ?? 0}</small>
              </button>
            ))}
          </div>
          <div className="library-rail-tip">
            <Gamepad2 size={15} />
            <span>Double-click any cover to launch it.</span>
          </div>
        </aside>

        <section className="library-focus-column" aria-label={`${selected.title} overview`}>
          <div className={`library-game-profile${showArtwork ? '' : ' no-art'}`}>
            <div className="library-profile-art">
              <Cover game={selected} className="size-full" fit="cover" loading="eager" />
            </div>
            <div className="library-profile-copy">
              <div className="library-profile-overline">
                <span className={`library-status-mark status-${selected.status}`} />
                <span>{selected.hidden ? 'Hidden' : selected.planned ? 'Planned' : selected.status === 'playing' ? 'In progress' : selected.status}</span>
                {selected.favorite && <Star size={12} fill="currentColor" className="text-amber-300" />}
              </div>
              <h1>{selected.title}</h1>
              <p className="library-profile-meta">
                {[selected.meta?.developer, selected.meta?.releaseYear, selected.meta?.genres?.slice(0, 2).join(' · ')].filter(Boolean).join('  /  ') || 'Game details will appear here when available'}
              </p>
              <div className="library-profile-actions">
                <button type="button" onClick={playing ? onStop : () => onPlay(selected)} className="library-primary-button library-play-button">
                  {playing ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                  {playing ? 'Stop session' : selected.planned ? 'Start timer' : 'Play'}
                </button>
                <button type="button" onClick={() => onToggleFavorite(selected.id)} className={cn('library-icon-action', selected.favorite && 'is-favorite')} title={selected.favorite ? 'Remove favorite' : 'Add favorite'} aria-label={selected.favorite ? 'Remove favorite' : 'Add favorite'}>
                  <Star size={16} fill={selected.favorite ? 'currentColor' : 'none'} />
                </button>
                <button type="button" onClick={() => onEdit(selected.id)} className="library-icon-action" title="Edit game" aria-label="Edit game"><Pencil size={15} /></button>
                <button type="button" onClick={() => onDetails(selected.id)} className="library-details-action"><Info size={14} /> Full details</button>
              </div>
              <div className="library-profile-stats">
                <div><span>Total playtime</span><b>{fmtMinutes(selected.playSecs / 60)}</b></div>
                <div><span>Last played</span><b>{fmtDate(selected.lastPlayed)}</b></div>
                <div><span>Sessions</span><b>{selected.sessionCount}</b></div>
              </div>
            </div>
          </div>

          <section className="library-information-card">
            <div className="library-section-heading"><div><p className="library-eyebrow">GAME FILE</p><h3>At a glance</h3></div><button type="button" onClick={() => onDetails(selected.id)} aria-label="Open all game details"><Info size={15} /></button></div>
            <div className="library-facts-grid">
              <div><span>STATUS</span><Select value={selected.status} onChange={(status) => onUpdate(selected.id, { status })} ariaLabel="Game status" options={STATUS_OPTIONS} /></div>
              <div><span>PLATFORM</span><b>{sourceLabel(selected)}</b></div>
              <div><span>INSTALL LOCATION</span><b>{selected.installDir ? driveLabel(selected.drive || selected.installDir) : 'Not installed'}</b></div>
              <div><span>FILE SIZE</span><b>{selected.sizeGb > 0 ? `${selected.sizeGb.toFixed(1)} GB` : 'Not measured'}</b></div>
            </div>
            <p className="library-summary">{selected.meta?.summary || 'No overview has been added yet. Open full details to fetch or edit game information.'}</p>
          </section>

          <section className="library-activity-card">
            <div className="library-section-heading"><div><p className="library-eyebrow">YOUR ACTIVITY</p><h3>Recent history</h3></div><button type="button" onClick={() => onDetails(selected.id)} aria-label="Open session history"><Clock3 size={15} /></button></div>
            {recentSessions.length > 0 ? recentSessions.map((row, index) => (
              <div className="library-history-row" key={row.id}>
                <span className={`library-history-marker${index === 0 ? ' is-latest' : ''}`} />
                <div><b>{row.playthroughName || (row.manual ? 'Time logged' : 'Play session')}</b><p>{fmtDate(new Date(row.startedAt * 1000).toISOString())}{row.note ? ` · ${row.note}` : ''}</p></div>
                <small>{fmtMinutes(row.durationSecs / 60)}</small>
              </div>
            )) : selected.lastPlayed ? (
              <div className="library-history-row"><span className="library-history-marker" /><div><b>Last played</b><p>{fmtDate(selected.lastPlayed)} · {selected.sessionCount} recorded {selected.sessionCount === 1 ? 'session' : 'sessions'}</p></div><small>{fmtMinutes(selected.playSecs / 60)}</small></div>
            ) : (
              <div className="library-history-empty"><Clock3 size={16} /><span>No recorded sessions yet. Play starts tracking automatically.</span></div>
            )}
          </section>

          <section className="library-collection-card">
            <div className="library-section-heading"><div><p className="library-eyebrow">YOUR GAMES</p><h3>{labelFor(filter)} <span>{games.length}</span></h3></div><label className="library-size-control">Cover size<input type="range" min={70} max={150} step={5} value={scale} onChange={(event) => setScale(Number(event.target.value))} aria-label="Cover size" /></label></div>
            {!games.length ? <p className="library-no-results">Nothing in this category matches the current search.</p> : view === 'grid' ? (
              <GameGrid games={games} selectedId={selected.id} onSelect={onSelect} onEdit={onEdit} onToggleFavorite={onToggleFavorite} onPlay={onPlay} scale={scale} onReorder={sort === 'manual' ? onReorder : undefined} coverTint={settings.coverTint !== false} />
            ) : (
              <GameList games={games} selectedId={selected.id} onSelect={onSelect} onEdit={onEdit} onToggleFavorite={onToggleFavorite} onPlay={onPlay} scale={scale} onReorder={sort === 'manual' ? onReorder : undefined} />
            )}
          </section>
        </section>

        <aside className="library-inspector" aria-label="Selected game facts">
          <div className="library-inspector-cover"><Cover game={selected} className="size-full" fit="contain" loading="eager" /></div>
          <div className="library-inspector-title"><p className="library-eyebrow">SELECTED TITLE</p><h2>{selected.title}</h2><p>{selected.meta?.developer || 'Unknown studio'}{selected.meta?.releaseYear ? ` · ${selected.meta.releaseYear}` : ''}</p></div>
          <div className="library-inspector-divider" />
          <div className="library-inspector-stat"><span>Playtime</span><b>{fmtMinutes(selected.playSecs / 60)}</b></div>
          <div className="library-inspector-stat"><span>Longest session</span><b>{fmtMinutes(selected.longestSecs / 60)}</b></div>
          <div className="library-inspector-stat"><span>Added to Orbit</span><b>{fmtDate(selected.addedAt)}</b></div>
          <div className="library-inspector-tags">
            <p className="library-eyebrow">GENRES</p>
            <div>{(selected.meta?.genres ?? []).length ? selected.meta!.genres.slice(0, 6).map((genre) => <span key={genre}>{genre}</span>) : <small>Not categorized</small>}</div>
          </div>
          <div className="library-inspector-source"><MapPin size={14} /><span>{selected.installDir ? selected.installDir : sourceLabel(selected)}</span></div>
        </aside>
      </div>
    </div>
  );
}
