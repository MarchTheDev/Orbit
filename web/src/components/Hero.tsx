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
    <section className="orbit-hero-enter relative mx-6 mt-6 overflow-hidden rounded-2xl border border-line bg-panel">
      <Cover game={game} className="orbit-hero-wash absolute inset-0 size-full opacity-45 [&_span]:hidden" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/20" />
      <div aria-hidden className="pointer-events-none absolute right-12 top-1/2 hidden -translate-y-1/2 lg:block">
        <div className="relative size-[18rem]">
          <div className="orbit-stage-ring orbit-stage-ring--outer inset-0" />
          <div className="orbit-stage-ring orbit-stage-ring--inner inset-[3rem]" />
        </div>
      </div>
      <div className="relative flex items-center gap-8 p-8">
        <Cover game={game} className="hidden h-56 w-40 shrink-0 rounded-xl shadow-2xl sm:flex [&_span]:text-4xl" />
        <div className="max-w-xl">
          <p className="orbit-kicker mb-2 flex items-center gap-2 text-accent">
            {running ? 'Now playing' : 'Jump back in'}
          </p>
          <h1 className="orbit-display text-4xl md:text-5xl">{game.title}</h1>
          <p className="mt-3 line-clamp-2 text-sm text-muted">{game.meta?.summary}</p>
          <div className="mt-5 flex flex-wrap gap-7 text-sm">
            <div><p className="orbit-kicker">Played</p><p className="orbit-num mt-1 font-semibold">{fmtMinutes(game.playSecs / 60)}</p></div>
            <div><p className="orbit-kicker">Last session</p><p className="orbit-num mt-1 font-semibold">{fmtDate(game.lastPlayed)}</p></div>
            {pct !== null && <div><p className="orbit-kicker">Main story</p><p className="orbit-num mt-1 font-semibold">{pct}%</p></div>}
          </div>
          <div className="mt-6 flex gap-2.5">
            <button onClick={onPlay} className="btn-accent flex items-center gap-2 rounded-lg px-7 py-2.5">
              {running ? <Square className="size-4" fill="currentColor" strokeWidth={0} /> : <Play className="size-4" fill="currentColor" strokeWidth={0} />}
              {running ? 'Playing…' : 'Play'}
            </button>
            <button onClick={onDetails} className="btn-quiet flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm">
              <Info className="size-4 text-muted" />
              Details
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
