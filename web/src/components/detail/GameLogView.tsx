import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, GripVertical, ListFilter, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Game, GameLog } from '../../types';
import { addGameLog, deleteGameLog, listGameLogs, reorderGameLogs, updateGameLog } from '../../services/native';
import { useDragReorder } from '../../hooks/useDragReorder';
import { fmtClock, fmtDate, fromLocalInput, parseDuration, toLocalInput } from '../../utils/format';
import { inputCls } from '../ui/Modal';
import { cn } from '../../utils/cn';

/** A row being written or corrected. */
interface Draft {
  id: number | null;
  at: string;
  secs: string;
  note: string;
}

/**
 * A new entry starts with neither date nor length filled in.
 *
 * Both are optional and both have an obvious default: today, and no time at
 * all. Somebody writing "beat the last boss" should not have to answer two
 * questions about numbers they never counted.
 */
const blank = (): Draft => ({ id: null, at: '', secs: '', note: '' });

/** How the entries are read. `mine` is the order they were dragged into. */
type Order = 'mine' | 'newest' | 'oldest' | 'longest' | 'shortest';

const ORDERS: { id: Order; label: string }[] = [
  { id: 'mine', label: 'My order (drag to arrange)' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'longest', label: 'Longest first' },
  { id: 'shortest', label: 'Shortest first' },
];

/** The things people actually write down, one tap away. */
const QUICK_NOTES = ['Finished main story', 'Finished the DLC', '100% complete', 'Replay'];

/**
 * The player's own log for one game.
 *
 * Deliberately separate from sessions: nothing here is tracked or measured by
 * Orbit. The player writes what happened, picks the date it happened on, and
 * says how long it took, and every field can be corrected later. That is what
 * makes "10h · 08-12-26 · finished main story" a thing they typed rather than a
 * thing the tracker guessed at.
 *
 * The game's own notes live underneath the entries rather than above them: the
 * entries are the record, and a box of loose notes is what you read after them.
 */
