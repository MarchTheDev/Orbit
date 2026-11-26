import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Clock,
  Hourglass,
  Layers,
  Pencil,
  Play,
  Square,
  Star,
  Tag,
  Trophy,
} from 'lucide-react';
import type { Game } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { tvLite } from '../services/tv';
import { GameTitle, backdropsFor } from './TvMode';

/**
 * A game, read at the size a television is read at — the page a console opens
 * when you choose a game from its shelf.
 *
 * Heronite's hero shape: the game's own wide artwork lights the whole page, its
 * wordmark sits over it, a row of actions starts it, and tabs split what there
 * is to know — Overview, Details, Journal — so a long description never crowds
 * the numbers. Pressing a cover on the rail lands here directly; Back returns to
 * the rail, and nothing about TV mode is undone to read it.
 */
type Tab = 'overview' | 'details' | 'journal';

export function TvDetails({
  game,
  running,
  onPlay,
  onStop,
  onEdit,
  onFavourite,
  onBack,
}: {
  game: Game;
  /** True when this is the game with the clock running. */
  running: boolean;
  onPlay: () => void;
  onStop: () => void;
  onEdit: () => void;
  onFavourite: () => void;
  onBack: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const play = useRef<HTMLButtonElement>(null);
  const favourite = useRef<HTMLButtonElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  // The page opens with Back under the ring, so a pad has somewhere to stand
  // and a second press of the same button goes back rather than doing nothing.
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
    setTab('overview');
  }, [game.id]);

  // Up and down are the page's own scroll here; left and right walk the action
  // row. A long description has to be readable without reaching for a mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const actions = [back.current, play.current, favourite.current, edit.current].filter(
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
  const hero = backdropsFor(game)[0] ?? game.meta?.coverUrl ?? null;
  const card = cn('rounded-xl border border-white/15 bg-[#0d0b18]/85', !tvLite && 'backdrop-blur-md');

  return (
    <div data-tv-game-title className="relative flex min-h-0 flex-1 flex-col">
      {/* The game's own wide artwork lights the page, dimmed so the type over it
          stays readable. It is the same picture the rail's room uses, brought
          forward and sharpened a little for the page that is about this game. */}
      {hero && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <img src={hero} alt="" className="size-full object-cover opacity-40" draggable={false} />
          <div className="absolute inset-0 bg-gradient-to-b from-[#05040d]/70 via-[#05040d]/55 to-[#05040d]" />
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(event) => setAtTop(event.currentTarget.scrollTop < 8)}
        className="tv-details-scroll orbit-scroll relative min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-2 sm:px-9"
      >
        <div data-tv-actions className="flex flex-wrap items-center gap-3">
          <button
            ref={back}
            data-tv-action="back"
            onClick={onBack}
            className={cn('flex items-center gap-2 rounded-full border border-white/15 bg-[#0d0b18]/85 py-2 pl-3 pr-4 text-[13px] font-semibold text-white/90 transition hover:border-accent/70 hover:bg-accent/15 hover:text-white focus-visible:ring-4 focus-visible:ring-accent/40', !tvLite && 'backdrop-blur-md')}
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
          <button
            ref={favourite}
            data-tv-action="favourite"
            onClick={onFavourite}
            aria-pressed={game.favorite}
            aria-label={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
            title={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
            className={cn('grid size-9 place-items-center rounded-full border border-white/15 bg-[#0d0b18]/85 text-white/85 transition hover:border-yellow-300/60 hover:text-yellow-200 focus-visible:ring-4 focus-visible:ring-accent/40', game.favorite && 'border-yellow-300/50 text-yellow-200', !tvLite && 'backdrop-blur-md')}
          >
            <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            ref={edit}
            data-tv-action="edit"
            onClick={onEdit}
            aria-label="Game settings"
            title="Game settings"
            className={cn('grid size-9 place-items-center rounded-full border border-white/15 bg-[#0d0b18]/85 text-white/85 transition hover:border-accent/70 hover:text-white focus-visible:ring-4 focus-visible:ring-accent/40', !tvLite && 'backdrop-blur-md')}
          >
            <Pencil className="size-4" />
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-end">
          <Cover
            game={game}
            className="orbit-hero-enter h-[clamp(10rem,30vh,16rem)] w-auto aspect-[2/3] rounded-2xl border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,.7)] [&_span]:text-4xl"
          />
          <div className="min-w-0 flex-1">
            <GameTitle game={game} logo />
            {game.meta?.genres?.length ? (
              <p className="mt-2 text-[13px] font-medium text-white/55">{game.meta.genres.join(' · ')}</p>
            ) : null}
          </div>
        </div>

        {/* Tabs split what there is to know, the way a console game page does. */}
        <div role="tablist" aria-label="Game information" className="mt-6 flex flex-wrap gap-2">
          {(['overview', 'details', 'journal'] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-[12.5px] font-semibold capitalize transition focus-visible:ring-4 focus-visible:ring-accent/40',
                tab === name ? 'border-accent/60 bg-accent/15 text-white' : 'border-white/15 bg-[#0d0b18]/70 text-white/60 hover:text-white',
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div key="overview" className="orbit-tv-tabpanel mt-5">
            {game.meta?.summary && (
              <p className={cn('max-w-3xl px-4 py-3 text-[15px] leading-relaxed text-white/75', card)}>{game.meta.summary}</p>
            )}
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
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
                      <div key={row.label} className={cn('px-3.5 py-2.5', card)}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[12.5px] text-white/60">{row.label}</span>
                          <span className="font-mono text-base font-bold" style={{ color: row.colour }}>{row.hours}h</span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/40">
                          <div className="h-full rounded-full" style={{ width: `${longest > 0 ? (row.hours / longest) * 100 : 0}%`, background: row.colour }} />
                        </div>
                      </div>
                    ))}
                    {left !== null && (
                      <p className="text-[12.5px] text-white/45">{left > 0 ? `${left}h left of the main story` : 'the main story is nearly done'}</p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-white/15 bg-[#0d0b18]/75 px-3.5 py-3 text-[12.5px] text-white/45">
                    Nobody has written down how long this one takes yet.
                  </p>
                )}
              </section>

              <section>
                <Heading icon={Tag}>Where it stands</Heading>
                <div className="grid grid-cols-2 gap-2">
                  <Tile
                    value={game.status === 'playing' ? 'Playing' : game.status === 'completed' ? 'Completed' : game.status === 'dropped' ? 'Dropped' : 'Backlog'}
                    label="status"
                  />
                  <Tile value={game.favorite ? 'Yes' : 'No'} label="favourite" />
                </div>
              </section>

              {achievements > 0 && (
                <section>
                  <Heading icon={Trophy}>Achievements</Heading>
                  <div className={cn('px-3.5 py-3', card)}>
                    <p className="font-mono text-lg font-bold text-white">{unlocked}<span className="text-white/35"> / {achievements}</span></p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/40">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round((unlocked / achievements) * 100)}%` }} />
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {tab === 'details' && (
          <div key="details" className="orbit-tv-tabpanel mt-5 grid gap-6 lg:grid-cols-2">
            <section className={cn('space-y-2 px-4 py-3', card)}>
              {game.meta?.developer && <Line label="Developer">{game.meta.developer}</Line>}
              {game.meta?.releaseYear && <Line label="Released">{game.meta.releaseYear}</Line>}
              {game.meta?.genres?.length ? <Line label="Genres">{game.meta.genres.join(' · ')}</Line> : null}
              {game.sizeBytes > 0 && <Line label="On disk">{fmtBytes(game.sizeBytes)}</Line>}
              {game.meta?.rating != null && <Line label="Score">{game.meta.rating} / 100</Line>}
              <Line label="Matched to">{game.meta?.matchTitle ?? game.meta?.name ?? '—'}</Line>
            </section>
            <section className={cn('space-y-2 px-4 py-3', card)}>
              <Line label="Starts with">{game.launch.kind === 'none' ? 'Timer only' : game.launch.kind === 'steam' ? 'Steam' : game.launch.kind === 'lutris' ? 'Lutris' : game.launch.kind === 'wine' ? 'Wine' : 'A program'}</Line>
              {game.installDir && <Line label="Folder">{game.installDir}</Line>}
              <Line label="Sessions">{String(game.sessionCount)}</Line>
              <Line label="Longest">{fmtMinutes(game.longestSecs / 60)}</Line>
            </section>
          </div>
        )}

        {tab === 'journal' && (
          <div key="journal" className="orbit-tv-tabpanel mt-5 grid gap-6 lg:grid-cols-2">
            <section>
              <Heading icon={Layers}>Notes</Heading>
              {game.notes ? (
                <p className={cn('whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-white/70', card)}>{game.notes}</p>
              ) : (
                <p className="rounded-xl border border-dashed border-white/15 bg-[#0d0b18]/75 px-3.5 py-3 text-[12.5px] text-white/45">No notes yet.</p>
              )}
            </section>
            <section>
              <Heading icon={Clock}>Recent</Heading>
              <div className="grid grid-cols-2 gap-2">
                <Tile value={game.lastPlayed ? fmtDate(game.lastPlayed) : 'never'} label="last played" />
                <Tile value={String(game.sessionCount)} label="sessions" />
                <Tile value={fmtMinutes(game.playSecs / 60)} label="total" />
                <Tile value={fmtMinutes(game.longestSecs / 60)} label="longest" />
              </div>
            </section>
          </div>
        )}
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
    <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{label}</span>
      <span className="text-right text-[12.5px] font-medium text-white/80">{children}</span>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className={cn('rounded-xl border border-white/15 bg-[#0d0b18]/85 px-3.5 py-2.5', !tvLite && 'backdrop-blur-md')}>
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
