import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  CornerDownLeft,
  Gamepad2,
  Hourglass,
  Info,
  ListOrdered,
  Minimize2,
  Play,
  Square,
  Tv,
} from 'lucide-react';
import type { Game, Settings } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { inLibraryShelf } from '../utils/library';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';

/** How the one list on the page is ordered. */
export type TvOrder = 'recent' | 'az';

/**
 * The games TV mode is allowed to show.
 *
 * Only what can actually be played: a game that is a plan, or one with nothing
 * on the machine behind it, is a thing to decide about later, not something to
 * start from a sofa. That is the same rule the Library uses for its shelf, so
 * the two pages never disagree about what is in the library, and hidden games
 * are left out for the same reason they are left out there.
 */
export function playableGames(games: Game[]): Game[] {
  return games.filter((game) => inLibraryShelf(game) && !game.hidden);
}

/**
 * The list, in the order it is read.
 *
 * Recently played first, because the game somebody sat down to play is nearly
 * always the one they played last; the rest follow, newest first, so a fresh
 * install is close to the front. `az` is for finding one particular game among
 * a lot of them, which is the only time a name is what you are looking for.
 */
export function orderedForTv(games: Game[], order: TvOrder): Game[] {
  const shown = playableGames(games);
  if (order === 'az') return [...shown].sort((a, b) => a.title.localeCompare(b.title));
  const stamp = (game: Game) => game.lastPlayed ?? game.addedAt ?? '';
  return [...shown].sort((a, b) => {
    const played = (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '');
    if (played !== 0) return played;
    return stamp(b).localeCompare(stamp(a)) || a.title.localeCompare(b.title);
  });
}

