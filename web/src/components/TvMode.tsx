import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Info,
  ListOrdered,
  Menu,
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
import { wideArt, wideArtImmediateFallback } from '../utils/art';
import { Cover, warmCover, warmImage } from './ui/Cover';
import { Logo } from './ui/Logo';
import { TvDetails } from './TvDetails';
import { MusicButton } from './MusicButton';
import { padJustActivated } from '../hooks/useGamepad';
import { tvLite } from '../services/tv';
import { findTvBackdrop } from '../services/native';

const lite = tvLite;

/** How the one list on the page is ordered. */
export type TvOrder = 'recent' | 'az';

/** How a cover is drawn in the deck: the game's poster, or the wide banner. */
export type DeckArt = 'poster' | 'banner';

/** How wide the covers on the rail are drawn. */
export type StardeckCover = 'compact' | 'standard' | 'large';

/** How far the artwork is pushed back behind the stage. */
export type StardeckDim = 'soft' | 'balanced' | 'deep';

/**
 * The few things about the Stardeck worth having your own way.
 *
 * They live with the hub rather than in Settings: the person deciding how big
 * the covers should be is looking straight at them, on a television, with a
 * controller in one hand. Every choice is kept on this machine and applied the
 * moment it is made.
 */
export interface StardeckPrefs {
  order: TvOrder;
  cover: StardeckCover;
  dim: StardeckDim;
  /** The stage: the game across the top of the screen, or down its right side. */
  stage: 'top' | 'side';
  /** Posters, which are what a library looks like, or the wide banners a store uses. */
  art: DeckArt;
  /** The game's own description under its facts. */
  summary: boolean;
  /** The time in the corner, the way a console has one. */
  clock: boolean;
  /** The store's wordmark instead of the title text, when there is one. */
  logo: boolean;
  /** The facts under the title: year, developer, the time left in the story. */
  facts: boolean;
  /** The bar of numbers along the bottom of the stage. */
  stats: boolean;
  /** What the index holds: every game, or only what can be started. */
  scope: 'all' | 'startable';
  /** Details shown under the covers in the library wall. */
  coverLabel: 'name' | 'info' | 'none';
  /** A subtle grain over the artwork, so a flat cover does not look like a hole. */
  grain: boolean;
  /** The clock's seconds, for anyone who sits there watching one. */
  seconds: boolean;
  /** The game's own wide art behind the stage, rather than a wash of its colour. */
  backdrop: boolean;
}

const STARDECK_KEY = 'orbit.stardeck';

const STARDECK_DEFAULT: StardeckPrefs = {
  order: 'recent',
  cover: 'standard',
  dim: 'balanced',
  stage: 'top',
  art: 'poster',
  summary: true,
  clock: true,
  logo: true,
  facts: true,
  stats: true,
  scope: 'all',
  coverLabel: 'name',
  grain: true,
  seconds: false,
  backdrop: true,
};

/**
 * The saved choices, read defensively.
 *
 * A browser that will not hand over storage, or a value written by an older
 * build, is a reason to start from the defaults and nothing more: no setting
 * here is worth a blank screen.
 */
function savedStardeckPage(): 'deck' | 'library' {
  try {
    return localStorage.getItem('orbit.stardeck.lastPage') === 'library' ? 'library' : 'deck';
  } catch {
    return 'deck';
  }
}

function savedStardeck(): StardeckPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STARDECK_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const value = raw as Record<string, unknown>;
      return {
        order: value.order === 'az' ? 'az' : 'recent',
        cover: value.cover === 'compact' || value.cover === 'large' ? value.cover : 'standard',
        dim: value.dim === 'soft' || value.dim === 'deep' ? value.dim : 'balanced',
        stage: value.stage === 'side' ? 'side' : 'top',
        art: value.art === 'banner' ? 'banner' : 'poster',
        facts: value.facts !== false,
        stats: value.stats !== false,
        scope: value.scope === 'startable' ? 'startable' : 'all',
        coverLabel: value.coverLabel === 'none' || value.coverLabel === 'info' ? value.coverLabel : 'name',
        grain: value.grain !== false,
        seconds: value.seconds === true,
        summary: value.summary !== false,
        clock: value.clock !== false,
        logo: value.logo !== false,
        backdrop: value.backdrop !== false,
      };
    }
  } catch {
    // Unreadable storage is not a reason to refuse to open the hub.
  }
  return STARDECK_DEFAULT;
}

function saveStardeck(prefs: StardeckPrefs) {
  try {
    localStorage.setItem(STARDECK_KEY, JSON.stringify(prefs));
  } catch {
    // A locked-down browser keeps the choice for this session only.
  }
}

const COVER_WIDTH: Record<StardeckCover, string> = {
  compact: 'w-[clamp(4.6rem,11.5vh,6.8rem)]',
  standard: 'w-[clamp(5.8rem,15vh,9.4rem)]',
  large: 'w-[clamp(7rem,18.5vh,11.4rem)]',
};

