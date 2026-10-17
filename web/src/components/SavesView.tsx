import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArchiveRestore, ChevronDown, CloudDownload, CloudUpload, Eye, EyeOff, FolderOpen, GripVertical, HardDriveDownload, List, Search } from 'lucide-react';
import type { Game, Settings } from '../types';
import { pickFolder } from '../services/desktop';
import {
  revealInExplorer,
  backupSave,
  findSave,
  isNative,
  listSaves,
  restoreSave,
  saveHintsOf,
  savePlaceOf,
  savesStatus,
  cloudAccounts,
  cloudGameOf,
  cloudLabel,
  chosenClouds,
  restoreCloudText,
  restoreFromCloud,
  sendCloudAfterBackup,
  sendToClouds,
  trackCloud,
  type CloudAccount,
  type SaveBackup,
  type SaveStatus,
} from '../services/native';
import { Checkbox } from './ui/Checkbox';
import { Cover } from './ui/Cover';
import { btnAccent } from './ui/buttons';
import { say } from '../utils/toast';
import { cn } from '../utils/cn';
import { useDragReorder } from '../hooks/useDragReorder';
import { takePlace } from '../utils/reorder';
import { ContextMenu, type MenuItem } from './ui/ContextMenu';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { inputCls, Modal } from './ui/Modal';
import { CloudPanel } from './saves/CloudPanel';

/**
 * Copies of the files a game writes while it is played.
 *
 * Orbit looks in the usual places — Documents, Saved Games, the game's own
 * folder, a Wine prefix, a Steam prefix — and copies what it finds. Nothing
 * else has to be installed. A folder the player names is used instead. Those
 * copies can be sent to a cloud from this page. Nothing is installed for the copy that stays here.
 */
