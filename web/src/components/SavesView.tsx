import { useEffect, useState } from 'react';
import { ArchiveRestore, FolderOpen, HardDriveDownload, RefreshCw, Search } from 'lucide-react';
import type { Game, Settings } from '../types';
import { pickFolder } from '../services/desktop';
import {
  backupSave,
  findSave,
  isNative,
  listSaves,
  restoreSave,
  saveHintsOf,
  savePlaceOf,
  savesStatus,
  suggestSaves,
  type SaveBackup,
  type SaveStatus,
} from '../services/native';
import { Checkbox } from './ui/Checkbox';
import { Cover } from './ui/Cover';
import { btnAccent } from './ui/buttons';
import { say } from '../utils/toast';
import { cn } from '../utils/cn';

/**
 * Copies of the files a game writes while it is played.
 *
 * Orbit looks in the usual places — Documents, Saved Games, the game's own
 * folder, a Wine prefix, a Steam prefix — and copies what it finds. Nothing
 * else has to be installed. A folder the player names is used instead. A
 * backup never leaves the machine.
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
  const rows = [...games].sort((a, b) => a.title.localeCompare(b.title));
  const auto = settings.saves?.auto ?? [];
  const dirs = settings.saves?.dirs ?? {};

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

  const backupAll = async () => {
    if (!isNative() || backingAll) return;
    setBackingAll(true);
    let copied = 0;
    let skipped = 0;
    for (const game of rows) {
      try {
        await backupSave(game.id, game.title, dirs[game.id] ?? null, saveHintsOf(game), savePlaceOf(game, settings));
        copied += 1;
      } catch {
        skipped += 1;
      }
    }
    setBackingAll(false);
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Saves</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            A copy of each game's save files, made here and kept on this machine. Turn auto on and
            Orbit takes one when a session ends. Nothing else has to be installed.
          </p>
        </div>
        {isNative() && rows.length > 0 && (
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

      {status?.root && (
        <p className="mb-4 text-xs text-muted">
          Copies are kept in <span className="text-fg">{status.root}</span>.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Add a game first. A backup needs something to belong to.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((game) => (
            <li key={game.id} className="rounded-xl border border-line bg-panel/60">
              <button
                onClick={() => setOpenId((current) => (current === game.id ? null : game.id))}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Cover game={game} className="h-28 w-20 shrink-0 overflow-hidden rounded-xl shadow-sm [&_span]:text-sm" />
                  <span className="min-w-0">
                  <span className="block truncate font-medium">{game.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {auto.includes(game.id) ? 'Backs up when a session ends' : 'Manual only'}
                    {dirs[game.id] ? ` · ${dirs[game.id]}` : ''}
                  </span>
                  </span>
                </span>
                <span className="text-xs text-muted">{openId === game.id ? 'Hide' : 'Manage'}</span>
              </button>
              {openId === game.id && (
                <div className="save-manage-in">
                  <SaveRow
                    game={game}
                    auto={auto.includes(game.id)}
                    dir={dirs[game.id] ?? ''}
                    settings={settings}
                    onAuto={(on) => setAuto(game.id, on)}
                    onDir={(dir) => setDir(game.id, dir)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

function SaveRow({
  game,
  auto,
  dir,
  settings,
  onAuto,
  onDir,
}: {
  game: Game;
  auto: boolean;
  dir: string;
  settings: Settings;
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
  useEffect(refresh, [game.id, game.title, settings.saves?.backupRoot, game.meta?.developer]);

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
          onClick={() => void run(() => backupSave(game.id, game.title, dir || null, saveHintsOf(game), savePlaceOf(game, settings)), `Backed up ${game.title}`)}
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
              {backup.kind} · {new Date(backup.at * 1000).toLocaleString()}
              {backup.note ? ` · ${backup.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      {!isNative() && <p className="text-xs text-muted">Backups run in the desktop app, not in a browser tab.</p>}
    </div>
  );
}
