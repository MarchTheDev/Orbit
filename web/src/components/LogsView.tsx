import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Game, GameLog } from '../types';
import { clearPlaythroughLogs, countLogs, listAllLogs, listCurrentPlaythroughs, type CurrentPlaythrough } from '../services/native';
import { rememberPlaythrough } from '../services/playthroughs';
import { Cover } from './ui/Cover';
import { GameLogView } from './detail/GameLogView';
import { SearchField } from './ui/SearchField';
import { useDragReorder } from '../hooks/useDragReorder';
import { moveInOrder } from '../utils/reorder';
import { ContextMenu, type MenuItem } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';

/**
 * The logs: every game's entries, in one place.
 *
 * The game's own drawer is fine for a glance, but a journal you write in a 460px
 * column is cramped the moment an entry is more than a line long. This is the
 * same thing with the whole window to use: pick a game on the left, read and
 * write on the right.
 *
 * The counts come from one read of every entry rather than a request per game,
 * which is why `list_all_logs` exists at all.
 */
export function LogsView({
  games,
  onUpdate,
  onEditGame,
  order = [],
  onOrder,
}: {
  games: Game[];
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onEditGame: (id: string) => void;
  /** The player's own order for the game list, as ids. */
  order?: string[];
  /** Called with the whole list once one has been dragged somewhere. */
  onOrder?: (ids: string[]) => void;
}) {
  const [logs, setLogs] = useState<GameLog[]>([]);
  /** How many there are in total, which can be more than were read. */
  const [total, setTotal] = useState(0);
  /** The run each game is on, so a game that is not open still counts that run. */
  const [currents, setCurrents] = useState<CurrentPlaythrough[]>([]);
  /** The run on screen, whose count is what the journal itself is showing. */
  const [openRun, setOpenRun] = useState<{ gameId: string; id: string; name: string; count: number; runs: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [addRequest, setAddRequest] = useState<{ id: string; token: number } | null>(null);
  const addToken = useRef(0);
  const [clearTarget, setClearTarget] = useState<{ game: Game; kind: 'logs' | 'notes'; run: { id: string; name: string } } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    void Promise.all([listAllLogs(2000, 0), countLogs(), listCurrentPlaythroughs()])
      .then(([rows, count, runs]) => {
        if (!alive) return;
        setLogs(rows);
        setTotal(count);
        setCurrents(runs);
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

  const currentByGame = useMemo(() => new Map(currents.map((run) => [run.gameId, run])), [currents]);

  const reportRun = useCallback((info: { id: string; name: string; count: number; runs: number }) => {
    if (!selectedId) return;
    setOpenRun((current) => {
      if (
        current &&
        current.gameId === selectedId &&
        current.id === info.id &&
        current.name === info.name &&
        current.count === info.count &&
        current.runs === info.runs
      ) {
        return current;
      }
      return { gameId: selectedId, ...info };
    });
    // Remember it for the left-hand list, so leaving this game does not put the
    // count back on the run it used to be on.
    setCurrents((rows) => {
      const rest = rows.filter((row) => row.gameId !== selectedId);
      return [...rest, { gameId: selectedId, id: info.id, name: info.name, runs: info.runs }];
    });
  }, [selectedId]);

  /**
   * Entries for the run each game is on.
   *
   * The open game uses the count the journal just drew, which is the selected
   * playthrough. Every other game uses the run it is currently on. A row with
   * no run yet is counted on Main, or on the only run, which is where it is shown.
   */
  const perGame = useMemo(() => {
    const grouped = new Map<string, GameLog[]>();
    for (const log of logs) {
      const found = grouped.get(log.gameId) ?? [];
      found.push(log);
      grouped.set(log.gameId, found);
    }
    const map = new Map<string, { count: number; name: string | null }>();
    for (const game of games) {
      if (openRun?.gameId === game.id) {
        map.set(game.id, { count: openRun.count, name: openRun.name });
        continue;
      }
      const run = currentByGame.get(game.id);
      const rows = grouped.get(game.id) ?? [];
      const count = run ? rows.filter((log) => countedOnRun(log, run)).length : rows.length;
      map.set(game.id, { count, name: run?.name ?? null });
    }
    return map;
  }, [games, logs, currentByGame, openRun]);

  const gamesWithLogs = useMemo(() => new Set(logs.map((log) => log.gameId)).size, [logs]);

  /**
   * The games down the left, in the player's own order when there is one.
   *
   * Without one, the games with the most written about them come first, which is
   * the right guess: whatever is being worked on is usually what has the most
   * entries. Which game is being *read* is a different question though, and only
   * the person doing the reading knows the answer, so the list can be dragged
   * into shape and that order is kept.
   */
  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = games.filter((g) => !q || g.title.toLowerCase().includes(q));
    if (order.length === 0) {
      return [...found].sort((a, b) => {
        const ac = perGame.get(a.id)?.count ?? 0;
        const bc = perGame.get(b.id)?.count ?? 0;
        if (ac !== bc) return bc - ac;
        return a.title.localeCompare(b.title);
      });
    }
    return [...found].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      // A game that was never dragged waits at the end rather than landing in
      // the middle of an arrangement somebody made.
      if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [games, perGame, query, order]);

  const list = useRef<HTMLUListElement>(null);
  const { bind, dragging, over } = useDragReorder(
    onOrder
      ? (fromId, toId, after) => onOrder(moveInOrder(ordered.map((g) => g.id), fromId, toId, after))
      : undefined,
    // The whole row is a button, so the press has to be allowed to start here.
    { container: list, fromButtons: true },
  );

  const selected = games.find((g) => g.id === selectedId) ?? ordered.find((g) => (perGame.get(g.id)?.count ?? 0) > 0) ?? ordered[0] ?? null;
  const runOf = (gameId: string) => {
    if (openRun?.gameId === gameId) return { id: openRun.id, name: openRun.name };
    const run = currentByGame.get(gameId);
    return run ? { id: run.id, name: run.name } : null;
  };
  const menuGame = menu ? games.find((game) => game.id === menu.id) ?? null : null;
  const menuRun = menuGame ? runOf(menuGame.id) : null;
  const menuItems: MenuItem[] = menuGame
    ? [
        { kind: 'label', label: menuGame.title },
        {
          label: 'Add log entry',
          icon: Plus,
          onSelect: () => {
            setSelectedId(menuGame.id);
            setAddRequest({ id: menuGame.id, token: ++addToken.current });
          },
        },
        { label: 'Edit game…', icon: Pencil, onSelect: () => onEditGame(menuGame.id) },
        { kind: 'sep' },
        {
          label: menuRun ? `Reset log entries on ${menuRun.name}…` : 'Reset log entries…',
          icon: Trash2,
          danger: true,
          disabled: !menuRun,
          onSelect: () => menuRun && setClearTarget({ game: menuGame, kind: 'logs', run: menuRun }),
        },
        {
          label: menuRun ? `Reset notes on ${menuRun.name}…` : 'Reset notes…',
          icon: RotateCcw,
          danger: true,
          disabled: !menuRun,
          onSelect: () => menuRun && setClearTarget({ game: menuGame, kind: 'notes', run: menuRun }),
        },
      ]
    : [];

  const clearSelected = () => {
    if (!clearTarget) return;
    const target = clearTarget;
    setClearTarget(null);
    setActionError(null);
    if (target.kind === 'logs') {
      void clearPlaythroughLogs(target.game.id, target.run.id)
        .then(() => setVersion((current) => current + 1))
        .catch((reason) => setActionError(reason instanceof Error ? reason.message : String(reason)));
    } else {
      // The id is captured now, so the empty notes land on this run even if a
      // switch is still on its way out.
      rememberPlaythrough(target.game.id, target.run.id);
      onUpdate(target.game.id, { notes: '' });
    }
  };
  const selectedRun = selected ? runOf(selected.id) : null;

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <NotebookPen className="size-6 text-accent" />
            Logs
          </h1>
          <p className="mt-1 text-sm text-muted">
            Everything you have written down, game by game. Orbit also writes the first entry itself: the moment a game
            is played for the first time, a line saying so appears here.
          </p>
        </div>
        {/* Counts, not clocks: the Journal is read for what was written, and the
            hours and minutes beside every date were a second set of numbers to
            skip past. */}
        <div className="text-right">
          <p className="text-[11px] text-muted">
            {logs.length} {logs.length === 1 ? 'log' : 'logs'} in {gamesWithLogs}{' '}
            {gamesWithLogs === 1 ? 'game' : 'games'}
            {total > logs.length && ` · the latest ${logs.length} of ${total}`}
          </p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-3">
          <SearchField value={query} onChange={setQuery} placeholder="Find a game" className="w-full" inputClassName="w-full" />
          {onOrder && query.trim() === '' && (
            <p className="px-1 text-[11px] text-muted">Press a game and move it to put the ones you write about most first.</p>
          )}

          <ul
            ref={list}
            className="space-y-1 p-1.5 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto"
          >
            {ordered.map((g) => {
              const counts = perGame.get(g.id);
              const active = selected?.id === g.id;
              return (
                <li key={g.id}>
                  <button
                    onClick={() => setSelectedId(g.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedId(g.id);
                      setActionError(null);
                      setMenu({ x: event.clientX, y: event.clientY, id: g.id });
                    }}
                    data-orbit-journal-game={g.id}
                    {...bind(g.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition ${
                      active ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60'
                    } ${dragging === g.id ? 'opacity-50' : ''} ${
                      over === g.id && dragging && dragging !== g.id ? 'ring-2 ring-accent' : ''
                    }`}
                  >
                    <Cover game={g} className="size-9 shrink-0 rounded-lg [&_span]:text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{g.title}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {counts && counts.count > 0
                          ? `${counts.count} ${counts.count === 1 ? 'log' : 'logs'}${counts.name ? ` · ${counts.name}` : ''}`
                          : counts?.name
                            ? `nothing on ${counts.name}`
                            : 'nothing logged yet'}
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
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line/70 bg-panel/50 p-3">
                <Cover game={selected} className="size-12 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{selected.title}</h2>
                  <p className="text-[11px] text-muted">
                    {selectedRun ? `Clears only ${selectedRun.name}. Other playthroughs stay.` : 'Clears only the playthrough you are reading.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!selectedRun}
                    onClick={() => selectedRun && setClearTarget({ game: selected, kind: 'logs', run: selectedRun })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-rose-400/60 hover:text-rose-300 disabled:opacity-40"
                    title={selectedRun ? `Remove the Journal entries for ${selectedRun.name} only` : 'The playthrough is still loading'}
                  >
                    <Trash2 className="size-3.5" />
                    Clear log entries
                  </button>
                  <button
                    type="button"
                    disabled={!selectedRun}
                    onClick={() => selectedRun && setClearTarget({ game: selected, kind: 'notes', run: selectedRun })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-rose-400/60 hover:text-rose-300 disabled:opacity-40"
                    title={selectedRun ? `Clear notes for ${selectedRun.name} only` : 'The playthrough is still loading'}
                  >
                    <RotateCcw className="size-3.5" />
                    Clear notes
                  </button>
                </div>
              </div>
              {actionError && <p role="alert" className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{actionError}</p>}
              <GameLogView
                key={`${selected.id}-${version}`}
                game={selected}
                onChanged={() => setVersion((n) => n + 1)}
                onPlaythrough={reportRun}
                onNotes={(notes) => onUpdate(selected.id, { notes })}
                addRequest={addRequest?.id === selected.id ? addRequest.token : undefined}
                onAddHandled={() => setAddRequest(null)}
                // The wide reading has room for the time of day next to the date.
                withClock
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-24 text-muted">
              <NotebookPen className="size-8 opacity-60" />
              <p className="text-sm">Add a game and its log shows up here.</p>
            </div>
          )}
        </section>
      </div>

      {menu && menuGame && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {clearTarget && (
        <ConfirmDialog
          title={clearTarget.kind === 'logs'
            ? `Reset ${clearTarget.game.title}'s log entries on ${clearTarget.run.name}?`
            : `Reset ${clearTarget.game.title}'s notes on ${clearTarget.run.name}?`}
          description={clearTarget.kind === 'logs'
            ? `This removes the Journal entries for ${clearTarget.run.name} only. Other playthroughs, notes, and play sessions stay untouched.`
            : `This clears the notes for ${clearTarget.run.name} only. Journal entries, play sessions, and other playthroughs stay untouched.`}
          confirmLabel={clearTarget.kind === 'logs' ? 'Reset log entries' : 'Reset notes'}
          onCancel={() => setClearTarget(null)}
          onConfirm={clearSelected}
        />
      )}
    </div>
  );
}

/**
 * An entry belongs to the run the list is counting.
 *
 * A row with no run yet is shown on Main, or when the game has only one run.
 * The count has to use the same rule, or the number beside the game would not
 * match the list.
 */
function countedOnRun(log: GameLog, run: { id: string; name: string; runs: number }): boolean {
  if (log.playthroughId) return log.playthroughId === run.id;
  return run.name === 'Main' || run.runs <= 1;
}
