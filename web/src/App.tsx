import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  FolderOpen,
  Info,
  LoaderCircle,
  MoveRight,
  Pencil,
  Play,
  Square,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { Game, Page, SortKey, ViewMode } from './types';
import { useLibrary } from './hooks/useLibrary';
import { useSession } from './hooks/useSession';
import { clearLibrary, isNative, setPlaytime, steamLibrary } from './services/native';
import { onFileDrop } from './services/desktop';
import { revealInExplorer } from './services/native';
import { fetchMetadata } from './services/metadata';
import { fetchHltb } from './services/hltb';
import { TopNav } from './components/TopNav';
import { ContextMenu, type MenuItem } from './components/ui/ContextMenu';
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
import { LogsView } from './components/LogsView';
import { SteamImportModal, gameFromSteam } from './components/SteamImportModal';
import { AddGameModal, gameFromDropped } from './components/modals/AddGameModal';
import { ImportModal } from './components/ImportModal';
import { MoveDriveModal } from './components/modals/MoveDriveModal';
import { SettingsView } from './components/SettingsView';
import { fmtClock } from './utils/format';
import { moveInOrder } from './utils/reorder';
import { onDisk } from './utils/library';
import { onToast } from './utils/toast';

/** A short message in the corner: what just happened, and whether it worked. */
interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

