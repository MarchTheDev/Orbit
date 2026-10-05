import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { Game, GameLog } from '../types';
import { countLogs, listAllLogs } from '../services/native';
import { fmtClock } from '../utils/format';
import { Cover } from './ui/Cover';
import { GameLogView } from './detail/GameLogView';
import { SearchField } from './ui/SearchField';

/**
 * The journal: every game's notes, in one place.
 *
 * The game's own drawer is fine for a glance, but a journal you write in a 460px
 * column is cramped the moment an entry is more than a line long. This is the
 * same thing with the whole window to use: pick a game on the left, read and
 * write on the right.
 *
 * The counts come from one read of every entry rather than a request per game,
 * which is why `list_all_logs` exists at all.
 */
export function LogsView({ games, onUpdate }: { games: Game[]; onUpdate: (id: string, patch: Partial<Game>) => void }) {
  const [logs, setLogs] = useState<GameLog[]>([]);
  /** How many there are in total, which can be more than were read. */
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    let alive = true;
    void Promise.all([listAllLogs(2000, 0), countLogs()])
      .then(([rows, count]) => {
        if (!alive) return;
        setLogs(rows);
        setTotal(count);
      })
      .catch(() => {
        // A failed read leaves the page empty rather than broken; the per-game
        // view still works on its own.
      });
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => load(), [load]);

  /** Notes and time per game, worked out once per read. */
  const perGame = useMemo(() => {
    const map = new Map<string, { count: number; secs: number }>();
    for (const log of logs) {
      const found = map.get(log.gameId) ?? { count: 0, secs: 0 };
      found.count += 1;
      found.secs += log.secs;
      map.set(log.gameId, found);
    }
    return map;
  }, [logs]);

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games
      .filter((g) => !q || g.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const ac = perGame.get(a.id)?.count ?? 0;
        const bc = perGame.get(b.id)?.count ?? 0;
        if (ac !== bc) return bc - ac;
        return a.title.localeCompare(b.title);
      });
  }, [games, perGame, query]);

  const selected = games.find((g) => g.id === selectedId) ?? ordered.find((g) => perGame.has(g.id)) ?? ordered[0] ?? null;
  const totalSecs = logs.reduce((s, l) => s + l.secs, 0);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <NotebookPen className="size-6 text-accent" />
            Journal
          </h1>
          <p className="mt-1 text-sm text-muted">
            Everything you have written down, game by game, next to the notes for each one. Orbit also writes the first
            entry itself: the moment a game is played for the first time, a line saying so appears here.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{fmtClock(totalSecs)}</p>
          <p className="text-[11px] text-muted">
            across {logs.length} {logs.length === 1 ? 'note' : 'notes'} in {perGame.size}{' '}
            {perGame.size === 1 ? 'game' : 'games'}
            {total > logs.length && ` · the latest ${logs.length} of ${total}`}
          </p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-3">
          <SearchField value={query} onChange={setQuery} placeholder="Find a game" className="w-full" inputClassName="w-full" />

          <ul className="space-y-1 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto lg:pr-1">
            {ordered.map((g) => {
              const counts = perGame.get(g.id);
              const active = selected?.id === g.id;
              return (
                <li key={g.id}>
                  <button
                    onClick={() => setSelectedId(g.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition ${
                      active ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60'
                    }`}
                  >
                    <Cover game={g} className="size-9 shrink-0 rounded-lg [&_span]:text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{g.title}</span>
                      <span className="block text-[11px] text-muted">
                        {counts ? `${counts.count} ${counts.count === 1 ? 'note' : 'notes'} · ${fmtClock(counts.secs)}` : 'no notes yet'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {ordered.length === 0 && <li className="px-2 py-3 text-sm text-muted">No games match that.</li>}
          </ul>
        </aside>

        <section className="min-w-0">
          {selected ? (
            <GameLogView
              key={`${selected.id}-${version}`}
              game={selected}
              onChanged={() => setVersion((n) => n + 1)}
              onNotes={(notes) => onUpdate(selected.id, { notes })}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-24 text-muted">
              <NotebookPen className="size-8 opacity-60" />
              <p className="text-sm">Add a game and its log shows up here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
