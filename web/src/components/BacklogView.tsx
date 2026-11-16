import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  Clock,
  GripVertical,
  Hourglass,
  LayoutGrid,
  ListFilter,
  Pencil,
  Play,
  Plus,
  Shuffle,
  Sparkles,
  SquareArrowRight,
  Star,
  Timer,
  Undo2,
  X,
} from 'lucide-react';
import type { Game, GameStatus, MetaData } from '../types';
import { fetchFacts, fetchMetadata } from '../services/metadata';
import { fetchHltb } from '../services/hltb';
import { fmtDate, fmtMinutes, hashHue, uid } from '../utils/format';
import { moveInOrder } from '../utils/reorder';
import { inLibraryShelf, onBacklogPage, onDisk } from '../utils/library';
import {
  buildPersonalCalendarGrid,
  getUnreleasedBacklogGames,
  parseGameRelease,
  type UpcomingBacklogEntry,
} from '../utils/releaseCalendar';
import { useDragReorder } from '../hooks/useDragReorder';
import { PlanDialog, type PlanPick } from './detail/PlanDialog';
import { HltbExtraEstimate } from './detail/HltbExtraEstimate';
import { Cover } from './ui/Cover';
import { SearchField } from './ui/SearchField';
import { HeadStat, PageHead } from './ui/Page';
import { cn } from '../utils/cn';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { btnAccent } from './ui/buttons';

function byLength(game: Game): number {
  const main = game.hltb?.main ?? 0;
  return main > 0 ? main : Number.POSITIVE_INFINITY;
}

type Order = 'mine' | 'shortest' | 'longest' | 'added';
type LengthFilter = 'all' | 'quick' | 'medium' | 'long';
type LaneFilter = 'all' | 'backlog' | 'playing' | 'planned' | 'favorites' | 'completed' | 'dropped';

const ORDERS: { id: Order; label: string; shortLabel: string; icon: typeof Clock }[] = [
  { id: 'mine', label: 'My order', shortLabel: 'My order', icon: GripVertical },
  { id: 'shortest', label: 'Shortest first', shortLabel: 'Shortest', icon: Hourglass },
  { id: 'longest', label: 'Longest first', shortLabel: 'Longest', icon: Clock },
  { id: 'added', label: 'Recently added', shortLabel: 'Newest', icon: Plus },
];

