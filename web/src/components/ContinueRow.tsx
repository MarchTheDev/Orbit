import type { Game } from '../types';
import { fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';

export function ContinueRow({ games, onSelect }: { games: Game[]; onSelect: (id: string) => void }) {
  if (!games.length) return null;
  return (
    <section className="mt-8 px-6">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-muted">Continue playing</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {games.map((g) => (
          <button key={g.id} onClick={() => onSelect(g.id)} className="glass group flex w-72 shrink-0 items-center gap-3 rounded-2xl p-3 text-left transition hover:border-accent">
            <Cover game={g} className="size-14 shrink-0 rounded-xl [&_span]:text-sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{g.title}</p>
              <p className="text-xs text-muted">{fmtMinutes(g.playSecs / 60)}</p>
              {g.hltb && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, (g.playSecs / 3600 / g.hltb.main) * 100)}%` }} />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
