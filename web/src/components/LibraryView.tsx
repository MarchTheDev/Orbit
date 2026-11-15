import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CalendarDays,
  Check,
  HardDrive,
  Images,
  Info,
  LayoutGrid,
  ChevronDown,
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
import type { Page } from '../types';
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
import { SearchField } from './ui/SearchField';
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

// Reading order, and the default: what you did, what you have achieved, and
// then the pictures of it. The gallery was second, which put a wall of
// thumbnails between the page's summary and the entries written about the game.
const SECTIONS: { value: GameSection; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'journal', label: 'Journal' },
  { value: 'achievements', label: 'Achievements' },
  { value: 'gallery', label: 'Gallery' },
];

const DEFAULT_SHAPE: CoverShape = '3:4';
const DEFAULT_LABEL: GridLabel = 'title-info';
/** Grid covers, the way Heronite sizes them: a pixel width, 110 to 240. */
const DEFAULT_COVER_WIDTH = 150;
const MIN_COVER_WIDTH = 110;
const MAX_COVER_WIDTH = 240;

/**
 * How wide a cover on the Observatory shelf is, in pixels.
 *
 * The shelf used to come in three named sizes, and even `large` left the
 * artwork small enough that a game's title had to be read rather than seen. A
 * pixel width is what the Grid view already uses, so the two views now speak
 * the same language, and a shelf of four big covers is possible on a laptop.
 */
const DEFAULT_SHELF_WIDTH = 132;
const MIN_SHELF_WIDTH = 84;
const MAX_SHELF_WIDTH = 260;

/**
 * How many covers sit in a row on the shelf.
 *
 * Heronite's observatory always packs two per row at every size, which makes the
 * shelf long and narrow; the covers are chosen here, so the player picks the
 * shape of the shelf. It reads from left to right, like a console's library,
 * rather than from top to bottom like a list.
 */
const SHELF_ROWS = [2, 3, 4, 5, 6] as const;
type ShelfRows = (typeof SHELF_ROWS)[number];
const DEFAULT_SHELF_ROWS: ShelfRows = 3;

/**
 * How tall a row of the Observatory's list is, in pixels.
 *
 * The covers shelf is a grid, so its size is a width; the list is one column of
 * rows, and its size is a height. A list of forty games at the old fixed height
 * was a column of identical slivers with no way to make one game look like the
 * subject of the page.
 */
const LIST_MIN = 44;
const LIST_MAX = 148;
const DEFAULT_LIST_SIZE = 56;

function savedListSize(): number {
  const value = Number(localStorage.getItem('orbit.observatory.listsize'));
  return Number.isFinite(value) && value >= LIST_MIN && value <= LIST_MAX ? value : DEFAULT_LIST_SIZE;
}

function savedShelfWidth(): number {
  const value = Number(localStorage.getItem('orbit.observatory.width'));
  return Number.isFinite(value) && value >= MIN_SHELF_WIDTH && value <= MAX_SHELF_WIDTH ? value : DEFAULT_SHELF_WIDTH;
}

/** How a picture fills its frame: Orbit's guess, always fill, or always fit whole. */
type FitChoice = 'auto' | 'cover' | 'contain';

function savedFit(key: string): FitChoice {
  const value = localStorage.getItem(key);
  return value === 'cover' || value === 'contain' ? value : 'auto';
}

function savedShelfRows(): ShelfRows {
  const value = Number(localStorage.getItem('orbit.observatory.rows'));
  return (SHELF_ROWS as readonly number[]).includes(value) ? (value as ShelfRows) : DEFAULT_SHELF_ROWS;
}

/** The "Only" switches that narrow the shelf on top of the chips. */
type OnlyFacet = 'played' | 'unplayed';
type StartFacet = 'any' | 'steam' | 'local' | 'tracked';
interface LibraryFacets {
  only: OnlyFacet[];
  start: StartFacet;
}

const NO_FACETS: LibraryFacets = { only: [], start: 'any' };

