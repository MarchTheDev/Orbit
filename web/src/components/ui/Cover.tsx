import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Game } from '../../types';
import { fileSrc } from '../../services/desktop';
import { coverArtCandidates, decodeArtwork } from '../../utils/art';
import { cn } from '../../utils/cn';

/**
 * The library-wide answer to "how is this cover drawn", read from the same
 * storage the Settings page writes. It is a preference rather than app state so
 * that a tile does not have to be told about it at every call site; a game's own
 * `coverFit` still wins over it, and an arrangement's `fit` wins over both.
 */
function libraryFit(): 'cover' | 'contain' | undefined {
  try {
    const value = localStorage.getItem('orbit.covers.fit');
    return value === 'cover' || value === 'contain' ? value : undefined;
  } catch {
    return undefined;
  }
}

// Keep a few nearby TV images decoded across selection changes. Detached Image
// objects preserve the decoded resource while the visible components reuse it.
const warmImages = new Map<string, HTMLImageElement>();

export function warmImage(src: string | null | undefined) {
  if (!src || warmImages.has(src)) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  warmImages.set(src, image);
  if (warmImages.size > 16) {
    const oldest = warmImages.keys().next().value;
    if (oldest) warmImages.delete(oldest);
  }
  void image.decode().catch(() => undefined);
}

export function warmCover(game: Game) {
  warmImage(game.coverPath ? fileSrc(game.coverPath) : game.meta?.coverUrl ?? game.meta?.headerUrl ?? game.meta?.backgroundUrl);
}

/**
 * Cover art, best source first:
 *
 * 1. a cover already sitting next to the game on disk
 * 2. the store's own artwork
 * 3. initials on a gradient, which always works
 *
 * Shapes are not assumed. A grid tile is a tall rectangle, and a store banner is
 * a wide one, so pasting a banner into a tile crops most of it away, which is
 * exactly what a wrong-looking thumbnail is. Instead the picture says how wide
 * it is when it loads: tall art fills the frame, wide art is fitted whole over a
 * blurred copy of itself, so nothing is ever cut off.
 *
 * That guess is right most of the time and wrong often enough to matter, so a
 * game can carry its own answer: `meta.coverFit` pins the picture to `cover`
 * (fill the frame, crop what does not fit) or `contain` (fit it whole), chosen
 * on the Edit tab next to the artwork it applies to. Images use native lazy
 * loading so long libraries do not fetch and decode every poster just because
 * every tile is in the grid.
 */
export function Cover({
  game,
  className,
  style,
  fit: fitOverride,
  loading = 'lazy',
}: {
  game: Game;
  className?: string;
  /** For a size that comes from a slider rather than a class. */
  style?: CSSProperties;
  /** An arrangement-specific fit, before the game's saved preference. */
  fit?: 'cover' | 'contain';
  loading?: 'eager' | 'lazy';
}) {
  const candidates = coverArtCandidates(game);
  const identity = JSON.stringify(candidates);
  const [failures, setFailures] = useState<{ identity: string; failed: string[] }>({ identity: '', failed: [] });
  // Failures are per-artwork set, not per game. A source that was unavailable
  // for one title cannot suppress the same source for another title.
  const current = failures.identity === identity ? failures : { identity, failed: [] };
  const fail = (src: string) => {
    setFailures((old) => ({ identity, failed: [...(old.identity === identity ? old.failed : []), src] }));
  };

  // The order is: the arrangement's own mind (the TV's backdrop, a shelf's
  // choice), then the game's own answer, then the library-wide default in
  // Settings, and only then the guess made from the picture's shape.
  const fit = fitOverride ?? game.meta?.coverFit ?? libraryFit();

  const source = candidates.find((candidate) => !current.failed.includes(candidate));
  if (source) {
    return <Artwork src={source} alt={game.title} className={className} style={style} fit={fit} loading={loading} onFail={() => fail(source)} />;
  }

  const initials = game.title
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
  return (
    <div
      className={cn('relative flex items-center justify-center overflow-hidden', className)}
      style={{
        // A dark observatory plate with the game's own hue as a low wash, so a
        // library without artwork still reads as one set rather than a wall of
        // saturated colour blocks.
        background: `radial-gradient(circle at 32% 16%, hsl(${game.hue} 38% 38% / .42), transparent 64%), linear-gradient(165deg, var(--c-panel2), var(--c-panel))`,
        ...style,
      }}
    >
      <div className="absolute size-[140%] rounded-full border border-white/[0.07]" />
      <div className="absolute size-[86%] rounded-full border border-white/[0.05]" />
      <span className="relative text-2xl font-bold tracking-[0.06em] text-fg/85">{initials}</span>
    </div>
  );
}

/**
 * One picture in a frame of any shape.
 *
 * The frame's size comes from the caller's classes, so all this decides is how
 * the picture sits inside it: filled when it is already taller than it is wide,
 * and letterboxed over a blur when it is not.
 */
const aspectRatios = new Map<string, boolean>();

function Artwork({
  src,
  alt,
  className,
  style,
  fit,
  loading,
  onFail,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** The player's own answer, which beats the guess made from the shape. */
  fit?: 'cover' | 'contain';
  loading: 'eager' | 'lazy';
  onFail: () => void;
}) {
  const [wide, setWide] = useState(() => aspectRatios.get(src) ?? false);
  const [displaySrc, setDisplaySrc] = useState(src);
  useEffect(() => {
    setWide(aspectRatios.get(src) ?? false);
    if (src === displaySrc) return;
    let active = true;
    // Keep the previous decoded cover visible until the new high-resolution
    // candidate is ready, then swap in one paint rather than flashing empty.
    void decodeArtwork(src)
      .then(() => { if (active) setDisplaySrc(src); })
      .catch(() => { if (active) onFail(); });
    return () => { active = false; };
  }, [src]);
  // A pinned choice wins; otherwise a picture squarer than a poster is fitted
  // whole rather than cropped to a strip. Its measured shape is kept across
  // selection changes so an already-seen cover doesn't flash into crop mode.
  const fitted = fit === 'contain' || (fit === undefined && wide);

  return (
    <div className={cn('relative overflow-hidden', className)} style={style}>
      {/* First in the document so it stays behind: the blur fills the bars on
          either side with the picture's own colours, so a wide banner reads as
          artwork rather than as a gap with a picture in it. */}
      {fitted && (
        <img
          src={displaySrc}
          alt=""
          aria-hidden
          draggable={false}
          loading={loading}
          decoding="async"
          className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-xl"
        />
      )}
      <img
        src={displaySrc}
        alt={alt}
        draggable={false}
        loading={loading}
        onLoad={(e) => {
          if (fit !== undefined) return;
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          // Filling a tall frame with a picture that is barely taller than it is
          // wide cuts the sides off whatever the artwork actually shows, so
          // anything squarer than a poster is fitted whole instead.
          const isWide = w > 0 && h > 0 && w / h > 0.72;
          aspectRatios.set(src, isWide);
          if (aspectRatios.size > 128) aspectRatios.delete(aspectRatios.keys().next().value!);
          setWide(isWide);
        }}
        decoding="async"
        onError={onFail}
        className={cn('relative size-full', fitted ? 'object-contain' : 'object-cover')}
      />
    </div>
  );
}
