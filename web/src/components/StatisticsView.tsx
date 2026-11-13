import { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookOpen, Clock3, Gamepad2, Layers3, NotebookPen, Trophy } from 'lucide-react';
import type { Game, GameStatus, Settings, Session } from '../types';
import { listSessions } from '../services/native';
import { fmtMinutes } from '../utils/format';
import { onBacklogPage, onJournalPage } from '../utils/library';
import { BacklogView } from './BacklogView';
import { LogsView } from './LogsView';
import { SessionsView } from './SessionsView';
import { Cover } from './ui/Cover';
import './StatisticsView.css';

type Section = 'overview' | 'sessions' | 'journal' | 'backlog';
type Range = 'week' | 'month' | 'year' | 'all';

function keyFor(date: Date, range: Range): string {
  if (range === 'year' || range === 'all') return `${date.getFullYear()}-${date.getMonth()}`;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function labelFor(date: Date, range: Range): string {
  if (range === 'year' || range === 'all') return date.toLocaleDateString(undefined, { month: 'short' });
  return range === 'week'
    ? date.toLocaleDateString(undefined, { weekday: 'short' })
    : `${date.getDate()}`;
}

function rangeStart(range: Range, now: Date): Date {
  const start = new Date(now);
  if (range === 'week') start.setDate(start.getDate() - 6);
  else if (range === 'month') start.setDate(1);
  else if (range === 'year') start.setMonth(0, 1);
  else start.setMonth(start.getMonth() - 11, 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Clock3; label: string; value: string; hint: string }) {
  return <article className="stats-card"><span className="stats-card-icon"><Icon size={16} /></span><div><small>{label}</small><strong>{value}</strong><span>{hint}</span></div></article>;
}

export function StatisticsView({
  games,
  settings,
  onChanged,
  onOpenGame,
  onEditGame,
  onStatus,
  onAddPlanned,
  onUpdate,
  onRemove,
  onBacklogMembership,
  onJournalMembership,
  onBacklogOrder,
  onJournalOrder,
}: {
  games: Game[];
  settings: Settings;
  onChanged: () => void;
  onOpenGame: (id: string, context?: 'library' | 'backlog') => void;
  onEditGame: (id: string, hideLaunchSettings?: boolean) => void;
  onStatus: (id: string, status: GameStatus) => void;
  onAddPlanned: (game: Game) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onRemove: (id: string) => void;
  onBacklogMembership: (id: string, on: boolean) => void;
  onJournalMembership: (id: string, on: boolean) => void;
  onBacklogOrder: (ids: string[]) => void;
  onJournalOrder: (ids: string[]) => void;
}) {
  const [section, setSection] = useState<Section>('overview');
  const [range, setRange] = useState<Range>('month');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [today] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    void listSessions(5000, 0).then((rows) => { if (alive) setSessions(rows); }).catch(() => { if (alive) setSessions([]); });
    return () => { alive = false; };
  }, [games.length]);

  const backlog = useMemo(() => games.filter((game) => game.planned || onBacklogPage(game, settings.syncBacklog === true, settings.backlogOn ?? [], settings.backlogOff ?? [])), [games, settings.syncBacklog, settings.backlogOn, settings.backlogOff]);
  const journalGames = useMemo(() => games.filter((game) => onJournalPage(game, settings.syncJournal !== false, settings.journalOn ?? [], settings.journalOff ?? [])), [games, settings.syncJournal, settings.journalOn, settings.journalOff]);
  const start = useMemo(() => rangeStart(range, today), [range, today]);

  const buckets = useMemo(() => {
    const count = range === 'week' ? 7 : range === 'month' ? new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() : 12;
    const entries = Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      if (range === 'week' || range === 'month') date.setDate(start.getDate() + index);
      else date.setMonth(start.getMonth() + index, 1);
      return { key: keyFor(date, range), date, label: labelFor(date, range), rows: new Map<string, number>(), total: 0 };
    });
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    for (const session of sessions) {
      const date = new Date(session.startedAt * 1000);
      if (date < start) continue;
      const bucket = byKey.get(keyFor(date, range));
      if (!bucket) continue;
      bucket.rows.set(session.gameId, (bucket.rows.get(session.gameId) ?? 0) + session.durationSecs);
      bucket.total += session.durationSecs;
    }
    return entries;
  }, [games, range, sessions, start, today]);

  const leaderboard = useMemo(() => {
    const playedSeconds = new Map<string, number>();
    for (const session of sessions) playedSeconds.set(session.gameId, (playedSeconds.get(session.gameId) ?? 0) + session.durationSecs);
    return [...games].filter((game) => (playedSeconds.get(game.id) ?? game.playSecs) > 0)
      .sort((a, b) => (playedSeconds.get(b.id) ?? b.playSecs) - (playedSeconds.get(a.id) ?? a.playSecs)).slice(0, 6);
  }, [games, sessions]);

  const periodSeconds = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const allTimeSeconds = games.reduce((sum, game) => sum + game.playSecs, 0);
  const visibleSeconds = range === 'all' ? allTimeSeconds : periodSeconds;
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const activeDays = buckets.filter((bucket) => bucket.total > 0).length;
  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const tabs: { id: Section; label: string; Icon: typeof BarChart3; count?: number }[] = [
    { id: 'overview', label: 'Overview', Icon: BarChart3 },
    { id: 'sessions', label: 'Sessions', Icon: Clock3 },
    { id: 'backlog', label: 'Backlog', Icon: NotebookPen, count: backlog.length },
    { id: 'journal', label: 'Journal', Icon: BookOpen, count: journalGames.length },
  ];

  return (
    <div className="statistics-page">
      <header className="statistics-heading"><div><p className="statistics-eyebrow">YOUR COLLECTION</p><h1>Statistics</h1><p>Playtime, progress, and the games that make up your story.</p></div></header>
      <nav className="statistics-tabs" aria-label="Statistics sections" role="tablist">
        {tabs.map(({ id, label, Icon, count }) => <button type="button" key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}><Icon size={15} /><span>{label}</span>{count !== undefined && <small>{count}</small>}</button>)}
      </nav>

      {section === 'overview' ? <>
        <section className="statistics-hero">
          <div className="statistics-hero-art" style={leaderboard[0]?.meta?.backgroundUrl ? { backgroundImage: `url("${leaderboard[0].meta.backgroundUrl.replace(/"/g, '%22')}")` } : undefined} />
          <div className="statistics-hero-content">
            <div className="statistics-range-control" aria-label="Statistics time range">
              {(['week', 'month', 'year', 'all'] as Range[]).map((item) => <button type="button" key={item} aria-pressed={range === item} onClick={() => setRange(item)}>{item === 'all' ? 'All time' : item[0].toUpperCase() + item.slice(1)}</button>)}
            </div>
            <div className="statistics-hero-total"><small>TIME PLAYED · {range === 'all' ? 'ALL TIME' : range.toUpperCase()}</small><strong>{fmtMinutes(visibleSeconds / 60)}</strong><p>{activeDays} {activeDays === 1 ? 'day' : 'days'} played <i>·</i> {sessions.length} sessions <i>·</i> {games.length} games in your library</p></div>
          </div>
        </section>

        <div className="statistics-cards">
          <StatCard icon={Gamepad2} label="Games played" value={String(games.filter((game) => game.playSecs > 0).length)} hint={`${games.length} in your library`} />
          <StatCard icon={Clock3} label="Average session" value={sessions.length ? fmtMinutes((sessions.reduce((sum, session) => sum + session.durationSecs, 0) / sessions.length) / 60) : '—'} hint="Across recorded sessions" />
          <StatCard icon={Trophy} label="Completed" value={String(games.filter((game) => game.status === 'completed').length)} hint="Games marked complete" />
          <StatCard icon={Layers3} label="Backlog" value={String(backlog.length)} hint="Ready for your next adventure" />
        </div>

        <section className="statistics-panel statistics-chart-panel">
          <header><div><h2>Playtime</h2><p>{range === 'all' ? 'Recent monthly activity' : `Daily activity this ${range}`}</p></div><span>{Math.round((maxBucket / 3600) * 10) / 10}h peak</span></header>
          <div className={`statistics-chart is-${range}`} role="img" aria-label={`Playtime chart, ${range}`}>
            <div className="statistics-axis"><span>{Math.ceil(maxBucket / 3600)}h</span><span>{Math.ceil(maxBucket / 7200)}h</span><span>0</span></div>
            <div className="statistics-bars">{buckets.map((bucket) => <div className="statistics-bar-column" key={bucket.key} title={`${bucket.date.toLocaleDateString()}: ${fmtMinutes(bucket.total / 60)}`}>
              <div className="statistics-bar-stack">{[...bucket.rows.entries()].sort((a, b) => b[1] - a[1]).map(([id, seconds]) => {
                const game = gameById.get(id);
                return <span key={id} style={{ height: `${Math.max(1, seconds / maxBucket * 100)}%`, background: `hsl(${game?.hue ?? 205} 63% 57%)` }} />;
              })}</div><small>{bucket.label}</small>
            </div>)}</div>
          </div>
          <div className="statistics-legend">{leaderboard.slice(0, 5).map((game) => <span key={game.id}><i style={{ background: `hsl(${game.hue} 63% 57%)` }} />{game.title}</span>)}</div>
        </section>

        <section className="statistics-panel statistics-top-games">
          <header><div><h2>Top games</h2><p>Your most-played games</p></div><span>{leaderboard.length} games</span></header>
          <div>{leaderboard.length ? leaderboard.map((game) => <article key={game.id}><Cover game={game} className="statistics-game-cover" /><span className="statistics-game-copy"><b>{game.title}</b><small>{game.meta?.developer || game.meta?.releaseYear || 'In your library'}</small></span><span className="statistics-game-time">{fmtMinutes((sessions.filter((session) => session.gameId === game.id).reduce((sum, session) => sum + session.durationSecs, 0) || game.playSecs) / 60)}</span><span className="statistics-game-meter"><i style={{ width: `${Math.round((game.playSecs / Math.max(1, leaderboard[0]?.playSecs ?? 1)) * 100)}%` }} /></span></article>) : <p className="statistics-empty">Play a game to see your stats here.</p>}</div>
        </section>
      </> : section === 'sessions' ? <SessionsView games={games} onChanged={onChanged} onOpenGame={onOpenGame} />
        : section === 'backlog' ? <BacklogView games={games} onSelect={(id) => onOpenGame(id, 'backlog')} onEdit={onEditGame} onStatus={onStatus} onAdd={onAddPlanned} onUpdate={onUpdate} onRemove={onRemove} fetchMetadata={settings.fetchMetadata} syncLibrary={settings.syncBacklog === true} backlogOn={settings.backlogOn ?? []} backlogOff={settings.backlogOff ?? []} onBacklogMembership={onBacklogMembership} myOrder={settings.backlogOrder ?? []} setMyOrder={onBacklogOrder} />
          : <LogsView games={journalGames} allGames={games} onJournalMembership={onJournalMembership} onUpdate={onUpdate} onEditGame={onEditGame} order={settings.logOrder ?? []} onOrder={onJournalOrder} />}
    </div>
  );
}
