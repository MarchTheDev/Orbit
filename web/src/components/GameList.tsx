import { Play, Star } from 'lucide-react';
import type { Game } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
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
  onReorder?: (fromId: string, toId: string) => void;
}

export function GameList({ games, selectedId, onSelect, onPlay, scale, onReorder }: Props) {
  // One slider drives both views, so a row grows with the covers: the thumbnail
  // and the text step together rather than the picture alone getting bigger.
  const art = Math.round(36 * (scale / 100));
  const text = Math.max(12, Math.round(14 * (scale / 100)));

  return (
    <div className="p-6">
      <div className="grid grid-cols-[1fr_110px_100px_120px_70px_90px] gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
        <span>Name</span><span>Status</span><span>Playtime</span><span>Last played</span><span>Drive</span><span />
      </div>
      <div className="space-y-1">
        {games.map((g) => (
          <div
            key={g.id}
            onClick={() => onSelect(g.id)}
            onDoubleClick={() => onPlay(g)}
            draggable={!!onReorder}
            onDragStart={(e) => e.dataTransfer.setData('text/orbit-game', g.id)}
            onDragOver={(e) => {
              if (onReorder) e.preventDefault();
            }}
            onDrop={(e) => {
              const from = e.dataTransfer.getData('text/orbit-game');
              if (onReorder && from && from !== g.id) {
                e.preventDefault();
                onReorder(from, g.id);
              }
            }}
            className={cn(
              'grid cursor-pointer grid-cols-[1fr_110px_100px_120px_70px_90px] items-center gap-3 rounded-2xl border px-3 py-2.5 transition',
              selectedId === g.id ? 'glass !border-accent' : 'border-transparent hover:bg-panel/60',
              onReorder && 'cursor-grab active:cursor-grabbing',
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
            <span className="text-muted">{fmtMinutes(g.playMinutes)}</span>
            <span className="text-muted">{fmtDate(g.lastPlayed)}</span>
            <span className="text-muted">{g.drive || '-'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(g);
              }}
              className="flex items-center gap-1.5 rounded-md bg-accent/90 px-3 py-1 text-xs font-semibold text-white hover:bg-accent"
            >
              <Play className="size-3" fill="currentColor" strokeWidth={0} />
              Play
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
