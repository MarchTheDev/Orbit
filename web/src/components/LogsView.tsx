import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NotebookPen, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Game, GameLog } from '../types';
import { clearGameLogs } from '../services/native';
import { countLogs, listAllLogs } from '../services/native';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [addRequest, setAddRequest] = useState<{ id: string; token: number } | null>(null);
  const addToken = useRef(0);
  const [clearTarget, setClearTarget] = useState<{ game: Game; kind: 'logs' | 'notes' } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    void Promise.all([listAllLogs(2000, 0), countLogs()])
      .then(([rows, count]) => {
        if (!alive) return;
        setLogs(rows);
        setTotal(count);
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

  /** Entries and time per game, worked out once per read. */
  const perGame = useMemo(() => {
    const map = new Map<string, { count: number; secs: number }>();
    for (const log of logs) {
      const found = map.get(log.gameId) ?? { count: 0, secs: 0 };
      found.count += 1;
      found.secs += log.secs;
      map.set(log.gameId, found);
    }
    return map;
  }, [logs]);

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

  const selected = games.find((g) => g.id === selectedId) ?? ordered.find((g) => perGame.has(g.id)) ?? ordered[0] ?? null;
  const menuGame = menu ? games.find((game) => game.id === menu.id) ?? null : null;
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
          label: 'Reset log entries…',
          icon: Trash2,
          danger: true,
          onSelect: () => setClearTarget({ game: menuGame, kind: 'logs' }),
        },
        {
          label: 'Reset game notes…',
          icon: RotateCcw,
          danger: true,
          onSelect: () => setClearTarget({ game: menuGame, kind: 'notes' }),
        },
      ]
    : [];

  const clearSelected = () => {
    if (!clearTarget) return;
    const target = clearTarget;
    setClearTarget(null);
    setActionError(null);
    if (target.kind === 'logs') {
      void clearGameLogs(target.game.id)
        .then(() => setVersion((current) => current + 1))
        .catch((reason) => setActionError(reason instanceof Error ? reason.message : String(reason)));
    } else {
      onUpdate(target.game.id, { notes: '' });
    }
  };

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
            {logs.length} {logs.length === 1 ? 'log' : 'logs'} in {perGame.size}{' '}
            {perGame.size === 1 ? 'game' : 'games'}
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
            className="space-y-1 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto lg:pr-1"
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
                      <span className="block text-[11px] text-muted">
                        {counts ? `${counts.count} ${counts.count === 1 ? 'log' : 'logs'}` : 'nothing logged yet'}
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
                  <p className="text-[11px] text-muted">Reset logs and game notes separately.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setClearTarget({ game: selected, kind: 'logs' })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-rose-400/60 hover:text-rose-300"
                    title="Remove every Journal entry for this game"
                  >
                    <Trash2 className="size-3.5" />
                    Clear log entries
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearTarget({ game: selected, kind: 'notes' })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-rose-400/60 hover:text-rose-300"
                    title="Clear the game's separate general notes"
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
          title={clearTarget.kind === 'logs' ? `Reset ${clearTarget.game.title}'s log entries?` : `Reset ${clearTarget.game.title}'s notes?`}
          description={clearTarget.kind === 'logs'
            ? 'This permanently removes every Journal entry for this game. Its separate general notes, play sessions, and all other games’ entries stay untouched.'
            : 'This permanently clears only the game’s general notes. Journal entries, play sessions, and all other game data stay untouched.'}
          confirmLabel={clearTarget.kind === 'logs' ? 'Reset log entries' : 'Reset notes'}
          onCancel={() => setClearTarget(null)}
          onConfirm={clearSelected}
        />
      )}
    </div>
  );
}
