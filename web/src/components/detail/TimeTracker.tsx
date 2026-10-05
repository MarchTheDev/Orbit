import { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import type { Game } from '../../types';
import { fmtClock, parseDuration } from '../../utils/format';
import { inputCls } from '../ui/Modal';

interface Props {
  game: Game;
  /** When the running session started, in milliseconds, or null. */
  startedAt: number | null;
  now: number;
  /** Writes the total the player wants to see, in seconds. Rejects if refused. */
  onSetTotal: (totalSecs: number) => Promise<void>;
  /** The message from a refused write, or null. */
  error?: string | null;
}

/**
 * Where the playtime came from.
 *
 * The sessions are the record and cannot be edited from here, so the total is
 * changed by writing the number the player wants to see. Rust works out the
 * difference and keeps it as a correction, which means the total is editable
 * whether or not the game has any sessions yet.
 */
export function TimeTracker({ game, startedAt, now, onSetTotal, error }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const live = startedAt ? Math.floor((now - startedAt) / 1000) : 0;

  // Open the editor showing the number in the same shape it is typed back in.
  useEffect(() => {
    if (editing) setVal(fmtDuration(game.playSecs));
  }, [editing, game.playSecs]);

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Playtime</h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs text-accent hover:underline"
            title="Type the total you want to see"
          >
            <Pencil className="size-3.5" />
            Edit total
          </button>
        )}
      </div>

      {editing ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const secs = parseDuration(val);
            if (secs === null) {
              // Silent failure here would look like the button is broken.
              setBad('That does not look like a playtime. Try 12h 30m, or 450.');
              return;
            }
            setBad(null);
            setSaving(true);
            try {
              await onSetTotal(secs);
              // Only now is the number actually stored, so this is the only
              // point where closing is honest.
              setEditing(false);
            } catch (err) {
              setBad(err instanceof Error ? err.message : String(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="flex gap-2">
            <input
              autoFocus
              value={val}
              onChange={(e) => {
                setVal(e.target.value);
                setBad(null);
              }}
              placeholder="e.g. 12h 30m, or 450"
              className={inputCls}
              spellCheck={false}
            />
            <button
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-60"
            >
              <Check className="size-4" />
              {saving ? 'Saving' : 'Save'}
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:text-fg"
              onClick={() => setEditing(false)}
            >
              <X className="size-4" />
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Hours, minutes or seconds. Sessions are kept, and the difference is remembered.
          </p>
          {(bad ?? error) && <p className="text-[11px] text-rose-400">{bad ?? error}</p>}
        </form>
      ) : (
        <>
          <p className="text-3xl font-bold">{fmtClock(game.playSecs + live)}</p>
          {game.sessionCount > 0 && (
            <p className="mt-1 text-xs text-muted">
              {game.sessionCount} {game.sessionCount === 1 ? 'session' : 'sessions'}
              {game.longestSecs > 0 && ` · longest ${fmtClock(game.longestSecs)}`}
            </p>
          )}
          {game.manualPlaySecs > 0 && (
            <p className="mt-1 text-xs text-muted">
              including {fmtClock(game.manualPlaySecs)} played away from Orbit
            </p>
          )}
        </>
      )}

      {startedAt !== null && (
        <p className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
          <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
          Session running · {fmtClock(live)}
        </p>
      )}
    </section>
  );
}

/** Show a duration the way it would be typed in: `12h 30m`. */
function fmtDuration(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  if (h === 0 && m === 0) return `${totalSecs}s`;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
