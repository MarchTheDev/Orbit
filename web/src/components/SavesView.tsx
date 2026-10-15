import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArchiveRestore, Eye, EyeOff, FolderOpen, GripVertical, HardDriveDownload, List, RefreshCw, Search } from 'lucide-react';
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
  suggestSaves,
  sendCloudAfterBackup,
  type SaveBackup,
  type SaveStatus,
} from '../services/native';
import { Checkbox } from './ui/Checkbox';
import { Cover } from './ui/Cover';
import { btnAccent } from './ui/buttons';
import { say } from '../utils/toast';
import { cn } from '../utils/cn';
import { useDragReorder } from '../hooks/useDragReorder';
import { moveInOrder } from '../utils/reorder';
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
  setSettings: (patch: Partial<Settings>) => void;
}) {
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [backingAll, setBackingAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; copies: SaveBackup[] | null } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Game | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const [browseQuery, setBrowseQuery] = useState('');
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
    (fromId, toId, after) => {
      const nextVisible = moveInOrder(listed.map((game) => game.id), fromId, toId, after);
      const order = showHidden || hidden.size === 0
        ? nextVisible
        : keepHiddenSlots(rows.map((game) => game.id), nextVisible, hiddenIds);
      setSettings({
        saves: {
          ...settings.saves,
          order,
        },
      });
    },
    // The row is itself a button, so the press has to be allowed to start there.
    { container: list, fromButtons: true },
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

  const setAuto = (id: string, on: boolean) => {
    const next = on ? [...new Set([...auto, id])] : auto.filter((item) => item !== id);
    setSettings({ saves: { ...settings.saves, auto: next, dirs } });
  };
  const setDir = (id: string, dir: string) => {
    setSettings({ saves: { ...settings.saves, auto, dirs: { ...dirs, [id]: dir } } });
  };
  const afterBackup = () => {
    void sendCloudAfterBackup(settings.saves?.cloud, settings.saves?.backupRoot).catch((e) => {
      say(`The copy is on this PC. The cloud did not take it. ${String(e).replace(/^Error:\s*/, '')}`);
    });
  };
  const setHidden = (id: string, hide: boolean) => {
    const next = hide ? [...new Set([...hiddenIds, id])] : hiddenIds.filter((item) => item !== id);
    setSettings({ saves: { ...settings.saves, hidden: next } });
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
    if (copied > 0) afterBackup();
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
              afterBackup();
            },
            `Backed up ${menuGame.title}`,
          ),
        },
        {
          label: 'Restore latest',
          icon: ArchiveRestore,
          disabled: !isNative(),
          onSelect: () => setRestoreTarget(menuGame),
        },
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
          <CloudPanel settings={settings} setSettings={setSettings} />
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
          {isNative() && listed.length > 0 && (
            <button
              type="button"
              disabled={backingAll}
              onClick={() => void backupAll()}
              className={cn(btnAccent, 'flex items-center gap-2 rounded-lg px-4 py-2 text-sm')}
            >
              <HardDriveDownload className="size-4" />
              {backingAll ? 'Backing up…' : 'Backup all'}
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
                  <span className="block truncate text-xs text-muted">
                    {hidden.has(game.id) ? 'Hidden from Saves · ' : ''}
                    {auto.includes(game.id) ? 'Backs up when a session ends' : 'Manual only'}
                    {dirs[game.id] ? ` · ${dirs[game.id]}` : ''}
                  </span>
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

function SaveRow({
  game,
  auto,
  dir,
  settings,
  refreshToken,
  onAuto,
  onDir,
}: {
  game: Game;
  auto: boolean;
  dir: string;
  settings: Settings;
  refreshToken: number;
  onAuto: (on: boolean) => void;
  onDir: (dir: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [hints, setHints] = useState<string[] | null>(null);
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
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Save folder, if the search looks in the wrong place</span>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm"
            value={dir}
            onChange={(e) => onDir(e.target.value)}
            placeholder="The folder the game writes into"
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
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !isNative()}
          onClick={() => void run(async () => {
            await backupSave(game.id, game.title, dir || null, saveHintsOf(game), savePlaceOf(game, settings));
            try {
              await sendCloudAfterBackup(settings.saves?.cloud, settings.saves?.backupRoot);
            } catch (e) {
              say(`The copy is on this PC. The cloud did not take it. ${String(e).replace(/^Error:\s*/, '')}`);
            }
          }, `Backed up ${game.title}`)}
          className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          <HardDriveDownload className="size-3.5" />
          Back up now
        </button>
        <button
          disabled={busy || !isNative()}
          onClick={() => void run(() => restoreSave(game.id, game.title, dir || null, saveHintsOf(game), savePlaceOf(game, settings)), `Restored ${game.title}`)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-40"
        >
          <ArchiveRestore className="size-3.5" />
          Restore latest
        </button>
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
          Find folder
        </button>
        <button
          disabled={busy || !isNative()}
          onClick={() => {
            setHints(null);
            void suggestSaves(game.title)
              .then(setHints)
              .catch((e) => setError(String(e)));
          }}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-40"
        >
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
          Wiki paths
        </button>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {hints && (
        <ul className="space-y-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-xs text-muted">
          {hints.length === 0 && <li>PCGamingWiki has no save path for this name.</li>}
          {hints.map((hint) => (
            <li key={hint} className="break-all">{hint}</li>
          ))}
        </ul>
      )}
      {backups && backups.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {backups.slice(0, 5).map((backup) => (
            <li key={backup.path} className="truncate">
              {new Date(backup.at * 1000).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
      {!isNative() && <p className="text-xs text-muted">Backups run in the desktop app, not in a browser tab.</p>}
    </div>
  );
}
