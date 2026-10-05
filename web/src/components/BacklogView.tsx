import { useMemo, useState } from 'react';
import { CircleCheck, CircleDashed, Clock, Hourglass, Play, Search, SquareArrowRight, Undo2 } from 'lucide-react';
import type { Game, GameStatus } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';

/** The order the waiting list is read in. */
type Order = 'shortest' | 'longest' | 'added';

const ORDERS: { id: Order; label: string; icon: typeof Clock }[] = [
  { id: 'shortest', label: 'Shortest first', icon: Hourglass },
  { id: 'longest', label: 'Longest first', icon: Clock },
];

/**
 * What is waiting to be played, and what is part-way through.
 *
 * The library filter can already narrow to these, but it hides them among every
 * other game. This page exists for the question a player actually asks, which is
 * what to start next, so the lanes sit together and a status can be moved
 * without opening a game first. Sorting the waiting list by how long it takes to
 * beat is the difference between a pile and a plan.
 */
export function BacklogView({
  games,
  onSelect,
  onStatus,
  onPlay,
}: {
  games: Game[];
  onSelect: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  onPlay: (g: Game) => void;
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('shortest');

  const match = (g: Game) => !query || g.title.toLowerCase().includes(query.toLowerCase());

  const backlog = useMemo(() => {
    const list = games.filter((g) => g.status === 'backlog' && match(g));
    const byLength = (g: Game) => g.hltb?.main ?? Number.POSITIVE_INFINITY;
    const sorted = [...list].sort((a, b) => {
      if (order === 'shortest') return byLength(a) - byLength(b) || a.title.localeCompare(b.title);
      if (order === 'longest') return byLength(b) - byLength(a) || a.title.localeCompare(b.title);
      return b.addedAt.localeCompare(a.addedAt);
    });
    return sorted;
  }, [games, query, order]);

  const playing = games.filter((g) => g.status === 'playing' && match(g));
  const completed = games.filter((g) => g.status === 'completed' && match(g));
  const dropped = games.filter((g) => g.status === 'dropped' && match(g));

  const backlogHours = backlog.reduce((s, g) => s + (g.hltb?.main ?? 0), 0);
  const unknown = backlog.filter((g) => !g.hltb?.main).length;

  return (
    <div className="space-y-8 px-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Backlog</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{backlog.length} waiting</span>
            {backlogHours > 0 && (
              <span className="flex items-center gap-1">
                <Hourglass className="size-3.5" />
                about {Math.round(backlogHours)}h of main story
              </span>
            )}
            {unknown > 0 && <span title="HowLongToBeat has no time for these yet">· {unknown} unknown</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass flex rounded-full p-1">
            {ORDERS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOrder(o.id)}
                title={o.label}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  order === o.id ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                <o.icon className="size-3.5" />
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="glass w-56 rounded-full py-2 pl-10 pr-4 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      </header>

      <Section
        title="Playing now"
        icon={Play}
        games={playing}
        empty="Nothing part-way through."
        onSelect={onSelect}
        onStatus={onStatus}
        onPlay={onPlay}
      />
      <Section
        title="Up next"
        icon={CircleDashed}
        games={backlog}
        empty="Nothing waiting. Drop a game onto Orbit to add one."
        onSelect={onSelect}
        onStatus={onStatus}
        onPlay={onPlay}
      />
      <Section
        title="Set aside"
        icon={SquareArrowRight}
        games={dropped}
        empty="Nothing set aside."
        onSelect={onSelect}
        onStatus={onStatus}
        onPlay={onPlay}
      />
      {completed.length > 0 && (
        <Section
          title="Completed"
          icon={CircleCheck}
          games={completed}
          empty="Nothing finished yet."
          onSelect={onSelect}
          onStatus={onStatus}
          onPlay={onPlay}
        />
      )}
    </div>
  );
}

/** What a game's status can be moved to from here, without opening it. */
const MOVES: { status: GameStatus; label: string; icon: typeof Play }[] = [
  { status: 'playing', label: 'Playing', icon: Play },
  { status: 'backlog', label: 'Backlog', icon: Undo2 },
  { status: 'completed', label: 'Completed', icon: CircleCheck },
  { status: 'dropped', label: 'Set aside', icon: SquareArrowRight },
];

function Section({
  title,
  icon: Icon,
  games,
  empty,
  onSelect,
  onStatus,
  onPlay,
}: {
  title: string;
  icon: typeof Play;
  games: Game[];
  empty: string;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  onPlay: (g: Game) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-muted">
        <Icon className="size-3.5" />
        {title} · {games.length}
      </h2>
      {games.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((g) => {
            const main = g.hltb?.main ?? 0;
            const left = Math.max(0, main - g.playMinutes / 60);
            return (
              <li key={g.id} className="glass group flex items-center gap-3 rounded-2xl p-3">
                <button onClick={() => onSelect(g.id)} className="shrink-0" title={`Open ${g.title}`}>
                  <Cover game={g} className="size-16 rounded-xl transition group-hover:scale-105 [&_span]:text-sm" />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => onSelect(g.id)}
                    className="block max-w-full truncate text-left text-sm font-semibold hover:text-accent"
                  >
                    {g.title}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                    <span>{fmtMinutes(g.playMinutes)} played</span>
                    {g.lastPlayed && <span>· {fmtDate(g.lastPlayed)}</span>}
                    {main > 0 && (
                      <span className="flex items-center gap-1" title={`HowLongToBeat: ${main}h for the main story`}>
                        <Hourglass className="size-3" />
                        {left > 0.5 ? `${Math.round(left)}h left` : 'almost done'}
                      </span>
                    )}
                  </p>
                  {main > 0 && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line" title={`${Math.round((g.playMinutes / 60 / main) * 100)}% of the main story`}>
                      <div className="h-full bg-accent" style={{ width: `${Math.min(100, (g.playMinutes / 60 / main) * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    onClick={() => onPlay(g)}
                    title={`Play ${g.title}`}
                    className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-accent to-accent2 px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    <Play className="size-3" fill="currentColor" strokeWidth={0} />
                    Play
                  </button>
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    {MOVES.filter((m) => m.status !== g.status).map((m) => (
                      <button
                        key={m.status}
                        onClick={() => onStatus(g.id, m.status)}
                        title={`Move to ${m.label}`}
                        aria-label={`Move ${g.title} to ${m.label}`}
                        className="rounded-md border border-line bg-panel p-1 text-muted hover:border-accent hover:text-accent"
                      >
                        <m.icon className="size-3" />
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
