import { ArrowUpRight, BookOpen, Clock, FolderOpen, Pencil, Play, Square, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Game, GameLog, GameStatus, Session } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { listGameLogs, listSessions } from '../services/native';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';

const GROUPS: { id: string; label: string; statuses: GameStatus[]; dot: string }[] = [
  { id: 'playing', label: 'Playing', statuses: ['playing'], dot: 'bg-emerald-400' },
  { id: 'next', label: 'Next up', statuses: ['backlog'], dot: 'bg-accent2' },
  { id: 'completed', label: 'Completed', statuses: ['completed'], dot: 'bg-accent' },
  { id: 'dropped', label: 'Dropped', statuses: ['dropped'], dot: 'bg-muted' },
];

const STATUS_TEXT: Record<GameStatus, string> = {
  playing: 'Playing',
  backlog: 'Next up',
  completed: 'Completed',
  dropped: 'Dropped',
};

const STATUS_TONE: Record<GameStatus, string> = {
  playing: 'bg-emerald-500/15 text-emerald-300',
  backlog: 'bg-accent2/15 text-accent2',
  completed: 'bg-accent/15 text-accent',
  dropped: 'bg-fg/8 text-muted',
};

const STATUS_DOT: Record<GameStatus, string> = {
  playing: 'bg-emerald-400',
  backlog: 'bg-accent2',
  completed: 'bg-accent',
  dropped: 'bg-muted',
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

const dayKey = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const dayLabel = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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
 * The library as a game page, the way Heronite reads one.
 *
 * The room is lit by the selected game's own artwork. The cover rail keeps the
 * whole library visible and grouped by what is happening to each game, the
 * game takes the middle of the room with its record underneath it, and the
 * facts sit in a quiet column on the right.
 *
 * The rail selects rather than opens: a single press changes the room, a double
 * press starts the game, and Details is the explicit way into the full record.
 * That keeps browsing quiet on a library of four hundred.
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
  const gameId = game?.id ?? null;

  // The game's own history, read when the room changes. Both reads are small
  // and scoped to one game; a failure only costs the section that needed it.
  const [sessions, setSessions] = useState<Session[]>([]);
  const [logs, setLogs] = useState<GameLog[]>([]);

  useEffect(() => {
    if (!gameId) {
      setSessions([]);
      setLogs([]);
      return;
    }
    let alive = true;
    setSessions([]);
    setLogs([]);
    void listSessions(60, 0, gameId)
      .then((rows) => { if (alive) setSessions(rows); })
      .catch(() => undefined);
    void listGameLogs(gameId)
      .then((rows) => { if (alive) setLogs(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [gameId]);

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        games: games.filter((candidate) => group.statuses.includes(candidate.status)),
      })).filter((group) => group.games.length > 0),
    [games],
  );

  const days = useMemo(() => {
    const map = new Map<string, { start: number; secs: number; count: number; notes: string[] }>();
    for (const session of sessions) {
      const key = dayKey(session.startedAt);
      const row = map.get(key) ?? { start: session.startedAt, secs: 0, count: 0, notes: [] };
      row.secs += session.durationSecs;
      row.count += 1;
      if (session.note) row.notes.push(session.note);
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.start - a.start).slice(0, 3);
  }, [sessions]);

  const longestSession = useMemo(
    () => sessions.reduce<Session | null>((best, session) => (!best || session.durationSecs > best.durationSecs ? session : best), null),
    [sessions],
  );

  const journalEntries = useMemo(() => [...logs].sort((a, b) => b.at - a.at).slice(0, 3), [logs]);

  if (!game) return null;

  const running = runningId === game.id;
  const pct = game.hltb && game.hltb.main > 0
    ? Math.min(100, Math.round((game.playSecs / 3600 / game.hltb.main) * 100))
    : null;
  const art = wideArt(game);
  const meta = game.meta;
  const genres = meta?.genres ?? [];
  const folder = game.installDir;
  const playLabel = fmtMinutes(game.playSecs / 60);
  const sessionCount = Math.max(game.sessionCount, sessions.length);

  return (
    <div className="relative">
      {art && <img src={art} alt="" aria-hidden draggable={false} className="orbit-backdrop" />}
      <div className="orbit-backdrop-scrim" aria-hidden />

      <div className="relative z-10 mx-auto flex max-w-[1680px] flex-col gap-7 px-4 pb-20 pt-5 sm:px-6 xl:flex-row xl:items-start xl:gap-6 xl:px-7">
        {/* ------------------------------------------------------------ shelf */}
        <aside className="orbit-rail-scroll order-1 -mx-4 mb-2 flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 xl:sticky xl:top-[4.75rem] xl:mx-0 xl:mb-0 xl:block xl:max-h-[calc(100vh-5.5rem)] xl:w-[300px] xl:overflow-x-hidden xl:overflow-y-auto xl:px-0 xl:pb-0 xl:pr-1">
          {groups.map((group) => (
            <section key={group.id} className="contents xl:mb-5 xl:block xl:last:mb-0">
              <div className="mb-2 hidden items-center gap-2 px-0.5 xl:flex">
                <span className={cn('size-1.5 rounded-full', group.dot)} aria-hidden />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.13em] text-fg/85">
                  {group.label}
                </h2>
                <span className="orbit-num ml-auto text-[11px] text-muted">{group.games.length}</span>
              </div>
              <div className="contents xl:grid xl:grid-cols-3 xl:gap-2">
                {group.games.map((row) => {
                  const active = row.id === game.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      data-orbit-game={row.id}
                      aria-current={active ? 'true' : undefined}
                      aria-label={`${row.title} — double-click to play`}
                      title={`${row.title} — double-click to play`}
                      onClick={() => setFocusId(row.id)}
                      onDoubleClick={() => onPlay(row)}
                      className="orbit-rail-tile group w-[74px] shrink-0 xl:w-auto"
                    >
                      <span className="orbit-rail-cover relative block aspect-[3/4]">
                        <Cover game={row} className="h-full w-full rounded-[11px] [&_span]:text-[11px]" />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-[11px] bg-gradient-to-t from-black/75 to-transparent"
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
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </aside>

        {/* ------------------------------------------------------------- page */}
        <section className="order-2 mx-auto w-full min-w-0 max-w-[820px] flex-1 xl:mx-0 xl:max-w-none">
          <header>
            <h1 className="orbit-display line-clamp-2 text-[38px] text-fg sm:text-[42px]">
              {game.title}
            </h1>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              {running && (
                <span className="flex items-center gap-1.5 font-medium text-emerald-300">
                  <span className="orbit-pulse size-1.5 rounded-full bg-emerald-400" />
                  Playing now
                </span>
              )}
              {running && (meta?.releaseYear || meta?.developer || genres.length) && <span aria-hidden>·</span>}
              {meta?.releaseYear && <span className="orbit-num">{meta.releaseYear}</span>}
              {meta?.developer && <><span aria-hidden>·</span><span>{meta.developer}</span></>}
              {!!genres.length && <><span aria-hidden>·</span><span className="truncate">{genres.join(' · ')}</span></>}
              {!meta && <span>No store details yet</span>}
            </p>
          </header>

          <div className="mt-6 grid gap-6 sm:grid-cols-[216px_minmax(0,1fr)] lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-8">
            <div className="min-w-0">
              <Cover
                game={game}
                className="orbit-cover aspect-[3/4] w-full rounded-[14px] [&_span]:text-4xl"
                loading="eager"
              />
              {running ? (
                <button
                  onClick={onStop}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[13px] bg-rose-500 text-[13px] font-semibold text-white transition hover:brightness-110"
                >
                  <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => onPlay(game)}
                  className="focus-play mt-4 flex h-11 w-full items-center justify-center gap-2 text-[13px]"
                >
                  <Play className="size-4" fill="currentColor" strokeWidth={0} />
                  Play
                </button>
              )}

              <div className="mt-3 flex items-center gap-1.5">
                <span className={cn('flex h-9 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold', STATUS_TONE[game.status])}>
                  <span className={cn('size-1.5 rounded-full', STATUS_DOT[game.status])} aria-hidden />
                  {STATUS_TEXT[game.status]}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(game.id)}
                    aria-label={game.favorite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
                    aria-pressed={game.favorite}
                    className={cn('focus-round', game.favorite && 'text-amber-300')}
                    title="Favourite"
                  >
                    <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(game.id)}
                    aria-label={`Edit ${game.title}`}
                    title={`Edit ${game.title}`}
                    className="focus-round"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDetails(game.id)}
                    aria-label={`Details for ${game.title}`}
                    title="Details"
                    className="focus-round"
                  >
                    <ArrowUpRight className="size-4" />
                  </button>
                </div>
              </div>

              <div className="focus-glass mt-3 rounded-[14px] px-3.5">
                {[
                  ['Rating', meta?.rating ? String(meta.rating) : '—'],
                  ['Library', LAUNCHER_TEXT[game.launch?.kind ?? 'none'] ?? 'Program'],
                  ['On disk', game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : '—'],
                  ['Sessions', sessionCount > 0 ? String(sessionCount) : '—'],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-4 border-b border-line/40 py-2 text-[12px] last:border-b-0"
                  >
                    <span className="text-muted">{label}</span>
                    <span className={cn('orbit-num font-semibold text-fg', index === 0 && 'text-accent')}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-2.5 flex items-baseline justify-between gap-4">
                <h2 className="orbit-section-head flex items-center gap-2">
                  <BookOpen className="size-3.5 text-muted" strokeWidth={2} />
                  Journal
                </h2>
                <span className="orbit-num text-[11px] text-muted">
                  {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              {journalEntries.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {journalEntries.map((entry) => (
                    <div key={entry.id} className="focus-glass flex min-h-[86px] flex-col rounded-[11px] p-3">
                      <span className="orbit-num text-[10.5px] text-muted">{dayLabel(entry.at)}</span>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg/90">
                        {entry.note || entry.details || 'Session'}
                      </p>
                      {entry.secs > 0 && (
                        <span className="orbit-num mt-auto pt-2 text-[10.5px] text-muted">{fmtMinutes(entry.secs / 60)}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[86px] flex-col justify-center rounded-[11px] border border-dashed border-line/70 bg-bg/25 px-4 py-4 text-[12px] leading-relaxed text-muted">
                  <span className="font-medium text-fg/85">No entries yet</span>
                  <span>Anything you write about {game.title} in Journal shows up here.</span>
                </div>
              )}

              <section className="mt-7">
                <h2 className="orbit-section-head">Overview</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  {meta?.summary || 'Orbit has not looked this title up yet. Fetching works with no setup and no key.'}
                </p>
                {pct !== null && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-baseline justify-between gap-4 text-[11px]">
                      <span className="text-muted">Main story</span>
                      <span className="orbit-num text-muted">
                        {pct}% of {Math.round(game.hltb?.main ?? 0)}h
                      </span>
                    </div>
                    <div className="orbit-rail" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Main story progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}
              </section>

              <section className="mt-7">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="orbit-section-head">Timeline</h2>
                  <span className="orbit-num text-[11px] text-muted">
                    {sessionCount > 0
                      ? `${sessionCount} sessions${game.lastPlayed ? ` · last ${fmtDate(game.lastPlayed)}` : ''}`
                      : 'No sessions yet'}
                  </span>
                </div>

                {days.length ? (
                  <div className="mt-3">
                    {days.map((day, index) => {
                      const longestHere = longestSession ? dayKey(longestSession.startedAt) === dayKey(day.start) : false;
                      const gap = index < days.length - 1
                        ? Math.max(0, Math.round((day.start - days[index + 1].start) / 86400) - 1)
                        : 0;
                      return (
                        <div key={day.start}>
                          <div className="grid grid-cols-[56px_14px_minmax(0,1fr)] items-start gap-3">
                            <div className="pt-0.5 text-[11px]">
                              <b className="orbit-num block font-semibold text-fg/90">{dayLabel(day.start)}</b>
                              <span className="text-muted">{day.count} session{day.count === 1 ? '' : 's'}</span>
                            </div>
                            <div className="relative flex h-full min-h-[44px] justify-center" aria-hidden>
                              <span className="absolute top-1.5 size-2 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--c-accent)_18%,transparent)]" />
                              {index < days.length - 1 && <span className="mt-4 w-px flex-1 bg-line/60" />}
                            </div>
                            <div className="pb-5">
                              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px]">
                                <b className="orbit-num font-semibold text-fg">Played {fmtMinutes(day.secs / 60)}</b>
                                <span className="text-muted">· {day.count === 1 ? '1 session' : `${day.count} sessions`}</span>
                                {longestHere && (
                                  <span className="rounded-md bg-fg/8 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                                    Longest session
                                  </span>
                                )}
                              </p>
                              {day.notes.slice(0, 2).map((note) => (
                                <p key={note} className="mt-1 line-clamp-1 text-[11.5px] text-muted">{note}</p>
                              ))}
                            </div>
                          </div>
                          {gap > 0 && (
                            <p className="orbit-num -mt-2 pb-3 pl-[71px] text-[10.5px] text-muted/70">
                              {gap} day{gap === 1 ? '' : 's'} without playing
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-[11px] border border-dashed border-line/70 bg-bg/25 px-4 py-4">
                    <p className="text-[12.5px] font-medium text-fg/90">
                      {game.sessionCount > 0 ? `${game.sessionCount} sessions recorded` : 'No sessions yet'}
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted">
                      {game.sessionCount > 0
                        ? `${playLabel} played${game.lastPlayed ? ` · last ${fmtDate(game.lastPlayed)}` : ''}`
                        : 'Press Play and Orbit keeps the record from the first second.'}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- details */}
        <aside className="order-3 hidden min-w-0 shrink-0 min-[1280px]:sticky min-[1280px]:top-[4.75rem] min-[1280px]:block min-[1280px]:w-[280px]">
          <div className="focus-glass rounded-[14px] p-5">
            <dl className="divide-y divide-line/40">
              <div className="orbit-fact-row"><dt>Developer</dt><dd>{meta?.developer || '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Released</dt><dd>{meta?.releaseYear || '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Genre</dt><dd>{genres.length ? genres.join(' / ') : '—'}</dd></div>
              <div className="orbit-fact-row"><dt>Last played</dt><dd>{fmtDate(game.lastPlayed)}</dd></div>
              <div className="orbit-fact-row"><dt>Playtime</dt><dd>{playLabel}</dd></div>
            </dl>

            <div className="mt-4 border-t border-line/50 pt-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold text-fg/85">
                <FolderOpen className="size-3.5 text-muted" strokeWidth={1.9} />
                Installation folder
              </p>
              <p className="mt-2 break-all text-[10.5px] leading-relaxed text-muted">
                {folder || 'Not linked yet'}
              </p>
              <p className="orbit-num mt-1 text-[10.5px] text-muted/75">
                {game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : 'Size not measured'}
                {game.drive ? ` · ${driveLabel(game.drive)}` : ''}
              </p>
            </div>

            <div className="mt-4 space-y-3 border-t border-line/50 pt-4">
              <div>
                <p className="orbit-kicker">Features</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['Session log', 'Save backup', 'Local metadata'].map((tag) => (
                    <span key={tag} className="rounded-md bg-fg/8 px-2 py-1 text-[10.5px] font-medium text-muted">{tag}</span>
                  ))}
                </div>
              </div>
              {!!genres.length && (
                <div>
                  <p className="orbit-kicker">Genres</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {genres.map((genre) => (
                      <span key={genre} className="rounded-md bg-fg/8 px-2 py-1 text-[10.5px] font-medium text-muted">{genre}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="orbit-kicker">Status</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className={cn('rounded-md px-2 py-1 text-[10.5px] font-semibold', STATUS_TONE[game.status])}>
                    {STATUS_TEXT[game.status]}
                  </span>
                  {game.drive && (
                    <span className="rounded-md bg-fg/8 px-2 py-1 text-[10.5px] font-medium text-muted">{game.drive}</span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => onDetails(game.id)}
              className="btn-quiet mt-4 flex w-full items-center justify-between px-3.5 py-2.5 text-[12.5px]"
            >
              Open full record
              <ArrowUpRight className="size-4 text-muted" />
            </button>
          </div>

          <p className="mt-3 text-center text-[10.5px] text-muted/70">
            Local library · no account · metadata optional
          </p>
        </aside>
      </div>
    </div>
  );
}