export default function App() {
  const {
    games,
    settings,
    setSettings,
    updateGame,
    addGame,
    addGames,
    removeGame,
    reload,
    flush,
    resetEverything,
    ready,
  } = useLibrary();
  const [page, setPage] = useState<Page>('library');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem('orbit.view') as ViewMode) || 'grid');
  const [sort, setSort] = useState<SortKey>('title');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSteam, setShowSteam] = useState(false);
  const [importFolder, setImportFolder] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  /** Where the right-click menu is, and which game it is about. */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /** Which tab the drawer should open on, and a counter that forces a reopen. */
  const [detailTab, setDetailTab] = useState<'overview' | 'edit'>('overview');
  const [detailNonce, setDetailNonce] = useState(0);
  const [now, setNow] = useState(Date.now());
  /** Programs dragged onto the window, waiting to be added. */
  const [droppedPaths, setDroppedPaths] = useState<string[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Games still being looked up, so the wait is visible rather than silent. */
  const [enriching, setEnriching] = useState(0);
  /**
   * The player's own order for the library, and how big the covers are drawn.
   *
   * Both live in the settings, which are written to disk, so an arrangement
   * someone made is still there tomorrow and survives a cleared browser profile.
   */
  const order = settings?.sortOrder ?? [];
  const scale = settings?.coverScale ?? 100;
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => localStorage.setItem('orbit.view', view), [view]);

  // Toasts come from a one-line channel rather than a callback threaded through
  // every layer, so a button several components down can still say "saved".

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, tone }]);
    // Long enough to read, short enough not to pile up.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  // Anything anywhere can say something: `toast` is the one that draws, and
  // `say` only passes the message along. Registering `say` here instead made it
  // call itself, which is why nothing ever appeared.
  useEffect(() => onToast(toast), [toast]);

  /**
   * Games whose details have already been asked for.
   *
   * Without this the sweep below would ask again every time the library
   * changed, which is constantly: every patch to a game re-runs the effect.
   */
  const asked = useRef(new Set<string>());

  /** True for a game still carrying the store's wide banner as its cover. */
  const artIsWide = (g: Game) => !!g.meta?.steamAppId && !g.meta.coverUrl?.includes('library_600x900');

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
      .filter(
        (g) =>
          !asked.current.has(g.id) &&
          // A game whose details were corrected by hand is left exactly as it
          // was: the lookup would use the store's idea of the title and put
          // back what the player just took out.
          !g.meta?.edited &&
          (!g.meta || !g.hltb || artIsWide(g)),
      )
      .slice(0, 6);
    if (missing.length === 0) return;

    let alive = true;
    void (async () => {
      setEnriching(missing.length);
      for (const game of missing) {
        asked.current.add(game.id);
        // Artwork fetched before Orbit asked for the portrait picture is worth
        // asking for again: the wide banner was being cropped into a tall tile.
        const wantDetails = !game.meta || artIsWide(game);
        const wantTimes = !game.hltb;
        const [meta, hltb] = await Promise.all([
          wantDetails ? fetchMetadata(game.title).catch(() => null) : null,
          wantTimes ? fetchHltb(game.title).catch(() => null) : null,
        ]);
        if (!alive) return;
        const patch: Partial<Game> = {};
        if (meta) patch.meta = meta;
        if (hltb) patch.hltb = hltb;
        if (Object.keys(patch).length > 0) updateGame(game.id, patch, 'auto');
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
              toast('No program to run in that drop. Pick one below.', 'error');
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

  /**
   * Bring in Steam games that are installed but missing, at launch.
   *
   * Off unless the player turns it on, and even then it only ever adds: nothing
   * already in the library is touched, and a game the player removed from Orbit
   * while it is still installed on Steam comes back, which is the whole point of
   * the switch. Runs once per launch, after the library has been read.
   */
  const steamChecked = useRef(false);
  useEffect(() => {
    if (!ready || !settings?.steamOnLaunch || steamChecked.current) return;
    steamChecked.current = true;
    void (async () => {
      const found = await steamLibrary().catch(() => []);
      if (found.length === 0) return;
      const byId = new Set(games.filter((g) => g.meta?.steamAppId).map((g) => g.meta!.steamAppId));
      const byTitle = new Set(games.map((g) => g.title.trim().toLowerCase()));
      const fresh = found.filter((s) => !byId.has(s.appId) && !byTitle.has(s.name.trim().toLowerCase()));
      if (fresh.length === 0) return;
      const added: Game[] = fresh.map(gameFromSteam);
      addGames(added);
      toast(`${added.length} Steam ${added.length === 1 ? 'game' : 'games'} added`);
      for (const g of added) {
        const meta = await fetchMetadata(g.title, g.meta?.steamAppId ?? undefined).catch(() => null);
        if (meta) updateGame(g.id, { meta, title: meta.name || g.title }, 'auto');
      }
    })();
  }, [ready, settings?.steamOnLaunch, games, addGames, updateGame, toast]);

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

  /**
   * The library as it should be read, with the running session added on.
   *
   * The database only has the total of the sessions that have finished, so a
   * game being played right now would sit at yesterday's number until it was
   * stopped. Every total on the page is drawn from this instead, which is what
   * makes the playtime climb while the game is running rather than jumping when
   * it ends.
   */
  const liveSecs = session ? Math.max(0, Math.floor((now - session.startedAtMs) / 1000)) : 0;
  const played = useMemo(
    () =>
      session && liveSecs > 0
        ? games.map((g) => (g.id === session.gameId ? { ...g, playSecs: g.playSecs + liveSecs } : g))
        : games,
    [games, session, liveSecs],
  );

  // The game that is playing is marked, so the grid can show it at a glance.
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    const list = played.filter((g) => {
      // A game that is only written down lives on the Backlog page: it is a plan,
      // not something in the library, and seeing it here as well would make it
      // look installed. The same goes for a game that is owned but not installed
      // anywhere yet: marking one as owned in the Backlog keeps it a plan until
      // it has a folder.
      if (g.planned || !onDisk(g)) return false;
      if (q && !g.title.toLowerCase().includes(q)) return false;
      if (filter === 'favorites') return g.favorite;
      if (filter === 'unplayed') return g.sessionCount === 0;
      if (filter !== 'all') return g.status === filter;
      return true;
    });
    const by: Record<SortKey, (a: Game, b: Game) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      lastPlayed: (a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''),
      playtime: (a, b) => b.playSecs - a.playSecs,
      added: (a, b) => b.addedAt.localeCompare(a.addedAt),
      size: (a, b) => b.sizeBytes - a.sizeBytes,
      // Ids the player has arranged come first, in that arrangement; anything
      // new waits at the end rather than landing in the middle of the pile.
      manual: (a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      },
    };
    return [...list].sort(by[sort]);
  }, [played, filter, query, sort, order]);

  /**
   * Move a game to where another one is, dragging one card onto another.
   *
   * The whole order is written out rather than a swap, so the list the player
   * sees is exactly what is stored and a game that was never dragged still has
   * a place in it.
   */
  const reorder = useCallback(
    (fromId: string, toId: string, after: boolean) => {
      // Dropped on the lower half of a card it goes below it, on the upper half
      // above: dragging downwards has to be able to overtake, not just nudge.
      const ids = moveInOrder(
        visible.map((g) => g.id),
        fromId,
        toId,
        after,
      );
      // Anything outside the current filter keeps whatever position it had.
      setSettings({ sortOrder: [...ids, ...order.filter((id) => !ids.includes(id))] });
    },
    [visible, order, setSettings],
  );

  /** Open the drawer on a particular tab, wherever it is already. */
  const openDetail = (id: string, tab: 'overview' | 'edit' = 'overview') => {
    setDetailTab(tab);
    setDetailNonce((n) => n + 1);
    setSelectedId(id);
  };

  /**
   * What can be done to a game from the library, without opening it.
   *
   * Built here rather than in the grid or the list, because these are the app's
   * own actions: the two views only know how to report a right click.
   */
  const menuGame = menu ? (games.find((g) => g.id === menu.id) ?? null) : null;
  const menuItems: MenuItem[] = menuGame
    ? [
        { kind: 'label', label: menuGame.title },
        { label: 'Open details', icon: Info, onSelect: () => openDetail(menuGame.id) },
        { label: 'Edit details', icon: Pencil, onSelect: () => openDetail(menuGame.id, 'edit') },
        { kind: 'sep' },
        menuGame.running || session?.gameId === menuGame.id
          ? {
              label: 'Stop session',
              icon: Square,
              onSelect: () => void stop(),
            }
          : {
              label: 'Play',
              icon: Play,
              onSelect: () => void startGame(menuGame),
            },
        {
          label: menuGame.favorite ? 'Remove from favorites' : 'Add to favorites',
          icon: Star,
          onSelect: () => updateGame(menuGame.id, { favorite: !menuGame.favorite }),
        },
        { kind: 'sep' },
        {
          label: 'Move to another folder…',
          icon: MoveRight,
          disabled: !menuGame.installDir,
          onSelect: () => setMoveId(menuGame.id),
        },
        {
          label: 'Show in Explorer',
          icon: FolderOpen,
          disabled: !menuGame.installDir,
          onSelect: () => void revealInExplorer(menuGame.installDir ?? ''),
        },
        { kind: 'sep' },
        {
          label: 'Remove from library',
          icon: Trash2,
          danger: true,
          onSelect: () => {
            if (!confirm(`Remove ${menuGame.title} from library? Its sessions go too.`)) return;
            removeGame(menuGame.id);
            setSelectedId((current) => (current === menuGame.id ? null : current));
          },
        },
      ]
    : [];

  const selected = games.find((g) => g.id === selectedId) ?? null;
  const moving = games.find((g) => g.id === moveId) ?? null;
  // The drawer draws its own live clock, so it gets the stored numbers rather
  // than these, and nothing is counted twice.
  const runningGame = played.find((g) => g.id === session?.gameId) ?? null;

  const startGame = async (g: Game) => {
    if (session?.gameId === g.id) return;
    setSelectedId(g.id);
    // Whatever was just changed about how this game starts has to be on disk
    // before the session reads it back, or a launch setting changed a second ago
    // is ignored and something the player turned off still starts.
    await flush();
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
    const [meta, hltb] = await Promise.all([
      fetchMetadata(g.title, g.meta?.steamAppId ?? undefined).catch(() => null),
      fetchHltb(g.title).catch(() => null),
    ]);
    const patch: Partial<Game> = {};
    if (meta) patch.meta = meta;
    if (hltb) patch.hltb = hltb;
    if (Object.keys(patch).length > 0) updateGame(g.id, patch, 'auto');
  };

  // The drop listener is set up once and must not close over a stale `handleAdd`,
  // which would otherwise add a game without the current theme or settings.
  const handleAddRef = useRef(handleAdd);
  handleAddRef.current = handleAdd;

  // Whether the Add dialog is open is read from a ref for the same reason.
  const showAddRef = useRef(showAdd);
  showAddRef.current = showAdd;

  const byRecent = [...played]
    .filter((g) => g.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
  // A game that is only written down is not the thing to jump back into: there
  // is nothing to jump into.
  const heroGame = runningGame ?? byRecent[0] ?? played.find((g) => !g.planned) ?? null;
  const continueGames = byRecent.filter((g) => g.id !== heroGame?.id && g.status !== 'completed').slice(0, 6);
  // The hero stays on screen while the category chips are used. That is the
  // point of it being "jump back in" rather than a summary of the current
  // filter. Only a search takes it away, because then the player is looking for
  // one particular game.
  const showHome = page === 'library' && !query;

  // Nothing can be drawn until the settings have loaded, which also decides the
  // theme. Every hook above has already run, so this is safe.
  if (!settings) return <div className="h-full bg-bg" />;

  return (
    <div className="relative h-full overflow-y-auto text-fg">
      <TopNav page={page} setPage={setPage} order={settings?.tabOrder} />

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
              onImportSteam={() => setShowSteam(true)}
              onClearLibrary={() => {
                void clearLibrary().then(() => location.reload());
              }}
              onReset={resetEverything}
            />
          </div>
        ) : page === 'backlog' ? (
          <BacklogView
            games={played}
            onSelect={setSelectedId}
            onStatus={(id, status) => updateGame(id, { status })}
            onAdd={(game) => addGames([game])}
            onUpdate={(id, patch) => updateGame(id, patch)}
            onRemove={(id) => removeGame(id)}
            fetchMetadata={settings.fetchMetadata}
            myOrder={settings.backlogOrder}
            setMyOrder={(ids) => setSettings({ backlogOrder: ids })}
          />
        ) : page === 'sessions' ? (
          <SessionsView games={games} onChanged={() => void reload()} />
        ) : page === 'logs' ? (
          <LogsView
            games={games}
            onUpdate={(id, patch) => updateGame(id, patch)}
            // The Journal is read for the game being written about, so it can be
            // arranged in whatever order that reading wants.
            order={settings.logOrder ?? []}
            onOrder={(ids) => setSettings({ logOrder: ids })}
          />
        ) : page === 'storage' ? (
          <StorageView
            // Storage is about files, so it counts only the games that have some.
            games={games.filter(onDisk)}
            folders={settings.libraryFolders}
            setFolders={(libraryFolders) => setSettings({ libraryFolders })}
            onMove={setMoveId}
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
              scale={scale}
              setScale={(n) => setSettings({ coverScale: n })}
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
                <GameGrid
                  games={visible}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onPlay={(g) => void startGame(g)}
                  scale={scale}
                  onReorder={sort === 'manual' ? reorder : undefined}
                  coverTint={settings.coverTint !== false}
                  onContextMenu={(g, e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, id: g.id });
                  }}
                />
              ) : (
                <GameList
                  games={visible}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onPlay={(g) => void startGame(g)}
                  scale={scale}
                  onReorder={sort === 'manual' ? reorder : undefined}
                  onContextMenu={(g, e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, id: g.id });
                  }}
                />
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
        <p className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-panel/90 px-3 py-1.5 text-[11px] text-muted">
          <LoaderCircle className="size-3.5 animate-spin" />
          Looking up details for {enriching} {enriching === 1 ? 'game' : 'games'}…
        </p>
      )}

      {/* Bottom left, the way the app talks to the player: out of the way of the
          player bar in the middle and the Stop button at the top right. */}
      <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex w-80 flex-col gap-2">
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

      {selected && (
        <GameDetail
          key={`${selected.id}:${detailNonce}`}
          game={selected}
          initialTab={detailTab}
          // The same drawer, read two ways: from the Backlog it is a page about
          // deciding what to play, with nothing in it that starts anything.
          context={page === 'backlog' ? 'backlog' : 'library'}
          session={session}
          now={now}
          onUpdate={(p) => updateGame(selected.id, p)}
          onSetPlaytime={async (totalSecs) => {
            await setPlaytime(selected.id, totalSecs);
            await reload();
          }}
          onPlay={() => void startGame(selected)}
          onStop={() => void stop()}
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
          fetchMetadata={settings.fetchMetadata}
          onAdd={addGames}
          onUpdate={(id, patch) => updateGame(id, patch)}
          onClose={() => setShowImport(false)}
        />
      )}
      {showSteam && settings && (
        <SteamImportModal
          existing={games}
          fetchMeta={settings.fetchMetadata}
          onAdd={addGames}
          onUpdate={(id, patch) => updateGame(id, patch)}
          onRemoveSteam={() => {
            const ids = games
              .filter((g) => g.launch.kind === 'steam' || g.meta?.steamAppId)
              .map((g) => g.id);
            if (ids.length === 0) return;
            if (
              !confirm(
                `Remove ${ids.length} Steam ${ids.length === 1 ? 'game' : 'games'} from Orbit? Their sessions and notes go too. Nothing on disk is touched.`,
              )
            ) {
              return;
            }
            for (const id of ids) removeGame(id);
            if (selectedId && ids.includes(selectedId)) setSelectedId(null);
            toast(`Removed ${ids.length} ${ids.length === 1 ? 'game' : 'games'} that came from Steam`);
          }}
          onClose={() => setShowSteam(false)}
        />
      )}
      {menu && menuGame && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
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
