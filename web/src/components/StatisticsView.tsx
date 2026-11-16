import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3, BookOpen, CalendarDays, Clock, FolderOpen, Gamepad2, Images, ListOrdered,
  NotebookPen, Play, Trash2, Trophy,
} from 'lucide-react';
import type { Game, GameStatus, Session, Settings } from '../types';
import {
  listSessions, overlayDelete, overlayGallery, revealInExplorer, type GalleryItem,
} from '../services/native';
import { fmtMinutes } from '../utils/format';
import { onBacklogPage } from '../utils/library';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { CaptureViewerModal } from './ui/CaptureViewerModal';
import { CAPTURE_KINDS, CAPTURE_LABELS, CaptureThumb, captureCounts, captureFolderName, isCaptureKind, type CaptureKind } from './Captures';
import { SessionsView } from './SessionsView';
import { BacklogView } from './BacklogView';
import { LogsView } from './LogsView';
import { ContextMenu, type MenuItem } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';

type Period = 'week' | 'fortnight' | 'month' | 'year' | 'all';
export type StatsTab = 'overview' | 'sessions' | 'album' | 'journal' | 'backlog';

const PERIOD_LABEL: Record<Period, string> = {
  week: 'in the last 7 days',
  fortnight: 'in the last 14 days',
  month: 'in the last 30 days',
  year: 'in the last year',
  all: 'all time',
};

function periodStart(period: Period, now: number): number {
  const todays = startOfDay(now);
  if (period === 'week') return todays - 6 * DAY;
  if (period === 'fortnight') return todays - 13 * DAY;
  if (period === 'month') return todays - 29 * DAY;
  if (period === 'year') return todays - 364 * DAY;
  return 0;
}

function isDailyPeriod(period: Period): boolean {
  return period === 'week' || period === 'fortnight' || period === 'month';
}

const DAY = 86_400;

/**
 * When a capture was taken, in the shortest form that is still exact enough.
 *
 * Today and yesterday are said as words, because a date under a picture taken
 * ten minutes ago is noise; anything older gets its day, and a year only when it
 * is not this one.
 */
