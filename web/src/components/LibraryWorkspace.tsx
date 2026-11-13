import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { BookOpen, Check, Clock3, Disc3, Grid2X2, Images, Info, Menu, Pencil, Play, Plus, RefreshCw, Settings as SettingsIcon, SlidersHorizontal, Star, Square, X } from 'lucide-react';
import type { Game, GameLog, GameStatus, LibraryFilter, Session, Settings, SortKey, ViewMode } from '../types';
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
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onMenu: () => void;
  onRefresh: () => void;
  onSettings: () => void;
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

function captureDayKey(capture: GalleryItem): string | null {
  const match = capture.name.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[1])}-${Number(match[2]) - 1}-${Number(match[3])}` : null;
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
  onMenu,
  onRefresh,
  onSettings,
  activeGameTitle,
  activeGameClock,
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
  const [sessionHistory, setSessionHistory] = useState<Session[]>([]);
  const [gameLogs, setGameLogs] = useState<GameLog[]>([]);
  const [gameCaptures, setGameCaptures] = useState<GalleryItem[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activityTab, setActivityTab] = useState<'timeline' | 'journal'>('timeline');
  const [gridDrawerOpen, setGridDrawerOpen] = useState(true);
  const playing = selected ? runningId === selected.id : false;

  useEffect(() => {
    if (!selected) {
      setSessionHistory([]);
      return;
    }
    let current = true;
    void listSessions(30, 0, selected.id).then((rows) => {
      if (current) setSessionHistory(rows);
    }).catch(() => {
      if (current) setSessionHistory([]);
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
  }, [selected?.id]);

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
  const galleryCount = gameCaptures.length;
  const selectedCount = counts[filter] ?? 0;
  const backdrop = selected?.meta?.backgroundUrl || selected?.meta?.headerUrl || (selected?.coverPath ? fileSrc(selected.coverPath) : null);
  const groups = useMemo(() => {
    const definitions: { status: GameStatus; label: string }[] = [
      { status: 'playing', label: 'Playing' },
      { status: 'backlog', label: 'Planned' },
      { status: 'completed', label: 'Completed' },
      { status: 'dropped', label: 'Dropped' },
    ];
    return definitions.map((definition) => ({
      ...definition,
      games: games.filter((game) => game.status === definition.status),
    })).filter((group) => group.games.length > 0);
  }, [games]);
  const selectGame = (id: string) => {
    onSelect(id);
    setGridDrawerOpen(true);
  };

  if (!selected) {
    return (
      <div className="library-workspace library-empty-state">
        <div className="library-empty-card">
          <span className="library-empty-icon"><Disc3 size={22} /></span>
          <Logo className="library-empty-logo" />
          <h2>{collection.length ? 'No games in this view' : 'Start your collection'}</h2>
          <p>{collection.length ? 'Try a different category or search.' : 'Add a game to build your library. Orbit keeps your games, activity, and notes together.'}</p>
          <button type="button" onClick={onAdd} className="library-primary-button"><Plus size={16} /> Add a game</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`library-workspace${view === 'grid' ? ' is-grid-view' : ' is-focus-view'}`}><div className="library-backdrop" aria-hidden style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined} />
      <div className="library-commandbar">
        <div className="library-command-leading">
          <button type="button" className="library-menu-button" onClick={onMenu} aria-label="Open Orbit navigation"><Menu size={19} /></button>
          <SearchField value={query} onChange={setQuery} placeholder="Search games" className="library-search" inputClassName="w-full" />
          <div className="library-filter-control">
            <button type="button" className={cn('library-toolbar-icon', filtersOpen && 'is-active')} onClick={() => setFiltersOpen((open) => !open)} aria-label="Filters and sorting" aria-expanded={filtersOpen}><SlidersHorizontal size={16} /></button>
            {filtersOpen && <div className="library-filter-popover">
              <div className="library-popover-heading"><b>Filter library</b><button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={15} /></button></div>
              <div className="library-popover-filters">{filters.map(({ id }) => <button type="button" key={id} onClick={() => { setFilter(id); setFiltersOpen(false); }} aria-pressed={filter === id} className={cn('library-filter-choice', filter === id && 'is-active')}><span className={`library-filter-dot filter-${id}`} />{labelFor(id)}<small>{counts[id] ?? 0}</small></button>)}</div>
              <div className="library-popover-sort"><span>Sort by</span><Select value={sort} onChange={setSort} ariaLabel="Sort games" options={SORT_OPTIONS} className="library-sort" /></div>
              <label className="library-popover-size">Cover size <input type="range" min={70} max={150} step={5} value={scale} onChange={(event) => setScale(Number(event.target.value))} aria-label="Cover size" /></label>
              <button type="button" className="library-add-from-filter" onClick={() => { setFiltersOpen(false); onAdd(); }}><Plus size={14} />Add a game</button>
            </div>}
          </div>
          <button type="button" onClick={() => setFilter('all')} className="library-active-filter" aria-label={`${labelFor(filter)} filter, clear filter`}>
            <span className={`library-filter-dot filter-${filter}`} /><b>{labelFor(filter)}</b><small>{selectedCount}</small><X size={13} />
          </button>
        </div>
        <div className="library-command-actions">
          {activeGameTitle && <div className="library-running-session"><span /><b>{activeGameTitle}</b><small>{activeGameClock}</small><button type="button" onClick={onStop} aria-label="Stop current session"><Square size={12} fill="currentColor" /></button></div>}
          <div className="library-view-switch" role="group" aria-label="Collection layout">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><span className="view-focus-glyph" />Focus</button>
            <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={14} />Grid</button>
          </div>
          <button type="button" onClick={onRefresh} className="library-toolbar-icon" aria-label="Refresh library" title="Refresh library"><RefreshCw size={16} /></button>
          <button type="button" onClick={onSettings} className="library-toolbar-icon" aria-label="Open settings" title="Settings"><SettingsIcon size={17} /></button>
        </div>
      </div>

      <div className="library-filter-strip" aria-label="Library filters">
        {filters.map(({ id }) => <button type="button" key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} className={cn('library-filter-chip', filter === id && 'is-active')}>
          <span className={`library-filter-dot filter-${id}`} />{labelFor(id)}<small>{counts[id] ?? 0}</small>
        </button>)}
        <button type="button" className="library-filter-chip library-add-chip" onClick={onAdd}><Plus size={13} /> Add a game</button>
      </div>

      {view === 'grid' ? (
        <>
          <div className="library-grid-caption"><span className={`library-filter-dot filter-${filter}`} /><b>{labelFor(filter)}</b><small>{games.length}</small></div>
          <section className={`library-grid-layout${gridDrawerOpen ? ' has-drawer' : ''}`} aria-label="Game collection">
            <div className="library-grid-page">
              {!games.length ? <p className="library-no-results">Nothing in this category matches the current search.</p> : groups.map((group) => (
                <section className="library-grid-group" key={group.status} style={{ '--orbit-cover-scale': String(scale / 100) } as CSSProperties}>
                  <header><span className={`library-filter-dot filter-${group.status}`} /><b>{group.label}</b><small>{group.games.length}</small></header>
                  <GameGrid games={group.games} selectedId={selected.id} onSelect={selectGame} onEdit={onEdit} onToggleFavorite={onToggleFavorite} onPlay={onPlay} scale={scale} onReorder={sort === 'manual' ? onReorder : undefined} coverTint={settings.coverTint !== false} />
                </section>
              ))}
            </div>
            {gridDrawerOpen && <aside className="library-grid-drawer" aria-label={`${selected.title} quick details`}>
              <div className="library-grid-drawer-hero" style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined} />
              <button type="button" className="library-drawer-close" onClick={() => setGridDrawerOpen(false)} aria-label="Close selected game panel"><X size={15} /></button>
              <div className="library-grid-drawer-heading"><div className="library-grid-drawer-cover"><Cover game={selected} className="size-full" fit="contain" /></div><div><h2>{selected.title}</h2><p>{selected.meta?.releaseYear || ''}{selected.meta?.releaseYear ? ' · ' : ''}{sourceLabel(selected)}</p></div></div>
              <div className="library-grid-drawer-body">
                <button type="button" className="library-primary-button library-play-button" onClick={playing ? onStop : () => onPlay(selected)}>{playing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{playing ? 'Stop session' : selected.planned ? 'Start timer' : 'Play'}</button>
                <div className="library-grid-drawer-actions"><Select value={selected.status} onChange={(status) => onUpdate(selected.id, { status })} ariaLabel="Game status" options={STATUS_OPTIONS} className="library-status-select" /><button type="button" onClick={() => onToggleFavorite(selected.id)} className={cn('library-icon-action', selected.favorite && 'is-favorite')} aria-label={selected.favorite ? 'Remove favorite' : 'Add favorite'}><Star size={15} fill={selected.favorite ? 'currentColor' : 'none'} /></button><button type="button" onClick={() => onDetails(selected.id)} className="library-icon-action" aria-label="Game settings"><SettingsIcon size={14} /></button></div>
                <div className="library-drawer-numbers"><span><b>{fmtMinutes(selected.playSecs / 60)}</b> played</span><span><b>{selected.sessionCount}</b> sessions</span></div>
                <p className="library-drawer-summary">{selected.meta?.summary || 'No overview has been added yet.'}</p>
                <div className="library-grid-drawer-facts"><div><span>Developer</span><b>{selected.meta?.developer || 'Unknown'}</b></div><div><span>Release</span><b>{selected.meta?.releaseYear || 'Unknown'}</b></div><div><span>Last played</span><b>{selected.lastPlayed ? fmtDate(selected.lastPlayed) : 'Never'}</b></div><div><span>Install size</span><b>{selected.sizeGb > 0 ? `${selected.sizeGb.toFixed(1)} GB` : 'Not measured'}</b></div></div>
                <button type="button" className="library-full-details" onClick={() => setView('list')}><Info size={13} />Open game page</button>
              </div>
            </aside>}
          </section>
        </>
      ) : (
        <div className="library-focus-scroll">
          <header className="library-design-heading">
            <div><p>YOUR COLLECTION</p><h1>Game Library</h1></div>
            <div className="library-design-stats" aria-label="Collection statistics">
              <div><b>{collection.filter((game) => !game.hidden).length}</b><span>Games</span></div>
              <div><b>{fmtMinutes(collection.reduce((total, game) => total + game.playSecs, 0) / 60)}</b><span>Playtime</span></div>
              <div><b>{collection.filter((game) => game.favorite && !game.hidden).length}</b><span>Favorites</span></div>
            </div>
          </header>
          <div className="library-focus-layout">
            <section className="library-game-browser" aria-label="Games in this collection">
              {groups.map((group) => <div className="library-game-browser-group" key={group.status}>
                <header><span className={`library-filter-dot filter-${group.status}`} /><b>{group.label}</b><small>{group.games.length}</small></header>
                <div className="library-game-browser-grid">{group.games.map((game) => <button type="button" key={game.id} aria-pressed={selected.id === game.id} onClick={() => onSelect(game.id)} onDoubleClick={() => onPlay(game)} title={game.title} className={cn('library-mini-game', selected.id === game.id && 'is-selected')}>
                  <span className="library-mini-cover"><Cover game={game} className="size-full" fit="cover" /></span>
                  <span className="library-mini-copy"><b>{game.title}</b><small>{game.meta?.releaseYear || sourceLabel(game)}</small><em>{game.status === 'backlog' ? 'Planned' : game.status}</em></span>
                  <span className="library-mini-time"><Clock3 size={10} />{fmtMinutes(game.playSecs / 60)}</span>
                </button>)}</div>
              </div>)}
            </section>

            <aside className="library-focus-game" aria-label="Game actions and details">
              <header className="library-focus-header">
                <h1>{selected.title}</h1>
                <p>{selected.meta?.releaseYear || 'Release year unknown'}<span>·</span>{sourceLabel(selected)}<span>·</span>{(selected.meta?.genres ?? []).slice(0, 2).join(' / ') || 'Uncategorized'}</p>
              </header>
              <div className="library-focus-cover"><Cover game={selected} className="size-full" fit="contain" loading="eager" /></div>
              <button type="button" onClick={playing ? onStop : () => onPlay(selected)} className="library-primary-button library-play-button">
                {playing ? <Square size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{playing ? 'Stop session' : selected.planned ? 'Start timer' : 'Play'}
              </button>
              <div className="library-focus-actions">
                <Select value={selected.status} onChange={(status) => onUpdate(selected.id, { status })} ariaLabel="Game status" options={STATUS_OPTIONS} className="library-status-select" />
                <button type="button" onClick={() => onToggleFavorite(selected.id)} className={cn('library-icon-action', selected.favorite && 'is-favorite')} title={selected.favorite ? 'Remove favorite' : 'Add favorite'} aria-label={selected.favorite ? 'Remove favorite' : 'Add favorite'}><Star size={16} fill={selected.favorite ? 'currentColor' : 'none'} /></button>
                <button type="button" onClick={() => onEdit(selected.id)} className="library-icon-action" title="Edit game" aria-label="Edit game"><Pencil size={15} /></button>
                <button type="button" onClick={() => onDetails(selected.id)} className="library-icon-action" title="Game settings" aria-label="Game settings"><SettingsIcon size={15} /></button>
              </div>
              {selected.meta?.rating !== null && selected.meta?.rating !== undefined && <div className="library-rating-row"><span>Critic score</span><b>{selected.meta.rating}</b></div>}
              <div className="library-facts-card">
                <div><span>Library</span><b>{sourceLabel(selected)}</b></div>
                <div><span>Last played</span><b>{selected.lastPlayed ? fmtDate(selected.lastPlayed) : 'Never'}</b></div>
                <div><span>Playtime</span><b>{fmtMinutes(selected.playSecs / 60)}</b></div>
                <div><span>Sessions</span><b>{selected.sessionCount}</b></div>
                {selected.sizeGb > 0 && <div><span>Install size</span><b>{selected.sizeGb.toFixed(1)} GB</b></div>}
              </div>
            </aside>

            <main className="library-focus-content">
              <section className="library-journal-section" aria-label="Screenshots">
                <div className="library-focus-section-head"><h2>Screenshots</h2><button type="button" onClick={() => setActivityTab('journal')}>{galleryCount} screenshots</button></div>
                {galleryCount ? <div className="library-media-items">
                  {gameCaptures.slice(0, 4).map((capture) => <a className="library-media-shot" href={fileSrc(capture.path)} target="_blank" rel="noreferrer" key={capture.path}><img src={fileSrc(capture.path)} alt={`${selected.title} screenshot`} loading="lazy" /></a>)}
                </div> : <div className="library-media-empty"><Images size={17} /><span>Orbit screenshots for this game will appear here.</span></div>}
              </section>

              <section className="library-overview-card">
                <div className="library-focus-section-head"><h2>Overview</h2><button type="button" onClick={() => onDetails(selected.id)} aria-label="Edit game overview"><Pencil size={14} /></button></div>
                <p>{selected.meta?.summary || 'No overview has been added yet.'}</p>
                <div className="library-overview-note">
                  {selected.hltb && <span><b>{selected.hltb.main}h</b> to credits</span>}
                  {selected.hltb && <i>·</i>}
                  <span>{selected.sessionCount} sessions recorded</span>
                </div>
              </section>

              <section className="library-timeline-section">
                <div className="library-timeline-head">
                  <div><h2>{activityTab === 'timeline' ? 'Timeline' : 'Journal'}</h2><small>{selected.sessionCount} sessions{sessionGroups.length ? ` since ${shortDay(sessionGroups[sessionGroups.length - 1].startedAt)}` : ''}</small></div>
                  <div className="library-activity-switch" role="tablist" aria-label="Game activity">
                    <button type="button" role="tab" aria-selected={activityTab === 'timeline'} onClick={() => setActivityTab('timeline')}>Timeline</button>
                    <button type="button" role="tab" aria-selected={activityTab === 'journal'} onClick={() => setActivityTab('journal')}>Journal</button>
                  </div>
                </div>
                {activityTab === 'timeline' ? sessionGroups.length ? <div className="library-timeline-list">{sessionGroups.map((group) => {
                  const notes = gameLogs.filter((log) => dayKey(log.at) === dayKey(group.startedAt)).length;
                  const shots = gameCaptures.filter((capture) => captureDayKey(capture) === dayKey(group.startedAt));
                  return <article className="library-timeline-day" key={dayKey(group.startedAt)}>
                    <div className="library-timeline-date"><b>{shortDay(group.startedAt)}</b><small>{group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}</small></div>
                    <span className="library-timeline-node" />
                    <div className="library-timeline-event"><b>Played {fmtMinutes(group.duration / 60)}</b><span>{notes > 0 ? ` · ${notes} journal ${notes === 1 ? 'entry' : 'entries'}` : ''}{shots.length ? ` · ${shots.length} screenshots` : ''}</span>
                      {group.sessions.map((session) => session.note && <p key={session.id}>{session.note}</p>)}
                      {shots.length > 0 && <div className="library-timeline-shots">{shots.slice(0, 3).map((shot) => <a key={shot.path} href={fileSrc(shot.path)} target="_blank" rel="noreferrer"><img src={fileSrc(shot.path)} alt={`${selected.title} from ${shortDay(group.startedAt)}`} loading="lazy" /></a>)}</div>}
                    </div>
                  </article>;
                })}</div> : <div className="library-activity-empty"><Clock3 size={16} /><span>No recorded sessions yet. Play starts tracking automatically.</span></div> : gameLogs.length ? <div className="library-journal-list">{gameLogs.map((log) => <article key={log.id}><span className="library-journal-date">{shortDay(log.at)}</span><div><b>{log.note || 'Journal entry'}</b>{log.details && <p>{log.details}</p>}</div><small>{log.secs > 0 ? fmtMinutes(log.secs / 60) : ''}</small></article>)}</div> : <div className="library-activity-empty"><BookOpen size={16} /><span>No journal entries yet.</span></div>}
                <button type="button" className="library-view-history" onClick={() => onDetails(selected.id)}>View full history <span>→</span></button>
              </section>
            </main>

            <aside className="library-focus-details" aria-label="Game details">
              <section><h2>Details</h2><dl>
                <div><dt>Developer</dt><dd>{selected.meta?.developer || 'Unknown'}</dd></div>
                <div><dt>Release</dt><dd>{selected.meta?.releaseYear || 'Unknown'}</dd></div>
                <div><dt>Genre</dt><dd>{selected.meta?.genres?.join(', ') || 'Uncategorized'}</dd></div>
                <div><dt>Platform</dt><dd>{sourceLabel(selected)}</dd></div>
                <div><dt>Status</dt><dd>{selected.status === 'backlog' ? 'Planned' : selected.status}</dd></div>
                <div><dt>Install location</dt><dd title={selected.installDir || ''}>{selected.installDir ? driveLabel(selected.drive || selected.installDir) : 'Not installed'}</dd></div>
                <div><dt>Playtime</dt><dd>{fmtMinutes(selected.playSecs / 60)}</dd></div>
                <div><dt>Sessions</dt><dd>{selected.sessionCount}</dd></div>
                {selected.sizeGb > 0 && <div><dt>File size</dt><dd>{selected.sizeGb.toFixed(1)} GB</dd></div>}
              </dl></section>
              {!!selected.achievements?.length && <section className="library-achievements"><div className="library-achievements-heading"><h2>Achievements</h2><span>{selected.achievements.filter((item) => item.unlocked).length}/{selected.achievements.length}</span></div><div className="library-achievement-progress"><span style={{ width: `${Math.round(selected.achievements.filter((item) => item.unlocked).length / selected.achievements.length * 100)}%` }} /></div>{selected.achievements.filter((item) => item.unlocked).slice(0, 4).map((achievement) => <div className="library-achievement-row" key={achievement.id}>{achievement.icon ? <img src={achievement.icon} alt="" /> : <span className="library-achievement-placeholder"><Check size={12} /></span>}<span><b>{achievement.name}</b><small>{achievement.description}</small></span></div>)}<button type="button" onClick={() => onDetails(selected.id)}>View all achievements</button></section>}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
