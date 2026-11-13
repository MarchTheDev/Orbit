import { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookOpen, CalendarDays, Clock, Flame, Gamepad2, ListOrdered, NotebookPen, Trophy } from 'lucide-react';
import type { Game, GameStatus, Session, Settings } from '../types';
import { listSessions } from '../services/native';
import { fmtDate, fmtMinutes } from '../utils/format';
import { wideArt } from '../utils/art';
import { Cover } from './ui/Cover';
import { SessionsView } from './SessionsView';
import { BacklogView } from './BacklogView';
import { LogsView } from './LogsView';

type Period = 'month' | 'year' | 'all';
type StatsTab = 'overview' | 'sessions' | 'journal' | 'backlog';

const PERIOD_LABEL: Record<Period, string> = {
  month: 'in the last 30 days',
  year: 'in the last year',
  all: 'all time',
};

const DAY = 86_400;
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
}) {
  const [tab, setTab] = useState<StatsTab>('overview');
  const [period, setPeriod] = useState<Period>('month');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

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
  const topGame = ranked[0]?.game ?? games.filter((game) => game.playSecs > 0).sort((a, b) => b.playSecs - a.playSecs)[0];

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
  const statusCounts: Record<GameStatus, number> = { playing: 0, completed: 0, dropped: 0, backlog: 0 };
  for (const game of games) statusCounts[game.status] += 1;
  const librarySize = Math.max(1, games.length);
  const axis = bins.length > 0 ? [0, Math.floor((bins.length - 1) / 2), bins.length - 1] : [];
  const hours = totalSecs / 3600;

  const tabCounts: Record<StatsTab, number> = {
    overview: 0,
    sessions: sessions.length,
    journal: journalGames.length,
    backlog: allGames.filter((game) => game.planPlatform || game.planned).length,
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
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-pressed={tab === id} onClick={() => setTab(id)}>
            <Icon className="size-3.5" strokeWidth={1.9} />
            {label}
            {id === 'sessions' && sessions.length > 0 && <span className="orbit-num opacity-60">{sessions.length}</span>}
            {id === 'journal' && journalGames.length > 0 && <span className="orbit-num opacity-60">{tabCounts.journal}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          <section className="orbit-stats-hero">
            <div
              className="orbit-stats-hero-art"
              aria-hidden
              style={
                topGame && wideArt(topGame)
                  ? { backgroundImage: `url("${wideArt(topGame)}")` }
                  : {
                      backgroundImage: `radial-gradient(110% 90% at 78% 14%, hsl(${topGame?.hue ?? 220} 46% 34% / .7), transparent 64%), radial-gradient(80% 70% at 8% 92%, hsl(${topGame?.hue ?? 260} 42% 26% / .5), transparent 60%)`,
                      backgroundSize: 'auto, auto',
                    }
              }
            />
            <div className="orbit-stats-hero-scrim" aria-hidden />
            <div className="orbit-stats-hero-top">
              <div className="orbit-period" role="group" aria-label="How far back to count">
                {(
                  [
                    ['month', 'Month'],
                    ['year', 'Year'],
                    ['all', 'All time'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="orbit-stats-caption">Played {PERIOD_LABEL[period]}</p>
            <p className="orbit-stats-number">
              {hours >= 1 ? Math.floor(hours) : Math.max(0, Math.floor(totalSecs / 60))}
              <small>{hours >= 1 ? 'h' : 'm'}</small>
              {hours >= 1 && Math.round((totalSecs % 3600) / 60) >= 10 && (
                <small> {Math.round((totalSecs % 3600) / 60)}m</small>
              )}
            </p>
            <div className="orbit-stats-badges">
              <span className="orbit-badge"><b>{inPeriod.length}</b> sessions</span>
              <span className="orbit-badge"><b>{days.size}</b> days played</span>
              {streak > 0 && <span className="orbit-badge"><Flame className="size-3" /> <b>{streak}</b> day streak</span>}
              {ranked[0] && <span className="orbit-badge">Most played <b>{ranked[0].game.title}</b></span>}
            </div>
          </section>

          <section className="orbit-stats-panel">
            <div className="orbit-stats-panel-head">
              <h2>
                {period === 'month' ? 'Playtime by day' : period === 'year' ? 'Playtime by month' : 'Playtime by year'}
              </h2>
              <span>
                {busiest && busiest.total > 0
                  ? `Busiest: ${busiest.label} · ${fmtMinutes(busiest.total / 60)}`
                  : loaded ? 'Nothing tracked yet' : 'Reading sessions…'}
              </span>
            </div>
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
          </section>

          {topGames.length > 0 && (
            <section className="orbit-stats-panel">
              <div className="orbit-stats-panel-head">
                <h2>Most played</h2>
                <span>Click a cover to open the game</span>
              </div>
              <div className="orbit-topgames">
                {topGames.map((game) => (
                  <button key={game.id} className="orbit-topgame" onClick={() => onOpenGame(game.id)} title={`Open ${game.title}`}>
                    <Cover game={game} className="orbit-cover aspect-[2/3] w-full" loading="lazy" />
                    <b>{game.title}</b>
                    <span>{fmtMinutes(game.playSecs / 60)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="orbit-stats-panel">
            <div className="orbit-stats-panel-head">
              <h2>The collection</h2>
              <span>{games.length} games · {fmtDate(new Date().toISOString())}</span>
            </div>
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
                {games.filter((game) => game.favorite).length} favorites
              </span>
            </div>
            <div className="orbit-stats-facts">
              <p><Clock className="size-3.5" /> Longest session <b>{longest > 0 ? fmtMinutes(longest / 60) : '—'}</b></p>
              <p><CalendarDays className="size-3.5" /> Tracked for <b>{activeDays > 0 ? `${activeDays} days` : 'no time yet'}</b></p>
              <p><Gamepad2 className="size-3.5" /> Average session <b>{sessions.length > 0 ? fmtMinutes(Math.round(sessions.reduce((sum, row) => sum + row.durationSecs, 0) / sessions.length / 60)) : '—'}</b></p>
            </div>
          </section>
        </>
      ) : tab === 'sessions' ? (
        <SessionsView games={games} onChanged={onChanged} onOpenGame={onOpenGame} embedded />
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