export function SavesView({
  games,
  settings,
  setSettings,
}: {
  games: Game[];
  settings: Settings;
  setSettings: (patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) => void;
}) {
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [backingAll, setBackingAll] = useState(false);
  const [sendingCloud, setSendingCloud] = useState(false);
  const [restoringCloud, setRestoringCloud] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; copies: SaveBackup[] | null } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Game | null>(null);
  const [cloudRestore, setCloudRestore] = useState<{ games: Game[]; cloud: CloudAccount } | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const [browseQuery, setBrowseQuery] = useState('');
  const [looked, setLooked] = useState<Set<string>>(() => new Set());
  const tried = useRef(new Set<string>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const dirWrites = useRef(Promise.resolve());
  const rememberDir = (id: string, path: string) => {
    dirWrites.current = dirWrites.current.then(() => {
      const apply = setSettings as (patch: (current: Settings) => Partial<Settings>) => void;
      apply((current) => {
        if (current.saves?.dirs?.[id]?.trim()) return {};
        const dirs = { ...current.saves?.dirs, [id]: path };
        const saves = { ...current.saves, dirs };
        settingsRef.current = { ...current, saves };
        return { saves };
      });
    });
  };
  const savedOrder = settings.saves?.order;
  const hiddenIds = (settings.saves?.hidden ?? []).filter((id) => games.some((game) => game.id === id));
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const rows = useMemo(() => {
    const list = [...games];
    const order = savedOrder ?? [];
    if (order.length === 0) return list.sort((a, b) => a.title.localeCompare(b.title));
    return list.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      // A game that was never dragged waits at the end, rather than landing in
      // the middle of an arrangement somebody made.
      if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [games, savedOrder]);
  const listed = useMemo(
    () => (showHidden ? rows : rows.filter((game) => !hidden.has(game.id))),
    [rows, showHidden, hidden],
  );
  const list = useRef<HTMLUListElement>(null);
  const { bind, dragging, over } = useDragReorder(
    (fromId, toId) => {
      const nextVisible = takePlace(listed.map((game) => game.id), fromId, toId);
      const order = showHidden || hidden.size === 0
        ? nextVisible
        : keepHiddenSlots(rows.map((game) => game.id), nextVisible, hiddenIds);
      setSettings((current) => ({
        saves: {
          ...current.saves,
          order,
        },
      }));
    },
    // The row is itself a button, so the press has to be allowed to start there.
    { container: list, fromButtons: true, onto: true },
  );
  const auto = settings.saves?.auto ?? [];
  const dirs = settings.saves?.dirs ?? {};
  const browseGames = useMemo(() => {
    const query = browseQuery.trim().toLowerCase();
    return [...games]
      .filter((game) => !query || game.title.toLowerCase().includes(query))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [games, browseQuery]);

  useEffect(() => {
    if (!isNative()) return;
    void savesStatus(settings.saves?.backupRoot).then(setStatus).catch(() => undefined);
  }, [settings.saves?.backupRoot]);

  const gameKey = games.map((game) => game.id).join('\n');
  useEffect(() => {
    if (!isNative()) return;
    const pending = games.filter((game) => !settingsRef.current.saves?.dirs?.[game.id]?.trim() && !tried.current.has(game.id));
    if (pending.length === 0) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (cursor < pending.length) {
        const game = pending[cursor];
        cursor += 1;
        if (!game || tried.current.has(game.id)) continue;
        tried.current.add(game.id);
        let path: string | null = null;
        try {
          path = await findSave(game.title, saveHintsOf(game));
        } catch {
          path = null;
        }
        setLooked((current) => {
          const next = new Set(current);
          next.add(game.id);
          return next;
        });
        if (path) rememberDir(game.id, path);
      }
    });
    void Promise.all(workers);
    // The id list is the dependency. A new array of the same games must not start the search again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey]);

  const setAuto = (id: string, on: boolean) => {
    const next = on ? [...new Set([...auto, id])] : auto.filter((item) => item !== id);
    setSettings((current) => ({ saves: { ...current.saves, auto: next, dirs: current.saves?.dirs } }));
  };
  const setDir = (id: string, dir: string) => {
    setSettings((current) => ({ saves: { ...current.saves, dirs: { ...current.saves?.dirs, [id]: dir } } }));
  };
  const afterBackup = (only?: ReturnType<typeof cloudGameOf>[]) => {
    void sendCloudAfterBackup(settings.saves, settings.saves?.backupRoot, only).catch((e) => {
      say(`The copy is on this PC. The cloud did not take it. ${String(e).replace(/^Error:\s*/, '')}`);
    });
  };
  const clouds = cloudAccounts(settings.saves);
  const sendGameToCloud = async (game: Game, target: 'chosen' | 'all' | CloudAccount = 'chosen') => {
    if (clouds.length === 0) throw new Error('Sign in to a cloud first.');
    const list = target === 'all' ? clouds : target === 'chosen' ? chosenClouds(clouds) : [target];
    if (list.length === 0) throw new Error('Mark a cloud first, or pick one.');
    await trackCloud('backup', async () => {
      try {
        await backupSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
      } catch {
        // A cloud copy uses the save folder itself. A local copy is not required.
      }
      await sendToClouds(list, 'all', settings.saves?.backupRoot, [cloudGameOf(game, dirs[game.id])]);
    });
  };
  const setHidden = (id: string, hide: boolean) => {
    const next = hide ? [...new Set([...hiddenIds, id])] : hiddenIds.filter((item) => item !== id);
    setSettings((current) => ({ saves: { ...current.saves, hidden: next } }));
    if (hide && openId === id) setOpenId(null);
  };

  const backupAll = async () => {
    if (!isNative() || backingAll) return;
    setBackingAll(true);
    let copied = 0;
    let skipped = 0;
    for (const game of listed) {
      try {
        await backupSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
        copied += 1;
      } catch {
        skipped += 1;
      }
    }
    setBackingAll(false);
    setSavedTick((n) => n + 1);
    if (copied > 0) afterBackup(games.map((game) => cloudGameOf(game, dirs[game.id])));
    if (copied === 0) {
      say(skipped === 0 ? 'There are no games to back up.' : 'No save folders were found to copy.');
      return;
    }
    say(
      skipped > 0
        ? `Backed up ${copied} ${copied === 1 ? 'game' : 'games'}. ${skipped} had no save folder.`
        : `Backed up ${copied} ${copied === 1 ? 'game' : 'games'}.`,
    );
  };

  const gamesWithFolders = () => listed.filter((game) => !!dirs[game.id]?.trim());

  const backupToCloud = async (which: 'chosen' | 'all' = 'chosen') => {
    if (!isNative() || sendingCloud || clouds.length === 0) return;
    const chosen = gamesWithFolders();
    if (chosen.length === 0) {
      say('No save folders found yet.');
      return;
    }
    setSendingCloud(true);
    try {
      await trackCloud('backup', async () => {
        for (const game of chosen) {
          try {
            await backupSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
          } catch {
            // A game with no save folder is skipped. The others still go up.
          }
        }
        setSavedTick((n) => n + 1);
        const sent = await sendToClouds(which === 'all' ? clouds : chosenClouds(clouds), 'all', settings.saves?.backupRoot, chosen.map((game) => cloudGameOf(game, dirs[game.id])));
        say(sent);
      });
    } catch (e) {
      say(`The cloud did not take it. ${String(e).replace(/^Error:\s*/, '')}`);
    } finally {
      setSendingCloud(false);
    }
  };

  const restoreChosenFromCloud = async (cloud: CloudAccount, list: Game[]) => {
    if (!isNative() || restoringCloud) return;
    if (list.length === 0) {
      say('No save folders found yet.');
      return;
    }
    setRestoringCloud(true);
    setMenuError(null);
    try {
      const note = await trackCloud('restore', () => restoreFromCloud(
        cloud,
        settings.saves?.backupRoot,
        list.map((game) => cloudGameOf(game, dirs[game.id])),
      ));
      say(note);
      setSavedTick((n) => n + 1);
    } catch (e) {
      say(`The cloud copy was not restored. ${String(e).replace(/^Error:\s*/, '')}`);
    } finally {
      setRestoringCloud(false);
    }
  };

  const askCloudRestore = (cloud: CloudAccount, list: Game[]) => {
    if (list.length === 0) {
      say('No save folders found yet.');
      return;
    }
    setCloudRestore({ games: list, cloud });
  };

  const runGame = async (fn: () => Promise<unknown>, done: string) => {
    setMenuError(null);
    try {
      await fn();
      say(done);
      setSavedTick((n) => n + 1);
    } catch (e) {
      setMenuError(String(e).replace(/^Error:\s*/, ''));
    }
  };

  const openMenu = (game: Game, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuError(null);
    setMenu({ x: event.clientX, y: event.clientY, id: game.id, copies: null });
    if (!isNative()) return;
    void listSaves(game.id, game.title, savePlaceOf(game, settings))
      .then((copies) => {
        setMenu((current) => (current && current.id === game.id ? { ...current, copies } : current));
      })
      .catch(() => undefined);
  };

  const menuGame = menu ? games.find((game) => game.id === menu.id) ?? null : null;
  const latestCopy = menu?.copies?.slice().sort((a, b) => b.at - a.at)[0];
  const menuItems: MenuItem[] = menuGame
    ? [
        { kind: 'label', label: menuGame.title },
        {
          label: 'Back up now',
          icon: HardDriveDownload,
          disabled: !isNative(),
          onSelect: () => void runGame(
            async () => {
              await backupSave(menuGame.id, menuGame.title, dirs[menuGame.id] ?? null, saveHintsOf(menuGame), savePlaceOf(menuGame, settings));
              afterBackup([cloudGameOf(menuGame, dirs[menuGame.id])]);
            },
            `Backed up ${menuGame.title}`,
          ),
        },
        ...(clouds.length > 1
          ? [
              { kind: 'label' as const, label: 'Back up to the cloud' },
              ...clouds.map((cloud) => ({
                label: cloudLabel(cloud, clouds),
                icon: CloudUpload,
                disabled: !isNative(),
                onSelect: () => void runGame(
                  () => sendGameToCloud(menuGame, cloud),
                  `Sent ${menuGame.title} to ${cloudLabel(cloud, clouds)}`,
                ),
              })),
              {
                label: 'All clouds',
                icon: CloudUpload,
                disabled: !isNative(),
                onSelect: () => void runGame(() => sendGameToCloud(menuGame, 'all'), `Sent ${menuGame.title} to every cloud`),
              },
            ]
          : [{
              label: 'Back up to the cloud',
              icon: CloudUpload,
              disabled: !isNative(),
              onSelect: () => void runGame(
                () => sendGameToCloud(menuGame, clouds[0] ?? 'chosen'),
                `Sent ${menuGame.title} to the cloud`,
              ),
            }]),
        {
          label: 'Restore latest',
          icon: ArchiveRestore,
          disabled: !isNative(),
          onSelect: () => setRestoreTarget(menuGame),
        },
        ...(clouds.length > 1
          ? [
              { kind: 'label' as const, label: 'Restore from the cloud' },
              ...clouds.map((cloud) => ({
                label: cloudLabel(cloud, clouds),
                icon: CloudDownload,
                disabled: !isNative() || sendingCloud || restoringCloud,
                onSelect: () => askCloudRestore(cloud, [menuGame]),
              })),
            ]
          : clouds.length === 1
            ? [{
                label: 'Restore from the cloud',
                icon: CloudDownload,
                disabled: !isNative() || sendingCloud || restoringCloud,
                onSelect: () => askCloudRestore(clouds[0], [menuGame]),
              }]
            : []),
        {
          label: 'Find save folder',
          icon: Search,
          disabled: !isNative(),
          onSelect: () => void runGame(async () => {
            const found = await findSave(menuGame.title, saveHintsOf(menuGame));
            if (!found) throw new Error(`Orbit could not find a save folder for ${menuGame.title}.`);
            setDir(menuGame.id, found);
          }, `Found a save folder for ${menuGame.title}`),
        },
        {
          label: 'Open latest copy',
          icon: FolderOpen,
          disabled: !latestCopy,
          onSelect: () => latestCopy && void revealInExplorer(latestCopy.path),
        },
        {
          label: 'Open save folder',
          icon: FolderOpen,
          disabled: !dirs[menuGame.id],
          onSelect: () => dirs[menuGame.id] && void revealInExplorer(dirs[menuGame.id]),
        },
        { kind: 'sep' },
        {
          label: auto.includes(menuGame.id) ? 'Stop backing up automatically' : 'Back up when a session ends',
          onSelect: () => setAuto(menuGame.id, !auto.includes(menuGame.id)),
        },
        { kind: 'sep' },
        {
          label: hidden.has(menuGame.id) ? 'Show in Saves' : 'Hide from Saves',
          icon: hidden.has(menuGame.id) ? Eye : EyeOff,
          onSelect: () => setHidden(menuGame.id, !hidden.has(menuGame.id)),
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Saves</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            A copy of each game's save files, made here. Turn auto on and Orbit takes one when a
            session ends. Nothing else has to be installed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isNative() && listed.length > 0 && (
            <button
              type="button"
              disabled={backingAll || restoringCloud}
              onClick={() => void backupAll()}
              className={cn(btnAccent, 'flex items-center gap-2 rounded-lg px-4 py-2 text-sm')}
            >
              <HardDriveDownload className="size-4" />
              {backingAll ? 'Backing up…' : 'Backup all'}
            </button>
          )}
          {isNative() && clouds.length > 0 && (
            <button
              type="button"
              disabled={sendingCloud || restoringCloud}
              onClick={() => void backupToCloud('chosen')}
              title="Backup every game on this page that has a save folder, then send those copies to the ticked clouds."
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-50"
            >
              <CloudUpload className="size-4" />
              {sendingCloud ? 'Backing up…' : 'Backup to the cloud'}
            </button>
          )}
          {isNative() && clouds.length > 0 && (
            <CloudActionButton
              clouds={clouds}
              busy={restoringCloud}
              disabled={sendingCloud || backingAll}
              icon={CloudDownload}
              label="Restore from the cloud"
              busyLabel="Restoring…"
              onPick={(cloud) => {
                if (cloud === 'all') return;
                askCloudRestore(cloud, gamesWithFolders());
              }}
            />
          )}
          <CloudPanel settings={settings} setSettings={setSettings} games={games} />
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setBrowseQuery('');
                setBrowsing(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg"
            >
              <List className="size-4" />
              All games
            </button>
          )}
          {hiddenIds.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((on) => !on)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg"
            >
              {showHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {showHidden ? 'Hide them again' : `Show ${hiddenIds.length} hidden`}
            </button>
          )}
        </div>
      </div>


      {status?.root && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            Copies are kept in <span className="text-fg">{status.root}</span>.
          </span>
          <button
            type="button"
            onClick={() => void revealInExplorer(status.root)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-fg"
          >
            <FolderOpen className="size-3" />
            Open
          </button>
          {isNative() && (
            <button
              type="button"
              onClick={() => void pickFolder('Where should save copies be kept?', settings.saves?.backupRoot || undefined).then((path) => {
                if (path) setSettings({ saves: { ...settings.saves, backupRoot: path } });
              })}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-fg"
            >
              Change
            </button>
          )}
          {settings.saves?.backupRoot && (
            <button
              type="button"
              onClick={() => setSettings((current) => ({ saves: { ...current.saves, backupRoot: '' } }))}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-fg"
            >
              Use Orbit's folder
            </button>
          )}
        </p>
      )}

      {menuError && (
        <p role="alert" className="mb-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {menuError}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Add a game first. A backup needs something to belong to.
        </p>
      ) : listed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm text-muted">Every game is hidden from Saves. They are still in the library.</p>
          <button
            type="button"
            onClick={() => setShowHidden(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg"
          >
            <Eye className="size-3.5" />
            Show hidden games
          </button>
        </div>
      ) : (
        <>
        {listed.length > 1 && (
          <p className="mb-3 text-xs text-muted">Drag a game to change the order. Right-click one, or use All games, to hide it from this list.</p>
        )}
        {listed.length === 1 && (
          <p className="mb-3 text-xs text-muted">Right-click a game, or use All games, to hide it from this list.</p>
        )}
        <ul ref={list} className="space-y-2">
          {listed.map((game) => (
            <li
              key={game.id}
              data-orbit-save={game.id}
              onContextMenu={(event) => openMenu(game, event)}
              className={cn(
                'rounded-xl border border-line bg-panel/60',
                dragging === game.id && 'opacity-60',
                over === game.id && dragging && dragging !== game.id && 'ring-2 ring-accent',
                hidden.has(game.id) && 'opacity-70',
              )}
            >
              <div className="flex items-stretch">
              <button
                onClick={() => setOpenId((current) => (current === game.id ? null : game.id))}
                {...bind(game.id)}
                className="flex min-w-0 flex-1 cursor-grab items-center justify-between gap-3 px-4 py-3 text-left active:cursor-grabbing"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <GripVertical className="size-4 shrink-0 text-muted" aria-hidden />
                  <Cover game={game} className="h-28 w-20 shrink-0 overflow-hidden rounded-xl shadow-sm [&_span]:text-sm" />
                  <span className="min-w-0">
                  <span className="block truncate font-medium">{game.title}</span>
                  <span className="block text-xs text-muted">
                    {hidden.has(game.id) ? 'Hidden from Saves · ' : ''}
                    {auto.includes(game.id) ? 'Backs up when a session ends' : 'Manual only'}
                    {!dirs[game.id] && (looked.has(game.id) ? ' · No save folder found' : isNative() ? ' · Looking for the save folder' : '')}
                  </span>
                  {dirs[game.id] && (
                    <span className="mt-0.5 block break-all text-[11px] text-muted" title={dirs[game.id]}>{dirs[game.id]}</span>
                  )}
                  </span>
                </span>
                <span className="text-xs text-muted">{openId === game.id ? 'Close' : 'Manage'}</span>
              </button>
              {hidden.has(game.id) && (
                <button
                  type="button"
                  onClick={() => setHidden(game.id, false)}
                  className="mr-3 shrink-0 self-center rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:border-accent hover:text-fg"
                >
                  Show
                </button>
              )}
              </div>
              {openId === game.id && (
                <div className="save-manage-in">
                  <SaveRow
                    game={game}
                    auto={auto.includes(game.id)}
                    dir={dirs[game.id] ?? ''}
                    settings={settings}
                    refreshToken={savedTick}
                    onAuto={(on) => setAuto(game.id, on)}
                    onDir={(dir) => setDir(game.id, dir)}
                    clouds={clouds}
                    onCloud={(target) => sendGameToCloud(game, target)}
                    onRestore={(cloud) => askCloudRestore(cloud, [game])}
                    cloudBusy={sendingCloud || restoringCloud}
                    looked={looked.has(game.id)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        </>
      )}

      {browsing && (
        <Modal
          title="All games"
          subtitle="Hide a game from Saves, or show it again. It stays in the library."
          size="lg"
          onClose={() => setBrowsing(false)}
        >
          <input
            value={browseQuery}
            onChange={(event) => setBrowseQuery(event.target.value)}
            placeholder="Search games"
            className={inputCls}
            autoFocus
          />
          <ul className="mt-3 max-h-[60vh] space-y-1 overflow-auto">
            {browseGames.map((game) => {
              const gone = hidden.has(game.id);
              return (
                <li key={game.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <Cover game={game} className="h-12 w-9 shrink-0 overflow-hidden rounded-lg [&_span]:text-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{game.title}</span>
                    <span className="block text-[11px] text-muted">{gone ? 'Hidden from Saves' : 'In the Saves list'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setHidden(game.id, !gone)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:border-accent hover:text-fg"
                  >
                    {gone ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    {gone ? 'Show' : 'Hide'}
                  </button>
                </li>
              );
            })}
            {browseGames.length === 0 && <li className="px-2 py-4 text-sm text-muted">No games match that.</li>}
          </ul>
        </Modal>
      )}
      {menu && menuGame && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {restoreTarget && (
        <ConfirmDialog
          title={`Restore ${restoreTarget.title}?`}
          description="The latest copy is put back into the save folder. The files there now are replaced. The copy itself is kept."
          confirmLabel="Restore latest"
          confirmIcon={ArchiveRestore}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={() => {
            const game = restoreTarget;
            setRestoreTarget(null);
            void runGame(
              () => restoreSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings)),
              `Restored ${game.title}`,
            );
          }}
        />
      )}
      {cloudRestore && (
        <ConfirmDialog
          title={restoreCloudText(cloudRestore.games.map((game) => game.title), cloudLabel(cloudRestore.cloud, clouds)).title}
          description={restoreCloudText(cloudRestore.games.map((game) => game.title), cloudLabel(cloudRestore.cloud, clouds)).description}
          confirmLabel="Restore"
          confirmIcon={ArchiveRestore}
          onCancel={() => setCloudRestore(null)}
          onConfirm={() => {
            const ask = cloudRestore;
            setCloudRestore(null);
            void restoreChosenFromCloud(ask.cloud, ask.games);
          }}
        />
      )}
    </div>
  );
}

/**
 * Put the visible games in their new order, and leave hidden ones where they were.
 *
 * A drag that cannot see a hidden game must not drop it out of the saved order,
 * or showing it again would send it to the end.
 */
function keepHiddenSlots(previous: string[], nextVisible: string[], hiddenIds: string[]): string[] {
  const hidden = new Set(hiddenIds);
  const queue = [...nextVisible];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of previous) {
    if (hidden.has(id)) {
      result.push(id);
      seen.add(id);
      continue;
    }
    const next = queue.shift();
    if (next && !seen.has(next)) {
      result.push(next);
      seen.add(next);
    }
  }
  for (const id of queue) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

/** The time written on a copy. A profile id is not a time, so it is left out. */
function copyWhen(backup: SaveBackup): string | null {
  const written = backup.note
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('When: '))
    ?.slice('When: '.length)
    .trim();
  if (written) return written;
  const at = Number(backup.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const ms = at > 1e12 ? at : at * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000 || date.getFullYear() > 2100) return null;
  return date.toLocaleString();
}

function copyTimes(backups: SaveBackup[]): { path: string; when: string }[] {
  const found = backups.flatMap((backup) => {
    const when = copyWhen(backup);
    return when ? [{ path: backup.path, when }] : [];
  });
  return found.map((copy, index) => ({
    path: copy.path,
    when: index === 0 ? `Last copy · ${copy.when}` : copy.when,
  }));
}

function CloudSendButton({
  clouds,
  busy,
  disabled,
  onSend,
}: {
  clouds: CloudAccount[];
  busy: boolean;
  disabled: boolean;
  onSend: (target: CloudAccount | 'all') => void;
}) {
  return (
    <CloudActionButton
      clouds={clouds}
      busy={busy}
      disabled={disabled}
      icon={CloudUpload}
      label="To the cloud"
      busyLabel="Sending…"
      allowAll
      compact
      onPick={onSend}
    />
  );
}

function CloudActionButton({
  clouds,
  busy,
  disabled,
  icon: Icon,
  label,
  busyLabel,
  allowAll = false,
  compact = false,
  onPick,
}: {
  clouds: CloudAccount[];
  busy: boolean;
  disabled: boolean;
  icon: typeof CloudUpload;
  label: string;
  busyLabel: string;
  allowAll?: boolean;
  compact?: boolean;
  onPick: (target: CloudAccount | 'all') => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const className = compact
    ? 'flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-fg hover:border-accent disabled:opacity-40'
    : 'inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-50';

  if (clouds.length <= 1) {
    return (
      <button
        type="button"
        disabled={disabled || busy || clouds.length === 0}
        onClick={() => onPick(clouds[0] ?? 'all')}
        className={className}
      >
        <Icon className={compact ? 'size-3.5' : 'size-4'} />
        {busy ? busyLabel : label}
      </button>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((value) => !value)}
        className={className}
      >
        <Icon className={compact ? 'size-3.5' : 'size-4'} />
        {busy ? busyLabel : label}
        <ChevronDown className={compact ? 'size-3.5' : 'size-4'} />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 min-w-52 rounded-xl border border-line bg-panel p-1 shadow-xl">
          {clouds.map((cloud) => (
            <button
              key={cloud.remote}
              type="button"
              className="block w-full rounded-lg px-3 py-1.5 text-left text-xs text-fg hover:bg-accent/15"
              onClick={() => {
                setOpen(false);
                onPick(cloud);
              }}
            >
              {cloudLabel(cloud, clouds)}
            </button>
          ))}
          {allowAll && (
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-fg hover:bg-accent/15"
              onClick={() => {
                setOpen(false);
                onPick('all');
              }}
            >
              All clouds
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SaveRow({
  game,
  auto,
  dir,
  settings,
  refreshToken,
  onAuto,
  onDir,
  clouds,
  onCloud,
  onRestore,
  cloudBusy,
  looked,
}: {
  game: Game;
  auto: boolean;
  dir: string;
  settings: Settings;
  refreshToken: number;
  onAuto: (on: boolean) => void;
  onDir: (dir: string) => void;
  clouds: CloudAccount[];
  onCloud: (target: CloudAccount | 'all') => Promise<void>;
  onRestore: (cloud: CloudAccount) => void;
  cloudBusy: boolean;
  looked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (!isNative()) return;
    void listSaves(game.id, game.title, savePlaceOf(game, settings)).then(setBackups).catch(() => setBackups([]));
  };
  useEffect(refresh, [game.id, game.title, settings.saves?.backupRoot, game.meta?.developer, refreshToken]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      say(done);
      refresh();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-line px-4 py-3">
      <Checkbox
        checked={auto}
        onChange={onAuto}
        label="Back up when the session ends"
        hint="Orbit takes a copy as the clock stops. It does not do this for a session that was already over when Orbit opened."
      />
      <div>
        <p className="mb-1 text-xs text-muted">Save folder</p>
        {!dir && !looked && isNative() ? (
          <p className="text-xs text-muted">Looking for the save folder…</p>
        ) : (
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm"
              value={dir}
              onChange={(e) => onDir(e.target.value)}
              placeholder={looked ? 'No save folder found. Name it if the search missed it.' : 'The folder the game writes into'}
              spellCheck={false}
            />
            {isNative() && (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-muted hover:border-accent hover:text-fg"
                onClick={() => void pickFolder('Where does this game keep its saves?').then((p) => p && onDir(p))}
              >
                <FolderOpen className="size-3.5" />
                Browse
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !isNative()}
          onClick={() => void run(async () => {
            await backupSave(game.id, game.title, dir || null, saveHintsOf(game), savePlaceOf(game, settings));
            try {
              await sendCloudAfterBackup(settings.saves, settings.saves?.backupRoot, [cloudGameOf(game, dir)]);
            } catch (e) {
              say(`The copy is on this PC. The cloud did not take it. ${String(e).replace(/^Error:\s*/, '')}`);
            }
          }, `Backed up ${game.title}`)}
          className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          <HardDriveDownload className="size-3.5" />
          Back up now
        </button>
        <CloudSendButton
          clouds={clouds}
          busy={busy || cloudBusy}
          disabled={!isNative()}
          onSend={(target) => void run(
            () => onCloud(target),
            target === 'all' ? `Sent ${game.title} to every cloud` : `Sent ${game.title} to ${cloudLabel(target, clouds)}`,
          )}
        />
        <button
          disabled={busy || cloudBusy || !isNative()}
          onClick={() => void run(() => restoreSave(game.id, game.title, dir || null, saveHintsOf(game), savePlaceOf(game, settings)), `Restored ${game.title}`)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-40"
        >
          <ArchiveRestore className="size-3.5" />
          Restore latest
        </button>
        {clouds.length > 0 && (
          <CloudActionButton
            clouds={clouds}
            busy={busy || cloudBusy}
            disabled={!isNative()}
            icon={CloudDownload}
            label="From the cloud"
            busyLabel="Restoring…"
            compact
            onPick={(target) => {
              if (target !== 'all') onRestore(target);
            }}
          />
        )}
        {!dir && (
          <button
            disabled={busy || !isNative()}
            onClick={() =>
              void run(async () => {
                const found = await findSave(game.title, saveHintsOf(game));
                if (!found) throw new Error(`Orbit could not find a save folder for ${game.title}.`);
                onDir(found);
              }, `Found a save folder for ${game.title}`)
            }
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-40"
          >
            <Search className="size-3.5" />
            Look again
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {backups && copyTimes(backups).length > 0 && (
        <div className="space-y-1 text-xs text-muted">
          <p>Copies on this PC</p>
          <ul className="space-y-1">
            {copyTimes(backups).map((copy) => (
              <li key={copy.path} className="truncate">{copy.when}</li>
            ))}
          </ul>
        </div>
      )}
      {!isNative() && <p className="text-xs text-muted">Backups run in the desktop app, not in a browser tab.</p>}
    </div>
  );
}