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
}

export function GameGrid({ games, selectedId, onSelect, onPlay }: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-6 p-6">
      {games.map((g) => (
        <div key={g.id} onClick={() => onSelect(g.id)} onDoubleClick={() => onPlay(g)} className="group cursor-pointer">
          <div
            className={cn(
              'relative aspect-[3/4] overflow-hidden rounded-2xl transition duration-300 group-hover:scale-[1.04] group-hover:shadow-[0_12px_40px_-8px_var(--c-accent)]',
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
            {g.running && <span className="absolute right-3 top-3 size-2.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_2px_var(--c-accent)]" title="Playing now" />}
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
          <p className="mt-3 truncate text-sm font-semibold">{g.title}</p>
          <p className="text-xs text-muted">
            {fmtMinutes(g.playMinutes)}
            {g.drive && ` · ${g.drive}`}
          </p>
        </div>
      ))}
    </div>
  );
}