import { useEffect, useState } from 'react';
import { ArchiveRestore, FolderOpen, Ghost, HardDriveDownload, RefreshCw } from 'lucide-react';
import type { Game, Settings } from '../types';
import { openExternal, pickFolder } from '../services/desktop';
import {
  backupSave,
  isNative,
  listSaves,
  restoreSave,
  savesStatus,
  suggestSaves,
  type SaveBackup,
  type SaveStatus,
} from '../services/native';
import { Checkbox } from './ui/Checkbox';
import { say } from '../utils/toast';
import { cn } from '../utils/cn';

/**
 * Copies of the files a game writes while it is played.
 *
 * ludusavi finds those files from PCGamingWiki when it is installed. Without
 * it, Orbit copies a folder the player names, and can still ask the wiki
 * where that folder usually is. A backup never leaves the machine.
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
  const rows = [...games].sort((a, b) => a.title.localeCompare(b.title));
  const auto = settings.saves?.auto ?? [];
  const dirs = settings.saves?.dirs ?? {};

  useEffect(() => {
    if (!isNative()) return;
    void savesStatus().then(setStatus).catch(() => undefined);
  }, []);

  const setAuto = (id: string, on: boolean) => {
    const next = on ? [...new Set([...auto, id])] : auto.filter((item) => item !== id);
    setSettings({ saves: { ...settings.saves, auto: next, dirs } });
  };
  const setDir = (id: string, dir: string) => {
    setSettings({ saves: { ...settings.saves, auto, dirs: { ...dirs, [id]: dir } } });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Saves</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            A copy of each game's save files, made here and kept on this machine. Turn auto on and
            Orbit takes one when a session ends.
          </p>
        </div>
        <button
          onClick={() => void openExternal('https://github.com/mtkennerly/ludusavi')}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg"
        >
          ludusavi
        </button>
      </div>

      {status && !status.ludusavi && (
        <p className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
          ludusavi is not installed, so Orbit cannot find save folders by itself. Name a folder for
          a game, or install ludusavi and it will use the PCGamingWiki list. Ghost Hunter Pro can
          clean leftovers; it does not replace a backup.
        </p>
      )}
      {status?.ludusavi && (
        <p className="mb-4 text-xs text-muted">
          ludusavi is installed. Backups go to <span className="text-fg">{status.root}</span>.
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
                <span className="min-w-0">
                  <span className="block truncate font-medium">{game.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {auto.includes(game.id) ? 'Backs up when a session ends' : 'Manual only'}
                    {dirs[game.id] ? ` · ${dirs[game.id]}` : ''}
                  </span>
                </span>
                <span className="text-xs text-muted">{openId === game.id ? 'Hide' : 'Manage'}</span>
              </button>
              {openId === game.id && (
                <SaveRow
                  game={game}
                  auto={auto.includes(game.id)}
                  dir={dirs[game.id] ?? ''}
                  onAuto={(on) => setAuto(game.id, on)}
                  onDir={(dir) => setDir(game.id, dir)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => void openExternal('https://github.com/MarchTheDev/GhostHunterPro')}
        className="mt-6 flex items-center gap-2 text-xs text-muted hover:text-fg"
      >
        <Ghost className="size-3.5" />
        Ghost Hunter Pro finds leftover save data. It is separate from these copies.
      </button>
    </div>
  );
}

function SaveRow({
  game,
  auto,
  dir,
  onAuto,
  onDir,
}: {
  game: Game;
  auto: boolean;
  dir: string;
  onAuto: (on: boolean) => void;
  onDir: (dir: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [hints, setHints] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (!isNative()) return;
    void listSaves(game.id, game.title).then(setBackups).catch(() => setBackups([]));
  };
  useEffect(refresh, [game.id, game.title]);

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
        <span className="mb-1 block text-xs text-muted">Save folder, if ludusavi is not finding it</span>
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
          onClick={() => void run(() => backupSave(game.id, game.title, dir || null), `Backed up ${game.title}`)}
          className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          <HardDriveDownload className="size-3.5" />
          Back up now
        </button>
        <button
          disabled={busy || !isNative()}
          onClick={() => void run(() => restoreSave(game.id, game.title, dir || null), `Restored ${game.title}`)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg disabled:opacity-40"
        >
          <ArchiveRestore className="size-3.5" />
          Restore latest
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
          Ask PCGamingWiki
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
