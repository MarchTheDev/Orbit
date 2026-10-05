import { Play, Star } from 'lucide-react';
import type { Game } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
import { cn } from '../utils/cn';
import { StatusBadge } from './StatusBadge';

interface Props { games: Game[]; selectedId: string | null; onSelect: (id: string) => void; onPlay: (g: Game) => void }

export function GameList({ games, selectedId, onSelect, onPlay }: Props) {
  return (
    <div className="p-6">
      <div className="grid grid-cols-[1fr_110px_100px_120px_70px_80px] gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
        <span>Name</span><span>Status</span><span>Playtime</span><span>Last played</span><span>Drive</span><span />
      </div>
      <div className="space-y-1">
        {games.map((g) => (
          <div
            key={g.id}
            onClick={() => onSelect(g.id)}
            onDoubleClick={() => onPlay(g)}
            className={cn(
              'grid cursor-pointer grid-cols-[1fr_110px_100px_120px_70px_80px] items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition',
              selectedId === g.id ? 'glass !border-accent' : 'border-transparent hover:bg-panel/60',
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Cover game={g} className="size-9 shrink-0 rounded-md [&_span]:text-xs" />
              <span className="truncate font-medium">
                {g.favorite && (
                  <Star className="mr-1 inline size-3 text-yellow-300 align-middle" fill="currentColor" strokeWidth={0} />
                )}
                {g.running && <span className="mr-1 inline-block size-2 animate-pulse rounded-full bg-emerald-400 align-middle" title="Playing now" />}
                {g.title}
              </span>
            </div>
            <StatusBadge status={g.status} />
            <span className="text-muted">{fmtMinutes(g.playMinutes)}</span>
            <span className="text-muted">{fmtDate(g.lastPlayed)}</span>
            <span className="text-muted">{g.drive || '—'}</span>
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
