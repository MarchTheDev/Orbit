import { Info, Play, Square } from 'lucide-react';
import type { Game } from '../types';
import { fmtDate, fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';

interface Props { game: Game; running: boolean; onPlay: () => void; onDetails: () => void }

export function Hero({ game, running, onPlay, onDetails }: Props) {
  const pct = game.hltb ? Math.min(100, Math.round((game.playMinutes / 60 / game.hltb.main) * 100)) : null;
  return (
    <section className="relative mx-6 mt-5 overflow-hidden rounded-3xl border border-line">
      <Cover game={game} className="absolute inset-0 size-full scale-110 blur-2xl opacity-70 [&_span]:hidden" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-transparent" />
      <div className="relative flex items-center gap-8 p-8">
        <Cover game={game} className="hidden h-56 w-40 shrink-0 rounded-2xl shadow-2xl sm:flex [&_span]:text-4xl" />
        <div className="max-w-xl">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-accent">
            {running && <span className="size-2 animate-pulse rounded-full bg-emerald-400" />}
            {running ? 'Now playing' : 'Jump back in'}
          </p>
          <h1 className="text-4xl font-black leading-tight md:text-5xl">{game.title}</h1>
          <p className="mt-3 line-clamp-2 text-sm text-muted">{game.meta?.summary}</p>
          <div className="mt-4 flex flex-wrap gap-5 text-sm">
            <div><p className="text-[10px] uppercase tracking-widest text-muted">Played</p><p className="font-bold">{fmtMinutes(game.playMinutes)}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted">Last session</p><p className="font-bold">{fmtDate(game.lastPlayed)}</p></div>
            {pct !== null && <div><p className="text-[10px] uppercase tracking-widest text-muted">Main story</p><p className="font-bold">{pct}%</p></div>}
          </div>
          <div className="mt-6 flex gap-3">
            <button onClick={onPlay} className="flex items-center gap-2 rounded-full bg-fg px-8 py-3 font-bold text-bg transition hover:scale-105">
              {running ? <Square className="size-4" fill="currentColor" strokeWidth={0} /> : <Play className="size-4" fill="currentColor" strokeWidth={0} />}
              {running ? 'Playing…' : 'Play'}
            </button>
            <button onClick={onDetails} className="glass flex items-center gap-2 rounded-full px-6 py-3 font-semibold">
              <Info className="size-4" />
              Details
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
