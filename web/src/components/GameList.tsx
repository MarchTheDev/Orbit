import { Play, Star } from 'lucide-react';
import type { Game } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
import { useDragReorder } from '../hooks/useDragReorder';
import { cn } from '../utils/cn';
import { StatusBadge } from './StatusBadge';

interface Props {
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlay: (g: Game) => void;
  /** Drawn at this percentage of the base row, from the toolbar's slider. */
  scale: number;
  /** Set while the library is in the player's own order. */
  onReorder?: (fromId: string, toId: string, after: boolean) => void;
}

export function GameList({ games, selectedId, onSelect, onPlay, scale, onReorder }: Props) {
  const { bind, dragging, over } = useDragReorder(onReorder);

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
            onDoubleClick={() => onPlay(g)}
            {...bind(g.id)}
            className={cn(
              'grid cursor-pointer grid-cols-[1fr_110px_100px_120px_70px_110px] items-center gap-3 rounded-2xl border px-3 py-2.5 transition',
              selectedId === g.id ? 'glass !border-accent' : 'border-transparent hover:bg-panel/60',
              onReorder && 'cursor-grab active:cursor-grabbing',
              over === g.id && 'ring-2 ring-accent',
              dragging === g.id && 'opacity-60',
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Cover
                game={g}
                className="shrink-0 rounded-lg [&_span]:text-xs"
                style={{ width: `${art}px`, height: `${Math.round(art * 1.33)}px` }}
              />
              <span className="truncate font-medium" style={{ fontSize: `${text}px` }}>
                {g.favorite && (
                  <Star className="mr-1 inline size-3 text-yellow-300 align-middle" fill="currentColor" strokeWidth={0} />
                )}
                {g.title}
              </span>
            </div>
            <StatusBadge status={g.status} />
            <span className="text-muted">{fmtMinutes(g.playSecs / 60)}</span>
            <span className="text-muted">{fmtDate(g.lastPlayed)}</span>
            <span className="text-muted">{g.drive || '-'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(g);
              }}
              title={`Play ${g.title}`}
              className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
            >
              <Play className="size-4" fill="currentColor" strokeWidth={0} />
              Play
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
