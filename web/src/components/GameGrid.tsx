import { Play, Star } from 'lucide-react';
import type { Game } from '../types';
import { fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
import { cn } from '../utils/cn';

interface Props {
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlay: (g: Game) => void;
  /** Drawn at this percentage of the base tile, from the toolbar's slider. */
  scale: number;
  /** Set while the library is in the player's own order. */
  onReorder?: (fromId: string, toId: string) => void;
}

export function GameGrid({ games, selectedId, onSelect, onPlay, scale, onReorder }: Props) {
  return (
    <div
      className="grid gap-6 p-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(170 * (scale / 100))}px, 1fr))` }}
    >
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
          className={cn('group', onReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
        >
          <div
            className={cn(
              'relative aspect-[3/4] overflow-hidden rounded-2xl transition duration-300 group-hover:scale-[1.03] group-hover:shadow-[0_12px_40px_-8px_var(--c-accent)]',
              selectedId === g.id && 'ring-2 ring-accent ring-offset-4 ring-offset-bg',
            )}
          >
            <Cover game={g} className="size-full" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 transition group-hover:opacity-100" />
            {g.favorite && (
              <span className="absolute left-3 top-3 grid size-7 place-items-center rounded-full bg-black/40 text-yellow-300 backdrop-blur">
                <Star className="size-3.5" fill="currentColor" strokeWidth={0} />
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(g);
              }}
              aria-label={`Play ${g.title}`}
              className="absolute bottom-3 right-3 grid size-11 translate-y-3 place-items-center rounded-full bg-white text-black opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
            >
              <Play className="size-5" fill="currentColor" strokeWidth={0} />
            </button>
          </div>
          <p className="mt-3 truncate font-semibold" style={{ fontSize: `${Math.max(12, Math.round(14 * (scale / 100)))}px` }}>
            {g.title}
          </p>
          <p className="text-xs text-muted">
            {fmtMinutes(g.playMinutes)}
            {g.drive && ` · ${g.drive}`}
          </p>
        </div>
      ))}
    </div>
  );
}
