import { useCallback, useEffect, useState } from 'react';
import type { GameLog } from '../../types';
import { addGameLog, deleteGameLog, listGameLogs, updateGameLog } from '../../services/native';
import { fmtClock, fmtDate, fromLocalInput, parseDuration, toLocalInput } from '../../utils/format';
import { inputCls } from '../ui/Modal';

/** A row being written or corrected. */
interface Draft {
  id: number | null;
  at: string;
  secs: string;
  note: string;
}

const blank = (): Draft => ({
  id: null,
  at: toLocalInput(Math.floor(Date.now() / 1000)),
  secs: '',
  note: '',
});

/**
 * The player's own log for one game.
 *
 * Deliberately separate from sessions: nothing here is tracked or measured by
 * Orbit. The player writes what happened, picks the date it happened on, and
 * says how long it took, and every field can be corrected later.
 */
export function GameLogView({ gameId, gameTitle }: { gameId: string; gameTitle: string }) {
  const [rows, setRows] = useState<GameLog[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    void listGameLogs(gameId).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [gameId]);

  useEffect(() => load(), [load]);

  // Newest first, and the running total of what the notes claim.
  const total = rows.reduce((s, r) => s + r.secs, 0);

  const save = async () => {
    if (!draft) return;
    const secs = parseDuration(draft.secs);
    if (secs === null) {
      setError('That is not a length of time. Try 10h, 45m, or 90.');
      return;
    }
    const at = fromLocalInput(draft.at);
    if (at === null) {
      setError('That is not a date.');
      return;
    }
    setError(null);
    try {
      if (draft.id === null) await addGameLog(gameId, at, secs, draft.note);
      else await updateGameLog(draft.id, at, secs, draft.note);
      setDraft(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Log</h3>
          <p className="text-xs text-muted">Your notes about {gameTitle}. Nothing here is tracked for you.</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold">{fmtClock(total)}</p>
          <p className="text-[11px] text-muted">across {rows.length} {rows.length === 1 ? 'note' : 'notes'}</p>
        </div>
      </div>

      {draft ? (
        <div className="mb-4 space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-muted">When</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={draft.at}
                onChange={(e) => setDraft({ ...draft, at: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-muted">How long</span>
              <input
                className={inputCls}
                value={draft.secs}
                onChange={(e) => setDraft({ ...draft, secs: e.target.value })}
                placeholder="10h, 45m, or 90"
                spellCheck={false}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest text-muted">What happened</span>
            <input
              className={inputCls}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="finished main story"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
          </label>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white">
              Save note
            </button>
            <button onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-fg">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setError(null);
            setDraft(blank());
          }}
          className="mb-4 w-full rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-accent hover:text-fg"
        >
          Add a note
        </button>
      )}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          Nothing written yet. Finished the story, beat the DLC, went back to an older save — those go here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="group flex items-center gap-3 rounded-lg bg-bg/60 px-3 py-2 text-sm">
              <span className="w-20 shrink-0 font-mono text-xs text-muted">{fmtDate(new Date(r.at * 1000).toISOString())}</span>
              <span className="w-16 shrink-0 font-mono text-xs font-semibold text-accent">{fmtShort(r.secs)}</span>
              <span className="min-w-0 flex-1 truncate">{r.note || <span className="text-muted">no note</span>}</span>
              <span className="hidden gap-2 group-hover:flex">
                <button
                  onClick={() => {
                    setError(null);
                    setDraft({ id: r.id, at: toLocalInput(r.at), secs: fmtShort(r.secs), note: r.note });
                  }}
                  className="text-xs text-muted hover:text-accent"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm('Remove this note?')) {
                      void deleteGameLog(r.id).then(load);
                    }
                  }}
                  className="text-xs text-muted hover:text-rose-400"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `10h 08m` for an edit box, which round-trips through `parseDuration`. */
function fmtShort(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
