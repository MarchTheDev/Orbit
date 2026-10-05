import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Game, Session } from '../../types';
import { deleteSession, listSessions } from '../../services/native';
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
  onChanged,
  reloadKey = 0,
}: {
  game: Game;
  onEdit?: (s: Session) => void;
  /** A session was removed, so the numbers around this list need reading again. */
  onChanged?: () => void;
  /** Bumped when a session is corrected, since the count does not change then. */
  reloadKey?: number;
}) {
  const [rows, setRows] = useState<Session[]>([]);
  const [limit, setLimit] = useState(5);

  const load = () => {
    let alive = true;
    void listSessions(limit, 0, game.id).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  };

  useEffect(load, [game.id, game.sessionCount, limit, reloadKey]);

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
                  className="shrink-0 text-muted hover:text-accent"
                  title="Correct when it started and how long it ran"
                  aria-label={`Edit the ${fmtClock(s.durationSecs)} session`}
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  if (!confirm(`Remove this ${fmtClock(s.durationSecs)} session?`)) return;
                  void deleteSession(s.id).then(() => {
                    load();
                    onChanged?.();
                  });
                }}
                className="shrink-0 text-muted hover:text-rose-400"
                title="Remove this session"
                aria-label={`Remove the ${fmtClock(s.durationSecs)} session`}
              >
                <Trash2 className="size-3.5" />
              </button>
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