/**
 * The library, the way a console shows one.
 *
 * Playnite's fullscreen mode is the shape this follows, because it is the shape
 * a television asks for: the selected game owns the screen - its own artwork
 * behind everything, its name, its numbers and its Play button in front - and
 * the rest of the library is one rail of covers along the bottom that you move
 * along. No categories, no shelves to choose between first: every game you can
 * start is on that one rail, in the order you are likely to want it, and the
 * page is decided the moment it opens.
 *
 * Everything is one axis of movement, which is what makes it work from a couch:
 * left and right walk the rail, and the game the page is about changes with it.
 * Up reaches the buttons, down comes back; Enter plays; Escape gives the screen
 * back. The pad drives the same rail through the focus ring the rest of the app
 * uses, so a controller and a keyboard are the same interface.
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
  const [order, setOrder] = useState<TvOrder>('recent');
  const list = useMemo(() => orderedForTv(games, order), [games, order]);

  const [index, setIndex] = useState(0);
  // A game that stops being playable - or a new one that lands at the front -
  // must not leave the selection pointing past the end of the rail.
  const at = Math.min(index, Math.max(0, list.length - 1));
  const active = list[at] ?? null;
  const running = active !== null && active.id === runningId;
  const playingNow = list.find((game) => game.id === runningId) ?? null;

  const rail = useRef<HTMLUListElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const cover = (n: number) => rail.current?.querySelector<HTMLElement>(`[data-tv-cover="${n}"]`) ?? null;

  /** The clock in the corner, the way a console has one. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  // The document is told it is in TV mode for as long as this is on screen, so
  // no window background shows through anywhere the hub does not paint.
  useEffect(() => {
    document.documentElement.classList.add('orbit-tv');
    return () => document.documentElement.classList.remove('orbit-tv');
  }, []);

  /**
   * Walk the rail.
   *
   * Focus follows the choice rather than the other way round: the ring, the
   * highlight and the game the page describes are always the same game, whether
   * the move came from a key, a stick or a press.
   */
  const select = useCallback((next: number) => {
    if (list.length === 0) return;
    const wrapped = (next + list.length) % list.length;
    setIndex(wrapped);
    const button = cover(wrapped);
    if (button && document.activeElement !== button) button.focus({ preventScroll: true });
  }, [list.length]);

  // The selected cover is kept in the middle of the rail, which is what makes
  // it read as a carousel rather than a list that happens to be horizontal.
  useEffect(() => {
    const scroller = rail.current;
    const button = cover(at);
    if (!scroller || !button) return;
    const left = button.offsetLeft - (scroller.clientWidth - button.clientWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [at, list.length]);

  // Nothing has focus when the hub opens, and a controller with nowhere to go
  // presses nothing. The first press lands on the rail, in the middle.
  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current instanceof HTMLElement && rail.current?.contains(current)) return;
      cover(at)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(timer);
    // Only ever on the way in: afterwards the rail holds its own focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    if (!active) return;
    if (running) onStop();
    else onPlay(active);
  }, [active, onPlay, onStop, running]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened over the hub (the music panel is not one, the app's own
      // dialogs are) owns the keyboard while it is up.
      if (document.querySelector('[role="dialog"]')) return;
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          onExit();
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
          event.preventDefault();
          select(at + (event.key === 'ArrowRight' ? 1 : -1));
          return;
        case 'ArrowUp':
          event.preventDefault();
          playButton.current?.focus({ preventScroll: true });
          return;
        case 'ArrowDown':
          event.preventDefault();
          cover(at)?.focus({ preventScroll: true });
          return;
        case 'Enter':
          event.preventDefault();
          start();
          return;
        case 'Tab':
          // Tabbing out of the rail into the window is how a keyboard loses the
          // interface entirely; the rail is the interface.
          if (event.shiftKey) return;
          event.preventDefault();
          select(at + 1);
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, onExit, select, start]);

  const art = active?.meta?.backgroundUrl ?? active?.meta?.headerUrl ?? null;
  const left =
    active?.hltb?.main && active.hltb.main > 0
      ? Math.max(0, Math.round(active.hltb.main - active.playSecs / 3600))
      : null;
  const progress =
    active?.hltb?.main && active.hltb.main > 0
      ? Math.min(100, Math.round((active.playSecs / 3600 / active.hltb.main) * 100))
      : null;

  return (
    <div data-orbit-tv="1" className="tv-root fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-fg">
      {/* The top panel: where you are, on the left; the room's small facts on
          the right - the order the rail is in, the time, the exit. */}
      <header className="relative z-20 flex shrink-0 items-center gap-3 px-5 py-3.5 sm:gap-5 sm:px-9 sm:py-4">
        <span className="flex items-center gap-3">
          <Logo className="size-7 drop-shadow-[0_2px_10px_var(--c-accent)]" animated />
          <span className="hidden text-lg font-bold tracking-tight sm:block">Orbit</span>
          <span className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
            <Tv className="size-3" />
            TV
          </span>
        </span>

        {playingNow && (
          <span className="flex min-w-0 items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="truncate">{playingNow.title}</span>
            <button
              onClick={onStop}
              className="ml-0.5 rounded-full p-0.5 text-emerald-200/80 transition hover:bg-emerald-400/20 hover:text-white"
              title="Stop the session"
              aria-label="Stop the session"
            >
              <Square className="size-3" fill="currentColor" strokeWidth={0} />
            </button>
          </span>
        )}

        <span className="flex-1" />

        <button
          onClick={() => setOrder(order === 'recent' ? 'az' : 'recent')}
          title={order === 'recent' ? 'Ordered by what you played last. Switch to A–Z' : 'Ordered A–Z. Switch to recent'}
          className="flex items-center gap-2 rounded-full border border-line bg-panel/50 px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-accent hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          {order === 'recent' ? <Clock className="size-3.5" /> : <ListOrdered className="size-3.5" />}
          {order === 'recent' ? 'Recent' : 'A–Z'}
        </button>

        <span className="hidden flex-col items-end leading-tight sm:flex">
          <span className="font-mono text-sm text-fg">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-[10px] uppercase tracking-widest text-muted">
            {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
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

      <main className="relative flex min-h-0 flex-1 flex-col">
        {/* The selected game owns the screen. Its artwork is the page, and every
            part of it fades towards the corner the words are in, so the words
            are readable on whatever the picture happens to be. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {active ? (
            art ? (
              <img
                key={art}
                src={art}
                alt=""
                className="tv-art absolute inset-0 h-full w-full scale-[1.03] object-cover"
              />
            ) : (
              <Cover game={active} className="tv-art absolute inset-0 size-full [&_span]:hidden" />
            )
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/55 to-transparent" />
        </div>

        {!active ? (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <span className="grid size-20 place-items-center rounded-3xl border border-dashed border-line text-muted">
              <Gamepad2 className="size-9" />
            </span>
            <div>
              <p className="text-2xl font-bold">Nothing to play yet</p>
              <p className="mt-1.5 max-w-md text-sm text-muted">
                TV mode shows the games Orbit can start. Add one - or mark a plan as owned - and it
                turns up here.
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
            {/* What the game is, in the corner the eye lands on first. */}
            <div className="relative flex min-h-0 flex-1 items-end px-5 pb-5 sm:px-9">
              <div className="flex w-full items-end gap-7">
                <Cover
                  game={active}
                  className="orbit-hero-enter hidden h-52 w-[9.5rem] shrink-0 rounded-2xl border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,.6)] md:flex [&_span]:text-3xl"
                />
                <div className="min-w-0 max-w-2xl pb-1">
                  <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
                    {running ? (
                      <>
                        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                        Playing now
                      </>
                    ) : (
                      <>
                        {active.status === 'playing'
                          ? 'In progress'
                          : active.status === 'completed'
                            ? 'Finished — back for more?'
                            : 'Ready to play'}
                      </>
                    )}
                  </p>
                  <h1 className="orbit-hero-enter text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
                    {active.title}
                  </h1>

                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
                    <span className="font-semibold text-fg/90">{fmtMinutes(active.playSecs / 60)} played</span>
                    {active.lastPlayed && <span>· last {fmtDate(active.lastPlayed)}</span>}
                    {left !== null && (
                      <span className="flex items-center gap-1.5">
                        <Hourglass className="size-3.5" />
                        {left > 0 ? `${left}h left` : 'almost done'}
                        {progress !== null && <span className="text-muted/70">({progress}%)</span>}
                      </span>
                    )}
                    {active.sizeBytes > 0 && <span>· {fmtBytes(active.sizeBytes)}</span>}
                  </p>

                  {active.meta?.summary && (
                    <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-muted">
                      {active.meta.summary}
                    </p>
                  )}

                  <div className="mt-6 flex flex-wrap items-center gap-3">
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
                        ref={playButton}
                        onClick={start}
                        className="flex items-center gap-2.5 rounded-full bg-fg px-9 py-3.5 font-bold text-bg transition hover:scale-[1.03] focus-visible:ring-4 focus-visible:ring-fg/30"
                      >
                        <Play className="size-4" fill="currentColor" strokeWidth={0} />
                        Play
                      </button>
                    )}
                    <button
                      onClick={() => onDetails(active)}
                      className="flex items-center gap-2.5 rounded-full border border-line bg-panel/70 px-6 py-3.5 font-semibold backdrop-blur transition hover:border-accent focus-visible:ring-4 focus-visible:ring-accent/30"
                    >
                      <Info className="size-4" />
                      Details
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* The rail: every game that can be started, in one row, with the
                selected one lifted out of it. Nothing is grouped or sorted into
                categories - there is one list and one way along it. */}
            <div className="relative shrink-0 pb-2">
              <ul
                ref={rail}
                className="tv-rail flex items-end gap-4 overflow-x-auto px-5 pb-4 pt-3 sm:px-9"
              >
                {list.map((game, n) => {
                  const chosen = n === at;
                  return (
                    <li key={game.id} className="shrink-0">
                      <button
                        data-tv-cover={n}
                        onFocus={() => setIndex(n)}
                        onClick={() => setIndex(n)}
                        onDoubleClick={() => {
                          if (game.id !== runningId) onPlay(game);
                        }}
                        aria-current={chosen ? 'true' : undefined}
                        aria-label={game.title}
                        title={game.title}
                        className={cn(
                          'tv-cover group relative block rounded-xl outline-none transition duration-200',
                          'h-40 w-[7rem] sm:h-52 sm:w-[9.1rem]',
                          chosen
                            ? 'scale-105 ring-2 ring-accent/80 ring-offset-2 ring-offset-[#05040d]'
                            : 'opacity-55 hover:opacity-90',
                        )}
                      >
                        <span className="block h-full w-full overflow-hidden rounded-xl border border-white/10 shadow-lg">
                          <Cover game={game} className="size-full [&_span]:text-xl" />
                        </span>
                        {game.id === runningId && (
                          <span className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
                            <span className="size-1 animate-pulse rounded-full bg-black/70" />
                            On
                          </span>
                        )}
                        <span
                          className={cn(
                            'mt-1.5 block truncate text-center text-[11px] font-medium',
                            chosen ? 'text-fg' : 'text-muted/80',
                          )}
                        >
                          {game.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Where you are in the list, said quietly, so a rail of forty
                  games does not feel like a rail of forty games. */}
              <span className="pointer-events-none absolute right-5 top-1 rounded-full bg-black/45 px-2.5 py-1 font-mono text-[10px] text-white/70 backdrop-blur sm:right-9">
                {at + 1} / {list.length}
              </span>
            </div>
          </>
        )}
      </main>

      {/* The prompts, small, along the bottom: a console tells you which button
          does what rather than making you find a menu to ask. */}
      <footer className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/10 bg-black/40 px-5 py-2.5 text-[11px] text-muted backdrop-blur sm:px-9">
        <span className="flex items-center gap-1.5">
          <ChevronLeft className="size-3.5" />
          <ChevronRight className="size-3.5" />
          browse
        </span>
        <span className="flex items-center gap-1.5">
          <CornerDownLeft className="size-3.5" />
          play
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[10px]">↑</kbd>
          buttons
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[10px]">Esc</kbd>
          leave TV mode
        </span>
        <span className="ml-auto hidden items-center gap-1.5 opacity-70 sm:flex">
          <Gamepad2 className="size-3.5" />
          a controller drives the same rail
        </span>
      </footer>
    </div>
  );
}
