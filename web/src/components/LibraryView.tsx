import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  HardDrive,
  Images,
  Info,
  LayoutGrid,
  List,
  NotebookPen,
  Pencil,
  Play,
  Search,
  SlidersHorizontal,
  Square,
  Star,
  Timer,
  X,
} from 'lucide-react';
import { isSteamGame } from '../utils/steam';
import type {
  ActiveSession,
  CoverCorners,
  CoverShape,
  Game,
  GameSection,
  GridLabel,
  ShelfSize,
  SortKey,
} from '../types';
import type { Filter, FilterDefinition } from '../data/libraryFilters';
import { orderedLibraryFilters, LIBRARY_FILTERS } from '../data/libraryFilters';
import { fetchHltb } from '../services/hltb';
import { overlayGallery, overlayOpen, type GalleryItem } from '../services/native';
import { fileSrc } from '../services/desktop';
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
import { CAPTURE_KINDS, CAPTURE_LABELS, CaptureThumb, captureCounts, capturesOf, type CaptureKind } from './Captures';

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

const COVER_CORNERS: { value: CoverCorners; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'soft', label: 'Soft' },
  { value: 'round', label: 'Round' },
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

const DEFAULT_SHAPE: CoverShape = '3:4';
const DEFAULT_LABEL: GridLabel = 'title-info';
/** Grid covers, the way Heronite sizes them: a pixel width, 110 to 240. */
const DEFAULT_COVER_WIDTH = 150;
const MIN_COVER_WIDTH = 110;
const MAX_COVER_WIDTH = 240;

/** The "Only" switches that narrow the shelf on top of the chips. */
type OnlyFacet = 'played' | 'unplayed' | 'notes' | 'installed';
type StartFacet = 'any' | 'steam' | 'local' | 'tracked';
interface LibraryFacets {
  only: OnlyFacet[];
  start: StartFacet;
}

const NO_FACETS: LibraryFacets = { only: [], start: 'any' };

const FACET_CHOICES: { value: OnlyFacet; label: string }[] = [
  { value: 'played', label: 'Played' },
  { value: 'unplayed', label: 'Never played' },
  { value: 'installed', label: 'Can be started' },
  { value: 'notes', label: 'Has notes' },
];

const START_CHOICES: { value: StartFacet; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'steam', label: 'Through Steam' },
  { value: 'local', label: 'On this PC' },
  { value: 'tracked', label: 'Timed by hand' },
];

/** One game against the facets; every switch has to agree. */
function matchesFacets(game: Game, facets: LibraryFacets): boolean {
  const played = game.playSecs > 0 || game.sessionCount > 0;
  for (const only of facets.only) {
    if (only === 'played' && !played) return false;
    if (only === 'unplayed' && played) return false;
    if (only === 'installed' && game.launch.kind === 'none') return false;
    if (only === 'notes' && game.notes.trim() === '') return false;
  }
  if (facets.start === 'steam' && !isSteamGame(game)) return false;
  if (facets.start === 'local' && game.launch.kind !== 'executable' && game.launch.kind !== 'wine') return false;
  if (facets.start === 'tracked' && game.launch.kind !== 'none') return false;
  return true;
}

function savedFacets(): LibraryFacets {
  try {
    const raw = JSON.parse(localStorage.getItem('orbit.library.facets') ?? 'null') as Partial<LibraryFacets> | null;
    if (!raw) return NO_FACETS;
    const only = (Array.isArray(raw.only) ? raw.only : []).filter((value): value is OnlyFacet =>
      FACET_CHOICES.some((choice) => choice.value === value),
    );
    const start = START_CHOICES.some((choice) => choice.value === raw.start) ? (raw.start as StartFacet) : 'any';
    return { only, start };
  } catch {
    return NO_FACETS;
  }
}

function savedCorners(): CoverCorners {
  const value = localStorage.getItem('orbit.library.corners');
  return value === 'square' || value === 'round' ? value : 'soft';
}

function savedLift(): boolean {
  return localStorage.getItem('orbit.library.lift') !== 'off';
}

function savedGridOpen(): boolean {
  return localStorage.getItem('orbit.library.openselect') === 'on';
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title', label: 'A-Z' },
  { value: 'lastPlayed', label: 'Last played' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'added', label: 'Recently added' },
  { value: 'size', label: 'Size' },
  { value: 'manual', label: 'My order' },
];

