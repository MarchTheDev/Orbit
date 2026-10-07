import { useState } from 'react';
import { Pencil, Play, Star } from 'lucide-react';
import type { Game } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
import { useDragReorder } from '../hooks/useDragReorder';
import { cn } from '../utils/cn';
import { StatusBadge } from './StatusBadge';
import { driveLabel } from '../utils/drive';

interface Props {
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlay: (g: Game) => void;
  /** Drawn at this percentage of the base row, from the toolbar's slider. */
  scale: number;
  /** Set while the library is in the player's own order. */
  onReorder?: (fromId: string, toId: string, after: boolean) => void;
}

export function GameList({ games, selectedId, onSelect, onEdit, onToggleFavorite, onPlay, scale, onReorder }: Props) {
  const { bind, dragging, over } = useDragReorder(onReorder);
  const [dismissedFavoriteId, setDismissedFavoriteId] = useState<string | null>(null);

  // One slider drives both views, so a row grows with the covers: the thumbnail
  // and the text step together rather than the picture alone getting bigger.
  const art = Math.round(36 * (scale / 100));
  const text = Math.max(12, Math.round(14 * (scale / 100)));

  return (
    <div className="p-6">
      <div className="grid grid-cols-[1fr_110px_100px_120px_70px_110px] gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
        <span>Name</span><span>Status</span><span>Playtime</span><span>Last played</span><span>Drive</span><span />
      </div>
      <div className="space-y-1">
        {games.map((g) => (
          <div
            key={g.id}
            onClick={() => onSelect(g.id)}
            onPointerLeave={() => setDismissedFavoriteId((id) => id === g.id ? null : id)}
            onDoubleClick={() => onPlay(g)}
            // What the app's one right-click handler looks for.
            data-orbit-game={g.id}
            {...bind(g.id)}
            className={cn(
              'group grid cursor-pointer grid-cols-[1fr_110px_100px_120px_70px_110px] items-center gap-3 rounded-2xl border px-3 py-2.5 transition',
              selectedId === g.id ? 'glass !border-accent' : 'border-transparent hover:bg-panel/60',
              onReorder && 'cursor-grab active:cursor-grabbing',
              over === g.id && 'ring-2 ring-accent',
              dragging === g.id && 'opacity-60',
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative shrink-0">
                <Cover
                  game={g}
                  className="rounded-lg [&_span]:text-xs"
                  style={{ width: `${art}px`, height: `${Math.round(art * 1.33)}px` }}
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (g.favorite && event.detail > 0) setDismissedFavoriteId(g.id);
                    else if (!g.favorite) setDismissedFavoriteId(null);
                    onToggleFavorite(g.id);
                  }}
                  aria-label={g.favorite ? `Remove ${g.title} from favorites` : `Add ${g.title} to favorites`}
                  aria-pressed={g.favorite}
                  title={g.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  className={cn(
                    'absolute left-1 top-1 z-10 grid size-6 place-items-center rounded-full border border-white/20 bg-black/70 text-yellow-300 shadow backdrop-blur transition',
                    g.favorite
                      ? 'opacity-100'
                      : dismissedFavoriteId === g.id
                        ? 'pointer-events-none opacity-0'
                        : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100',
                  )}
                >
                  <Star className="size-3.5" fill={g.favorite ? 'currentColor' : 'none'} />
                </button>
              </span>
              <span className="truncate font-medium" style={{ fontSize: `${text}px` }}>
                {g.title}
              </span>
            </div>
            <StatusBadge status={g.status} />
            <span className="text-muted">{fmtMinutes(g.playSecs / 60)}</span>
            <span className="text-muted">{fmtDate(g.lastPlayed)}</span>
            <span className="text-muted">{driveLabel(g.drive) || '-'}</span>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(g.id);
                }}
                title={`Edit ${g.title}`}
                aria-label={`Edit ${g.title}`}
                className="grid size-8 place-items-center rounded-lg border border-line text-muted opacity-100 transition hover:border-accent hover:text-accent sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(g);
                }}
                title={`Play ${g.title}`}
                className="btn-accent flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm"
              >
                <Play className="size-4" fill="currentColor" strokeWidth={0} />
                Play
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
