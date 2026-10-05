import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderPlus, PackagePlus, RefreshCw, X } from 'lucide-react';
import type { Game } from '../types';
import { diskSpace, folderSize, listDrives, revealInExplorer, type DriveInfo } from '../services/native';
import { pickFolder } from '../services/desktop';
import { fmtBytes } from '../utils/format';
import { folderOf } from '../utils/paths';
import { btnGhost } from './ui/Modal';

function Bar({ used, total }: { used: number; total: number | null }) {
  if (!total || total <= 0) return <div className="h-2 rounded-full bg-panel2" />;
  const pct = Math.max(0, Math.min(100, (used / total) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-panel2">
      <div
        className={pct > 90 ? 'h-full rounded-full bg-rose-500' : 'h-full rounded-full bg-gradient-to-r from-accent to-accent2'}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Where the disk has gone.
 *
 * Folder sizes come from Rust walking each folder, which is slow on a big
 * library, so they are measured when a folder is added or when Refresh is
 * pressed — not on every edit to a game. Which folder a game belongs to is just
 * a path prefix, so that part is worked out here with no round trips.
 */
export function StorageView({
  games,
  folders,
  setFolders,
  onImport,
}: {
  games: Game[];
  folders: string[];
  setFolders: (next: string[]) => void;
  onImport: (folder: string) => void;
}) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [busy, setBusy] = useState(false);

  /** The folder a game sits in, or null when it is outside all of them. */
  const ownerOf = useCallback((game: Game): string | null => (game.installDir ? folderOf(folders, game.installDir) : null), [folders]);

  const measure = useCallback(async () => {
    setBusy(true);
    try {
      const list = await listDrives();
      setDrives(list);
      const next: Record<string, number> = {};
      for (const path of folders) next[path] = await folderSize(path);
      setSizes(next);
    } finally {
      setBusy(false);
    }
  }, [folders]);

  useEffect(() => {
    void measure();
  }, [measure]);

  // Room left on the drive each folder is on, which does not need a disk walk.
  const [spaceBy, setSpaceBy] = useState<Record<string, [number, number] | null>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, [number, number] | null> = {};
      for (const path of folders) next[path] = await diskSpace(path);
      if (alive) setSpaceBy(next);
    })();
    return () => {
      alive = false;
    };
  }, [folders]);

  const addFolder = async () => {
    const picked = await pickFolder('Choose a library folder');
    if (picked && !folders.some((f) => f.toLowerCase() === picked.toLowerCase())) {
      setFolders([...folders, picked]);
    }
  };

  const owned = useMemo(() => {
    const map: Record<string, Game[]> = {};
    for (const f of folders) map[f] = [];
    const outside: Game[] = [];
    for (const g of games) {
      const owner = ownerOf(g);
      if (owner && map[owner]) map[owner].push(g);
      else outside.push(g);
    }
    return { map, outside };
  }, [games, folders, ownerOf]);

  const grand = folders.reduce((s, f) => s + (sizes[f] ?? 0), 0);

  return (
    <div className="mx-6 mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {drives.map((d) => (
          <div key={d.drive} className="glass rounded-2xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-muted">
              {d.drive} {d.label && d.label !== '' ? d.label : ''}
            </p>
            <p className="mt-0.5 text-xl font-bold">{fmtBytes(d.free)}</p>
            <p className="mb-2 text-[11px] text-muted">free of {fmtBytes(d.total)}</p>
            <Bar used={d.total - d.free} total={d.total} />
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Library folders</h2>
          <div className="flex-1" />
          <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void addFolder()}>
            <FolderPlus className="size-4" />
            Add folder
          </button>
          <button
            className={`${btnGhost} flex items-center gap-2`}
            onClick={() => void measure()}
            disabled={busy}
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Measuring…' : 'Refresh sizes'}
          </button>
        </div>

        {folders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            No library folders yet. Add one and Orbit will only ever move games between folders you list here.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {fmtBytes(grand)} across {folders.length} {folders.length === 1 ? 'folder' : 'folders'}.
            </p>
            {folders.map((path) => {
              const list = owned.map[path] ?? [];
              const free = spaceBy[path];
              return (
                <div key={path} className="rounded-xl border border-line bg-panel2/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="min-w-0 flex-1 truncate text-left font-mono text-sm hover:text-accent hover:underline"
                      onClick={() => void revealInExplorer(path)}
                      title="Open in Explorer"
                    >
                      {path}
                    </button>
                    <span className="rounded-full bg-panel px-2 py-0.5 text-xs">
                      {list.length} {list.length === 1 ? 'game' : 'games'}
                    </span>
                    <span className="text-sm font-mono">{sizes[path] !== undefined ? fmtBytes(sizes[path]) : '…'}</span>
                    <button
                      className={`${btnGhost} flex items-center gap-2`}
                      onClick={() => void revealInExplorer(path)}
                    >
                      <FolderOpen className="size-4" />
                      Open
                    </button>
                    <button
                      className={`${btnGhost} flex items-center gap-2`}
                      onClick={() => onImport(path)}
                      title="Add the games found in this folder"
                    >
                      <PackagePlus className="size-4" />
                      Add games
                    </button>
                    <button
                      className="flex items-center gap-1.5 text-xs text-muted hover:text-rose-400"
                      onClick={() => setFolders(folders.filter((f) => f !== path))}
                    >
                      <X className="size-3.5" />
                      Remove
                    </button>
                  </div>
                  <div className="mt-2">
                    <Bar used={sizes[path] ?? 0} total={free ? free[0] : null} />
                  </div>
                  {free && <p className="mt-1 text-[11px] text-muted">{fmtBytes(free[1])} free on this drive</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {owned.outside.length > 0 && (
        <div className="glass rounded-2xl border-amber-500/30 p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted">Outside your library folders</h2>
          <p className="mb-3 text-xs text-muted">
            Orbit will launch and time these, but never move or delete them, because it did not put them there.
          </p>
          <div className="space-y-1">
            {owned.outside.map((g) => (
              <div key={g.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{g.title}</span>
                <span className="truncate font-mono text-xs text-muted">{g.installDir ?? 'no folder recorded'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}