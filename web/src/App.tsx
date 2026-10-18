import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
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
import type { Game, LauncherGame, OtherLauncher, Page, Settings, SortKey, ViewMode } from './types';
import { useLibrary } from './hooks/useLibrary';
import { useSession } from './hooks/useSession';
import { useGamepad } from './hooks/useGamepad';
import {
  backupSave,
  sendCloudAfterBackup,
  currentCloudTransfer,
  cloudTransferActive,
  watchCloudTransfer,
  quitDespiteCloud,
  type CloudPulse,
  clearLibrary,
  savePlaceOf,
  isNative,
  launcherGames,
  onOpenExeRequested,
  saveHintsOf,
  setPlaytime,
  steamLibrary,
  takeOpenExePaths,
  windowReady,
  overlayConfigure,
  overlayFps,
  overlayPlaying,
  overlayReadyNotice,
  overlayQuality,
  overlayShowPins,
} from './services/native';
import { onFileDrop } from './services/desktop';
import { ambient } from './services/ambient';
import { desktopOs } from './utils/platform';
import { revealInExplorer } from './services/native';
import { fetchMetadata } from './services/metadata';
import { fetchHltb } from './services/hltb';
import { TopNav, orderedTabs } from './components/TopNav';
import { ContextMenu, type MenuItem } from './components/ui/ContextMenu';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { Hero } from './components/Hero';
import { Toolbar, type Filter } from './components/Toolbar';
import { Logo } from './components/ui/Logo';
import { GameGrid } from './components/GameGrid';
import { GameList } from './components/GameList';
import { GameDetail } from './components/detail/GameDetail';
import { SavesView } from './components/SavesView';
import { GameEditDialog } from './components/detail/GameEditDialog';
import { SessionsView } from './components/SessionsView';
import { BacklogView } from './components/BacklogView';
import { StorageView } from './components/StorageView';
import { LogsView } from './components/LogsView';
import { SteamImportModal, gameFromSteam } from './components/SteamImportModal';
import { OtherLauncherImportModal } from './components/OtherLauncherImportModal';
import { AddGameModal } from './components/modals/AddGameModal';
import { ImportModal } from './components/ImportModal';
import { MoveDriveModal } from './components/modals/MoveDriveModal';
import { MoveProgressOrb } from './components/MoveProgressOrb';
import { CloudTransferOrb } from './components/CloudTransferOrb';
import { useGameMove } from './hooks/useGameMove';
import { SettingsView } from './components/SettingsView';
import { Startup } from './components/Startup';
import { fmtClock } from './utils/format';
import { moveInOrder } from './utils/reorder';
import { inLibraryShelf, onDisk } from './utils/library';
import { gameFromLauncher, newLauncherGames } from './utils/launcherGame';
import { announce, onToast, say, type ToastMessage } from './utils/toast';
import { APP_VERSION } from './version';
import { checkForUpdate, type ReleaseInfo } from './services/updates';
import { openExternal } from './services/desktop';
import { listen } from '@tauri-apps/api/event';

/** A short message in the corner: what just happened, and whether it worked. */
interface Toast extends ToastMessage {
  id: number;
}

function FilledStar({ className }: { className?: string }) {
  return <Star className={className} fill="currentColor" strokeWidth={0} />;
}

