import { ArrowUpRight, Pencil, Play, Square, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Game, GameStatus } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';
import { StatusBadge } from './StatusBadge';

const GROUPS: { id: string; label: string; statuses: GameStatus[] }[] = [
  { id: 'playing', label: 'In orbit', statuses: ['playing'] },
  { id: 'next', label: 'Next up', statuses: ['backlog'] },
  { id: 'archive', label: 'Archived', statuses: ['completed', 'dropped'] },
];

const STATUS_TEXT: Record<GameStatus, string> = {
  playing: 'In orbit',
  backlog: 'Next up',
  completed: 'Completed',
  dropped: 'Dropped',
};

/** The wide art of a game, which is what lights the stage. */
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
 * The library as an observatory sees it: bodies on the left, the selected game
 * lit in the middle, its telemetry on the right.
 *
 * The rail selects; it does not open the drawer. A single press moves the focus,
 * a double press starts the game, and Details is the explicit way into the full
 * record. That keeps browsing quiet on a library of four hundred games.
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

  return (
    <div className="mx-6 mt-6 grid items-start gap-6 pb-10 lg:grid-cols-[minmax(250px,290px)_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_300px]">
      {/* ------------------------------------------------------------ bodies */}
      <aside className="orbit-rail-scroll order-2 flex max-h-[48vh] flex-col overflow-y-auto pr-1 lg:sticky lg:top-24 lg:order-1 lg:max-h-[calc(100vh-8rem)]">
        {groups.map((group) => (
          <div key={group.id} className="mb-4 last:mb-0">
            <div className="mb-1.5 flex items-center justify-between px-2">
              <h2 className="orbit-kicker">{group.label}</h2>
              <span className="orbit-num text-[11px] text-muted/70">{group.games.length}</span>
            </div>
            <div className="space-y-0.5">
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
                    className="body-row group flex w-full items-center gap-3 rounded-r-lg px-2 py-2 text-left"
                  >
                    <span className="relative shrink-0">
                      <Cover game={row} className="h-14 w-10 rounded-md [&_span]:text-[10px]" />
                      {row.favorite && (
                        <Star className="absolute -left-1 -top-1 size-3 fill-amber-300 text-amber-300" aria-label="Favourite" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px]', active ? 'font-semibold text-fg' : 'font-medium text-fg/90')}>
                        {row.title}
                      </span>
                      <span className="orbit-num mt-0.5 block truncate text-[11px] text-muted">
                        {fmtMinutes(row.playSecs / 60)}
                        {row.id === runningId && <span className="text-emerald-400"> · playing</span>}
                      </span>
                    </span>
                    {row.id === runningId && <span className="orbit-pulse size-1.5 shrink-0 rounded-full bg-emerald-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </aside>

      {/* ------------------------------------------------------------- stage */}
      <section className="relative order-1 min-h-[460px] overflow-hidden rounded-2xl border border-line bg-panel lg:order-2">
        {/* The art is blurred past recognition and then scrimmed back to the
            room colour: it lights the stage without competing with the title
            or the telemetry drawn over it. */}
        {art && <img src={art} alt="" aria-hidden draggable={false} className="orbit-ambient" />}
        <div className="orbit-ambient-scrim" aria-hidden />

        <div className="absolute right-5 top-5 z-10 flex items-center gap-2">
          <StatusBadge status={game.status} />
          <button
            type="button"
            onClick={() => onToggleFavorite(game.id)}
            aria-label={game.favorite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
            aria-pressed={game.favorite}
            className="grid size-8 place-items-center rounded-lg border border-line bg-bg/60 text-muted backdrop-blur transition hover:text-amber-300"
          >
            <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(game.id)}
            aria-label={`Edit ${game.title}`}
            title={`Edit ${game.title}`}
            className="grid size-8 place-items-center rounded-lg border border-line bg-bg/60 text-muted backdrop-blur transition hover:text-fg"
          >
            <Pencil className="size-4" />
          </button>
        </div>

        <div className="relative flex min-h-[460px] flex-col justify-end p-7 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="relative shrink-0 self-start sm:self-end">
              {/* One hairline orbit behind the cover, centred by its wrapper so
                  the ring turns about its own middle. */}
              <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="relative size-[15rem]">
                  <div className="orbit-stage-ring orbit-stage-ring--outer inset-0" />
                </div>
              </div>
              <Cover
                game={game}
                className="relative z-10 h-60 w-44 rounded-xl [&_span]:text-4xl"
                loading="eager"
              />
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <p className="orbit-kicker text-accent">
                {running ? 'Now playing' : STATUS_TEXT[game.status]}
              </p>
              <h1 className="orbit-display mt-2 line-clamp-2 text-4xl text-fg sm:text-5xl">
                {game.title}
              </h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                {meta?.developer && <span>{meta.developer}</span>}
                {meta?.releaseYear && <><span aria-hidden>·</span><span className="orbit-num">{meta.releaseYear}</span></>}
                {!!meta?.genres.length && <><span aria-hidden>·</span><span className="truncate">{meta.genres.slice(0, 2).join(' · ')}</span></>}
                {!meta && <span>No store details yet</span>}
              </p>
              <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted">
                {meta?.summary || 'Orbit has not looked this title up yet. Fetching works with no setup and no key.'}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {running ? (
                  <button onClick={onStop} className="flex items-center gap-2 rounded-lg bg-rose-500 px-7 py-2.5 font-semibold text-white transition hover:brightness-110">
                    <Square className="size-4" fill="currentColor" strokeWidth={0} />
                    Stop
                  </button>
                ) : (
                  <button onClick={() => onPlay(game)} className="btn-accent flex items-center gap-2 rounded-full px-7 py-2.5">
                    <Play className="size-4" fill="currentColor" strokeWidth={0} />
                    Play
                  </button>
                )}
                <button onClick={() => onDetails(game.id)} className="btn-quiet flex items-center gap-2 rounded-full px-5 py-2.5 text-sm">
                  Details
                  <ArrowUpRight className="size-4 text-muted" />
                </button>
              </div>

              {pct !== null && (
                <div className="mt-6 max-w-md">
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

          <dl className="relative mt-8 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-line/70 pt-5 sm:grid-cols-4">
            <div>
              <dt className="orbit-kicker">Played</dt>
              <dd className="orbit-num mt-1 text-lg font-semibold">{fmtMinutes(game.playSecs / 60)}</dd>
            </div>
            <div>
              <dt className="orbit-kicker">Last played</dt>
              <dd className="orbit-num mt-1 text-lg font-semibold">{game.lastPlayed ? fmtDate(game.lastPlayed) : 'Never'}</dd>
            </div>
            <div>
              <dt className="orbit-kicker">Sessions</dt>
              <dd className="orbit-num mt-1 text-lg font-semibold">{game.sessionCount || '—'}</dd>
            </div>
            <div>
              <dt className="orbit-kicker">On disk</dt>
              <dd className="orbit-num mt-1 text-lg font-semibold">{game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : '—'}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* --------------------------------------------------------- telemetry */}
      {/* One panel, not four stacked cards: on a very wide screen the record is
          a single quiet column. Below 2xl the stage keeps its stats strip and
          the full record lives behind Details, so the library stays calm. */}
      <aside className="order-3 hidden min-w-0 flex-col gap-4 xl:flex">
        <div className="orbit-panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="orbit-kicker">Telemetry</h2>
            <span className="font-mono text-[10px] text-muted/70">{game.id.slice(0, 6)}</span>
          </div>
          <dl className="mt-2 divide-y divide-line/60">
            <div className="telemetry-row"><dt>Status</dt><dd className="capitalize">{STATUS_TEXT[game.status]}</dd></div>
            <div className="telemetry-row"><dt>Rating</dt><dd>{meta?.rating ?? '—'}</dd></div>
            <div className="telemetry-row"><dt>Playtime</dt><dd>{fmtMinutes(game.playSecs / 60)}</dd></div>
            <div className="telemetry-row"><dt>Last session</dt><dd>{game.lastPlayed ? fmtDate(game.lastPlayed) : 'Never'}</dd></div>
            <div className="telemetry-row"><dt>Longest</dt><dd>{game.longestSecs > 0 ? fmtMinutes(game.longestSecs / 60) : '—'}</dd></div>
          </dl>

          {game.hltb && (
            <>
              <h3 className="orbit-kicker mt-5">Completion</h3>
              <dl className="mt-2 divide-y divide-line/60">
                <div className="telemetry-row"><dt>Main story</dt><dd>{game.hltb.main}h</dd></div>
                <div className="telemetry-row"><dt>Main + extras</dt><dd>{game.hltb.mainExtra}h</dd></div>
                <div className="telemetry-row"><dt>Completionist</dt><dd>{game.hltb.completionist}h</dd></div>
              </dl>
            </>
          )}

          <h3 className="orbit-kicker mt-5">On disk</h3>
          <dl className="mt-2 divide-y divide-line/60">
            <div className="telemetry-row"><dt>Size</dt><dd>{game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : 'Not measured'}</dd></div>
            <div className="telemetry-row"><dt>Drive</dt><dd>{driveLabel(game.drive) || '—'}</dd></div>
            <div className="telemetry-row">
              <dt>Launcher</dt>
              <dd>
                {game.launch?.kind === 'none'
                  ? 'Timer only'
                  : game.launch?.kind === 'steam'
                    ? 'Steam'
                    : game.launch?.kind === 'wine'
                      ? 'Wine'
                      : 'Program'}
              </dd>
            </div>
          </dl>

          {!!meta?.genres.length && (
            <>
              <h3 className="orbit-kicker mt-5">Genres</h3>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {meta.genres.map((genre) => (
                  <span key={genre} className="chip">{genre}</span>
                ))}
              </div>
            </>
          )}
        </div>

        <button onClick={() => onDetails(game.id)} className="btn-quiet flex items-center justify-between rounded-lg px-4 py-3 text-sm">
          Full details
          <ArrowUpRight className="size-4 text-muted" />
        </button>
      </aside>
    </div>
  );
}
