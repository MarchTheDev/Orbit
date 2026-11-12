import { ArrowUpRight, Clock, Pencil, Play, Square, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Game, GameStatus } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';

const GROUPS: { id: string; label: string; statuses: GameStatus[]; dot: string }[] = [
  { id: 'playing', label: 'Playing', statuses: ['playing'], dot: 'bg-accent' },
  { id: 'next', label: 'Next up', statuses: ['backlog'], dot: 'bg-accent2' },
  { id: 'archive', label: 'Archive', statuses: ['completed', 'dropped'], dot: 'bg-muted' },
];

const STATUS_TEXT: Record<GameStatus, string> = {
  playing: 'Playing',
  backlog: 'Next up',
  completed: 'Completed',
  dropped: 'Dropped',
};

const LAUNCHER_TEXT: Record<string, string> = {
  none: 'Timer only',
  steam: 'Steam',
  wine: 'Wine',
};

/** The wide art of a game, which is what lights the room. */
function wideArt(game: Game) {
  return game.meta?.backgroundUrl ?? game.meta?.headerUrl ?? null;
}

interface Props {
  games: Game[];
  /** The game the library opens on when nothing else is selected. */
  heroGame: Game | null;
  runningId: string | null;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

/**
 * The library as a game page, not as a grid: the shelf of covers is grouped by
 * what you are doing with them, the selected game takes the room, and its
 * record sits beside it.
 *
 * The rail selects; it does not open the drawer. A single press moves the
 * page, a double press starts the game, and Details is the explicit way into
 * the full record. That keeps browsing quiet on a library of four hundred.
 */
export function FocusView({
  games,
  heroGame,
  runningId,
  onPlay,
  onStop,
  onDetails,
  onEdit,
  onToggleFavorite,
}: Props) {
  const fallbackId = heroGame?.id ?? games[0]?.id ?? null;
  const [focusId, setFocusId] = useState<string | null>(fallbackId);

  // A filter or a deleted game can take the focused body out of the field.
  // Move the focus to the first thing still visible rather than showing a hole.
  useEffect(() => {
    if (focusId && games.some((game) => game.id === focusId)) return;
    setFocusId(fallbackId);
  }, [focusId, games, fallbackId]);

  const game = games.find((candidate) => candidate.id === focusId) ?? games[0] ?? null;

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        games: games.filter((candidate) => group.statuses.includes(candidate.status)),
      })).filter((group) => group.games.length > 0),
    [games],
  );

  if (!game) return null;

  const running = runningId === game.id;
  const pct = game.hltb && game.hltb.main > 0
    ? Math.min(100, Math.round((game.playSecs / 3600 / game.hltb.main) * 100))
    : null;
  const art = wideArt(game);
  const meta = game.meta;
  const genres = meta?.genres ?? [];

  return (
    <div className="relative">
      {art && <img src={art} alt="" aria-hidden draggable={false} className="orbit-backdrop" />}
      <div className="orbit-backdrop-scrim" aria-hidden />

      <div className="relative z-10 mx-auto flex max-w-[1720px] flex-col gap-8 px-5 pb-16 pt-6 sm:px-7 xl:flex-row xl:items-start xl:gap-9 xl:px-9">
        {/* ------------------------------------------------------------ shelf */}
        <aside className="orbit-rail-scroll order-1 shrink-0 xl:order-1 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100vh-7rem)] xl:w-[248px] xl:overflow-y-auto xl:pr-1">
          {groups.map((group) => (
            <section key={group.id} className="mb-6 last:mb-0">
              <div className="mb-2.5 flex items-center gap-2 px-0.5">
                <span className={cn('size-1.5 rounded-full', group.dot)} aria-hidden />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.13em] text-fg/85">
                  {group.label}
                </h2>
                <span className="orbit-num ml-auto text-[11px] text-muted">{group.games.length}</span>
              </div>
              <div className="grid grid-cols-4 gap-x-2.5 gap-y-3 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-2">
                {group.games.map((row) => {
                  const active = row.id === game.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      data-orbit-game={row.id}
                      aria-current={active ? 'true' : undefined}
                      title={`${row.title} — double-click to play`}
                      onClick={() => setFocusId(row.id)}
                      onDoubleClick={() => onPlay(row)}
                      className="orbit-rail-tile group"
                    >
                      <span className="orbit-rail-cover relative block aspect-[3/4]">
                        <Cover game={row} className="h-full w-full rounded-[12px] [&_span]:text-[11px]" />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-[12px] bg-gradient-to-t from-black/75 to-transparent"
                        />
                        <span className="absolute bottom-1.5 left-2 flex items-center gap-1 text-[10px] font-medium text-white/90">
                          <Clock className="size-2.5" strokeWidth={2.2} />
                          {fmtMinutes(row.playSecs / 60)}
                        </span>
                        {row.favorite && (
                          <Star className="absolute right-1.5 top-1.5 size-3 fill-amber-300 text-amber-300" aria-label="Favourite" />
                        )}
                        {row.id === runningId && (
                          <span className="orbit-pulse absolute right-2 top-2 size-1.5 rounded-full bg-emerald-400" aria-label="Playing now" />
                        )}
                      </span>
                      <span className="orbit-rail-name mt-1.5 block truncate text-[11.5px] text-muted transition-colors group-hover:text-fg">
                        {row.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </aside>

        {/* ------------------------------------------------------------- page */}
        <section className="order-2 min-w-0 flex-1 xl:order-2">
          <header>
            <p className="orbit-kicker flex items-center gap-2 text-accent">
              {running ? (
                <>
                  <span className="orbit-pulse size-1.5 rounded-full bg-emerald-400" />
                  Playing now
                </>
              ) : (
                STATUS_TEXT[game.status]
              )}
            </p>
            <h1 className="orbit-display mt-2 line-clamp-2 text-4xl text-fg sm:text-5xl">
              {game.title}
            </h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              {meta?.releaseYear && <span className="orbit-num">{meta.releaseYear}</span>}
              {meta?.developer && <><span aria-hidden>·</span><span>{meta.developer}</span></>}
              {!!genres.length && <><span aria-hidden>·</span><span className="truncate">{genres.slice(0, 3).join(' · ')}</span></>}
              {!meta && <span>No store details yet</span>}
            </p>
          </header>

          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-7">
            <div className="w-40 shrink-0 sm:w-[188px]">
              <Cover
                game={game}
                className="orbit-cover aspect-[3/4] w-full rounded-2xl [&_span]:text-3xl"
                loading="eager"
              />
              {running ? (
                <button
                  onClick={onStop}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-500 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => onPlay(game)}
                  className="btn-accent mt-4 flex h-11 w-full items-center justify-center gap-2 text-sm"
                >
                  <Play className="size-4" fill="currentColor" strokeWidth={0} />
                  Play
                </button>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onToggleFavorite(game.id)}
                  aria-label={game.favorite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
                  aria-pressed={game.favorite}
                  className={cn(
                    'btn-quiet grid h-10 flex-1 place-items-center',
                    game.favorite && 'text-amber-300',
                  )}
                  title="Favourite"
                >
                  <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(game.id)}
                  aria-label={`Edit ${game.title}`}
                  title={`Edit ${game.title}`}
                  className="btn-quiet grid h-10 flex-1 place-items-center"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDetails(game.id)}
                  aria-label={`Details for ${game.title}`}
                  title="Details"
                  className="btn-quiet grid h-10 flex-1 place-items-center"
                >
                  <ArrowUpRight className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="orbit-section-head">Overview</h2>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
                {meta?.summary || 'Orbit has not looked this title up yet. Fetching works with no setup and no key.'}
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line/60 bg-line/40">
                {[
                  ['Playtime', fmtMinutes(game.playSecs / 60)],
                  ['Last played', game.lastPlayed ? fmtDate(game.lastPlayed) : 'Never'],
                  ['Sessions', game.sessionCount ? String(game.sessionCount) : '—'],
                  ['On disk', game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="bg-panel/85 px-3 py-2.5">
                    <dt className="orbit-kicker">{label}</dt>
                    <dd className="orbit-num mt-1 truncate text-[13px] font-semibold text-fg">{value}</dd>
                  </div>
                ))}
              </dl>

              {pct !== null && (
                <div className="mt-5">
                  <div className="mb-1.5 flex items-baseline justify-between gap-4 text-[11px]">
                    <span className="orbit-kicker">Main story</span>
                    <span className="orbit-num text-muted">
                      {pct}% of {Math.round(game.hltb?.main ?? 0)}h
                    </span>
                  </div>
                  <div className="orbit-rail" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Main story progress">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ---------------------------------------------------------- notes */}
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {game.hltb && (
              <section className="orbit-panel p-5">
                <h2 className="orbit-section-head">Completion</h2>
                <dl className="mt-2 divide-y divide-line/50">
                  <div className="orbit-fact-row"><dt>Main story</dt><dd>{game.hltb.main}h</dd></div>
                  <div className="orbit-fact-row"><dt>Main + extras</dt><dd>{game.hltb.mainExtra}h</dd></div>
                  <div className="orbit-fact-row"><dt>Completionist</dt><dd>{game.hltb.completionist}h</dd></div>
                </dl>
              </section>
            )}
            <section className="orbit-panel p-5">
              <h2 className="orbit-section-head">Sessions</h2>
              <dl className="mt-2 divide-y divide-line/50">
                <div className="orbit-fact-row"><dt>Playtime</dt><dd>{fmtMinutes(game.playSecs / 60)}</dd></div>
                <div className="orbit-fact-row"><dt>Longest session</dt><dd>{game.longestSecs > 0 ? fmtMinutes(game.longestSecs / 60) : '—'}</dd></div>
                <div className="orbit-fact-row"><dt>Last played</dt><dd>{game.lastPlayed ? fmtDate(game.lastPlayed) : 'Never'}</dd></div>
              </dl>
            </section>
          </div>
        </section>

        {/* ---------------------------------------------------------- details */}
        {/* The record is a third column only when there is room for the game's
            own page beside it. Below that, the same card is one press away in
            the action row, and the page keeps its width. */}
        <aside className="order-3 hidden min-w-0 shrink-0 min-[1360px]:sticky min-[1360px]:top-[5.5rem] min-[1360px]:block min-[1360px]:w-[272px]">
          <div className="orbit-panel p-5">
            <h2 className="orbit-section-head">Details</h2>
            <dl className="mt-2 divide-y divide-line/50">
              <div className="orbit-fact-row"><dt>Status</dt><dd>{STATUS_TEXT[game.status]}</dd></div>
              <div className="orbit-fact-row"><dt>Developer</dt><dd>{meta?.developer || '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Released</dt><dd>{meta?.releaseYear || '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Rating</dt><dd>{meta?.rating ?? '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Launcher</dt><dd>{LAUNCHER_TEXT[game.launch?.kind ?? 'none'] ?? 'Program'}</dd></div>
              <div className="orbit-fact-row"><dt>Drive</dt><dd>{driveLabel(game.drive) || '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Installed</dt><dd>{game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : 'Not measured'}</dd></div>
            </dl>

            {!!genres.length && (
              <>
                <h3 className="orbit-kicker mt-5">Genres</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {genres.map((genre) => (
                    <span key={genre} className="chip">{genre}</span>
                  ))}
                </div>
              </>
            )}

            <button
              onClick={() => onDetails(game.id)}
              className="btn-quiet mt-5 flex w-full items-center justify-between px-3.5 py-2.5 text-[13px]"
            >
              Full record
              <ArrowUpRight className="size-4 text-muted" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
