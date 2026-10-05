import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  GripVertical,
  Hourglass,
  LoaderCircle,
  Play,
  Plus,
  SquareArrowRight,
  Timer,
  Undo2,
  X,
} from 'lucide-react';
import type { Game, GameStatus, GameSuggestion } from '../types';
import { fetchMetadata, searchGames } from '../services/metadata';
import { fetchHltb } from '../services/hltb';
import { fmtDate, fmtMinutes, hashHue, uid } from '../utils/format';
import { moveInOrder } from '../utils/reorder';
import { onDisk } from '../utils/library';
import { useDragReorder } from '../hooks/useDragReorder';
import { Cover } from './ui/Cover';
import { SearchField } from './ui/SearchField';
import { btnGhost, inputCls } from './ui/Modal';
import { btnAccent } from './ui/buttons';

/**
 * How long the main story takes, for the two orders that read by length.
 *
 * `Infinity` for a game nobody has times for, so an unmeasured game sorts to the
 * end of both the shortest and the longest list rather than being called the
 * shortest thing on it, which is what a zero would do.
 */
function byLength(game: Game): number {
  const main = game.hltb?.main ?? 0;
  return main > 0 ? main : Number.POSITIVE_INFINITY;
}

/** The order the waiting list is read in, including the player's own. */
type Order = 'mine' | 'shortest' | 'longest' | 'added';

const ORDERS: { id: Order; label: string; icon: typeof Clock }[] = [
  { id: 'mine', label: 'My order', icon: GripVertical },
  { id: 'shortest', label: 'Shortest first', icon: Hourglass },
  { id: 'longest', label: 'Longest first', icon: Clock },
  { id: 'added', label: 'Recently added', icon: Plus },
];

/**
 * What is waiting to be played, what is part-way through, and what has been put
 * down.
 *
 * The library filter can already narrow to these, but it hides them among every
 * other game. This page exists for the question a player actually asks, which is
 * what to start next, so the lanes sit together and a status can be moved without
 * opening a game first. Sorting the waiting list by how long it takes to beat is
 * the difference between a pile and a plan.
 *
 * A game can also be written down here before it is owned: no program, no
 * folder, just a name and a picture. Those sit in their own lane, because
 * "I mean to play this" and "this is installed" are different things.
 */
