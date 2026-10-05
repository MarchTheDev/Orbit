import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, Square, X } from 'lucide-react';
import type { Game, Page, SortKey, ViewMode } from './types';
import { useLibrary } from './hooks/useLibrary';
import { useSession } from './hooks/useSession';
import { clearLibrary, isNative, setPlaytime } from './services/native';
import { onFileDrop } from './services/desktop';
import { fetchMetadata, metaCredentials } from './services/metadata';
import { fetchHltb } from './services/hltb';
import { TopNav } from './components/TopNav';
import { Hero } from './components/Hero';
import { ContinueRow } from './components/ContinueRow';
import { Toolbar, type Filter } from './components/Toolbar';
import { Logo } from './components/ui/Logo';
import { GameGrid } from './components/GameGrid';
import { GameList } from './components/GameList';
import { GameDetail } from './components/detail/GameDetail';
import { SessionsView } from './components/SessionsView';
import { BacklogView } from './components/BacklogView';
import { StorageView } from './components/StorageView';
import { AddGameModal, gameFromDropped } from './components/modals/AddGameModal';
import { ImportModal } from './components/ImportModal';
import { MoveDriveModal } from './components/modals/MoveDriveModal';
import { SettingsView } from './components/SettingsView';
import { fmtClock } from './utils/format';

/** A short message in the corner: what just happened, and whether it worked. */
interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

