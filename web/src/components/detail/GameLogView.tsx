import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, Clock, GripVertical, ListFilter, NotebookPen, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { Game, GameLog, Playthrough } from '../../types';
import { addGameLog, addPlaythrough, deleteGameLog, deletePlaythrough, listGameLogs, listPlaythroughs, renamePlaythrough, reorderGameLogs, setCurrentPlaythrough, updateGameLog } from '../../services/native';
import { rememberPlaythrough } from '../../services/playthroughs';
import { useDragReorder } from '../../hooks/useDragReorder';
import { fmtClock, fmtDateTime, fromLocalInput, parseDuration, toLocalInput } from '../../utils/format';
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
 * A new entry needs a day, but not a time of day or a play duration.
 */
const blank = (): Draft => ({ id: null, at: '', secs: '', note: '', details: '' });

function displayLogDate(unixSeconds: number, withClock: boolean): string {
  if (unixSeconds <= 0) return 'No date';
  const date = new Date(unixSeconds * 1000);
  if (withClock && (date.getHours() !== 0 || date.getMinutes() !== 0)) return fmtDateTime(unixSeconds);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

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
 * Orbit. The player writes what happened and picks the day; clock time and play
 * duration are optional, and every field can be corrected later.
 *
 * The game's own notes live underneath the entries rather than above them: the
 * entries are the record, and a box of loose notes is what you read after them.
 */
export function GameLogView({
  game,
  onChanged,
  onNotes,
  onPlaythrough,
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
  /** The run on screen, and how many entries it has. The Journal's left-hand
   *  count uses this so it matches the playthrough being read, not every run. */
  onPlaythrough?: (run: { gameId: string; id: string; name: string; count: number; runs: number }) => void;
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
  const [entryFilter, setEntryFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailsDraft, setDetailsDraft] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [runs, setRuns] = useState<Playthrough[]>([]);
  const [allLogs, setAllLogs] = useState<GameLog[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const currentId = useRef<string | null>(null);
  /** Only the latest read may update the list. An older one finishing last was
   *  what left an empty playthrough showing the previous run's count. */
  const loadGen = useRef(0);

  const publish = useCallback((run: Playthrough, list: Playthrough[], logs: GameLog[]) => {
    const visible = logs.filter((row) => belongsToRun(row, run, list));
    setRows(visible);
    onPlaythrough?.({ gameId, id: run.id, name: run.name, count: visible.length, runs: list.length });
  }, [gameId, onPlaythrough]);

  const load = useCallback(() => {
    const gen = ++loadGen.current;
    void (async () => {
      const [list, logs] = await Promise.all([listPlaythroughs(gameId), listGameLogs(gameId)]);
      if (gen !== loadGen.current) return;
      setRuns(list);
      setAllLogs(logs);
      const current =
        list.find((run) => run.id === currentId.current) ?? list.find((run) => run.current) ?? list[0];
      if (current) {
        currentId.current = current.id;
        rememberPlaythrough(gameId, current.id);
      }
      // Checked again because a playthrough click during the read has already
      // published that run. Applying this older read would put the previous
      // count back, which is what an empty run looked like until a log was
      // added and removed.
      if (gen !== loadGen.current) return;
      if (current) publish(current, list, logs);
    })().catch((e) => {
      if (gen === loadGen.current) setError(e instanceof Error ? e.message : String(e));
    });
  }, [gameId, publish]);

  useEffect(() => {
    load();
    return () => {
      loadGen.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const onImport = () => load();
    window.addEventListener('orbit-imported', onImport);
    window.addEventListener('orbit-journal-changed', onImport);
    return () => {
      window.removeEventListener('orbit-imported', onImport);
      window.removeEventListener('orbit-journal-changed', onImport);
    };
  }, [load]);

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
    const q = entryFilter.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => r.note.toLowerCase().includes(q) || (r.details ?? '').toLowerCase().includes(q))
      : [...rows];
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
  }, [rows, order, entryFilter]);

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
    if (!draft.at.trim()) {
      setError('Choose a day for this entry.');
      return;
    }
    // Clock time and play duration are optional; the picker represents an
    // omitted clock time as midnight on the selected day.
    const secs = draft.secs.trim() === '' ? 0 : parseDuration(draft.secs);
    if (secs === null) {
      setError('That is not a length of time. Try 10h, 45m, or 90, or leave it empty.');
      return;
    }
    const at = fromLocalInput(draft.at);
    if (at === null) {
      setError('Choose a valid day or time.');
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
      at: row.at > 0 ? toLocalInput(row.at) : '',
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

  const current = runs.find((run) => run.id === currentId.current) ?? runs.find((run) => run.current) ?? runs[0];
  const unsavedEntry = () =>
    Boolean(draft && (draft.note.trim() || draft.details.trim() || draft.at.trim() || draft.secs.trim()));

  const chooseRun = async (run: Playthrough) => {
    if (runBusy || run.id === current?.id) return;
    if (unsavedEntry() && !confirm('Discard the entry you have not saved?')) return;
    setDraft(null);
    // Drop a read that is already in flight, then publish this run from the
    // entries already on the page. The count has to move on the click, including
    // to zero, and not wait for another round trip.
    loadGen.current += 1;
    currentId.current = run.id;
    rememberPlaythrough(gameId, run.id);
    publish(run, runs, allLogs);
    setRunBusy(true);
    setError(null);
    try {
      const next = await setCurrentPlaythrough(run.id);
      onNotes?.(next.notes);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  const addRun = async (name: string) => {
    if (unsavedEntry() && !confirm('Discard the entry you have not saved?')) return;
    setDraft(null);
    setRunBusy(true);
    setError(null);
    try {
      const next = await addPlaythrough(gameId, name);
      currentId.current = next.id;
      rememberPlaythrough(gameId, next.id);
      onNotes?.(next.notes);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  const renameRun = async (id: string, name: string) => {
    setError(null);
    try {
      await renamePlaythrough(id, name);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeRun = async (run: Playthrough) => {
    if (runs.length <= 1) return;
    if (unsavedEntry() && !confirm('Discard the entry you have not saved?')) return;
    if (!confirm(`Remove “${run.name}”? Its journal entries and notes go with it. Time already counted stays on the game.`)) return;
    setDraft(null);
    setRunBusy(true);
    setError(null);
    try {
      const kept = await deletePlaythrough(run.id);
      currentId.current = kept.id;
      rememberPlaythrough(gameId, kept.id);
      onNotes?.(kept.notes);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunBusy(false);
    }
  };

  const renderDraftCard = (mode: 'new' | 'edit') => {
    if (!draft) return null;
    return (
      <div className={cn('orbit-jdraft', mode === 'edit' && 'is-inline')}>
        <div className="orbit-jdraft-top">
          <span className="orbit-jdraft-badge">
            <NotebookPen className="size-3.5 text-accent" />
            {mode === 'edit' ? 'Editing entry' : 'New journal entry'}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_NOTES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setDraft({ ...draft, note: q })}
                className={cn('orbit-logquick', draft.note === q && 'is-chosen')}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="orbit-logfield">What happened</span>
          <input
            className={inputCls}
            value={draft.note}
            autoFocus
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Finished main story, reached a new region, beat a tough boss…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) void save();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="orbit-logfield">Day (required) · time optional</span>
            <DateTimePicker
              value={draft.at}
              onChange={(at) => setDraft({ ...draft, at })}
              placeholder="Choose a day"
              title="Choose the day; clock time is optional"
              optionalTime
              clearable
            />
          </label>
          <label className="block">
            <span className="orbit-logfield">Play duration (optional)</span>
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
          <span className="orbit-logfield">More about this entry (optional)</span>
          <textarea
            className={`${inputCls} mt-1 min-h-20 resize-y text-sm leading-relaxed`}
            rows={3}
            value={draft.details}
            onChange={(e) => setDraft({ ...draft, details: e.target.value })}
            placeholder="Builds, story thoughts, screenshots context, or anything else to remember."
          />
        </label>

        {error && <p className="text-[11.5px] font-medium text-rose-400">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setDraft(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-fg/25 hover:text-fg"
          >
            <X className="size-3.5" />
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold', btnAccent)}
          >
            <Check className="size-3.5" />
            Save entry
          </button>
        </div>
      </div>
    );
  };

  const canDragEntries = order === 'mine' && entryFilter.trim() === '';

  return (
    <section className="orbit-logview">
      <PlaythroughBar
        runs={runs}
        currentId={current?.id ?? null}
        busy={runBusy}
        onChoose={(run) => void chooseRun(run)}
        onAdd={(name) => void addRun(name)}
        onRename={(id, name) => void renameRun(id, name)}
        onDelete={(run) => void removeRun(run)}
      />

      <div
        className="orbit-jcard"
        data-orbit-pad-zone={withClock ? 'journal-logs' : undefined}
        data-orbit-pad-game={withClock ? gameId : undefined}
      >
        <div className="orbit-jcard-head">
          <div className="min-w-0">
            <h3 className="orbit-jcard-title">
              <NotebookPen className="size-4 text-accent" />
              <span>Entries</span>
              <span className="orbit-jcard-count orbit-num">{rows.length}</span>
              {!withClock && total > 0 && (
                <span className="text-[11px] font-normal text-muted">· {fmtClock(total)}</span>
              )}
            </h3>
            <p className="orbit-jcard-sub">
              Milestones, sessions, and moments on {current ? current.name : gameTitle}.
            </p>
          </div>

          <div className="orbit-jcard-controls">
            {(rows.length > 2 || entryFilter.trim() !== '') && (
              <label className="orbit-jsearch">
                <Search className="size-3.5 shrink-0 text-muted" />
                <input
                  value={entryFilter}
                  onChange={(e) => setEntryFilter(e.target.value)}
                  placeholder="Filter entries…"
                  aria-label="Filter entries"
                />
                {entryFilter && (
                  <button
                    type="button"
                    onClick={() => setEntryFilter('')}
                    className="text-muted hover:text-fg"
                    aria-label="Clear entry filter"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </label>
            )}
            {rows.length > 1 && (
              <div className="flex items-center gap-1.5">
                <ListFilter className="size-3.5 shrink-0 text-muted" />
                <Select
                  value={order}
                  onChange={setOrder}
                  className="w-48 !py-1 text-[11.5px]"
                  menuClassName="w-56"
                  ariaLabel="How the entries are ordered"
                  options={ORDERS.map((o) => ({ value: o.id, label: o.label }))}
                />
              </div>
            )}
            {draft?.id !== null && (
              <button
                type="button"
                onClick={() => {
                  if (draft && unsavedEntry() && !confirm('Discard your unsaved entry changes?')) return;
                  setError(null);
                  setDraft(blank());
                }}
                className="orbit-jadd-btn"
              >
                <Plus className="size-3.5" />
                Add entry
              </button>
            )}
          </div>
        </div>

        {draft?.id === null && renderDraftCard('new')}

        {rows.length === 0 ? (
          draft?.id === null ? null : (
            <div className="orbit-jempty">
              <p className="text-[13px] font-medium text-fg">Nothing written on this playthrough yet</p>
              <p className="mt-1 text-xs text-muted">
                Finished the story, beat the DLC, or returned to an old save — record any moment here.
              </p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setDraft(blank());
                }}
                className="orbit-logadd !mb-0 mt-3 max-w-xs mx-auto"
              >
                <Plus className="size-4" />
                Write first entry
              </button>
            </div>
          )
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted">No entries match "{entryFilter}".</p>
        ) : (
          <ol className="orbit-jtimeline">
            {shown.map((r) => {
              const isEditingThis = draft?.id === r.id;
              const expanded = expandedId === r.id;
              const savedDetails = r.details ?? '';
              const detailsChanged = detailsDraft !== savedDetails;
              const lenLabel = fmtShort(r.secs);

              if (isEditingThis) {
                return (
                  <li key={r.id} className="orbit-jentry is-editing">
                    <span className="orbit-jentry-rail" aria-hidden><i /></span>
                    <div className="min-w-0 flex-1">{renderDraftCard('edit')}</div>
                  </li>
                );
              }

              return (
                <li
                  key={r.id}
                  {...bindLogRow(r.id, canDragEntries, drag.bind)}
                  className={cn(
                    'orbit-jentry',
                    canDragEntries && 'is-draggable',
                    canDragEntries && drag.over === String(r.id) && 'is-over',
                    canDragEntries && drag.dragging === String(r.id) && 'is-dragging',
                  )}
                >
                  <span className="orbit-jentry-rail" aria-hidden>
                    <i />
                  </span>
                  <div className="orbit-jentry-card">
                    <div className="orbit-jentry-meta">
                      {canDragEntries && (
                        <span
                          title="Press here and move to place this entry"
                          aria-label="Press here and move to place this entry"
                          className="orbit-jentry-grip"
                        >
                          <GripVertical className="size-3.5" />
                        </span>
                      )}
                      <span className="orbit-jentry-when">{displayLogDate(r.at, withClock)}</span>
                      {lenLabel && (
                        <span className="orbit-jentry-duration">
                          <Clock className="size-3" />
                          {lenLabel}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => editEntry(r)}
                          className="orbit-jentry-tool"
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
                          className="orbit-jentry-tool is-danger"
                          title="Remove this entry"
                          aria-label="Remove this entry"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleDetails(r)}
                      data-orbit-pad={withClock ? 'journal-entry' : undefined}
                      className="orbit-jentry-body"
                      aria-expanded={expanded}
                      title={expanded ? 'Close entry details' : savedDetails ? 'Read or edit entry details' : 'Add details to this entry'}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="orbit-jentry-headline">
                          {r.note || <span className="italic text-muted">Untitled entry</span>}
                        </p>
                        {!expanded && savedDetails && (
                          <p className="orbit-jentry-snippet">{savedDetails}</p>
                        )}
                      </div>
                      <span className="orbit-jentry-expand">
                        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </span>
                    </button>

                    {expanded && (
                      <div className="orbit-jentry-details">
                        <label className="block">
                          <span className="orbit-logfield">More about this entry</span>
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
                          <p className="text-[11px] text-muted">Saved with this entry.</p>
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
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Playthrough scratchpad & notes card */}
      {onNotes && (
        <div
          className="orbit-jcard"
          data-orbit-pad-zone={withClock ? 'journal-notes' : undefined}
        >
          <div className="orbit-jcard-head !pb-2.5">
            <div className="min-w-0">
              <h3 className="orbit-jcard-title">
                <BookOpen className="size-4 text-accent" />
                <span>Notes{current ? ` · ${current.name}` : ''}</span>
              </h3>
              <p className="orbit-jcard-sub">
                Where you left off, builds, quest reminders, or codes — Markdown supported.
              </p>
            </div>
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
/**
 * A journal entry belongs to one run. A row with no run yet is shown on Main,
 * which is where the migration put everything that was already written.
 */
function belongsToRun(row: GameLog, current: Playthrough | undefined, runs: Playthrough[]): boolean {
  if (!current) return true;
  if (row.playthroughId) return row.playthroughId === current.id;
  return current.name === 'Main' || runs.length <= 1;
}

/**
 * The runs of this game.
 *
 * Entries and notes stay with the run that is selected. Time already counted
 * stays on the game, which is why removing a run does not change the hours.
 */
function PlaythroughBar({
  runs,
  currentId,
  busy,
  onChoose,
  onAdd,
  onRename,
  onDelete,
}: {
  runs: Playthrough[];
  currentId: string | null;
  busy: boolean;
  onChoose: (run: Playthrough) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (run: Playthrough) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState('');
  const sent = useRef(false);
  const cancel = useRef(false);
  const current = runs.find((run) => run.id === currentId) ?? null;

  const commitAdd = () => {
    if (sent.current || cancel.current) return;
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    sent.current = true;
    setAdding(false);
    setDraft('');
    onAdd(name);
  };

  const commitRename = () => {
    if (sent.current || cancel.current) return;
    const name = rename.trim();
    sent.current = true;
    setRenaming(false);
    if (!current || !name || name === current.name) return;
    onRename(current.id, name);
  };

  return (
    <div className="orbit-jruns">
      <span className="orbit-jruns-label">Playthrough</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            disabled={busy}
            onClick={() => onChoose(run)}
            className={cn('orbit-jrun-pill', run.id === currentId && 'is-active')}
          >
            {run.name}
          </button>
        ))}
        {adding ? (
          <input
            className={`${inputCls} !w-36 !py-1 text-xs`}
            value={draft}
            autoFocus
            placeholder="New game+"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') {
                cancel.current = true;
                setAdding(false);
                setDraft('');
              }
            }}
            onBlur={commitAdd}
            aria-label="Name this playthrough"
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              sent.current = false;
              cancel.current = false;
              setRenaming(false);
              setAdding(true);
              setDraft('');
            }}
            className="orbit-jrun-add"
          >
            <Plus className="size-3" />
            New run
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {current && !renaming && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              sent.current = false;
              cancel.current = false;
              setAdding(false);
              setRenaming(true);
              setRename(current.name);
            }}
            className="orbit-jentry-tool"
            title="Rename this playthrough"
            aria-label={`Rename ${current.name}`}
          >
            <Pencil className="size-3.5" />
            <span className="hidden sm:inline">Rename</span>
          </button>
        )}
        {current && renaming && (
          <input
            className={`${inputCls} !w-36 !py-1 text-xs`}
            value={rename}
            autoFocus
            onChange={(e) => setRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                cancel.current = true;
                setRenaming(false);
              }
            }}
            onBlur={commitRename}
            aria-label="New name"
          />
        )}
        {current && runs.length > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(current)}
            className="orbit-jentry-tool is-danger"
            title={`Remove ${current.name}`}
            aria-label={`Remove ${current.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

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