// Only the two that read as a pair: whether a game has been played. The others -
// "can be started", "has notes" - were two more switches in the same row that
// answered questions the shelf already answers better by being looked at.
const FACET_CHOICES: { value: OnlyFacet; label: string }[] = [
  { value: 'played', label: 'Played' },
  { value: 'unplayed', label: 'Never played' },
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
  shelfSize: _shelfSize,
  setShelfSize: _setShelfSize,
  // Kept so an older caller still type-checks; the shelf's own width is set in
  // its options panel now, and the named sizes no longer exist.
  shape,
  /** @deprecated Each view keeps its own cover shape now. */
  setShape: _setShape,
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
  historyFocus,
  onFocus,
  genreRequest,
  onGenreRequest,
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
  /** @deprecated The shelf is sized in pixels from its own options panel. */
  shelfSize?: ShelfSize;
  /** @deprecated See `shelfSize`. */
  setShelfSize?: (next: ShelfSize) => void;
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
  /** A game the window's history wants the shelf to select again. */
  historyFocus?: { id: string; page: Page; token: number } | null;
  /** Reports the shelf's selection, so Back can return to it. */
  onFocus?: (id: string) => void;
  /** A genre the command palette named, applied and then cleared. */
  genreRequest?: string | null;
  onGenreRequest?: () => void;
}) {
  const [focusId, setFocusId] = useState<string | null>(games[0]?.id ?? null);
  /**
   * Choose a game on the shelf.
   *
   * Every way of selecting one comes through here so the window's history can
   * record it: clicking a cover, opening a game from the grid, and a Back that
   * names a game all end up in the same place.
   */
  const choose = (id: string) => {
    setFocusId(id);
    cleared.current = false;
    onFocus?.(id);
  };
  const [viewMenu, setViewMenu] = useState<LibraryMode | null>(null);
  const [facets, setFacets] = useState<LibraryFacets>(savedFacets);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /**
   * Cover shape per view.
   *
   * Observatory and Grid each keep their own answer. One shared setting meant
   * that making the covers square in the cover wall also squared the shelf, and
   * the two views are looked at for different reasons: the shelf is a list you
   * scan, the wall is artwork you browse. Same setting, different choice.
   */
  const [gridShape, setGridShape] = useState<CoverShape>(shape);
  const [shelfShape, setShelfShape] = useState<CoverShape>(shape);
  const [corners, setCorners] = useState<CoverCorners>(savedCorners);
  const [lift, setLift] = useState(savedLift);
  /** Whether a grid click opens the game's full page instead of the drawer. */
  const [gridOpen, setGridOpen] = useState(savedGridOpen);
  /** Observatory shelf sizing: cover width in pixels, covers per row. */
  const [shelfWidth, setShelfWidth] = useState(savedShelfWidth);
  const [shelfRows, setShelfRows] = useState<ShelfRows>(savedShelfRows);
  // A list row's height, in pixels. Covers are a grid of columns; a list is one
  // column of rows, so its size is how tall each row is - the cover grows with
  // it and so does the type beside it.
  const [listSize, setListSize] = useState<number>(savedListSize);
  /**
   * Whether a click in the Grid opens the game instead of only opening it in the
   * Observatory.
   *
   * Playnite's behaviour, and the reason to want it: on a couch-sized cover wall
   * the Grid is the library, so a single press that both selects and shows the
   * game saves the second step. Off by default - a wall of covers where every
   * click leaves the wall is surprising if you have only ever used a mouse.
   */
  const [gridOpensOnSelect] = useState<boolean>(
    () => localStorage.getItem('orbit.library.openOnSelect') === '1',
  );
  /** Grid wall sizing, kept apart from the shelf's. */
  const [gridWidth, setGridWidth] = useState(coverWidth);
  /** Whether the shelf widens its covers to fill the row it was given. */
  const [shelfFill, setShelfFill] = useState(() => localStorage.getItem('orbit.observatory.fill') === 'on');
  /**
   * How artwork fills its frame, per view.
   *
   * `auto` keeps the Cover component's own answer — a picture squarer than a
   * poster is fitted whole over a blurred copy of itself — which is what a
   * library made of store banners needs, since a banner dropped into a tall
   * tile would otherwise be cropped down the middle of its artwork. Pinning
   * `contain` says the same thing for every cover in the view; `cover` says the
   * opposite, filling the frame and cropping whatever does not fit.
   */
  const [shelfFit, setShelfFit] = useState<FitChoice>(() => savedFit('orbit.observatory.fit'));
  const [gridFit, setGridFit] = useState<FitChoice>(() => savedFit('orbit.library.fit'));
  const viewSwitch = useRef<HTMLDivElement>(null);
  const filterBox = useRef<HTMLDivElement>(null);

  useEffect(() => localStorage.setItem('orbit.library.corners', corners), [corners]);
  useEffect(() => localStorage.setItem('orbit.library.lift', lift ? 'on' : 'off'), [lift]);
  useEffect(() => localStorage.setItem('orbit.library.openselect', gridOpen ? 'on' : 'off'), [gridOpen]);
  useEffect(() => localStorage.setItem('orbit.library.facets', JSON.stringify(facets)), [facets]);
  useEffect(() => localStorage.setItem('orbit.observatory.width', String(shelfWidth)), [shelfWidth]);
  useEffect(() => localStorage.setItem('orbit.observatory.rows', String(shelfRows)), [shelfRows]);
  useEffect(() => localStorage.setItem('orbit.observatory.listsize', String(listSize)), [listSize]);
  useEffect(
    () => localStorage.setItem('orbit.library.openOnSelect', gridOpensOnSelect ? '1' : '0'),
    [gridOpensOnSelect],
  );
  useEffect(() => localStorage.setItem('orbit.observatory.fill', shelfFill ? 'on' : 'off'), [shelfFill]);
  useEffect(() => localStorage.setItem('orbit.observatory.fit', shelfFit), [shelfFit]);
  useEffect(() => localStorage.setItem('orbit.library.fit', gridFit), [gridFit]);
  // App's shape is the answer for a library that has never chosen one per view,
  // and a change made there should still reach both.
  useEffect(() => {
    setGridShape(shape);
    setShelfShape(shape);
  }, [shape]);
  useEffect(() => setGridWidth(coverWidth), [coverWidth]);

  /** The genre rail's pick, which narrows everything else. */
  const [genre, setGenre] = useState<string | null>(() => localStorage.getItem('orbit.library.genre'));

  /**
   * Whether one game belongs to the shelf being read.
   *
   * The chips are whose shelf it is, the genre is what kind of game, and the
   * facets are which corner of it is being looked at. Declared here, above the
   * memo below it: a `const` arrow is not hoisted the way a function
   * declaration is, so this pair was once split - the memo above, the narrower
   * below - and the first render threw and blanked the window instead of
   * leaving an empty shelf.
   */
  const applyChips = (game: Game) => {
    if (filter === 'favorites' && !game.favorite) return false;
    if (filter === 'hidden' && !game.hidden) return false;
    if (filter !== 'favorites' && filter !== 'hidden' && game.hidden) return false;
    if (genre && !(game.meta?.genres ?? []).some((name) => name.trim().toLowerCase() === genre.toLowerCase())) return false;
    return matchesFacets(game, facets);
  };

  // The chips, the genre and the facets all narrow the same shelf.
  const shown = useMemo(
    () => games.filter(applyChips),
    // `applyChips` closes over the filter, the genre and the facets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, filter, genre, facets],
  );

  const facetCount = facets.only.length + (facets.start === 'any' ? 0 : 1) + (genre ? 1 : 0);
  useEffect(() => localStorage.setItem('orbit.library.genre', genre ?? ''), [genre]);

  // A genre from the command palette is applied here and then handed back, so
  // the same one asked for twice in a row runs twice.
  useEffect(() => {
    if (!genreRequest) return;
    setGenre(genreRequest);
    onGenreRequest?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreRequest]);

  // A step the window replayed names a game; the shelf follows it. The token
  // makes a repeat of the same step run again rather than being swallowed.
  useEffect(() => {
    if (!historyFocus || historyFocus.page !== 'library') return;
    setViewMenu(null);
    if (games.some((game) => game.id === historyFocus.id)) {
      cleared.current = false;
      setFocusId(historyFocus.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFocus?.token]);

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
    setShelfWidth(DEFAULT_SHELF_WIDTH);
    setShelfRows(DEFAULT_SHELF_ROWS);
    setListSize(DEFAULT_LIST_SIZE);
    setShelfFill(false);
    setShelfShape(DEFAULT_SHAPE);
    setSections(SECTIONS.map((section) => section.value));
    setCorners('soft');
    setLift(true);
  };

  const resetGrid = () => {
    setGridWidth(DEFAULT_COVER_WIDTH);
    setGridLabel(DEFAULT_LABEL);
    setGridShape(DEFAULT_SHAPE);
    setCorners('soft');
    setLift(true);
    setGridOpen(false);
    setCoverTint(true);
  };

  const resetFilters = () => {
    setFacets(NO_FACETS);
    setGenre(null);
    setSort('title');
  };

  /**
   * The genres the shelf actually holds, commonest first.
   *
   * A rail of every genre a store has ever invented would be longer than the
   * library, so only the ones somebody owns are offered, and they are ordered by
   * how much of the shelf each one accounts for: the four at the top are the
   * ones worth a click.
   */
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of games) {
      for (const genre of game.meta?.genres ?? []) {
        const name = genre.trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }, [games]);

  /**
   * The divider between the shelf and the game beside it.
   *
   * A shelf whose size is only reachable through a menu three presses away is a
   * shelf people leave at whatever it was. This is the direct version: press the
   * seam and drag, and the column follows the pointer. The width is clamped to
   * the same range the menu offers, held on the window while dragging so the
   * pointer can leave the seam without letting go, and written through the same
   * setter the menu uses so the two can never disagree.
   */
  const dragShelf = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = shelfWidth;
    const scroller = document.querySelector('.orbit-scroll');
    const limit = Math.min(MAX_SHELF_WIDTH, Math.round((window.innerWidth || 1400) * 0.46));
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(MIN_SHELF_WIDTH, Math.min(limit, startWidth + (moveEvent.clientX - startX)));
      setShelfWidth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
      scroller?.classList.remove('is-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('is-resizing');
    scroller?.classList.add('is-resizing');
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
              {item.id === 'all' && <span className="orbit-num ml-1.5 rounded-md bg-onaccent/15 px-1.5 py-px text-[9.5px]">{total}</span>}
            </button>
          ))}
          {genre && (
            <button className="chip is-active shrink-0" onClick={() => setGenre(null)} title="Stop filtering by genre">
              {genre}
              <X className="ml-1.5 size-3" />
            </button>
          )}
        </div>

        <div className="orbit-libtools-right">
          <SearchField value={query} onChange={setQuery} placeholder="Find a game" />
          {/* Filters owns the sort as well as the facets: one button that
              decides what the shelf holds and how it is read, instead of a
              dropdown standing next to it saying half the same thing.

              It is drawn here, inside the Library's own tools row, and nowhere
              else. Every page with a search box was getting it for a while,
              because it had been placed in the header the pages share; a
              control that changes what the shelf holds means nothing on the
              Journal or the Backlog, and the people who asked for it there
              were asking about the shelf. */}
          <div className="orbit-filter" ref={filterBox}>
            <button
              type="button"
              className="chip shrink-0"
              data-open={filtersOpen || undefined}
              aria-expanded={filtersOpen}
              aria-label="Filter and sort the shelf"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal className="mr-1.5 size-3.5" />
              Filters
              {facetCount > 0 && (
                <span className="orbit-num ml-1.5 rounded-md bg-onaccent/15 px-1.5 py-px text-[9.5px] text-onaccent">
                  {facetCount}
                </span>
              )}
            </button>
            {filtersOpen && (
              <div className="orbit-viewmenu orbit-filterpop" role="dialog" aria-label="Filters and sorting">
                <div className="flex items-center justify-between gap-3 px-1">
                  <span className="orbit-viewmenu-label !mb-0">Filters and sorting</span>
                  {facetCount > 0 || filter !== 'all' || sort !== 'title' ? (
                    <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg">
                      <X className="size-3" /> Clear
                    </button>
                  ) : null}
                </div>

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Order</span>
                  <div className="orbit-sortlist" role="group" aria-label="How the shelf is ordered">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={sort === option.value}
                        onClick={() => setSort(option.value)}
                      >
                        {option.label}
                        {sort === option.value && <Check className="size-3.5" />}
                      </button>
                    ))}
                  </div>
                </div>

                {genres.length > 0 && (
                  <div className="orbit-viewmenu-block">
                    <span className="orbit-viewmenu-sublabel">Genre</span>
                    <div className="orbit-minichips" role="group" aria-label="Genre">
                      {genres.map((entry) => (
                        <button
                          key={entry.name}
                          type="button"
                          aria-pressed={genre === entry.name}
                          onClick={() => setGenre(genre === entry.name ? null : entry.name)}
                        >
                          {entry.name}
                          <span className="ml-1 opacity-55">{entry.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
              <ChevronDown
                className="orbit-viewbtn-caret"
                aria-hidden
                strokeWidth={2.4}
              />
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
              <ChevronDown
                className="orbit-viewbtn-caret"
                aria-hidden
                strokeWidth={2.4}
              />
            </button>

            {viewMenu === 'details' && (
              <div className="orbit-viewmenu" role="dialog" aria-label="Observatory settings">
                <span className="orbit-viewmenu-label">Shelf</span>
                <div className="orbit-seg" role="group" aria-label="How the shelf is drawn">
                  <button type="button" aria-pressed={rail === 'covers'} onClick={() => setRail('covers')}>Covers</button>
                  <button type="button" aria-pressed={rail === 'list'} onClick={() => setRail('list')}>List</button>
                </div>

                {rail === 'covers' && (
                  <>
                    <div className="orbit-viewmenu-block">
                      <span className="orbit-viewmenu-sublabel">Covers in a row</span>
                      <div className="orbit-seg" role="group" aria-label="Covers in a row">
                        {SHELF_ROWS.map((count) => (
                          <button
                            key={count}
                            type="button"
                            aria-pressed={shelfRows === count}
                            onClick={() => setShelfRows(count)}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="orbit-viewmenu-row">
                      <span>Cover size</span>
                      <span className="orbit-viewmenu-value">{shelfWidth} px</span>
                    </div>
                    <input
                      type="range"
                      min={MIN_SHELF_WIDTH}
                      max={MAX_SHELF_WIDTH}
                      step={4}
                      value={shelfWidth}
                      onChange={(event) => setShelfWidth(Number(event.target.value))}
                      className="orbit-range w-full cursor-pointer"
                      aria-label="Shelf cover size"
                    />

                    <div className="orbit-viewmenu-block">
                      <span className="orbit-viewmenu-sublabel">Cover shape</span>
                      <ShapeRow value={shelfShape} onChange={setShelfShape} />
                    </div>

                    <div className="orbit-viewmenu-block">
                      <span className="orbit-viewmenu-sublabel">Cover fit</span>
                      <div className="orbit-seg" role="group" aria-label="How artwork fills its frame">
                        <button type="button" aria-pressed={shelfFit === 'auto'} onClick={() => setShelfFit('auto')}>Auto</button>
                        <button type="button" aria-pressed={shelfFit === 'cover'} onClick={() => setShelfFit('cover')}>Fill</button>
                        <button type="button" aria-pressed={shelfFit === 'contain'} onClick={() => setShelfFit('contain')}>Fit whole</button>
                      </div>
                    </div>

                    <div className="orbit-viewmenu-row">
                      <div className="orbit-setrow !border-0 !p-0"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">Fill the row</p></div><button type="button" role="switch" aria-checked={shelfFill} onClick={() => setShelfFill(!shelfFill)} className="orbit-switch" data-on={shelfFill || undefined}><i /></button></div>
                    </div>
                  </>
                )}

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Game page sections</span>
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

                <span className="orbit-viewmenu-label">Shape</span>
                <CornersRow value={corners} onChange={setCorners} />

                <span className="orbit-viewmenu-label">Behaviour</span>
                <div className="orbit-viewmenu-row">
                  <div className="orbit-setrow !border-0 !p-0"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">Lift on hover</p></div><button type="button" role="switch" aria-checked={lift} onClick={() => setLift(!lift)} className="orbit-switch" data-on={lift || undefined}><i /></button></div>
                </div>
                <div className="orbit-viewmenu-row">
                  <div className="orbit-setrow !border-0 !p-0"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">Tint on hover</p></div><button type="button" role="switch" aria-checked={coverTint} onClick={() => setCoverTint(!coverTint)} className="orbit-switch" data-on={coverTint || undefined}><i /></button></div>
                </div>
                <button type="button" className="orbit-viewmenu-reset" onClick={resetDetails}>
                  Reset to defaults
                </button>

                {rail === 'list' && (
                  <div className="orbit-viewmenu-block">
                    <div className="orbit-viewmenu-row">
                      <span>Row size</span>
                      <span className="orbit-viewmenu-value">{listSize} px</span>
                    </div>
                    <input
                      type="range"
                      min={LIST_MIN}
                      max={LIST_MAX}
                      step={2}
                      value={listSize}
                      onChange={(event) => setListSize(Number(event.target.value))}
                      className="orbit-range w-full cursor-pointer"
                      aria-label="Row size"
                    />
                  </div>
                )}

              </div>
            )}

            {viewMenu === 'grid' && (
              <div className="orbit-viewmenu" role="dialog" aria-label="Grid settings">
                <div className="orbit-viewmenu-row">
                  <span>Cover size</span>
                  <span className="orbit-viewmenu-value">{gridWidth} px</span>
                </div>
                <input
                  type="range"
                  min={MIN_COVER_WIDTH}
                  max={MAX_COVER_WIDTH}
                  step={5}
                  value={gridWidth}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setGridWidth(next);
                    setCoverWidth(next);
                  }}
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

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Cover shape</span>
                  <ShapeRow value={gridShape} onChange={setGridShape} />
                </div>

                <div className="orbit-viewmenu-block">
                  <span className="orbit-viewmenu-sublabel">Cover fit</span>
                  <div className="orbit-seg" role="group" aria-label="How artwork fills its frame">
                    <button type="button" aria-pressed={gridFit === 'auto'} onClick={() => setGridFit('auto')}>Auto</button>
                    <button type="button" aria-pressed={gridFit === 'cover'} onClick={() => setGridFit('cover')}>Fill</button>
                    <button type="button" aria-pressed={gridFit === 'contain'} onClick={() => setGridFit('contain')}>Fit whole</button>
                  </div>
                </div>

                <span className="orbit-viewmenu-label">Shape</span>
                <CornersRow value={corners} onChange={setCorners} />

                <span className="orbit-viewmenu-label">Behaviour</span>
                <div className="orbit-viewmenu-row">
                  <div className="orbit-setrow !border-0 !p-0"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">Lift on hover</p></div><button type="button" role="switch" aria-checked={lift} onClick={() => setLift(!lift)} className="orbit-switch" data-on={lift || undefined}><i /></button></div>
                </div>
                <div className="orbit-viewmenu-row">
                  <div className="orbit-setrow !border-0 !p-0"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">Tint on hover</p></div><button type="button" role="switch" aria-checked={coverTint} onClick={() => setCoverTint(!coverTint)} className="orbit-switch" data-on={coverTint || undefined}><i /></button></div>
                </div>
                <div className="orbit-viewmenu-row">
                  <div className="orbit-setrow !border-0 !p-0"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">Open details on select</p></div><button type="button" role="switch" aria-checked={gridOpen} onClick={() => setGridOpen(!gridOpen)} className="orbit-switch" data-on={gridOpen || undefined}><i /></button></div>
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
                // Double click, or a single one when the Grid is asked to open
                // on select, shows the game. A single click always selects it,
                // so the two cannot disagree about which game was meant.
                if (gridOpensOnSelect) {
                  choose(id);
                  setMode('details');
                  return;
                }
                if (!gridOpen) {
                  onOpenDetails(id);
                  return;
                }
                choose(id);
                setMode('details');
              }}
              onEdit={onEdit}
              onToggleFavorite={onToggleFavorite}
              onPlay={onPlay}
              width={gridWidth}
              onReorder={sort === 'manual' ? onReorder : undefined}
              coverTint={coverTint}
              shape={gridShape}
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
        <div
          className={cn('orbit-lib', `is-shelf-${shelfRows}`, rail === 'list' && 'is-list')}
          style={{
            ['--orbit-shelf-columns' as string]: shelfRows,
            ['--orbit-shelf-width' as string]: `${shelfWidth}px`,
            // The column itself, so the seam and the shelf agree about where
            // the divisions are no matter which rail is inside it.
            ['--orbit-shelf-column' as string]: `${shelfWidth * shelfRows + (shelfRows - 1) * 10 + 40}px`,
          }}
        >
          <aside className="orbit-shelf" aria-label="Games">
            <div className="orbit-shelf-head">
              <h2>Shelf</h2>
              <span>{shown.length} of {total}</span>
            </div>
            <div className="orbit-shelf-scroll">
              {rail === 'covers' ? (
                <div className={cn('orbit-shelf-grid', shelfFill && 'is-filled')}>
                  {shown.map((game) => (
                    <button
                      key={game.id}
                      className="orbit-shelf-tile"
                      data-orbit-game={game.id}
                      aria-current={game.id === focusId ? 'true' : undefined}
                      onClick={() => choose(game.id)}
                      title={game.title}
                    >
                      <span className="relative block" style={{ aspectRatio: shelfShape.replace(':', ' / ') }}>
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
                      data-size={listSize}
                      aria-current={game.id === focusId ? 'true' : undefined}
                      onClick={() => choose(game.id)}
                      title={game.title}
                    >
                      <span className="orbit-shelf-rowart">
                        <Cover
                          game={game}
                          className="orbit-cover"
                          // The cover is the row, so it is drawn from the row's
                          // height rather than from a fixed pair of numbers: a
                          // bigger row is a bigger picture, not more padding.
                          style={{ width: Math.round(listSize * 0.76 * 100) / 100, height: listSize - 12 }}
                          loading="lazy"
                        />
                        {game.id === runningId && (
                          <span className="orbit-pulse absolute -right-0.5 -top-0.5 z-10 size-1.5 rounded-full bg-emerald-400" />
                        )}
                      </span>
                      <span className="orbit-shelf-rowcopy">
                        <b>{game.title}</b>
                        <span>
                          {fmtMinutes(game.playSecs / 60)}
                          {game.lastPlayed ? ` · ${fmtDate(game.lastPlayed)}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* The seam. A wide hit target with a hairline in the middle of it: the
              line is what the eye sees, the width is what the hand can find. */}
          <div
            className="orbit-shelf-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the shelf"
            aria-valuenow={shelfWidth}
            aria-valuemin={MIN_SHELF_WIDTH}
            aria-valuemax={MAX_SHELF_WIDTH}
            tabIndex={0}
            onPointerDown={dragShelf}
            onDoubleClick={() => setShelfWidth(DEFAULT_SHELF_WIDTH)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 32 : 8;
              if (event.key === 'ArrowLeft') setShelfWidth((w) => Math.max(MIN_SHELF_WIDTH, w - step));
              else if (event.key === 'ArrowRight') setShelfWidth((w) => Math.min(MAX_SHELF_WIDTH, w + step));
              else return;
              event.preventDefault();
            }}
            title="Drag to resize the shelf. Double-click to reset."
          />

          {focus ? (
            <GamePage
              key={focus.id}
              game={focus}
              shape={shelfShape}
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