export default function App() {
  const { games, settings, setSettings, updateGame, addGame, addGames, removeGame, reload, resetEverything, ready } = useLibrary();
  const [page, setPage] = useState<Page>('library');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem('orbit.view') as ViewMode) || 'grid');
  const [sort, setSort] = useState<SortKey>('title');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFolder, setImportFolder] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  /** Programs dragged onto the window, waiting to be added. */
  const [droppedPaths, setDroppedPaths] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Games still being looked up, so the wait is visible rather than silent. */
  const [enriching, setEnriching] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => localStorage.setItem('orbit.view', view), [view]);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, tone }]);
    // Long enough to read, short enough not to pile up.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  /**
   * Games whose details have already been asked for.
   *
   * Without this the sweep below would ask again every time the library
   * changed, which is constantly: every patch to a game re-runs the effect.
   */
  const asked = useRef(new Set<string>());

  /**
   * Fill in the gaps in the background.
   *
   * A game that was added before Orbit knew how to look anything up, or whose
   * lookup failed while offline, gets its description, artwork and completion
   * times here. One at a time with a pause between, because HowLongToBeat
   * rate-limits a burst of searches, and one source failing never stops the
   * other: details and times are both optional.
   */
  useEffect(() => {
    if (!ready || !settings || !settings.fetchMetadata || !settings.autoFetchMetadata) return;
    const missing = games
      .filter((g) => !asked.current.has(g.id) && (!g.igdb || !g.hltb))
      .slice(0, 6);
    if (missing.length === 0) return;

    const credentials = metaCredentials(settings);
    let alive = true;
    void (async () => {
      setEnriching(missing.length);
      for (const game of missing) {
        asked.current.add(game.id);
        const wantDetails = !game.igdb;
        const wantTimes = !game.hltb;
        const [meta, hltb] = await Promise.all([
          wantDetails ? fetchMetadata(game.title, credentials).catch(() => null) : null,
          wantTimes ? fetchHltb(game.title).catch(() => null) : null,
        ]);
        if (!alive) return;
        const patch: Partial<Game> = {};
        if (meta) patch.igdb = meta;
        if (hltb) patch.hltb = hltb;
        if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        setEnriching((n) => Math.max(0, n - 1));
        await new Promise((r) => setTimeout(r, 350));
      }
      if (alive) setEnriching(0);
    })();

    return () => {
      alive = false;
    };
  }, [ready, settings, games, updateGame]);

  /**
   * Dropping a program anywhere adds it.
   *
   * This lives here rather than in the Add dialog because that is where a
   * player actually is when they drag: the library. Without it the drop did
   * nothing at all unless the dialog happened to be open.
   */
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    void onFileDrop((state) => {
      if (state.type === 'drop') {
        setDragOver(false);
        if (state.paths.length === 0) return;
        // While the Add dialog is open it is the one reading the drop, so the
        // paths go there instead of being saved behind it.
        if (showAddRef.current) {
          setDroppedPaths(state.paths);
          return;
        }
        // Dropping something runnable means "add this", so it is saved straight
        // away. Only a drop Orbit cannot make a game out of is handed to a
        // person, because that one needs a decision rather than a keystroke.
        void gameFromDropped(state.paths)
          .then((g) => {
            if (!alive) return;
            if (!g) {
              setDroppedPaths(state.paths);
              setShowAdd(true);
              toast('No program to run in that drop — pick one below.', 'error');
              return;
            }
            void handleAddRef.current?.(g, true);
            toast(`${g.title} added · details on the way`);
          })
          .catch((e: unknown) => {
            if (!alive) return;
            setDroppedPaths(state.paths);
            setShowAdd(true);
            toast(e instanceof Error ? e.message : 'That drop could not be read.', 'error');
          });
        return;
      }
      setDragOver(state.type === 'enter' || state.type === 'over');
    }).then((fn) => {
      if (alive) dispose = fn;
      else fn();
    });
    return () => {
      alive = false;
      dispose?.();
    };
  }, [toast]);

  /** A finished session changes one game's numbers, so re-read that game. */
  const onSessionEnded = useCallback(() => {
    void reload();
  }, [reload]);

  const { session, play, stop, busy, error } = useSession(onSessionEnded);

  // The clock in the tray and the detail page only tick while something runs.
  useEffect(() => {
    if (!session) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  // The game that is playing is marked, so the grid can show it at a glance.
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    const list = games.filter((g) => {
      if (q && !g.title.toLowerCase().includes(q)) return false;
      if (filter === 'favorites') return g.favorite;
      if (filter === 'unplayed') return g.sessionCount === 0;
      if (filter !== 'all') return g.status === filter;
      return true;
    });
    const by: Record<SortKey, (a: Game, b: Game) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      lastPlayed: (a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''),
      playtime: (a, b) => b.playMinutes - a.playMinutes,
      added: (a, b) => b.addedAt.localeCompare(a.addedAt),
      size: (a, b) => b.sizeBytes - a.sizeBytes,
    };
    return [...list].sort(by[sort]);
  }, [games, filter, query, sort]);

  const selected = games.find((g) => g.id === selectedId) ?? null;
  const moving = games.find((g) => g.id === moveId) ?? null;
  const runningGame = games.find((g) => g.id === session?.gameId) ?? null;

  const startGame = async (g: Game) => {
    if (session?.gameId === g.id) return;
    setSelectedId(g.id);
    const started = await play(g.id);
    if (!started) return;
    updateGame(g.id, {
      lastPlayed: new Date().toISOString(),
      status: g.status === 'backlog' ? 'playing' : g.status,
    });
  };

  /**
   * Save a new game, then let it fill itself in.
   *
   * Details and completion times are fetched separately and independently: a
   * title the store does not know still gets its HowLongToBeat time, and the
   * other way round.
   */
  const handleAdd = async (g: Game, fetchMeta: boolean) => {
    addGame(g);
    setSelectedId(g.id);
    asked.current.add(g.id);
    if (!fetchMeta || !settings) return;
    const credentials = metaCredentials(settings);
    const [meta, hltb] = await Promise.all([
      fetchMetadata(g.title, credentials).catch(() => null),
      fetchHltb(g.title).catch(() => null),
    ]);
    const patch: Partial<Game> = {};
    if (meta) patch.igdb = meta;
    if (hltb) patch.hltb = hltb;
    if (Object.keys(patch).length > 0) updateGame(g.id, patch);
  };

  // The drop listener is set up once and must not close over a stale `handleAdd`,
  // which would otherwise add a game without the current theme or settings.
  const handleAddRef = useRef(handleAdd);
  handleAddRef.current = handleAdd;

  // Whether the Add dialog is open is read from a ref for the same reason.
  const showAddRef = useRef(showAdd);
  showAddRef.current = showAdd;

  const byRecent = [...games].filter((g) => g.lastPlayed).sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
  const heroGame = runningGame ?? byRecent[0] ?? games[0];
  const continueGames = byRecent.filter((g) => g.id !== heroGame?.id && g.status !== 'completed').slice(0, 6);
  const showHome = page === 'library' && filter === 'all' && !query;

  // Nothing can be drawn until the settings have loaded, which also decides the
  // theme. Every hook above has already run, so this is safe.
  if (!settings) return <div className="h-full bg-bg" />;

  return (
    <div className="relative h-full overflow-y-auto text-fg">
      <TopNav
        page={page}
        setPage={setPage}
        theme={settings?.theme ?? 'nebula'}
        setTheme={(theme) => setSettings({ theme })}
      />

      {dragOver && !showAdd && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-base/80 backdrop-blur-sm">
          <div className="rounded-3xl border-2 border-dashed border-accent px-12 py-10 text-center">
            <Logo className="mx-auto size-16 text-accent" animated />
            <p className="mt-3 text-lg font-semibold">Drop to add</p>
            <p className="mt-1 text-sm text-muted">A game program, or a folder full of them</p>
          </div>
        </div>
      )}

      <main className="pb-24">
        {!settings ? null : page === 'settings' ? (
          <div className="glass mx-6 mt-5 rounded-3xl">
            <SettingsView
              settings={settings}
              setSettings={setSettings}
              onClearLibrary={() => {
                void clearLibrary().then(() => location.reload());
              }}
              onReset={resetEverything}
            />
          </div>
        ) : page === 'backlog' ? (
          <BacklogView
            games={games}
            onSelect={setSelectedId}
            onStatus={(id, status) => updateGame(id, { status })}
            onPlay={(g) => void startGame(g)}
          />
        ) : page === 'sessions' ? (
          <SessionsView games={games} onChanged={() => void reload()} />
        ) : page === 'storage' ? (
          <StorageView
            games={games}
            folders={settings.libraryFolders}
            setFolders={(libraryFolders) => setSettings({ libraryFolders })}
            onImport={(folder) => {
              setImportFolder(folder);
              setShowImport(true);
            }}
          />
        ) : (
          <>
            {showHome && heroGame && (
              <Hero
                game={heroGame}
                running={runningGame?.id === heroGame.id}
                onPlay={() => void startGame(heroGame)}
                onDetails={() => setSelectedId(heroGame.id)}
              />
            )}
            {showHome && <ContinueRow games={continueGames} onSelect={setSelectedId} />}
            <Toolbar
              count={visible.length}
              total={games.length}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              view={view}
              setView={setView}
              sort={sort}
              setSort={setSort}
              onAdd={() => setShowAdd(true)}
              onImport={() => {
                setImportFolder(null);
                setShowImport(true);
              }}
              importing={false}
            />
            <div>
              {!ready ? null : visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted">
                  <Logo className="size-16 opacity-50" />
                  <p>{games.length === 0 ? 'Nothing in this orbit yet.' : 'Nothing matches that.'}</p>
                  {games.length === 0 && (
                    <p className="text-xs">Drop a game program on the window, or use Add game.</p>
                  )}
                </div>
              ) : view === 'grid' ? (
                <GameGrid games={visible} selectedId={selectedId} onSelect={setSelectedId} onPlay={(g) => void startGame(g)} />
              ) : (
                <GameList games={visible} selectedId={selectedId} onSelect={setSelectedId} onPlay={(g) => void startGame(g)} />
              )}
            </div>
          </>
        )}
      </main>

      {session && runningGame && (
        <div className="glass fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-full py-2 pl-5 pr-2 text-sm shadow-2xl">
          <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
          <span>
            Playing <b>{runningGame.title}</b>
          </span>
          <span className="font-mono text-muted">{fmtClock(Math.floor((now - session.startedAtMs) / 1000))}</span>
          <button
            onClick={() => void stop()}
            className="flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-1.5 text-xs font-bold text-white"
          >
            <Square className="size-3" fill="currentColor" strokeWidth={0} />
            Stop
          </button>
        </div>
      )}

      {error && (
        <p className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-rose-500/90 px-4 py-1.5 text-xs text-white">
          {error}
        </p>
      )}
      {busy && !session && (
        <p className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-panel px-4 py-1.5 text-xs text-muted">
          Starting…
        </p>
      )}

      {enriching > 0 && (
        <p className="fixed bottom-5 left-5 z-30 flex items-center gap-2 rounded-full bg-panel/90 px-3 py-1.5 text-[11px] text-muted">
          <LoaderCircle className="size-3.5 animate-spin" />
          Looking up details for {enriching} {enriching === 1 ? 'game' : 'games'}…
        </p>
      )}

      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-72 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-xl ${
              t.tone === 'error'
                ? 'border-rose-400/40 bg-rose-500/15 text-rose-100'
                : 'border-line bg-panel/95 text-fg'
            }`}
          >
            {t.tone === 'error' ? (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
            )}
            <span className="flex-1">{t.text}</span>
            <button
              onClick={() => setToasts((current) => current.filter((x) => x.id !== t.id))}
              className="shrink-0 text-muted hover:text-fg"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      {page === 'library' && selected && (
        <GameDetail
          key={selected.id}
          game={selected}
          settings={settings}
          session={session}
          now={now}
          onUpdate={(p) => updateGame(selected.id, p)}
          onSetPlaytime={async (totalSecs) => {
            await setPlaytime(selected.id, totalSecs);
            await reload();
          }}
          onPlay={() => void startGame(selected)}
          onStop={() => void stop()}
          onMove={() => setMoveId(selected.id)}
          onRemove={() => {
            if (confirm(`Remove ${selected.title} from library? Its sessions go too.`)) {
              removeGame(selected.id);
              setSelectedId(null);
            }
          }}
          onClose={() => setSelectedId(null)}
        />
      )}

      {showAdd && (
        <AddGameModal
          initialPaths={droppedPaths}
          onClose={() => {
            setShowAdd(false);
            setDroppedPaths(null);
          }}
          onAdd={(g, fetchMeta) => void handleAdd(g, fetchMeta)}
        />
      )}
      {showImport && settings && (
        <ImportModal
          existing={games}
          initialFolder={importFolder}
          credentials={metaCredentials(settings)}
          fetchMetadata={settings.fetchMetadata}
          onAdd={addGames}
          onUpdate={(id, patch) => updateGame(id, patch)}
          onClose={() => setShowImport(false)}
        />
      )}
      {moving && settings && (
        <MoveDriveModal
          game={moving}
          folders={settings.libraryFolders}
          onClose={() => setMoveId(null)}
          onMoved={(installDir, exePath, drive) => updateGame(moving.id, { installDir, exePath, drive })}
        />
      )}

      {!isNative() && (
        <p className="pointer-events-none fixed bottom-2 left-2 rounded-full bg-panel/80 px-3 py-1 text-[10px] text-muted">
          Browser preview · run <span className="font-mono">npm run tauri dev</span> for files, launching and sessions
        </p>
      )}
    </div>
  );
}
