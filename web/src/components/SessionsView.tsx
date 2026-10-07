import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Info, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Game, Session, Stats } from '../types';
import { DEFAULT_CATEGORY } from '../data/categories';
import {
  countSessions,
  deleteSession,
  libraryStats,
  listSessions,
  logManualSession,
  setPlaytime,
  updateSession,
} from '../services/native';
import {
  fmtClock,
  fmtDate,
  fmtDateTime,
  fmtEndedBy,
  fromLocalInput,
  parseDuration,
  playtimeToSeconds,
  splitPlaytime,
  toLocalInput,
} from '../utils/format';
import { Modal, btnGhost, btnPrimary, inputCls } from './ui/Modal';
import { Cover } from './ui/Cover';
import { ContextMenu, type MenuItem } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';
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

export function SessionsView({
  games,
  onChanged,
  onOpenGame,
}: {
  games: Game[];
  onChanged: () => void;
  onOpenGame: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [gameFilter, setGameFilter] = useState('');
  const [editing, setEditing] = useState<Session | null>(null);
  const [logging, setLogging] = useState(false);
  const [loggingGameId, setLoggingGameId] = useState<string | null>(null);
  const [context, setContext] = useState<
    | { kind: 'session'; x: number; y: number; row: Session }
    | { kind: 'game'; x: number; y: number; game: Game }
    | null
  >(null);
  const [removing, setRemoving] = useState<Session | null>(null);
  const [playtimeGame, setPlaytimeGame] = useState<Game | null>(null);
  const [playtimeHours, setPlaytimeHours] = useState('');
  const [playtimeMinutes, setPlaytimeMinutes] = useState('');
  const [playtimeSeconds, setPlaytimeSeconds] = useState('');
  const [playtimeError, setPlaytimeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const played = useMemo(
    () =>
      [...games]
        .filter((g) => g.sessionCount > 0 || g.playSecs > 0)
        .sort((a, b) => b.playSecs - a.playSecs)
        .slice(0, 8),
    [games],
  );

  const beginPlaytimeEdit = (game: Game) => {
    setPlaytimeGame(game);
    const parts = splitPlaytime(game.playSecs);
    setPlaytimeHours(String(parts.hours));
    setPlaytimeMinutes(String(parts.minutes));
    setPlaytimeSeconds(String(parts.seconds));
    setPlaytimeError(null);
  };

  const savePlaytime = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!playtimeGame) return;
    const raw = [playtimeHours, playtimeMinutes, playtimeSeconds];
    const values = raw.map((value) => value.trim() && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN);
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      setPlaytimeError('Enter whole, non-negative hours, minutes, and seconds.');
      return;
    }
    const totalSecs = playtimeToSeconds({ hours: values[0], minutes: values[1], seconds: values[2] });
    if (totalSecs === null) {
      setPlaytimeError('Minutes and seconds must each be between 0 and 59.');
      return;
    }
    setPlaytimeError(null);
    try {
      await setPlaytime(playtimeGame.id, totalSecs);
      onChanged();
      await load();
      setPlaytimeGame(null);
    } catch (reason) {
      setPlaytimeError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const contextItems: MenuItem[] = context
    ? context.kind === 'session'
      ? [
          { kind: 'label', label: context.row.gameTitle },
          { label: 'Edit session…', icon: Pencil, onSelect: () => setEditing(context.row) },
          { label: 'Open game details', icon: Info, onSelect: () => onOpenGame(context.row.gameId) },
          { kind: 'sep' },
          { label: 'Delete session…', icon: Trash2, danger: true, onSelect: () => setRemoving(context.row) },
        ]
      : [
          { kind: 'label', label: context.game.title },
          { label: 'Open game details', icon: Info, onSelect: () => onOpenGame(context.game.id) },
          { label: 'Edit total playtime…', icon: Clock, onSelect: () => beginPlaytimeEdit(context.game) },
          { kind: 'sep' },
          {
            label: 'Log time by hand…',
            icon: Plus,
            onSelect: () => {
              setLoggingGameId(context.game.id);
              setLogging(true);
            },
          },
        ]
    : [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-6 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Sessions</h1>
          <p className="mt-0.5 text-sm text-muted">Tracked playtime and hand-logged sessions.</p>
        </div>
        <button
          className={`${btnGhost} ml-auto flex shrink-0 items-center gap-2`}
          onClick={() => {
            setLoggingGameId(null);
            setLogging(true);
          }}
          disabled={games.length === 0}
        >
          <Plus className="size-4" />
          Log time by hand
        </button>
      </header>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Games tracked" value={String(stats.trackedGames)} hint={`of ${stats.totalGames} in the library`} />
          <Stat label="Sessions" value={String(stats.sessionCount)} />
          <Stat label="Longest session" value={stats.longestSecs > 0 ? fmtClock(stats.longestSecs) : '-'} />
          <Stat label="Average session" value={stats.sessionCount > 0 ? fmtClock(Math.round(stats.sessionSecs / stats.sessionCount)) : '-'} />
          <Stat label="First played" value={stats.firstPlay ? fmtDate(new Date(stats.firstPlay * 1000).toISOString()) : '-'} />
        </div>
      )}

      <section className="glass rounded-3xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-lg font-semibold">Session history</h2>
            <p className="mt-0.5 text-xs text-muted">Right-click a session to edit, open its game, or remove it.</p>
          </div>
          <Select
            value={gameFilter}
            onChange={(value) => {
              setGameFilter(value);
              setPage(0);
            }}
            className="w-56"
            menuClassName="w-56"
            ariaLabel="Which game's sessions to show"
            options={[{ value: '', label: 'Every game' }, ...games.map((g) => ({ value: g.id, label: g.title }))]}
          />
        </div>

        {actionError && <p role="alert" className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{actionError}</p>}
        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-4 py-14 text-center">
            <Clock className="mx-auto size-8 text-muted/70" />
            <p className="mt-2 text-sm font-medium">{total === 0 ? 'No sessions yet' : 'Nothing on this page'}</p>
            <p className="mt-1 text-xs text-muted">{total === 0 ? 'Press Play on a game or log time by hand to start your history.' : 'Try another page or clear the game filter.'}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sessions.map((row) => {
              const game = games.find((candidate) => candidate.id === row.gameId);
              return (
                <li
                  key={row.id}
                  data-orbit-session={row.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActionError(null);
                    setContext({ kind: 'session', x: event.clientX, y: event.clientY, row });
                  }}
                  className="group grid gap-3 rounded-2xl border border-line/70 bg-panel/35 p-3 transition hover:border-accent/40 hover:bg-panel/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <button
                    type="button"
                    onClick={() => onOpenGame(row.gameId)}
                    className="flex min-w-0 items-center gap-3 text-left"
                    title={`Open ${row.gameTitle}`}
                  >
                    {game ? <Cover game={game} className="size-14 shrink-0 rounded-xl shadow-md" /> : <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-panel2 text-accent"><Clock className="size-5" /></span>}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{row.gameTitle}</span>
                      <span className="mt-1 block text-xs text-muted">{fmtDateTime(row.startedAt)}</span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <div className="mr-auto min-w-24 sm:mr-0 sm:text-right">
                      <p className="text-[9px] uppercase tracking-widest text-muted">Played</p>
                      <p className="font-mono text-sm font-semibold text-fg">{fmtClock(row.durationSecs)}</p>
                    </div>
                    <span className="rounded-full border border-line bg-bg/40 px-2.5 py-1 text-[10px] text-muted" title={fmtEndedBy(row.endedBy, row.manual)}>
                      {fmtEndedBy(row.endedBy, row.manual)}
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-accent transition hover:border-accent"
                        onClick={() => setEditing(row)}
                        title="Correct when it started and how long it ran"
                      >
                        <Pencil className="size-3" /> Edit
                      </button>
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-rose-400 hover:text-rose-400"
                        onClick={() => setRemoving(row)}
                        title="Remove this session"
                      >
                        <Trash2 className="size-3" /> Remove
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <button className={btnGhost} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="text-muted">Page {page + 1} of {pages}</span>
            <button className={btnGhost} disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </section>

      {played.length > 0 && (
        <section className="glass rounded-3xl p-4 sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Most played</h2>
              <p className="mt-0.5 text-xs text-muted">Right-click a game to adjust its total playtime or open its details.</p>
            </div>
            <span className="text-xs text-muted">Top {played.length}</span>
          </div>
          <div className="space-y-2">
            {played.map((game, index) => {
              const top = Math.max(1, played[0].playSecs);
              const fraction = Math.min(100, (game.playSecs / top) * 100);
              return (
                <div
                  key={game.id}
                  data-orbit-session-game={game.id}
                  onClick={() => onOpenGame(game.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenGame(game.id);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContext({ kind: 'game', x: event.clientX, y: event.clientY, game });
                  }}
                  role="button"
                  tabIndex={0}
                  className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-line/60 bg-panel/30 p-2.5 text-left transition hover:border-accent/40 hover:bg-panel/55"
                >
                  <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
                  <Cover game={game} className="size-12 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
                      <span className="truncate text-sm font-medium">{game.title}</span>
                      <span className="font-mono text-xs text-muted">{fmtClock(game.playSecs)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                      <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-[width]" style={{ width: `${fraction}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] text-muted">{game.sessionCount > 0 ? `${game.sessionCount} sessions recorded` : 'Manually tracked playtime'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {editing && <EditSession row={editing} onClose={() => setEditing(null)} onSaved={() => { onChanged(); void load(); }} />}
      {logging && (
        <LogSession
          games={games}
          initialGameId={loggingGameId ?? undefined}
          onClose={() => {
            setLogging(false);
            setLoggingGameId(null);
          }}
          onSaved={() => { onChanged(); void load(); }}
        />
      )}
      {context && <ContextMenu x={context.x} y={context.y} items={contextItems} onClose={() => setContext(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.gameTitle} session?`}
          description={`This removes the ${fmtClock(removing.durationSecs)} session from ${fmtDateTime(removing.startedAt)}. The game's other sessions and total playtime stay intact.`}
          confirmLabel="Delete session"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const row = removing;
            setRemoving(null);
            setActionError(null);
            void deleteSession(row.id)
              .then(() => {
                onChanged();
                void load();
              })
              .catch((reason) => setActionError(reason instanceof Error ? reason.message : String(reason)));
          }}
        />
      )}
      {playtimeGame && (
        <Modal title={`Edit ${playtimeGame.title} playtime`} subtitle={`Current total: ${fmtClock(playtimeGame.playSecs)}.`} onClose={() => setPlaytimeGame(null)}>
          <form onSubmit={savePlaytime} className="space-y-4">
            <div className="grid grid-cols-3 gap-2.5">
              <label className="block min-w-0">
                <span className="mb-1 block text-xs uppercase tracking-widest text-muted">Hours</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={playtimeHours}
                  onChange={(event) => setPlaytimeHours(event.target.value)}
                  className={inputCls}
                  autoFocus
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-xs uppercase tracking-widest text-muted">Minutes</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  inputMode="numeric"
                  value={playtimeMinutes}
                  onChange={(event) => setPlaytimeMinutes(event.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-xs uppercase tracking-widest text-muted">Seconds</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  inputMode="numeric"
                  value={playtimeSeconds}
                  onChange={(event) => setPlaytimeSeconds(event.target.value)}
                  className={inputCls}
                />
              </label>
            </div>
            <p className="text-xs leading-relaxed text-muted">This changes the displayed total without rewriting session history. You can edit or remove individual sessions from their own right-click menu.</p>
            {playtimeError && <p role="alert" className="text-xs text-rose-400">{playtimeError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setPlaytimeGame(null)}>Cancel</button>
              <button className={btnPrimary}>Save playtime</button>
            </div>
          </form>
        </Modal>
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