export function GameLogView({
  game,
  onChanged,
  onNotes,
}: {
  game: Game;
  /** Told after a note is written, corrected or removed, so a page showing
   *  counts for every game can catch up. */
  onChanged?: () => void;
  /** Save the game's own notes, which live in here now rather than in a box of
   *  their own on the overview. */
  onNotes?: (notes: string) => void;
}) {
  const gameId = game.id;
  const gameTitle = game.title;
  const [rows, setRows] = useState<GameLog[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('mine');

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

  /** Re-read, and let whoever is showing totals know they have moved. */
  const refresh = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  const total = rows.reduce((s, r) => s + r.secs, 0);

  /**
   * The entries as they are shown.
   *
   * "My order" is the order in the database, which is the order they were
   * dragged into; the rest are read-only views of the same rows, so switching
   * back and forth never loses an arrangement.
   */
  const shown = useMemo(() => {
    const list = [...rows];
    switch (order) {
      case 'newest':
        return list.sort((a, b) => b.at - a.at || b.id - a.id);
      case 'oldest':
        return list.sort((a, b) => a.at - b.at || a.id - b.id);
      case 'longest':
        return list.sort((a, b) => b.secs - a.secs);
      case 'shortest':
        return list.sort((a, b) => a.secs - b.secs);
      default:
        return list;
    }
  }, [rows, order]);

  /**
   * Move one entry to where another one is.
   *
   * Pressing and moving, not the browser's drag and drop: a desktop webview
   * keeps drag events for files coming off the desktop, which is why the handle
   * used to do nothing at all. The new order is written straight away rather
   * than kept in the browser, so it is the same list the next time the game is
   * opened. Only the ids that were on screen are sent, so an entry written
   * elsewhere is not swallowed.
   */
  const move = (fromId: number, toId: number) => {
    const ids = rows.map((r) => r.id).filter((id) => id !== fromId);
    const at = ids.indexOf(toId);
    ids.splice(at === -1 ? ids.length : at, 0, fromId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    setRows(ids.map((id) => byId.get(id)!).filter(Boolean));
    void reorderGameLogs(gameId, ids).catch(() => load());
  };

  const save = async () => {
    if (!draft) return;
    // Left empty means "today" and "no time to add", which is what most short
    // entries want; only a value that is there and unreadable is an error.
    const secs = draft.secs.trim() === '' ? 0 : parseDuration(draft.secs);
    if (secs === null) {
      setError('That is not a length of time. Try 10h, 45m, or 90, or leave it empty.');
      return;
    }
    const at = draft.at.trim() === '' ? Math.floor(Date.now() / 1000) : fromLocalInput(draft.at);
    if (at === null) {
      setError('That is not a date.');
      return;
    }
    setError(null);
    try {
      if (draft.id === null) await addGameLog(gameId, at, secs, draft.note);
      else await updateGameLog(draft.id, at, secs, draft.note);
      setDraft(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const drag = useDragReorder(
    (fromId, toId) => move(Number(fromId), Number(toId)),
  );

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <NotebookPen className="size-4 text-accent" />
            Log
          </h3>
          <p className="text-xs text-muted">Your notes about {gameTitle}. Nothing here is tracked for you.</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold">{fmtClock(total)}</p>
          <p className="text-[11px] text-muted">
            across {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
      </div>

      {draft ? (
        <div className="mb-4 space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-muted">When (optional)</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={draft.at}
                onChange={(e) => setDraft({ ...draft, at: e.target.value })}
                title="Leave empty for today"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-muted">How long (optional)</span>
              <input
                className={inputCls}
                value={draft.secs}
                onChange={(e) => setDraft({ ...draft, secs: e.target.value })}
                placeholder="10h, 45m, or leave empty"
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
          <div className="flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((q) => (
              <button
                key={q}
                onClick={() => setDraft({ ...draft, note: q })}
                className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted hover:border-accent hover:text-fg"
              >
                {q}
              </button>
            ))}
          </div>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
            >
              <Check className="size-3.5" />
              Save entry
            </button>
            <button
              onClick={() => setDraft(null)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:text-fg"
            >
              <X className="size-3.5" />
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
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-accent hover:text-fg"
        >
          <Plus className="size-4" />
          Add an entry
        </button>
      )}

      {rows.length > 1 && (
        <div className="mb-3 flex items-center gap-2">
          <ListFilter className="size-3.5 shrink-0 text-muted" />
          <div className="relative">
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value as Order)}
              className="appearance-none rounded-lg border border-line bg-panel py-1 pl-2.5 pr-7 text-[11px] outline-none focus:border-accent"
              title="How the entries are ordered"
            >
              {ORDERS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted" />
          </div>
          {order === 'mine' && rows.length > 1 && (
            <span className="text-[11px] text-muted">Drag an entry by its handle to move it.</span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          Nothing written yet. Finished the story, beat the DLC, went back to an older save: those go here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((r) => (
            <li
              key={r.id}
              {...bindLogRow(r.id, order === 'mine', drag.bind)}
              className={`group flex items-center gap-2 rounded-lg bg-bg/60 px-2 py-2 text-sm ${
                order === 'mine' ? 'cursor-grab active:cursor-grabbing' : ''
              } ${order === 'mine' && drag.over === String(r.id) ? 'ring-2 ring-accent' : ''} ${
                order === 'mine' && drag.dragging === String(r.id) ? 'opacity-60' : ''
              }`}
            >
              {order === 'mine' && (
                <span
                  title="Press here and move to place this entry"
                  aria-label="Press here and move to place this entry"
                  className="shrink-0 text-muted"
                >
                  <GripVertical className="size-4" />
                </span>
              )}
              <span className="w-14 shrink-0 font-mono text-xs font-semibold text-accent">
                {fmtShort(r.secs) || '-'}
              </span>
              <span className="w-20 shrink-0 font-mono text-xs text-muted">
                {fmtDate(new Date(r.at * 1000).toISOString())}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.note || <span className="text-muted">no note</span>}</span>
              <span className={cn('flex shrink-0 gap-2 transition', order === 'mine' && '')}>
                <button
                  onClick={() => {
                    setError(null);
                    setDraft({ id: r.id, at: toLocalInput(r.at), secs: fmtShort(r.secs), note: r.note });
                  }}
                  className="text-muted hover:text-accent"
                  title="Edit this entry"
                  aria-label="Edit this entry"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Remove this entry?')) {
                      void deleteGameLog(r.id).then(refresh);
                    }
                  }}
                  className="text-muted hover:text-rose-400"
                  title="Remove this entry"
                  aria-label="Remove this entry"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The game's own notes, underneath the entries: what the player wants to
          remember about playing it, as opposed to what happened when. */}
      {onNotes && (
        <label className="mt-5 block border-t border-line pt-4">
          <span className="text-[11px] uppercase tracking-widest text-muted">Notes on {gameTitle}</span>
          <textarea
            value={game.notes}
            onChange={(e) => onNotes(e.target.value)}
            rows={4}
            placeholder="Builds, quest reminders, codes, what you were in the middle of…"
            className="mt-1 w-full resize-y rounded-lg border border-line bg-bg/60 p-3 text-sm outline-none focus:border-accent"
          />
        </label>
      )}
    </section>
  );
}

/**
 * The press-to-move wiring for one entry.
 *
 * `useDragReorder` only hands out its bindings when reordering is allowed, so
 * the row is left alone in the sorted views, where the order is not the
 * player's to change.
 */
function bindLogRow(
  id: number,
  movable: boolean,
  bind: (id: string) => Record<string, unknown>,
): Record<string, unknown> {
  return movable ? bind(String(id)) : {};
}

/**
 * `10h 08m` for an edit box, which round-trips through `parseDuration`.
 *
 * Zero comes back as nothing at all, because an empty field means "no time" and
 * is what the editor writes into it when a date was all that was noted.
 */
function fmtShort(secs: number): string {
  if (secs === 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
