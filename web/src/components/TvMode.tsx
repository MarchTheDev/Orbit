import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gamepad2,
  Info,
  ListOrdered,
  Minimize2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type { Game, Settings } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { inLibraryShelf } from '../utils/library';
import { cn } from '../utils/cn';
import { Cover, warmCover, warmImage } from './ui/Cover';
import { Logo } from './ui/Logo';
import { TvDetails } from './TvDetails';
import { MusicButton } from './MusicButton';
import { padJustActivated } from '../hooks/useGamepad';
import { tvLite } from '../services/tv';
import { findTvBackdrop, isNative } from '../services/native';

const lite = tvLite;

/** How the one list on the page is ordered. */
export type TvOrder = 'recent' | 'az';

/** How wide the covers on the rail are drawn. */
export type CockpitCover = 'compact' | 'standard' | 'large';

/** How far the artwork is pushed back behind the stage. */
export type CockpitDim = 'soft' | 'balanced' | 'deep';

/**
 * The few things about the Cockpit worth having your own way.
 *
 * They live with the hub rather than in Settings: the person deciding how big
 * the covers should be is looking straight at them, on a television, with a
 * controller in one hand. Every choice is kept on this machine and applied the
 * moment it is made.
 */
export interface CockpitPrefs {
  order: TvOrder;
  cover: CockpitCover;
  dim: CockpitDim;
  /** The game's own description under its facts. */
  summary: boolean;
  /** The time in the corner, the way a console has one. */
  clock: boolean;
  /** The store's wordmark instead of the title text, when there is one. */
  logo: boolean;
  /** The shelf of covers. Off leaves the stage on its own. */
  cinema: boolean;
}

const COCKPIT_KEY = 'orbit.cockpit';

const COCKPIT_DEFAULT: CockpitPrefs = {
  order: 'recent',
  cover: 'standard',
  dim: 'balanced',
  summary: true,
  clock: true,
  logo: true,
  cinema: false,
};

/**
 * The saved choices, read defensively.
 *
 * A browser that will not hand over storage, or a value written by an older
 * build, is a reason to start from the defaults and nothing more: no setting
 * here is worth a blank screen.
 */
function savedCockpit(): CockpitPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COCKPIT_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const value = raw as Record<string, unknown>;
      return {
        order: value.order === 'az' ? 'az' : 'recent',
        cover: value.cover === 'compact' || value.cover === 'large' ? value.cover : 'standard',
        dim: value.dim === 'soft' || value.dim === 'deep' ? value.dim : 'balanced',
        summary: value.summary !== false,
        clock: value.clock !== false,
        logo: value.logo !== false,
        cinema: value.cinema === true,
      };
    }
  } catch {
    // Unreadable storage is not a reason to refuse to open the hub.
  }
  return COCKPIT_DEFAULT;
}

function saveCockpit(prefs: CockpitPrefs) {
  try {
    localStorage.setItem(COCKPIT_KEY, JSON.stringify(prefs));
  } catch {
    // A locked-down browser keeps the choice for this session only.
  }
}

const COVER_WIDTH: Record<CockpitCover, string> = {
  compact: 'w-[clamp(4.6rem,11.5vh,6.8rem)]',
  standard: 'w-[clamp(5.8rem,15vh,9.4rem)]',
  large: 'w-[clamp(7rem,18.5vh,11.4rem)]',
};

/**
 * The two scrims over the artwork, in three strengths.
 *
 * The picture is the lighting of the room, so how much of it survives under
 * the words is a taste, not a fixed rule: a darker backdrop makes a bright
 * game readable, and a lighter one lets the art do more of the talking.
 */
