import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Game } from '../../types';
import { fileSrc } from '../../services/desktop';
import { cn } from '../../utils/cn';

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
  const identity = JSON.stringify([game.coverPath, game.meta?.coverUrl, game.meta?.headerUrl, game.meta?.backgroundUrl]);
  const [failures, setFailures] = useState<{ identity: string; local: boolean; remote: boolean; header: boolean; backdrop: boolean }>({
    identity: '', local: false, remote: false, header: false, backdrop: false,
  });
  // Read failures for the current artwork identity during render. Resetting
  // them from an effect briefly showed initials or a fallback cover whenever
  // focus moved to a different game.
  const current = failures.identity === identity
    ? failures
    : { identity, local: false, remote: false, header: false, backdrop: false };
  const fail = (which: 'local' | 'remote' | 'header' | 'backdrop') => {
    setFailures((old) => ({ ...(old.identity === identity ? old : current), [which]: true }));
  };

  const fit = fitOverride ?? game.meta?.coverFit;

  if (game.coverPath && !current.local) {
    return <Artwork src={fileSrc(game.coverPath)} alt={game.title} className={className} style={style} fit={fit} loading={loading} onFail={() => fail('local')} />;
  }

  if (game.meta?.coverUrl && !current.remote) {
    return <Artwork src={game.meta.coverUrl} alt={game.title} className={className} style={style} fit={fit} loading={loading} onFail={() => fail('remote')} />;
  }

  if (game.meta?.headerUrl && !current.header) {
    return <Artwork src={game.meta.headerUrl} alt={game.title} className={className} style={style} fit={fit} loading={loading} onFail={() => fail('header')} />;
  }

  // The wide backdrop is the last picture worth trying before initials: it is
  // always there on a store page, and a letterboxed backdrop still reads as the
  // game rather than as a coloured square.
  if (game.meta?.backgroundUrl && !current.backdrop) {
    return <Artwork src={game.meta.backgroundUrl} alt={game.title} className={className} style={style} fit={fit} loading={loading} onFail={() => fail('backdrop')} />;
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
        background: `radial-gradient(circle at 30% 20%, hsl(${game.hue} 80% 55%), hsl(${(game.hue + 60) % 360} 70% 22%) 70%)`,
        ...style,
      }}
    >
      <div className="absolute size-[140%] rounded-full border border-white/15" />
      <div className="absolute size-[90%] rounded-full border border-white/10" />
      <span className="relative text-3xl font-black tracking-tight text-white/90 drop-shadow">{initials}</span>
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
  const [wide, setWide] = useState(false);
  // A pinned choice wins; otherwise a picture squarer than a poster is fitted
  // whole rather than cropped to a strip.
  const fitted = fit === 'contain' || (fit === undefined && wide);

  return (
    <div className={cn('relative overflow-hidden', className)} style={style}>
      {/* First in the document so it stays behind: the blur fills the bars on
          either side with the picture's own colours, so a wide banner reads as
          artwork rather than as a gap with a picture in it. */}
      {fitted && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          loading={loading}
          decoding="async"
          className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-xl"
        />
      )}
      <img
        src={src}
        alt={alt}
        draggable={false}
        loading={loading}
        onLoad={(e) => {
          if (fit !== undefined) return;
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          // Filling a tall frame with a picture that is barely taller than it is
          // wide cuts the sides off whatever the artwork actually shows, so
          // anything squarer than a poster is fitted whole instead.
          setWide(w > 0 && h > 0 && w / h > 0.72);
        }}
        decoding="async"
        onError={onFail}
        className={cn('relative size-full', fitted ? 'object-contain' : 'object-cover')}
      />
    </div>
  );
}