/**
 * The wide banners, when the deck is drawn from them.
 *
 * A banner is 16:9, so its width has to be roughly twice a poster's to read at
 * the same distance from the screen; these are the poster widths above with
 * that ratio applied, and they share the same three named sizes.
 */
const BANNER_WIDTH: Record<StardeckCover, string> = {
  compact: 'w-[clamp(8rem,20vh,11.8rem)]',
  standard: 'w-[clamp(10rem,26vh,16.4rem)]',
  large: 'w-[clamp(12.4rem,32vh,19.8rem)]',
};

/**
 * The two scrims over the artwork, in three strengths.
 *
 * The picture is the lighting of the room, so how much of it survives under
 * the words is a taste, not a fixed rule: a darker backdrop makes a bright
 * game readable, and a lighter one lets the art do more of the talking.
 */
const SCRIMS: Record<StardeckDim, [string, string]> = {
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
  if (game.meta?.backgroundUrlCustom && game.meta.backgroundUrl) out.push(game.meta.backgroundUrl);
  if (id) {
    // Heronite keeps Steam's cached hero, then tries the 2x hero across Steam's
    // current CDNs before its older 1x asset. Orbit used to ask only one CDN
    // for the 1x image, which made missing/cropped backdrops needlessly common.
    const cdns = ['https://cdn.akamai.steamstatic.com', 'https://cdn.cloudflare.steamstatic.com', 'https://shared.akamai.steamstatic.com/store_item_assets'];
    for (const size of ['library_hero_2x.jpg', 'library_hero.jpg']) {
      out.push(...cdns.map((host) => `${host}/steam/apps/${id}/${size}`));
    }
  }
  if (game.meta?.backgroundUrl && !game.meta.backgroundUrlCustom) out.push(game.meta.backgroundUrl);
  if (id) out.push(`https://cdn.akamai.steamstatic.com/steam/apps/${id}/page_bg_raw.jpg`);
  if (game.meta?.headerUrl) out.push(game.meta.headerUrl);
  return [...new Set(out.filter((url) => !/page_bg_generated/i.test(url)))];
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
function Backdrop({
  game,
  dim,
  onFound,
}: {
  game: Game;
  dim: StardeckDim;
  /** The picture the catalogues answered with, for the stage to draw too. */
  onFound?: (url: string | null) => void;
}) {
  const [failure, setFailure] = useState<{ gameId: string; step: number }>({ gameId: game.id, step: 0 });
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [sgdbBackdrop, setSgdbBackdrop] = useState<{ gameId: string; url: string | null }>({ gameId: '', url: null });
  const shown = useRef<HTMLImageElement>(null);
  const localBackdrops = backdropsFor(game);
  const communityUrl = sgdbBackdrop.gameId === game.id ? sgdbBackdrop.url : null;
  // Like Heronite's art chains, keep user-picked hero art first, then try an
  // independently curated community hero before Steam's fallback chain.
  const customHero = game.meta?.backgroundUrlCustom ? game.meta.backgroundUrl : null;
  const list = [
    ...(customHero ? [customHero] : []),
    ...(communityUrl ? [communityUrl] : []),
    ...localBackdrops.filter((url) => url !== customHero && url !== communityUrl),
  ];

  // Asked for whether or not the desktop shell answers: `findTvBackdrop` falls
  // back to nothing in a browser, and a picture it does find is the whole point
  // of the stage.
  useEffect(() => {
    let current = true;
    // Start the community-art request as soon as a game becomes active. The
    // request is memoized by game id, so quick rail movement joins an in-flight
    // lookup rather than multiplying calls, and the next game is warmed below.
    void findTvBackdrop(game.id).then((url) => {
      if (!current) return;
      setSgdbBackdrop({ gameId: game.id, url });
      onFound?.(url);
      // If a local fallback already failed while SGDB was answering, step
      // back to its newly inserted slot instead of accidentally skipping it.
      if (url && !backdropsFor(game).includes(url)) {
        setFailure((failed) => failed.gameId === game.id && failed.step > 0
          ? { gameId: game.id, step: 1 }
          : failed);
      }
    });
    return () => { current = false; };
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
      <p className="text-[11.5px] font-semibold text-fg/60">{label}</p>
      <div className="flex shrink-0 rounded-lg border border-line bg-fg/[0.05] p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
              value === option.id
                ? 'bg-accent/25 text-fg'
                : 'text-fg/40 hover:text-fg',
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
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left transition hover:bg-fg/[0.05]"
    >
      <span className="text-[12px] font-semibold text-fg/80">{label}</span>
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-8 shrink-0 rounded-full border transition',
          on ? 'border-accent bg-accent/70' : 'border-line bg-fg/[0.08]',
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
 * The side menu.
 *
 * Escape opens it, Escape closes it, and the way out of the mode is one of the
 * things inside it rather than a button in the corner of the screen. That is
 * what a console does and what makes this a room instead of a page: nothing
 * leaves the room by accident, and everything that could is in one place.
 *
 * It is a column of choices, not a settings dialog. Home is what somebody on a
 * couch needs - leave, read the controls - and Look, Library and About are one
 * step in from it. Every choice is applied the moment it is made, so the menu
 * can be closed while looking at the thing it changed.
 */
function StardeckMenu({
  prefs,
  onChange,
  page,
  onPage,
  onClose,
  onReset,
  onExit,
  running,
  library,
  onPlay,
  onStop,
}: {
  prefs: StardeckPrefs;
  onChange: (next: StardeckPrefs) => void;
  page: 'home' | 'look' | 'library' | 'about';
  onPage: (next: 'home' | 'look' | 'library' | 'about') => void;
  onClose: () => void;
  onReset: () => void;
  onExit: () => void;
  running: Game | null;
  library: Game[];
  onPlay: (game: Game) => void;
  onStop: () => void;
}) {
  const set = <K extends keyof StardeckPrefs>(key: K, value: StardeckPrefs[K]) =>
    onChange({ ...prefs, [key]: value });

  const titles = {
    home: 'Stardeck',
    look: 'Look',
    library: 'Library',
    about: 'About',
  } as const;

  return (
    <div
      ref={undefined}
      role="dialog"
      aria-label="Stardeck menu"
      className="orbit-deckmenu orbit-scroll"
    >
      <div className="orbit-deckmenu-head">
        {page === 'home' ? (
          <span className="orbit-deckmenu-mark">
            <Logo className="size-5" animated={false} />
            {titles[page]}
          </span>
        ) : (
          <button type="button" onClick={() => onPage('home')} className="orbit-deckmenu-back">
            <ArrowLeft className="size-3.5" />
            {titles[page]}
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close menu" className="orbit-deckmenu-close">
          <X className="size-4" />
        </button>
      </div>

      <div className="orbit-deckmenu-body">
        {page === 'home' && (
          <>
            <MenuButton
              icon={SlidersHorizontal}
              label="Look"
              hint="Artwork, stage, backdrop"
              onClick={() => onPage('look')}
            />
            <MenuButton
              icon={ListOrdered}
              label="Library"
              hint="What the deck holds and how it is ordered"
              onClick={() => onPage('library')}
            />
            <MenuButton icon={Info} label="About" hint="What Stardeck is" onClick={() => onPage('about')} />

            {running && (
              <MenuButton
                icon={Square}
                label="Stop this session"
                hint={running.title}
                onClick={() => {
                  onStop();
                  onClose();
                }}
              />
            )}

            <div className="orbit-deckmenu-sep" />
            <button type="button" onClick={onExit} className="orbit-deckmenu-leave">
              <Minimize2 className="size-4" />
              Leave Stardeck
            </button>
          </>
        )}

        {page === 'look' && (
          <>
            <PanelChoice
              label="Stage"
              value={prefs.stage}
              options={[
                { id: 'top', label: 'Above' },
                { id: 'side', label: 'Beside' },
              ]}
              onChange={(next) => set('stage', next as StardeckPrefs['stage'])}
            />
            <PanelChoice
              label="Artwork"
              value={prefs.art}
              options={[
                { id: 'poster', label: 'Posters' },
                { id: 'banner', label: 'Banners' },
              ]}
              onChange={(next) => set('art', next as DeckArt)}
            />
            <PanelChoice
              label="Cover size"
              value={prefs.cover}
              options={[
                { id: 'compact', label: 'Small' },
                { id: 'standard', label: 'Medium' },
                { id: 'large', label: 'Large' },
              ]}
              onChange={(next) => set('cover', next as StardeckCover)}
            />
            <PanelChoice
              label="Backdrop"
              value={prefs.dim}
              options={[
                { id: 'soft', label: 'Bright' },
                { id: 'balanced', label: 'Balanced' },
                { id: 'deep', label: 'Deep' },
              ]}
              onChange={(next) => set('dim', next as StardeckDim)}
            />
            <div className="orbit-deckmenu-toggles">
              <PanelToggle
                label="Facts"
                hint="Year, developer and the time left, under the title."
                on={prefs.facts}
                onChange={(next) => set('facts', next)}
              />
              <PanelToggle
                label="Numbers"
                hint="The bar of readings along the bottom of the stage."
                on={prefs.stats}
                onChange={(next) => set('stats', next)}
              />
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
                label="Grain"
                hint="A fine texture over the artwork, so a flat cover is not a hole."
                on={prefs.grain}
                onChange={(next) => set('grain', next)}
              />
              <PanelToggle
                label="Clock"
                hint="The time in the corner of the top bar."
                on={prefs.clock}
                onChange={(next) => set('clock', next)}
              />
              <PanelToggle
                label="Seconds"
                hint="The clock counts seconds as well as minutes."
                on={prefs.seconds}
                onChange={(next) => set('seconds', next)}
              />
            </div>
          </>
        )}

        {page === 'library' && (
          <>
            <PanelChoice
              label="Order"
              value={prefs.order}
              options={[
                { id: 'recent', label: 'Recent' },
                { id: 'az', label: 'A–Z' },
              ]}
              onChange={(next) => set('order', next as TvOrder)}
            />
            <PanelChoice
              label="Deck holds"
              value={prefs.scope}
              options={[
                { id: 'all', label: 'Everything' },
                { id: 'startable', label: 'Playable' },
              ]}
              onChange={(next) => set('scope', next as StardeckPrefs['scope'])}
            />
            <PanelChoice
              label="Under library covers"
              value={prefs.coverLabel}
              options={[
                { id: 'name', label: 'Game name' },
                { id: 'info', label: 'Game info' },
                { id: 'none', label: 'Nothing' },
              ]}
              onChange={(next) => set('coverLabel', next as StardeckPrefs['coverLabel'])}
            />
            <p className="orbit-deckmenu-note">
              {library.length} {library.length === 1 ? 'game' : 'games'} on the deck.
            </p>
            <div className="orbit-deckmenu-sep" />
            <p className="orbit-deckmenu-label">Playing now</p>
            {running ? (
              <div className="orbit-deckmenu-running">
                <Cover game={running} className="h-10 w-8 shrink-0 overflow-hidden rounded" fit="cover" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{running.title}</span>
                <button
                  type="button"
                  onClick={() => {
                    onStop();
                    onClose();
                  }}
                  className="orbit-deckmenu-chip"
                >
                  Stop
                </button>
              </div>
            ) : (
              <p className="orbit-deckmenu-note">Nothing is running.</p>
            )}
            <p className="orbit-deckmenu-label">Start something</p>
            <ul className="orbit-deckmenu-list">
              {library.slice(0, 8).map((game) => (
                <li key={game.id}>
                  <button
                    type="button"
                    disabled={game.id === running?.id}
                    onClick={() => {
                      onPlay(game);
                      onClose();
                    }}
                    className="orbit-deckmenu-row"
                  >
                    <Cover game={game} className="h-7 w-6 shrink-0 overflow-hidden rounded" fit="cover" />
                    <span className="min-w-0 flex-1 truncate">{game.title}</span>
                    <Play className="size-3 shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {page === 'about' && (
          <>
            <p className="orbit-deckmenu-note">
              Stardeck is Orbit read from a couch: one game at a time, on its own artwork, with the
              rest of the library one press away. Left and right walk the deck, Enter plays what is
              on screen, and Escape brings this menu back.
            </p>
            <p className="orbit-deckmenu-label">Controls</p>
            <dl className="orbit-deckmenu-keys">
              <div><dt>← →</dt><dd>Another game</dd></div>
              <div><dt>↑ ↓</dt><dd>Play, details, the bar</dd></div>
              <div><dt>Enter</dt><dd>Play what is on screen</dd></div>
              <div><dt>Escape</dt><dd>This menu</dd></div>
              <div><dt>C</dt><dd>Look, directly</dd></div>
            </dl>
            <div className="orbit-deckmenu-sep" />
            <button type="button" onClick={onReset} className="orbit-deckmenu-chip w-full justify-center">
              <RotateCcw className="size-3.5" />
              Reset Stardeck to its defaults
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** One row on the menu's home page. */
function MenuButton({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof SlidersHorizontal;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="orbit-deckmenu-item">
      <span className="orbit-deckmenu-itemicon">
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="orbit-deckmenu-itemlabel">{label}</span>
        <span className="orbit-deckmenu-itemhint">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 opacity-40" />
    </button>
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
  const [prefs, setPrefs] = useState<StardeckPrefs>(savedStardeck);
  /**
   * The side menu.
   *
   * Escape opens it and Escape closes it. It holds the way out, the settings and
   * the two things a couch cannot reach through the top bar - which is the whole
   * reason the mode has a menu at all: a console's home button is a place, not a
   * key that quits.
   */
  const [menu, setMenu] = useState(false);
  const [menuExiting, setMenuExiting] = useState(false);
  /**
   * Wide art found for the selected game by the catalogues, kept by id.
   *
   * The deck's own `Backdrop` asks for one picture for the wall behind
   * everything; the stage asks for the same game's picture to fill itself. They
   * share this, so a game is asked about once.
   */
  const [heroes, setHeroes] = useState<Record<string, string | null>>({});
  const [menuPage, setMenuPage] = useState<'home' | 'look' | 'library' | 'about'>('home');
  const closeMenu = () => {
    setMenuExiting(true);
    window.setTimeout(() => {
      setMenu(false);
      setMenuExiting(false);
      setMenuPage('home');
    }, 200);
  };
  const menuBox = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const ordered = orderedForTv(games, prefs.order);
    // "Playable" keeps only what actually has something to start. Everything
    // else on the deck is a game that was added by hand and can only be timed,
    // which is not what somebody sitting down with a controller wants first.
    if (prefs.scope !== 'startable') return ordered;
    const startable = ordered.filter((game) => game.launch.kind !== 'none');
    // An empty result would be a mode with no games in it, so the wider deck
    // stands in rather than a blank stage.
    return startable.length > 0 ? startable : ordered;
  }, [games, prefs.order, prefs.scope]);

  /** The game being read on its own page, if one is. */
  const [detailId, setDetailId] = useState<string | null>(null);
  // The choice is kept by id rather than by position: re-sorting the rail must
  // not quietly hand the page to whichever game happens to take that slot.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    runningId && list.some((game) => game.id === runningId) ? runningId : null,
  );
  const [view, setView] = useState<'deck' | 'library'>(savedStardeckPage);
  useEffect(() => {
    try { localStorage.setItem('orbit.stardeck.lastPage', view); } catch { /* Storage may be unavailable in a private or test context. */ }
  }, [view]);
  const active = list.find((game) => game.id === selectedId) ?? list[0] ?? null;
  const at = active ? list.indexOf(active) : 0;
  const deckCards = active
    ? list.length > 2
      ? [-1, 0, 1].map((offset) => {
          const index = (at + offset + list.length) % list.length;
          return { game: list[index], index, position: offset };
        })
      : list.map((game, index) => ({ game, index, position: index === at ? 0 : (index < at ? -1 : 1) }))
    : [];
  const running = active !== null && active.id === runningId;
  /** The game whose own page is open, when it is still one of the playable ones. */
  const detailed = detailId ? (list.find((game) => game.id === detailId) ?? null) : null;
  const playingNow = list.find((game) => game.id === runningId) ?? null;

  useEffect(() => saveStardeck(prefs), [prefs]);

  // Decode the selected artwork and its neighbours before the rail reaches
  // them. WebKitGTK otherwise threw away the old keyed image and decoded the
  // new one on the same frame as the selection moved.
  useEffect(() => {
    if (list.length === 0) return;
    for (const n of [at, (at + 1) % list.length, (at + list.length - 1) % list.length]) {
      const game = list[n];
      if (!game) continue;
      warmCover(game);
      const candidates = backdropsFor(game);
      const first = candidates[0];
      // Warm a known provider hero before asking the network for any speculative
      // 2x Steam CDN variant, then keep the sharp candidate decoding in parallel.
      warmImage(wideArtImmediateFallback(game) ?? first);
      if (first && first !== wideArtImmediateFallback(game)) warmImage(first);
      warmImage(game.meta?.headerUrl ?? game.meta?.backgroundUrl);
    }
  }, [at, list]);

  const rail = useRef<HTMLUListElement>(null);
  const refocusSelectedCover = useRef(false);
  const coverOf = (n: number) => document.querySelector<HTMLElement>(`[data-tv-cover="${n}"]`);
  useEffect(() => {
    if (!refocusSelectedCover.current) return;
    coverOf(at)?.focus({ preventScroll: true });
    refocusSelectedCover.current = false;
  }, [at]);

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
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.classList.remove('orbit-tv');
      document.body.style.overflow = '';
      // The App's exit handler restores the desktop window once, after this
      // view has unmounted. A second setFullscreen(false) here raced its saved
      // size/position and could put a maximized window below the taskbar.
      try { window.dispatchEvent(new window.Event('resize')); } catch {}
    };
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
      refocusSelectedCover.current = true;
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
    if (!menu) return;
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!menuBox.current?.contains(event.target)) setMenu(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [menu]);

  // While the sheet is open its own keys own the mode: Escape (or C again)
  // closes it and does nothing else, which is the one rule Escape has here.
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key.toLowerCase() === 'm') {
        event.preventDefault();
        event.stopPropagation();
        // Escape walks back through the menu's own pages before it closes it,
        // so a settings page is one press from the game and two from the shelf.
        if (event.key === 'Escape' && menuPage !== 'home') {
          setMenuPage('home');
          return;
        }
        closeMenu();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, menuPage]);

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
    Array.from(document.querySelectorAll<HTMLElement>('[data-tv-topbar] button:not([data-tv-page-toggle])'));
  const inTopbar = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.closest('[data-tv-topbar]') !== null;
  const moveLibraryFocus = useCallback((key: string) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-library-cover]'));
    const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (inTopbar(current) || !current?.matches('[data-tv-library-cover]')) {
      if (key === 'ArrowDown') coverOf(at)?.focus({ preventScroll: true });
      return;
    }
    const source = current.getBoundingClientRect();
    const sx = source.left + source.width / 2;
    const sy = source.top + source.height / 2;
    const candidates = items.flatMap((item) => {
      if (item === current) return [];
      const rect = item.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - sx;
      const dy = rect.top + rect.height / 2 - sy;
      const primary = key === 'ArrowLeft' ? -dx : key === 'ArrowRight' ? dx : key === 'ArrowUp' ? -dy : dy;
      if (primary <= 0) return [];
      const secondary = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
      return [{ item, score: primary + secondary * 1.6 }];
    }).sort((a, b) => a.score - b.score);
    if (candidates[0]) candidates[0].item.focus({ preventScroll: true });
    else if (key === 'ArrowUp' && source.top < 120) barButtons()[0]?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A game's own page reads its own keys, a dialog over the hub owns them
      // outright, and the settings sheet answers Escape itself.
      if (detailed || menu || document.querySelector('[role="dialog"]')) return;
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        setView((current) => current === 'deck' ? 'library' : 'deck');
        return;
      }
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
          // Escape never drops the player onto the desktop: it opens the side
          // menu, where leaving is one of the things that can be chosen. This
          // is the console convention and the reason the mode feels like a
          // room rather than a page - there is always a way back to the shelf.
          event.preventDefault();
          event.stopPropagation();
          setMenuPage('home');
          setMenu(true);
          return;
        case 'c':
        case 'C':
          event.preventDefault();
          setMenuPage('look');
          setMenu(true);
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault();
          if (view === 'library') {
            moveLibraryFocus(event.key);
            return;
          }
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
          if (view === 'library') {
            moveLibraryFocus('ArrowUp');
            return;
          }
          // Up from the rail reaches the game's own buttons; up again leaves
          // the page for the bar at the top, where the sound and the way out
          // are. Without that second step the bar would need a mouse.
          if (inActions) {
            const buttons = actionButtons();
            const here = buttons.indexOf(document.activeElement as HTMLElement);
            if (here > 0) buttons[here - 1]?.focus({ preventScroll: true });
            else barButtons()[0]?.focus({ preventScroll: true });
            return;
          }
          (actionButtons()[0] ?? coverOf(at))?.focus({ preventScroll: true });
          return;
        }
        case 'ArrowDown': {
          event.preventDefault();
          if (view === 'library') {
            moveLibraryFocus('ArrowDown');
            return;
          }
          // From the top bar, enter the selected game; from its cover, move
          // down into Play. Repeated down presses continue across its actions.
          if (inBar) {
            coverOf(at)?.focus({ preventScroll: true });
            return;
          }
          if (inActions) {
            const buttons = actionButtons();
            const here = buttons.indexOf(document.activeElement as HTMLElement);
            if (here === 0) coverOf(at)?.focus({ preventScroll: true });
            else buttons[Math.max(0, here - 1)]?.focus({ preventScroll: true });
            return;
          }
          (actionButtons()[0] ?? coverOf(at))?.focus({ preventScroll: true });
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
  }, [at, detailed, menu, moveLibraryFocus, select, start, view]);

  /**
   * The controller.
   *
   * A pad does not send arrow keys: it moves the focus ring itself, and the
   * hub follows the ring, so walking the rail with a stick works without any of
   * this. What it cannot do on its own is the two things the mode is named for:
   * a confirm press on a cover plays the game rather than only selecting it,
   * and Back steps out of a game's page - or closes the settings sheet - never
   * out of Stardeck when there is nothing to step out of.
   */
  useEffect(() => {
    const onPadPlay = () => {
      if (menu) return;
      if (detailed) {
        if (detailed.id === runningId) onStop();
        else onPlay(detailed);
        return;
      }
      start();
    };
    const onPadPage = () => setView((current) => current === 'deck' ? 'library' : 'deck');
    const onPadBack = (event: Event) => {
      // Answered here rather than by the shell: only the hub knows whether it
      // is on the rail, on a game's page or inside its settings. The rail is
      // where the night stays, so Back there has nothing to step out of.
      event.stopImmediatePropagation();
      // Back closes the menu, then a game's page, and finally opens the menu:
      // the last press is the one that offers the way out, never one that
      // drops somebody onto the desktop without asking.
      if (menu) setMenu(false);
      else if (detailed) setDetailId(null);
      else {
        setMenuPage('home');
        setMenu(true);
      }
    };
    window.addEventListener('orbit-pad-play', onPadPlay);
    window.addEventListener('orbit-pad-page', onPadPage);
    window.addEventListener('orbit-pad-back', onPadBack, true);
    return () => {
      window.removeEventListener('orbit-pad-play', onPadPlay);
      window.removeEventListener('orbit-pad-page', onPadPage);
      window.removeEventListener('orbit-pad-back', onPadBack, true);
    };
  }, [detailed, menu, onPlay, onStop, runningId, start]);

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
        // The grain is a second layer over the artwork; the light renderer
        // skips it, because a noise overlay on a machine that is already
        // dropping frames is the first thing that should go.
        prefs.grain && !tvLite && 'tv-grain',
      )}
    >
      {active && <Backdrop game={active} dim={prefs.dim} onFound={(url) => setHeroes((have) => (have[active.id] ? have : { ...have, [active.id]: url }))} />}

      {/* A wash under the top bar, so its few words stay readable over a game
          whose artwork happens to be bright exactly there. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/60 via-black/25 to-transparent" />

      {/* The top panel: where you are, and the room's small facts. It floats on
          the artwork rather than sitting in a bar of its own. */}
      <header data-tv-topbar className="orbit-deck-topbar relative z-20">
          <span className="orbit-deck-brand">
            <Logo className="size-6 drop-shadow-[0_2px_10px_var(--c-accent)]" />
            <span className="hidden flex-col leading-none sm:flex">
              <span className="text-sm font-bold tracking-tight text-white/95">Orbit</span>
              <span className="mt-1 text-[8px] font-bold uppercase tracking-[0.28em] text-white/45">Stardeck</span>
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

        <div className="orbit-deck-pagetabs" role="group" aria-label="Stardeck page">
          <button data-tv-page-toggle type="button" onClick={() => setView('deck')} aria-pressed={view === 'deck'} className="orbit-deck-pagetab">Deck</button>
          <button data-tv-page-toggle type="button" onClick={() => setView('library')} aria-pressed={view === 'library'} className="orbit-deck-pagetab">Library</button>
        </div>

        <span className="flex-1" />

        {prefs.clock && (
          <span className="hidden flex-col items-end leading-tight sm:flex">
            <span className="font-mono text-sm text-white/85">
              {now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                ...(prefs.seconds ? { second: '2-digit' as const } : {}),
              })}
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
            out of Stardeck, so a lone icon in the corner would be a trick. */}
        <button
          onClick={exit}
          title="Leave Stardeck"
          aria-label="Leave Stardeck"
          className={cn(
            'orbit-deck-leave ml-1 flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-accent',
          )}
        >
          <Minimize2 className="size-4" />
          Leave Stardeck
        </button>
      </header>

      {(menu || menuExiting) && (
        <div ref={menuBox} className={`orbit-deckmenu-wrap ${menuExiting ? 'is-exiting' : ''}`}>
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={closeMenu}
            className="orbit-deckmenu-scrim"
          />
          <StardeckMenu
            prefs={prefs}
            onChange={setPrefs}
            page={menuPage}
            onPage={setMenuPage}
            onClose={closeMenu}
            onReset={() => setPrefs(STARDECK_DEFAULT)}
            onExit={exit}
            running={playingNow}
            library={list}
            onPlay={onPlay}
            onStop={onStop}
          />
        </div>
      )}

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
                Stardeck shows the games Orbit can start. Add one - or mark a plan as owned - and it
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
          view === 'library' ? (
            <section className="mx-auto w-full max-w-[1500px] flex-1 overflow-y-auto px-6 pb-10 pt-4 sm:px-10" aria-label="Stardeck library">
              <div className="mb-6 flex items-end justify-between gap-4">
                <div><p className="text-xs font-bold uppercase tracking-[.28em] text-white/40">Your collection</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-5xl">Library</h1></div>
                <p className="text-sm text-white/45">{list.length} games · choose one to play</p>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-6">
                {list.map((game, n) => (
                  <button key={game.id} data-tv-cover={n} data-tv-library-cover type="button" onFocus={() => setSelectedId(game.id)} onClick={() => {
                    setSelectedId(game.id);
                    if (padJustActivated(400)) onPlay(game);
                  }} onDoubleClick={() => onPlay(game)} aria-current={game.id === active.id ? 'true' : undefined} aria-label={prefs.coverLabel === 'none' ? `Play ${game.title}` : game.title} className="tv-library-game group min-w-0 text-left">
                    <span className={cn('tv-library-game-art block aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-white/5 shadow-xl transition group-hover:-translate-y-1 group-hover:border-white/30', game.id === active.id && 'is-current')}><Cover game={game} className="size-full" fit="cover" /></span>
                    {prefs.coverLabel === 'name' && <span className="mt-2 block truncate text-sm font-semibold text-white/85">{game.title}</span>}
                    {prefs.coverLabel === 'info' && <span className="mt-2 block truncate text-xs text-white/60">{game.meta?.releaseYear ?? game.meta?.genres?.[0] ?? game.status}</span>}
                  </button>
                ))}
              </div>
            </section>
          ) : (
          <div className={cn('orbit-deck', prefs.stage === 'side' && 'is-side')}>
            {/* The stage: the chosen game, filling the screen on its own wide
                art. A television is watched from across a room, so the game is
                the picture and the words sit on it - not a card with the game
                drawn in it. The art is the backdrop, dimmed and vignetted at the
                bottom and left so the type has somewhere to live. */}
            <section className="orbit-deck-stage" data-deck-stage>
              {prefs.backdrop !== false && (heroes[active.id] || wideArtImmediateFallback(active) || wideArt(active)) ? (
                <div
                  aria-hidden
                  key={`${active.id}-art`}
                  className="orbit-deck-stageart"
                  style={{ backgroundImage: `url("${heroes[active.id] || wideArtImmediateFallback(active) || wideArt(active)}")` }}
                />
              ) : (
                <div
                  aria-hidden
                  className="orbit-deck-stageart is-quiet"
                  style={{ background: `radial-gradient(120% 130% at 24% 0%, hsl(${active.hue} 52% 34% / .55), transparent 66%)` }}
                />
              )}
              <div aria-hidden className="orbit-deck-stagescrim" />
              <div
                aria-hidden
                className="orbit-deck-stagewash"
                style={{ background: `radial-gradient(90% 120% at 12% 8%, hsl(${active.hue} 60% 42% / .3), transparent 62%)` }}
              />

              <div key={active.id} className="orbit-deck-stageinner">
                <div className="orbit-deck-copy">
                  <p className="orbit-deck-kicker">
                    {running ? (
                      <>
                        <span className="orbit-deck-live" aria-hidden />
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

                  {prefs.facts && (
                    <p className="orbit-deck-facts">
                      {[
                        active.meta?.releaseYear ? String(active.meta.releaseYear) : null,
                        active.meta?.developer || null,
                        active.meta?.genres?.slice(0, 2).join(' · ') || null,
                        left !== null ? (left > 0 ? `${left}h of story left` : 'story almost done') : null,
                      ]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </p>
                  )}

                  <div className="orbit-deck-stats" hidden={!prefs.stats}>
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
                        <Stat label="of the story left">{left > 0 ? `${left}h` : 'almost done'}</Stat>
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
                    <p className="orbit-deck-summary">{active.meta.summary}</p>
                  )}

                  {progress !== null && (
                    <div className="orbit-deck-progress">
                      <div className="orbit-deck-progresshead">
                        <span>Main story</span>
                        <b>{progress}%</b>
                      </div>
                      <div className="orbit-deck-rail" aria-hidden>
                        <i style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}

                  <div data-tv-actions className="orbit-deck-actions">
                    {running ? (
                      <button data-tv-action="stop" onClick={onStop} className="orbit-deck-play is-stop">
                        <Square className="size-4" fill="currentColor" strokeWidth={0} />
                        Stop session
                      </button>
                    ) : (
                      <button data-tv-action="play" onClick={start} className="orbit-deck-play">
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
                      className="orbit-deck-secondary"
                    >
                      <Info className="size-4" />
                      Details
                    </button>
                  </div>
                </div>

                {/* The art again, small, as a card: on a wide screen the game is
                    recognised by its poster, and the wide art behind it is the
                    mood rather than the label. Hidden when the deck is beside
                    the stage, where there is no room. */}
                <div className="orbit-deck-art" aria-hidden={prefs.art !== 'poster'}>
                  <Cover
                    game={active}
                    className={cn('orbit-deck-cover', prefs.art === 'banner' && 'is-banner')}
                    fit="cover"
                    loading="eager"
                  />
                  <div className="orbit-deck-artglow" style={{ background: `hsl(${active.hue} 65% 46% / .35)` }} aria-hidden />
                </div>
              </div>
            </section>

            {/* The index: every game that can be started, in one ordered list.
                This is what makes the mode a deck rather than a carousel - the
                stage never moves, the row of banners moves under the light. */}
            <section className="orbit-deck-index">
              <div
                aria-hidden
                className="orbit-deck-index-art"
                style={{
                  backgroundImage: `linear-gradient(180deg, rgba(5,4,13,.34), rgba(5,4,13,.76)), url("${heroes[active.id] || wideArtImmediateFallback(active) || wideArt(active) || ''}")`,
                  backgroundColor: `hsl(${active.hue} 35% 16%)`,
                }}
              />
              <div className="orbit-deck-indexhead">
                <h2>Deck</h2>
                <span className="orbit-num">
                  {at + 1} / {list.length}
                </span>

                <button onClick={() => select(at - 1)} aria-label="Previous game" title="Previous game" className="orbit-deck-step">
                  <ChevronLeft className="size-4" />
                </button>
                <button onClick={() => select(at + 1)} aria-label="Next game" title="Next game" className="orbit-deck-step">
                  <ChevronRight className="size-4" />
                </button>

                <button
                  onClick={() => {
                    setMenuPage('home');
                    setMenu(true);
                  }}
                  aria-expanded={menu}
                  title="Menu (Escape)"
                  className="orbit-deck-customise"
                  data-open={menu || undefined}
                >
                  <Menu className="size-3.5" />
                  Menu
                </button>
              </div>

              <ul
                ref={rail}
                // A wheel over the index is meant for the index: nothing behind
                // the deck can scroll, so a vertical flick would otherwise do
                // nothing at all in the one place the pointer already is.
                onWheel={(event) => {
                  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
                  if (rail.current) rail.current.scrollLeft += event.deltaY;
                }}
                className="orbit-deck-cards orbit-scroll"
              >
                {deckCards.map(({ game, index: n, position }) => {
                  const chosen = position === 0;
                  return (
                    <li key={game.id}>
                      <button
                        data-tv-cover={n}
                        data-deck-position={position}
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
                        aria-label={game.title}
                        className={cn(
                          'orbit-deck-card',
                          prefs.art === 'banner' ? BANNER_WIDTH[prefs.cover] : COVER_WIDTH[prefs.cover],
                        )}
                      >
                        <span className={cn('orbit-deck-frame', prefs.art === 'banner' ? 'is-banner' : 'is-poster')}>
                          <Cover
                            game={game}
                            className="size-full [&_span]:text-xl"
                            fit="cover"
                            loading="eager"
                          />
                          {game.id === runningId && (
                            <span className="orbit-deck-on">
                              <i aria-hidden />
                              On
                            </span>
                          )}
                        </span>
                        <span className="orbit-deck-name line-clamp-2">{game.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          )
        )}
      </main>

    </div>
  );
}
