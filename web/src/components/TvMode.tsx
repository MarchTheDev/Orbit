import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Gamepad2,
  HardDrive,
  Hourglass,
  Info,
  ListOrdered,
  Minimize2,
  Play,
  Square,
} from 'lucide-react';
import type { Game, Settings } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { inLibraryShelf } from '../utils/library';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { Logo } from './ui/Logo';
import { TvDetails } from './TvDetails';
import { MusicButton } from './MusicButton';
import { padJustActivated } from '../hooks/useGamepad';
import { tvLite } from '../services/tv';

const lite = tvLite;

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
  return [...shown].sort((a, b) => {
    const played = (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '');
    if (played !== 0) return played;
    return (
      (b.addedAt ?? '').localeCompare(a.addedAt ?? '') || a.title.localeCompare(b.title)
    );
  });
}

/** Whether the machine has asked for things to stay still. */
function prefersCalm(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The store's id for a game, whether it is in the details or in the launch target. */
function steamIdOf(game: Game): number | null {
  const fromMeta = game.meta?.steamAppId ?? null;
  if (fromMeta) return fromMeta;
  const launch = game.launch;
  return launch && 'appId' in launch && typeof launch.appId === 'number' ? launch.appId : null;
}

/**
 * The pictures this game can put behind the hub, sharpest first.
 *
 * The store's `background_image` is a page backdrop at a few hundred pixels,
 * which is exactly what a 4K television makes obvious: blown up across the
 * whole screen it is a smear. Steam publishes a `library_hero` for most games at
 * around 3840 across, which is the picture its own big-screen UI uses, and it is
 * addressed by app id alone - so it is asked for first and the older pictures
 * are only there in case a game has none. A URL that does not exist costs one
 * failed request and nothing else; the next one in the list is tried.
 */
export function backdropsFor(game: Game): string[] {
  const id = steamIdOf(game);
  const out: string[] = [];
  if (id) out.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`);
  if (game.meta?.backgroundUrl) out.push(game.meta.backgroundUrl);
  if (game.meta?.headerUrl) out.push(game.meta.headerUrl);
  return out;
}

/**
 * The artwork behind the hub, swapped as the selection moves.
 *
 * Two layers on purpose. The cheap picture - the one already in the library's
 * own cache - is stretched and blurred underneath, so the screen is never empty
 * while the big one travels; the sharp one fades in over it once it is actually
 * decoded. A failed picture steps down the list rather than leaving a hole.
 */
function Backdrop({ game }: { game: Game }) {
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const shown = useRef<HTMLImageElement>(null);
  const list = backdropsFor(game);
  const src = list[step] ?? null;

  useEffect(() => {
    setStep(0);
    setLoaded(false);
  }, [game.id]);

  // A picture already in the cache can finish before React's load listener is
  // attached, and would then never be shown at all.
  useEffect(() => {
    if (shown.current?.complete) setLoaded(true);
  }, [src]);

  const soft = game.meta?.headerUrl ?? game.meta?.backgroundUrl ?? null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {soft && (
        <img
          key={`soft-${game.id}`}
          src={soft}
          alt=""
          aria-hidden
          className={cn(
          'absolute inset-0 h-full w-full object-cover',
          lite ? 'scale-105 opacity-45' : 'scale-110 opacity-70 blur-2xl',
        )}
        />
      )}
      {src ? (
        <img
          key={src}
          ref={shown}
          src={src}
          alt=""
          aria-hidden
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setStep((at) => at + 1);
          }}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition duration-700 ease-out',
            loaded ? 'scale-[1.02] opacity-100' : 'scale-[1.06] opacity-0',
          )}
        />
      ) : (
        <Cover game={game} className="absolute inset-0 size-full [&_span]:hidden" />
      )}
      {/* The scrims. Everything over the picture is read against the darkest
          corner of it, and the picture fades into the rail rather than ending
          at a line above it. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#05040d] via-[#05040d]/55 to-[#05040d]/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#05040d] via-[#05040d]/45 to-transparent" />
    </div>
  );
}

/** A small fact about the game, in the row under its name. */
function Fact({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <span className={cn(
        'flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12.5px] font-medium text-white/80',
        lite ? 'bg-white/[0.12]' : 'bg-white/[0.06] backdrop-blur-sm',
      )}>
      <Icon className="size-3.5 text-white/50" />
      {children}
    </span>
  );
}

/**
 * The library, the way a console shows one.
 *
 * Playnite's fullscreen mode is the shape this follows, because it is the shape
 * a television asks for: the selected game owns the screen - its own artwork
 * behind everything, its name, its numbers and its Play button in front - and
 * the rest of the library is one rail of covers along the bottom that you move
 * along. No categories, no shelves to choose between first: every game you can
 * start is on that one rail, and the page is decided the moment it opens.
 *
 * Everything is one axis of movement, which is what makes it work from a couch:
 * left and right walk the rail and the game the page is about changes with it.
 * Up reaches the buttons, where left and right then move between them, and down
 * comes back to the rail. Enter plays; Escape gives the screen back. The pad
 * drives the same rail through the focus ring the rest of the app uses.
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
  /** The moment the hub spends arriving, before the rail is handed the room. */
  const [booting, setBooting] = useState(() => !prefersCalm());
  /** True for the moment the screen takes to go dark before the app returns. */
  const [leaving, setLeaving] = useState(false);
  const list = useMemo(() => orderedForTv(games, order), [games, order]);

  /** The game being read on its own page, if one is. */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  // A game that stops being playable - or a new one that lands at the front -
  // must not leave the selection pointing past the end of the rail.
  const at = Math.min(index, Math.max(0, list.length - 1));
  const active = list[at] ?? null;
  const running = active !== null && active.id === runningId;
  /** The game whose own page is open, when it is still one of the playable ones. */
  const detailed = detailId ? (list.find((game) => game.id === detailId) ?? null) : null;
  const playingNow = list.find((game) => game.id === runningId) ?? null;

  const rail = useRef<HTMLUListElement>(null);
  const exitTimer = useRef(0);

  // The boot mark is a welcome, not a wait: it is over in about a second and
  // nothing is disabled while it plays. Anyone who asked for less motion gets
  // the hub straight away.
  useEffect(() => {
    if (!booting) return;
    const timer = window.setTimeout(() => setBooting(false), 1300);
    return () => window.clearTimeout(timer);
  }, [booting]);
  const coverOf = (n: number) => rail.current?.querySelector<HTMLElement>(`[data-tv-cover="${n}"]`) ?? null;

  /**
   * Give the screen back.
   *
   * The hub is the whole window, so it cannot simply stop being drawn: the
   * library appearing in its place in the same frame is a jump cut, and a jump
   * cut is the one thing a television never does. It fades and settles first,
   * then hands the window back. A second press while that is happening is not a
   * second exit.
   */
  const exit = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const calm = prefersCalm();
    exitTimer.current = window.setTimeout(() => onExit(), calm ? 0 : 320);
  }, [leaving, onExit]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  /** The clock, the way a console has one. */
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
  const select = useCallback(
    (next: number) => {
      if (list.length === 0) return;
      const wrapped = (next + list.length) % list.length;
      setIndex(wrapped);
      const button = coverOf(wrapped);
      if (button && document.activeElement !== button) button.focus({ preventScroll: true });
    },
    [list.length],
  );

  // The selected cover is kept in the middle of the rail, which is what makes it
  // read as a carousel rather than a list that happens to be horizontal.
  useEffect(() => {
    const scroller = rail.current;
    const button = coverOf(at);
    if (!scroller || !button) return;
    // Snapping is the compositor's job here: the covers carry the alignment,
    // and the rail walks to the chosen one natively. On a runtime that paints
    // slowly the jump is taken straight there instead of animated frame by
    // frame out of the page's own budget.
    button.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: tvLite ? 'auto' : 'smooth',
    });
  }, [at, list.length]);

  // Nothing has focus when the hub opens, and a controller with nowhere to go
  // presses nothing. The first press lands on the rail, in the middle.
  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current instanceof HTMLElement && rail.current?.contains(current)) return;
      coverOf(at)?.focus({ preventScroll: true });
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

  /**
   * The buttons of the game on screen, in the order the eye reads them.
   *
   * Only the row under the game's name: the sound and the way out are up in
   * the top bar, and a sideways press at the bottom of the screen should never
   * quietly move focus into it.
   */
  const actionButtons = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-tv-actions] [data-tv-action]'));
  const onAction = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.closest('[data-tv-action]') !== null;
  /** The controls in the bar along the top: the sound and the way out. */
  const barButtons = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-tv-topbar] button'));
  const inTopbar = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.closest('[data-tv-topbar]') !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A game's own page reads its own keys, and a dialog over the hub owns
      // them outright.
      if (detailed || document.querySelector('[role="dialog"]')) return;
      const inActions = onAction(document.activeElement);
      const inBar = inTopbar(document.activeElement);
      // Nothing is focused yet - the first press of a controller lands here.
      // Without this, a direction from nowhere would do nothing at all.
      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowDown') &&
        (!(document.activeElement instanceof HTMLElement) ||
          document.activeElement === document.body)
      ) {
        event.preventDefault();
        select(at + (event.key === 'ArrowRight' ? 1 : 0) - (event.key === 'ArrowLeft' ? 1 : 0));
        return;
      }
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          exit();
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault();
          // Up in the bar, sideways is the next control in the bar - the sound,
          // then the way out - rather than the next game behind it.
          if (inBar) {
            const buttons = barButtons();
            const here = buttons.indexOf(document.activeElement as HTMLElement);
            const step = event.key === 'ArrowRight' ? 1 : -1;
            buttons[(here + step + buttons.length) % buttons.length]?.focus({ preventScroll: true });
            return;
          }
          // Inside the row of buttons, left and right mean the next button -
          // Play then Details - and not the next game. The rail is where a
          // sideways press changes which game is being looked at.
          if (inActions) {
            const buttons = actionButtons();
            const here = buttons.indexOf(document.activeElement as HTMLElement);
            const step = event.key === 'ArrowRight' ? 1 : -1;
            const next = buttons[(here + step + buttons.length) % buttons.length];
            next?.focus({ preventScroll: true });
            return;
          }
          select(at + (event.key === 'ArrowRight' ? 1 : -1));
          return;
        }
        case 'ArrowUp': {
          if (inBar) return;
          event.preventDefault();
          // Up from the rail reaches the game's own buttons; up again leaves
          // the page for the bar at the top, where the sound and the way out
          // are. Without that second step the bar would need a mouse.
          if (inActions) {
            const bar = document.querySelector<HTMLElement>('[data-tv-topbar] button');
            bar?.focus({ preventScroll: true });
            return;
          }
          (actionButtons()[0] ?? coverOf(at))?.focus({ preventScroll: true });
          return;
        }
        case 'ArrowDown': {
          event.preventDefault();
          // Down out of the bar lands back on the game's buttons, so the way up
          // into the bar is also the way back down out of it.
          if (inBar) {
            (actionButtons()[0] ?? coverOf(at))?.focus({ preventScroll: true });
            return;
          }
          coverOf(at)?.focus({ preventScroll: true });
          return;
        }
        case 'Enter':
          // A focused button gets its own Enter - the sound, the way out, Play,
          // Details - so pressing it twice cannot also start the game behind
          // it. The press is turned into the click here rather than left to the
          // browser, so that a controller and a keyboard arrive at the same
          // button the same way. Only a bare hub has no button to give it to.
          if (inActions || inBar) {
            event.preventDefault();
            (document.activeElement as HTMLElement | null)?.click();
            return;
          }
          event.preventDefault();
          start();
          return;
        case 'Tab':
          // Tabbing out of the rail is how a keyboard loses the interface
          // entirely; the rail is the interface.
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
  }, [at, detailed, exit, select, start]);

  /**
   * The controller.
   *
   * A pad does not send arrow keys: it moves the focus ring itself, and the
   * hub follows the ring, so walking the rail with a stick works without any of
   * this. What it cannot do on its own is the two things the mode is named for:
   * a confirm press on a cover plays the game rather than only selecting it,
   * and Back steps out of a game's page - or out of TV mode when there is no
   * page to step out of.
   */
  useEffect(() => {
    const onPadPlay = () => {
      if (detailed) {
        if (detailed.id === runningId) onStop();
        else onPlay(detailed);
        return;
      }
      start();
    };
    const onPadBack = (event: Event) => {
      // Answered here rather than by the shell: only the hub knows whether it
      // is on the rail or on a game's page.
      event.stopImmediatePropagation();
      if (detailed) setDetailId(null);
      else exit();
    };
    window.addEventListener('orbit-pad-play', onPadPlay);
    window.addEventListener('orbit-pad-back', onPadBack, true);
    return () => {
      window.removeEventListener('orbit-pad-play', onPadPlay);
      window.removeEventListener('orbit-pad-back', onPadBack, true);
    };
  }, [detailed, exit, onPlay, onStop, runningId, start]);

  const left =
    active?.hltb?.main && active.hltb.main > 0
      ? Math.max(0, Math.round(active.hltb.main - active.playSecs / 3600))
      : null;
  const progress =
    active?.hltb?.main && active.hltb.main > 0
      ? Math.min(100, Math.round((active.playSecs / 3600 / active.hltb.main) * 100))
      : null;

  return (
    <div
      data-orbit-tv="1"
      className={cn(
        'tv-root fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-fg',
        leaving && 'tv-root-leaving pointer-events-none',
      )}
    >
      {active && <Backdrop game={active} />}

      {/* The way a console arrives: the mark, its name, one line of light, and
          then the room. Drawn over the hub rather than instead of it, so the
          rail is already in place and in focus when the screen clears. */}
      {booting && (
        <div className="tv-boot" aria-hidden>
          <Logo className="tv-boot-mark" animated />
          <p className="tv-boot-word">Orbit</p>
          <span className="tv-boot-rule" />
        </div>
      )}

      {/* And the way it goes: the picture sinks into the dark and the mark is
          left for a moment, the way a screen that is switching off holds its
          last bright thing. */}
      {leaving && (
        <div className="tv-shutdown" aria-hidden>
          <Logo className="tv-shutdown-mark" animated={false} />
        </div>
      )}
      {/* A wash under the top bar, so its few words stay readable over a game
          whose artwork happens to be bright exactly there. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/60 via-black/25 to-transparent" />

      {/* The top panel: where you are, and the room's small facts. It floats on
          the artwork rather than sitting in a bar of its own. */}
      <header data-tv-topbar className="relative z-20 flex shrink-0 items-center gap-3 px-5 pb-4 pt-4 sm:px-9 sm:pt-5">
        <span className="flex items-center gap-3">
          <Logo className="size-7 drop-shadow-[0_2px_10px_var(--c-accent)]" animated />
          <span className="hidden text-lg font-bold tracking-tight text-white/90 sm:block">Orbit</span>
        </span>

        {playingNow && (
          <span className={cn(
              'ml-1 flex min-w-0 items-center gap-2 rounded-full border border-emerald-400/30 px-3 py-1 text-xs font-semibold text-emerald-300',
              lite ? 'bg-emerald-400/15' : 'bg-emerald-400/10 backdrop-blur-sm',
            )}>
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="truncate">{playingNow.title}</span>
            <button
              onClick={onStop}
              className="ml-0.5 rounded-full p-0.5 text-emerald-200/80 transition hover:bg-emerald-400/20 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-300"
              title="Stop the session"
              aria-label="Stop the session"
            >
              <Square className="size-3" fill="currentColor" strokeWidth={0} />
            </button>
          </span>
        )}

        <span className="flex-1" />

        <span className="hidden flex-col items-end leading-tight sm:flex">
          <span className="font-mono text-sm text-white/85">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-white/40">
            {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </span>

        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={onOpenSettings} />
        )}

        <button
          onClick={exit}
          title="Leave TV mode (Esc)"
          aria-label="Leave TV mode"
          className="grid size-9 place-items-center rounded-full text-white/50 transition hover:bg-accent/15 hover:text-white focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Minimize2 className="size-5" />
        </button>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col">
        {detailed ? (
          <TvDetails
            game={detailed}
            running={detailed.id === runningId}
            onPlay={() => onPlay(detailed)}
            onStop={onStop}
            onBack={() => {
              setDetailId(null);
              setIndex(list.findIndex((game) => game.id === detailed.id));
            }}
          />
        ) : !active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
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
              onClick={exit}
              className="mt-2 flex items-center gap-2 rounded-full border border-line bg-panel px-5 py-2.5 text-sm font-semibold hover:border-accent"
            >
              <ArrowLeft className="size-4" />
              Back to Orbit
            </button>
          </div>
        ) : (
          <>
            {/* What the game is, in the corner the eye lands on first. */}
            <div className="flex min-h-0 flex-1 items-end px-5 sm:px-9">
              <div className="flex w-full items-end gap-8 pb-2">
                <Cover
                  game={active}
                  className="orbit-hero-enter hidden h-[clamp(7.5rem,26vh,14rem)] w-[clamp(5.4rem,18vh,10.2rem)] shrink-0 rounded-2xl border border-white/15 shadow-[0_28px_70px_rgba(0,0,0,.7)] md:flex [&_span]:text-3xl"
                />
                <div className="min-w-0 max-w-3xl pb-1">
                  <p className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.32em] text-accent">
                    {running ? (
                      <>
                        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                        Playing now
                      </>
                    ) : active.status === 'playing' ? (
                      'In progress'
                    ) : active.status === 'completed' ? (
                      'Finished'
                    ) : (
                      'Ready to play'
                    )}
                  </p>
                  <h1 className="orbit-hero-enter line-clamp-2 text-[clamp(1.9rem,4.2vh+1.2vw,4.2rem)] font-black leading-[0.98] tracking-[-0.02em] text-white [text-shadow:0_2px_30px_rgba(0,0,0,.55)]">
                    {active.title}
                  </h1>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Fact icon={Clock}>{fmtMinutes(active.playSecs / 60)} played</Fact>
                    {active.lastPlayed && <Fact icon={Calendar}>last {fmtDate(active.lastPlayed)}</Fact>}
                    {left !== null && (
                      <Fact icon={Hourglass}>
                        {left > 0 ? `${left}h left` : 'almost done'}
                        {progress !== null && <span className="text-white/40">· {progress}%</span>}
                      </Fact>
                    )}
                    {active.sizeBytes > 0 && <Fact icon={HardDrive}>{fmtBytes(active.sizeBytes)}</Fact>}
                  </div>

                  {active.meta?.summary && (
                    <p className="mt-3.5 hidden max-w-xl text-sm leading-relaxed text-white/55 [@media(min-height:800px)]:line-clamp-2 [@media(min-height:800px)]:sm:block">
                      {active.meta.summary}
                    </p>
                  )}

                  <div data-tv-actions className="mt-6 flex flex-wrap items-center gap-3">
                    {running ? (
                      <button
                        data-tv-action="stop"
                        onClick={onStop}
                        className="flex items-center gap-2.5 rounded-full bg-rose-500 px-8 py-3.5 text-[15px] font-bold text-white shadow-[0_10px_40px_rgba(244,63,94,.35)] transition hover:brightness-110 focus-visible:ring-4 focus-visible:ring-rose-400/40"
                      >
                        <Square className="size-4" fill="currentColor" strokeWidth={0} />
                        Stop session
                      </button>
                    ) : (
                      <button
                        data-tv-action="play"
                        onClick={start}
                        className="flex items-center gap-2.5 rounded-full bg-white px-9 py-3.5 text-[15px] font-bold text-black shadow-[0_10px_40px_rgba(255,255,255,.22)] transition hover:scale-[1.03] hover:bg-white focus-visible:ring-4 focus-visible:ring-white/35"
                      >
                        <Play className="size-4" fill="currentColor" strokeWidth={0} />
                        Play
                      </button>
                    )}
                    <button
                      data-tv-action="details"
                      onClick={() => {
                        setDetailId(active.id);
                        onDetails(active);
                      }}
                      className={cn(
              'flex items-center gap-2.5 rounded-full border border-white/15 px-6 py-3.5 text-[15px] font-semibold text-white/90 transition hover:border-white/35 focus-visible:ring-4 focus-visible:ring-accent/40',
              lite ? 'bg-white/[0.12] hover:bg-white/[0.18]' : 'bg-white/[0.07] backdrop-blur-md hover:bg-white/[0.12]',
            )}
                    >
                      <Info className="size-4" />
                      Details
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* The library itself: one row of covers, with the sort where the
                row is read rather than up in the bar with the clock. */}
            <section className="relative mt-4 shrink-0">
              <div className="mb-2 flex items-center gap-3 px-5 sm:px-9">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/40">
                  Your library
                </h2>
                <span className="font-mono text-[11px] text-white/25">
                  {at + 1} / {list.length}
                </span>
                <span className="flex-1" />
                <div className={cn(
                'flex items-center gap-0.5 rounded-full border border-white/10 p-0.5',
                lite ? 'bg-white/[0.12]' : 'bg-white/[0.06] backdrop-blur-sm',
              )}>
                  {(
                    [
                      ['recent', 'Recent', Clock],
                      ['az', 'A–Z', ListOrdered],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => setOrder(id)}
                      aria-pressed={order === id}
                      title={id === 'recent' ? 'Ordered by what you played last' : 'Ordered by name'}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition focus-visible:ring-2 focus-visible:ring-accent',
                        order === id ? 'bg-accent/25 text-white' : 'text-white/45 hover:text-accent',
                      )}
                    >
                      <Icon className="size-3" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ul
                ref={rail}
                // A wheel over the rail is meant for the rail: nothing behind
                // the hub can scroll, so a vertical flick would otherwise do
                // nothing at all in the one place the pointer already is.
                onWheel={(event) => {
                  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
                  if (rail.current) rail.current.scrollLeft += event.deltaY;
                }}
                className="tv-rail orbit-scroll flex items-start gap-3.5 overflow-x-auto px-5 pb-5 pt-2 sm:px-9"
              >
                {list.map((game, n) => {
                  const chosen = n === at;
                  return (
                    <li key={game.id} className="shrink-0">
                      <button
                        data-tv-cover={n}
                        onFocus={() => setIndex(n)}
                        onClick={() => {
                          // The same button is the mouse's "look at this" and
                          // the pad's "play this", so the press that produced
                          // the click is what tells them apart.
                          if (padJustActivated(400)) {
                            if (game.id === runningId) onStop();
                            else onPlay(game);
                            return;
                          }
                          setIndex(n);
                        }}
                        onDoubleClick={() => {
                          if (game.id !== runningId) onPlay(game);
                        }}
                        aria-current={chosen ? 'true' : undefined}
                        // The name is on the cover, in the page and in the
                        // aria-label. A `title` would add the browser's own
                        // little badge after a second of stillness, which is
                        // what the pointer does while an arrow key is moving
                        // the rail underneath it.
                        aria-label={game.title}
                        className="tv-cover group block w-[clamp(5.8rem,15vh,9.4rem)] rounded-xl outline-none"
                      >
                        {/* The ring around the artwork, and only the artwork:
                            `index.css` draws it against the theme's accent for
                            hover, selection and the pad alike. */}
                        <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl">
                          <Cover game={game} className="size-full [&_span]:text-xl" />
                          {game.id === runningId && (
                            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
                              <span className="size-1 animate-pulse rounded-full bg-black/70" />
                              On
                            </span>
                          )}
                        </span>
                        {/* Two lines, never cut to an ellipsis on the first: a
                            long name is the one thing a rail cannot guess at. */}
                        <span
                          className={cn(
                            'mt-1.5 line-clamp-2 min-h-[2.1rem] text-center text-[11px] font-medium leading-[1.15] transition',
                            chosen ? 'text-white' : 'text-white/45 group-hover:text-accent',
                          )}
                        >
                          {game.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </main>

    </div>
  );
}
