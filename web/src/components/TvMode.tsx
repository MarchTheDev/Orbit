import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  CornerDownLeft,
  Gamepad2,
  Hourglass,
  Info,
  Minimize2,
  Play,
  Square,
  Tv,
} from 'lucide-react';
import type { Game, Settings } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';

/**
 * One shelf of the hub: what it is called, and what sits on it.
 *
 * Exported because the way shelves are chosen is worth checking on its own:
 * the order is the point of the page, not an accident of filtering.
 */
export interface Shelf {
  id: string;
  title: string;
  games: Game[];
}

/** One row of the hub, left to right, the way a console shows a shelf. */
const SHELF_SIZE = 14;

/**
 * What the hub is showing, in the order it is read.
 *
 * The order answers a question that gets less specific as it goes down: what am
 * I in the middle of, what did I put down, what did I mean to play, and finally
 * everything. A game can appear twice - a favourite that is also half-played is
 * both - because a shelf is a way of looking, not a place a game lives.
 */
export function tvShelves(games: Game[]): Shelf[] {
  const here = games.filter((game) => !game.hidden);
  const playing = here.filter((game) => game.status === 'playing');
  const recent = [...here]
    .filter((game) => game.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
    .slice(0, SHELF_SIZE);
  const backlog = here.filter((game) => game.status === 'backlog' && !game.planned);
  const wanted = here.filter((game) => game.planned);
  const favourites = here.filter((game) => game.favorite);
  const all = [...here].sort((a, b) => a.title.localeCompare(b.title));

  return [
    { id: 'playing', title: 'Playing now', games: playing },
    { id: 'recent', title: 'Jump back in', games: recent },
    { id: 'backlog', title: 'Up next', games: backlog.slice(0, SHELF_SIZE) },
    { id: 'wanted', title: 'Wanted, not owned', games: wanted.slice(0, SHELF_SIZE) },
    { id: 'favourites', title: 'Favourites', games: favourites.slice(0, SHELF_SIZE) },
    { id: 'all', title: 'Everything', games: all },
  ].filter((shelf) => shelf.games.length > 0);
}

/**
 * The library, as something to sit in front of.
 *
 * A launcher for a keyboard is a wall of small text and a pointer; a launcher
 * for a couch is a shelf of pictures on a screen with no window around it, where
 * every choice is a large target and the whole thing can be driven by a
 * controller. This is that second thing: the games that matter now along the
 * top, everything below it, and one game held out large - what it is, how long
 * it takes, how much of it is left - with Play as the only thing the page asks
 * you to decide.
 *
 * Moving is a single model: the row and tile that hold focus. Arrows move it,
 * Enter plays it, Escape leaves. A mouse gets the same page - pointing at a
 * tile is the same as focusing it - and the details drawer is still one button
 * away for anything the hub does not say.
 */
export function TvMode({
  games,
  runningId,
  sound,
  setSound,
  showMusic,
  showBars,
  onPlay,
  onStop,
  onDetails,
  onExit,
  onOpenSettings,
}: {
  games: Game[];
  /** The game with the clock running, if there is one. */
  runningId: string | null;
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  showMusic: boolean;
  showBars: boolean;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onDetails: (game: Game) => void;
  onExit: () => void;
  /** Out of the hub and into the page that holds the sound controls. */
  onOpenSettings: () => void;
}) {
  const shelves = useMemo(() => tvShelves(games), [games]);
  const all = useMemo(() => shelves.flatMap((shelf) => shelf.games), [shelves]);

  /** The game the page is about: the one holding focus, or the first there is. */
  const [activeId, setActiveId] = useState<string | null>(runningId ?? all[0]?.id ?? null);
  const active = all.find((game) => game.id === activeId) ?? all[0] ?? null;
  const running = active !== null && active.id === runningId;

  /** The clock in the corner, the way a console has one. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const root = useRef<HTMLDivElement>(null);

  // The document is told it is in TV mode for as long as this is on screen: the
  // page behind is gone, and the window's own background should not show
  // through anywhere the hub does not paint.
  useEffect(() => {
    document.documentElement.classList.add('orbit-tv');
    return () => document.documentElement.classList.remove('orbit-tv');
  }, []);

  /**
   * Show a tile, and make it the one the page is about.
   *
   * Focusing by hand rather than setting state is deliberate: focus is the one
   * thing the keyboard, the controller's ring and the browser all already
   * agree on, so the arrow keys move the same highlight a gamepad does.
   */
  const focusTile = useCallback((row: number, column: number) => {
    const tile = root.current?.querySelector<HTMLElement>(`[data-tv-tile="${row}:${column}"]`);
    if (!tile) return false;
    tile.focus({ preventScroll: true });
    tile.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    return true;
  }, []);

  /** Where focus is, as a shelf and a tile. Nothing focused means the first. */
  const place = useCallback((): { row: number; column: number } | null => {
    const current = document.activeElement;
    if (!(current instanceof HTMLElement)) return null;
    const tile = current.closest<HTMLElement>('[data-tv-tile]');
    const [row, column] = (tile?.dataset.tvTile ?? '').split(':').map(Number);
    if (!Number.isInteger(row) || !Number.isInteger(column)) return null;
    return { row, column };
  }, []);

  const move = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const here = place();
      if (!here) {
        focusTile(0, 0);
        return;
      }
      if (direction === 'left' || direction === 'right') {
        const step = direction === 'right' ? 1 : -1;
        const row = shelves[here.row];
        if (!row) return;
        const next = Math.min(Math.max(here.column + step, 0), row.games.length - 1);
        focusTile(here.row, next);
        return;
      }
      const step = direction === 'down' ? 1 : -1;
      // A shelf with nothing on it is not drawn, so the next shelf is whichever
      // one the eye lands on next rather than the next number.
      let next = here.row + step;
      while (next >= 0 && next < shelves.length) {
        const column = Math.min(here.column, shelves[next].games.length - 1);
        if (focusTile(next, column)) return;
        next += step;
      }
    },
    [focusTile, place, shelves],
  );

  // The keys, all in one place. Enter is caught here rather than left to the
  // button's own click, because on a tile a click means "look at this one",
  // and the console gesture for the same control is "play it".
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        // The page does not scroll by arrow while a shelf is being read: the
        // arrows belong to the shelves, and each one brings itself into view.
        event.preventDefault();
        move(key.slice(5).toLowerCase() as 'left' | 'right' | 'up' | 'down');
        return;
      }
      if (key === 'Enter' && active) {
        // A dialog opened over the hub owns Enter; nothing else does.
        if (document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        if (running) onStop();
        else onPlay(active);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, move, onExit, onPlay, onStop, running]);

  // The first tile is where a couch starts. It is focused after the shelves have
  // been laid out, not before, or there is nothing to focus.
  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      if (!place()) focusTile(0, 0);
    });
    return () => window.cancelAnimationFrame(timer);
  }, [focusTile, place, shelves.length]);

  const art = active?.meta?.backgroundUrl ?? active?.meta?.headerUrl ?? null;
  const left =
    active?.hltb?.main && active.hltb.main > 0
      ? Math.max(0, Math.round(active.hltb.main - active.playSecs / 3600))
      : null;

  return (
    <div
      ref={root}
      data-orbit-tv="1"
      className="tv-root fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-fg"
    >
      {/* The bar: where you are on the left, what time it is on the right. A
          console never asks you to read a menu to find out either. */}
      <header className="flex shrink-0 items-center gap-3 px-4 py-4 sm:gap-4 sm:px-10 sm:py-5">
        <button
          onClick={onExit}
          title="Leave TV mode"
          aria-label="Leave TV mode"
          className="flex items-center gap-3 rounded-2xl px-2 py-1 outline-none transition hover:bg-panel/50 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Logo className="size-8 drop-shadow-[0_2px_10px_var(--c-accent)]" animated />
          <span className="text-xl font-bold tracking-tight">Orbit</span>
          <span className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            <Tv className="size-3.5" />
            TV
          </span>
        </button>

        <div className="flex flex-1 items-center justify-center gap-1">
          {shelves.slice(0, 4).map((shelf, row) => (
            <button
              key={shelf.id}
              onClick={() => focusTile(row, 0)}
              className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted transition hover:bg-panel/60 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
            >
              {shelf.title}
            </button>
          ))}
        </div>

        <span className="hidden items-center gap-2 font-mono text-sm text-muted sm:flex">
          <Clock className="size-4" />
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={onOpenSettings} />
        )}
        <button
          onClick={onExit}
          title="Leave TV mode (Esc)"
          aria-label="Leave TV mode"
          className="grid size-9 place-items-center rounded-full text-muted transition hover:bg-panel/70 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Minimize2 className="size-5" />
        </button>
      </header>

      <div className="orbit-scroll min-h-0 flex-1 overflow-y-auto pb-8">
        {!active ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
            <span className="grid size-20 place-items-center rounded-3xl border border-dashed border-line text-muted">
              <Gamepad2 className="size-9" />
            </span>
            <div>
              <p className="text-2xl font-bold">Nothing to play yet</p>
              <p className="mt-1.5 max-w-md text-sm text-muted">
                TV mode shows the games in your library. Add one and it appears here, next to the rest.
              </p>
            </div>
            <button
              onClick={onExit}
              className="mt-2 flex items-center gap-2 rounded-full border border-line bg-panel px-5 py-2.5 text-sm font-semibold hover:border-accent"
            >
              <ArrowLeft className="size-4" />
              Back to Orbit
            </button>
          </div>
        ) : (
          <>
            {/* The game the page is about, held out large. Its own art is the
                background, because a picture says what a game is faster than
                any line of text under a thumbnail. */}
            <section className="relative mx-4 overflow-hidden rounded-3xl border border-line sm:mx-10 sm:rounded-[2rem]">
              <div className="absolute inset-0">
                {art ? (
                  <img src={art} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Cover game={active} className="size-full opacity-70 [&_span]:hidden" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/10" />
                <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-transparent" />
              </div>

              <div className="relative flex items-end gap-8 px-5 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-10">
                <Cover
                  game={active}
                  className="hidden h-56 w-40 shrink-0 rounded-2xl border border-white/10 shadow-2xl sm:flex [&_span]:text-4xl"
                />
                <div className="min-w-0 max-w-2xl">
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-accent">
                    {running ? (
                      <>
                        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                        Playing now
                      </>
                    ) : (
                      <>
                        {active.status === 'playing' ? 'In progress' : 'Next up'}
                      </>
                    )}
                  </p>
                  <h1 className="orbit-hero-enter truncate text-4xl font-black leading-tight md:text-5xl">
                    {active.title}
                  </h1>
                  <p className="mt-2.5 line-clamp-2 text-sm text-muted">{active.meta?.summary}</p>

                  <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted">Played</p>
                      <p className="text-lg font-bold">{fmtMinutes(active.playSecs / 60)}</p>
                    </div>
                    {left !== null && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-muted">Main story</p>
                        <p className="flex items-center gap-1.5 text-lg font-bold">
                          <Hourglass className="size-4 text-muted" />
                          {left > 0 ? `${left}h left` : 'almost done'}
                        </p>
                      </div>
                    )}
                    {active.lastPlayed && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-muted">Last session</p>
                        <p className="text-lg font-bold">{fmtDate(active.lastPlayed)}</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    {running ? (
                      <button
                        onClick={onStop}
                        className="flex items-center gap-2.5 rounded-full bg-rose-500 px-8 py-3.5 font-bold text-white transition hover:brightness-110 focus-visible:ring-4 focus-visible:ring-rose-400/40"
                      >
                        <Square className="size-4" fill="currentColor" strokeWidth={0} />
                        Stop session
                      </button>
                    ) : (
                      <button
                        onClick={() => onPlay(active)}
                        disabled={active.planned === true}
                        title={active.planned ? 'This one is only planned: there is nothing to start yet' : undefined}
                        className="flex items-center gap-2.5 rounded-full bg-fg px-9 py-3.5 font-bold text-bg transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 focus-visible:ring-4 focus-visible:ring-fg/30"
                      >
                        <Play className="size-4" fill="currentColor" strokeWidth={0} />
                        Play
                      </button>
                    )}
                    <button
                      onClick={() => onDetails(active)}
                      className="flex items-center gap-2.5 rounded-full border border-line bg-panel/80 px-6 py-3.5 font-semibold backdrop-blur transition hover:border-accent focus-visible:ring-4 focus-visible:ring-accent/30"
                    >
                      <Info className="size-4" />
                      Details
                    </button>
                    {active.planned && (
                      <span className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3.5 py-2 text-xs text-muted">
                        <CircleDashed className="size-3.5" />
                        not owned yet
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* The shelves. Each one scrolls sideways on its own and keeps the
                neighbour's first tile showing, which is what tells the eye there
                is more of it. */}
            <div className="mt-8 space-y-7">
              {shelves.map((shelf, row) => (
                <section key={shelf.id} data-tv-shelf={row}>
                  <div className="mb-2.5 flex items-baseline gap-3 px-4 sm:px-10">
                    <h2 className="text-sm font-bold uppercase tracking-[0.22em] text-muted">{shelf.title}</h2>
                    <span className="text-xs text-muted/60">{shelf.games.length}</span>
                  </div>
                  <ul className="tv-shelf flex gap-3 overflow-x-auto px-4 pb-3 sm:gap-4 sm:px-10">
                    {shelf.games.map((game, column) => {
                      const isActive = game.id === active.id;
                      const isRunning = game.id === runningId;
                      return (
                        <li key={`${shelf.id}-${game.id}`} className="shrink-0">
                          <button
                            data-tv-tile={`${row}:${column}`}
                            onFocus={() => setActiveId(game.id)}
                            onClick={() => setActiveId(game.id)}
                            onDoubleClick={() => (game.planned ? undefined : onPlay(game))}
                            aria-label={`${game.title}${isRunning ? ', playing now' : ''}`}
                            className={cn(
                              'tv-tile group relative block overflow-hidden rounded-2xl border text-left outline-none transition duration-200',
                              'h-44 w-[7.6rem] sm:h-52 sm:w-[9rem]',
                              isActive
                                ? 'border-accent/70 ring-4 ring-accent/45'
                                : 'border-line ring-0 hover:border-accent/40 focus-visible:border-accent',
                            )}
                          >
                            <Cover game={game} className="absolute inset-0 size-full [&_span]:text-2xl" />
                            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 pb-2 pt-8">
                              <span className="line-clamp-2 block text-[12px] font-semibold leading-tight text-white">
                                {game.title}
                              </span>
                            </span>
                            {isRunning && (
                              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
                                <span className="size-1 animate-pulse rounded-full bg-black/70" />
                                On
                              </span>
                            )}
                            {game.planned && !isRunning && (
                              <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/70 text-[9px] font-bold text-white/80">
                                ?
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {/* The controls, said once, small, where a console puts them: a key legend
          rather than a manual. */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-line/70 bg-panel/40 px-4 py-2.5 text-[11px] text-muted sm:px-10 sm:py-3">
        <span className="flex items-center gap-1.5">
          <ChevronLeft className="size-3.5" />
          <ChevronRight className="size-3.5" />
          browse
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[10px]">↑</kbd>
          <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[10px]">↓</kbd>
          shelves
        </span>
        <span className="flex items-center gap-1.5">
          <CornerDownLeft className="size-3.5" />
          play
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[10px]">Esc</kbd>
          leave TV mode
        </span>
        <span className="ml-auto hidden items-center gap-1.5 opacity-70 sm:flex">
          <Gamepad2 className="size-3.5" />
          a controller works too
        </span>
      </footer>
    </div>
  );
}