const SCRIMS: Record<CockpitDim, [string, string]> = {
  soft: [
    'from-[#05040d]/70 via-[#05040d]/25 to-transparent',
    'from-[#05040d]/60 via-transparent to-transparent',
  ],
  balanced: [
    'from-[#05040d] via-[#05040d]/55 to-[#05040d]/10',
    'from-[#05040d] via-[#05040d]/45 to-transparent',
  ],
  deep: [
    'from-[#05040d] via-[#05040d]/80 to-[#05040d]/30',
    'from-[#05040d] via-[#05040d]/65 to-transparent',
  ],
};

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
 * The wordmark Steam publishes for a game, when it has one.
 *
 * A logo over the artwork reads as the cover of a game rather than a caption
 * under it, which is the whole reason a console leans on them: the picture is
 * already saying what the game is, and the title only has to confirm it.
 */
function logoFor(game: Game): string | null {
  const id = steamIdOf(game);
  return id ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/logo.png` : null;
}

/**
 * The artwork behind the hub, swapped as the selection moves.
 *
 * Only a wide store background is allowed in this frame. Until one has loaded,
 * the frame stays a colour wash: a cover or header is never stretched here as
 * temporary art. Attempt and load state are tied to the selected game and URL,
 * so a late state update from the previous selection cannot flash its picture.
 * A failed picture steps down the list rather than leaving a hole.
 */
function Backdrop({ game, dim }: { game: Game; dim: CockpitDim }) {
  const [failure, setFailure] = useState<{ gameId: string; step: number }>({ gameId: game.id, step: 0 });
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [sgdbBackdrop, setSgdbBackdrop] = useState<{ gameId: string; url: string | null }>({ gameId: '', url: null });
  const shown = useRef<HTMLImageElement>(null);
  const localBackdrops = backdropsFor(game);
  const communityUrl = sgdbBackdrop.gameId === game.id ? sgdbBackdrop.url : null;
  // Steam's library hero remains first. SteamGridDB's wide hero is tried next,
  // then the metadata background and header keep their existing fallback order.
  const list = communityUrl && !localBackdrops.includes(communityUrl)
    ? [...localBackdrops.slice(0, 1), communityUrl, ...localBackdrops.slice(1)]
    : localBackdrops;

  useEffect(() => {
    if (!isNative()) return;
    let current = true;
    // Moving quickly along the rail should not turn each transient selection
    // into a separate community-art request.
    const timer = window.setTimeout(() => {
      void findTvBackdrop(game.id).then((url) => {
        if (!current) return;
        setSgdbBackdrop({ gameId: game.id, url });
        // If a local fallback already failed while SGDB was answering, step
        // back to its newly inserted slot instead of accidentally skipping it.
        if (url && !backdropsFor(game).includes(url)) {
          setFailure((failed) => failed.gameId === game.id && failed.step > 0
            ? { gameId: game.id, step: 1 }
            : failed);
        }
      });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [game.id]);
  // A selection change takes the first attempt synchronously. Waiting for an
  // effect to reset `step` showed the previous game's lower-quality fallback
  // for one frame when that image had failed.
  const step = failure.gameId === game.id ? failure.step : 0;
  const src = list[step] ?? null;
  const loaded = loadedSrc === src;
  const [bottom, side] = SCRIMS[dim];

  // A picture already in the cache can finish before React's load listener is
  // attached. Only trust the element if it is still the source being drawn.
  useEffect(() => {
    const image = shown.current;
    if (src && image?.complete && image.naturalWidth > 0 && image.getAttribute('src') === src) {
      setLoadedSrc(src);
    }
  }, [src]);

  return (
    <div data-tv-backdrop className="pointer-events-none absolute inset-0 overflow-hidden">
      {src ? (
        <img
          ref={shown}
          src={src}
          alt=""
          aria-hidden
          loading="eager"
          decoding="async"
          draggable={false}
          onLoad={(event) => setLoadedSrc(event.currentTarget.getAttribute('src'))}
          onError={() => {
            setFailure((current) => ({
              gameId: game.id,
              step: (current.gameId === game.id ? current.step : 0) + 1,
            }));
          }}
          className={cn(
            'tv-backdrop-image absolute inset-0 h-full w-full object-cover',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : (
        <div
          data-tv-backdrop-placeholder
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 28% 28%, hsl(${game.hue} 55% 24%), #05040d 72%)`,
          }}
        />
      )}
      {/* The scrims. Everything over the picture is read against the darkest
          corner of it, and the picture fades into the rail rather than ending
          at a line above it. */}
      <div className={cn('absolute inset-0 bg-gradient-to-t', bottom)} />
      <div className={cn('absolute inset-0 bg-gradient-to-r', side)} />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 125%, transparent 38%, rgba(5,4,13,.5) 100%)' }}
      />
    </div>
  );
}

