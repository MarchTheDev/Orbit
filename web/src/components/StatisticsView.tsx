import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3, BookOpen, CalendarDays, Clock, FolderOpen, Gamepad2, Images, ListOrdered,
  NotebookPen, Play, Trash2, Trophy,
} from 'lucide-react';
import type { Game, GameStatus, Session, Settings } from '../types';
import {
  listSessions, overlayDelete, overlayGallery, overlayOpen, revealInExplorer, type GalleryItem,
} from '../services/native';
import { fileSrc } from '../services/desktop';
import { fmtMinutes } from '../utils/format';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { CAPTURE_KINDS, CAPTURE_LABELS, CaptureThumb, captureCounts, captureFolderName, isCaptureKind, type CaptureKind } from './Captures';
import { SessionsView } from './SessionsView';
import { BacklogView } from './BacklogView';
import { LogsView } from './LogsView';
import { ContextMenu, type MenuItem } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';

type Period = 'month' | 'year' | 'all';
export type StatsTab = 'overview' | 'sessions' | 'album' | 'journal' | 'backlog';

const PERIOD_LABEL: Record<Period, string> = {
  month: 'in the last 30 days',
  year: 'in the last year',
  all: 'all time',
};

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

/** The colour a game keeps across the chart, the legend and its covers. */
function gameColour(game: Game | undefined): string {
  return game ? `hsl(${game.hue} 58% 56%)` : 'color-mix(in srgb, var(--c-muted) 60%, transparent)';
}

interface Bin {
  key: string;
  label: string;
  total: number;
  /** Per game, widest first, already cut down to the chart's share. */
  parts: { id: string; secs: number }[];
}

/**
 * One bar chart's worth of sessions, bucketed by the period.
 *
 * A month is read by day, a year by month, and everything by year, which is
 * the only grouping that stays honest over an arbitrary span. Games outside
 * the six biggest of the period are folded into one neutral band so the chart
 * stays a shape rather than a patchwork.
 */
function buildBins(sessions: Session[], period: Period, now: number): { bins: Bin[]; topIds: string[] } {
  const todays = startOfDay(now);
  const since = period === 'month' ? todays - 29 * DAY : period === 'year' ? todays - 364 * DAY : 0;
  const usable = sessions.filter((row) => row.startedAt >= since && row.durationSecs > 0);

  const totals = new Map<string, number>();
  for (const row of usable) totals.set(row.gameId, (totals.get(row.gameId) ?? 0) + row.durationSecs);
  const topIds = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  const kept = new Set(topIds);

  const startMs = new Date((period === 'all' && usable.length > 0 ? Math.min(...usable.map((row) => row.startedAt)) : since) * 1000);
  const bins: Bin[] = [];

  if (period === 'month') {
    for (let index = 29; index >= 0; index -= 1) {
      const start = todays - index * DAY;
      const date = new Date(start * 1000);
      bins.push({
        key: String(start),
        label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        total: 0,
        parts: [],
      });
    }
  } else if (period === 'year') {
    for (let index = 11; index >= 0; index -= 1) {
      const date = new Date(now * 1000);
      const start = new Date(date.getFullYear(), date.getMonth() - index, 1).getTime() / 1000;
      bins.push({
        key: String(start),
        label: new Date(start * 1000).toLocaleDateString(undefined, { month: 'short' }),
        total: 0,
        parts: [],
      });
    }
  } else {
    const firstYear = startMs.getFullYear();
    const lastYear = new Date(now * 1000).getFullYear();
    const from = Math.min(firstYear, lastYear);
    for (let year = from; year <= lastYear; year += 1) {
      bins.push({ key: String(year), label: String(year), total: 0, parts: [] });
    }
  }

  const byPart = bins.map(() => new Map<string, number>());

  for (const row of usable) {
    const index = period === 'month'
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
      .sort((a, b) => b.secs - a.secs);
  });

  return { bins, topIds };
}

