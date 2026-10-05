import { useEffect, useState } from 'react';
import type { Game } from '../../types';
import { fileSrc } from '../../services/desktop';
import { cn } from '../../utils/cn';

/**
 * Cover art, best source first:
 *
 * 1. a cover already sitting next to the game on disk
 * 2. the one fetched from IGDB
 * 3. initials on a gradient, which always works
 */
export function Cover({ game, className }: { game: Game; className?: string }) {
  const [localFailed, setLocalFailed] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);

  // A new game means a new cover to try, and a failed one must not stick.
  useEffect(() => {
    setLocalFailed(false);
    setRemoteFailed(false);
  }, [game.coverPath, game.igdb?.coverUrl]);

  if (game.coverPath && !localFailed) {
    return (
      <img
        src={fileSrc(game.coverPath)}
        alt={game.title}
        onError={() => setLocalFailed(true)}
        className={cn('object-cover', className)}
      />
    );
  }

  if (game.igdb?.coverUrl && !remoteFailed) {
    return (
      <img
        src={game.igdb.coverUrl}
        alt={game.title}
        onError={() => setRemoteFailed(true)}
        className={cn('object-cover', className)}
      />
    );
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
      style={{ background: `radial-gradient(circle at 30% 20%, hsl(${game.hue} 80% 55%), hsl(${(game.hue + 60) % 360} 70% 22%) 70%)` }}
    >
      <div className="absolute size-[140%] rounded-full border border-white/15" />
      <div className="absolute size-[90%] rounded-full border border-white/10" />
      <span className="relative text-3xl font-black tracking-tight text-white/90 drop-shadow">{initials}</span>
    </div>
  );
}