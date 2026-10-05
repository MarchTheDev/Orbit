import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Game } from '../../types';
import { fileSrc } from '../../services/desktop';
import { cn } from '../../utils/cn';

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
 */
export function Cover({
  game,
  className,
  style,
}: {
  game: Game;
  className?: string;
  /** For a size that comes from a slider rather than a class. */
  style?: CSSProperties;
}) {
  const [localFailed, setLocalFailed] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [headerFailed, setHeaderFailed] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);

  // A new game means a new cover to try, and a failed one must not stick.
  useEffect(() => {
    setLocalFailed(false);
    setRemoteFailed(false);
    setHeaderFailed(false);
    setBackdropFailed(false);
  }, [game.coverPath, game.meta?.coverUrl, game.meta?.headerUrl, game.meta?.backgroundUrl]);

  if (game.coverPath && !localFailed) {
    return <Artwork src={fileSrc(game.coverPath)} alt={game.title} className={className} style={style} onFail={() => setLocalFailed(true)} />;
  }

  if (game.meta?.coverUrl && !remoteFailed) {
    return <Artwork src={game.meta.coverUrl} alt={game.title} className={className} style={style} onFail={() => setRemoteFailed(true)} />;
  }

  if (game.meta?.headerUrl && !headerFailed) {
    return <Artwork src={game.meta.headerUrl} alt={game.title} className={className} style={style} onFail={() => setHeaderFailed(true)} />;
  }

  // The wide backdrop is the last picture worth trying before initials: it is
  // always there on a store page, and a letterboxed backdrop still reads as the
  // game rather than as a coloured square.
  if (game.meta?.backgroundUrl && !backdropFailed) {
    return <Artwork src={game.meta.backgroundUrl} alt={game.title} className={className} style={style} onFail={() => setBackdropFailed(true)} />;
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
  onFail,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  onFail: () => void;
}) {
  const [wide, setWide] = useState(false);

  return (
    <div className={cn('relative overflow-hidden', className)} style={style}>
      {/* First in the document so it stays behind: the blur fills the bars on
          either side with the picture's own colours, so a wide banner reads as
          artwork rather than as a gap with a picture in it. */}
      {wide && (
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-xl"
        />
      )}
      <img
        src={src}
        alt={alt}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          // Filling a tall frame with a picture that is barely taller than it is
          // wide cuts the sides off whatever the artwork actually shows, so
          // anything squarer than a poster is fitted whole instead.
          setWide(w > 0 && h > 0 && w / h > 0.72);
        }}
        onError={onFail}
        className={cn('relative size-full', wide ? 'object-contain' : 'object-cover')}
      />
    </div>
  );
}
