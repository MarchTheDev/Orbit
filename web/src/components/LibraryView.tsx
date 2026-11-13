import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  HardDrive,
  Images,
  Info,
  LayoutGrid,
  List,
  NotebookPen,
  Pencil,
  Play,
  Search,
  Square,
  Star,
  Timer,
} from 'lucide-react';
import type {
  ActiveSession,
  CoverShape,
  Game,
  GameFacts,
  GameSection,
  GridLabel,
  ShelfSize,
  SortKey,
} from '../types';
import type { Filter, FilterDefinition } from '../data/libraryFilters';
import { orderedLibraryFilters, LIBRARY_FILTERS } from '../data/libraryFilters';
import { fetchHltb } from '../services/hltb';
import { gameFacts } from '../services/native';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { wideArt } from '../utils/art';
import { driveLabel } from '../utils/drive';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { Select } from './ui/Select';
import { SearchField } from './ui/SearchField';
import { CheckboxInline } from './ui/Checkbox';
import { GameGrid } from './GameGrid';
import { HltbCard } from './detail/HltbCard';
import { AchievementsTab } from './detail/AchievementsTab';
import { GameLogView } from './detail/GameLogView';

export type LibraryMode = 'details' | 'grid';
/** How the left shelf is drawn in Details: artwork, or a compact list. */
export type ShelfLayout = 'covers' | 'list';

