import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Info,
  Layers,
  LayoutGrid,
  ListOrdered,
  Minimize2,
  Play,
  Plus,
  Power,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Square,
  Star,
  X,
} from 'lucide-react';
import type { Game, Settings } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { inLibraryShelf } from '../utils/library';
import { cn } from '../utils/cn';
import { coverArtCandidates } from '../utils/art';
import { Cover, warmCover } from './ui/Cover';
import { Logo } from './ui/Logo';
import { TvDetails } from './TvDetails';
import { padJustActivated } from '../hooks/useGamepad';
import { tvLite } from '../services/tv';


/** How the one list on the page is ordered. */
export type TvOrder = 'recent' | 'az';

/** How a cover is drawn in the deck: the game's poster, or the wide banner. */
export type DeckArt = 'poster' | 'banner';

/** How wide the covers on the rail are drawn. */
export type StardeckCover = 'compact' | 'standard' | 'large';

/** The menu's own pages: the hub of them, and the two it opens. */
export type StardeckPage = 'home' | 'look' | 'library';

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
  /** Posters, which are what a library looks like, or the wide banners a store uses. */
  art: DeckArt;
  /** The game's own description under its facts. */
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
  /** The game's own wide art behind the stage, rather than a wash of its colour. */
  backdrop: boolean;
}

const STARDECK_KEY = 'orbit.stardeck';