const LENGTH_FILTERS: { id: LengthFilter; label: string; hint: string }[] = [
  { id: 'all', label: 'Any length', hint: 'Every game regardless of runtime' },
  { id: 'quick', label: '≤ 10h', hint: 'Weekend-sized main story (10 hours or under)' },
  { id: 'medium', label: '10–30h', hint: 'Medium campaigns between 10 and 30 hours' },
  { id: 'long', label: '30h+', hint: 'Long RPGs and epics over 30 hours' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function matchesLength(game: Game, filter: LengthFilter): boolean {
  if (filter === 'all') return true;
  const main = game.hltb?.main ?? 0;
  if (main <= 0) return false;
  if (filter === 'quick') return main <= 10;
  if (filter === 'medium') return main > 10 && main <= 30;
  return main > 30;
}

function fmtCountdown(daysUntil: number | null, fallback: string): string {
  if (daysUntil === null) return fallback || 'TBA';
  if (daysUntil <= 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil < 30) return `In ${daysUntil}d`;
  const months = Math.round(daysUntil / 30.4);
  return months <= 1 ? `In ${daysUntil}d` : `~${months} mo`;
}

export function BacklogView({
  games,
  onSelect,
  onEdit,
  onStatus,
  onAdd,
  onUpdate,
  onRemove,
  fetchMetadata: fetchMeta,
  syncLibrary,
  backlogOn,
  backlogOff,
  onBacklogMembership,
  myOrder,
  setMyOrder,
  showReleaseCalendar = true,
  embedded = false,
}: {
  games: Game[];
  onSelect: (id: string, readOnlyMoves?: boolean) => void;
  onEdit: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  onAdd: (game: Game) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onRemove: (id: string) => void;
  fetchMetadata: boolean;
  syncLibrary: boolean;
  backlogOn: string[];
  backlogOff: string[];
  onBacklogMembership: (id: string, on: boolean) => void;
  myOrder: string[];
  setMyOrder: (ids: string[]) => void;
  /** Controlled by Settings -> Library and Backlog (on by default). */
  showReleaseCalendar?: boolean;
  embedded?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('mine');
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>('all');
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [planning, setPlanning] = useState(false);
  const [planRemovalTarget, setPlanRemovalTarget] = useState<Game | null>(null);
  const [picking, setPicking] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [showTimes, setShowTimes] = useState(false);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [releaseEditGame, setReleaseEditGame] = useState<Game | null>(null);

  // Quietly enrich Steam-linked Backlog/planned games with releaseDate + comingSoon once per session
  const enrichedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!fetchMeta) return;
    const candidates = games.filter(
      (g) =>
        (g.planned === true || onBacklogPage(g, syncLibrary, backlogOn, backlogOff)) &&
        g.meta?.steamAppId &&
        g.meta.releaseDate === undefined &&
        g.meta.comingSoon === undefined &&
        !enrichedIds.current.has(g.id),
    );
    for (const game of candidates.slice(0, 6)) {
      enrichedIds.current.add(game.id);
      const appId = game.meta?.steamAppId;
      if (!appId) continue;
      void fetchFacts(appId)
        .then((facts) => {
          if (!facts.releaseDate && !facts.comingSoon) return;
          onUpdate(game.id, {
            meta: {
              summary: game.meta?.summary ?? facts.summary ?? '',
              genres: game.meta?.genres ?? facts.genres ?? [],
              developer: game.meta?.developer ?? facts.developer ?? '',
              releaseYear: game.meta?.releaseYear ?? facts.releaseYear ?? null,
              rating: game.meta?.rating ?? null,
              ...game.meta,
              releaseDate: facts.releaseDate,
              comingSoon: facts.comingSoon,
            },
          });
        })
        .catch(() => undefined);
    }
  }, [games, fetchMeta, syncLibrary, backlogOn, backlogOff, onUpdate]);

  const match = (g: Game) => {
    const q = query.trim().toLowerCase();
    if (q) {
      const hay = `${g.title} ${g.meta?.developer ?? ''} ${(g.meta?.genres ?? []).join(' ')} ${g.planPlatform ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return matchesLength(g, lengthFilter);
  };

  const allPlanned = useMemo(() => games.filter((g) => g.planned), [games]);
  const owned = useMemo(
    () => games.filter((g) => onBacklogPage(g, syncLibrary, backlogOn, backlogOff)),
    [games, syncLibrary, backlogOn, backlogOff],
  );
  const fromLibrary = useMemo(
    () => games.filter((g) => inLibraryShelf(g) && !onBacklogPage(g, syncLibrary, backlogOn, backlogOff)),
    [games, syncLibrary, backlogOn, backlogOff],
  );

  const filteredFromLibrary = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return fromLibrary;
    return fromLibrary.filter((g) => g.title.toLowerCase().includes(q));
  }, [fromLibrary, libraryQuery]);

  const planned = useMemo(() => allPlanned.filter(match), [allPlanned, query, lengthFilter]);

  const plan = ({ name, appId, coverUrl, facts, hltb: times, platform }: PlanPick) => {
    const title = name.trim();
    if (!title) return;
    const meta: MetaData | undefined = facts
      ? {
          name: facts.name || title,
          summary: facts.summary,
          genres: facts.genres,
          developer: facts.developer ?? '',
          releaseYear: facts.releaseYear,
          releaseDate: facts.releaseDate ?? null,
          comingSoon: facts.comingSoon,
          rating: null,
          coverUrl: facts.portraitUrl ?? coverUrl ?? null,
          headerUrl: facts.headerUrl ?? facts.heroUrl ?? null,
          steamAppId: appId ?? null,
          source: 'steam',
        }
      : appId || coverUrl
        ? {
            summary: '',
            genres: [],
            developer: '',
            releaseYear: null,
            rating: null,
            coverUrl: coverUrl ?? null,
            headerUrl: null,
            steamAppId: appId ?? null,
            source: 'steam',
          }
        : undefined;

    const game: Game = {
      id: uid(),
      title,
      launch: { kind: 'none' },
      exePath: null,
      installDir: null,
      drive: '',
      sizeBytes: 0,
      sizeGb: 0,
      status: 'backlog',
      favorite: false,
      manualPlaySecs: 0,
      playSecs: 0,
      lastPlayed: null,
      addedAt: new Date().toISOString(),
      notes: '',
      hue: hashHue(title),
      coverPath: null,
      planned: true,
      planPlatform: platform ?? 'Steam',
      ...(meta ? { meta } : {}),
      ...(times ? { hltb: times } : {}),
      sessionCount: 0,
      longestSecs: 0,
      running: false,
      companions: [],
    };
    onAdd(game);
    setPlanning(false);

    const needMeta = !meta && fetchMeta;
    const needFacts = Boolean(appId && !facts && fetchMeta);
    if (needMeta || needFacts || !times) {
      const wanted = meta?.name || title;
      void Promise.allSettled([
        needMeta ? fetchMetadata(wanted, appId) : Promise.resolve(null),
        needFacts && appId ? fetchFacts(appId) : Promise.resolve(null),
        times ? Promise.resolve(null) : fetchHltb(wanted),
      ]).then(([found, storeFacts, timed]) => {
        const better = found.status === 'fulfilled' ? found.value : null;
        const factVal = storeFacts.status === 'fulfilled' ? storeFacts.value : null;
        const clocked = timed.status === 'fulfilled' ? timed.value : null;
        if (!better && !factVal && !clocked) return;
        const nextMeta: MetaData | undefined = better || factVal
          ? {
              summary: better?.summary ?? meta?.summary ?? factVal?.summary ?? '',
              genres: better?.genres ?? meta?.genres ?? factVal?.genres ?? [],
              developer: better?.developer ?? meta?.developer ?? factVal?.developer ?? '',
              releaseYear: better?.releaseYear ?? meta?.releaseYear ?? factVal?.releaseYear ?? null,
              rating: better?.rating ?? meta?.rating ?? null,
              ...meta,
              ...better,
              ...(factVal ? { releaseDate: factVal.releaseDate, comingSoon: factVal.comingSoon } : {}),
            }
          : undefined;
        onUpdate(game.id, {
          ...(nextMeta ? { meta: nextMeta, title: better?.name || factVal?.name || title } : {}),
          ...(clocked ? { hltb: clocked } : {}),
        });
      });
    }
  };

  const backlog = useMemo(() => {
    const list = owned.filter((g) => g.status === 'backlog' && match(g));
    return [...list].sort((a, b) => {
      if (order === 'mine') {
        const ai = myOrder.indexOf(a.id);
        const bi = myOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      if (order === 'shortest') return byLength(a) - byLength(b) || a.title.localeCompare(b.title);
      if (order === 'longest') return byLength(b) - byLength(a) || a.title.localeCompare(b.title);
      return b.addedAt.localeCompare(a.addedAt);
    });
  }, [owned, query, lengthFilter, order, myOrder]);

  const move = (fromId: string, toId: string, after: boolean) => {
    const ids = moveInOrder(
      backlog.map((g) => g.id),
      fromId,
      toId,
      after,
    );
    setMyOrder([...ids, ...myOrder.filter((id) => !ids.includes(id))]);
  };

  const playing = useMemo(() => owned.filter((g) => g.status === 'playing' && match(g)), [owned, query, lengthFilter]);
  const completed = useMemo(() => owned.filter((g) => g.status === 'completed' && match(g)), [owned, query, lengthFilter]);
  const dropped = useMemo(() => owned.filter((g) => g.status === 'dropped' && match(g)), [owned, query, lengthFilter]);
  const favorites = useMemo(
    () => [...owned.filter((g) => g.favorite && match(g)), ...planned.filter((g) => g.favorite)],
    [owned, planned, query, lengthFilter],
  );

  // Upcoming unreleased games across Backlog & Planned
  const unreleasedEntries = useMemo(
    () => getUnreleasedBacklogGames(games, syncLibrary, backlogOn, backlogOff),
    [games, syncLibrary, backlogOn, backlogOff],
  );
  const unreleasedById = useMemo(
    () => new Map(unreleasedEntries.map((entry) => [entry.game.id, entry.release])),
    [unreleasedEntries],
  );

  const allBacklogLane = useMemo(() => owned.filter((g) => g.status === 'backlog'), [owned]);
  const backlogHours = useMemo(
    () =>
      allBacklogLane.reduce((sum, g) => {
        const main = g.hltb?.main ?? 0;
        return main > 0 ? sum + Math.max(0, main - g.playSecs / 3600) : sum;
      }, 0),
    [allBacklogLane],
  );
  const unknown = allBacklogLane.filter((g) => !g.hltb?.main).length;

  const spotlightGame = useMemo(
    () => (spotlightId ? backlog.find((g) => g.id === spotlightId) ?? games.find((g) => g.id === spotlightId) ?? null : null),
    [spotlightId, backlog, games],
  );

  const pickNextGame = () => {
    const pool = backlog.filter((g) => !unreleasedById.has(g.id));
    const candidates = pool.length > 0 ? pool : backlog;
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      setSpotlightId(candidates[0].id);
      return;
    }
    const others = candidates.filter((g) => g.id !== spotlightId);
    const chosen = others[Math.floor(Math.random() * others.length)];
    setSpotlightId(chosen.id);
  };

  const laneTabs: { id: LaneFilter; label: string; count: number }[] = [
    {
      id: 'all',
      label: 'All lanes',
      count: playing.length + backlog.length + planned.length + completed.length + dropped.length,
    },
    { id: 'backlog', label: 'Up next', count: backlog.length },
    { id: 'playing', label: 'Playing now', count: playing.length },
    { id: 'planned', label: 'Wishlist / Planned', count: planned.length },
    { id: 'favorites', label: 'Favorites', count: favorites.length },
    { id: 'completed', label: 'Completed', count: completed.length },
    { id: 'dropped', label: 'Dropped', count: dropped.length },
  ];

  const showCalendarBar = showReleaseCalendar !== false && unreleasedEntries.length > 0;
  const movableBacklog = order === 'mine' && query.trim() === '' && lengthFilter === 'all';

  return (
    <div className={cn(embedded ? 'space-y-5' : 'orbit-page', showCalendarBar && 'pb-6')}>
      {!embedded && (
        <PageHead
          kicker="On the horizon"
          title="Backlog"
          lead="Prioritize what is next, filter by the hours you have free, and track upcoming releases before launch."
          meta={
            <>
              <HeadStat value={allBacklogLane.length} label="up next" />
              {backlogHours > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Hourglass className="size-3.5" />
                  <b>{Math.round(backlogHours)}h</b> remaining
                </span>
              )}
              {unknown > 0 && <span title="HowLongToBeat has no time for these yet">{unknown} unmeasured</span>}
              {allPlanned.length > 0 && <span>{allPlanned.length} planned</span>}
              {unreleasedEntries.length > 0 && (
                <span className="inline-flex items-center gap-1 text-accent">
                  <Calendar className="size-3.5" />
                  <b>{unreleasedEntries.length}</b> upcoming
                </span>
              )}
            </>
          }
        />
      )}

      {/* Smart KPI Overview Strip */}
      <div className="orbit-backlog-kpis">
        <button
          type="button"
          onClick={() => setLaneFilter(laneFilter === 'backlog' ? 'all' : 'backlog')}
          className={cn('orbit-backlog-kpi', laneFilter === 'backlog' && 'is-selected')}
        >
          <span className="orbit-kicker">Up Next Queue</span>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <strong className="orbit-num text-xl font-bold text-fg">{backlog.length}</strong>
            <span className="text-[11.5px] text-muted">
              {movableBacklog ? 'Drag to rank' : ORDERS.find((o) => o.id === order)?.shortLabel}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setShowTimes((v) => !v)}
          className={cn('orbit-backlog-kpi', showTimes && 'is-selected')}
        >
          <span className="orbit-kicker">Main Story Left</span>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <strong className="orbit-num text-xl font-bold text-fg">
              {backlogHours > 0 ? `${Math.round(backlogHours)}h` : '—'}
            </strong>
            <span className="text-[11.5px] text-muted">
              {showTimes ? 'Comparing HLTB' : 'Click for HLTB breakdown'}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setLaneFilter(laneFilter === 'playing' ? 'all' : 'playing')}
          className={cn('orbit-backlog-kpi', laneFilter === 'playing' && 'is-selected')}
        >
          <span className="orbit-kicker">Playing Now</span>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <strong className="orbit-num text-xl font-bold text-fg">{playing.length}</strong>
            <span className="text-[11.5px] text-muted">
              {playing.length === 1 ? 'Active run' : 'Active runs'}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setLaneFilter(laneFilter === 'planned' ? 'all' : 'planned')}
          className={cn('orbit-backlog-kpi', laneFilter === 'planned' && 'is-selected')}
        >
          <span className="orbit-kicker">Planned &amp; Upcoming</span>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <strong className="orbit-num text-xl font-bold text-fg">{allPlanned.length}</strong>
            <span className="text-[11.5px] text-muted">
              {unreleasedEntries.length > 0 ? `${unreleasedEntries.length} unreleased` : 'Wishlist'}
            </span>
          </div>
        </button>
      </div>

      {/* Unified Command Bar */}
      <div className="orbit-backlog-commandbar">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search backlog, studio, genre..."
            className="mr-auto min-w-[210px] flex-1 sm:max-w-xs"
            inputClassName="!w-full"
          />

          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-bg/50 p-1" role="group" aria-label="Filter by story length">
            {LENGTH_FILTERS.map((lf) => (
              <button
                key={lf.id}
                type="button"
                onClick={() => setLengthFilter(lf.id)}
                title={lf.hint}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition',
                  lengthFilter === lf.id
                    ? 'bg-panel2 text-fg shadow-sm'
                    : 'text-muted hover:text-fg',
                )}
              >
                {lf.label}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-line bg-bg/50 p-1" role="group" aria-label="Sort backlog">
            {ORDERS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOrder(o.id)}
                title={o.label}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition',
                  order === o.id ? 'bg-panel2 text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                <o.icon className="size-3.5" />
                <span className="hidden md:inline">{o.label}</span>
                <span className="md:hidden">{o.shortLabel}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowTimes((v) => !v)}
            title="Show Main, + Extras, and 100% HowLongToBeat times on every card"
            aria-pressed={showTimes}
            className={`chip h-[34px] px-3 ${showTimes ? 'is-active' : ''}`}
          >
            <Timer className="size-3.5" />
            Times
          </button>

          {backlog.length > 0 && (
            <button
              type="button"
              onClick={pickNextGame}
              title="Pick a random game from your filtered Up Next queue"
              className="chip h-[34px] px-3"
            >
              <Shuffle className="size-3.5" />
              Pick next
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLibraryQuery('');
                setPicking(true);
              }}
              className="btn-quiet flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm"
              title="Put a library game on this page, including one taken off it"
            >
              <Plus className="size-4" />
              From the library
            </button>
            <button
              type="button"
              onClick={() => setPlanning(true)}
              className={cn(btnAccent, 'flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm')}
              title="Add something you plan to play, even if you do not own it yet"
            >
              <Plus className="size-4" />
              Plan a game
            </button>
          </div>
        </div>

        {/* Lane Tabs */}
        <div className="orbit-backlog-lanes" role="tablist" aria-label="Backlog lanes">
          {laneTabs.map((tab) => {
            if (tab.id !== 'all' && tab.id !== 'backlog' && tab.id !== 'playing' && tab.count === 0 && laneFilter !== tab.id) {
              return null;
            }
            const active = laneFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLaneFilter(tab.id)}
                className={cn('orbit-backlog-lanetab', active && 'is-active')}
              >
                <span>{tab.label}</span>
                <span className="orbit-num orbit-backlog-lanecount">{tab.count}</span>
              </button>
            );
          })}
          {(query.trim() !== '' || lengthFilter !== 'all' || laneFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setLengthFilter('all');
                setLaneFilter('all');
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-panel2 hover:text-fg"
            >
              <X className="size-3" />
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Smart "Pick next" recommendation spotlight */}
      {spotlightGame && (
        <div className="orbit-backlog-spotlight">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <button
              type="button"
              onClick={() => onSelect(spotlightGame.id)}
              className="shrink-0 overflow-hidden rounded-xl border border-line"
            >
              <Cover game={spotlightGame} fit="cover" className="h-20 w-14" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                <Sparkles className="size-3.5" />
                Suggested Next Run
              </div>
              <button
                type="button"
                onClick={() => onSelect(spotlightGame.id)}
                className="mt-0.5 block truncate text-left text-base font-bold text-fg hover:text-accent"
              >
                {spotlightGame.title}
              </button>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                {spotlightGame.meta?.developer && <span>{spotlightGame.meta.developer}</span>}
                {(spotlightGame.hltb?.main ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-fg/90">
                    <Hourglass className="size-3 text-accent" />
                    {spotlightGame.hltb!.main}h main story
                  </span>
                )}
                {(spotlightGame.meta?.genres ?? []).slice(0, 2).map((genre) => (
                  <span key={genre} className="rounded-full border border-line px-2 py-0.5 text-[10.5px]">
                    {genre}
                  </span>
                ))}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!spotlightGame.planned && spotlightGame.status !== 'playing' && (
              <button
                type="button"
                onClick={() => {
                  onStatus(spotlightGame.id, 'playing');
                  setSpotlightId(null);
                }}
                className={cn(btnAccent, 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs')}
              >
                <Play className="size-3.5" />
                Move to Playing
              </button>
            )}
            <button
              type="button"
              onClick={pickNextGame}
              className="btn-quiet flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
            >
              <Shuffle className="size-3.5" />
              Another
            </button>
            <button
              type="button"
              onClick={() => setSpotlightId(null)}
              aria-label="Dismiss suggestion"
              className="grid size-7 place-items-center rounded-lg border border-line text-muted hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* HLTB comparison bar */}
      {showTimes && backlog.length > 0 && (
        <div className="orbit-backlogtimes">
          {(() => {
            const measured = backlog.filter((g) => (g.hltb?.main ?? 0) > 0);
            const hours = measured.map((g) => g.hltb!.main);
            const left = measured.reduce((sum, g) => sum + Math.max(0, g.hltb!.main - g.playSecs / 3600), 0);
            return (
              <>
                <span className="text-muted">
                  {measured.length} of {backlog.length} have times
                </span>
                {hours.length > 0 && (
                  <>
                    <span>
                      shortest <b className="font-mono">{Math.min(...hours)}h</b>
                    </span>
                    <span>
                      longest <b className="font-mono">{Math.max(...hours)}h</b>
                    </span>
                    <span>
                      left in total <b className="font-mono">{Math.round(left)}h</b>
                    </span>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Add from Library modal with instant search */}
      {picking && (
        <Modal
          title="From the library"
          subtitle="These stay in the Library. Taking one off the Backlog later does not delete it."
          size="lg"
          onClose={() => setPicking(false)}
        >
          {fromLibrary.length === 0 ? (
            <p className="text-sm text-muted">Every library game that can sit here is already on the page.</p>
          ) : (
            <div className="space-y-3">
              {fromLibrary.length > 5 && (
                <SearchField
                  value={libraryQuery}
                  onChange={setLibraryQuery}
                  placeholder="Filter library games..."
                  inputClassName="!w-full"
                />
              )}
              <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
                {filteredFromLibrary.map((game) => (
                  <li key={game.id}>
                    <button
                      type="button"
                      onClick={() => onBacklogMembership(game.id, true)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-panel2"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Cover game={game} className="h-12 w-9 shrink-0 rounded-md" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-fg">{game.title}</div>
                          <div className="flex items-center gap-2 text-xs text-muted">
                            <span>{fmtMinutes(game.playSecs / 60)} played</span>
                            {(game.hltb?.main ?? 0) > 0 && <span>· {game.hltb!.main}h main</span>}
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-fg">
                        <Plus className="size-3.5 text-accent" />
                        Add
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}

      {planning && (
        <PlanDialog
          games={games}
          initialQuery={query}
          onAdd={plan}
          onClose={() => setPlanning(false)}
        />
      )}

      {planRemovalTarget && (
        <ConfirmDialog
          title={`Remove ${planRemovalTarget.title} from the Backlog?`}
          description="This removes only the planned entry. It does not delete or change any game in your Library."
          confirmLabel="Remove planned game"
          onCancel={() => setPlanRemovalTarget(null)}
          onConfirm={() => {
            const target = planRemovalTarget;
            setPlanRemovalTarget(null);
            onRemove(target.id);
          }}
        />
      )}

      {releaseEditGame && (
        <ReleaseDateDialog
          game={releaseEditGame}
          onClose={() => setReleaseEditGame(null)}
          onSave={(releaseDate, comingSoon, releaseYear) => {
            const g = releaseEditGame;
            setReleaseEditGame(null);
            onUpdate(g.id, {
              meta: {
                summary: g.meta?.summary ?? '',
                genres: g.meta?.genres ?? [],
                developer: g.meta?.developer ?? '',
                rating: g.meta?.rating ?? null,
                ...g.meta,
                edited: true,
                releaseYear,
                releaseDate,
                comingSoon,
              },
            });
          }}
        />
      )}

      {/* Lanes */}
      <div className="space-y-6">
        {(laneFilter === 'all' ? playing.length > 0 : laneFilter === 'playing') && (
          <Section
            title="Playing now"
            subtitle="Active runs currently in progress"
            icon={Play}
            games={playing}
            empty="Nothing part-way through right now."
            onSelect={onSelect}
            onEdit={onEdit}
            onStatus={onStatus}
            onEditRelease={setReleaseEditGame}
            unreleasedById={unreleasedById}
            movable={false}
            showTimes={showTimes}
          />
        )}

        {(laneFilter === 'all' || laneFilter === 'backlog') && (
          <Section
            title="Backlog"
            subtitle={movableBacklog ? 'Drag cards to set the exact order you want to play next' : 'Ordered by your active filter'}
            icon={CircleDashed}
            games={backlog}
            empty="Nothing on the Backlog. Plan a game, or add one from the Library."
            onSelect={onSelect}
            onEdit={onEdit}
            onStatus={onStatus}
            onEditRelease={setReleaseEditGame}
            unreleasedById={unreleasedById}
            movable={movableBacklog}
            ranked={order === 'mine'}
            onMove={move}
            showTimes={showTimes}
          />
        )}

        {(laneFilter === 'all' ? planned.length > 0 : laneFilter === 'planned') && (
          <Section
            title="Not owned yet"
            subtitle="Planned pickups and upcoming wishlist releases"
            icon={Plus}
            games={planned}
            empty="Nothing written down that you do not own."
            onSelect={onSelect}
            onEdit={onEdit}
            onStatus={onStatus}
            onEditRelease={setReleaseEditGame}
            unreleasedById={unreleasedById}
            movable={false}
            notOwned
            showTimes={showTimes}
            onOwned={(id) => onUpdate(id, { planned: false, status: 'backlog' })}
            onRemove={(id) => {
              const game = games.find((g) => g.id === id);
              if (game) setPlanRemovalTarget(game);
            }}
          />
        )}

        {(laneFilter === 'all' ? favorites.length > 0 : laneFilter === 'favorites') && (
          <Section
            title="Favorites"
            subtitle="Starred titles across your Backlog and Planned shelf"
            icon={Star}
            games={favorites}
            empty="No favorites in your Backlog yet."
            onSelect={onSelect}
            onEdit={onEdit}
            onStatus={onStatus}
            onEditRelease={setReleaseEditGame}
            unreleasedById={unreleasedById}
            movable={false}
            readOnlyMoves
            showTimes={showTimes}
          />
        )}

        {(laneFilter === 'all' ? completed.length > 0 : laneFilter === 'completed') && (
          <Section
            title="Completed"
            subtitle="Finished runs kept on your Backlog board"
            icon={CircleCheck}
            games={completed}
            empty="Nothing finished yet."
            onSelect={onSelect}
            onEdit={onEdit}
            onStatus={onStatus}
            onEditRelease={setReleaseEditGame}
            unreleasedById={unreleasedById}
            movable={false}
            showTimes={showTimes}
          />
        )}

        {(laneFilter === 'all' ? dropped.length > 0 : laneFilter === 'dropped') && (
          <Section
            title="Dropped"
            subtitle="Games set aside for good or for later"
            icon={SquareArrowRight}
            games={dropped}
            empty="Nothing dropped."
            onSelect={onSelect}
            onEdit={onEdit}
            onStatus={onStatus}
            onEditRelease={setReleaseEditGame}
            unreleasedById={unreleasedById}
            movable={false}
            showTimes={showTimes}
          />
        )}
      </div>

      {/* Steam Personal Calendar-style Upcoming Release Bottom Bar */}
      {showCalendarBar && (
        <PersonalReleaseCalendarBar
          entries={unreleasedEntries}
          onSelectGame={(id) => onSelect(id)}
          onEditRelease={setReleaseEditGame}
        />
      )}
    </div>
  );
}

const MOVES: { status: GameStatus; label: string; icon: typeof Play }[] = [
  { status: 'playing', label: 'Playing', icon: Play },
  { status: 'backlog', label: 'Backlog', icon: Undo2 },
  { status: 'completed', label: 'Completed', icon: CircleCheck },
  { status: 'dropped', label: 'Dropped', icon: SquareArrowRight },
];

function Section({
  title,
  subtitle,
  icon: Icon,
  games,
  empty,
  onSelect,
  onEdit,
  onStatus,
  onEditRelease,
  unreleasedById,
  movable,
  ranked = false,
  onMove,
  onRemove,
  onOwned,
  notOwned,
  readOnlyMoves,
  showTimes,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Play;
  games: Game[];
  empty: string;
  onSelect: (id: string, readOnlyMoves?: boolean) => void;
  onEdit: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  onEditRelease: (game: Game) => void;
  unreleasedById: Map<string, ReturnType<typeof parseGameRelease>>;
  movable: boolean;
  ranked?: boolean;
  onMove?: (fromId: string, toId: string, after: boolean) => void;
  onRemove?: (id: string) => void;
  onOwned?: (id: string) => void;
  notOwned?: boolean;
  readOnlyMoves?: boolean;
  showTimes?: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  const { bind, dragging } = useDragReorder(
    movable && onMove ? onMove : undefined,
    { container: list, grid: true },
  );

  return (
    <section className="orbit-backlog-section">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-muted">
          <Icon className="size-3.5 text-accent" />
          <span>{title}</span>
          <span className="orbit-num rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] tracking-normal text-fg">
            {games.length}
          </span>
        </h2>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>

      {games.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-4 py-8 text-center text-sm text-muted">
          {empty}
        </div>
      ) : (
        <ul ref={list} className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((g, index) => {
            const main = g.hltb?.main ?? 0;
            const left = Math.max(0, main - g.playSecs / 3600);
            const pct = main > 0 ? Math.min(100, (g.playSecs / 3600 / main) * 100) : 0;
            const isNotOwned = notOwned || g.planned === true;
            const upcoming = unreleasedById.get(g.id);

            return (
              <li
                key={g.id}
                data-orbit-game={g.id}
                data-orbit-no-move={readOnlyMoves ? '' : undefined}
                {...bind(g.id)}
                className={cn(
                  'orbit-backlog-card group flex items-center gap-3 rounded-2xl border border-line bg-panel p-3 transition duration-150 hover:border-muted/55',
                  movable && 'cursor-grab active:cursor-grabbing',
                  dragging === g.id && 'opacity-95',
                )}
              >
                {movable ? (
                  <button
                    type="button"
                    data-orbit-drag-handle=""
                    aria-label={`Drag ${g.title} to rearrange`}
                    title="Drag to rearrange"
                    className="grid size-8 shrink-0 touch-none cursor-grab place-items-center rounded-lg border border-accent/35 bg-accent/10 text-accent shadow-sm transition hover:border-accent hover:bg-accent/20 active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </button>
                ) : (
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-xs font-semibold text-muted/55"
                    aria-hidden="true"
                  >
                    {ranked ? `#${index + 1}` : <GripVertical className="size-4 opacity-40" />}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onSelect(g.id, readOnlyMoves === true)}
                  className="relative shrink-0 overflow-hidden rounded-xl border border-line/70"
                  title={`Open ${g.title}`}
                >
                  <Cover game={g} fit="cover" className="h-28 w-[4.5rem] shrink-0 rounded-lg transition duration-200 group-hover:scale-105 [&_span]:text-sm" />
                  {ranked && movable && (
                    <span className="orbit-num absolute left-1 top-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                      #{index + 1}
                    </span>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelect(g.id, readOnlyMoves === true)}
                      className="block max-w-full truncate rounded-lg text-left text-[14px] font-semibold leading-tight text-fg hover:text-accent"
                    >
                      {g.title}
                    </button>
                  </div>

                  {g.meta?.developer && (
                    <div className="mt-0.5 truncate text-[11.5px] text-muted/85">
                      {g.meta.developer}
                    </div>
                  )}

                  {isNotOwned ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] leading-snug text-muted">
                      {g.planPlatform && (
                        <span className="rounded-md border border-line bg-bg/60 px-1.5 py-0.5 text-[10.5px] font-medium text-fg/85">
                          {g.planPlatform}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditRelease(g);
                        }}
                        title="Set or update release date"
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium transition',
                          upcoming
                            ? 'border-accent/40 bg-accent/12 text-accent hover:border-accent'
                            : 'border-line bg-bg/45 text-muted hover:border-muted hover:text-fg',
                        )}
                      >
                        <Calendar className="size-3" />
                        {upcoming
                          ? `${upcoming.label} · ${fmtCountdown(upcoming.daysUntil, 'Upcoming')}`
                          : g.meta?.releaseDate || (g.meta?.releaseYear ? String(g.meta.releaseYear) : 'Set release date')}
                      </button>
                      {main > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
                          <Hourglass className="size-3" />
                          {main}h
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-snug text-muted">
                      <span>{fmtMinutes(g.playSecs / 60)} played</span>
                      {!onDisk(g) && (
                        <span className="rounded-md border border-dashed border-line px-1.5 py-0.5 text-[10px]">
                          no folder yet
                        </span>
                      )}
                      {upcoming && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditRelease(g);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/12 px-1.5 py-0.5 text-[10.5px] font-medium text-accent hover:border-accent"
                          title="Edit upcoming release date"
                        >
                          <Calendar className="size-3" />
                          {upcoming.label}
                        </button>
                      )}
                      {g.lastPlayed && !upcoming && <span>· {fmtDate(g.lastPlayed)}</span>}
                      {main > 0 && (
                        <span
                          className="inline-flex items-center gap-1 font-medium text-fg/85"
                          title={`HowLongToBeat: ${main}h for the main story`}
                        >
                          <Hourglass className="size-3 text-accent" />
                          {left > 0.5 ? `${Math.round(left)}h left` : 'almost done'}
                        </span>
                      )}
                    </div>
                  )}

                  {main > 0 && !isNotOwned && (
                    <div
                      className="orbit-rail mt-2"
                      title={`${Math.round(pct)}% of the main story`}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}

                  {showTimes && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(
                        [
                          ['Main', g.hltb?.main ?? 0, 'var(--c-accent2)'],
                          ['+ Extras', g.hltb?.mainExtra ?? 0, 'var(--c-accent)'],
                          ['100%', g.hltb?.completionist ?? 0, '#e0855f'],
                        ] as const
                      ).map(([label, hours, colour]) => (
                        <span
                          key={label}
                          title={`${label}: ${hours > 0 ? `${hours} hours` : 'no time known'}`}
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            color: hours > 0 ? colour : undefined,
                            background: hours > 0 ? `color-mix(in srgb, ${colour} 15%, transparent)` : 'transparent',
                            border: hours > 0 ? 'none' : '1px dashed var(--c-border)',
                          }}
                        >
                          {label} {hours > 0 ? `${hours}h` : '?'}
                        </span>
                      ))}
                    </div>
                  )}
                  {showTimes && <HltbExtraEstimate hours={g.hltb?.mainExtra ?? 0} className="mt-1" />}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {!readOnlyMoves && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(g.id);
                      }}
                      title={`Edit ${g.title}`}
                      aria-label={`Edit ${g.title}`}
                      className="grid size-7 place-items-center rounded-md border border-line bg-panel text-muted opacity-100 transition hover:border-accent hover:text-accent sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                  {readOnlyMoves ? null : isNotOwned ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onOwned?.(g.id)}
                        title="Mark as owned and add it to the Backlog"
                        aria-label={`Mark ${g.title} as owned and add it to the Backlog`}
                        className="rounded-md border border-line bg-panel p-1.5 text-muted transition hover:border-accent hover:text-accent"
                      >
                        <Check className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove?.(g.id)}
                        title="Take this off the list"
                        aria-label={`Take ${g.title} off the list`}
                        className="rounded-md border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 transition hover:border-rose-400 hover:bg-rose-500/20 hover:text-rose-200"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-1">
                      {MOVES.filter((m) => m.status !== g.status).map((m) => (
                        <button
                          key={m.status}
                          type="button"
                          onClick={() => onStatus(g.id, m.status)}
                          title={`Move to ${m.label}`}
                          aria-label={`Move ${g.title} to ${m.label}`}
                          className="rounded-md border border-line bg-panel p-1.5 text-muted transition hover:border-accent hover:text-accent"
                        >
                          <m.icon className="size-3.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Lightweight dialog to set or adjust a game's upcoming release date (exact date,
 * window like "Q2 2027" / "Coming soon", or already released).
 */
function ReleaseDateDialog({
  game,
  onClose,
  onSave,
}: {
  game: Game;
  onClose: () => void;
  onSave: (releaseDate: string | null, comingSoon: boolean, releaseYear: number | null) => void;
}) {
  const parsed = useMemo(() => parseGameRelease(game), [game]);
  const initialIso = parsed.isoDay ?? '';
  const initialWindow = !parsed.isoDay ? (game.meta?.releaseDate ?? '') : '';

  const [mode, setMode] = useState<'exact' | 'tba' | 'released'>(
    parsed.isoDay ? 'exact' : parsed.unreleased ? 'tba' : 'exact',
  );
  const [isoDate, setIsoDate] = useState(initialIso);
  const [windowLabel, setWindowLabel] = useState(initialWindow || 'Coming soon');

  return (
    <Modal
      title={`Release schedule · ${game.title}`}
      subtitle="Games marked upcoming appear in your Personal Release Calendar at the bottom of the Backlog."
      size="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['exact', 'Exact Date'],
              ['tba', 'Window / TBA'],
              ['released', 'Already Out'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                'rounded-xl border px-3 py-2 text-xs font-semibold transition',
                mode === id
                  ? 'border-accent bg-accent/15 text-fg'
                  : 'border-line bg-panel2/50 text-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'exact' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Release day</span>
            <input
              type="date"
              value={isoDate}
              onChange={(e) => setIsoDate(e.target.value)}
              className="orbit-input w-full"
            />
          </label>
        )}

        {mode === 'tba' && (
          <div className="space-y-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted">Release window</span>
              <input
                type="text"
                value={windowLabel}
                onChange={(e) => setWindowLabel(e.target.value)}
                placeholder="e.g. Coming soon, Q1 2027, Late 2027"
                className="orbit-input w-full"
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {['Coming soon', 'TBA', 'Q1 2027', 'Q2 2027', '2027'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setWindowLabel(preset)}
                  className="rounded-lg border border-line bg-panel2/60 px-2.5 py-1 text-xs text-muted hover:text-fg"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'released' && (
          <p className="rounded-xl border border-line bg-panel2/40 p-3 text-xs leading-relaxed text-muted">
            Marks <b>{game.title}</b> as already released so it no longer appears in the upcoming release calendar.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-quiet rounded-lg px-3.5 py-2 text-xs">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode === 'released') {
                onSave(null, false, game.meta?.releaseYear ?? null);
                return;
              }
              if (mode === 'exact' && isoDate) {
                const [y, m, d] = isoDate.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                const formatted = dt.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const today = new Date();
                const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                onSave(formatted, dt.getTime() > todayMidnight.getTime(), y);
                return;
              }
              const trimmed = windowLabel.trim() || 'Coming soon';
              const yearMatch = /\b(20\d{2})\b/.exec(trimmed);
              onSave(trimmed, true, yearMatch ? Number(yearMatch[1]) : game.meta?.releaseYear ?? null);
            }}
            className={cn(btnAccent, 'rounded-lg px-4 py-2 text-xs')}
          >
            Save schedule
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Steam Labs Personal Calendar-inspired bottom bar for unreleased Backlog games.
 * Supports both a Monday-Sunday Month Grid with cover-art day cells and a
 * compact chronological Release Timeline strip, plus collapsible docking.
 */
function PersonalReleaseCalendarBar({
  entries,
  onSelectGame,
  onEditRelease,
}: {
  entries: UpcomingBacklogEntry[];
  onSelectGame: (id: string) => void;
  onEditRelease: (game: Game) => void;
}) {
  const datedEntries = useMemo(() => entries.filter((e) => e.release.exactDate !== null), [entries]);
  const tbaEntries = useMemo(() => entries.filter((e) => e.release.exactDate === null), [entries]);

  // Default calendar month to the earliest upcoming exact release, or current month
  const initialAnchor = datedEntries[0]?.release.exactDate ?? new Date();
  const [viewYear, setViewYear] = useState(initialAnchor.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialAnchor.getMonth());
  const [mode, setMode] = useState<'calendar' | 'timeline'>(datedEntries.length > 0 ? 'calendar' : 'timeline');
  const [collapsed, setCollapsed] = useState(false);

  // Distinct months that have exact releases, for one-click Steam-style month jumping
  const releaseMonths = useMemo(() => {
    const map = new Map<string, { year: number; month: number; label: string; count: number }>();
    for (const entry of datedEntries) {
      const d = entry.release.exactDate!;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          year: d.getFullYear(),
          month: d.getMonth(),
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [datedEntries]);

  const cells = useMemo(
    () => buildPersonalCalendarGrid(viewYear, viewMonth, datedEntries),
    [viewYear, viewMonth, datedEntries],
  );

  // Compact mode keeps only weeks in the viewed month that matter (or all 4-5 weeks of the month)
  const monthTitle = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const stepMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const nextUp = entries[0];

  return (
    <section
      role="region"
      aria-label="Upcoming Release Calendar"
      data-orbit-release-calendar=""
      className={cn('orbit-release-bar', collapsed && 'is-collapsed')}
    >
      {/* Top Bar Header */}
      <div className="orbit-release-head">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="orbit-release-icon">
            <CalendarDays className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold tracking-tight text-fg">Personal Release Calendar</span>
              <span className="orbit-num rounded-full border border-accent/40 bg-accent/14 px-2 py-0.5 text-[10.5px] font-bold text-accent">
                {entries.length} upcoming
              </span>
            </div>
          </div>

          {nextUp && (
            <button
              type="button"
              onClick={() => onSelectGame(nextUp.game.id)}
              className="hidden items-center gap-2 rounded-full border border-line bg-bg/60 px-3 py-1 text-xs text-muted transition hover:border-accent/50 hover:text-fg lg:inline-flex"
            >
              <span>Next release:</span>
              <strong className="max-w-[180px] truncate font-semibold text-fg">{nextUp.game.title}</strong>
              <span className="orbit-num text-accent">
                {nextUp.release.label} ({fmtCountdown(nextUp.release.daysUntil, 'TBA')})
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!collapsed && (
            <div className="flex rounded-lg border border-line bg-bg/60 p-0.5">
              <button
                type="button"
                onClick={() => setMode('calendar')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition',
                  mode === 'calendar' ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg',
                )}
              >
                <LayoutGrid className="size-3.5" />
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setMode('timeline')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition',
                  mode === 'timeline' ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg',
                )}
              >
                <ListFilter className="size-3.5" />
                Lineup
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand upcoming release calendar' : 'Collapse upcoming release calendar'}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg/60 px-2.5 py-1 text-xs text-muted transition hover:border-muted hover:text-fg"
          >
            {collapsed ? (
              <>
                <span>Show</span>
                <ChevronUp className="size-3.5" />
              </>
            ) : (
              <>
                <span>Minimize</span>
                <ChevronDown className="size-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="orbit-release-body">
          {mode === 'calendar' ? (
            <div className="orbit-pcal-layout">
              <div className="min-w-0 flex-1">
                {/* Steam Personal Calendar Month Navigation + Active Release Month Chips */}
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => stepMonth(-1)}
                      aria-label="Previous month"
                      className="grid size-7 place-items-center rounded-lg border border-line bg-bg/60 text-muted hover:border-muted hover:text-fg"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-[132px] text-center text-xs font-bold uppercase tracking-[0.14em] text-fg">
                      {monthTitle}
                    </span>
                    <button
                      type="button"
                      onClick={() => stepMonth(1)}
                      aria-label="Next month"
                      className="grid size-7 place-items-center rounded-lg border border-line bg-bg/60 text-muted hover:border-muted hover:text-fg"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>

                  {releaseMonths.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {releaseMonths.map((rm) => {
                        const active = rm.year === viewYear && rm.month === viewMonth;
                        return (
                          <button
                            key={`${rm.year}-${rm.month}`}
                            type="button"
                            onClick={() => {
                              setViewYear(rm.year);
                              setViewMonth(rm.month);
                            }}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
                              active
                                ? 'border-accent bg-accent/16 text-accent'
                                : 'border-line bg-bg/50 text-muted hover:text-fg',
                            )}
                          >
                            <span>{rm.label}</span>
                            <span className="orbit-num opacity-80">({rm.count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Weekday Headers (Monday -> Sunday, Steam Personal Calendar style) */}
                <div className="orbit-pcal-weekdays">
                  {WEEKDAYS.map((day) => (
                    <div key={day} className="orbit-pcal-weekday">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Month Day Grid */}
                <div className="orbit-pcal-grid">
                  {cells.map((cell) => {
                    const hasReleases = cell.entries.length > 0;
                    const primary = cell.entries[0];
                    return (
                      <div
                        key={cell.isoDay}
                        className={cn(
                          'orbit-pcal-cell',
                          !cell.inMonth && 'is-outside',
                          cell.isToday && 'is-today',
                          hasReleases && 'has-release',
                        )}
                      >
                        <div className="orbit-pcal-daynum orbit-num">
                          <span>{cell.date.getDate()}</span>
                          {cell.isToday && <i className="orbit-pcal-todaytag">Today</i>}
                        </div>

                        {primary && (
                          <div className="orbit-pcal-releases">
                            {cell.entries.slice(0, 2).map((item) => (
                              <button
                                key={item.game.id}
                                type="button"
                                onClick={() => onSelectGame(item.game.id)}
                                title={`${item.game.title} — ${item.release.label}`}
                                className="orbit-pcal-gamepill group"
                              >
                                <Cover
                                  game={item.game}
                                  fit="cover"
                                  className="h-7 w-5 shrink-0 rounded-[4px]"
                                />
                                <div className="min-w-0 flex-1 text-left">
                                  <div className="truncate text-[11px] font-semibold leading-tight text-fg group-hover:text-accent">
                                    {item.game.title}
                                  </div>
                                  <div className="orbit-num text-[9.5px] text-accent">
                                    {fmtCountdown(item.release.daysUntil, 'Soon')}
                                  </div>
                                </div>
                              </button>
                            ))}
                            {cell.entries.length > 2 && (
                              <span className="px-1 text-[10px] font-semibold text-muted">
                                +{cell.entries.length - 2} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* TBA / Unannounced Exact Day Tray */}
              {tbaEntries.length > 0 && (
                <div className="orbit-pcal-tba">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="orbit-kicker">Coming Soon / TBA</span>
                    <span className="orbit-num text-[11px] text-muted">{tbaEntries.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {tbaEntries.map(({ game, release }) => (
                      <div key={game.id} className="orbit-pcal-tbaitem">
                        <button
                          type="button"
                          onClick={() => onSelectGame(game.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <Cover game={game} fit="cover" className="h-10 w-7 shrink-0 rounded-md" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold text-fg hover:text-accent">
                              {game.title}
                            </div>
                            <div className="text-[11px] text-muted">{release.label || 'Coming soon'}</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditRelease(game)}
                          title="Set release date"
                          aria-label={`Set release date for ${game.title}`}
                          className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-accent"
                        >
                          <Calendar className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Chronological Steam Personal Release Lineup Strip */
            <div className="orbit-pcal-strip">
              {entries.map(({ game, release }) => {
                const exact = release.exactDate;
                const monthShort = exact
                  ? exact.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
                  : 'TBA';
                const dayNum = exact ? String(exact.getDate()) : '—';
                const dow = exact ? exact.toLocaleDateString('en-US', { weekday: 'short' }) : release.label;

                return (
                  <div key={game.id} className="orbit-pcal-stripcard">
                    <div className="orbit-pcal-datebadge">
                      <span className="text-[9.5px] font-bold tracking-[0.14em] text-accent">{monthShort}</span>
                      <strong className="orbit-num text-lg font-extrabold leading-none text-fg">{dayNum}</strong>
                      <span className="truncate text-[10px] text-muted">{dow}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectGame(game.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <Cover game={game} fit="cover" className="h-14 w-10 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-fg hover:text-accent">
                          {game.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          <span className="orbit-num font-semibold text-accent">
                            {fmtCountdown(release.daysUntil, release.label)}
                          </span>
                          {game.planPlatform && <span>· {game.planPlatform}</span>}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditRelease(game)}
                      title="Edit release date"
                      aria-label={`Edit release date for ${game.title}`}
                      className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-accent"
                    >
                      <Pencil className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