const COVER_SHAPES: { value: CoverShape; label: string }[] = [
  { value: '2:3', label: '2:3' },
  { value: '3:4', label: '3:4' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
];

const SHELF_SIZES: { value: ShelfSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const GRID_LABELS: { value: GridLabel; label: string; title: string }[] = [
  { value: 'nothing', label: 'Nothing', title: 'Nothing under the cover' },
  { value: 'title', label: 'Title', title: 'The title alone' },
  { value: 'info', label: 'Info', title: 'Playtime and drive alone' },
  { value: 'title-info', label: 'Both', title: 'Title, then playtime and drive' },
];

const SECTIONS: { value: GameSection; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'journal', label: 'Journal' },
  { value: 'achievements', label: 'Achievements' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title', label: 'A-Z' },
  { value: 'lastPlayed', label: 'Last played' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'added', label: 'Recently added' },
  { value: 'size', label: 'Size' },
  { value: 'manual', label: 'My order' },
];

/** Screenshots read once per store app id, kept for the rest of the session. */
const shotCache = new Map<number, GameFacts['screenshots']>();

/**
 * The library, one shelf deep.
 *
 * Every game Orbit has is in one list, narrowed by the filters and never split
 * into lanes by how far it has been played. Details puts the shelf on the left
 * and the selected game's whole page beside it; Grid is the cover wall, and a
 * click there opens the same game in the classic details drawer. Each view owns
 * its settings behind its own button, the way a console library does.
 */
export function LibraryView({
  games,
  total,
  filter,
  setFilter,
  filterOrder,
  hiddenFilters,
  query,
  setQuery,
  sort,
  setSort,
  scale,
  setScale,
  coverTint,
  setCoverTint,
  mode,
  setMode,
  rail,
  setRail,
  shelfSize,
  setShelfSize,
  shape,
  setShape,
  gridLabel,
  setGridLabel,
  sections,
  setSections,
  runningId,
  session,
  onPlay,
  onStop,
  onEdit,
  onOpenDetails,
  onToggleFavorite,
  onUpdate,
  onDiscoverSteam,
  onAdd,
  onReorder,
}: {
  /** The games after filtering and sorting. */
  games: Game[];
  /** How many games the library holds, for the header and the All chip. */
  total: number;
  filter: Filter;
  setFilter: (next: Filter) => void;
  filterOrder?: Filter[];
  hiddenFilters?: Filter[];
  query: string;
  setQuery: (next: string) => void;
  sort: SortKey;
  setSort: (next: SortKey) => void;
  scale: number;
  setScale: (next: number) => void;
  coverTint: boolean;
  setCoverTint: (next: boolean) => void;
  mode: LibraryMode;
  setMode: (next: LibraryMode) => void;
  rail: ShelfLayout;
  setRail: (next: ShelfLayout) => void;
  shelfSize: ShelfSize;
  setShelfSize: (next: ShelfSize) => void;
  /** The shape every cover in both views is drawn in. */
  shape: CoverShape;
  setShape: (next: CoverShape) => void;
  gridLabel: GridLabel;
  setGridLabel: (next: GridLabel) => void;
  /** The game page sections shown in Details. */
  sections: GameSection[];
  setSections: (next: GameSection[]) => void;
  runningId: string | null;
  session: ActiveSession | null;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onEdit: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onDiscoverSteam: () => void;
  onAdd: () => void;
  onReorder?: (fromId: string, toId: string, after: boolean) => void;
}) {
  const [focusId, setFocusId] = useState<string | null>(games[0]?.id ?? null);
  const [viewMenu, setViewMenu] = useState<LibraryMode | null>(null);
  const viewSwitch = useRef<HTMLDivElement>(null);

  // A filter that removes the open game moves the page to the first one left,
  // rather than leaving a blank page beside a shelf of other games.
  useEffect(() => {
    if (games.length === 0) {
      setFocusId(null);
      return;
    }
    if (!focusId || !games.some((game) => game.id === focusId)) setFocusId(games[0].id);
  }, [games, focusId]);

  useEffect(() => {
    if (!viewMenu) return;
    const onDown = (event: PointerEvent) => {
      if (viewSwitch.current?.contains(event.target as Node)) return;
      setViewMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewMenu(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [viewMenu]);

  const hidden = new Set(hiddenFilters ?? []);
  const filters: FilterDefinition[] = (orderedLibraryFilters(filterOrder).filter((item) => !hidden.has(item.id)));
  const chips = filters.length > 0 ? filters : [LIBRARY_FILTERS[0]];
  const focus = games.find((game) => game.id === focusId) ?? null;
  const playedSecs = games.reduce((sum, game) => sum + game.playSecs, 0);

  // The switch changes the view; the view you are already in opens its
  // settings. Doing both on one click made changing views feel like it had
  // left a menu behind.
  const chooseMode = (next: LibraryMode) => {
    if (next !== mode) {
      setMode(next);
      setViewMenu(null);
      return;
    }
    setViewMenu((current) => (current === next ? null : next));
  };

  const toggleSection = (section: GameSection) => {
    setSections(sections.includes(section) ? sections.filter((item) => item !== section) : [...sections, section]);
  };

  return (
    <>
      <header className="orbit-pagehead">
        <h1>Library</h1>
        <div className="orbit-pagehead-meta">
          <span><b>{total}</b> {total === 1 ? 'game' : 'games'}</span>
          <span><b>{Math.round(playedSecs / 3600)}h</b> played</span>
        </div>
      </header>

      <div className="orbit-libtools">
        <div className="orbit-libtools-chips" role="group" aria-label="Library filters">
          {chips.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className="chip shrink-0"
            >
              {item.label}
              {item.id === 'all' && <span className="orbit-num ml-1.5 rounded-md bg-black/15 px-1.5 py-px text-[9.5px]">{total}</span>}
            </button>
          ))}
        </div>

        <div className="orbit-libtools-right">
          <SearchField value={query} onChange={setQuery} placeholder="Find a game" />
          <Select
            value={sort}
            onChange={setSort}
            className="!rounded-[10px] !px-3 !py-2 text-xs"
            ariaLabel="How the library is ordered"
            options={SORT_OPTIONS}
          />
          <div className="orbit-viewswitch" ref={viewSwitch}>
            <button
              className="orbit-viewbtn"
              aria-pressed={mode === 'details'}
              aria-expanded={viewMenu === 'details'}
              title={mode === 'details' ? 'Details view options' : 'Switch to Details'}
              onClick={() => chooseMode('details')}
            >
              <List className="size-3.5" strokeWidth={2} />
              Details
              {mode === 'details' && <ChevronDown className="caret" strokeWidth={2} />}
            </button>
            <button
              className="orbit-viewbtn"
              aria-pressed={mode === 'grid'}
              aria-expanded={viewMenu === 'grid'}
              title={mode === 'grid' ? 'Grid view options' : 'Switch to Grid'}
              onClick={() => chooseMode('grid')}
            >
              <LayoutGrid className="size-3.5" strokeWidth={2} />
              Grid
              {mode === 'grid' && <ChevronDown className="caret" strokeWidth={2} />}
            </button>

            {viewMenu === 'details' && (
              <div className="orbit-viewmenu" role="dialog" aria-label="Details settings">
                <span className="orbit-viewmenu-label">Shelf</span>
                <button
                  className="orbit-menu-item"
                  aria-current={rail === 'covers' ? 'true' : undefined}
                  onClick={() => {
                    setRail('covers');
                    setViewMenu(null);
                  }}
                >
                  <LayoutGrid className="size-3.5" />
                  Covers
                  {rail === 'covers' && <Check className="ml-auto size-3.5" />}
                </button>
                <button
                  className="orbit-menu-item"
                  aria-current={rail === 'list' ? 'true' : undefined}
                  onClick={() => {
                    setRail('list');
                    setViewMenu(null);
                  }}
                >
                  <List className="size-3.5" />
                  List
                  {rail === 'list' && <Check className="ml-auto size-3.5" />}
                </button>

                {rail === 'covers' && (
                  <div className="orbit-viewmenu-block">
                    <span className="orbit-viewmenu-sublabel">Cover size</span>
                    <div className="orbit-seg" role="group" aria-label="Shelf cover size">
                      {SHELF_SIZES.map((size) => (
                        <button
                          key={size.value}
                          type="button"
                          aria-pressed={shelfSize === size.value}
                          onClick={() => setShelfSize(size.value)}
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Game sections</span>
                  <div className="orbit-minichips" role="group" aria-label="Game page sections">
                    {SECTIONS.map((section) => (
                      <button
                        key={section.value}
                        type="button"
                        aria-pressed={sections.includes(section.value)}
                        onClick={() => toggleSection(section.value)}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                </div>

                <span className="orbit-viewmenu-label">Covers</span>
                <ShapeRow value={shape} onChange={setShape} />
                <p className="orbit-viewmenu-note">
                  The shelf follows the filters above; the game page never leaves it. A game's own cover is picked in Edit.
                </p>
              </div>
            )}

            {viewMenu === 'grid' && (
              <div className="orbit-viewmenu" role="dialog" aria-label="Grid settings">
                <div className="orbit-viewmenu-row">
                  <span>Cover size</span>
                  <span className="orbit-viewmenu-value">{Math.round(170 * (scale / 100))} px</span>
                </div>
                <input
                  type="range"
                  min={70}
                  max={170}
                  step={5}
                  value={scale}
                  onChange={(event) => setScale(Number(event.target.value))}
                  className="orbit-range w-full cursor-pointer"
                  aria-label="Cover size"
                />

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Under the cover</span>
                  <div className="orbit-seg" role="group" aria-label="Under the cover">
                    {GRID_LABELS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        title={option.title}
                        aria-pressed={gridLabel === option.value}
                        onClick={() => setGridLabel(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <span className="orbit-viewmenu-label">Covers</span>
                <ShapeRow value={shape} onChange={setShape} />

                <div className="orbit-viewmenu-row">
                  <CheckboxInline checked={coverTint} onChange={setCoverTint} label="Tint on hover" />
                </div>
                {sort === 'manual' && (
                  <p className="orbit-viewmenu-note">Drag one cover onto another to put it in your order.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === 'grid' ? (
        <div className="orbit-gridwrap">
          {games.length === 0 ? (
            <Blank
              title={total === 0 ? 'Nothing in this orbit yet' : 'No games match'}
              body={total === 0 ? 'Add a game, or drop a program on the window.' : 'Try another title or clear the current filter.'}
              action={total === 0 ? { label: 'Add game', onClick: onAdd } : { label: 'Clear search', onClick: () => { setQuery(''); setFilter('all'); }}}
            />
          ) : (
            <GameGrid
              games={games}
              selectedId={null}
              onSelect={onOpenDetails}
              onEdit={onEdit}
              onToggleFavorite={onToggleFavorite}
              onPlay={onPlay}
              scale={scale}
              onReorder={sort === 'manual' ? onReorder : undefined}
              coverTint={coverTint}
              shape={shape}
              label={gridLabel}
            />
          )}
        </div>
      ) : games.length === 0 ? (
        <Blank
          title={total === 0 ? 'Nothing in this orbit yet' : 'No games match'}
          body={total === 0 ? 'Add a game, or drop a program on the window.' : 'Try another title or clear the current filter.'}
          action={total === 0 ? { label: 'Add game', onClick: onAdd } : { label: 'Clear search', onClick: () => { setQuery(''); setFilter('all'); }}}
        />
      ) : (
        <div className={cn('orbit-lib', `is-shelf-${shelfSize}`)}>
          <aside className="orbit-shelf" aria-label="Games">
            <div className="orbit-shelf-head">
              <h2>Shelf</h2>
              <span>{games.length} of {total}</span>
            </div>
            <div className="orbit-shelf-scroll">
              {rail === 'covers' ? (
                <div className="orbit-shelf-grid">
                  {games.map((game) => (
                    <button
                      key={game.id}
                      className="orbit-shelf-tile"
                      data-orbit-game={game.id}
                      aria-current={game.id === focusId ? 'true' : undefined}
                      onClick={() => setFocusId(game.id)}
                      title={game.title}
                    >
                      <span className="relative block" style={{ aspectRatio: shape.replace(':', ' / ') }}>
                        <Cover game={game} className="orbit-cover size-full" loading="lazy" />
                        {game.id === runningId && (
                          <span className="orbit-pulse absolute right-1.5 top-1.5 z-10 size-1.5 rounded-full bg-emerald-400" />
                        )}
                      </span>
                      <p>{game.title}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="orbit-shelf-rows">
                  {games.map((game) => (
                    <button
                      key={game.id}
                      className="orbit-shelf-row"
                      data-orbit-game={game.id}
                      aria-current={game.id === focusId ? 'true' : undefined}
                      onClick={() => setFocusId(game.id)}
                      title={game.title}
                    >
                      <span className="relative block shrink-0">
                        <Cover game={game} className="orbit-cover" style={{ width: 34, height: 45 }} loading="lazy" />
                        {game.id === runningId && (
                          <span className="orbit-pulse absolute -right-0.5 -top-0.5 z-10 size-1.5 rounded-full bg-emerald-400" />
                        )}
                      </span>
                      <div>
                        <b>{game.title}</b>
                        <span>{fmtMinutes(game.playSecs / 60)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {focus ? (
            <GamePage
              key={focus.id}
              game={focus}
              shape={shape}
              sections={sections}
              running={focus.id === runningId}
              hasSession={session?.gameId === focus.id}
              onPlay={() => onPlay(focus)}
              onStop={onStop}
              onEdit={() => onEdit(focus.id)}
              onOpenDetails={() => onOpenDetails(focus.id)}
              onToggleFavorite={() => onToggleFavorite(focus.id)}
              onUpdate={(patch) => onUpdate(focus.id, patch)}
              onDiscoverSteam={onDiscoverSteam}
            />
          ) : (
            <div className="orbit-blank">
              <h2>Pick a game</h2>
              <p>The shelf on the left has everything Orbit can start.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Four sketches, in the shapes covers come in. */
function ShapeRow({ value, onChange }: { value: CoverShape; onChange: (next: CoverShape) => void }) {
  return (
    <div className="orbit-shapes" role="group" aria-label="Cover shape">
      {COVER_SHAPES.map((shape) => (
        <button
          key={shape.value}
          type="button"
          className="orbit-shape"
          aria-pressed={value === shape.value}
          title={`Covers in ${shape.label}`}
          onClick={() => onChange(shape.value)}
        >
          <span style={{ aspectRatio: shape.value.replace(':', ' / '), height: 22 }} />
          {shape.label}
        </button>
      ))}
    </div>
  );
}

function Blank({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { label: string; onClick: () => void };
}) {
  return (
    <div className="orbit-blank">
      <h2>{title}</h2>
      <p>{body}</p>
      <button onClick={action.onClick}>{action.label}</button>
    </div>
  );
}

/**
 * One game's page: the artwork lights the top, the readings sit on hairlines,
 * and the page itself is a reading column beside a facts column. Nothing here
 * is a card; the sections are separated by space and hairlines.
 */
function GamePage({
  game,
  shape,
  sections,
  running,
  hasSession,
  onPlay,
  onStop,
  onEdit,
  onOpenDetails,
  onToggleFavorite,
  onUpdate,
  onDiscoverSteam,
}: {
  game: Game;
  shape: CoverShape;
  sections: GameSection[];
  running: boolean;
  hasSession: boolean;
  onPlay: () => void;
  onStop: () => void;
  onEdit: () => void;
  onOpenDetails: () => void;
  onToggleFavorite: () => void;
  onUpdate: (patch: Partial<Game>) => void;
  onDiscoverSteam: () => void;
}) {
  const art = wideArt(game);
  const main = game.hltb?.main ?? 0;
  const hours = game.playSecs / 3600;
  const progress = main > 0 ? Math.min(100, Math.round((hours / main) * 100)) : null;
  const rating = game.meta?.rating;

  const [hltbBusy, setHltbBusy] = useState(false);
  const [hltbError, setHltbError] = useState<string | null>(null);
  const loadHltb = () => {
    setHltbBusy(true);
    setHltbError(null);
    void fetchHltb(game.title)
      .then((times) => onUpdate({ hltb: times }))
      .catch((error) => setHltbError(error instanceof Error ? error.message : String(error)))
      .finally(() => setHltbBusy(false));
  };

  const [shots, setShots] = useState<GameFacts['screenshots'] | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const appId = game.meta?.steamAppId ?? null;

  useEffect(() => {
    if (!appId) {
      setShots(null);
      return;
    }
    const known = shotCache.get(appId);
    if (known) {
      setShots(known);
      return;
    }
    let alive = true;
    setShotError(null);
    void gameFacts(appId)
      .then((facts) => {
        shotCache.set(appId, facts.screenshots ?? []);
        if (alive) setShots(facts.screenshots ?? []);
      })
      .catch((error) => {
        if (alive) setShotError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [appId]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    <div className="orbit-gamepage">
      <div className="orbit-gamepage-hero">
        <div
          className="orbit-gamepage-art"
          aria-hidden
          style={
            art
              ? { backgroundImage: `url("${art}")` }
              : {
                  backgroundImage: `radial-gradient(120% 90% at 76% 16%, hsl(${game.hue} 48% 34% / .6), transparent 62%), radial-gradient(90% 70% at 10% 90%, hsl(${game.hue} 44% 26% / .4), transparent 62%)`,
                  backgroundSize: 'auto, auto',
                }
          }
        />
        <Cover
          game={game}
          className="orbit-gamepage-cover"
          style={{ aspectRatio: shape.replace(':', ' / ') }}
          loading="eager"
        />
        <div className="min-w-0">
          <h1 className="orbit-gamepage-title">{game.title}</h1>
          <div className="orbit-gamepage-meta">
            {game.meta?.releaseYear ? <span>{game.meta.releaseYear}</span> : null}
            {game.meta?.developer ? <span>{game.meta.developer}</span> : null}
            {game.meta?.genres?.length ? <span>{game.meta.genres.slice(0, 3).join(' · ')}</span> : null}
            {game.sizeBytes > 0 ? <span>{fmtBytes(game.sizeBytes)}</span> : null}
            {game.drive ? <span>{driveLabel(game.drive)}</span> : null}
          </div>
          <div className="orbit-gamepage-actions">
            <button
              className={cn('orbit-play', running && 'is-stop')}
              onClick={running ? onStop : onPlay}
            >
              {running ? <Square className="size-3.5" fill="currentColor" strokeWidth={0} /> : <Play className="size-3.5" fill="currentColor" strokeWidth={0} />}
              {running ? 'Stop' : 'Play'}
            </button>
            <button
              className={cn('orbit-iconbtn', game.favorite && 'is-favorite')}
              onClick={onToggleFavorite}
              aria-pressed={game.favorite}
              aria-label={game.favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}
              title={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
            </button>
            <button className="orbit-iconbtn" onClick={onEdit} aria-label={`Edit ${game.title}`} title="Edit game">
              <Pencil className="size-4" />
            </button>
            <button className="orbit-iconbtn" onClick={onOpenDetails} aria-label={`More about ${game.title}`} title="More details">
              <Info className="size-4" />
            </button>
            {hasSession && !running && (
              <span className="text-[11px] text-muted">A session is already open for this game.</span>
            )}
          </div>
        </div>
      </div>

      <div className="orbit-metrics">
        <div className="orbit-metric">
          <p>Playtime</p>
          <b>{fmtMinutes(game.playSecs / 60)}</b>
          <span>{game.sessionCount === 0 ? 'No sessions yet' : `${game.sessionCount} ${game.sessionCount === 1 ? 'session' : 'sessions'}`}</span>
        </div>
        <div className="orbit-metric">
          <p>Progress</p>
          <b>{progress === null ? 'Not measured' : `${progress}%`}</b>
          <span>{main > 0 ? `of ${main}h main story` : 'No HowLongToBeat time'}</span>
          {progress !== null && (
            <div className="orbit-rail">
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <div className="orbit-metric">
          <p>Last played</p>
          <b>{game.lastPlayed ? fmtDate(game.lastPlayed) : 'Never'}</b>
          <span>{game.lastPlayed ? 'Most recent session' : 'Start it to begin the clock'}</span>
        </div>
        <div className="orbit-metric">
          <p>On disk</p>
          <b>{game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : 'Not found'}</b>
          <span>{game.installDir ? game.installDir : game.drive ? driveLabel(game.drive) : 'No folder yet'}</span>
        </div>
      </div>

      <div className="orbit-gamepage-body">
        <div className="orbit-gamepage-main">
          {sections.includes('overview') && (
            <section className="orbit-section">
              <h2>Overview</h2>
              <div className="orbit-section-body">
                {game.meta?.summary ? (
                  <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-fg/75">{game.meta.summary}</p>
                ) : (
                  <p className="text-xs text-muted">
                    No description yet. Orbit fetches one when the game is added; Edit can fill it in by hand.
                  </p>
                )}
              </div>
            </section>
          )}

          {sections.includes('gallery') && (
          <section className="orbit-section">
            <h2>
              <Images className="size-3.5" />
              Gallery
              {shots && shots.length > 0 && <span className="count">{shots.length}</span>}
            </h2>
            <div className="orbit-section-body">
              {!appId ? (
                <div className="orbit-gallery-empty">
                  Screenshots come from the game's store page. Add a Steam app id in Edit to bring them in.
                </div>
              ) : shots === null ? (
                <div className="orbit-gallery-empty">{shotError ? 'The store could not be reached for screenshots.' : 'Looking up screenshots…'}</div>
              ) : shots.length === 0 ? (
                <div className="orbit-gallery-empty">The store has no screenshots for this game.</div>
              ) : (
                <div className="orbit-gallery">
                  {shots.slice(0, 9).map((shot) => (
                    <button key={shot.full} onClick={() => setLightbox(shot.full)} title="Open the screenshot">
                      <img src={shot.thumb} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
          )}

          {sections.includes('journal') && (
            <section className="orbit-section">
              <h2>Journal</h2>
              <div className="orbit-section-body">
                <GameLogView game={game} onNotes={(notes) => onUpdate({ notes })} />
              </div>
            </section>
          )}

          {/* The achievements panel carries its own heading and progress.
              It reads the list from Steam the first time it is shown. */}
          {sections.includes('achievements') && <AchievementsTab game={game} onUpdate={onUpdate} />}
        </div>

        <aside className="orbit-gamepage-side">
          <section className="orbit-section">
            <h2>Details</h2>
            <dl className="orbit-facts">
              <Fact label="Developer" value={game.meta?.developer || '—'} />
              <Fact label="Released" value={game.meta?.releaseYear ? String(game.meta.releaseYear) : '—'} />
              <Fact label="Genres" value={game.meta?.genres?.length ? game.meta.genres.join(', ') : '—'} />
              <Fact label="Store rating" value={rating !== null && rating !== undefined ? `${rating}/100` : '—'} />
              <Fact label="Sessions" value={String(game.sessionCount)} />
              <Fact label="Added" value={fmtDate(game.addedAt)} />
              <Fact label="Size" value={game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : '—'} />
              <Fact label="Drive" value={game.drive ? driveLabel(game.drive) : '—'} />
              <Fact label="Folder" value={game.installDir || '—'} />
            </dl>
          </section>

          <section className="orbit-section">
            <HltbCard game={game} onFetch={loadHltb} loading={hltbBusy} error={hltbError} />
          </section>

          <section className="orbit-section">
            <h2>
              <CalendarDays className="size-3.5" />
              Playtime
            </h2>
            <div className="orbit-section-body flex flex-col gap-2 text-[12.5px] text-muted">
              <p className="flex items-center gap-2">
                <Timer className="size-3.5" />
                {fmtMinutes(game.playSecs / 60)} in {game.sessionCount} {game.sessionCount === 1 ? 'session' : 'sessions'}
              </p>
              <p className="flex items-center gap-2">
                <HardDrive className="size-3.5" />
                Longest session {game.longestSecs > 0 ? fmtMinutes(game.longestSecs / 60) : '—'}
              </p>
              <p className="flex items-center gap-2">
                <Search className="size-3.5" />
                {game.meta?.steamAppId ? `Steam app ${game.meta.steamAppId}` : 'No store id'}
              </p>
            </div>
          </section>

          {!game.meta?.steamAppId && (
            <button className="orbit-quiet-link" onClick={onDiscoverSteam} type="button">
              <NotebookPen className="size-3.5" />
              Find this game on Steam
            </button>
          )}
        </aside>
      </div>

      {lightbox && (
        <div className="orbit-lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="orbit-fact">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}
