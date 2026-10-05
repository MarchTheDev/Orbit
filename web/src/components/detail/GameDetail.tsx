import {
  Clock,
  ExternalLink,
  History,
  Info,
  MoveRight,
  NotebookPen,
  Play,
  RefreshCw,
  Square,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActiveSession, Game, GameStatus, LaunchTarget, Session, Settings } from '../../types';
import { fetchMetadata, metaCredentials } from '../../services/metadata';
import { fetchHltb } from '../../services/hltb';
import { listGameLogs } from '../../services/native';
import { fmtBytes, fmtDate } from '../../utils/format';
import { Cover } from '../ui/Cover';
import { HltbCard } from './HltbCard';
import { LaunchEditor } from './LaunchEditor';
import { SessionHistory } from './SessionHistory';
import { GameLogView } from './GameLogView';
import { EditSession, LogSession } from '../SessionsView';
import { TimeTracker } from './TimeTracker';

interface Props {
  game: Game;
  settings: Settings;
  /** The running session, if it is for this game. */
  session: ActiveSession | null;
  now: number;
  onUpdate: (patch: Partial<Game>) => void;
  /** Write the playtime the player wants to see, keeping the sessions. */
  onSetPlaytime: (totalSecs: number) => Promise<void>;
  onPlay: () => void;
  onStop: () => void;
  onMove: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Where the details on screen came from, said out loud. */
const SOURCE_LABEL: Record<string, string> = {
  steam: 'Steam catalogue',
  igdb: 'IGDB',
  estimate: 'preview',
};

export function GameDetail({
  game,
  settings,
  session,
  now,
  onUpdate,
  onSetPlaytime,
  onPlay,
  onStop,
  onMove,
  onRemove,
  onClose,
}: Props) {
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [loadingHltb, setLoadingHltb] = useState(false);
  const [hltbError, setHltbError] = useState<string | null>(null);
  const [playtimeError, setPlaytimeError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'log' | 'sessions'>('overview');
  const [logCount, setLogCount] = useState(0);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [loggingSession, setLoggingSession] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const running = session?.gameId === game.id;

  // The tab bar shows how much has been written, so the count is worth keeping.
  useEffect(() => {
    let alive = true;
    void listGameLogs(game.id).then((r) => {
      if (alive) setLogCount(r.length);
    });
    return () => {
      alive = false;
    };
  }, [game.id, tab]);

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
      onUpdate({ igdb: await fetchMetadata(game.title, metaCredentials(settings)) });
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

  const steamAppId = game.igdb?.steamAppId ?? null;
  const canRunThroughSteam = !!steamAppId && game.launch.kind === 'none';

  return (
    <>
      <div className="fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="glass drawer-in fixed inset-y-3 right-3 z-50 flex w-[460px] max-w-[calc(100vw-24px)] flex-col overflow-y-auto rounded-3xl shadow-2xl">
        <div className="relative h-44 shrink-0">
          <Cover game={game} className="size-full opacity-60 [&_span]:hidden" />
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
              <h2 className="text-xl font-bold leading-tight">{game.title}</h2>
              <p className="text-xs text-muted">
                {game.igdb?.developer ?? 'Unknown developer'}
                {game.igdb?.releaseYear ? ` · ${game.igdb.releaseYear}` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-panel/95 px-5 py-2 backdrop-blur">
          {(
            [
              ['overview', 'Overview', Info],
              ['log', 'Log', NotebookPen],
              ['sessions', 'Sessions', History],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                tab === id ? 'bg-accent/15 text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon className="size-3.5" />
              {label}
              {id === 'log' && logCount > 0 && <span className="text-[10px] text-muted">{logCount}</span>}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          <div className="flex gap-2">
            {running ? (
              <button onClick={onStop} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-500 py-2.5 font-semibold text-white hover:brightness-110">
                <Square className="size-4" fill="currentColor" strokeWidth={0} />
                Stop session
              </button>
            ) : (
              <button onClick={onPlay} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 py-2.5 font-semibold text-white shadow-lg shadow-accent/30 hover:brightness-110">
                <Play className="size-4" fill="currentColor" strokeWidth={0} />
                Play
              </button>
            )}
            <button
              onClick={() => onUpdate({ favorite: !game.favorite })}
              className="rounded-lg border border-line bg-panel2 px-3"
              title={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-label={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
              aria-pressed={game.favorite}
            >
              <Star className={`size-5 ${game.favorite ? 'text-yellow-300' : 'text-muted'}`} fill={game.favorite ? 'currentColor' : 'none'} />
            </button>
          </div>

          {tab === 'overview' && (
            <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="col-span-2 flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
              <span className="text-muted">Status</span>
              <select
                value={game.status}
                onChange={(e) => onUpdate({ status: e.target.value as GameStatus })}
                className="bg-transparent font-medium capitalize outline-none"
              >
                {['backlog', 'playing', 'completed', 'dropped'].map((s) => (
                  <option key={s} value={s} className="bg-panel">
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-lg bg-panel2 px-3 py-2">
              <p className="text-muted">Last played</p>
              <p className="font-medium">{fmtDate(game.lastPlayed)}</p>
            </div>
            <div className="rounded-lg bg-panel2 px-3 py-2">
              <p className="text-muted">Rating</p>
              <p className="font-medium">{game.igdb?.rating ?? '—'}</p>
            </div>
          </div>

          <TimeTracker
            game={game}
            startedAt={running && session ? session.startedAtMs : null}
            now={now}
            onSetTotal={setPlaytime}
            error={playtimeError}
          />
          <LaunchEditor game={game} onSave={(t: LaunchTarget) => onUpdate({ launch: t })} />
          {canRunThroughSteam && (
            <button
              onClick={() => onUpdate({ launch: { kind: 'steam', appId: steamAppId } })}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel2 py-2 text-xs hover:border-accent"
            >
              <ExternalLink className="size-3.5" />
              Found on Steam — let Orbit start it through Steam
            </button>
          )}
          <HltbCard game={game} onFetch={getHltb} loading={loadingHltb} error={hltbError} />

          <section className="rounded-xl border border-line bg-panel2 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Info className="size-4 text-accent" />
                About
                {game.igdb?.source && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-normal text-muted">
                    {SOURCE_LABEL[game.igdb.source] ?? game.igdb.source}
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
                {game.igdb ? 'Refresh' : 'Fetch'}
              </button>
            </div>
            <p className="text-sm leading-relaxed text-muted">
              {game.igdb?.summary || 'No details yet. Fetching works with no setup — the Steam catalogue needs no key.'}
            </p>
            {detailsError && <p className="mt-2 text-xs text-rose-400">{detailsError}</p>}
            {!!game.igdb?.genres.length && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {game.igdb.genres.map((g) => (
                  <span key={g} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line bg-panel2 p-4">
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <textarea
              value={game.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              rows={4}
              placeholder="Builds, quest reminders, codes…"
              className="w-full resize-y rounded-lg border border-line bg-bg/60 p-3 text-sm outline-none focus:border-accent"
            />
          </section>

          <section className="rounded-xl border border-line bg-panel2 p-4">
            <h3 className="mb-2 text-sm font-semibold">Installation</h3>
            {game.installDir ? (
              <>
                <p className="break-all font-mono text-xs text-muted">{game.installDir}</p>
                {game.exePath && <p className="mt-1 break-all font-mono text-[11px] text-muted">{game.exePath}</p>}
                <p className="mt-1 text-xs text-muted">
                  {game.sizeBytes > 0 ? `${fmtBytes(game.sizeBytes)}` : 'Size unknown'} on drive <b className="text-fg">{game.drive || '—'}</b>
                </p>
              </>
            ) : (
              <p className="text-xs text-muted">
                No folder recorded. Orbit can still time this game, but will not offer to move it.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={onMove}
                disabled={!game.installDir}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-panel py-2 text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MoveRight className="size-4" />
                Move to another folder
              </button>
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

          {tab === 'log' && <GameLogView gameId={game.id} gameTitle={game.title} />}

          {tab === 'sessions' && (
            <>
              <button
                onClick={() => setLoggingSession(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-accent hover:text-fg"
              >
                <Clock className="size-4" />
                Log time by hand
              </button>
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
