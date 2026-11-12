import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clock3, Disc3, Grid2X2, Images, Info, Pencil, Play, Plus, Star, Square } from 'lucide-react';
import type { Game, GameLog, LibraryFilter, Session, Settings, SortKey, ViewMode } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { listGameLogs, listSessions, overlayGallery, type GalleryItem } from '../services/native';
import { fileSrc } from '../services/desktop';
import { cn } from '../utils/cn';
import { orderedLibraryFilters } from './Toolbar';
import { SearchField } from './ui/SearchField';
import { Select } from './ui/Select';
import { Cover } from './ui/Cover';
import { GameGrid } from './GameGrid';
import './LibraryWorkspace.css';

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

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title', label: 'Title, A to Z' },
  { value: 'lastPlayed', label: 'Recently played' },
  { value: 'playtime', label: 'Most played' },
  { value: 'added', label: 'Recently added' },
  { value: 'size', label: 'Install size' },
  { value: 'manual', label: 'Custom order' },
];

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
  onReorder,
}: Props) {
  const configuredFilters = orderedLibraryFilters(settings.libraryFilterOrder)
    .filter(({ id }) => !(settings.hiddenLibraryFilters ?? []).includes(id));
  const filters = configuredFilters.length ? configuredFilters : [{ id: 'all' as LibraryFilter, label: 'All games' }];
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
  const [gameLogs, setGameLogs] = useState<GameLog[]>([]);
  const [gameCaptures, setGameCaptures] = useState<GalleryItem[]>([]);
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

  useEffect(() => {
    if (!selected) return;
    let current = true;
    setGameLogs([]);
    setGameCaptures([]);
    void listGameLogs(selected.id).then((rows) => { if (current) setGameLogs(rows); }).catch(() => { if (current) setGameLogs([]); });
    void overlayGallery().then((items) => {
      const comparable = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const title = comparable(selected.title);
      if (current) setGameCaptures(items.filter((item) => item.kind === 'screenshot' && comparable(item.game) === title));
    }).catch(() => { if (current) setGameCaptures([]); });
    return () => { current = false; };
  }, [selected?.id, selected?.meta?.steamAppId]);

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
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>Focus</button>
            <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={14} /> Grid</button>
          </div>
          <button type="button" onClick={onAdd} className="library-primary-button"><Plus size={16} /><span>Add game</span></button>
        </div>
      </div>

      <div className={`library-browser-filters${view === 'grid' ? ' grid-mode' : ''}`} aria-label="Library filters">
        {filters.map(({ id }) => (
          <button type="button" key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} className={cn('library-filter-option', filter === id && 'is-active')}>
            <span className={`library-filter-dot filter-${id}`} />{labelFor(id)}<small>{counts[id] ?? 0}</small>
          </button>
        ))}
      </div>

      {view === 'grid' ? (
        <section className="library-grid-page" aria-label="Game collection">
          <div className="library-grid-heading"><div><p className="library-eyebrow">YOUR COLLECTION</p><h1>{labelFor(filter)} <span>{games.length}</span></h1></div><label className="library-size-control">Cover size<input type="range" min={70} max={150} step={5} value={scale} onChange={(event) => setScale(Number(event.target.value))} aria-label="Cover size" /></label></div>
          {!games.length ? <p className="library-no-results">Nothing in this category matches the current search.</p> : <GameGrid games={games} selectedId={selected.id} onSelect={onSelect} onEdit={onEdit} onToggleFavorite={onToggleFavorite} onPlay={onPlay} scale={scale} onReorder={sort === 'manual' ? onReorder : undefined} coverTint={settings.coverTint !== false} />}
        </section>
      ) : (
        <div className="library-focus-layout">
          <aside className="library-focus-game">
            <div className="library-focus-cover"><Cover game={selected} className="size-full" fit="contain" loading="eager" /></div>
            <div className="library-focus-playtime"><Clock3 size={14} /><span>{fmtMinutes(selected.playSecs / 60)} played</span></div>
            <div className="library-profile-actions">
              <button type="button" onClick={playing ? onStop : () => onPlay(selected)} className="library-primary-button library-play-button">{playing ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{playing ? 'Stop session' : selected.planned ? 'Start timer' : 'Play'}</button>
              <button type="button" onClick={() => onToggleFavorite(selected.id)} className={cn('library-icon-action', selected.favorite && 'is-favorite')} title={selected.favorite ? 'Remove favorite' : 'Add favorite'} aria-label={selected.favorite ? 'Remove favorite' : 'Add favorite'}><Star size={16} fill={selected.favorite ? 'currentColor' : 'none'} /></button>
              <button type="button" onClick={() => onEdit(selected.id)} className="library-icon-action" title="Edit game" aria-label="Edit game"><Pencil size={15} /></button>
              <button type="button" onClick={() => onDetails(selected.id)} className="library-details-action"><Info size={14} /> Details</button>
            </div>
            <div className="library-focus-quickstats"><span>{selected.status === 'playing' ? 'In progress' : selected.status === 'backlog' ? 'Planned' : labelFor(selected.status)}</span><span>{selected.sessionCount} sessions</span><span>{selected.meta?.releaseYear || 'Release year unknown'}</span></div>
          </aside>

          <main className="library-focus-content">
            <header className="library-focus-header">
              <div><p className="library-eyebrow">{selected.meta?.developer || sourceLabel(selected)}{selected.meta?.releaseYear ? ` · ${selected.meta.releaseYear}` : ''}</p><h1>{selected.title}</h1><p>{(selected.meta?.genres ?? []).slice(0, 4).join('  ·  ') || 'Game details and your activity in one place'}</p></div>
              <button type="button" onClick={() => onUpdate(selected.id, { status: selected.status === 'completed' ? 'playing' : 'completed' })} className="library-complete-action">{selected.status === 'completed' ? 'Completed' : 'Mark complete'}</button>
            </header>

            <section className="library-media-strip" aria-label="Screenshots and journal">
              <div className="library-strip-heading"><div><p className="library-eyebrow">YOUR ORBIT CAPTURES</p><h2><Images size={15} /> Screenshots &amp; journal</h2></div><button type="button" onClick={() => onDetails(selected.id)}>View all</button></div>
              {gameCaptures.length || gameLogs.length ? <div className="library-media-items">
                {gameCaptures.slice(0, 4).map((capture) => <a className="library-media-shot" href={fileSrc(capture.path)} target="_blank" rel="noreferrer" key={capture.path}><img src={fileSrc(capture.path)} alt={`${selected.title} screenshot`} loading="lazy" /></a>)}
                {gameLogs.slice(0, 4).map((log) => <button type="button" className="library-journal-card" key={log.id} onClick={() => onDetails(selected.id)}><BookOpen size={15} /><span>{log.note || 'Journal entry'}</span><small>{fmtDate(new Date(log.at * 1000).toISOString())}</small></button>)}
              </div> : <div className="library-media-empty"><Images size={17} /><span>Add an Orbit screenshot or journal entry and it will appear here.</span></div>}
            </section>

            <div className="library-focus-lower">
              <section className="library-overview-card"><div className="library-strip-heading"><div><p className="library-eyebrow">OVERVIEW</p><h2>About this game</h2></div><button type="button" onClick={() => onDetails(selected.id)} aria-label="Open full details"><Info size={15} /></button></div><p>{selected.meta?.summary || 'No overview has been added yet. Open full details to fetch or edit game information.'}</p><div className="library-overview-meta"><span><b>Platform</b>{sourceLabel(selected)}</span><span><b>Install size</b>{selected.sizeGb > 0 ? `${selected.sizeGb.toFixed(1)} GB` : 'Not measured'}</span><span><b>Location</b>{selected.installDir ? driveLabel(selected.drive || selected.installDir) : 'Not installed'}</span></div></section>
              <section className="library-timeline-card"><div className="library-strip-heading"><div><p className="library-eyebrow">PLAY HISTORY</p><h2><Clock3 size={15} /> Sessions</h2></div><button type="button" onClick={() => onDetails(selected.id)}>All activity</button></div>
                {recentSessions.length ? <div className="library-timeline">{recentSessions.map((row, index) => <article className="library-timeline-row" key={row.id}><span className={`library-history-marker${index === 0 ? ' is-latest' : ''}`} /><div><b>{row.playthroughName || (row.manual ? 'Time logged' : 'Play session')}</b><p>{fmtDate(new Date(row.startedAt * 1000).toISOString())}{row.note ? ` · ${row.note}` : ''}</p></div><small>{fmtMinutes(row.durationSecs / 60)}</small></article>)}</div> : selected.lastPlayed ? <div className="library-history-empty"><Clock3 size={16} /><span>Last played {fmtDate(selected.lastPlayed)} · {selected.sessionCount} recorded sessions.</span></div> : <div className="library-history-empty"><Clock3 size={16} /><span>No recorded sessions yet. Play starts tracking automatically.</span></div>}
              </section>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
