import { Info, Play, Square } from 'lucide-react';
import type { Game } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';

interface Props {
  game: Game;
  running: boolean;
  onPlay: () => void;
  onDetails: () => void;
}

export function Hero({ game, running, onPlay, onDetails }: Props) {
  const pct = game.hltb ? Math.min(100, Math.round((game.playSecs / 3600 / game.hltb.main) * 100)) : null;
  return (
    <section className="orbit-hero-panel mx-6 mt-5 flex min-h-48 items-center gap-6 rounded-xl border border-line bg-panel p-5 md:gap-8 md:p-6">
      <Cover game={game} className="hidden h-40 w-28 shrink-0 rounded-lg border border-line sm:block" />
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          {running ? 'Now playing' : 'Continue playing'}
        </p>
        <h2 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{game.title}</h2>
        {game.meta?.summary && <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted">{game.meta.summary}</p>}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <div><p className="text-[9px] font-semibold uppercase tracking-wider text-muted">Played</p><p className="mt-1 font-semibold">{fmtMinutes(game.playSecs / 60)}</p></div>
          <div><p className="text-[9px] font-semibold uppercase tracking-wider text-muted">Last session</p><p className="mt-1 font-semibold">{fmtDate(game.lastPlayed)}</p></div>
          {pct !== null && <div><p className="text-[9px] font-semibold uppercase tracking-wider text-muted">Main story</p><p className="mt-1 font-semibold">{pct}%</p></div>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <button onClick={onPlay} className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
          {running ? <Square className="size-4" fill="currentColor" strokeWidth={0} /> : <Play className="size-4" fill="currentColor" strokeWidth={0} />}
          {running ? 'Playing' : 'Play'}
        </button>
        <button onClick={onDetails} className="flex min-h-9 items-center justify-center gap-2 rounded-lg border border-line bg-panel2 px-4 text-xs font-medium text-fg hover:border-accent">
          <Info className="size-3.5" /> Details
        </button>
      </div>
    </section>
  );
}