/** Screenshots read once per store app id, kept for the rest of the session. */

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
  coverWidth,
  setCoverWidth,
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
  /** The cover's width in pixels, as Heronite sizes them. */
  coverWidth: number;
  setCoverWidth: (next: number) => void;
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
  const [facets, setFacets] = useState<LibraryFacets>(savedFacets);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [corners, setCorners] = useState<CoverCorners>(savedCorners);
  const [lift, setLift] = useState(savedLift);
  /** Whether a grid click opens the game's full page instead of the drawer. */
  const [gridOpen, setGridOpen] = useState(savedGridOpen);
  const viewSwitch = useRef<HTMLDivElement>(null);
  const filterBox = useRef<HTMLDivElement>(null);

  useEffect(() => localStorage.setItem('orbit.library.corners', corners), [corners]);
  useEffect(() => localStorage.setItem('orbit.library.lift', lift ? 'on' : 'off'), [lift]);
  useEffect(() => localStorage.setItem('orbit.library.openselect', gridOpen ? 'on' : 'off'), [gridOpen]);
  useEffect(() => localStorage.setItem('orbit.library.facets', JSON.stringify(facets)), [facets]);

  // The facets narrow the chips' result rather than replace them: the chips are
  // whose shelf it is, the facets are which corner of it is being looked at.
  const shown = useMemo(() => games.filter((game) => matchesFacets(game, facets)), [games, facets]);
  const facetCount = facets.only.length + (facets.start === 'any' ? 0 : 1);

  // Esc clears the page on purpose; the next filter or click brings one back.
  const cleared = useRef(false);
  const gameKey = shown.map((game) => game.id).join('\u0000');

  useEffect(() => {
    cleared.current = false;
  }, [gameKey]);

  // A filter that removes the open game moves the page to the first one left,
  // rather than leaving a blank page beside a shelf of other games.
  useEffect(() => {
    if (shown.length === 0) {
      setFocusId(null);
      return;
    }
    if (focusId && !shown.some((game) => game.id === focusId)) {
      setFocusId(shown[0].id);
      return;
    }
    if (!focusId && !cleared.current) setFocusId(shown[0].id);
  }, [shown, focusId]);

  // Esc lets the page go blank without leaving the library.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || viewMenu) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      if (!focusId) return;
      cleared.current = true;
      setFocusId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId, viewMenu]);

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

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (event: PointerEvent) => {
      if (filterBox.current?.contains(event.target as Node)) return;
      setFiltersOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  const toggleOnly = (value: OnlyFacet) => {
    setFacets((current) => ({
      ...current,
      only: current.only.includes(value)
        ? current.only.filter((item) => item !== value)
        : [...current.only, value],
    }));
  };

  const hidden = new Set(hiddenFilters ?? []);
  const filters: FilterDefinition[] = (orderedLibraryFilters(filterOrder).filter((item) => !hidden.has(item.id)));
  const chips = filters.length > 0 ? filters : [LIBRARY_FILTERS[0]];
  const focus = shown.find((game) => game.id === focusId) ?? null;
  const playedSecs = shown.reduce((sum, game) => sum + game.playSecs, 0);

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

  const resetDetails = () => {
    setRail('covers');
    setShelfSize('medium');
    setSections(SECTIONS.map((section) => section.value));
    setShape(DEFAULT_SHAPE);
    setCorners('soft');
    setLift(true);
  };

  const resetGrid = () => {
    setCoverWidth(DEFAULT_COVER_WIDTH);
    setGridLabel(DEFAULT_LABEL);
    setShape(DEFAULT_SHAPE);
    setCorners('soft');
    setLift(true);
    setGridOpen(false);
    setCoverTint(true);
  };

  return (
    <div className="orbit-library" data-corners={corners} data-lift={lift ? 'on' : 'off'}>
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
          <div className="orbit-filter" ref={filterBox}>
            <button
              type="button"
              className="chip shrink-0"
              aria-expanded={filtersOpen}
              aria-label="Narrow the shelf"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal className="mr-1.5 size-3.5" />
              Filters
              {facetCount > 0 && (
                <span className="orbit-num ml-1.5 rounded-md bg-accent/20 px-1.5 py-px text-[9.5px] text-fg">
                  {facetCount}
                </span>
              )}
            </button>
            {filtersOpen && (
              <div className="orbit-viewmenu orbit-filterpop" role="dialog" aria-label="Filters">
                <div className="flex items-center justify-between gap-3 px-1">
                  <span className="orbit-viewmenu-label !mb-0">Narrow the shelf</span>
                  {facetCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setFacets(NO_FACETS)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"
                    >
                      <X className="size-3" /> Clear
                    </button>
                  )}
                </div>

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Only</span>
                  <div className="orbit-minichips" role="group" aria-label="Only">
                    {FACET_CHOICES.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        aria-pressed={facets.only.includes(choice.value)}
                        onClick={() => toggleOnly(choice.value)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">How it starts</span>
                  <div className="orbit-minichips" role="group" aria-label="How it starts">
                    {START_CHOICES.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        aria-pressed={facets.start === choice.value}
                        onClick={() => setFacets((current) => ({ ...current, start: choice.value }))}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="orbit-viewmenu-note">
                  {shown.length === total
                    ? `${total} ${total === 1 ? 'game' : 'games'} in this shelf.`
                    : `${shown.length} of ${total} ${total === 1 ? 'game' : 'games'} shown.`}
                </p>
              </div>
            )}
          </div>
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
              title={mode === 'details' ? 'Observatory options' : 'Switch to Observatory'}
              onClick={() => chooseMode('details')}
            >
              <List className="size-3.5" strokeWidth={2} />
              Observatory
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
            </button>

            {viewMenu === 'details' && (
              <div className="orbit-viewmenu" role="dialog" aria-label="Observatory settings">
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
                <CornersRow value={corners} onChange={setCorners} />
                <div className="orbit-viewmenu-row">
                  <CheckboxInline checked={lift} onChange={setLift} label="Lift on hover" />
                </div>
                <button type="button" className="orbit-viewmenu-reset" onClick={resetDetails}>
                  Reset to defaults
                </button>
              </div>
            )}

            {viewMenu === 'grid' && (
              <div className="orbit-viewmenu" role="dialog" aria-label="Grid settings">
                <div className="orbit-viewmenu-row">
                  <span>Cover size</span>
                  <span className="orbit-viewmenu-value">{coverWidth} px</span>
                </div>
                <input
                  type="range"
                  min={MIN_COVER_WIDTH}
                  max={MAX_COVER_WIDTH}
                  step={5}
                  value={coverWidth}
                  onChange={(event) => setCoverWidth(Number(event.target.value))}
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
                <CornersRow value={corners} onChange={setCorners} />

                <div className="orbit-viewmenu-row">
                  <CheckboxInline checked={lift} onChange={setLift} label="Lift on hover" />
                </div>
                <div className="orbit-viewmenu-row">
                  <CheckboxInline checked={coverTint} onChange={setCoverTint} label="Tint on hover" />
                </div>

                <div className="orbit-viewmenu-block">
                  <CheckboxInline checked={gridOpen} onChange={setGridOpen} label="Open details on select" />
                </div>
                {sort === 'manual' && (
                  <p className="orbit-viewmenu-note">Drag one cover onto another to put it in your order.</p>
                )}
                <button type="button" className="orbit-viewmenu-reset" onClick={resetGrid}>
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === 'grid' ? (
        <div className="orbit-gridwrap">
          {shown.length === 0 ? (
            <Blank
              title={total === 0 ? 'Nothing in this orbit yet' : 'No games match'}
              body={total === 0 ? 'Add a game, or drop a program on the window.' : 'Try another title or clear the current filter.'}
              action={total === 0 ? { label: 'Add game', onClick: onAdd } : { label: 'Clear filters', onClick: () => { setQuery(''); setFilter('all'); setFacets(NO_FACETS); }}}
            />
          ) : (
            <GameGrid
              games={shown}
              selectedId={null}
              onSelect={(id) => {
                if (!gridOpen) {
                  onOpenDetails(id);
                  return;
                }
                setFocusId(id);
                setMode('details');
              }}
              onEdit={onEdit}
              onToggleFavorite={onToggleFavorite}
              onPlay={onPlay}
              width={coverWidth}
              onReorder={sort === 'manual' ? onReorder : undefined}
              coverTint={coverTint}
              shape={shape}
              label={gridLabel}
              lift={lift}
            />
          )}
        </div>
      ) : shown.length === 0 ? (
        <Blank
          title={total === 0 ? 'Nothing in this orbit yet' : 'No games match'}
          body={total === 0 ? 'Add a game, or drop a program on the window.' : 'Try another title or clear the current filter.'}
          action={total === 0 ? { label: 'Add game', onClick: onAdd } : { label: 'Clear filters', onClick: () => { setQuery(''); setFilter('all'); setFacets(NO_FACETS); }}}
        />
      ) : (
        <div className={cn('orbit-lib', `is-shelf-${shelfSize}`)}>
          <aside className="orbit-shelf" aria-label="Games">
            <div className="orbit-shelf-head">
              <h2>Shelf</h2>
              <span>{shown.length} of {total}</span>
            </div>
            <div className="orbit-shelf-scroll">
              {rail === 'covers' ? (
                <div className="orbit-shelf-grid">
                  {shown.map((game) => (
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
                  {shown.map((game) => (
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
            <div className="orbit-blank orbit-blank-quiet">
              <p>No game selected</p>
            </div>
          )}
        </div>
      )}
    </div>
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

/** How hard the corners of every cover are. */
function CornersRow({ value, onChange }: { value: CoverCorners; onChange: (next: CoverCorners) => void }) {
  return (
    <div className="orbit-viewmenu-block">
      <span className="orbit-viewmenu-sublabel">Corners</span>
      <div className="orbit-seg" role="group" aria-label="Cover corners">
        {COVER_CORNERS.map((corner) => (
          <button
            key={corner.value}
            type="button"
            aria-pressed={value === corner.value}
            onClick={() => onChange(corner.value)}
          >
            {corner.label}
          </button>
        ))}
      </div>
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

  // Captures are filed by the overlay while the game runs, so the room is
  // read again whenever the page is looked at and whenever the window comes
  // back from the game.
  const [captures, setCaptures] = useState<GalleryItem[] | null>(null);
  const [captureKind, setCaptureKind] = useState<CaptureKind | 'all'>('all');
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void overlayGallery()
        .then((rows) => {
          if (alive) setCaptures(capturesOf(rows, game.title));
        })
        .catch(() => {
          if (alive) setCaptures([]);
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
    };
  }, [game.title]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const captureTotal = captures?.length ?? 0;
  const kindCounts = captureCounts(captures ?? []);
  const shownCaptures = (captures ?? []).filter((item) => captureKind === 'all' || item.kind === captureKind);

  const openCapture = (item: GalleryItem) => {
    if (item.kind === 'screenshot') setLightbox(fileSrc(item.path));
    else void overlayOpen(item.path);
  };

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
              {captureTotal > 0 && <span className="count">{captureTotal}</span>}
            </h2>
            <div className="orbit-section-body">
              {captures === null ? (
                <div className="orbit-gallery-empty">Looking through this game's captures…</div>
              ) : captureTotal === 0 ? (
                <div className="orbit-gallery-empty">
                  Screenshots, recordings and replays taken with the overlay are filed here under this game.
                </div>
              ) : (
                <>
                  {captures.length > 1 && (
                    <div className="orbit-minichips mb-2.5">
                      <button aria-pressed={captureKind === 'all'} onClick={() => setCaptureKind('all')}>
                        All <span className="opacity-60">{captureTotal}</span>
                      </button>
                      {CAPTURE_KINDS.filter((kind) => kindCounts[kind] > 0).map((kind) => (
                        <button key={kind} aria-pressed={captureKind === kind} onClick={() => setCaptureKind(kind)}>
                          {CAPTURE_LABELS[kind].many} <span className="opacity-60">{kindCounts[kind]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="orbit-gallery">
                    {shownCaptures.map((item) => (
                      <button key={item.path} onClick={() => openCapture(item)} title={item.name}>
                        <CaptureThumb item={item} />
                      </button>
                    ))}
                  </div>
                </>
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