/** A capture's file size, from what the gallery reported. */
function sizeOf(item: GalleryItem): string {
  const bytes = item.bytes ?? 0;
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function whenOf(item: GalleryItem): string {
  if (!item.at) return '';
  const then = new Date(item.at * 1000);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay(then, now)) return `Today, ${time}`;
  if (sameDay(then, yesterday)) return `Yesterday, ${time}`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return `${then.toLocaleDateString([], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
}
const STATUS_COLOUR: Record<GameStatus, string> = {
  playing: '#5fc99a',
  completed: 'var(--c-accent)',
  dropped: 'var(--c-muted)',
  backlog: 'var(--c-accent2)',
};

function startOfDay(unixSeconds: number): number {
  const date = new Date(unixSeconds * 1000);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
}

function dayKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Color-blind-checked high-separation series so adjacent games are unmistakable. */
const CHART_SERIES = [
  '#3987e5', // cobalt
  '#e06332', // coral
  '#1db584', // emerald
  '#eab308', // amber
  '#e0528a', // rose
  '#9b87f5', // violet
  '#22d3ee', // cyan
  '#a3e635', // lime
] as const;

const OTHER_SERIES_COLOUR = 'color-mix(in srgb, var(--c-text) 28%, transparent)';

function seriesColour(id: string, topIds: string[]): string {
  if (id === 'other') return OTHER_SERIES_COLOUR;
  const idx = topIds.indexOf(id);
  return idx >= 0 ? CHART_SERIES[idx % CHART_SERIES.length] : OTHER_SERIES_COLOUR;
}

function niceAxisCeiling(maxSecs: number): number {
  if (maxSecs <= 0) return 3600;
  const mins = maxSecs / 60;
  const steps = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 960, 1440];
  for (const step of steps) {
    if (mins <= step) return step * 60;
  }
  const hours = Math.ceil(maxSecs / 3600);
  const niceHourStep = hours <= 40 ? 5 : hours <= 100 ? 10 : hours <= 250 ? 25 : 50;
  return Math.ceil(hours / niceHourStep) * niceHourStep * 3600;
}

function fmtAxisTick(secs: number): string {
  if (secs <= 0) return '0';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = secs / 3600;
  return Number.isInteger(hrs) ? `${hrs}h` : `${hrs.toFixed(1)}h`;
}

interface Bin {
  key: string;
  label: string;
  shortLabel: string;
  isToday?: boolean;
  total: number;
  /** Per game, ordered consistently by series rank for clean stacked bands. */
  parts: { id: string; secs: number }[];
}

/**
 * One bar chart's worth of sessions, bucketed by the period.
 *
 * A month is read by day, a year by month, and everything by year, which is
 * the only grouping that stays honest over an arbitrary span. Games outside
 * the eight biggest of the period are folded into one neutral band so the chart
 * stays legible rather than a patchwork.
 */
function buildBins(sessions: Session[], period: Period, now: number): { bins: Bin[]; topIds: string[] } {
  const todays = startOfDay(now);
  const since = periodStart(period, now);
  const usable = sessions.filter((row) => row.startedAt >= since && row.durationSecs > 0);

  const totals = new Map<string, number>();
  for (const row of usable) totals.set(row.gameId, (totals.get(row.gameId) ?? 0) + row.durationSecs);
  const topIds = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, CHART_SERIES.length).map(([id]) => id);
  const kept = new Set(topIds);
  const seriesOrder = new Map<string, number>(topIds.map((id, idx) => [id, idx]));
  seriesOrder.set('other', topIds.length + 1);

  const startMs = new Date((period === 'all' && usable.length > 0 ? Math.min(...usable.map((row) => row.startedAt)) : since) * 1000);
  const bins: Bin[] = [];

  if (isDailyPeriod(period)) {
    const daySpan = period === 'week' ? 7 : period === 'fortnight' ? 14 : 30;
    for (let index = daySpan - 1; index >= 0; index -= 1) {
      const start = todays - index * DAY;
      const date = new Date(start * 1000);
      const shortLabel =
        index === 0
          ? 'Today'
          : period === 'week'
            ? date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
            : period === 'fortnight'
              ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : date.getDate() === 1
                ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : String(date.getDate());
      bins.push({
        key: String(start),
        label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        shortLabel,
        isToday: index === 0,
        total: 0,
        parts: [],
      });
    }
  } else if (period === 'year') {
    const nowDate = new Date(now * 1000);
    for (let index = 11; index >= 0; index -= 1) {
      const start = new Date(nowDate.getFullYear(), nowDate.getMonth() - index, 1).getTime() / 1000;
      const d = new Date(start * 1000);
      bins.push({
        key: String(start),
        label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        shortLabel: d.toLocaleDateString(undefined, { month: 'short' }),
        isToday: index === 0,
        total: 0,
        parts: [],
      });
    }
  } else {
    const firstYear = startMs.getFullYear();
    const lastYear = new Date(now * 1000).getFullYear();
    const from = Math.min(firstYear, lastYear);
    for (let year = from; year <= lastYear; year += 1) {
      bins.push({
        key: String(year),
        label: String(year),
        shortLabel: String(year),
        isToday: year === lastYear,
        total: 0,
        parts: [],
      });
    }
  }

  const byPart = bins.map(() => new Map<string, number>());

  for (const row of usable) {
    const index = isDailyPeriod(period)
      ? bins.findIndex((bin) => Number(bin.key) === startOfDay(row.startedAt))
      : period === 'year'
        ? (() => {
            const date = new Date(row.startedAt * 1000);
            const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000;
            return bins.findIndex((bin) => Number(bin.key) === start);
          })()
        : bins.findIndex((bin) => Number(bin.key) === new Date(row.startedAt * 1000).getFullYear());
    if (index < 0) continue;
    const id = kept.has(row.gameId) ? row.gameId : 'other';
    byPart[index].set(id, (byPart[index].get(id) ?? 0) + row.durationSecs);
    bins[index].total += row.durationSecs;
  }

  bins.forEach((bin, index) => {
    bin.parts = [...byPart[index].entries()]
      .map(([id, secs]) => ({ id, secs }))
      .sort((a, b) => (seriesOrder.get(a.id) ?? 99) - (seriesOrder.get(b.id) ?? 99));
  });

  return { bins, topIds };
}

/**
 * Statistics: the whole library's time in one place.
 *
 * The Overview answers the three questions a player actually has - how much
 * have I played, what was it, and when - in that order: the period's total in
 * the top game's own art, the shape of the period as a chart, then the games
 * that made it. Sessions, Journal and Backlog are the same rooms as ever,
 * folded in here rather than repeated in the menu.
 */
/** A panel of the page: a title, a line about it, and whatever it holds. */
function SectionPanel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="orbit-stats-panel">
      <div className="orbit-stats-panel-head">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function StatisticsView({
  games,
  journalGames,
  allGames,
  settings,
  setSettings,
  onChanged,
  onOpenGame,
  onEditGame,
  onUpdate,
  onAddPlanned,
  onRemove,
  onBacklogStatus,
  onBacklogMembership,
  onJournalMembership,
  fetchMetadata,
  tab,
  onTab,
}: {
  /** The library as the app reads it, live session included. */
  games: Game[];
  journalGames: Game[];
  allGames: Game[];
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  onChanged: () => void;
  onOpenGame: (id: string) => void;
  onEditGame: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onAddPlanned: (game: Game) => void;
  onRemove: (id: string) => void;
  onBacklogStatus: (id: string, status: GameStatus) => void;
  onBacklogMembership: (id: string, on: boolean) => void;
  onJournalMembership: (id: string, on: boolean) => void;
  fetchMetadata: boolean;
  /** Which room is open, so the palette can land straight on the Album. */
  tab: StatsTab;
  onTab: (tab: StatsTab) => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const [playNextSeed, setPlayNextSeed] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [captures, setCaptures] = useState<GalleryItem[] | null>(null);
  const [albumKind, setAlbumKind] = useState<CaptureKind | 'all'>('all');
  /** One game's captures, by capture folder, or every game's. */
  const [albumGame, setAlbumGame] = useState<string | 'all'>('all');
  const [viewerItem, setViewerItem] = useState<GalleryItem | null>(null);
  const [captureMenu, setCaptureMenu] = useState<{ x: number; y: number; item: GalleryItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GalleryItem | null>(null);
  /** Which facts are written under each picture. */
  const [under, setUnder] = useState({ name: true, date: true, size: true });
  const [underOpen, setUnderOpen] = useState(false);
  const underBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === 'overview') setPlayNextSeed((seed) => seed + 1);
  }, [tab]);

  // A menu that was opened and then left behind is a menu over the next page.
  useEffect(() => {
    if (!underOpen) return;
    const away = (event: MouseEvent) => {
      if (!underBox.current?.contains(event.target as Node)) setUnderOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUnderOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [underOpen]);
  /** Bumped after a capture is removed, so the Album reads the disk again. */
  const [captureTick, setCaptureTick] = useState(0);
  const refreshCaptures = () => setCaptureTick((tick) => tick + 1);

  // The library is passed live, so playtime ticks every second while a game
  // runs. The session list only changes when a session ends, which the count
  // catches; keying the fetch on the games array itself read five thousand
  // rows once a second.
  const sessionCount = games.reduce((sum, game) => sum + game.sessionCount, 0);

  useEffect(() => {
    let alive = true;
    void listSessions(5000, 0)
      .then((rows) => {
        if (alive) setSessions(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [sessionCount]);

  // Captures are read for the tab counts, and again when the window comes back
  // from a game that was filming.
  useEffect(() => {
    let alive = true;
    const load = () => {
      void overlayGallery()
        .then((rows) => {
          if (alive) setCaptures(rows.filter((item) => isCaptureKind(item.kind)));
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
  }, [captureTick]);

  const byFolder = useMemo(() => {
    const map = new Map<string, Game>();
    for (const game of games) map.set(captureFolderName(game.title), game);
    return map;
  }, [games]);

  const albumCounts = captureCounts(captures ?? []);
  // Items arrive newest first, so a game appears in the order it was last
  // played back to.
  const albumGroups = useMemo(() => {
    const map = new Map<string, { title: string; game?: Game; items: GalleryItem[] }>();
    for (const item of captures ?? []) {
      if (albumKind !== 'all' && item.kind !== albumKind) continue;
      if (albumGame !== 'all' && item.game !== albumGame) continue;
      const known = map.get(item.game) ?? {
        title: byFolder.get(item.game)?.title ?? item.game,
        game: byFolder.get(item.game),
        items: [],
      };
      known.items.push(item);
      map.set(item.game, known);
    }
    return [...map.values()];
  }, [captures, albumKind, albumGame, byFolder]);

  /**
   * The games that actually have captures, for the filter row.
   *
   * Built from the captures rather than from the library: a game with nothing
   * in the Album is not a way to filter the Album, and a capture whose game is
   * no longer in the library still needs a name to be found under.
   */
  const albumGames = useMemo(() => {
    const counts = new Map<string, { folder: string; title: string; game?: Game; count: number }>();
    for (const item of captures ?? []) {
      const known = counts.get(item.game) ?? {
        folder: item.game,
        title: byFolder.get(item.game)?.title ?? item.game,
        game: byFolder.get(item.game),
        count: 0,
      };
      known.count += 1;
      counts.set(item.game, known);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [captures, byFolder]);

  /**
   * What a right click on a capture offers.
   *
   * The same verbs the overlay's own gallery has, because it is the same file:
   * look at it, show it in its folder, or delete it. Deleting asks first - the
   * picture is the only copy.
   */
  const visibleCaptures = useMemo(
    () => albumGroups.flatMap((group) => group.items),
    [albumGroups],
  );

  const captureItems = (item: GalleryItem): MenuItem[] => [
    {
      label: item.kind === 'screenshot' ? 'Open the picture' : 'Play this clip',
      icon: item.kind === 'screenshot' ? Images : Play,
      onSelect: () => setViewerItem(item),
    },
    { label: 'Show in its folder', icon: FolderOpen, onSelect: () => void revealInExplorer(item.path) },
    { kind: 'sep' },
    { label: 'Delete capture', icon: Trash2, danger: true, onSelect: () => setDeleteTarget(item) },
  ];

  const now = Date.now() / 1000;
  const byGame = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const { bins, topIds } = useMemo(() => buildBins(sessions, period, now), [sessions, period, now]);
  const since = periodStart(period, now);
  const inPeriod = useMemo(() => sessions.filter((row) => row.startedAt >= since), [sessions, since]);

  const totalSecs = inPeriod.reduce((sum, row) => sum + row.durationSecs, 0);
  const days = new Set(inPeriod.map((row) => dayKey(row.startedAt)));
  const perGame = new Map<string, number>();
  for (const row of inPeriod) perGame.set(row.gameId, (perGame.get(row.gameId) ?? 0) + row.durationSecs);
  const ranked = [...perGame.entries()]
    .map(([id, secs]) => ({ game: byGame.get(id), secs }))
    .filter((row): row is { game: Game; secs: number } => Boolean(row.game))
    .sort((a, b) => b.secs - a.secs);

  // Every day with a session, for the streak. A streak that ended yesterday
  // still counts until today is over.
  const allDays = new Set(sessions.map((row) => startOfDay(row.startedAt)));
  let streak = 0;
  let cursor = startOfDay(now);
  if (!allDays.has(cursor)) cursor -= DAY;
  while (allDays.has(cursor)) {
    streak += 1;
    cursor -= DAY;
  }

  const longest = sessions.reduce((best, row) => Math.max(best, row.durationSecs), 0);
  const activeDays = sessions.length > 0
    ? Math.round((now - Math.min(...sessions.map((row) => row.startedAt))) / DAY) + 1
    : 0;
  const [hoveredBinKey, setHoveredBinKey] = useState<string | null>(null);
  const [hoveredGameId, setHoveredGameId] = useState<string | null>(null);
  const [pinnedGameId, setPinnedGameId] = useState<string | null>(null);

  useEffect(() => {
    setHoveredBinKey(null);
    setHoveredGameId(null);
    setPinnedGameId(null);
  }, [period]);

  const busiest = bins.reduce<Bin | null>((best, bin) => (!best || bin.total > best.total ? bin : best), null);
  const maxTotal = Math.max(1, ...bins.map((bin) => bin.total));
  const axisCeiling = niceAxisCeiling(maxTotal);
  const hasData = bins.some((bin) => bin.total > 0);
  const focusGameId = hoveredGameId ?? pinnedGameId;
  const activeBin = hoveredBinKey ? bins.find((b) => b.key === hoveredBinKey) ?? null : null;
  const topGames = [...games].filter((game) => game.playSecs > 0).sort((a, b) => b.playSecs - a.playSecs).slice(0, 8);
  const shapeGames = games.filter((game) => !game.planned);
  const statusCounts: Record<GameStatus, number> = { playing: 0, completed: 0, dropped: 0, backlog: 0 };
  for (const game of shapeGames) statusCounts[game.status] += 1;
  const librarySize = Math.max(1, shapeGames.length);
  const hours = totalSecs / 3600;

  const syncBacklog = settings.syncBacklog === true;
  const backlogOn = settings.backlogOn ?? [];
  const backlogOff = settings.backlogOff ?? [];

  const tabCounts: Record<StatsTab, number> = {
    overview: 0,
    sessions: sessions.length,
    album: captures?.length ?? 0,
    journal: journalGames.length,
    backlog: allGames.filter((game) => game.planned || onBacklogPage(game, syncBacklog, backlogOn, backlogOff)).length,
  };

  return (
    <>
      <header className="orbit-pagehead">
        <h1>Statistics</h1>
        <div className="orbit-pagehead-meta">
          <span><b>{Math.round(games.reduce((sum, game) => sum + game.playSecs, 0) / 3600)}h</b> in the library</span>
          <span><b>{games.filter((game) => game.sessionCount > 0).length}</b> games played</span>
        </div>
      </header>

      <div className="orbit-stats-tabs" role="tablist" aria-label="Statistics">
        {(
          [
            ['overview', 'Overview', BarChart3],
            ['sessions', 'Sessions', ListOrdered],
            ['journal', 'Journal', BookOpen],
            ['backlog', 'Backlog', NotebookPen],
            // Album is the last place rather than the middle one: it is the only
            // tab that is a shelf of pictures rather than a reading, so it sits
            // at the end where the page's tabs stop being counts.
            ['album', 'Album', Images],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-pressed={tab === id} onClick={() => onTab(id)}>
            <Icon className="size-3.5" strokeWidth={1.9} />
            {label}
            {tabCounts[id] > 0 && <span className="orbit-num opacity-60">{tabCounts[id]}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          {/* The period is a property of the whole page, not of one chart, so it
              sits in the header where every panel below can see it. */}
          <div className="orbit-statsbar">
            <div className="orbit-period" role="group" aria-label="How far back to count">
              {([
                ['week', '7 days'],
                ['fortnight', '14 days'],
                ['month', '30 days'],
                ['year', 'Year'],
                ['all', 'All time'],
              ] as const).map(([id, label]) => (
                <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="orbit-statsbar-lede">
              {loaded
                ? `${PERIOD_LABEL[period]} · ${inPeriod.length} ${inPeriod.length === 1 ? 'session' : 'sessions'} across ${days.size} ${days.size === 1 ? 'day' : 'days'}`
                : 'Reading sessions…'}
            </span>
          </div>

          {/* Four numbers, said plainly. The hero picture is behind the page
              rather than under the numbers: a blurred cover the size of a panel
              was decoration that made the one number on it harder to read. */}
          <section className="orbit-figures">
            <div className="orbit-figure is-lead">
              <p className="orbit-figure-label">Played {PERIOD_LABEL[period]}</p>
              <p className="orbit-figure-value">
                {hours >= 1 ? Math.floor(hours).toLocaleString() : Math.max(0, Math.floor(totalSecs / 60)).toLocaleString()}
                <small>{hours >= 1 ? 'hours' : 'minutes'}</small>
              </p>
              <p className="orbit-figure-foot">
                {hours >= 1 && Math.round((totalSecs % 3600) / 60) >= 1
                  ? `and ${Math.round((totalSecs % 3600) / 60)} minutes more`
                  : inPeriod.length > 0 ? 'Nothing over the hour yet' : 'Nothing tracked yet'}
              </p>
            </div>
            <div className="orbit-figure">
              <p className="orbit-figure-label">Sessions</p>
              <p className="orbit-figure-value">{inPeriod.length.toLocaleString()}</p>
              <p className="orbit-figure-foot">
                {sessions.length > 0
                  ? `${fmtMinutes(Math.round(sessions.reduce((sum, row) => sum + row.durationSecs, 0) / sessions.length / 60))} on average`
                  : 'No sessions yet'}
              </p>
            </div>
            <div className="orbit-figure">
              <p className="orbit-figure-label">Most played</p>
              {ranked[0] ? (
                <>
                  <p className="orbit-figure-game">
                    <span className="orbit-figure-gameart"><Cover game={ranked[0].game} className="size-full" fit="cover" /></span>
                    <span className="min-w-0">
                      <b className="truncate">{ranked[0].game.title}</b>
                      <em>{fmtMinutes(ranked[0].secs / 60)}</em>
                    </span>
                  </p>
                  <p className="orbit-figure-foot">{inPeriod.length > 0 ? `${Math.round((ranked[0].secs / Math.max(1, totalSecs)) * 100)}% of the period` : ''}</p>
                </>
              ) : (
                <p className="orbit-figure-value is-quiet">-</p>
              )}
            </div>
          </section>

          <SectionPanel
            title={isDailyPeriod(period) ? 'Playtime by day' : period === 'year' ? 'Playtime by month' : 'Playtime by year'}
            note={
              busiest && busiest.total > 0
                ? `Busiest ${busiest.label} · ${fmtMinutes(busiest.total / 60)}`
                : loaded ? 'Nothing tracked yet' : 'Reading sessions…'
            }
          >
            {!hasData ? (
              <p className="orbit-chart-empty">{loaded ? 'Nothing tracked in this period. Play something, or widen the period.' : 'Reading sessions…'}</p>
            ) : (
              <div className="orbit-activity" data-period={period}>
                {/* Summary / live hover inspector: shows period totals at rest, and exact per-game breakdown when inspecting any bar */}
                <div className="orbit-activity-inspector">
                  {activeBin ? (
                    <div className="orbit-activity-inspect-row">
                      <div className="orbit-activity-inspect-head">
                        <span className="orbit-activity-inspect-when">{activeBin.label}</span>
                        <span className="orbit-activity-inspect-total">
                          {activeBin.total > 0 ? fmtMinutes(activeBin.total / 60) : 'No sessions'}
                        </span>
                      </div>
                      {activeBin.parts.length > 0 && (
                        <div className="orbit-activity-inspect-parts">
                          {[...activeBin.parts].sort((a, b) => b.secs - a.secs).map((part) => {
                            const g = part.id === 'other' ? undefined : byGame.get(part.id);
                            const col = seriesColour(part.id, topIds);
                            return (
                              <span key={part.id} className="orbit-activity-inspect-chip">
                                <i className="orbit-activity-dot" style={{ background: col }} />
                                {g && (
                                  <span className="orbit-activity-miniart">
                                    <Cover game={g} className="size-full" fit="cover" />
                                  </span>
                                )}
                                <span className="truncate max-w-[14rem] font-semibold text-fg">
                                  {part.id === 'other' ? 'Other games' : g?.title ?? 'Unknown game'}
                                </span>
                                <span className="orbit-num font-medium text-muted">{fmtMinutes(part.secs / 60)}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="orbit-playtime-summary !mb-0">
                      <span><b>{fmtMinutes(totalSecs / 60)}</b> total</span>
                      <span><b>{bins.filter((b) => b.total > 0).length}</b> active {isDailyPeriod(period) ? 'days' : period === 'year' ? 'months' : 'years'}</span>
                      <span><b>{fmtMinutes((totalSecs / Math.max(1, bins.filter((b) => b.total > 0).length)) / 60)}</b> avg per active {isDailyPeriod(period) ? 'day' : period === 'year' ? 'month' : 'year'}</span>
                      {focusGameId && (
                        <span className="text-accent font-medium">
                          Highlighting {focusGameId === 'other' ? 'Other games' : byGame.get(focusGameId)?.title ?? 'game'}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Stacked bar chart: Y-axis scale + horizontal gridlines + stacked per-game segments */}
                <div
                  className="orbit-activity-stage"
                  role="img"
                  aria-label={`Stacked playtime bar chart ${PERIOD_LABEL[period]}`}
                  onMouseLeave={() => setHoveredBinKey(null)}
                >
                  <div className="orbit-activity-yaxis" aria-hidden>
                    <span>{fmtAxisTick(axisCeiling)}</span>
                    <span>{fmtAxisTick(axisCeiling / 2)}</span>
                    <span>0</span>
                  </div>

                  <div className="orbit-activity-plot">
                    <div className="orbit-activity-gridlines" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>

                    <div
                      className="orbit-activity-bars"
                      style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))` }}
                    >
                      {bins.map((bin, idx) => {
                        const totalPct = bin.total > 0 ? Math.min(100, Math.max(3, (bin.total / axisCeiling) * 100)) : 0;
                        const isHovered = hoveredBinKey === bin.key;
                        const showTick =
                          period === 'week' ||
                          (period === 'fortnight' && (idx === 0 || idx === bins.length - 1 || idx % 2 === 1)) ||
                          (period === 'month' && (idx === 0 || idx === bins.length - 1 || bin.shortLabel.includes(' ') || idx % 5 === 4)) ||
                          period === 'year' ||
                          period === 'all';
                        return (
                          <button
                            key={bin.key}
                            type="button"
                            className={`orbit-activity-col ${isHovered ? 'is-hovered' : ''} ${bin.isToday ? 'is-today' : ''}`}
                            onMouseEnter={() => setHoveredBinKey(bin.key)}
                            onFocus={() => setHoveredBinKey(bin.key)}
                            onBlur={() => setHoveredBinKey(null)}
                            onClick={() => {
                              const topPart = [...bin.parts].sort((a, b) => b.secs - a.secs)[0];
                              if (topPart && topPart.id !== 'other' && byGame.has(topPart.id)) {
                                onOpenGame(topPart.id);
                              }
                            }}
                            aria-label={`${bin.label}: ${bin.total > 0 ? fmtMinutes(bin.total / 60) : 'no sessions'}`}
                          >
                            <span className="orbit-activity-track">
                              {bin.total > 0 ? (
                                <span className="orbit-activity-stack" style={{ height: `${totalPct}%` }}>
                                  {bin.parts.map((part) => {
                                    const sharePct = (part.secs / Math.max(1, bin.total)) * 100;
                                    const dimmed = focusGameId !== null && focusGameId !== part.id;
                                    return (
                                      <span
                                        key={part.id}
                                        className={`orbit-activity-seg ${dimmed ? 'is-dimmed' : ''}`}
                                        style={{
                                          height: `${sharePct}%`,
                                          background: seriesColour(part.id, topIds),
                                        }}
                                      />
                                    );
                                  })}
                                </span>
                              ) : (
                                <span className="orbit-activity-zero" />
                              )}
                            </span>
                            <span className={`orbit-activity-tick ${showTick ? 'is-shown' : ''}`}>
                              {showTick ? bin.shortLabel : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Interactive game legend: distinct color swatch + mini cover + title + duration; hover or click to isolate */}
                {topIds.length > 0 && (
                  <div className="orbit-activity-legend" role="group" aria-label="Games in chart">
                    {topIds.map((id) => {
                      const g = byGame.get(id);
                      const secs = perGame.get(id) ?? 0;
                      const col = seriesColour(id, topIds);
                      const isPinned = pinnedGameId === id;
                      const isDimmed = focusGameId !== null && focusGameId !== id;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={isPinned}
                          onMouseEnter={() => setHoveredGameId(id)}
                          onMouseLeave={() => setHoveredGameId(null)}
                          onClick={() => setPinnedGameId((cur) => (cur === id ? null : id))}
                          className={`orbit-activity-legend-btn ${isPinned ? 'is-pinned' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                          title="Hover or click to highlight this game across the chart"
                        >
                          <i className="orbit-activity-dot" style={{ background: col }} />
                          {g && (
                            <span className="orbit-activity-miniart">
                              <Cover game={g} className="size-full" fit="cover" />
                            </span>
                          )}
                          <span className="truncate max-w-[13rem] font-semibold">{g?.title ?? 'Another game'}</span>
                          <span className="orbit-num font-medium opacity-75">{fmtMinutes(secs / 60)}</span>
                        </button>
                      );
                    })}
                    {bins.some((bin) => bin.parts.some((part) => part.id === 'other')) && (
                      <button
                        type="button"
                        aria-pressed={pinnedGameId === 'other'}
                        onMouseEnter={() => setHoveredGameId('other')}
                        onMouseLeave={() => setHoveredGameId(null)}
                        onClick={() => setPinnedGameId((cur) => (cur === 'other' ? null : 'other'))}
                        className={`orbit-activity-legend-btn ${pinnedGameId === 'other' ? 'is-pinned' : ''} ${focusGameId !== null && focusGameId !== 'other' ? 'is-dimmed' : ''}`}
                      >
                        <i className="orbit-activity-dot" style={{ background: OTHER_SERIES_COLOUR }} />
                        <span>Other games</span>
                      </button>
                    )}
                    {pinnedGameId && (
                      <button
                        type="button"
                        onClick={() => setPinnedGameId(null)}
                        className="orbit-activity-legend-clear"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </SectionPanel>

          <div className="orbit-stats-split">
            <SectionPanel title="Something to play next" note="From your backlog - shuffled each time you open this page">
              {(() => {
                const pool = allGames.filter((game) => game.status === 'backlog');
                if (pool.length === 0) {
                  return (
                    <p className="orbit-panel-empty">
                      Nothing in the backlog. Add a game to the Backlog and it will appear here for a quick pick.
                    </p>
                  );
                }
                void playNextSeed;
                const shuffled = (() => {
                  const arr = [...pool];
                  // Seeded shuffle using playNextSeed for stability across renders
                  let seed = playNextSeed * 9301 + 49297;
                  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
                  for (let index = arr.length - 1; index > 0; index -= 1) {
                    const other = Math.floor(rand() * (index + 1));
                    const tmp = arr[index];
                    arr[index] = arr[other];
                    arr[other] = tmp;
                  }
                  return arr;
                })();
                return (
                  <ul className="orbit-playnext">
                    {shuffled.slice(0, 4).map((game) => (
                      <li key={game.id}>
                        <button type="button" onClick={() => onOpenGame(game.id)}>
                          <span className="orbit-playnext-art"><Cover game={game} className="size-full" fit="cover" /></span>
                          <span className="min-w-0">
                            <b className="truncate">{game.title}</b>
                            <em>
                              {[game.meta?.genres?.[0], game.meta?.releaseYear].filter(Boolean).join(' · ') || 'In the backlog'}
                            </em>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </SectionPanel>

            <SectionPanel title="The shape of the library" note={`${shapeGames.length} games`}>
              <div className="orbit-statusbar" aria-hidden>
                {(Object.keys(statusCounts) as GameStatus[]).map((status) => (
                  <i
                    key={status}
                    style={{ width: `${(statusCounts[status] / librarySize) * 100}%`, background: STATUS_COLOUR[status] }}
                  />
                ))}
              </div>
              <div className="orbit-statuslegend">
                {(Object.keys(statusCounts) as GameStatus[]).map((status) => (
                  <span key={status}>
                    <i style={{ background: STATUS_COLOUR[status] }} />
                    {status === 'backlog' ? 'In the backlog' : status === 'playing' ? 'Playing' : status === 'completed' ? 'Completed' : 'Dropped'}
                    <b>{statusCounts[status]}</b>
                  </span>
                ))}
                <span>
                  <Trophy className="size-3" />
                  {shapeGames.filter((game) => game.favorite).length} favorites
                </span>
              </div>
              <div className="orbit-stats-facts">
                <p><Clock className="size-3.5" /> Longest session <b>{longest > 0 ? fmtMinutes(longest / 60) : '-'}</b></p>
                <p><CalendarDays className="size-3.5" /> Tracked for <b>{activeDays > 0 ? `${activeDays} days` : 'no time yet'}</b></p>
                <p><Gamepad2 className="size-3.5" /> Games played <b>{games.filter((game) => game.sessionCount > 0).length}</b></p>
              </div>
            </SectionPanel>
          </div>

          {topGames.length > 0 && (
            <SectionPanel title="Most played" note="Click a cover to open the game">
              <div className="orbit-topgames">
                {topGames.map((game) => (
                  <button key={game.id} className="orbit-topgame" onClick={() => onOpenGame(game.id)} title={`Open ${game.title}`}>
                    <Cover game={game} className="orbit-cover aspect-[2/3] w-full" loading="lazy" />
                    <b>{game.title}</b>
                    <span>{fmtMinutes(game.playSecs / 60)}</span>
                  </button>
                ))}
              </div>
            </SectionPanel>
          )}
        </>
      ) : tab === 'sessions' ? (
        <SessionsView games={games} onChanged={onChanged} onOpenGame={onOpenGame} embedded />
      ) : tab === 'album' ? (
        <>
          <section className="orbit-stats-panel">
            <div className="orbit-stats-panel-head">
              <h2>Album</h2>
              <span>
                {captures === null
                  ? 'Reading captures…'
                  : `${(albumGame === 'all' ? captures.filter((item) => albumKind === 'all' || item.kind === albumKind) : captures.filter((item) => item.game === albumGame && (albumKind === 'all' || item.kind === albumKind))).length} ${albumKind === 'all' ? 'items' : CAPTURE_LABELS[albumKind].many.toLowerCase()} across ${albumGroups.length} ${albumGroups.length === 1 ? 'game' : 'games'}`}
              </span>
            </div>

            <div className="orbit-album-tools">
              <div className="orbit-album-filterrow">
              <div className="orbit-minichips">
                <button aria-pressed={albumKind === 'all'} onClick={() => setAlbumKind('all')}>
                  Everything <span className="opacity-60">{captures?.length ?? 0}</span>
                </button>
                {CAPTURE_KINDS.map((kind) => (
                  <button key={kind} aria-pressed={albumKind === kind} onClick={() => setAlbumKind(kind)}>
                    {CAPTURE_LABELS[kind].many} <span className="opacity-60">{albumCounts[kind]}</span>
                  </button>
                ))}
              </div>

              {/* What is written under each picture. A menu rather than four
                  switches in the open: the answer is usually "leave it alone",
                  and a row of controls over a wall of photographs is the thing
                  it was asked not to be. */}
              <div className="orbit-album-under" ref={underBox}>
                <button
                  type="button"
                  className="orbit-btnquiet"
                  aria-expanded={underOpen}
                  aria-haspopup="dialog"
                  onClick={() => setUnderOpen((open) => !open)}
                >
                  <ListOrdered className="size-3.5" />
                  Shown under
                  <span className="orbit-album-undercount">
                    {Object.values(under).filter(Boolean).length}
                  </span>
                </button>
                {underOpen && (
                  <div className="orbit-album-undermenu" role="dialog" aria-label="Shown under each capture">
                    {([
                      ['name', 'File name', 'Screenshot 2026-11-13 21-04-11.png'],
                      ['date', 'When it was taken', 'Today, 21:04'],
                      ['size', 'File size', '2.4 MB'],
                    ] as const).map(([key, label, sample]) => (
                      <label key={key} className="orbit-album-underrow">
                        <span className="min-w-0">
                          <b>{label}</b>
                          <em>{sample}</em>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={under[key]}
                          aria-label={label}
                          onClick={() => setUnder((current) => ({ ...current, [key]: !current[key] }))}
                          className="orbit-switch"
                          data-on={under[key] || undefined}
                        >
                          <i />
                        </button>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              </div>

              {/* The games, as their own covers rather than a dropdown: the
                  Album is pictures, so the filter for it is pictures too. */}
              {albumGames.length > 1 && (
                <div className="space-y-3">
                  <div className="orbit-album-games" role="group" aria-label="Only one game">
                    <button
                      type="button"
                      className={cn('orbit-album-gamechip', albumGame === 'all' && 'is-on')}
                      aria-pressed={albumGame === 'all'}
                      onClick={() => setAlbumGame('all')}
                    >
                      <span className="orbit-album-gamechip-art is-all">
                        <Images className="size-4" />
                      </span>
                      <span className="orbit-album-gamechip-name">All games</span>
                    </button>
                    {albumGames.map((entry) => (
                      <button
                        key={entry.folder}
                        type="button"
                        className={cn('orbit-album-gamechip', albumGame === entry.folder && 'is-on')}
                        aria-pressed={albumGame === entry.folder}
                        onClick={() => setAlbumGame(albumGame === entry.folder ? 'all' : entry.folder)}
                        title={`${entry.title} · ${entry.count}`}
                      >
                        <span className="orbit-album-gamechip-art">
                          {entry.game ? (
                            <Cover game={entry.game} className="size-full" fit="cover" />
                          ) : (
                            <span className="grid size-full place-items-center text-fluid text-[10px] font-bold text-muted">
                              {entry.title.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="orbit-album-gamechip-name">{entry.title}</span>
                        <span className="orbit-album-gamechip-count">{entry.count}</span>
                      </button>
                    ))}
                  </div>
                  {albumGame !== 'all' && (
                    <div className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-line bg-panel/60 p-2">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="text-xs font-medium text-fg">Captures for {byFolder.get(albumGame)?.title ?? albumGame}</span>
                        <button type="button" onClick={() => setAlbumGame('all')} className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-panel2 hover:text-fg">Show all</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {(captures ?? []).filter((item) => item.game === albumGame && (albumKind === 'all' || item.kind === albumKind)).slice(0, 8).map((item) => (
                          <button key={item.path} type="button" onClick={() => setViewerItem(item)} className="group overflow-hidden rounded-lg border border-line bg-panel2 text-left">
                            <span className="block aspect-video overflow-hidden"><CaptureThumb item={item} /></span>
                            <span className="block truncate px-1.5 py-1 text-[10px] text-muted group-hover:text-fg">{item.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {captures === null ? null : captures.length === 0 ? (
              <div className="orbit-gallery-empty mt-4">
                No captures yet. Screenshots, recordings and replays taken with the overlay are kept here,
                grouped by the game they came from.
              </div>
            ) : albumGroups.length === 0 ? (
              <div className="orbit-gallery-empty mt-4">Nothing of that kind yet.</div>
            ) : (
              <div className="orbit-album">
                {albumGroups.map((group) => (
                  <div key={group.title} className="orbit-album-group">
                    {/* The group header is the game's own cover and name, so a
                        wall of captures is read down the pictures rather than
                        down a column of coloured squares. */}
                    <div className="orbit-album-head">
                      <span className="orbit-album-headart">
                        {group.game ? (
                          <Cover game={group.game} className="size-full" fit="cover" />
                        ) : (
                          <span className="grid size-full place-items-center bg-panel2 text-[11px] font-bold text-muted">
                            {group.title.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate">{group.title}</h3>
                        <p>
                          {group.items.length} {group.items.length === 1 ? 'capture' : 'captures'}
                          {group.game ? ` · ${fmtMinutes(group.game.playSecs / 60)} played` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="orbit-gallery">
                      {group.items.map((item) => {
                        const whenLabel = under.date ? whenOf(item) : '';
                        const sizeLabel = under.size ? sizeOf(item) : '';
                        const hasFacts = Boolean(whenLabel || sizeLabel);
                        const hasFooter = Boolean(under.name || hasFacts);
                        return (
                          <button
                            key={item.path}
                            type="button"
                            onClick={() => setViewerItem(item)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setCaptureMenu({ x: event.clientX, y: event.clientY, item });
                            }}
                            title={item.name}
                            className="orbit-album-tile"
                          >
                            <span className="orbit-album-tileart">
                              <CaptureThumb item={item} />
                              {item.kind !== 'screenshot' && (
                                <span className="orbit-album-tilebadge">
                                  {item.kind === 'recording' ? 'REC' : 'REPLAY'}
                                </span>
                              )}
                            </span>
                            {hasFooter && (
                              <span className="orbit-album-tilefoot">
                                {under.name && <span className="orbit-album-tilename">{item.name}</span>}
                                {hasFacts && (
                                  <span className="orbit-album-tilefacts">
                                    {whenLabel && <span>{whenLabel}</span>}
                                    {sizeLabel && <span>{sizeLabel}</span>}
                                  </span>
                                )}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          {captureMenu && (
            <ContextMenu
              x={captureMenu.x}
              y={captureMenu.y}
              items={captureItems(captureMenu.item)}
              onClose={() => setCaptureMenu(null)}
            />
          )}
          {deleteTarget && (
            <ConfirmDialog
              title="Delete this capture?"
              description={`${deleteTarget.name} is removed from the disk. This cannot be undone.`}
              confirmLabel="Delete"
              confirmIcon={Trash2}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (viewerItem?.path === target.path) setViewerItem(null);
                void overlayDelete(target.path)
                  .then(refreshCaptures)
                  .catch(() => undefined);
              }}
            />
          )}
          <CaptureViewerModal
            item={viewerItem}
            items={visibleCaptures}
            resolveGame={(item) => {
              const g = byFolder.get(item.game);
              return { game: g, title: g?.title ?? item.game };
            }}
            onSelect={setViewerItem}
            onClose={() => setViewerItem(null)}
            onDelete={setDeleteTarget}
          />
        </>
      ) : tab === 'journal' ? (
        <LogsView
          games={journalGames}
          allGames={allGames}
          onJournalMembership={onJournalMembership}
          onUpdate={onUpdate}
          onEditGame={onEditGame}
          order={settings.logOrder ?? []}
          onOrder={(ids) => setSettings({ logOrder: ids })}
          embedded
        />
      ) : (
        <BacklogView
          games={games}
          onSelect={onOpenGame}
          onEdit={onEditGame}
          onStatus={onBacklogStatus}
          onAdd={onAddPlanned}
          onUpdate={onUpdate}
          onRemove={onRemove}
          fetchMetadata={fetchMetadata}
          syncLibrary={settings.syncBacklog === true}
          backlogOn={settings.backlogOn ?? []}
          backlogOff={settings.backlogOff ?? []}
          onBacklogMembership={onBacklogMembership}
          myOrder={settings.backlogOrder}
          setMyOrder={(ids) => setSettings({ backlogOrder: ids })}
          showReleaseCalendar={settings.showBacklogCalendar !== false}
          embedded
        />
      )}
    </>
  );
}