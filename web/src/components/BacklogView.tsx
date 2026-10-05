import { useState } from 'react';
import type { Game, GameStatus } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';

/**
 * What is waiting to be played, and what is part-way through.
 *
 * The library filter can already narrow to these, but it hides them among every
 * other game. This page exists for the question a player actually asks, which is
 * what to start next, so the two lists sit side by side and a status can be moved
 * without opening a game first.
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

  const match = (g: Game) => !query || g.title.toLowerCase().includes(query.toLowerCase());
  const backlog = games.filter((g) => g.status === 'backlog' && match(g));
  const playing = games.filter((g) => g.status === 'playing' && match(g));
  const dropped = games.filter((g) => g.status === 'dropped' && match(g));

  const backlogHours = backlog.reduce((s, g) => s + (g.hltb?.main ?? 0), 0);

  return (
    <div className="space-y-8 px-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Backlog</h1>
          <p className="mt-1 text-sm text-muted">
            {backlog.length} waiting
            {backlogHours > 0 && ` · about ${Math.round(backlogHours)}h of story left`}
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="w-56 rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </header>

      <Section title="Playing now" games={playing} empty="Nothing part-way through." onSelect={onSelect} onStatus={onStatus} onPlay={onPlay} />
      <Section title="Up next" games={backlog} empty="Nothing waiting. Drop a game onto Orbit to add one." onSelect={onSelect} onStatus={onStatus} onPlay={onPlay} />
      <Section title="Set aside" games={dropped} empty="Nothing set aside." onSelect={onSelect} onStatus={onStatus} onPlay={onPlay} />
    </div>
  );
}

function Section({
  title,
  games,
  empty,
  onSelect,
  onStatus,
  onPlay,
}: {
  title: string;
  games: Game[];
  empty: string;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  onPlay: (g: Game) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-muted">
        {title} · {games.length}
      </h2>
      {games.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((g) => (
            <li key={g.id} className="glass group flex items-center gap-3 rounded-2xl p-3">
              <button onClick={() => onSelect(g.id)} className="shrink-0" title={`Open ${g.title}`}>
                <Cover game={g} className="size-16 rounded-xl transition group-hover:scale-105 [&_span]:text-sm" />
              </button>
              <div className="min-w-0 flex-1">
                <button onClick={() => onSelect(g.id)} className="block max-w-full truncate text-left text-sm font-semibold hover:text-accent">
                  {g.title}
                </button>
                <p className="mt-0.5 text-xs text-muted">
                  {fmtMinutes(g.playMinutes)} played
                  {g.lastPlayed && ` · ${fmtDate(g.lastPlayed)}`}
                </p>
                {g.hltb && g.hltb.main > 0 && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line" title={`${Math.round((g.playMinutes / 60 / g.hltb.main) * 100)}% of the main story`}>
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, (g.playMinutes / 60 / g.hltb.main) * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                  onClick={() => onPlay(g)}
                  title={`Play ${g.title}`}
                  className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  Play
                </button>
                <select
                  value={g.status}
                  onChange={(e) => onStatus(g.id, e.target.value as GameStatus)}
                  title="Move between lists"
                  className="rounded-md border border-line bg-panel px-1 py-0.5 text-[10px] capitalize outline-none"
                >
                  <option value="backlog" className="bg-panel">Backlog</option>
                  <option value="playing" className="bg-panel">Playing</option>
                  <option value="completed" className="bg-panel">Completed</option>
                  <option value="dropped" className="bg-panel">Set aside</option>
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