/**
 * Statistics: the whole library's time in one place.
 *
 * The Overview answers the three questions a player actually has — how much
 * have I played, what was it, and when — in that order: the period's total in
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
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<{ src: string; name: string } | null>(null);
  const [captureMenu, setCaptureMenu] = useState<{ x: number; y: number; item: GalleryItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GalleryItem | null>(null);
  /** Which facts are written under each picture. All of them, to begin with. */
  const [under, setUnder] = useState({ name: true, date: true, size: true, game: false });
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

  useEffect(() => {
    if (!lightbox && !videoSrc) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [lightbox, videoSrc]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

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
  const captureItems = (item: GalleryItem): MenuItem[] => [
    {
      label: item.kind === 'screenshot' ? 'Open the picture' : 'Play this clip',
      icon: item.kind === 'screenshot' ? Images : Play,
      onSelect: () =>
        item.kind === 'screenshot' ? setLightbox(fileSrc(item.path)) : void overlayOpen(item.path),
    },
    { label: 'Show in its folder', icon: FolderOpen, onSelect: () => void revealInExplorer(item.path) },
    { kind: 'sep' },
    { label: 'Delete capture', icon: Trash2, danger: true, onSelect: () => setDeleteTarget(item) },
  ];

  const now = Date.now() / 1000;
  const byGame = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const { bins, topIds } = useMemo(() => buildBins(sessions, period, now), [sessions, period, now]);
  const since = period === 'month' ? startOfDay(now) - 29 * DAY : period === 'year' ? startOfDay(now) - 364 * DAY : 0;
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
  const busiest = bins.reduce<Bin | null>((best, bin) => (!best || bin.total > best.total ? bin : best), null);
  const maxTotal = Math.max(1, ...bins.map((bin) => bin.total));
  const hasData = bins.some((bin) => bin.total > 0);
  const topGames = [...games].filter((game) => game.playSecs > 0).sort((a, b) => b.playSecs - a.playSecs).slice(0, 8);
  const shapeGames = games.filter((game) => !game.planned);
  const statusCounts: Record<GameStatus, number> = { playing: 0, completed: 0, dropped: 0, backlog: 0 };
  for (const game of shapeGames) statusCounts[game.status] += 1;
  const librarySize = Math.max(1, shapeGames.length);
  const axis = bins.length > 0 ? [0, Math.floor((bins.length - 1) / 2), bins.length - 1] : [];
  const hours = totalSecs / 3600;

  const tabCounts: Record<StatsTab, number> = {
    overview: 0,
    sessions: sessions.length,
    album: captures?.length ?? 0,
    journal: journalGames.length,
    backlog: allGames.filter((game) => game.planned).length,
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
                <p className="orbit-figure-value is-quiet">—</p>
              )}
            </div>
          </section>

          <SectionPanel
            title={period === 'month' ? 'Playtime by day' : period === 'year' ? 'Playtime by month' : 'Playtime by year'}
            note={
              busiest && busiest.total > 0
                ? `Busiest ${busiest.label} · ${fmtMinutes(busiest.total / 60)}`
                : loaded ? 'Nothing tracked yet' : 'Reading sessions…'
            }
          >
            <div className={`orbit-chart${hasData ? '' : ' orbit-chart-quiet'}`} role="img" aria-label={`Playtime ${PERIOD_LABEL[period]}, ${fmtMinutes(totalSecs / 60)}`}>
              {!hasData ? (
                <p>{loaded ? 'Nothing tracked in this period. Play something, or widen the period.' : 'Reading sessions…'}</p>
              ) : (
                bins.map((bin) => {
                  const title = `${bin.label}: ${fmtMinutes(bin.total / 60)}`;
                  return (
                    <div key={bin.key} className="orbit-chart-col" title={title}>
                      {bin.parts.map((part) => (
                        <i
                          key={part.id}
                          style={{ height: `${(part.secs / maxTotal) * 100}%`, background: gameColour(byGame.get(part.id)) }}
                          title={`${byGame.get(part.id)?.title ?? 'Other'} · ${fmtMinutes(part.secs / 60)}`}
                        />
                      ))}
                    </div>
                  );
                })
              )}
            </div>
            {hasData && (
              <div className="orbit-chart-axis">
                {axis.map((index) => (
                  <span key={bins[index].key}>{bins[index].label}</span>
                ))}
              </div>
            )}
            {topIds.length > 0 && (
              <div className="orbit-legend">
                {topIds.map((id) => (
                  <span key={id}>
                    <i style={{ background: gameColour(byGame.get(id)) }} />
                    {byGame.get(id)?.title ?? 'Another game'}
                  </span>
                ))}
                {bins.some((bin) => bin.parts.some((part) => part.id === 'other')) && (
                  <span><i style={{ background: gameColour(undefined) }} />Everything else</span>
                )}
              </div>
            )}
          </SectionPanel>

          <div className="orbit-stats-split">
            <SectionPanel title="Something to play next" note="From your backlog — shuffled each time you open this page">
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
                <p><Clock className="size-3.5" /> Longest session <b>{longest > 0 ? fmtMinutes(longest / 60) : '—'}</b></p>
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
                      ['game', 'Which game', 'Elden Ring'],
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
                          <button key={item.path} onClick={() => (item.kind === 'screenshot' ? setLightbox(fileSrc(item.path)) : void overlayOpen(item.path))} className="group overflow-hidden rounded-lg border border-line bg-panel2">
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
                      {group.items.map((item) => (
                        <button
                          key={item.path}
                          onClick={() => (item.kind === 'screenshot' ? setLightbox(fileSrc(item.path)) : setVideoSrc({ src: fileSrc(item.path), name: item.name }))}
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
                          <span className="orbit-album-tilefoot">
                            {under.name && <span className="orbit-album-tilename">{item.name}</span>}
                            <span className="orbit-album-tilefacts">
                              {under.date && whenOf(item) && <span>{whenOf(item)}</span>}
                              {under.size && sizeOf(item) && <span>{sizeOf(item)}</span>}
                              {under.game && <span>{group.title}</span>}
                            </span>
                          </span>
                        </button>
                      ))}
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
                void overlayDelete(target.path)
                  .then(refreshCaptures)
                  .catch(() => undefined);
              }}
            />
          )}
          {lightbox && (
            <div className="orbit-lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" onClick={() => setLightbox(null)}>
              <button type="button" aria-label="Close" onClick={() => setLightbox(null)} className="orbit-lightbox-close"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></button>
              <img src={lightbox} alt="" />
            </div>
          )}
          {videoSrc && (
            <div className="orbit-lightbox" role="dialog" aria-modal="true" aria-label={`Video ${videoSrc.name}`} onClick={() => setVideoSrc(null)}>
              <button type="button" aria-label="Close" onClick={() => setVideoSrc(null)} className="orbit-lightbox-close"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></button>
              <video src={videoSrc.src} controls autoPlay className="max-h-[86vh] max-w-[92vw] rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
            </div>
          )}
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
          embedded
        />
      )}
    </>
  );
}