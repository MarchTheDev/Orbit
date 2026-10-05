import { useEffect, useState } from 'react';
import type { Game, Session } from '../../types';
import { listSessions } from '../../services/native';
import { fmtClock, fmtDateTime } from '../../utils/format';

/**
 * The sessions behind this game's total.
 *
 * Read from the same rows the Sessions page shows, so the two can never
 * disagree about how long something was played. `sessionCount` is a dependency
 * because it changes the moment a session is added or removed, which is how the
 * list knows to read itself again after a game is stopped.
 */
export function SessionHistory({
  game,
  onEdit,
  reloadKey = 0,
}: {
  game: Game;
  onEdit?: (s: Session) => void;
  /** Bumped when a session is corrected, since the count does not change then. */
  reloadKey?: number;
}) {
  const [rows, setRows] = useState<Session[]>([]);
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    let alive = true;
    void listSessions(limit, 0, game.id).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [game.id, game.sessionCount, limit, reloadKey]);

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recent sessions</h3>
        <span className="text-xs text-muted">{game.sessionCount} in total</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted">Nothing logged yet. Press Play and the time lands here.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((s) => (
            <li key={s.id} className="group flex items-center gap-3 rounded-lg bg-bg/60 px-3 py-2 text-sm">
              <span className="font-mono font-semibold text-accent">{fmtClock(s.durationSecs)}</span>
              <span className="flex-1 truncate text-xs text-muted">{s.category || s.note || 'Playing'}</span>
              <span className="text-[10px] text-muted">{fmtDateTime(s.startedAt)}</span>
              {onEdit && (
                <button
                  onClick={() => onEdit(s)}
                  className="hidden shrink-0 text-xs text-accent group-hover:block"
                  title="Correct when it started and how long it ran"
                >
                  Edit
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {game.sessionCount > rows.length && (
        <button onClick={() => setLimit((n) => n + 5)} className="mt-2 text-xs text-accent hover:underline">
          Show more
        </button>
      )}
    </section>
  );
}