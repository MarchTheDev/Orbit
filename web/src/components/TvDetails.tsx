import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Clock,
  Hourglass,
  Layers,
  Play,
  Square,
  Tag,
  Trophy,
} from 'lucide-react';
import type { Game } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';

/**
 * A game, read at the size a television is read at.
 *
 * The app's own details drawer is a side panel built for a mouse: tabs, small
 * rows, a column that scrolls under the pointer. None of that survives a couch,
 * so pressing Details in the hub used to hand the game back to the desktop
 * layout - which meant leaving TV mode to look at something. This is the same
 * information on a page of its own, in two columns and big type: what the game
 * is on the left, what has been played of it on the right, and how long it takes
 * across the middle. Back returns to the rail; nothing about TV mode is undone
 * to read it.
 */
export function TvDetails({
  game,
  running,
  onPlay,
  onStop,
  onBack,
}: {
  game: Game;
  /** True when this is the game with the clock running. */
  running: boolean;
  onPlay: () => void;
  onStop: () => void;
  onBack: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const play = useRef<HTMLButtonElement>(null);
  const [atTop, setAtTop] = useState(true);

  // The page opens with Back under the ring, so a pad has somewhere to stand
  // and a second press of the same button goes back rather than doing nothing.
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, [game.id]);

  // Up and down are the page's own scroll here: there is nothing to move to
  // above or below the two buttons, and a long description has to be readable
  // without reaching for a mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const actions = [back.current, play.current].filter(
        (button): button is HTMLButtonElement => button !== null,
      );
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          onBack();
          return;
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!actions.includes(document.activeElement as HTMLButtonElement)) return;
          event.preventDefault();
          const here = actions.indexOf(document.activeElement as HTMLButtonElement);
          const step = event.key === 'ArrowRight' ? 1 : -1;
          actions[(here + step + actions.length) % actions.length]?.focus({ preventScroll: true });
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          scroller.current?.scrollBy({ top: step * 140, behavior: 'smooth' });
          return;
        }
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const times = [
    { label: 'Main story', hours: game.hltb?.main ?? 0, colour: '#38bdf8' },
    { label: 'Main + extras', hours: game.hltb?.mainExtra ?? 0, colour: '#a78bfa' },
    { label: 'Completionist', hours: game.hltb?.completionist ?? 0, colour: '#f472b6' },
  ].filter((row) => row.hours > 0);
  const longest = Math.max(...times.map((row) => row.hours), 0);
  const left =
    game.hltb?.main && game.hltb.main > 0
      ? Math.max(0, Math.round(game.hltb.main - game.playSecs / 3600))
      : null;
  const achievements = game.achievements?.length ?? 0;
  const unlocked = game.achievements?.filter((a) => a.unlocked).length ?? 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => setAtTop(event.currentTarget.scrollTop < 8)}
        className="orbit-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-2 sm:px-9"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            ref={back}
            data-tv-action="back"
            onClick={onBack}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] py-2 pl-3 pr-4 text-[13px] font-semibold text-white/85 backdrop-blur-md transition hover:border-accent/70 hover:bg-accent/15 hover:text-white focus-visible:ring-4 focus-visible:ring-accent/40"
          >
            <ArrowLeft className="size-4" />
            Back to the rail
          </button>
          {running ? (
            <button
              ref={play}
              data-tv-action="play"
              onClick={onStop}
              className="flex items-center gap-2 rounded-full bg-rose-500 px-5 py-2 text-[13px] font-bold text-white transition hover:brightness-110 focus-visible:ring-4 focus-visible:ring-rose-400/40"
            >
              <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
              Stop session
            </button>
          ) : (
            <button
              ref={play}
              data-tv-action="play"
              onClick={onPlay}
              className="flex items-center gap-2 rounded-full bg-white px-6 py-2 text-[13px] font-bold text-black transition hover:scale-[1.03] focus-visible:ring-4 focus-visible:ring-white/35"
            >
              <Play className="size-3.5" fill="currentColor" strokeWidth={0} />
              Play
            </button>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-8 md:flex-row md:items-start">
          <div className="flex shrink-0 flex-col items-center gap-5 md:w-[16rem]">
            <Cover
              game={game}
              className="orbit-hero-enter h-[clamp(12rem,38vh,20rem)] w-auto aspect-[2/3] rounded-2xl border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,.7)] [&_span]:text-4xl"
            />
            <div className="w-full space-y-2">
              {game.meta?.developer && <Line label="Developer">{game.meta.developer}</Line>}
              {game.meta?.releaseYear && <Line label="Released">{game.meta.releaseYear}</Line>}
              {game.meta?.genres?.length ? (
                <Line label="Genres">{game.meta.genres.join(' · ')}</Line>
              ) : null}
              {game.sizeBytes > 0 && <Line label="On disk">{fmtBytes(game.sizeBytes)}</Line>}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="orbit-hero-enter text-[clamp(2rem,4.6vh+1vw,3.6rem)] font-black leading-[1] tracking-[-0.02em] text-white">
              {game.title}
            </h1>
            {game.meta?.summary && (
              <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-white/70">{game.meta.summary}</p>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section>
                <Heading icon={Clock}>Played</Heading>
                <div className="grid grid-cols-2 gap-2">
                  <Tile value={fmtMinutes(game.playSecs / 60)} label="total" />
                  <Tile value={String(game.sessionCount)} label="sessions" />
                  <Tile value={game.lastPlayed ? fmtDate(game.lastPlayed) : 'never'} label="last played" />
                  <Tile value={fmtDate(game.addedAt)} label="added" />
                </div>
              </section>

              <section>
                <Heading icon={Hourglass}>How long it takes</Heading>
                {times.length > 0 ? (
                  <div className="space-y-2">
                    {times.map((row) => (
                      <div key={row.label} className="rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[12.5px] text-white/60">{row.label}</span>
                          <span className="font-mono text-base font-bold" style={{ color: row.colour }}>
                            {row.hours}h
                          </span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${longest > 0 ? (row.hours / longest) * 100 : 0}%`,
                              background: row.colour,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {left !== null && (
                      <p className="text-[12.5px] text-white/45">
                        {left > 0 ? `${left}h left of the main story` : 'the main story is nearly done'}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-white/15 px-3.5 py-3 text-[12.5px] text-white/45">
                    Nobody has written down how long this one takes yet.
                  </p>
                )}
              </section>

              <section>
                <Heading icon={Tag}>Where it stands</Heading>
                <div className="grid grid-cols-2 gap-2">
                  <Tile
                    value={
                      game.status === 'playing'
                        ? 'Playing'
                        : game.status === 'completed'
                          ? 'Completed'
                          : game.status === 'dropped'
                            ? 'Dropped'
                            : 'Backlog'
                    }
                    label="status"
                  />
                  <Tile value={game.favorite ? 'Yes' : 'No'} label="favourite" />
                </div>
              </section>

              {(achievements > 0 || game.notes) && (
                <section>
                  <Heading icon={achievements > 0 ? Trophy : Layers}>
                    {achievements > 0 ? 'Achievements' : 'Notes'}
                  </Heading>
                  {achievements > 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-3">
                      <p className="font-mono text-lg font-bold text-white">
                        {unlocked}
                        <span className="text-white/35"> / {achievements}</span>
                      </p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${Math.round((unlocked / achievements) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-3 text-[12.5px] leading-relaxed text-white/65">
                      {game.notes}
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The top edge fades while the page is scrolled, so the columns do not
          run into the bar above them. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#05040d] to-transparent transition-opacity',
          atTop ? 'opacity-0' : 'opacity-100',
        )}
      />
    </div>
  );
}

/** A small per-row fact, the counterpart of the hub's pills. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.07] pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{label}</span>
      <span className="text-right text-[12.5px] font-medium text-white/80">{children}</span>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5">
      <p className="truncate text-[15px] font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</p>
    </div>
  );
}

/** The heading each block of the page opens with. */
function Heading({ icon: Icon, children }: { icon: typeof Award; children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
      <Icon className="size-3.5" />
      {children}
    </p>
  );
}