/** A small fact about the game, in the row under its name. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[13px] font-semibold text-white/85">{children}</span>
      <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">{label}</span>
    </span>
  );
}

/** The dot between two facts in the row under the title. */
function Dot() {
  return <span aria-hidden className="text-white/20">·</span>;
}

/**
 * The selected game's name, the way a console shows it.
 *
 * When the store has a wordmark it is drawn instead of the words: the artwork
 * is already naming the game and a logo confirms it without another line of
 * type competing with the picture. The title is still in the page for anyone
 * reading it aloud, and it comes back the moment the logo cannot be fetched.
 */
function GameTitle({ game, logo }: { game: Game; logo: boolean }) {
  const url = logo ? logoFor(game) : null;
  const [art, setArt] = useState<{ url: string | null; status: 'loading' | 'loaded' | 'failed' }>({
    url,
    status: 'loading',
  });
  useEffect(() => {
    setArt((current) => (current.url === url ? current : { url, status: 'loading' }));
  }, [url]);
  const settled = art.url === url ? art.status : 'loading';
  const loaded = url !== null && settled === 'loaded';

  return (
    <>
      {url && settled !== 'failed' && (
        <img
          src={url}
          alt=""
          aria-hidden
          draggable={false}
          onLoad={() => setArt({ url, status: 'loaded' })}
          onError={() => setArt({ url, status: 'failed' })}
          className={cn(
            'h-[clamp(2.6rem,8.5vh,5.8rem)] w-auto max-w-[min(36rem,66vw)] object-contain object-left',
            loaded ? 'block drop-shadow-[0_6px_32px_rgba(0,0,0,.65)]' : 'hidden',
          )}
        />
      )}
      <h1
        className={cn(
          'orbit-hero-enter line-clamp-2 text-[clamp(2.1rem,5.2vh+1.4vw,4.6rem)] font-black leading-[0.98] tracking-[-0.03em] text-white [text-shadow:0_2px_30px_rgba(0,0,0,.55)]',
          loaded ? 'sr-only' : 'block',
        )}
      >
        {game.title}
      </h1>
    </>
  );
}

/** One of the settings sheet's rows of choices. */
function PanelChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11.5px] font-semibold text-white/55">{label}</p>
      <div className="flex shrink-0 rounded-lg border border-white/10 bg-white/[0.05] p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
              value === option.id
                ? 'bg-white/[0.14] text-white'
                : 'text-white/40 hover:text-white',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One on/off row in the settings sheet. */
function PanelToggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={hint}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left transition hover:bg-white/[0.05]"
    >
      <span className="text-[12px] font-semibold text-white/75">{label}</span>
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-8 shrink-0 rounded-full border transition',
          on ? 'border-accent bg-accent/70' : 'border-white/15 bg-white/[0.08]',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] size-3 rounded-full bg-white transition',
            on ? 'left-[0.95rem]' : 'left-[2px]',
          )}
        />
      </span>
    </button>
  );
}

/**
 * The hub's own settings, opened from the shelf it is describing.
 *
 * These are the choices a person makes once while looking at the screen: how
 * wide the covers are, how much of the artwork the words sit on, whether the
 * shelf is there at all. Nothing here needs a trip to the desktop Settings
 * page, which would mean leaving the couch to change the couch.
 */
