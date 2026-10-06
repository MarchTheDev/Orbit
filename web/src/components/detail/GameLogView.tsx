import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GripVertical, ListFilter, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Game, GameLog } from '../../types';
import { addGameLog, deleteGameLog, listGameLogs, reorderGameLogs, updateGameLog } from '../../services/native';
import { useDragReorder } from '../../hooks/useDragReorder';
import { fmtClock, fmtDate, fmtDateTime, fromLocalInput, parseDuration, toLocalInput } from '../../utils/format';
import { inputCls } from '../ui/Modal';
import { DateTimePicker } from '../ui/DateTimePicker';
import { Select } from '../ui/Select';
import { MarkdownEditor } from '../ui/Markdown';
import { btnAccent } from '../ui/buttons';
import { moveInOrder } from '../../utils/reorder';
import { cn } from '../../utils/cn';

/** A row being written or corrected. */
interface Draft {
  id: number | null;
  at: string;
  secs: string;
  note: string;
  details: string;
}

/**
 * A new entry starts with neither date nor length filled in.
 *
 * Both are optional and both have an obvious default: today, and no time at
 * all. Somebody writing "beat the last boss" should not have to answer two
 * questions about numbers they never counted.
 */
const blank = (): Draft => ({ id: null, at: '', secs: '', note: '', details: '' });

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
  addRequest,
  onAddHandled,
  withClock = false,
}: {
  game: Game;
  /** Told after a note is written, corrected or removed, so a page showing
   *  counts for every game can catch up. */
  onChanged?: () => void;
  /** Save the game's own notes, which live in here now rather than in a box of
   *  their own on the overview. */
  onNotes?: (notes: string) => void;
  /** A one-shot request from the Journal context menu to open a fresh entry. */
  addRequest?: number;
  onAddHandled?: () => void;
  /** True in the Journal, where there is room to say the time of day as well:
   *  entries written weeks apart are worth telling apart by more than a date. */
  withClock?: boolean;
}) {
  const gameId = game.id;
  const gameTitle = game.title;
  const [rows, setRows] = useState<GameLog[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('mine');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailsDraft, setDetailsDraft] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);

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

  useEffect(() => {
    if (addRequest === undefined) return;
    setError(null);
    setExpandedId(null);
    setDetailsDraft('');
    setDraft(blank());
    onAddHandled?.();
    // The request token changes once for each context-menu action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequest]);

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
  const move = (fromId: number, toId: number, after: boolean) => {
    const ids = moveInOrder(
      rows.map((r) => String(r.id)),
      String(fromId),
      String(toId),
      after,
    ).map(Number);
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
      if (draft.id === null) await addGameLog(gameId, at, secs, draft.note, draft.details);
      else await updateGameLog(draft.id, at, secs, draft.note, draft.details);
      if (draft.id !== null && expandedId === draft.id) setDetailsDraft(draft.details.trim());
      setDraft(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleDetails = (row: GameLog) => {
    const rowDetails = row.details ?? '';
    if (expandedId === row.id) {
      if (detailsDraft !== rowDetails && !confirm('Discard your unsaved details?')) return;
      setExpandedId(null);
      setDetailsDraft('');
      return;
    }
    const openRow = rows.find((candidate) => candidate.id === expandedId);
    if (openRow && detailsDraft !== (openRow.details ?? '') && !confirm('Discard your unsaved details?')) return;
    setError(null);
    setExpandedId(row.id);
    setDetailsDraft(rowDetails);
  };

  const editEntry = (row: GameLog) => {
    if (draft && !confirm('Discard your unsaved entry changes?')) return;
    const openRow = rows.find((candidate) => candidate.id === expandedId);
    if (openRow && detailsDraft !== (openRow.details ?? '') && !confirm('Discard your unsaved details?')) return;
    setExpandedId(null);
    setDetailsDraft('');
    setError(null);
    setDraft({
      id: row.id,
      at: toLocalInput(row.at),
      secs: fmtShort(row.secs),
      note: row.note,
      details: row.details ?? '',
    });
  };

  const saveDetails = async (row: GameLog) => {
    setDetailsSaving(true);
    setError(null);
    try {
      await updateGameLog(row.id, row.at, row.secs, row.note, detailsDraft);
      setDetailsDraft(detailsDraft.trim());
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailsSaving(false);
    }
  };

  const drag = useDragReorder((fromId, toId, after) => move(Number(fromId), Number(toId), after));

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
        {/* The total time is the drawer's business, where the log sits beside
            the session clock. In the Journal the page is the writing, and the
            hours above the count were one more set of numbers to read past. */}
        <p className="text-[11px] text-muted">
          {withClock ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : fmtClock(total)}
          {!withClock && (
            <>
              {' '}
              across {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
            </>
          )}
        </p>
      </div>

      {draft ? (
        <div className="mb-4 space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-muted">When (optional)</span>
              <DateTimePicker
                value={draft.at}
                onChange={(at) => setDraft({ ...draft, at })}
                placeholder="Leave empty for today"
                title="Choose when it happened, or leave it empty for today"
                clearable
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
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest text-muted">More about this entry (optional)</span>
            <textarea
              className={`${inputCls} mt-1 min-h-20 resize-y text-sm leading-relaxed`}
              rows={3}
              value={draft.details}
              onChange={(e) => setDraft({ ...draft, details: e.target.value })}
              placeholder="A separate note with anything else you want to remember."
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
              className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs', btnAccent)}
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
          <Select
            value={order}
            onChange={setOrder}
            className="w-56 !py-1 text-[11px]"
            menuClassName="w-56"
            ariaLabel="How the entries are ordered"
            options={ORDERS.map((o) => ({ value: o.id, label: o.label }))}
          />
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
          {shown.map((r) => {
            const expanded = expandedId === r.id;
            const savedDetails = r.details ?? '';
            const detailsChanged = detailsDraft !== savedDetails;
            return (
              <li
                key={r.id}
                {...bindLogRow(r.id, order === 'mine', drag.bind)}
                className={`overflow-hidden rounded-xl border border-line/60 bg-bg/55 text-sm transition ${
                  order === 'mine' ? 'cursor-grab active:cursor-grabbing' : ''
                } ${order === 'mine' && drag.over === String(r.id) ? 'ring-2 ring-accent' : ''} ${
                  order === 'mine' && drag.dragging === String(r.id) ? 'opacity-60' : ''
                }`}
              >
                <div className="group flex items-center gap-2 px-2 py-2">
                  {order === 'mine' && (
                    <span
                      title="Press here and move to place this entry"
                      aria-label="Press here and move to place this entry"
                      className="shrink-0 text-muted"
                    >
                      <GripVertical className="size-4" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleDetails(r)}
                    disabled={draft?.id === r.id}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                    aria-expanded={expanded}
                    title={draft?.id === r.id ? 'This entry is being edited above' : expanded ? 'Close this entry' : 'Open this entry'}
                  >
                    {/* The length sits beside the date in the drawer, where
                        the row is a record of a session. In the Journal it is
                        a note, and the clocks were noise beside the date. */}
                    {!withClock && (
                      <span className="w-14 shrink-0 font-mono text-xs font-semibold text-accent">
                        {fmtShort(r.secs) || '-'}
                      </span>
                    )}
                    <span className={`shrink-0 font-mono text-xs text-muted ${withClock ? 'w-32' : 'w-20'}`}>
                      {withClock ? fmtDateTime(r.at) : fmtDate(new Date(r.at * 1000).toISOString())}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {r.note || <span className="text-muted">no note</span>}
                    </span>
                    {expanded ? (
                      <ChevronUp className="size-3.5 shrink-0 text-muted" />
                    ) : (
                      <ChevronDown className="size-3.5 shrink-0 text-muted" />
                    )}
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => editEntry(r)}
                      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted transition hover:bg-panel2 hover:text-accent"
                      title="Edit this entry"
                      aria-label="Edit this entry"
                    >
                      <Pencil className="size-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('Remove this entry?')) {
                          void deleteGameLog(r.id).then(refresh);
                        }
                      }}
                      className="rounded-lg p-1 text-muted transition hover:bg-panel2 hover:text-rose-400"
                      title="Remove this entry"
                      aria-label="Remove this entry"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
                {expanded && (
                  <div className="space-y-2 border-t border-line/60 px-3 py-3 sm:pl-12">
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                        More about this entry
                      </span>
                      <textarea
                        className={`${inputCls} mt-1 min-h-20 resize-y text-sm leading-relaxed`}
                        rows={3}
                        value={detailsDraft}
                        onChange={(e) => setDetailsDraft(e.target.value)}
                        placeholder="Anything else you want to remember about this moment."
                      />
                    </label>
                    {error && <p className="text-[11px] text-rose-400">{error}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-muted">Separate from “What happened,” and saved with this entry.</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailsDraft(savedDetails)}
                          disabled={!detailsChanged || detailsSaving}
                          className="rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:text-fg disabled:opacity-40"
                        >
                          Undo
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveDetails(r)}
                          disabled={!detailsChanged || detailsSaving}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
                        >
                          <Check className="size-3.5" />
                          {detailsSaving ? 'Saving…' : 'Save details'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The game's own notes, underneath the entries: what the player wants to
          remember about playing it, as opposed to what happened when. Write in
          ordinary Markdown, then switch to View to see how it will read. */}
      {onNotes && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-widest text-muted">Notes on {gameTitle}</span>
            <span className="text-[11px] text-muted/70">
              Markdown source, with a rendered View when you need it
            </span>
          </div>
          <MarkdownEditor
            value={game.notes}
            onChange={(next) => onNotes(next)}
            rows={6}
            placeholder="Builds, quest reminders, codes, what you were in the middle of…"
          />
        </div>
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