const STARDECK_DEFAULT: StardeckPrefs = {
  order: 'recent',
  cover: 'standard',
  dim: 'balanced',
  art: 'poster',
  logo: true,
  facts: true,
  stats: true,
  scope: 'all',
  coverLabel: 'name',
  grain: true,
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
        art: value.art === 'banner' ? 'banner' : 'poster',
        facts: value.facts !== false,
        stats: value.stats !== false,
        scope: value.scope === 'startable' ? 'startable' : 'all',
        coverLabel: value.coverLabel === 'none' || value.coverLabel === 'info' ? value.coverLabel : 'name',
        grain: value.grain !== false,
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
    // Steam's cached hero is kept, then the 2x hero is tried across Steam's
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
/**
 * The sidebar.
 *
 * The console menu is a full-height panel down the right edge over the
 * dimmed screen, and it is where everything that is not browsing the collection
 * lives: the look of the room, what the deck holds, adding a game, Orbit's own
 * settings, the way back to the desktop and the power switch. Escape opens it
 * and Escape closes it, which is the one rule Escape has here - it never drops
 * somebody onto the desktop without asking.
 */
function StardeckMenu({
  prefs,
  onChange,
  page,
  onPage,
  onClose,
  onReset,
  onExit,
  onAddGame,
  onOpenSettings,
  onPower,
  sound,
  onSound,
  running,
  library,
  onStop,
}: {
  prefs: StardeckPrefs;
  onChange: (next: StardeckPrefs) => void;
  page: StardeckPage;
  onPage: (next: StardeckPage) => void;
  onClose: () => void;
  onReset: () => void;
  onExit: () => void;
  onAddGame: () => void;
  onOpenSettings: () => void;
  onPower: () => void;
  sound: Settings['sound'];
  onSound: (next: Settings['sound']) => void;
  running: Game | null;
  library: Game[];
  onStop: () => void;
}) {
  const set = <K extends keyof StardeckPrefs>(key: K, value: StardeckPrefs[K]) =>
    onChange({ ...prefs, [key]: value });

  const titles: Record<StardeckPage, string> = {
    home: 'Stardeck',
    look: 'Look',
    library: 'Library',
  };

  return (
    <div role="dialog" aria-label="Stardeck menu" className="orbit-deckside orbit-scroll">
      <div className="orbit-deckside-head">
        {page === 'home' ? (
          <span className="orbit-deckside-mark">
            <Logo className="size-5" animated={false} />
            {titles[page]}
          </span>
        ) : (
          <button type="button" onClick={() => onPage('home')} className="orbit-deckside-back">
            <ArrowLeft className="size-3.5" />
            {titles[page]}
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close menu" className="orbit-deckside-close">
          <X className="size-4" />
        </button>
      </div>

      <div className="orbit-deckside-body">
        {page === 'home' && (
          <>
            {running && (
              <div className="orbit-deckside-running">
                <Cover game={running} className="h-11 w-9 shrink-0 overflow-hidden rounded" fit="cover" />
                <span className="min-w-0 flex-1">
                  <span className="orbit-deckside-running-kicker">
                    <span className="orbit-deck-live" aria-hidden />
                    Playing now
                  </span>
                  <span className="orbit-deckside-running-name">{running.title}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onStop();
                    onClose();
                  }}
                  className="orbit-deckside-chip"
                >
                  Stop
                </button>
              </div>
            )}

            <MenuButton icon={SlidersHorizontal} label="Look" hint="Artwork, covers, backdrop" onClick={() => onPage('look')} />
            <MenuButton icon={ListOrdered} label="Library" hint="Order and what the deck holds" onClick={() => onPage('library')} />
            <MenuButton icon={Plus} label="Add a game" hint="A program, or a launcher's library" onClick={onAddGame} />
            <MenuButton icon={Settings2} label="Orbit settings" hint="Every setting in the app" onClick={onOpenSettings} />

            <div className="orbit-deckside-sep" />
            <button type="button" onClick={onReset} className="orbit-deckside-chip w-full justify-center">
              <RotateCcw className="size-3.5" />
              Reset Stardeck to its defaults
            </button>
            <div className="orbit-deckside-sep" />
            <button type="button" onClick={onExit} className="orbit-deckside-exit">
              <Minimize2 className="size-4" />
              Back to desktop
            </button>
            <button type="button" onClick={onPower} className="orbit-deckside-power">
              <Power className="size-4" />
              Quit Orbit
            </button>
          </>
        )}

        {page === 'look' && (
          <>
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
            <div className="orbit-deckside-toggles">
              <PanelToggle
                label="Cover backdrop"
                hint="The selected game's cover, blurred, behind everything."
                on={prefs.backdrop}
                onChange={(next) => set('backdrop', next)}
              />
              <PanelToggle
                label="Facts"
                hint="Year and developer under the title."
                on={prefs.facts}
                onChange={(next) => set('facts', next)}
              />
              <PanelToggle
                label="Numbers"
                hint="Played, last played and the story left, on the game's panel."
                on={prefs.stats}
                onChange={(next) => set('stats', next)}
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
                label="Music"
                hint="Orbit's own music, while you browse."
                on={sound?.enabled !== false}
                onChange={(next) => onSound({ ...(sound ?? { volume: 0.35, unfocused: false }), enabled: next })}
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
            <p className="orbit-deckside-note">
              {library.length} {library.length === 1 ? 'game' : 'games'} on the deck.
            </p>
          </>
        )}

      </div>
    </div>
  );
}

/**
 * The light in the room: the selected game's own cover, blurred hard.
 *
 * The whole screen points at one picture - the focused game's art -
 * and cross-fades to the next when the focus moves, 520 ms of one game
 * dissolving into another. This is the same idea with the asset a library here
 * always has: the cover. Two layers are kept, the one that has settled and the
 * one arriving, and the arriving copy fades up over the settled one; nothing
 * ever goes through the colour of the shell in between, which is what a single
 * element swapping its `background-image` does on WebKit.
 */
function DeckBackdrop({ game }: { game: Game | null }) {
  const [layers, setLayers] = useState<{ key: number; url: string }[]>([]);
  const nextKey = useRef(1);
  const last = layers[layers.length - 1] ?? null;
  const wanted = game ? coverArtCandidates(game)[0] ?? null : null;

  useEffect(() => {
    if (!wanted || (last && last.url === wanted)) return;
    const layer = { key: nextKey.current, url: wanted };
    nextKey.current += 1;
    // Two layers is enough: the one being covered and the one covering it.
    setLayers((have) => [...have.slice(-1), layer]);
    const timer = window.setTimeout(() => {
      setLayers((have) => (have.length > 1 ? have.slice(-1) : have));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [wanted]);

  return (
    <div data-tv-deckbackdrop aria-hidden className="orbit-deckbackdrop">
      {layers.map((layer, index) => (
        <div
          key={layer.key}
          className="orbit-deckbackdrop-layer"
          style={{
            backgroundImage: `url("${layer.url}")`,
            // The layer that has just arrived is the only one that animates;
            // an older one simply stays where it was beneath it.
            animation: index === layers.length - 1 ? 'deck-backdrop-in .6s var(--ease-out) both' : undefined,
          }}
        />
      ))}
      <div className="orbit-deckbackdrop-tint" style={{ background: game ? `hsl(${game.hue} 45% 14% / .4)` : undefined }} />
      <div className="orbit-deckbackdrop-glass" aria-hidden />
      <div className="orbit-deckbackdrop-shade" />
    </div>
  );
}

/**
 * The game the shelf is about, as a panel down the left edge.
 *
 * A console puts the thing you are looking at in front of you: the poster, the
 * name, what has been played of it and the one button that starts it. The
 * calls this a sheet and floats it over the collection rather than making a page
 * of it, and that is the shape here too - 27rem wide with a margin off the edge,
 * so the covers are still visible to the right of it and the shelf behind it
 * still reads as the thing being browsed.
 */
function GameSheet({
  game,
  running,
  left,
  progress,
  prefs,
  onPlay,
  onStop,
  onDetails,
  onEdit,
  onFavourite,
  onClose,
}: {
  game: Game;
  running: boolean;
  left: number | null;
  progress: number | null;
  prefs: StardeckPrefs;
  onPlay: () => void;
  onStop: () => void;
  onDetails: () => void;
  onEdit: () => void;
  onFavourite: () => void;
  onClose: () => void;
}) {
  const facts = [
    game.meta?.releaseYear ? String(game.meta.releaseYear) : null,
    game.meta?.developer || null,
    game.meta?.genres?.slice(0, 2).join(' · ') || null,
  ].filter(Boolean) as string[];

  return (
    <aside className="orbit-decksheet" data-deck-sheet aria-label={`${game.title}, selected`}>
      <button type="button" onClick={onClose} className="orbit-decksheet-close" aria-label="Close this panel">
        <X className="size-4" />
      </button>
      <div key={game.id} className="orbit-decksheet-inner">
        <div className="orbit-decksheet-art">
          <Cover game={game} className="orbit-decksheet-cover" fit="cover" loading="eager" />
          {game.favorite && (
            <span className="orbit-decksheet-star" aria-hidden>
              <Star className="size-3" fill="currentColor" strokeWidth={0} />
            </span>
          )}
        </div>

        <div className="orbit-decksheet-head">
          <p className="orbit-decksheet-kicker">
            {running ? (
              <>
                <span className="orbit-deck-live" aria-hidden />
                Playing now
              </>
            ) : game.status === 'playing' ? (
              'In progress'
            ) : game.status === 'completed' ? (
              'Finished'
            ) : (
              'Ready to play'
            )}
          </p>
          <GameTitle game={game} logo={prefs.logo} />
          {prefs.facts && facts.length > 0 && <p className="orbit-decksheet-facts">{facts.join('  ·  ')}</p>}
        </div>

        {prefs.stats && (
          <dl className="orbit-decksheet-stats">
            <div>
              <dt>Played</dt>
              <dd>{fmtMinutes(game.playSecs / 60)}</dd>
            </div>
            {game.lastPlayed && (
              <div>
                <dt>Last played</dt>
                <dd>{fmtDate(game.lastPlayed)}</dd>
              </div>
            )}
            {left !== null && (
              <div>
                <dt>Story left</dt>
                <dd>{left > 0 ? `${left}h` : 'Almost done'}</dd>
              </div>
            )}
            {game.sizeBytes > 0 && (
              <div>
                <dt>On disk</dt>
                <dd>{fmtBytes(game.sizeBytes)}</dd>
              </div>
            )}
          </dl>
        )}

        {progress !== null && (
          <div className="orbit-decksheet-progress">
            <div className="orbit-deck-progresshead">
              <span>Main story</span>
              <b>{progress}%</b>
            </div>
            <div className="orbit-deck-rail" aria-hidden>
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div data-tv-actions className="orbit-decksheet-actions">
          {running ? (
            <button data-tv-action="stop" onClick={onStop} className="orbit-decksheet-play is-stop">
              <Square className="size-4" fill="currentColor" strokeWidth={0} />
              Stop
            </button>
          ) : (
            <button data-tv-action="play" onClick={onPlay} className="orbit-decksheet-play">
              <Play className="size-4" fill="currentColor" strokeWidth={0} />
              Play
            </button>
          )}
          <button
            type="button"
            data-tv-action="favourite"
            onClick={onFavourite}
            aria-pressed={game.favorite}
            aria-label={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
            title={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
            className="orbit-decksheet-iconbtn"
          >
            <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            data-tv-action="edit"
            onClick={onEdit}
            aria-label="Game settings"
            title="Game settings"
            className="orbit-decksheet-iconbtn"
          >
            <Settings2 className="size-4" />
          </button>
          <button type="button" data-tv-action="details" onClick={onDetails} className="orbit-decksheet-more">
            <Info className="size-3.5" />
            Full page
          </button>
        </div>
      </div>
    </aside>
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
    <button type="button" onClick={onClick} className="orbit-deckside-item">
      <span className="orbit-deckside-itemicon">
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="orbit-deckside-itemlabel">{label}</span>
        <span className="orbit-deckside-itemhint">{hint}</span>
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
  showMusic: _showMusic,
  showBars: _showBars,
  onPlay,
  onStop,
  onDetails,
  onExit,
  onOpenSettings,
  onAddGame,
  onEditGame,
  onToggleFavorite,
  onPower,
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
  /** The Add game form, which is Orbit's own and not a page of the hub. */
  onAddGame: () => void;
  /** A game's settings: the same centred editor the library opens. */
  onEditGame: (game: Game) => void;
  /** The star, so a favourite can be made one from the couch. */
  onToggleFavorite: (id: string) => void;
  /** Quit Orbit, having asked the shell to do it the usual way. */
  onPower: () => void;
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
  const [menuPage, setMenuPage] = useState<StardeckPage>('home');
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
  /**
   * Whether the selected game's own panel is out.
   *
   * The deck is the covers. A panel describing whichever one the row happens to
   * be on stands in the middle of the screen and answers a question nobody has
   * asked yet; it belongs to a game that was chosen, so it opens when its cover
   * is pressed and closes when it is dismissed. Walking the row with a key or a
   * stick does not open it - that is browsing, not choosing.
   */
  const [sheetOpen, setSheetOpen] = useState(false);
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
      // The cover is the only picture the deck draws now: the row shows it and
      // the room's own light is a blurred copy of the same file, so warming one
      // warms both.
      warmCover(game);
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
   * The buttons on the game's own panel: Play, the star, the settings and the
   * full page, in the order the eye reads them.
   */
  const actionButtons = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-tv-actions] [data-tv-action]'));
  const onAction = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.closest('[data-tv-action]') !== null;
  /**
   * The floating pills: Deck, Library and - when something is running - the
   * one that stops it. There is no bar any more, so this is where a sideways
   * press at the top of the screen goes.
   */
  const barButtons = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-tv-pills] button'));
  const inTopbar = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.closest('[data-tv-pills]') !== null;
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

  /**
   * Bring the selected game's panel out and put the focus on its Play button.
   *
   * The panel is not part of browsing the row, so it is only ever opened by a
   * press that means "this one" - a click on the cover, a vertical move, or the
   * game's own page coming back. The focus lands after the frame that paints
   * it, since the button does not exist before that.
   */
  const revealSheet = useCallback(() => {
    if (sheetOpen) {
      actionButtons()[0]?.focus({ preventScroll: true });
      return;
    }
    setSheetOpen(true);
    window.requestAnimationFrame(() => {
      (document.querySelector<HTMLElement>('[data-tv-actions] [data-tv-action="play"]')
        ?? document.querySelector<HTMLElement>('[data-tv-actions] [data-tv-action]'))
        ?.focus({ preventScroll: true });
    });
  }, [sheetOpen]);

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
          // Escape never drops the player onto the desktop: it closes what is
          // open, and when nothing is, it opens the side menu, where leaving is
          // one of the things that can be chosen. This is the console
          // convention and the reason the mode feels like a room rather than a
          // page - there is always a way back to the shelf.
          event.preventDefault();
          if (sheetOpen) {
            setSheetOpen(false);
            return;
          }
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
          // Nothing but the covers is on screen until one is chosen, and a
          // vertical press is the choice: it brings the game's panel out and
          // lands on its first button.
          revealSheet();
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
          revealSheet();
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
  }, [at, detailed, menu, moveLibraryFocus, revealSheet, select, sheetOpen, start, view]);

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
      else if (sheetOpen) setSheetOpen(false);
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
  }, [detailed, menu, onPlay, onStop, runningId, sheetOpen, start]);

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
      {/* The room is lit by the game in the middle of it: its own cover, blurred
          hard, cross-fading whenever the selection changes. There is no bar
          across the top any more - the two pages are pills floating on this
          picture, and everything else is one Escape away in the sidebar. */}
      <DeckBackdrop game={active ?? null} />

      <div data-tv-pills className="orbit-deck-pills">
        <div role="group" aria-label="Stardeck page" className="orbit-deck-pillgroup">
          <button data-tv-page-toggle type="button" onClick={() => setView('deck')} aria-pressed={view === 'deck'} className="orbit-deck-pillbtn">
            <Layers className="size-3.5" />
            Deck
          </button>
          <button data-tv-page-toggle type="button" onClick={() => setView('library')} aria-pressed={view === 'library'} className="orbit-deck-pillbtn">
            <LayoutGrid className="size-3.5" />
            Library
          </button>
        </div>
        {playingNow && (
          <span className="orbit-deck-playing" role="status">
            <span className="orbit-deck-playing-dot" aria-hidden />
            <span className="truncate">{playingNow.title}</span>
            <button type="button" onClick={onStop} title="Stop the session" aria-label="Stop the session">
              <Square className="size-3" fill="currentColor" strokeWidth={0} />
            </button>
          </span>
        )}
      </div>

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
            onAddGame={() => {
              closeMenu();
              window.setTimeout(onAddGame, 220);
            }}
            onOpenSettings={onOpenSettings}
            onPower={onPower}
            sound={sound}
            onSound={setSound}
            running={playingNow}
            library={list}
            onStop={onStop}
          />
        </div>
      )}

      <main className="orbit-tv-stage relative z-10 flex min-h-0 flex-1 flex-col">
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
            <div className="orbit-deck-plate">
              <p className="text-2xl font-bold text-white">Nothing to play yet</p>
              <p className="mt-1.5 max-w-md text-sm text-white/60">
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
        ) : view === 'library' ? (
          <section className="orbit-tv-library" aria-label="Stardeck library">
            <header className="orbit-tv-library-head">
              <div className="orbit-deck-plate min-w-0">
                <p className="orbit-tv-library-kicker">Your collection</p>
                <h1>Library</h1>
              </div>
              <p className="orbit-tv-library-count orbit-deck-plate">
                <b>{list.length}</b>
                {list.length === 1 ? ' game' : ' games'}
              </p>
            </header>
            <div className="orbit-tv-library-grid">
              {list.map((game, n) => (
                <button
                  key={game.id}
                  data-tv-cover={n}
                  data-tv-library-cover
                  type="button"
                  onFocus={() => setSelectedId(game.id)}
                  onClick={() => {
                    // A mouse is looking; a pad is choosing. The same press,
                    // told apart by where it came from.
                    setSelectedId(game.id);
                    if (padJustActivated(400)) onPlay(game);
                  }}
                  onDoubleClick={() => onPlay(game)}
                  aria-current={game.id === active.id ? 'true' : undefined}
                  aria-label={prefs.coverLabel === 'none' ? `Play ${game.title}` : game.title}
                  className="tv-library-game group min-w-0 text-left"
                >
                  <span
                    className={cn(
                      'tv-library-game-art block overflow-hidden bg-white/5 shadow-xl transition',
                      game.id === active.id && 'is-current',
                    )}
                  >
                    <Cover game={game} className="size-full" fit="cover" />
                    {game.id === runningId && (
                      <span className="tv-library-game-live">
                        <i aria-hidden />
                        Playing
                      </span>
                    )}
                  </span>
                  {prefs.coverLabel !== 'none' && (
                    <span className="tv-library-game-name">{game.title}</span>
                  )}
                  {prefs.coverLabel === 'info' && (
                    <span className="tv-library-game-info">
                      {[game.meta?.releaseYear ?? null, game.meta?.genres?.[0] ?? null, fmtMinutes(game.playSecs / 60)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="orbit-deck">
            {/* The covers are the screen, so no name is drawn under them. The
                game is still named for anyone reading the page aloud, and the
                panel that a press opens repeats it at size. */}
            <h1 className="sr-only">{active.title}</h1>
            {/* The game the shelf is about, on the left, the way a console draws
                it: a floating panel over the covers with the poster, the name,
                the numbers and the buttons that start it - rather than a strip
                along the bottom competing with the row for the same space. */}
            {sheetOpen && (
              <GameSheet
                game={active}
                running={running}
                left={left}
                progress={progress}
                prefs={prefs}
                onPlay={() => onPlay(active)}
                onStop={onStop}
                onDetails={() => {
                  setDetailId(active.id);
                  onDetails(active);
                }}
                onEdit={() => onEditGame(active)}
                onFavourite={() => onToggleFavorite(active.id)}
                onClose={() => setSheetOpen(false)}
              />
            )}

            {/* The shelf: one row of covers across the middle of the screen,
                nothing above it and nothing under it. */}
            <section className="orbit-deck-index">
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
                          // A press on a cover chooses the game and brings its
                          // panel out; a press on a cover that already chose
                          // it puts it away again.
                          if (game.id === active?.id) setSheetOpen((open) => !open);
                          else {
                            setSelectedId(game.id);
                            setSheetOpen(true);
                          }
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
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* The count and the two steps sit under the row, on nothing at
                all: the covers are the screen, and a bar around them would be
                the top bar this page deliberately does not have. */}
            <div className="orbit-deck-stepsline">
              <span className="orbit-deck-counter">
                <b>{at + 1}</b>
                <i aria-hidden>/</i>
                {list.length}
              </span>
              <div className="orbit-deck-steps">
                <button onClick={() => select(at - 1)} aria-label="Previous game" title="Previous game" className="orbit-deck-step">
                  <ChevronLeft className="size-4" />
                </button>
                <button onClick={() => select(at + 1)} aria-label="Next game" title="Next game" className="orbit-deck-step">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