function CockpitPanel({
  prefs,
  onChange,
  onClose,
  onReset,
}: {
  prefs: CockpitPrefs;
  onChange: (next: CockpitPrefs) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const set = <K extends keyof CockpitPrefs>(key: K, value: CockpitPrefs[K]) =>
    onChange({ ...prefs, [key]: value });

  return (
    <div
      role="dialog"
      aria-label="Cockpit settings"
      className="orbit-scroll absolute bottom-full right-0 z-40 mb-3 max-h-[calc(100vh-6.5rem)] w-[21rem] overflow-y-auto rounded-2xl border border-white/15 bg-[#0b0917]/95 p-4 text-white shadow-[0_30px_80px_rgba(0,0,0,.7)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold">
          <SlidersHorizontal className="size-4 text-accent" />
          Cockpit settings
        </p>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="grid size-7 shrink-0 place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        <PanelChoice
          label="The shelf"
          value={prefs.cinema ? 'cinema' : 'rail'}
          options={[
            { id: 'rail', label: 'Covers' },
            { id: 'cinema', label: 'Stage only' },
          ]}
          onChange={(next) => set('cinema', next === 'cinema')}
        />
        <PanelChoice
          label="Cover size"
          value={prefs.cover}
          options={[
            { id: 'compact', label: 'Small' },
            { id: 'standard', label: 'Medium' },
            { id: 'large', label: 'Large' },
          ]}
          onChange={(next) => set('cover', next as CockpitCover)}
        />
        <PanelChoice
          label="Backdrop"
          value={prefs.dim}
          options={[
            { id: 'soft', label: 'Bright' },
            { id: 'balanced', label: 'Balanced' },
            { id: 'deep', label: 'Deep' },
          ]}
          onChange={(next) => set('dim', next as CockpitDim)}
        />
      </div>

      <div className="mt-3 space-y-0.5 border-t border-white/10 pt-2">
        <PanelToggle
          label="Description"
          hint="A couple of lines about the game, under its facts."
          on={prefs.summary}
          onChange={(next) => set('summary', next)}
        />
        <PanelToggle
          label="Store logo"
          hint="The game's wordmark in place of its title, when there is one."
          on={prefs.logo}
          onChange={(next) => set('logo', next)}
        />
        <PanelToggle
          label="Clock"
          hint="The time in the corner of the top bar."
          on={prefs.clock}
          onChange={(next) => set('clock', next)}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-2.5">
        <p className="max-w-[12.5rem] text-[10.5px] leading-snug text-white/30">
          Escape stays in Cockpit. Leave with the button up top.
        </p>
        <button
          onClick={onReset}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:border-white/30 hover:text-white"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>
      </div>
    </div>
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
 * comes back to the rail. Enter plays. Escape gives nothing back to the desktop:
 * a night on the couch is only over when the button at the top right says so.
 * The rail's own settings sheet, opened with C or the Customize chip, changes
 * the size of the covers, the artwork behind them and the shelf itself without
 * ever leaving the mode.
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
  const [prefs, setPrefs] = useState<CockpitPrefs>(savedCockpit);
  const [customizing, setCustomizing] = useState(false);
  const settingsBox = useRef<HTMLDivElement>(null);

  const list = useMemo(() => orderedForTv(games, prefs.order), [games, prefs.order]);

  /** The game being read on its own page, if one is. */
  const [detailId, setDetailId] = useState<string | null>(null);
  // The choice is kept by id rather than by position: re-sorting the rail must
  // not quietly hand the page to whichever game happens to take that slot.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    runningId && list.some((game) => game.id === runningId) ? runningId : null,
  );
  const active = list.find((game) => game.id === selectedId) ?? list[0] ?? null;
  const at = active ? list.indexOf(active) : 0;
  const running = active !== null && active.id === runningId;
  /** The game whose own page is open, when it is still one of the playable ones. */
  const detailed = detailId ? (list.find((game) => game.id === detailId) ?? null) : null;
  const playingNow = list.find((game) => game.id === runningId) ?? null;

  useEffect(() => saveCockpit(prefs), [prefs]);

  // Decode the selected artwork and its neighbours before the rail reaches
  // them. WebKitGTK otherwise threw away the old keyed image and decoded the
  // new one on the same frame as the selection moved.
  useEffect(() => {
    if (list.length === 0) return;
    for (const n of [at, (at + 1) % list.length, (at + list.length - 1) % list.length]) {
      const game = list[n];
      if (!game) continue;
      warmCover(game);
      const first = backdropsFor(game)[0];
      warmImage(first);
      warmImage(game.meta?.headerUrl ?? game.meta?.backgroundUrl);
    }
  }, [at, list]);

  const rail = useRef<HTMLUListElement>(null);
  const coverOf = (n: number) => rail.current?.querySelector<HTMLElement>(`[data-tv-cover="${n}"]`) ?? null;

  // Give the window back immediately; no fade or shutdown hold on a slow renderer.
  const exit = useCallback(() => onExit(), [onExit]);

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
      setSelectedId(list[wrapped].id);
      const button = coverOf(wrapped);
      if (button && document.activeElement !== button) button.focus({ preventScroll: true });
    },
    [list],
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

  // Anything pressed outside the sheet closes it, the way the rest of the app's
  // popovers behave. The chip that opened it is part of "inside", so a second
  // press on it toggles rather than closes and reopens.
  useEffect(() => {
    if (!customizing) return;
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!settingsBox.current?.contains(event.target)) setCustomizing(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [customizing]);

  // While the sheet is open its own keys own the mode: Escape (or C again)
  // closes it and does nothing else, which is the one rule Escape has here.
  useEffect(() => {
    if (!customizing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key.toLowerCase() !== 'c') return;
      event.preventDefault();
      event.stopPropagation();
      setCustomizing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [customizing]);

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
      // A game's own page reads its own keys, a dialog over the hub owns them
      // outright, and the settings sheet answers Escape itself.
      if (detailed || customizing || document.querySelector('[role="dialog"]')) return;
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
          // Escape never drops the player onto the desktop. On the rail it is
          // simply the key that does nothing; a game's page closes itself.
          event.preventDefault();
          event.stopPropagation();
          return;
        case 'c':
        case 'C':
          event.preventDefault();
          setCustomizing(true);
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
  }, [at, customizing, detailed, select, start]);

  /**
   * The controller.
   *
   * A pad does not send arrow keys: it moves the focus ring itself, and the
   * hub follows the ring, so walking the rail with a stick works without any of
   * this. What it cannot do on its own is the two things the mode is named for:
   * a confirm press on a cover plays the game rather than only selecting it,
   * and Back steps out of a game's page - or closes the settings sheet - never
   * out of Cockpit when there is nothing to step out of.
   */
  useEffect(() => {
    const onPadPlay = () => {
      if (customizing) return;
      if (detailed) {
        if (detailed.id === runningId) onStop();
        else onPlay(detailed);
        return;
      }
      start();
    };
    const onPadBack = (event: Event) => {
      // Answered here rather than by the shell: only the hub knows whether it
      // is on the rail, on a game's page or inside its settings. The rail is
      // where the night stays, so Back there has nothing to step out of.
      event.stopImmediatePropagation();
      if (customizing) setCustomizing(false);
      else if (detailed) setDetailId(null);
    };
    window.addEventListener('orbit-pad-play', onPadPlay);
    window.addEventListener('orbit-pad-back', onPadBack, true);
    return () => {
      window.removeEventListener('orbit-pad-play', onPadPlay);
      window.removeEventListener('orbit-pad-back', onPadBack, true);
    };
  }, [customizing, detailed, onPlay, onStop, runningId, start]);

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
        tvLite && 'tv-lite',
      )}
    >
      {active && <Backdrop game={active} dim={prefs.dim} />}

      {/* A wash under the top bar, so its few words stay readable over a game
          whose artwork happens to be bright exactly there. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/60 via-black/25 to-transparent" />

      {/* The top panel: where you are, and the room's small facts. It floats on
          the artwork rather than sitting in a bar of its own. */}
      <header data-tv-topbar className="relative z-20 flex shrink-0 items-center gap-3 px-5 pb-4 pt-4 sm:px-9 sm:pt-5">
        <span className="flex items-center gap-3">
          <Logo className="size-7 drop-shadow-[0_2px_10px_var(--c-accent)]" />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="text-lg font-bold tracking-tight text-white/95">Orbit</span>
            <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.34em] text-white/35">
              Cockpit
            </span>
          </span>
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

        {prefs.clock && (
          <span className="hidden flex-col items-end leading-tight sm:flex">
            <span className="font-mono text-sm text-white/85">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/40">
              {now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </span>
        )}

        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={onOpenSettings} />
        )}

        {/* The only way out, and it says so on its face: Escape is not a way
            out of Cockpit, so a lone icon in the corner would be a trick. */}
        <button
          onClick={exit}
          title="Leave Cockpit"
          aria-label="Leave Cockpit"
          className={cn(
            'ml-1 flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-[12.5px] font-semibold text-white/80 transition hover:border-white/35 hover:text-white focus-visible:ring-2 focus-visible:ring-accent',
            lite ? 'bg-white/[0.1]' : 'bg-white/[0.06] backdrop-blur-sm',
          )}
        >
          <Minimize2 className="size-4" />
          Leave Cockpit
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
              setSelectedId(detailed.id);
            }}
          />
        ) : !active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
            <span className="relative grid size-24 place-items-center rounded-full border border-dashed border-white/15 text-white/30">
              <span aria-hidden className="absolute inset-3 rounded-full border border-white/[0.06]" />
              <Gamepad2 className="size-9" />
            </span>
            <div>
              <p className="text-2xl font-bold text-white">Nothing to play yet</p>
              <p className="mt-1.5 max-w-md text-sm text-white/45">
                Cockpit shows the games Orbit can start. Add one - or mark a plan as owned - and it
                turns up here.
              </p>
            </div>
            <button
              onClick={exit}
              className="mt-2 flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-5 py-2.5 text-sm font-semibold text-white/85 transition hover:border-white/35 hover:text-white"
            >
              <ArrowLeft className="size-4" />
              Back to Orbit
            </button>
          </div>
        ) : (
          <>
            {/* The game owns the screen: its poster on the left, its name and
                numbers taking the light, and one row of presses under them. */}
            <div className="flex min-h-0 flex-1 items-end px-5 sm:px-9">
              <div className="flex w-full items-end gap-8 pb-3 lg:gap-10">
                <div className="relative hidden shrink-0 md:block">
                  <div
                    aria-hidden
                    className="absolute -inset-5 rounded-[2rem] opacity-70 blur-2xl"
                    style={{ background: `hsl(${active.hue} 65% 42% / 0.32)` }}
                  />
                  <Cover
                    game={active}
                    className="orbit-hero-enter relative h-[clamp(8.5rem,29vh,16rem)] w-[clamp(6rem,19vh,11.4rem)] rounded-2xl border border-white/15 shadow-[0_28px_70px_rgba(0,0,0,.7)] [&_span]:text-3xl"
                    fit="cover"
                    loading="eager"
                  />
                </div>
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

                  <GameTitle game={active} logo={prefs.logo} />

                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Stat label="played">{fmtMinutes(active.playSecs / 60)}</Stat>
                    {active.lastPlayed && (
                      <>
                        <Dot />
                        <Stat label="last played">{fmtDate(active.lastPlayed)}</Stat>
                      </>
                    )}
                    {left !== null && (
                      <>
                        <Dot />
                        <Stat label="of the story left">
                          {left > 0 ? `${left}h` : 'almost done'}
                        </Stat>
                      </>
                    )}
                    {active.sizeBytes > 0 && (
                      <>
                        <Dot />
                        <Stat label="on disk">{fmtBytes(active.sizeBytes)}</Stat>
                      </>
                    )}
                  </div>

                  {prefs.summary && active.meta?.summary && (
                    <p className="mt-3.5 hidden max-w-xl text-sm leading-relaxed text-white/55 [@media(min-height:760px)]:line-clamp-2 [@media(min-height:760px)]:sm:block">
                      {active.meta.summary}
                    </p>
                  )}

                  {progress !== null && (
                    <div className="mt-4 max-w-xs">
                      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                        <span>Main story</span>
                        <span className="font-mono text-white/55">{progress}%</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
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
                        className="flex items-center gap-2.5 rounded-full bg-accent px-9 py-3.5 text-[15px] font-bold text-[var(--c-on-accent)] shadow-[0_16px_50px_-12px_var(--c-accent)] transition hover:brightness-110 focus-visible:ring-4 focus-visible:ring-accent/40"
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

            {/* The shelf, with its own controls where the shelf is read: how
                it is ordered, which game is on the stage, and the handful of
                choices about the room itself. */}
            <section className="relative mt-2 shrink-0">
              <div className="mb-2 flex items-center gap-3 px-5 sm:px-9">
                {!prefs.cinema && (
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/40">
                    Your library
                  </h2>
                )}
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
                      onClick={() => setPrefs((current) => ({ ...current, order: id }))}
                      aria-pressed={prefs.order === id}
                      title={id === 'recent' ? 'Ordered by what you played last' : 'Ordered by name'}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition focus-visible:ring-2 focus-visible:ring-accent',
                        prefs.order === id ? 'bg-accent/25 text-white' : 'text-white/45 hover:text-accent',
                      )}
                    >
                      <Icon className="size-3" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => select(at - 1)}
                    aria-label="Previous game"
                    title="Previous game"
                    className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/50 transition hover:border-white/30 hover:text-white"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    onClick={() => select(at + 1)}
                    aria-label="Next game"
                    title="Next game"
                    className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/50 transition hover:border-white/30 hover:text-white"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                <div className="relative" ref={settingsBox}>
                  <button
                    onClick={() => setCustomizing((open) => !open)}
                    aria-expanded={customizing}
                    title="Cockpit settings (C)"
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition',
                      customizing
                        ? 'border-accent/60 bg-accent/15 text-white'
                        : 'border-white/10 bg-white/[0.06] text-white/55 hover:border-white/30 hover:text-white',
                    )}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    Customize
                  </button>
                  {customizing && (
                    <CockpitPanel
                      prefs={prefs}
                      onChange={setPrefs}
                      onClose={() => setCustomizing(false)}
                      onReset={() => setPrefs(COCKPIT_DEFAULT)}
                    />
                  )}
                </div>
              </div>

              {!prefs.cinema && (
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
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                          onFocus={() => setSelectedId(game.id)}
                          onClick={() => {
                            // The same button is the mouse's "look at this" and
                            // the pad's "play this", so the press that produced
                            // the click is what tells them apart.
                            if (padJustActivated(400)) {
                              if (game.id === runningId) onStop();
                              else onPlay(game);
                              return;
                            }
                            setSelectedId(game.id);
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
                          className={cn('tv-cover group block rounded-xl outline-none', COVER_WIDTH[prefs.cover])}
                        >
                          {/* The ring around the artwork, and only the artwork:
                              `index.css` draws it against the theme's accent for
                              hover, selection and the pad alike. */}
                          <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl">
                            <Cover game={game} className="size-full [&_span]:text-xl" fit="cover" />
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
              )}
            </section>
          </>
        )}
      </main>

    </div>
  );
}
