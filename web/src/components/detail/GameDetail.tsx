import {
  Check,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  History,
  Info,
  NotebookPen,
  Pencil,
  Play,
  RefreshCw,
  Square,
  Star,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ActiveSession, Companion, Game, GameStatus, LaunchTarget, Session } from '../../types';
import { fetchMetadata } from '../../services/metadata';
import { openExternal } from '../../services/desktop';
import { fetchHltb } from '../../services/hltb';
import { listGameLogs } from '../../services/native';
import { fmtBytes } from '../../utils/format';
import { driveLabel } from '../../utils/drive';
import { Cover } from '../ui/Cover';
import { HltbCard } from './HltbCard';
import { Select } from '../ui/Select';
import { LaunchEditor } from './LaunchEditor';
import { SessionHistory } from './SessionHistory';
import { GameLogView } from './GameLogView';
import { AchievementsTab } from './AchievementsTab';
import { GameEditTab } from './GameEditTab';
import { EditSession, LogSession } from '../SessionsView';
import { TimeTracker } from './TimeTracker';

interface Props {
  game: Game;
  /**
   * What the drawer is being opened from.
   *
   * From the library it is about a game somebody is playing: how to start it,
   * where it came from, what it looks like. From the Backlog it is about a game
   * somebody is deciding to play, so nothing about launching belongs in it.
   */
  context?: 'library' | 'backlog';
  /**
   * Which tab to open on.
   *
   * The right-click menu in the library can go straight to Edit, and a drawer
   * that opens on Overview and then jumps is worse than one that opens where it
   * was asked to. The app gives the drawer a new key when it changes, so this is
   * read once per opening.
   */
  initialTab?: 'overview' | 'edit';
  /** The running session, if it is for this game. */
  session: ActiveSession | null;
  now: number;
  onUpdate: (patch: Partial<Game>) => void;
  /** Write the playtime the player wants to see, keeping the sessions. */
  onSetPlaytime: (totalSecs: number) => Promise<void>;
  onPlay: () => void;
  onStop: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Where the details on screen came from, said out loud. */
const SOURCE_LABEL: Record<string, string> = {
  steam: 'Steam catalogue',
  estimate: 'preview',
};

export function GameDetail({
  game,
  context = 'library',
  initialTab = 'overview',
  session,
  now,
  onUpdate,
  onSetPlaytime,
  onPlay,
  onStop,
  onRemove,
  onClose,
}: Props) {
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [loadingHltb, setLoadingHltb] = useState(false);
  const [hltbError, setHltbError] = useState<string | null>(null);
  const [playtimeError, setPlaytimeError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'achievements' | 'log' | 'sessions' | 'edit'>(initialTab);
  /** The backlog drawer is a smaller thing: four tabs, and no launch settings. */
  const backlog = context === 'backlog';
  const showing = backlog
    ? (['overview', 'log', 'sessions', 'edit'] as const)
    : (['overview', 'achievements', 'log', 'sessions', 'edit'] as const);
  const [logCount, setLogCount] = useState(0);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [loggingSession, setLoggingSession] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const running = session?.gameId === game.id;

  // The tab bar shows how much has been written, so the count is worth keeping,
  // and the journal says when it has moved.
  const [logVersion, setLogVersion] = useState(0);
  const refreshLogCount = useCallback(() => setLogVersion((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void listGameLogs(game.id).then((r) => {
      if (alive) setLogCount(r.length);
    });
    return () => {
      alive = false;
    };
  }, [game.id, logVersion]);

  // A refused total has to say why, or the number simply refuses to move.
  const setPlaytime = async (totalSecs: number) => {
    setPlaytimeError(null);
    try {
      await onSetPlaytime(totalSecs);
    } catch (e) {
      // Passed on to the editor rather than swallowed, so a total Rust refuses
      // leaves the player looking at their typing with the reason next to it.
      const message = e instanceof Error ? e.message : String(e);
      setPlaytimeError(message);
      throw new Error(message);
    }
  };

  const getDetails = async () => {
    setLoadingDetails(true);
    setDetailsError(null);
    try {
      onUpdate({ meta: await fetchMetadata(game.title) });
    } catch (e) {
      setDetailsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetails(false);
    }
  };

  const getHltb = async () => {
    setLoadingHltb(true);
    setHltbError(null);
    try {
      onUpdate({ hltb: await fetchHltb(game.title) });
    } catch (e) {
      // "No data" is the honest answer for a title HowLongToBeat simply does not
      // have, and it is worth saying rather than leaving the button looking dead.
      setHltbError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHltb(false);
    }
  };

  /**
   * Renaming, which is also what fixes a title that came from a file name.
   *
   * A changed title means the old completion times belong to a different name,
   * so HowLongToBeat is asked again; if it has nothing, the times that were
   * already there are kept rather than thrown away.
   */
  const [titleDraft, setTitleDraft] = useState(game.title);
  useEffect(() => setTitleDraft(game.title), [game.id, game.title]);

  const commitTitle = async () => {
    const next = titleDraft.trim();
    if (!next || next === game.title) {
      setTitleDraft(game.title);
      return;
    }
    onUpdate({ title: next });
    const fresh = await fetchHltb(next).catch(() => null);
    if (fresh) onUpdate({ title: next, hltb: fresh });
  };

  // The store number for this game, whether it was imported from Steam or found
  // by a lookup. Both buttons below are web pages, so they open in the browser.
  const steamAppId = game.meta?.steamAppId ?? (game.launch.kind === 'steam' ? game.launch.appId : null);

  return (
    <>
      <div className="fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="glass drawer-in fixed inset-y-3 right-3 z-50 flex w-[460px] max-w-[calc(100vw-24px)] flex-col overflow-y-auto rounded-3xl shadow-2xl">
        <div className="relative h-44 shrink-0">
          <Cover game={game} className="size-full opacity-60 [&_span]:hidden" />
          {/* The store's own backdrop sits over the cover art when there is one:
              it is the picture the game's page is meant to be read against. */}
          {game.meta?.backgroundUrl && (
            <img
              src={game.meta.backgroundUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-cover opacity-70"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-panel to-transparent" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid size-7 place-items-center rounded-lg bg-black/40 text-white hover:bg-black/60"
          >
            <X className="size-4" />
          </button>
          <div className="absolute bottom-0 left-0 flex items-end gap-4 p-5">
            <Cover game={game} className="h-28 w-20 rounded-lg shadow-xl [&_span]:text-lg" />
            <div className="pb-1">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void commitTitle()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setTitleDraft(game.title);
                }}
                spellCheck={false}
                aria-label="Game title"
                title="Rename this game"
                className="w-full max-w-[15rem] rounded-lg border border-transparent bg-transparent text-xl font-bold leading-tight outline-none hover:border-line focus:border-accent focus:bg-black/20"
              />
              <p className="text-xs text-muted">
                {game.meta?.developer ?? 'Unknown developer'}
                {game.meta?.releaseYear ? ` · ${game.meta.releaseYear}` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-line bg-panel/95 px-5 py-2 pr-4 backdrop-blur">
          {(
            [
              ['overview', 'Overview', Info],
              ['achievements', 'Achievements', Trophy],
              ['log', 'Log', NotebookPen],
              ['sessions', 'Sessions', History],
              ['edit', 'Edit', Pencil],
            ] as const
          )
            .filter(([id]) => (showing as readonly string[]).includes(id))
            .map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                tab === id ? 'bg-accent/15 text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon className="size-3.5" />
              {label}
              {id === 'achievements' && !!game.achievements?.length && (
                <span className="text-[10px] text-muted">
                  {game.achievements.filter((a) => a.unlocked).length}/{game.achievements.length}
                </span>
              )}
              {id === 'log' && logCount > 0 && <span className="text-[10px] text-muted">{logCount}</span>}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          {/* The Backlog drawer has no Start button at all: it is a page about
              deciding what to play, and a Stop for a session already running is
              the one thing worth keeping. */}
          {backlog ? (
            game.planned || running ? (
              <div className="flex gap-2">
                {running && (
                  <button
                    onClick={onStop}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-500 py-2.5 font-semibold text-white hover:brightness-110"
                  >
                    <Square className="size-4" fill="currentColor" strokeWidth={0} />
                    Stop session
                  </button>
                )}
                {game.planned && (
                  <button
                    onClick={() => onUpdate({ planned: false, status: 'backlog' })}
                    className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5"
                  >
                    <Check className="size-4" />
                    I own this now
                  </button>
                )}
              </div>
            ) : null
          ) : game.planned ? (
            <div className="flex gap-2">
              <button
                onClick={() => onUpdate({ planned: false, status: 'backlog' })}
                className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5"
              >
                <Check className="size-4" />
                I own this now
              </button>
              <button
                onClick={onPlay}
                title="Start the clock anyway, for a game played somewhere else"
                className="rounded-lg border border-line bg-panel2 px-3 text-xs text-muted hover:border-accent hover:text-fg"
              >
                Time it
              </button>
            </div>
          ) : (
          <div className="flex gap-2">
            {running ? (
              <button onClick={onStop} className="btn-danger flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5">
                <Square className="size-4" fill="currentColor" strokeWidth={0} />
                Stop session
              </button>
            ) : (
              <button onClick={onPlay} className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5">
                <Play className="size-4" fill="currentColor" strokeWidth={0} />
                Play
              </button>
            )}
            <button
              onClick={() => onUpdate({ favorite: !game.favorite })}
              // A forty-four pixel square, which is the size a target wants to
              // be, and it shows what it does while the pointer is over it. The
              // star used to be a thin line in the frame: the only thing that
              // said it could be pressed was pressing it.
              className={`group grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border transition ${
                game.favorite
                  ? 'border-yellow-300/50 bg-yellow-300/10'
                  : 'border-line bg-panel2 hover:border-yellow-300/60 hover:bg-yellow-300/10'
              }`}
              title={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-label={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-pressed={game.favorite}
            >
              <Star
                className={`size-5 transition-transform duration-150 group-hover:scale-125 group-active:scale-95 ${
                  game.favorite ? 'text-yellow-300' : 'text-muted group-hover:text-yellow-300'
                }`}
                fill={game.favorite ? 'currentColor' : 'none'}
              />
            </button>
            {/* Beside the star, because it is the same kind of thing: how this
                game is filed, not what to do with it. A hidden game keeps its
                sessions, its notes and its place; it is only out of the way. */}
            <button
              onClick={() => onUpdate({ hidden: !game.hidden })}
              className={`group grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border transition ${
                game.hidden
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-line bg-panel2 hover:border-accent/60 hover:bg-accent/10'
              }`}
              title={game.hidden ? 'Show in library again' : 'Hide from library'}
              aria-label={game.hidden ? 'Show in library again' : 'Hide from library'}
              aria-pressed={!!game.hidden}
            >
              {game.hidden ? (
                <Eye className="size-5 text-accent" />
              ) : (
                <EyeOff className="size-5 text-muted group-hover:text-accent" />
              )}
            </button>
          </div>
          )}

          {tab === 'overview' && (
            <>
          {/* Where this game sits, which is the one thing both readings of the
              drawer want first. The word is spelled out rather than drawn from
              the database's own name for it. */}
          <div className="flex items-stretch gap-2 text-xs">
            <label className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg bg-panel2 px-3 py-2">
              <span className="text-muted">Status</span>
              <Select
                value={game.status}
                onChange={(v) => onUpdate({ status: v as GameStatus })}
                className="!border-0 !bg-transparent !px-0 !py-0 text-xs font-medium"
                menuClassName="w-48"
                ariaLabel="Where this game sits"
                options={[
                  { value: 'backlog', label: 'Waiting to play' },
                  { value: 'playing', label: 'Playing now' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'dropped', label: 'Dropped' },
                ]}
              />
            </label>
            <div className="w-24 shrink-0 rounded-lg bg-panel2 px-3 py-2">
              <p className="text-muted">Rating</p>
              <p className="font-medium">{game.meta?.rating ?? '-'}</p>
            </div>
          </div>

          {/* Ownership used to be a stat of its own here, which said the same
              thing twice: a game that is not here yet is exactly a game that is
              still only planned. Said once, underneath where it matters. */}
          {game.planned && (
            <p className="text-[11px] text-muted">
              Not in the library yet. Orbit will not look for a file until it is.
            </p>
          )}

          {game.hidden && (
            <p className="text-[11px] text-muted">
              Hidden from the library. Its sessions, notes and playtime are all still here, and the Hidden chip on the
              library page is where it can be found again.
            </p>
          )}

          {backlog && (
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-panel2/40 p-2">
              {(
                [
                  ['playing', 'Move to playing now'],
                  ['backlog', 'Move to waiting'],
                  ['completed', 'Move to completed'],
                  ['dropped', 'Move to dropped'],
                ] as const
              ).map(([status, label]) => (
                <button
                  key={status}
                  onClick={() => onUpdate({ status })}
                  disabled={game.status === status}
                  className={`rounded-full border px-3 py-1 text-[11px] ${
                    game.status === status
                      ? 'border-accent bg-accent/15 text-fg'
                      : 'border-line text-muted hover:border-accent hover:text-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <TimeTracker
            game={game}
            startedAt={running && session ? session.startedAtMs : null}
            now={now}
            onSetTotal={setPlaytime}
            error={playtimeError}
          />
          {/* Not in the Backlog drawer: a game that is only being planned has
              nothing to launch, and after it is owned it stops being a plan. */}
          {!backlog && (
            <LaunchEditor
              game={game}
              onSave={(t: LaunchTarget, companions: Companion[]) => onUpdate({ launch: t, companions })}
            />
          )}
          {!backlog && (
          <div className="space-y-1.5">
            {steamAppId !== null && (
              <button
                onClick={() => void openExternal(`https://steamdb.info/app/${steamAppId}/`)}
                title="Open this game on SteamDB, which tracks prices, updates and stats"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel2 py-2 text-xs hover:border-accent"
              >
                <ExternalLink className="size-3.5" />
                Open in SteamDB
              </button>
            )}
            <button
              onClick={() => void openExternal(`https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(game.title)}`)}
              title="Fixes, save file locations and configuration on PCGamingWiki"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel2 py-2 text-xs hover:border-accent"
            >
              <ExternalLink className="size-3.5" />
              Open in PCGamingWiki
            </button>
          </div>
          )}
          <HltbCard game={game} onFetch={getHltb} loading={loadingHltb} error={hltbError} />

          <section className="rounded-xl border border-line bg-panel2 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Info className="size-4 text-accent" />
                About
                {game.meta?.source && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-normal text-muted">
                    {SOURCE_LABEL[game.meta.source] ?? game.meta.source}
                  </span>
                )}
              </h3>
              <button
                onClick={getDetails}
                disabled={loadingDetails}
                className="flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50"
                title="Look this title up again"
              >
                <RefreshCw className={`size-3.5 ${loadingDetails ? 'animate-spin' : ''}`} />
                {game.meta ? 'Refresh' : 'Fetch'}
              </button>
            </div>
            <p className="text-sm leading-relaxed text-muted">
              {game.meta?.summary || 'No details yet. Fetching works with no setup: the Steam catalogue needs no key.'}
            </p>
            {detailsError && <p className="mt-2 text-xs text-rose-400">{detailsError}</p>}
            {!!game.meta?.genres.length && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {game.meta.genres.map((g) => (
                  <span key={g} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line bg-panel2 p-4">
            {/* Where the files are is a Storage question, and the paths that used
                to be printed here were two lines of C:\\Program Files nobody
                read. What the drawer is asked is how much room the game takes. */}
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <HardDrive className="size-4 text-accent" />
              Size on drive
            </h3>
            <p className="text-sm">
              {game.sizeBytes > 0 ? (
                <b className="font-mono">{fmtBytes(game.sizeBytes)}</b>
              ) : (
                <span className="text-muted">Not measured yet</span>
              )}
              {game.drive && (
                <>
                  <span className="text-muted"> on </span>
                  <b className="font-mono text-fg">{driveLabel(game.drive)}</b>
                </>
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {game.installDir
                ? 'Storage can move this game to another drive, and measure it again.'
                : 'Orbit has no folder for this game, so it can only time it.'}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={onRemove}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-rose-400 hover:border-rose-400"
              >
                <Trash2 className="size-4" />
                Remove
              </button>
            </div>
          </section>
            </>
          )}

          {tab === 'achievements' && <AchievementsTab game={game} onUpdate={onUpdate} />}

          {tab === 'log' && (
            <GameLogView game={game} onChanged={refreshLogCount} onNotes={(notes) => onUpdate({ notes })} />
          )}

          {tab === 'edit' && <GameEditTab game={game} onUpdate={onUpdate} />}

          {tab === 'sessions' && (
            <>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Session history</h3>
                <button
                  onClick={() => setLoggingSession(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent hover:text-accent"
                >
                  <Clock className="size-3.5" />
                  Log time by hand
                </button>
              </div>
              <SessionHistory
                game={game}
                reloadKey={sessionVersion}
                onEdit={(s) => {
                  setEditingSession(s);
                  setPlaytimeError(null);
                }}
                onChanged={() => {
                  setSessionVersion((n) => n + 1);
                  onUpdate({});
                }}
              />
              <p className="px-1 text-[11px] text-muted">
                Every tracked session for this game. Edit corrects when one started or how long it ran; the
                game's total follows it.
              </p>
            </>
          )}
        </div>

        {editingSession && (
          <EditSession
            row={editingSession}
            onClose={() => setEditingSession(null)}
            onSaved={() => {
              setSessionVersion((n) => n + 1);
              onUpdate({});
              setEditingSession(null);
            }}
          />
        )}
        {loggingSession && (
          <LogSession
            games={[game]}
            initialGameId={game.id}
            onClose={() => setLoggingSession(false)}
            onSaved={() => {
              setSessionVersion((n) => n + 1);
              onUpdate({});
            }}
          />
        )}
      </aside>
    </>
  );
}