export function BacklogView({
  games,
  onSelect,
  onStatus,
  onAdd,
  onUpdate,
  onRemove,
  fetchMetadata: fetchMeta,
  myOrder,
  setMyOrder,
}: {
  games: Game[];
  onSelect: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  /** Saves a game that is only planned, so it can be added without a program. */
  onAdd: (game: Game) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  /** Takes a planned game off the list for good. */
  onRemove: (id: string) => void;
  /** Whether titles should be looked up as they are planned. */
  fetchMetadata: boolean;
  /** The player's own order for this page, as ids. */
  myOrder: string[];
  setMyOrder: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('mine');
  /** The title being put on the list, while it is being typed. */
  const [planning, setPlanning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [looking, setLooking] = useState(false);
  /** True while the times each game takes are being compared. */
  const [showTimes, setShowTimes] = useState(false);

  const match = (g: Game) => !query || g.title.toLowerCase().includes(query.toLowerCase());

  /**
   * Games that are only written down.
   *
   * The flag is set when one is planned and cleared the moment a program is
   * pointed at it, so a game stops being a plan the moment it becomes something
   * Orbit can start.
   */
  const planned = games.filter((g) => g.planned && match(g));
  const owned = games.filter((g) => !g.planned);

  /**
   * Suggestions with their covers, while a title is being typed.
   *
   * A search runs a moment after typing stops rather than on every keystroke:
   * the store is happy to answer, but not twenty times a second, and a list that
   * flickers between answers is worse than one that arrives late.
   */
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const text = (planning ?? '').trim();
    if (text.length < 2) {
      setSuggestions([]);
      setLooking(false);
      return;
    }
    setLooking(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void searchGames(text)
        .then((found) => setSuggestions(found))
        .catch(() => setSuggestions([]))
        .finally(() => setLooking(false));
    }, 350);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [planning]);

  /** Write a game down, with the details that are known about it. */
  const plan = async (title: string, appId?: number, coverUrl?: string, hltbHint?: boolean) => {
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    try {
      const game: Game = {
        id: uid(),
        title: name,
        launch: { kind: 'none' },
        exePath: null,
        installDir: null,
        drive: '',
        sizeBytes: 0,
        sizeGb: 0,
        status: 'backlog',
        favorite: false,
        manualPlaySecs: 0,
        playSecs: 0,
        lastPlayed: null,
        addedAt: new Date().toISOString(),
        notes: '',
        hue: hashHue(name),
        coverPath: null,
        planned: true,
        meta: appId || coverUrl
          ? {
              summary: '',
              genres: [],
              developer: '',
              releaseYear: null,
              rating: null,
              coverUrl: coverUrl ?? null,
              headerUrl: null,
              steamAppId: appId ?? null,
              source: 'steam',
            }
          : undefined,
        sessionCount: 0,
        longestSecs: 0,
        running: false,
        companions: [],
      };
      onAdd(game);
      setPlanning(null);
      setSuggestions([]);

      // Details are a bonus, so they arrive after the game is on the list and a
      // failure in either source leaves it exactly as it was written.
      if (fetchMeta || hltbHint) {
        const [meta, hltb] = await Promise.allSettled([fetchMetadata(name, appId), fetchHltb(name)]);
        onUpdate(game.id, {
          ...(meta.status === 'fulfilled' ? { meta: meta.value, title: meta.value.name || name } : {}),
          ...(hltb.status === 'fulfilled' ? { hltb: hltb.value } : {}),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  /** The waiting list, in whichever order is being read. */
  const backlog = useMemo(() => {
    const list = owned.filter((g) => g.status === 'backlog' && match(g));
    return [...list].sort((a, b) => {
      if (order === 'mine') {
        const ai = myOrder.indexOf(a.id);
        const bi = myOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      if (order === 'shortest') return byLength(a) - byLength(b) || a.title.localeCompare(b.title);
      if (order === 'longest') return byLength(b) - byLength(a) || a.title.localeCompare(b.title);
      return b.addedAt.localeCompare(a.addedAt);
    });
  }, [owned, match, order, myOrder]);

  /**
   * Move one game to where another one is.
   *
   * The whole waiting list is written out, so the stored order is the order the
   * player sees. Anything that is not on the waiting list at all, a completed
   * game for instance, keeps its own order after them.
   */
  const move = (fromId: string, toId: string, after: boolean) => {
    const ids = moveInOrder(
      backlog.map((g) => g.id),
      fromId,
      toId,
      after,
    );
    setMyOrder([...ids, ...myOrder.filter((id) => !ids.includes(id))]);
  };

  const playing = owned.filter((g) => g.status === 'playing' && match(g));
  const completed = owned.filter((g) => g.status === 'completed' && match(g));
  const dropped = owned.filter((g) => g.status === 'dropped' && match(g));

  const backlogHours = backlog.reduce((s, g) => s + (g.hltb?.main ?? 0), 0);
  const unknown = backlog.filter((g) => !g.hltb?.main).length;

  return (
    <div className="space-y-8 px-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Backlog</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{backlog.length} waiting</span>
            {backlogHours > 0 && (
              <span className="flex items-center gap-1">
                <Hourglass className="size-3.5" />
                about {Math.round(backlogHours)}h of main story
              </span>
            )}
            {unknown > 0 && <span title="HowLongToBeat has no time for these yet">· {unknown} unknown</span>}
            {planned.length > 0 && <span>· {planned.length} not owned yet</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPlanning(planning === null ? '' : null)}
            className={`${btnGhost} flex items-center gap-2`}
            title="Add something you plan to play, even if you do not own it yet"
          >
            <Plus className="size-4" />
            Plan a game
          </button>
          {/* Comparing how long things take is the one question this page
              exists to answer, so it is one click away rather than hidden in
              each game's own page. */}
          <button
            onClick={() => setShowTimes((v) => !v)}
            title="Show how long each game takes, to compare them"
            aria-pressed={showTimes}
            className={`glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
              showTimes ? 'text-accent' : 'text-muted hover:text-fg'
            }`}
          >
            <Timer className="size-3.5" />
            Times
          </button>
          <div className="glass flex rounded-full p-1">
            {ORDERS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOrder(o.id)}
                title={o.label}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  order === o.id ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                <o.icon className="size-3.5" />
                {o.label}
              </button>
            ))}
          </div>
          <SearchField value={query} onChange={setQuery} />
        </div>
      </header>

      {/* The waiting list at a glance, to answer "what can I finish this
          weekend" without opening anything: the shortest, the longest, and how
          much is left of all of it together. */}
      {showTimes && backlog.length > 0 && (
        <section className="glass flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-4 py-3 text-sm">
          {(() => {
            const measured = backlog.filter((g) => (g.hltb?.main ?? 0) > 0);
            const hours = measured.map((g) => g.hltb!.main);
            const left = measured.reduce((sum, g) => sum + Math.max(0, g.hltb!.main - g.playSecs / 3600), 0);
            return (
              <>
                <span className="text-muted">
                  {measured.length} of {backlog.length} have times
                </span>
                <span>
                  shortest <b className="font-mono">{Math.min(...hours)}h</b>
                </span>
                <span>
                  longest <b className="font-mono">{Math.max(...hours)}h</b>
                </span>
                <span>
                  left in total <b className="font-mono">{Math.round(left)}h</b>
                </span>
              </>
            );
          })()}
        </section>
      )}

      {planning !== null && (
        <form
          className="glass rounded-2xl p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void plan(planning, suggestions[0]?.appId, suggestions[0]?.coverUrl ?? undefined, true);
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Plus className="size-4 shrink-0 text-accent" />
            <input
              autoFocus
              className={`${inputCls} min-w-[14rem] flex-1`}
              value={planning}
              onChange={(e) => setPlanning(e.target.value)}
              placeholder="A game you plan to play, owned or not"
              spellCheck={false}
            />
            <button className={`${btnAccent} flex items-center gap-2 rounded-lg px-4 py-2 text-sm`} disabled={busy || !planning.trim()}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
              {busy ? 'Adding…' : 'Add to backlog'}
            </button>
            <button type="button" className="px-2 text-xs text-muted hover:text-fg" onClick={() => setPlanning(null)}>
              <X className="size-4" />
            </button>
          </div>

          {/* The games the store suggests, with their pictures: picking the right
              one out of a row of similar titles is much easier with the cover in
              front of you. */}
          {(suggestions.length > 0 || looking) && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {looking && suggestions.length === 0 && (
                <li className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-muted">
                  <LoaderCircle className="size-4 animate-spin" />
                  Looking through the store…
                </li>
              )}
              {suggestions.map((s) => (
                <li key={s.appId}>
                  <button
                    type="button"
                    onClick={() => void plan(s.name, s.appId, s.coverUrl ?? undefined, true)}
                    title={`Add ${s.name} to the backlog`}
                    className="flex items-center gap-2 rounded-xl border border-line bg-panel2/40 py-1.5 pl-1.5 pr-3 text-left transition hover:border-accent"
                  >
                    {s.coverUrl ? (
                      <img src={s.coverUrl} alt="" className="h-10 w-16 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="grid h-10 w-16 shrink-0 place-items-center rounded-lg bg-panel2 text-muted">
                        <CircleDashed className="size-4" />
                      </span>
                    )}
                    <span className="max-w-[13rem] truncate text-sm">{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}

      <Section
        title="Playing now"
        icon={Play}
        games={playing}
        empty="Nothing part-way through."
        onSelect={onSelect}
        onStatus={onStatus}
        movable={false}
        showTimes={showTimes}
      />

      <Section
        title="Waiting to play"
        icon={CircleDashed}
        games={backlog}
        empty="Nothing waiting. Write one down above, or add a game from the Library."
        onSelect={onSelect}
        onStatus={onStatus}
        movable={order === 'mine' && query.trim() === ''}
        onMove={move}
        showTimes={showTimes}
      />

      {planned.length > 0 && (
        <Section
          title="Not owned yet"
          icon={Plus}
          games={planned}
          empty="Nothing written down that you do not own."
          onSelect={onSelect}
          onStatus={onStatus}
          movable={false}
          notOwned
          // Owning it moves it to the waiting list rather than straight to
          // playing: wanting a game and being in the middle of it are not the
          // same thing.
          onOwned={(id) => onUpdate(id, { planned: false, status: 'backlog' })}
          onRemove={(id) => {
            const game = games.find((g) => g.id === id);
            if (game && confirm(`Take ${game.title} off the list?`)) onRemove(id);
          }}
        />
      )}

      <Section
        title="Dropped"
        icon={SquareArrowRight}
        games={dropped}
        empty="Nothing dropped."
        onSelect={onSelect}
        onStatus={onStatus}
        movable={false}
        showTimes={showTimes}
      />

      {completed.length > 0 && (
        <Section
          title="Completed"
          icon={CircleCheck}
          games={completed}
          empty="Nothing finished yet."
          onSelect={onSelect}
          onStatus={onStatus}
          movable={false}
          showTimes={showTimes}
        />
      )}
    </div>
  );
}

/** What a game's status can be moved to from here, without opening it. */
const MOVES: { status: GameStatus; label: string; icon: typeof Play }[] = [
  { status: 'playing', label: 'Playing', icon: Play },
  { status: 'backlog', label: 'Waiting to play', icon: Undo2 },
  { status: 'completed', label: 'Completed', icon: CircleCheck },
  { status: 'dropped', label: 'Dropped', icon: SquareArrowRight },
];

function Section({
  title,
  icon: Icon,
  games,
  empty,
  onSelect,
  onStatus,
  movable,
  onMove,
  onRemove,
  onOwned,
  notOwned,
  showTimes,
}: {
  title: string;
  icon: typeof Play;
  games: Game[];
  empty: string;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: GameStatus) => void;
  /** True when this lane is being read in the player's own order. */
  movable: boolean;
  onMove?: (fromId: string, toId: string, after: boolean) => void;
  onRemove?: (id: string) => void;
  /** The player now owns something that was only written down. */
  onOwned?: (id: string) => void;
  notOwned?: boolean;
  /** Comparing times: each card says how long it takes, three ways. */
  showTimes?: boolean;
}) {
  // The same pointer-based reordering the library uses: a webview that keeps
  // file drags for itself never delivers a browser drag here either.
  const { bind, dragging, over } = useDragReorder(movable && onMove ? onMove : undefined);

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-muted">
        <Icon className="size-3.5" />
        {title} · {games.length}
        {movable && games.length > 1 && (
          <span className="normal-case tracking-normal">press on a card and move it to place it</span>
        )}
        {!notOwned && games.length > 0 && !movable && (
          <span className="normal-case tracking-normal opacity-60">open a card to move it or to write about it</span>
        )}
      </h2>
      {games.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((g) => {
            const main = g.hltb?.main ?? 0;
            const left = Math.max(0, main - g.playSecs / 3600);
            return (
              <li
                key={g.id}
                {...bind(g.id)}
                className={`glass group flex items-center gap-3 rounded-2xl p-3 ${movable ? 'cursor-grab active:cursor-grabbing' : ''} ${
                  over === g.id ? 'ring-2 ring-accent' : ''
                } ${dragging === g.id ? 'opacity-60' : ''}`}
              >
                {movable && <GripVertical className="size-4 shrink-0 text-muted" />}
                <button onClick={() => onSelect(g.id)} className="shrink-0" title={`Open ${g.title}`}>
                  <Cover game={g} className="size-16 rounded-xl transition group-hover:scale-105 [&_span]:text-sm" />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => onSelect(g.id)}
                    className="block max-w-full truncate text-left text-sm font-semibold hover:text-accent"
                  >
                    {g.title}
                  </button>
                  {notOwned ? (
                    <p className="mt-0.5 text-xs text-muted">not installed here</p>
                  ) : (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      <span>{fmtMinutes(g.playSecs / 60)} played</span>
                      {/* Owned, but nowhere on the machine: it belongs to this
                          page until it has a folder, not to the library. */}
                      {!onDisk(g) && (
                        <span className="rounded-full border border-dashed border-line px-1.5 text-[10px]">
                          no folder yet
                        </span>
                      )}
                      {g.lastPlayed && <span>· {fmtDate(g.lastPlayed)}</span>}
                      {main > 0 && (
                        <span className="flex items-center gap-1" title={`HowLongToBeat: ${main}h for the main story`}>
                          <Hourglass className="size-3" />
                          {left > 0.5 ? `${Math.round(left)}h left` : 'almost done'}
                        </span>
                      )}
                    </p>
                  )}
                  {main > 0 && !notOwned && (
                    <div
                      className="mt-1.5 h-1 overflow-hidden rounded-full bg-line"
                      title={`${Math.round((g.playSecs / 3600 / main) * 100)}% of the main story`}
                    >
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${Math.min(100, (g.playSecs / 3600 / main) * 100)}%` }}
                      />
                    </div>
                  )}

                  {/* All three HowLongToBeat times at once, so two games can be
                      held against each other without opening either. */}
                  {showTimes && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(
                        [
                          ['Main', g.hltb?.main ?? 0, '#38bdf8'],
                          ['+ Extras', g.hltb?.mainExtra ?? 0, '#a78bfa'],
                          ['100%', g.hltb?.completionist ?? 0, '#f472b6'],
                        ] as const
                      ).map(([label, hours, colour]) => (
                        <span
                          key={label}
                          title={`${label}: ${hours > 0 ? `${hours} hours` : 'no time known'}`}
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            color: hours > 0 ? colour : undefined,
                            background: hours > 0 ? `color-mix(in srgb, ${colour} 15%, transparent)` : 'transparent',
                            border: hours > 0 ? 'none' : '1px dashed var(--c-border)',
                          }}
                        >
                          {label} {hours > 0 ? `${hours}h` : '?'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {notOwned ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => onOwned?.(g.id)}
                        title="I own this now, move it to the waiting list"
                        aria-label={`Move ${g.title} to the waiting list`}
                        className="rounded-md border border-line bg-panel p-1 text-muted hover:border-accent hover:text-accent"
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        onClick={() => onRemove?.(g.id)}
                        title="Take this off the list"
                        aria-label={`Take ${g.title} off the list`}
                        className="rounded-md border border-line bg-panel p-1 text-muted hover:border-rose-400 hover:text-rose-400"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    // No Play button here. This page is about what to play next,
                    // not about starting something: nothing on it is played from
                    // the card, and a button that started a game from a planning
                    // list is a button that gets pressed by accident.
                    <div className="flex flex-wrap justify-end gap-1">
                      {MOVES.filter((m) => m.status !== g.status).map((m) => (
                        <button
                          key={m.status}
                          onClick={() => onStatus(g.id, m.status)}
                          title={`Move to ${m.label}`}
                          aria-label={`Move ${g.title} to ${m.label}`}
                          className="rounded-md border border-line bg-panel p-1 text-muted hover:border-accent hover:text-accent"
                        >
                          <m.icon className="size-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
