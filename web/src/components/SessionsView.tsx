import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Game, Session, Stats } from '../types';
import { DEFAULT_CATEGORY } from '../data/categories';
import {
  countSessions,
  deleteSession,
  libraryStats,
  listSessions,
  logManualSession,
  updateSession,
} from '../services/native';
import { fmtClock, fmtDate, fmtDateTime, fmtEndedBy, fromLocalInput, parseDuration, toLocalInput } from '../utils/format';
import { Modal, btnGhost, btnPrimary, inputCls } from './ui/Modal';
import { Select } from './ui/Select';
import { DateTimePicker } from './ui/DateTimePicker';

const PAGE = 25;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-bold">{value}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function SessionsView({ games, onChanged }: { games: Game[]; onChanged: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [gameFilter, setGameFilter] = useState('');
  const [editing, setEditing] = useState<Session | null>(null);
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    const [rows, count, totals] = await Promise.all([
      listSessions(PAGE, page * PAGE, gameFilter || undefined),
      countSessions(gameFilter || undefined),
      libraryStats(),
    ]);
    setSessions(rows);
    setTotal(count);
    setStats(totals);
  }, [page, gameFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // A finished session changes the totals, so anything that starts or stops one
  // brings this page back into line.
  useEffect(() => {
    const api = (window as Window & { __TAURI__?: { event: { listen: (n: string, h: (e: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__?.event;
    if (!api) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void api.listen('session-ended', () => {
      void load();
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [load]);

  const remove = async (row: Session) => {
    if (!confirm(`Remove this ${fmtClock(row.durationSecs)} session of ${row.gameTitle}?`)) return;
    await deleteSession(row.id);
    onChanged();
    void load();
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const played = useMemo(
    () =>
      [...games]
        .filter((g) => g.sessionCount > 0)
        .sort((a, b) => b.playSecs - a.playSecs)
        .slice(0, 8),
    [games],
  );

  return (
    <div className="mx-6 mt-5 space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Games tracked"
            value={String(stats.trackedGames)}
            hint={`of ${stats.totalGames} in the library`}
          />
          <Stat label="Sessions" value={String(stats.sessionCount)} />
          <Stat
            label="Longest session"
            value={stats.longestSecs > 0 ? fmtClock(stats.longestSecs) : '-'}
          />
          {/* From the sessions alone. The library's own total includes time
              typed in by hand, which is not a session and was dragging this
              number away from anything anybody had actually played. */}
          <Stat
            label="Average session"
            value={stats.sessionCount > 0 ? fmtClock(Math.round(stats.sessionSecs / stats.sessionCount)) : '-'}
          />
          <Stat label="First played" value={stats.firstPlay ? fmtDate(new Date(stats.firstPlay * 1000).toISOString()) : '-'} />
        </div>
      )}

      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Sessions</h2>
          <Select
            value={gameFilter}
            onChange={(v) => {
              setGameFilter(v);
              setPage(0);
            }}
            className="w-56"
            menuClassName="w-56"
            ariaLabel="Which game's sessions to show"
            options={[{ value: '', label: 'Every game' }, ...games.map((g) => ({ value: g.id, label: g.title }))]}
          />
          <div className="flex-1" />
          <button
            className={`${btnGhost} flex items-center gap-2`}
            onClick={() => setLogging(true)}
            disabled={games.length === 0}
          >
            <Plus className="size-4" />
            Log time by hand
          </button>
        </div>

        {sessions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            {total === 0 ? 'No sessions yet. Press Play on a game and it will show up here.' : 'Nothing on this page.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-widest text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Game</th>
                  <th className="py-2 pr-3 font-medium">Started</th>
                  <th className="py-2 pr-3 font-medium">Played</th>
                  <th className="py-2 pr-3 font-medium">Ended</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-line/60 hover:bg-panel2/60">
                    <td className="py-2 pr-3 font-medium">{s.gameTitle}</td>
                    <td className="py-2 pr-3 text-muted">{fmtDateTime(s.startedAt)}</td>
                    <td className="py-2 pr-3 font-mono">{fmtClock(s.durationSecs)}</td>
                    <td className="py-2 pr-3 text-xs text-muted">{fmtEndedBy(s.endedBy, s.manual)}</td>
                    {/* The buttons sit a comfortable distance from the edge of
                        the table rather than up against it: a Remove button half
                        a step from the border is one misclick from being wrong. */}
                    <td className="py-2 pl-6 pr-4 text-right whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-accent hover:border-accent"
                        onClick={() => setEditing(s)}
                        title="Correct when it started and how long it ran"
                      >
                        <Pencil className="size-3" />
                        Edit
                      </button>
                      <button
                        className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-rose-400 hover:text-rose-400"
                        onClick={() => void remove(s)}
                        title="Remove this session"
                      >
                        <Trash2 className="size-3" />
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button className={btnGhost} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="text-muted">
              Page {page + 1} of {pages}
            </span>
            <button className={btnGhost} disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

      {played.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">Most played</h2>
          <div className="space-y-2">
            {played.map((g) => {
              const top = played[0].playSecs || 1;
              return (
                <div key={g.id} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm">{g.title}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-accent2"
                      style={{ width: `${Math.max(2, (g.playSecs / top) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right font-mono text-xs text-muted">{fmtClock(g.playSecs)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && <EditSession row={editing} onClose={() => setEditing(null)} onSaved={() => { onChanged(); void load(); }} />}
      {logging && (
        <LogSession
          games={games}
          onClose={() => setLogging(false)}
          onSaved={() => { onChanged(); void load(); }}
        />
      )}
    </div>
  );
}

export function EditSession({ row, onClose, onSaved }: { row: Session; onClose: () => void; onSaved: () => void }) {
  const [hours, setHours] = useState(Math.floor(row.durationSecs / 3600));
  const [minutes, setMinutes] = useState(Math.floor((row.durationSecs % 3600) / 60));
  const [at, setAt] = useState(toLocalInput(row.startedAt));
  const [note, setNote] = useState(row.note);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const secs = hours * 3600 + minutes * 60;
    if (secs <= 0) {
      setError('A session has to be longer than zero.');
      return;
    }
    const startedAt = fromLocalInput(at);
    if (startedAt === null) {
      setError('That is not a date.');
      return;
    }
    setError(null);
    // The category is left exactly as it was: it is not something the player
    // picks any more, and rewriting it here would change a stored row for no
    // reason.
    await updateSession(row.id, startedAt, secs, row.category || DEFAULT_CATEGORY, note);
    onSaved();
    onClose();
  };

  return (
    <Modal title="Edit session" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-sm text-muted">{row.gameTitle}</p>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">When it started</span>
          <DateTimePicker value={at} onChange={setAt} />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1 text-sm">
            <span className="mb-1 block text-muted">Hours</span>
            <input type="number" min={0} value={hours} onChange={(e) => setHours(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="block flex-1 text-sm">
            <span className="mb-1 block text-muted">Minutes</span>
            <input type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={`${btnGhost} flex items-center gap-2`} onClick={onClose}>
            <X className="size-4" />
            Cancel
          </button>
          <button className={`${btnPrimary} flex items-center gap-2`}>
            <Check className="size-4" />
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Time played somewhere Orbit cannot see.
 *
 * Exported because the same form belongs inside a game's own drawer, where the
 * game is already chosen: passing one in preselects it and hides the picker
 * rather than making the player choose the same game twice.
 */
export function LogSession({
  games,
  initialGameId,
  onClose,
  onSaved,
}: {
  games: Game[];
  initialGameId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [gameId, setGameId] = useState(initialGameId ?? games[0]?.id ?? '');
  const [at, setAt] = useState(() => toLocalInput(Math.floor(Date.now() / 1000)));
  const [duration, setDuration] = useState('1h');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const secs = parseDuration(duration);
    if (secs === null || secs <= 0) {
      setError('That is not a length of time. Try 1h, 45m, or 90.');
      return;
    }
    const startedAt = fromLocalInput(at);
    if (startedAt === null) {
      setError('That is not a date.');
      return;
    }
    if (!gameId) return;
    setError(null);
    await logManualSession(gameId, startedAt, secs, DEFAULT_CATEGORY, note);
    onSaved();
    onClose();
  };

  return (
    <Modal title="Log time by hand" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Clock className="size-3.5" />
          For playing somewhere Orbit cannot see, such as a console or a handheld.
        </p>
        {!initialGameId && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Game</span>
            <Select
              value={gameId}
              onChange={setGameId}
              ariaLabel="Which game this time is for"
              options={games.map((g) => ({ value: g.id, label: g.title }))}
            />
          </label>
        )}
        <div className="flex gap-3">
          <label className="block flex-1 text-sm">
            <span className="mb-1 block text-muted">When</span>
            <DateTimePicker value={at} onChange={setAt} />
          </label>
          <label className="block flex-1 text-sm">
            <span className="mb-1 block text-muted">How long</span>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="1h 30m"
              spellCheck={false}
              className={inputCls}
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you get through?"
            className={inputCls}
          />
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary}>Save session</button>
        </div>
      </form>
    </Modal>
  );
}