export default function App() {
  const {
    games,
    settings,
    setSettings,
    updateGame,
    adoptNotes,
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
  /** Bumped when the pad asks the open details drawer to close, so it can slide out first. */
  const [detailClose, setDetailClose] = useState(0);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editingHideLaunchSettings, setEditingHideLaunchSettings] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removeSteamConfirm, setRemoveSteamConfirm] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  /** Whether the opening has finished and taken itself off the screen. */
  const [booted, setBooted] = useState(false);
  /** A settings section to reveal after navigation, with a token for repeated jumps. */
  const [settingsJump, setSettingsJump] = useState<{ id: string; token: number } | null>(null);
  const settingsJumpToken = useRef(0);
  const windowRevealScheduled = useRef(false);
  const windowRevealDone = useRef(false);
  const [showImport, setShowImport] = useState(false);
  const [showSteam, setShowSteam] = useState(false);
  const [showOtherLaunchers, setShowOtherLaunchers] = useState<OtherLauncher | null>(null);
  const [importFolder, setImportFolder] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  // The move lives here rather than in the dialog that starts it, so the dialog
  // can be put away and a large game can carry on copying while the library is
  // being used. The ring in the corner is the visible half of this.
  const move = useGameMove((gameId, paths) => updateGame(gameId, paths));
  /** Where the right-click menu is, which game it is about, and whether moves are disabled. */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; readOnlyMoves?: boolean } | null>(null);
  const [detailReadOnlyMoves, setDetailReadOnlyMoves] = useState(false);
  /** Forces the details drawer to reopen when its current game is requested again. */
  const [detailNonce, setDetailNonce] = useState(0);
  const [now, setNow] = useState(Date.now());
  /**
   * Whether this window is the one in front.
   *
   * A game taking focus is the usual reason it is not. The decorative loops
   * stop then — the same way the music bars already do — so the webview has
   * nothing left to repaint and can hand the CPU and GPU back to the game.
   */
  const [focused, setFocused] = useState(true);
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
  const [cloudClose, setCloudClose] = useState<'backup' | 'restore' | null>(null);
  const [cloudJob, setCloudJob] = useState<CloudPulse | null>(null);
  /** The newer release, if one has been found. Settings shows and installs it. */
  const [update, setUpdate] = useState<ReleaseInfo | null>(null);

  useEffect(() => localStorage.setItem('orbit.view', view), [view]);

  useEffect(() => {
    if (!isNative()) return;
    // Do not listen with onCloseRequested. That makes every close wait for the
    // page, and finishing the close needs a permission this app does not have,
    // so the window then cannot be closed at all.
    let stopAsk = () => {};
    let stopPulse = () => {};
    let stopOverlayNote = () => {};
    let stopOverlaySettings = () => {};
    let stopNotes = () => {};
    void listen<{ gameId?: string; notes?: string }>('playthrough-notes', (event) => {
      const gameId = event.payload?.gameId;
      if (gameId && typeof event.payload.notes === 'string') adoptNotes(gameId, event.payload.notes);
    }).then((unlisten) => {
      stopNotes = unlisten;
    }).catch(() => undefined);
    void listen<Partial<NonNullable<Settings['overlay']>>>('overlay-settings', (event) => {
      setSettings((current) => ({ overlay: { ...current.overlay, ...event.payload } }));
    }).then((unlisten) => {
      stopOverlaySettings = unlisten;
    }).catch(() => undefined);
    void listen<string>('overlay-toast', (event) => {
      if (event.payload) say(event.payload);
    }).then((unlisten) => {
      stopOverlayNote = unlisten;
    }).catch(() => undefined);
    void listen('cloud-transfer-close', () => {
      setCloudClose(currentCloudTransfer() ?? 'backup');
    }).then((unlisten) => {
      stopAsk = unlisten;
    }).catch(() => undefined);
    void listen<CloudPulse>('cloud-transfer', (event) => {
      if (!cloudTransferActive()) return;
      setCloudJob(event.payload);
    }).then((unlisten) => {
      stopPulse = unlisten;
    }).catch(() => undefined);
    const stopWatch = watchCloudTransfer(setCloudJob);
    return () => {
      stopAsk();
      stopPulse();
      stopOverlayNote();
      stopOverlaySettings();
      stopNotes();
      stopWatch();
    };
  }, []);

  const receiveOpenExePaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setDroppedPaths(paths);
    setShowAdd(true);
  }, []);

  // The first launch reads its command line once; later Explorer invocations
  // are delivered by the single-instance bridge. Subscribe before draining the
  // initial queue so a request cannot slip between the two.
  useEffect(() => {
    if (!isNative()) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    const drainOpenExeQueue = () => {
      void takeOpenExePaths().then((paths) => {
        if (alive) receiveOpenExePaths(paths);
      }).catch((error) => console.warn('Could not read an Explorer request', error));
    };

    void (async () => {
      try {
        const unlisten = await onOpenExeRequested(drainOpenExeQueue);
        if (!alive) {
          unlisten();
          return;
        }
        dispose = unlisten;
        receiveOpenExePaths(await takeOpenExePaths());
      } catch (error) {
        console.warn('Could not listen for Explorer requests', error);
      }
    })();

    return () => {
      alive = false;
      dispose?.();
    };
  }, [receiveOpenExePaths]);

  // Linux takes long enough to map a hidden window that the opening has
  // already finished by the time the usual reveal runs. Ask for the window as
  // soon as this page exists, and let the opening wait until it is actually up.
  useEffect(() => {
    if (!isNative() || desktopOs() !== 'linux' || windowRevealDone.current) return;
    // Two frames, so the opening mark has actually been painted before the
    // window is mapped. Showing the empty first frame is what made the logo
    // look as if it was still loading.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        windowRevealDone.current = true;
        windowRevealScheduled.current = true;
        void windowReady();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  // Tauri keeps the window hidden until the app has loaded its saved theme and
  // painted the opening screen. Showing it on the first React frame exposed the
  // unthemed shell for a moment before the animation covered it.
  useEffect(() => {
    if (!settings || windowRevealDone.current || windowRevealScheduled.current) return;
    windowRevealScheduled.current = true;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        windowRevealDone.current = true;
        void windowReady();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (!windowRevealDone.current) windowRevealScheduled.current = false;
    };
  }, [settings]);

  // Toasts come from a one-line channel rather than a callback threaded through
  // every layer, so a button several components down can still say "saved".

  const toast = useCallback((message: ToastMessage) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...message, id }]);
    // Long enough to read, short enough not to pile up. A toast with buttons is
    // asking something, so it waits for the answer.
    if (!message.actions?.length && !message.sticky) {
      // A short note should not sit as long as a long one.
      const stay = Math.min(7000, Math.max(2600, 1800 + (message.text.length + (message.detail?.length ?? 0)) * 24));
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), stay);
    }
  }, []);

  // Anything anywhere can say something: `toast` is the one that draws, and
  // `say` only passes the message along. Registering `say` here instead made it
  // call itself, which is why nothing ever appeared.
  useEffect(() => onToast(toast), [toast]);

  /**
   * Look for a newer version, once, a moment after the app opens.
   *
   * A few seconds late on purpose: the library, the covers and the session
   * clock all matter more than this does, and a check that fails quietly (being
   * offline is not news) should never be the reason the app feels slow.
   */
  useEffect(() => {
    if (!ready || settings?.updateCheck === false) return;
    let alive = true;
    const timer = setTimeout(() => {
      void checkForUpdate(undefined, settings?.updatePrerelease === true).then((found) => {
        if (!alive || !found) return;
        setUpdate(found);
        // A question rather than a note: it stays until it is answered, and one
        // of the answers is "not now".
        announce({
          text: `Orbit ${found.version} is out. This is ${APP_VERSION}.`,
          sticky: true,
          actions: [
            {
              label: 'Go to settings',
              onSelect: () => openSettings('orbit-updates'),
            },
            { label: 'Release notes', onSelect: () => void openExternal(found.url) },
            { label: 'Later', onSelect: () => undefined },
          ],
        });
      });
    }, 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, settings?.updateCheck, settings?.updatePrerelease]);

  /**
   * The background sound, which plays unless somebody has asked it not to.
   *
   * Starting it is all this does. A webview that has not been touched yet
   * refuses to play audio, so `start` quietly waits for the first click and
   * begins then, and nothing here has to know about that.
   */
  useEffect(() => {
    const sound = settings?.sound;
    if (sound?.enabled === false) {
      ambient.stop();
      return;
    }
    // A library with no sound settings at all is the usual case, and it means
    // "nobody has said anything", not "somebody said no".
    ambient.start(sound?.volume ?? 0.35, sound?.file || null);
    ambient.setFocused(document.hasFocus(), sound?.unfocused === true);
  }, [settings?.sound?.enabled, settings?.sound?.volume, settings?.sound?.unfocused, settings?.sound?.file]);

  /**
   * Stop the decorative loops whenever something else has the window.
   *
   * The logo, the stars and the now-playing dot are transforms and opacity, so
   * they look cheap, but each one asks Chromium to keep producing frames for as
   * long as it runs. A game in front is exactly when that budget is wanted
   * elsewhere. Coming back is instant: nothing was moved, only paused.
   */
  useEffect(() => {
    // Linux WebKit reports a blur before the window has ever been focused.
    // Honouring that leaves the mark still for the whole session. A blur only
    // counts after a real focus, which is also when a game has taken the window.
    const linux = /linux|x11/i.test(navigator.userAgent);
    let sawFocus = !linux && document.hasFocus();
    const sync = () => {
      const next = document.hasFocus() && !document.hidden;
      if (linux && !sawFocus) {
        if (next) sawFocus = true;
        else return;
      }
      setFocused(document.hasFocus() && !document.hidden);
    };
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  /**
   * Whether the window is being looked at, so the music can step aside.
   *
   * The listener is what makes the setting mean something while the app is
   * open: click away to a game and the music sinks under it, click back and it
   * returns.
   */
  useEffect(() => {
    if (settings?.sound?.enabled === false) return;
    const look = () => ambient.setFocused(document.hasFocus(), settings?.sound?.unfocused === true);
    window.addEventListener('focus', look);
    window.addEventListener('blur', look);
    return () => {
      window.removeEventListener('focus', look);
      window.removeEventListener('blur', look);
    };
  }, [settings?.sound?.enabled, settings?.sound?.unfocused]);

  /**
   * Games whose details have already been asked for.
   *
   * Without this the sweep below would ask again every time the library
   * changed, which is constantly: every patch to a game re-runs the effect.
   */
  const asked = useRef(new Set<string>());

  /** True for a game still carrying the store's wide banner as its cover. */
  const artIsWide = (g: Game) => {
    if (!g.meta?.steamAppId) return false;
    const cover = g.meta.coverUrl ?? '';
    if (cover.includes('library_600x900')) return false;
    // A portrait from another catalogue is already the tile shape. Treating it
    // as the old wide banner would ask for artwork again on every launch.
    if (cover.includes('steamgriddb.com') || cover.includes('images.igdb.com')) return false;
    return true;
  };

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
    if (!ready || !settings || !settings.fetchMetadata || !settings.autoFetchMetadata) {
      setEnriching(0);
      return;
    }
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
    if (missing.length === 0) {
      setEnriching(0);
      return;
    }

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
      // A changed or removed game invalidates this batch. Its requests may still
      // finish, but they no longer own the progress indicator.
      setEnriching(0);
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
        // A drop opens the Add dialog rather than saving behind it. A game
        // dragged in is usually named after its file, and the dialog is where
        // the store's name, author and cover are put in front of the player
        // before anything is added.
        setDroppedPaths(state.paths);
        setShowAdd(true);
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
      const found = await steamLibrary(settings.steamPath ? [settings.steamPath] : undefined).catch(() => []);
      if (found.length === 0) return;
      const byId = new Set(games.filter((g) => g.meta?.steamAppId).map((g) => g.meta!.steamAppId));
      const byTitle = new Set(games.map((g) => g.title.trim().toLowerCase()));
      const fresh = found.filter((s) => !byId.has(s.appId) && !byTitle.has(s.name.trim().toLowerCase()));
      if (fresh.length === 0) return;
      // These come off the Steam library itself, so they are games on this PC
      // and belong on the shelf. `map` would hand the index in as the second
      // argument, which is the flag that says "planned", so it is spelled out.
      const added: Game[] = fresh.map((g) => gameFromSteam(g));
      addGames(added);
      toast({ text: `${added.length} Steam ${added.length === 1 ? 'game' : 'games'} added` });
      for (const g of added) {
        const meta = await fetchMetadata(g.title, g.meta?.steamAppId ?? undefined).catch(() => null);
        if (meta) updateGame(g.id, { meta, title: meta.name || g.title }, 'auto');
      }
    })();
  }, [ready, settings?.steamOnLaunch, games, addGames, updateGame, toast]);

  /** Rescan only the non-Steam libraries the player enabled, once per launch. */
  const otherLaunchersChecked = useRef(false);
  useEffect(() => {
    if (!ready || !settings || otherLaunchersChecked.current) return;
    otherLaunchersChecked.current = true;
    const enabled = settings.launcherScanOnLaunch ?? [];
    if (!isNative() || enabled.length === 0) return;

    void (async () => {
      const found: LauncherGame[] = [];
      // Keep the local checks sequential: launchers are just read-only records,
      // and there is no need to start several scans at once.
      for (const launcher of enabled) {
        found.push(...(await launcherGames(launcher).catch(() => [])));
      }
      const fresh = newLauncherGames(found, games);
      if (fresh.length === 0) return;
      const added = fresh.map(gameFromLauncher);
      addGames(added);
      toast({ text: `${added.length} ${added.length === 1 ? 'game' : 'games'} added from your launcher libraries` });
    })().catch(() => undefined);
  }, [ready]);

  /**
   * A finished session changes one game's numbers, so re-read that game. If the
   * player asked for an automatic copy, take it now, while the files are the
   * ones the session just wrote.
   */
  const onSessionEnded = useCallback((gameId: string) => {
    void reload();
    if (!settings?.saves?.auto?.includes(gameId)) return;
    const game = games.find((item) => item.id === gameId);
    if (!game) return;
    void backupSave(game.id, game.title, settings.saves?.dirs?.[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings))
      .then(() => {
        toast({ text: `Backed up ${game.title}` });
        return sendCloudAfterBackup(settings.saves, settings.saves?.backupRoot, [
          { id: game.id, title: game.title, publisher: game.meta?.developer ?? null },
        ]).catch((e) => {
          toast({ text: `The copy is on this PC. The cloud did not take it. ${String(e).replace(/^Error:\s*/, '')}`, tone: 'error' });
        });
      })
      .catch((e) => toast({ text: String(e).replace(/^Error:\s*/, ''), tone: 'error' }));
  }, [reload, settings, games, toast]);

  const { session, play, stop, busy, notice, error } = useSession(onSessionEnded);

  // A controller moves the real focus. It only polls after one is connected.
  useGamepad();

  useEffect(() => {
    if (!isNative() || !settings) return;
    const overlay = settings.overlay;
    void overlayConfigure({
      enabled: overlay?.enabled !== false,
      replay: overlay?.replay !== false,
      seconds: overlay?.seconds ?? 30,
      lengths: overlay?.lengths ?? [],
      quality: overlayQuality(overlay?.quality),
      fps: overlayFps(overlay?.fps),
      ffmpeg: overlay?.ffmpeg ?? '',
      screenshotDirectory: overlay?.screenshotDirectory ?? '',
      recordingDirectory: overlay?.recordingDirectory ?? '',
      replayDirectory: overlay?.replayDirectory ?? '',
    });
  }, [settings]);

  const pinsShown = useRef(false);
  useEffect(() => {
    if (!booted || !isNative() || !settings) return;
    if (settings.overlay?.enabled === false) {
      pinsShown.current = false;
      return;
    }
    if (pinsShown.current) return;
    pinsShown.current = true;
    const layout = settings.overlay?.layout;
    if (layout && Object.values(layout).some((box) => box?.pinned)) void overlayShowPins();
  }, [booted, settings]);

  useEffect(() => {
    if (!isNative() || !session || session.manual) return;
    void overlayPlaying(session.gameTitle);
  }, [session]);

  // Linux WebKit keeps blurring and spinning forever if we leave those styles
  // on, and the cost grows the longer the window is open. The class is the
  // switch that turns them off. The window also starts treated as focused
  // until a real blur, because WebKit often reports the opposite at startup
  // and then the pad never starts.
  useEffect(() => {
    if (!isNative()) return;
    const platform = navigator.userAgent.toLowerCase();
    if (!platform.includes('linux') && !platform.includes('x11')) return;
    document.documentElement.classList.add('orbit-linux');
    return () => document.documentElement.classList.remove('orbit-linux');
  }, []);

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

  const hiddenLibraryFilters = settings?.hiddenLibraryFilters ?? [];
  // If a selected chip is hidden in Settings, fall back to All immediately.
  const activeFilter: Filter = hiddenLibraryFilters.includes(filter) ? 'all' : filter;

  // The game that is playing is marked, so the grid can show it at a glance.
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    const list = played.filter((g) => {
      // A game that is only written down lives on the Backlog page: it is a plan,
      // not something in the library, and seeing it here as well would make it
      // look installed. The same goes for a game that is owned but not installed
      // anywhere yet: marking one as owned in the Backlog keeps it a plan until
      // it has a folder.
      //
      // A game added through the add dialog is not a plan, though: it is in the
      // library from the moment it is added, whether or not there is a program
      // to point at yet.
      if (g.planned || (!onDisk(g) && !g.inLibrary)) return false;
      // Hidden games are the library's own drawer: they are in the library, and
      // the Hidden chip is the only place they are shown.
      if (activeFilter !== 'hidden' && g.hidden) return false;
      if (q && !g.title.toLowerCase().includes(q)) return false;
      if (activeFilter === 'hidden') return !!g.hidden;
      if (activeFilter === 'favorites') return g.favorite;
      if (activeFilter === 'unplayed') return g.sessionCount === 0;
      if (activeFilter !== 'all') return g.status === activeFilter;
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
  }, [played, activeFilter, query, sort, order]);

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

  /**
   * Right click, from one place.
   *
   * The handler lives on the window rather than on each tile, because a tile is
   * made of several elements (the cover, the glow, the title, the buttons) and a
   * handler per element misses whichever one the pointer happens to be over.
   * Everything a game is drawn with carries `data-orbit-game`, so the element
   * under the pointer is asked which game it belongs to, and the browser's own
   * menu is suppressed at the same time: inside the app, that menu is not the
   * one anybody wants.
   */
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-orbit-game]');
      if (!el) return;
      const id = el.getAttribute('data-orbit-game');
      if (!id) return;
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        id,
        readOnlyMoves: el.hasAttribute('data-orbit-no-move'),
      });
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  /**
   * Dialogs belong to the page they were opened from.
   *
   * Changing tab with one open used to leave it on top of the new page, which
   * is how importing from Steam in Settings ended up following the player
   * around the app.
   */
  useEffect(() => {
    setShowAdd(false);
    setEditingGameId(null);
    setEditingHideLaunchSettings(false);
    setShowImport(false);
    setShowSteam(false);
    setShowOtherLaunchers(null);
    setMenu(null);
    setDetailReadOnlyMoves(false);
    setRemoveConfirmId(null);
    setRemoveSteamConfirm(false);
    setMoveId(null);
  }, [page]);

  /** Open the read-only details drawer, even if this game is already selected. */
  const openDetail = (id: string, readOnlyMoves = false) => {
    setDetailReadOnlyMoves(readOnlyMoves);
    setDetailNonce((n) => n + 1);
    setSelectedId(id);
  };

  /** The pencil opens the full, centered editor rather than an Edit drawer tab. */
  const openGameEditor = (id: string, hideLaunchSettings = false) => {
    setSelectedId(null);
    setEditingHideLaunchSettings(hideLaunchSettings);
    setEditingGameId(id);
  };

  const toggleFavorite = (id: string) => {
    const game = games.find((candidate) => candidate.id === id);
    if (game) updateGame(id, { favorite: !game.favorite });
  };

  /**
   * What can be done to a game from the library, without opening it.
   *
   * Built here rather than in the grid or the list, because these are the app's
   * own actions: the two views only know how to report a right click.
   */
  const menuGame = menu ? (games.find((g) => g.id === menu.id) ?? null) : null;
  const menuReadOnlyMoves = menu?.readOnlyMoves === true;
  const menuItems: MenuItem[] = !menuGame
    ? []
    : page === 'backlog'
      ? [
          { kind: 'label', label: menuGame.title },
          { label: 'Open details', icon: Info, onSelect: () => openDetail(menuGame.id, menuReadOnlyMoves) },
          ...(menuReadOnlyMoves ? [] : [
            { label: 'Edit game…', icon: Pencil, onSelect: () => openGameEditor(menuGame.id, true) },
            { kind: 'sep' as const },
            ...(
              [
                ['playing', 'Move to Playing'],
                ['backlog', 'Move to Backlog'],
                ['completed', 'Mark Completed'],
                ['dropped', 'Mark Dropped'],
              ] as const
            )
              .filter(([status]) => status !== menuGame.status)
              .map(([status, label]) => ({
                label,
                onSelect: () => updateGame(menuGame.id, { status }),
              })),
            ...(menuGame.planned
              ? [{ label: 'Mark as owned', icon: Check, onSelect: () => updateGame(menuGame.id, { planned: false, status: 'backlog' }) }]
              : [{ label: 'Mark as not owned', icon: X, onSelect: () => updateGame(menuGame.id, { planned: true, status: 'backlog' }) }]),
          ]),
          { kind: 'sep' },
          {
            label: menuGame.favorite ? 'Remove from favorites' : 'Add to favorites',
            icon: menuGame.favorite ? FilledStar : Star,
            onSelect: () => updateGame(menuGame.id, { favorite: !menuGame.favorite }),
          },
          { kind: 'sep' },
          {
            label: 'Delete from Orbit…',
            icon: Trash2,
            danger: true,
            onSelect: () => setRemoveConfirmId(menuGame.id),
          },
        ]
      : [
          { kind: 'label', label: menuGame.title },
          { label: 'Open details', icon: Info, onSelect: () => openDetail(menuGame.id) },
          { label: 'Edit game…', icon: Pencil, onSelect: () => openGameEditor(menuGame.id) },
          { kind: 'sep' },
          // Only the session Orbit is actually tracking. The database can hold
          // a row left open by a run of the app that was killed, and reading that
          // as "running" made this menu offer to stop a game nobody had started.
          session?.gameId === menuGame.id
            ? { label: 'Stop session', icon: Square, onSelect: () => void stop() }
            : { label: 'Start game', icon: Play, onSelect: () => void startGame(menuGame) },
          {
            label: menuGame.favorite ? 'Remove from favorites' : 'Add to favorites',
            icon: menuGame.favorite ? FilledStar : Star,
            onSelect: () => updateGame(menuGame.id, { favorite: !menuGame.favorite }),
          },
          {
            label: menuGame.hidden ? 'Show in library' : 'Hide from library',
            icon: menuGame.hidden ? Eye : EyeOff,
            onSelect: () => updateGame(menuGame.id, { hidden: !menuGame.hidden }),
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
            label: 'Remove from library…',
            icon: Trash2,
            danger: true,
            onSelect: () => setRemoveConfirmId(menuGame.id),
          },
        ];

  const selected = games.find((g) => g.id === selectedId) ?? null;
  const editingGame = games.find((g) => g.id === editingGameId) ?? null;
  const moving = games.find((g) => g.id === moveId) ?? null;
  const removalTarget = games.find((g) => g.id === removeConfirmId) ?? null;
  const steamRemovalIds = games.filter((g) => g.launch.kind === 'steam').map((g) => g.id);
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
    const launchedFromOrbit = g.launch.kind !== 'none' && (!started.manual || g.launch.kind === 'steam');
    if (launchedFromOrbit && settings?.overlay?.enabled !== false && settings?.overlay?.readyNotice !== false) {
      const fallbackNotice = () => announce({
        text: 'Orbit Overlay is working',
        detail: 'Ready for captures. Press Alt+X to open it.',
      });
      if (isNative()) void overlayReadyNotice(g.title).catch(fallbackNotice);
      else fallbackNotice();
    }
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
    const reviewedByPlayer = !!g.meta?.edited;
    const [meta, hltb] = await Promise.all([
      reviewedByPlayer ? Promise.resolve(null) : fetchMetadata(g.title, g.meta?.steamAppId ?? undefined).catch(() => null),
      fetchHltb(g.title).catch(() => null),
    ]);
    if (reviewedByPlayer) {
      // Keep the details the player just reviewed, while still letting the
      // independent playtime lookup fill in the new game's completion estimate.
      if (hltb) updateGame(g.id, { hltb }, 'player');
      return;
    }
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
  const heroGame =
    runningGame ??
    byRecent.find((g) => !g.hidden) ??
    played.find((g) => !g.planned && !g.hidden) ??
    null;

  // Start on a controller starts the selected game, or the hero game. Back
  // clears a selection, then leaves the page. Escape, which the pad also
  // sends, already closes a dialog that is open.
  useEffect(() => {
    const onPlay = () => {
      if (session) {
        void stop();
        return;
      }
      const focused = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest('[data-orbit-game]')
        : null;
      const focusedId = focused?.getAttribute('data-orbit-game');
      const picked =
        (focusedId && games.find((item) => item.id === focusedId)) ||
        (selectedId && games.find((item) => item.id === selectedId)) ||
        heroGame;
      if (picked) void startGame(picked);
    };
    const onBack = () => {
      if (selectedId) setDetailClose((n) => n + 1);
      else if (page !== 'library') setPage('library');
    };
    const onPage = (event: Event) => {
      // The details drawer listens too, but both listeners are on the window, and
      // a capture listener added later does not run first. While the drawer is
      // open the shoulders belong to its tabs, not to these pages.
      if (document.querySelector('.orbit-detail')) return;
      const direction = (event as CustomEvent<string>).detail;
      // Settings is not one of the rearrangable tabs, but it sits at the end of
      // the bar. The shoulder buttons have to be able to land on it too.
      const tabs: Page[] = [...orderedTabs(settings?.tabOrder).map((tab) => tab.id), 'settings'];
      if (tabs.length === 0) return;
      const index = tabs.indexOf(page);
      const from = index >= 0 ? index : direction === 'right' ? -1 : tabs.length;
      const next = direction === 'right' ? tabs[(from + 1) % tabs.length] : tabs[(from - 1 + tabs.length) % tabs.length];
      if (next) setPage(next);
    };
    window.addEventListener('orbit-pad-play', onPlay);
    window.addEventListener('orbit-pad-back', onBack);
    window.addEventListener('orbit-pad-page', onPage);
    return () => {
      window.removeEventListener('orbit-pad-play', onPlay);
      window.removeEventListener('orbit-pad-back', onBack);
      window.removeEventListener('orbit-pad-page', onPage);
    };
  }, [session, stop, selectedId, games, heroGame, page, settings?.tabOrder]);
  // The hero stays on screen while the category chips are used. That is the
  // point of it being "jump back in" rather than a summary of the current
  // filter. Only a search takes it away, because then the player is looking for
  // one particular game.
  /**
   * Scroll to a requested Settings card after the new page has committed.
   *
   * Two animation frames are more reliable than a fixed timeout: the first
   * renders Settings, the next lets layout settle before the scroll position is
   * calculated. The card's scroll margin leaves room below the sticky top bar
   * and the quick-jump row.
   */
  useEffect(() => {
    if (page !== 'settings' || !settingsJump) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const card = document.getElementById(settingsJump.id);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('settings-spot');
          window.setTimeout(() => card.classList.remove('settings-spot'), 2400);
        }
        setSettingsJump(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [page, settingsJump]);

  const openSettings = useCallback((at?: string) => {
    setSettingsJump(at ? { id: at, token: ++settingsJumpToken.current } : null);
    setPage('settings');
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    let stop = () => {};
    void listen('overlay-open-settings', () => openSettings('orbit-overlay')).then((unlisten) => {
      stop = unlisten;
    }).catch(() => undefined);
    return () => stop();
  }, [openSettings]);

  const showHome = page === 'library' && !query;

  // Nothing can be drawn until the settings have loaded, which also decides the
  // theme. Every hook above has already run, so this is safe. While that
  // happens the opening is on screen, which is most of what it is for.
  if (!settings) {
    return (
      <>
        {!booted && <Startup onDone={() => setBooted(true)} />}
        <div className="h-full bg-bg" />
      </>
    );
  }

  // The opening is on unless it has been turned off, and it is the same switch
  // that fades the shell in behind it. It plays once, when the app starts.
  const opening = !booted && settings.startupAnimation !== false;

  return (
    <>
      {opening && <Startup onDone={() => setBooted(true)} />}
      <div
        className={
          // Opacity only, never a transform: an ancestor with a transform on it
          // becomes the thing a fixed element is measured against, and the
          // dialogs would then scroll with the page instead of sitting over it.
          // `orbit-idle` is the other half of that: when a game has the window,
          // the decorative loops stop so this shell has nothing to repaint.
          `${opening ? 'orbit-enter ' : ''}orbit-scroll relative h-full overflow-y-auto text-fg${focused ? '' : ' orbit-idle'}`
        }
      >
      <TopNav
        page={page}
        setPage={setPage}
        onOpenSettings={openSettings}
        order={settings?.tabOrder}
        sound={settings.sound}
        setSound={(sound) => setSettings({ sound })}
        showMusic={settings.topbarMusic !== false}
        showBars={settings.musicBars !== false}
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

      <main key={page} className="orbit-tab-enter pb-24">
        {!settings ? null : page === 'settings' ? (
          <div className="glass mx-6 mt-5 rounded-3xl">
            <SettingsView
              settings={settings}
              setSettings={setSettings}
              onImportLauncher={(launcher) => {
                if (launcher === 'Steam') setShowSteam(true);
                else setShowOtherLaunchers(launcher);
              }}
              onClearLibrary={() => {
                void clearLibrary().then(() => location.reload());
              }}
              onReset={resetEverything}
              onLibraryChanged={() => void reload()}
              update={update}
              onFoundUpdate={setUpdate}
            />
          </div>
        ) : page === 'backlog' ? (
          <BacklogView
            games={played}
            onSelect={openDetail}
            onEdit={(id) => openGameEditor(id, true)}
            onStatus={(id, status) => updateGame(id, { status })}
            onAdd={(game) => addGames([game])}
            onUpdate={(id, patch) => updateGame(id, patch)}
            onRemove={(id) => removeGame(id)}
            fetchMetadata={settings.fetchMetadata}
            // Off by default: a game the player added to the library by hand
            // stays there, and only crosses over to this page when asked for.
            syncLibrary={settings.syncBacklog === true}
            backlogOn={settings.backlogOn ?? []}
            backlogOff={settings.backlogOff ?? []}
            onBacklogMembership={(id, on) => {
              setSettings((current) => {
                const currentOn = current.backlogOn ?? [];
                const currentOff = current.backlogOff ?? [];
                return {
                  backlogOn: on ? [...currentOn.filter((item) => item !== id), id] : currentOn.filter((item) => item !== id),
                  backlogOff: on ? currentOff.filter((item) => item !== id) : [...currentOff.filter((item) => item !== id), id],
                };
              });
            }}
            myOrder={settings.backlogOrder}
            setMyOrder={(ids) => setSettings({ backlogOrder: ids })}
          />
        ) : page === 'sessions' ? (
          <SessionsView
            games={games}
            onChanged={() => void reload()}
            onOpenGame={openDetail}
          />
        ) : page === 'logs' ? (
          <LogsView
            games={games}
            onUpdate={(id, patch) => updateGame(id, patch)}
            onEditGame={openGameEditor}
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
        ) : page === 'saves' ? (
          <SavesView games={games} settings={settings} setSettings={setSettings} />
        ) : (
          <>
            {showHome && settings.showHero !== false && heroGame && (
              <Hero
                game={heroGame}
                running={runningGame?.id === heroGame.id}
                onPlay={() => void startGame(heroGame)}
                onDetails={() => setSelectedId(heroGame.id)}
              />
            )}
            <Toolbar
              count={visible.length}
              total={games.length}
              filter={activeFilter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              view={view}
              setView={setView}
              sort={sort}
              setSort={setSort}
              onAdd={() => setShowAdd(true)}
              showHero={settings.showHero !== false}
              onToggleHero={() => setSettings({ showHero: settings.showHero === false })}
              scale={scale}
              setScale={(n) => setSettings({ coverScale: n })}
              filterOrder={settings.libraryFilterOrder}
              hiddenFilters={settings.hiddenLibraryFilters}
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
                  onEdit={openGameEditor}
                  onToggleFavorite={toggleFavorite}
                  onPlay={(g) => void startGame(g)}
                  scale={scale}
                  onReorder={sort === 'manual' ? reorder : undefined}
                  coverTint={settings.coverTint !== false}
                />
              ) : (
                <GameList
                  games={visible}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onEdit={openGameEditor}
                  onToggleFavorite={toggleFavorite}
                  onPlay={(g) => void startGame(g)}
                  scale={scale}
                  onReorder={sort === 'manual' ? reorder : undefined}
                />
              )}
            </div>
          </>
        )}
      </main>

      {session && runningGame && (
        <div className="glass fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-full py-2 pl-5 pr-2 text-sm shadow-2xl">
          <span className="orbit-pulse size-2 rounded-full bg-emerald-400" />
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
        <p className="fixed bottom-20 left-1/2 z-30 max-w-md -translate-x-1/2 rounded-full bg-panel px-4 py-1.5 text-center text-xs text-muted">
          {notice ?? 'Starting…'}
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
      <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex w-fit max-w-xs flex-col items-start gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-fit max-w-full items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
              t.tone === 'error'
                ? 'border-rose-300/35 bg-gradient-to-br from-rose-950/95 to-panel/95 text-rose-100 ring-1 ring-rose-300/10'
                : 'border-emerald-300/25 bg-gradient-to-br from-panel/98 to-emerald-950/35 text-fg ring-1 ring-white/5'
            }`}
          >
            {t.tone === 'error' ? (
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-rose-300" />
            ) : (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-300" />
            )}
            <div className="min-w-0 flex-1">
              <span className="block break-words font-semibold">{t.text}</span>
              {t.detail && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{t.detail}</span>}
              {t.actions?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.actions.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => {
                        action.onSelect();
                        // Answering is what the buttons are for, so the toast
                        // goes as soon as one of them is pressed.
                        setToasts((current) => current.filter((x) => x.id !== t.id));
                      }}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                        t.tone === 'error'
                          ? 'border-rose-300/40 text-rose-50 hover:bg-rose-400/20'
                          : 'border-accent/50 text-accent hover:bg-accent/15 hover:text-fg'
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
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

      {removalTarget && (
        <ConfirmDialog
          title={`Remove ${removalTarget.title}?`}
          description="This removes the game's Orbit entry, notes and session history. The installed game and its files on disk are not touched."
          confirmLabel="Remove from Orbit"
          onCancel={() => setRemoveConfirmId(null)}
          onConfirm={() => {
            removeGame(removalTarget.id);
            setSelectedId((current) => (current === removalTarget.id ? null : current));
            setRemoveConfirmId(null);
          }}
        />
      )}

      {removeSteamConfirm && steamRemovalIds.length > 0 && (
        <ConfirmDialog
          title={`Remove ${steamRemovalIds.length} Steam ${steamRemovalIds.length === 1 ? 'game' : 'games'}?`}
          description="This removes the selected Steam entries from Orbit, including their session history and notes. The games installed by Steam and all launcher data remain untouched."
          confirmLabel="Remove from Orbit"
          onCancel={() => setRemoveSteamConfirm(false)}
          onConfirm={() => {
            for (const id of steamRemovalIds) removeGame(id);
            if (selectedId && steamRemovalIds.includes(selectedId)) setSelectedId(null);
            toast({ text: `Removed ${steamRemovalIds.length} ${steamRemovalIds.length === 1 ? 'game' : 'games'} that came from Steam` });
            setRemoveSteamConfirm(false);
          }}
        />
      )}

      {selected && (
        <GameDetail
          key={`${selected.id}:${detailNonce}`}
          game={selected}
          // The same drawer, read two ways: from the Backlog it is a page about
          // deciding what to play, with nothing in it that starts anything.
          context={page === 'backlog' ? 'backlog' : 'library'}
          readOnlyMoves={detailReadOnlyMoves}
          session={session}
          now={now}
          onUpdate={(p) => updateGame(selected.id, p)}
          onSetPlaytime={async (totalSecs) => {
            await setPlaytime(selected.id, totalSecs);
            await reload();
          }}
          onPlay={() => void startGame(selected)}
          onStop={() => void stop()}
          onRemove={() => setRemoveConfirmId(selected.id)}
          onLeaveBacklog={
            page === 'backlog' && inLibraryShelf(selected)
              ? () => {
                  const id = selected.id;
                  setSettings((current) => {
                    const currentOn = current.backlogOn ?? [];
                    const currentOff = current.backlogOff ?? [];
                    return {
                      backlogOn: currentOn.filter((item) => item !== id),
                      backlogOff: [...currentOff.filter((item) => item !== id), id],
                    };
                  });
                  setSelectedId(null);
                }
              : undefined
          }
          closeRequest={detailClose}
          onClose={() => setSelectedId(null)}
        />
      )}

      {editingGame && (
        <GameEditDialog
          game={editingGame}
          onUpdate={(patch) => updateGame(editingGame.id, patch)}
          hideLaunchSettings={editingHideLaunchSettings}
          onClose={() => {
            setEditingGameId(null);
            setEditingHideLaunchSettings(false);
          }}
        />
      )}

      {showAdd && (
        <AddGameModal
          initialPaths={droppedPaths}
          // The selected library opens over this form; closing it returns here.
          onImportLauncher={(launcher) => {
            if (launcher === 'Steam') setShowSteam(true);
            else setShowOtherLaunchers(launcher);
          }}
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
      {showOtherLaunchers && (
        <OtherLauncherImportModal
          existing={games}
          launcher={showOtherLaunchers}
          path={settings?.launcherPaths?.[showOtherLaunchers]}
          onPath={(picked) =>
            setSettings({
              launcherPaths: { ...settings?.launcherPaths, [showOtherLaunchers]: picked },
            })
          }
          onAdd={addGames}
          onClose={() => setShowOtherLaunchers(null)}
        />
      )}
      {showSteam && settings && (
        <SteamImportModal
          existing={games}
          fetchMeta={settings.fetchMetadata}
          from={page === 'backlog' ? 'backlog' : 'library'}
          onAdd={addGames}
          onUpdate={(id, patch) => updateGame(id, patch)}
          onRemoveSteam={() => setRemoveSteamConfirm(true)}
          onClose={() => setShowSteam(false)}
          steamPath={settings.steamPath}
          onSteamPath={(steamPath) => setSettings({ steamPath })}
        />
      )}
      {menu && menuGame && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
      {cloudClose && (
        <ConfirmDialog
          title="A cloud copy is still running"
          description={cloudClose === 'restore'
            ? 'Orbit is restoring a backup from the cloud. Closing now can leave a save half-written.'
            : 'Orbit is sending a backup to the cloud. Closing now can leave that copy unfinished.'}
          confirmLabel="Close anyway"
          cancelLabel="Keep Orbit open"
          confirmIcon={X}
          onCancel={() => setCloudClose(null)}
          onConfirm={() => {
            setCloudClose(null);
            void quitDespiteCloud();
          }}
        />
      )}

      {moving && settings && (
        <MoveDriveModal
          game={moving}
          folders={settings.libraryFolders}
          onClose={() => setMoveId(null)}
          job={move.job}
          onStartMove={(game, toFolder, libraryFolders) => void move.start(game, toFolder, libraryFolders)}
          onMinimize={() => setMoveId(null)}
        />
      )}

      {move.job && moveId !== move.job.gameId && (
        <MoveProgressOrb job={move.job} onOpen={setMoveId} onDismiss={move.dismiss} />
      )}
      {cloudJob && (
        <CloudTransferOrb job={cloudJob} lift={!!move.job && moveId !== move.job.gameId} />
      )}

      {!isNative() && (
        <p className="pointer-events-none fixed bottom-2 left-2 rounded-full bg-panel/80 px-3 py-1 text-[10px] text-muted">
          Browser preview · run <span className="font-mono">npm run tauri dev</span> for files, launching and sessions
        </p>
      )}
      </div>
    </>
  );
}
