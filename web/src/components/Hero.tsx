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
    <section className="orbit-hero-enter relative mx-6 mt-6 overflow-hidden rounded-2xl border border-line/60 bg-panel">
      <Cover game={game} className="orbit-hero-wash absolute inset-0 size-full opacity-25 [&_span]:hidden" />
      <div className="absolute inset-0 bg-gradient-to-r from-panel via-panel/90 to-panel/40" />

      <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-7">
        <Cover game={game} className="hidden h-40 w-[116px] shrink-0 rounded-xl sm:block [&_span]:text-3xl" />
        <div className="min-w-0 max-w-xl">
          <p className="orbit-kicker mb-2 flex items-center gap-2 text-accent">
            {running && <span className="orbit-pulse size-1.5 rounded-full bg-emerald-400" />}
            {running ? 'Playing now' : 'Jump back in'}
          </p>
          <h2 className="orbit-display line-clamp-1 text-3xl md:text-4xl">{game.title}</h2>
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted">{game.meta?.summary}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button onClick={onPlay} className="btn-accent flex h-10 items-center gap-2 px-6 text-sm">
              {running ? <Square className="size-3.5" fill="currentColor" strokeWidth={0} /> : <Play className="size-4" fill="currentColor" strokeWidth={0} />}
              {running ? 'Playing…' : 'Play'}
            </button>
            <button onClick={onDetails} className="btn-quiet flex h-10 items-center gap-2 px-5 text-sm">
              <Info className="size-4 text-muted" />
              Details
            </button>
          </div>
        </div>

        <dl className="flex gap-8 border-line/60 sm:ml-auto sm:border-l sm:pl-8">
          <div>
            <dt className="orbit-kicker">Played</dt>
            <dd className="orbit-num mt-1 text-sm font-semibold">{fmtMinutes(game.playSecs / 60)}</dd>
          </div>
          <div>
            <dt className="orbit-kicker">Last session</dt>
            <dd className="orbit-num mt-1 text-sm font-semibold">{game.lastPlayed ? fmtDate(game.lastPlayed) : 'Never'}</dd>
          </div>
          {pct !== null && (
            <div>
              <dt className="orbit-kicker">Main story</dt>
              <dd className="orbit-num mt-1 text-sm font-semibold">{pct}%</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
