import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Check, ChevronDown, Clock3, Disc3, Grid2X2, Images, Info, List, Pencil, Play, Plus, RefreshCw, SlidersHorizontal, Star, Square, X } from 'lucide-react';
import type { Game, GameLog, GameStatus, LibraryFilter, Session, Settings, SortKey, ViewMode } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { listGameLogs, listSessions, overlayGallery, type GalleryItem } from '../services/native';
import { fileSrc } from '../services/desktop';
import { cn } from '../utils/cn';
import { orderedLibraryFilters } from './Toolbar';
import { Select } from './ui/Select';
import { Cover } from './ui/Cover';
import { GameGrid } from './GameGrid';
import { Logo } from './ui/Logo';
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
  onSettingsUpdate: (patch: Partial<Settings>) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onRefresh: () => void;
  activeGameTitle: string | null;
  activeGameClock: string | null;
  runningId: string | null;
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
const STATUS_OPTIONS: { value: GameStatus; label: string }[] = [
  { value: 'backlog', label: 'Planned' },
  { value: 'playing', label: 'Playing' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
];

function labelFor(filter: LibraryFilter): string {
  return filter === 'all' ? 'All games' : filter === 'favorites' ? 'Favorites' : filter === 'unplayed' ? 'Unplayed' : filter === 'hidden' ? 'Hidden' : filter[0].toUpperCase() + filter.slice(1);
}
function sourceLabel(game: Game): string {
  if (game.launch.kind === 'steam') return 'Steam';
  if (game.launch.kind === 'lutris') return 'Lutris';
  if (game.launch.kind === 'wine') return game.launch.proton ? 'Proton / Wine' : 'Wine';
  if (game.launch.kind === 'executable') return 'Local executable';
  if (game.installDir) return 'Local install';
  return 'Manual tracking';
}
function shortDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function dayKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export function LibraryWorkspace({
  games, collection, settings, filter, setFilter, query, setQuery, sort, setSort,
  view, setView, scale, setScale, onSettingsUpdate, selectedId, onSelect, onDetails,
  onEdit, onToggleFavorite, onPlay, onStop, onAdd, onUpdate, onRefresh,
  activeGameTitle, activeGameClock, runningId, onReorder,
}: Props) {
  const configuredFilters = orderedLibraryFilters(settings.libraryFilterOrder).filter(({ id }) => !(settings.hiddenLibraryFilters ?? []).includes(id));
  const filters = configuredFilters.length ? configuredFilters : [{ id: 'all' as LibraryFilter, label: 'All games' }];
  const counts = useMemo(() => {
    const result: Partial<Record<LibraryFilter, number>> = {};
    for (const item of filters) result[item.id] = collection.filter((game) => {
      if (item.id === 'all') return !game.hidden;
      if (item.id === 'favorites') return game.favorite && !game.hidden;
      if (item.id === 'unplayed') return game.sessionCount === 0 && !game.hidden;
      if (item.id === 'hidden') return !!game.hidden;
      return game.status === item.id && !game.hidden;
    }).length;
    return result;
  }, [collection, filters]);
  const selected = games.find((game) => game.id === selectedId) ?? games[0] ?? null;
  const [sessionHistory, setSessionHistory] = useState<Session[]>([]);
  const [gameLogs, setGameLogs] = useState<GameLog[]>([]);
  const [gameCaptures, setGameCaptures] = useState<GalleryItem[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMenu, setViewMenu] = useState<ViewMode | null>(null);
  const [activityTab, setActivityTab] = useState<'timeline' | 'journal'>('timeline');
  const [gridDrawerOpen, setGridDrawerOpen] = useState(true);
  const [detailLayout, setDetailLayout] = useState<'covers' | 'list'>(() => localStorage.getItem('orbit.details-layout') === 'list' ? 'list' : 'covers');
  const controlsRef = useRef<HTMLDivElement>(null);
  const playing = selected ? runningId === selected.id : false;

  useEffect(() => { localStorage.setItem('orbit.details-layout', detailLayout); }, [detailLayout]);
  useEffect(() => {
    if (!filtersOpen && !viewMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setFiltersOpen(false);
        setViewMenu(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setFiltersOpen(false); setViewMenu(null); }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', escape);
    };
  }, [filtersOpen, viewMenu]);
  useEffect(() => {
    if (!selected) { setSessionHistory([]); setGameLogs([]); setGameCaptures([]); return; }
    let current = true;
    void listSessions(30, 0, selected.id).then((rows) => { if (current) setSessionHistory(rows); }).catch(() => { if (current) setSessionHistory([]); });
    setGameLogs([]);
    setGameCaptures([]);
    void listGameLogs(selected.id).then((rows) => { if (current) setGameLogs(rows); }).catch(() => { if (current) setGameLogs([]); });
    void overlayGallery().then((items) => {
      const comparable = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const title = comparable(selected.title);
      if (current) setGameCaptures(items.filter((item) => item.kind === 'screenshot' && comparable(item.game) === title));
    }).catch(() => { if (current) setGameCaptures([]); });
    return () => { current = false; };
  }, [selected?.id, selected?.sessionCount]);

  const sessionGroups = useMemo(() => {
    const groups = new Map<string, { startedAt: number; sessions: Session[]; duration: number }>();
    for (const session of sessionHistory) {
      const key = dayKey(session.startedAt);
      const group = groups.get(key) ?? { startedAt: session.startedAt, sessions: [], duration: 0 };
      group.sessions.push(session);
      group.duration += session.durationSecs;
      group.startedAt = Math.max(group.startedAt, session.startedAt);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [sessionHistory]);
  const backdrop = selected?.meta?.backgroundUrl || selected?.meta?.headerUrl || (selected?.coverPath ? fileSrc(selected.coverPath) : null);
  const resetEmpty = () => { setFilter('all'); setQuery(''); };

  if (!selected) return (
    <div className="library-workspace library-empty-state">
      <div className="library-empty-card">
        <Logo className="library-empty-logo" />
        <span className="library-empty-icon"><Disc3 size={22} /></span>
        <h2>{collection.length ? 'No games match this view' : 'Start your collection'}</h2>
        <p>{collection.length ? 'Adjust your filters or search to see more of your library.' : 'Add a game to build your library. Orbit keeps your games, playtime, and notes together.'}</p>
        {(filter !== 'all' || query) && <button type="button" className="library-reset-view-button" onClick={resetEmpty}>Show all games</button>}
        <button type="button" onClick={onAdd} className="library-primary-button"><Plus size={16} /> Add a game</button>
      </div>
    </div>
  );

  return (
    <div className={`library-workspace${view === 'grid' ? ' is-grid-view' : ' is-details-view'}`}>
      <div className="library-backdrop" aria-hidden style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined} />
      <header className="library-page-heading">
        <div><p className="library-eyebrow">YOUR COLLECTION</p><h1>Library</h1><p>{collection.filter((game) => !game.hidden).length} games <span>·</span> {fmtMinutes(collection.reduce((total, game) => total + game.playSecs, 0) / 60)} played</p></div>
        <div className="library-heading-actions" ref={controlsRef}>
          {activeGameTitle && <div className="library-running-session"><span /><b>{activeGameTitle}</b><small>{activeGameClock}</small><button type="button" onClick={onStop} aria-label="Stop current session"><Square size={12} fill="currentColor" /></button></div>}
          <div className="library-control-wrap">
            <button type="button" className={cn('library-toolbar-button', filtersOpen && 'is-active')} onClick={() => { setFiltersOpen((open) => !open); setViewMenu(null); }} aria-label={`Filter and sort games${filter !== 'all' ? `, current filter ${labelFor(filter)}` : ''}`} aria-expanded={filtersOpen}><SlidersHorizontal size={15} /><span>{filter === 'all' ? 'Filter' : labelFor(filter)}</span><ChevronDown size={12} /></button>
            {filtersOpen && <div className="library-control-popover library-filter-popover">
              <div className="library-popover-heading"><b>Filter & sort</b><button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={15} /></button></div>
              <div className="library-popover-filters">{filters.map(({ id }) => <button type="button" key={id} onClick={() => { setFilter(id); setFiltersOpen(false); }} aria-pressed={filter === id} className={cn('library-filter-choice', filter === id && 'is-active')}><span className={`library-filter-dot filter-${id}`} />{labelFor(id)}<small>{counts[id] ?? 0}</small></button>)}</div>
              <div className="library-popover-sort"><span>Sort by</span><Select value={sort} onChange={setSort} ariaLabel="Sort games" options={SORT_OPTIONS} className="library-sort" /></div>
              <button type="button" className="library-add-from-filter" onClick={() => { setFiltersOpen(false); onAdd(); }}><Plus size={14} />Add a game</button>
            </div>}
          </div>
          <div className="library-view-controls" role="group" aria-label="Library view">
            <div className="library-view-control"><button type="button" onClick={() => { setView('list'); setViewMenu(null); }} aria-pressed={view === 'list'}><List size={15} />Details</button><button type="button" className="library-view-options" onClick={() => { setViewMenu((current) => current === 'list' ? null : 'list'); setFiltersOpen(false); }} aria-label="Details view settings" aria-expanded={viewMenu === 'list'}><ChevronDown size={13} /></button>
              {viewMenu === 'list' && <div className="library-control-popover library-view-popover"><b>Details view</b><span>Game list</span><button type="button" aria-pressed={detailLayout === 'covers'} onClick={() => { setDetailLayout('covers'); setViewMenu(null); }}><Images size={14} />Cover list</button><button type="button" aria-pressed={detailLayout === 'list'} onClick={() => { setDetailLayout('list'); setViewMenu(null); }}><List size={14} />Compact list</button></div>}
            </div>
            <div className="library-view-control"><button type="button" onClick={() => { setView('grid'); setViewMenu(null); }} aria-pressed={view === 'grid'}><Grid2X2 size={15} />Grid</button><button type="button" className="library-view-options" onClick={() => { setViewMenu((current) => current === 'grid' ? null : 'grid'); setFiltersOpen(false); }} aria-label="Grid view settings" aria-expanded={viewMenu === 'grid'}><ChevronDown size={13} /></button>
              {viewMenu === 'grid' && <div className="library-control-popover library-view-popover"><b>Grid view</b><label>Cover size<input type="range" min={70} max={150} step={5} value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label><button type="button" aria-pressed={settings.coverTint !== false} onClick={() => onSettingsUpdate({ coverTint: settings.coverTint === false })}><span className="library-check"><Check size={12} /></span>Tint covers</button></div>}
            </div>
          </div>
          <button type="button" onClick={onRefresh} className="library-toolbar-icon" aria-label="Refresh library" title="Refresh library"><RefreshCw size={15} /></button>
          <button type="button" onClick={onAdd} className="library-add-button"><Plus size={14} />Add game</button>
        </div>
      </header>

      {view === 'grid' ? (
        <section className={`library-grid-layout${gridDrawerOpen ? ' has-drawer' : ''}`} aria-label="Game collection">
          <div className="library-grid-page">
            {!games.length ? <p className="library-no-results">No games match the current filter or search.</p> : <div className="library-grid-shelf" style={{ '--orbit-cover-scale': String(scale / 100) } as CSSProperties}>
              <GameGrid games={games} selectedId={selected.id} onSelect={(id) => { onSelect(id); setGridDrawerOpen(true); }} onEdit={onEdit} onToggleFavorite={onToggleFavorite} onPlay={onPlay} scale={scale} onReorder={sort === 'manual' ? onReorder : undefined} coverTint={settings.coverTint !== false} />
            </div>}
          </div>
          {gridDrawerOpen && <aside className="library-grid-drawer" aria-label={`${selected.title} game details`}>
            <div className="library-grid-drawer-hero" style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined} />
            <button type="button" className="library-drawer-close" onClick={() => setGridDrawerOpen(false)} aria-label="Close game details"><X size={15} /></button>
            <div className="library-grid-drawer-heading"><div className="library-grid-drawer-cover"><Cover game={selected} className="size-full" fit="contain" /></div><div><h2>{selected.title}</h2><p>{selected.meta?.releaseYear || 'Release year unknown'} · {sourceLabel(selected)}</p><small>{selected.status === 'backlog' ? 'Planned' : selected.status}</small></div></div>
            <div className="library-grid-drawer-body">
              <div className="library-drawer-actions"><button type="button" className="library-primary-button library-play-button" onClick={playing ? onStop : () => onPlay(selected)}>{playing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{playing ? 'Stop session' : selected.planned ? 'Start timer' : 'Play'}</button><button type="button" onClick={() => onToggleFavorite(selected.id)} className={cn('library-icon-action', selected.favorite && 'is-favorite')} aria-label={selected.favorite ? 'Remove favorite' : 'Add favorite'}><Star size={15} fill={selected.favorite ? 'currentColor' : 'none'} /></button><button type="button" onClick={() => onEdit(selected.id)} className="library-icon-action" aria-label="Edit game"><Pencil size={14} /></button></div>
              <Select value={selected.status} onChange={(status) => onUpdate(selected.id, { status })} ariaLabel="Game status" options={STATUS_OPTIONS} className="library-status-select" />
              <div className="library-drawer-numbers"><span><b>{fmtMinutes(selected.playSecs / 60)}</b> played</span><span><b>{selected.sessionCount}</b> sessions</span></div>
              <p className="library-drawer-summary">{selected.meta?.summary || 'No overview has been added yet.'}</p>
              <div className="library-grid-drawer-facts"><div><span>Developer</span><b>{selected.meta?.developer || 'Unknown'}</b></div><div><span>Genre</span><b>{selected.meta?.genres?.join(', ') || 'Uncategorized'}</b></div><div><span>Last played</span><b>{selected.lastPlayed ? fmtDate(selected.lastPlayed) : 'Never'}</b></div><div><span>Install size</span><b>{selected.sizeGb > 0 ? `${selected.sizeGb.toFixed(1)} GB` : 'Not measured'}</b></div>{selected.hltb && <div><span>How long to beat</span><b>{selected.hltb.main}h main</b></div>}</div>
              {selected.meta?.rating != null && <div className="library-drawer-rating"><Star size={13} fill="currentColor" />Critic rating <b>{selected.meta.rating}</b></div>}
              {!!selected.achievements?.length && <div className="library-drawer-achievement"><TrophyIcon />{selected.achievements.filter((item) => item.unlocked).length} / {selected.achievements.length} achievements</div>}
              {gameCaptures.length > 0 && <div className="library-drawer-gallery">{gameCaptures.slice(0, 3).map((capture) => <img key={capture.path} src={fileSrc(capture.path)} alt={`${selected.title} screenshot`} loading="lazy" />)}</div>}
              <button type="button" className="library-full-details" onClick={() => setView('list')}><Info size={13} />Open full details</button>
            </div>
          </aside>}
        </section>
      ) : (
        <div className={`library-details-layout layout-${detailLayout}`}>
          <section className="library-game-browser" aria-label="Games in this collection">
            <header><div><h2>Games</h2><small>{games.length} shown</small></div><span className="library-browser-filter">{labelFor(filter)}</span></header>
            <div className="library-game-browser-grid">{games.map((game) => <button type="button" key={game.id} aria-pressed={selected.id === game.id} onClick={() => onSelect(game.id)} onDoubleClick={() => onPlay(game)} title={game.title} className={cn('library-mini-game', selected.id === game.id && 'is-selected')}>
              <span className="library-mini-cover"><Cover game={game} className="size-full" fit="cover" /></span>
              <span className="library-mini-copy"><b>{game.title}</b><small>{game.meta?.releaseYear || sourceLabel(game)}</small><em>{game.status === 'backlog' ? 'Planned' : game.status}</em></span>
              <span className="library-mini-time"><Clock3 size={10} />{fmtMinutes(game.playSecs / 60)}</span>
            </button>)}</div>
            {!games.length && <p className="library-no-results">No games match. Change the filter above or clear the search.</p>}
          </section>

          <main className="library-detail-content" aria-label={`${selected.title} details`}>
            <header className="library-detail-hero">
              <div className="library-detail-backdrop" style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined} />
              <Cover game={selected} className="library-detail-cover" fit="contain" loading="eager" />
              <div className="library-detail-title"><div className="library-game-meta"><span className={`library-status-dot status-${selected.status}`} />{selected.status === 'backlog' ? 'Planned' : selected.status}<i>·</i>{selected.meta?.releaseYear || 'Release year unknown'}<i>·</i>{sourceLabel(selected)}</div><h2>{selected.title}</h2><p>{(selected.meta?.genres ?? []).slice(0, 3).join(' · ') || 'Uncategorized'}{selected.meta?.developer ? ` · ${selected.meta.developer}` : ''}</p>
                <div className="library-detail-actions"><button type="button" onClick={playing ? onStop : () => onPlay(selected)} className="library-primary-button library-play-button">{playing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{playing ? 'Stop session' : selected.planned ? 'Start timer' : 'Play'}</button><button type="button" onClick={() => onToggleFavorite(selected.id)} className={cn('library-icon-action', selected.favorite && 'is-favorite')} aria-label={selected.favorite ? 'Remove favorite' : 'Add favorite'} title={selected.favorite ? 'Remove favorite' : 'Add favorite'}><Star size={15} fill={selected.favorite ? 'currentColor' : 'none'} /></button><button type="button" onClick={() => onEdit(selected.id)} className="library-icon-action" aria-label="Edit game" title="Edit game"><Pencil size={14} /></button><Select value={selected.status} onChange={(status) => onUpdate(selected.id, { status })} ariaLabel="Game status" options={STATUS_OPTIONS} className="library-status-select" /></div>
              </div>
              <div className="library-detail-score">{selected.meta?.rating != null ? <><span>Critic score</span><b>{selected.meta.rating}</b></> : <button type="button" onClick={() => onEdit(selected.id)}>Add rating</button>}</div>
            </header>

            <div className="library-detail-columns">
              <div className="library-detail-main-column">
                <section className="library-info-panel library-overview-panel"><header><h3>Overview</h3><button type="button" onClick={() => onEdit(selected.id)} aria-label="Edit overview"><Pencil size={13} /></button></header><p>{selected.meta?.summary || 'No overview has been added yet. Add your own notes in Edit game.'}</p><div className="library-overview-foot"><span>{fmtMinutes(selected.playSecs / 60)} played</span><i>·</i><span>{selected.sessionCount} sessions</span>{selected.hltb && <><i>·</i><span>{selected.hltb.main}h to beat</span></>}</div></section>
                <section className="library-info-panel library-hltb-panel"><header><h3>How long to beat</h3><button type="button" onClick={() => onEdit(selected.id)} aria-label="Edit HowLongToBeat details"><Pencil size={13} /></button></header>{selected.hltb ? <div className="library-hltb-metrics"><div><b>{selected.hltb.main}h</b><span>Main story</span></div><div><b>{selected.hltb.mainExtra}h</b><span>Main + extras</span></div><div><b>{selected.hltb.completionist}h</b><span>Completionist</span></div><small>Source: {selected.hltb.source === 'hltb' ? 'HowLongToBeat' : 'estimate'}</small></div> : <p className="library-info-empty">No HowLongToBeat estimate yet.</p>}</section>
                <section className="library-info-panel library-activity-panel"><header><div><h3>{activityTab === 'timeline' ? 'Recent sessions' : 'Journal'}</h3><small>{selected.sessionCount} recorded sessions</small></div><div className="library-activity-switch"><button type="button" aria-pressed={activityTab === 'timeline'} onClick={() => setActivityTab('timeline')}>Sessions</button><button type="button" aria-pressed={activityTab === 'journal'} onClick={() => setActivityTab('journal')}>Journal</button></div></header>
                  {activityTab === 'timeline' ? sessionGroups.length ? <div className="library-timeline-list">{sessionGroups.map((group) => <article className="library-timeline-day" key={dayKey(group.startedAt)}><div className="library-timeline-date"><b>{shortDay(group.startedAt)}</b><small>{group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}</small></div><span className="library-timeline-node" /><div className="library-timeline-event"><b>Played {fmtMinutes(group.duration / 60)}</b>{group.sessions.map((session) => session.note && <p key={session.id}>{session.note}</p>)}</div></article>)}</div> : <div className="library-activity-empty"><Clock3 size={15} /><span>No recorded sessions yet.</span></div> : gameLogs.length ? <div className="library-journal-list">{gameLogs.slice(0, 8).map((log) => <article key={log.id}><span className="library-journal-date">{shortDay(log.at)}</span><div><b>{log.note || 'Journal entry'}</b>{log.details && <p>{log.details}</p>}</div><small>{log.secs > 0 ? fmtMinutes(log.secs / 60) : ''}</small></article>)}</div> : <div className="library-activity-empty"><BookOpen size={15} /><span>No journal entries yet.</span></div>}
                  <button type="button" className="library-view-history" onClick={() => onDetails(selected.id)}>Open full game history <span>→</span></button>
                </section>
              </div>
              <aside className="library-detail-side-column">
                <section className="library-info-panel"><header><h3>Details</h3></header><dl className="library-detail-facts"><div><dt>Developer</dt><dd>{selected.meta?.developer || 'Unknown'}</dd></div><div><dt>Release</dt><dd>{selected.meta?.releaseYear || 'Unknown'}</dd></div><div><dt>Genre</dt><dd>{selected.meta?.genres?.join(', ') || 'Uncategorized'}</dd></div><div><dt>Platform</dt><dd>{sourceLabel(selected)}</dd></div><div><dt>Install location</dt><dd title={selected.installDir || ''}>{selected.installDir ? driveLabel(selected.drive || selected.installDir) : 'Not installed'}</dd></div><div><dt>Playtime</dt><dd>{fmtMinutes(selected.playSecs / 60)}</dd></div><div><dt>Sessions</dt><dd>{selected.sessionCount}</dd></div>{selected.sizeGb > 0 && <div><dt>File size</dt><dd>{selected.sizeGb.toFixed(1)} GB</dd></div>}</dl></section>
                {!!selected.achievements?.length && <section className="library-info-panel library-achievements"><header><h3>Achievements</h3><small>{selected.achievements.filter((item) => item.unlocked).length}/{selected.achievements.length}</small></header><div className="library-achievement-progress"><span style={{ width: `${Math.round(selected.achievements.filter((item) => item.unlocked).length / selected.achievements.length * 100)}%` }} /></div>{selected.achievements.filter((item) => item.unlocked).slice(0, 5).map((achievement) => <div className="library-achievement-row" key={achievement.id}>{achievement.icon ? <img src={achievement.icon} alt="" /> : <span className="library-achievement-placeholder"><Check size={12} /></span>}<span><b>{achievement.name}</b><small>{achievement.description}</small></span></div>)}<button type="button" onClick={() => onDetails(selected.id)}>View achievements</button></section>}
                <section className="library-info-panel library-gallery-panel"><header><h3>Gallery</h3><span>{gameCaptures.length} screenshots</span></header>{gameCaptures.length ? <div className="library-media-items">{gameCaptures.slice(0, 6).map((capture) => <a className="library-media-shot" href={fileSrc(capture.path)} target="_blank" rel="noreferrer" key={capture.path}><img src={fileSrc(capture.path)} alt={`${selected.title} screenshot`} loading="lazy" /></a>)}</div> : <div className="library-activity-empty"><Images size={15} /><span>Captured screenshots show here.</span></div>}</section>
              </aside>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function TrophyIcon() { return <span className="library-trophy-icon">◆</span>; }
