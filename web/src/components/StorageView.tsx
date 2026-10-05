import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderPlus, HardDrive, MoveRight, PackagePlus, RefreshCw, X } from 'lucide-react';
import type { Game } from '../types';
import { cachedSizes, diskSpace, listDrives, refreshSizes, revealInExplorer, type DriveInfo } from '../services/native';
import { pickFolder } from '../services/desktop';
import { fmtBytes } from '../utils/format';
import { folderOf } from '../utils/paths';
import { btnGhost } from './ui/Modal';
import { Cover } from './ui/Cover';

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
 * Where the games in the library actually live.
 *
 * This page is about the games Orbit already knows, not about finding new ones:
 * every game is listed with its drive and folder, and moving one to another
 * drive is a button rather than a trip through Explorer. The only scanning left
 * is the folder importer, which sits with the library folders further down.
 */
export function StorageView({
  games,
  folders,
  setFolders,
  onMove,
  onImport,
}: {
  games: Game[];
  folders: string[];
  setFolders: (next: string[]) => void;
  /** Opens the move dialog for one game. */
  onMove: (gameId: string) => void;
  /** Hands a folder to the importer, for games not added yet. */
  onImport: (folder: string) => void;
}) {
  /** Folder sizes, as measured at startup and remembered by Rust. */
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [measuring, setMeasuring] = useState(false);

  /** The folder a game sits in, or null when it is outside all of them. */
  const ownerOf = useCallback((game: Game): string | null => (game.installDir ? folderOf(folders, game.installDir) : null), [folders]);

  /**
   * Read the sizes Orbit already measured.
   *
   * Nothing here walks the disk: the measurement happens in the background when
   * the app starts, and this only asks what is known. A folder with no answer
   * yet shows as pending rather than as empty, and the Refresh button is there
   * for anyone who has added a game since.
   */
  const read = useCallback(async () => {
    setDrives(await listDrives());
    setSizes(await cachedSizes());
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  /** Measure again, which is the one thing on this page that reads the disk. */
  const measure = useCallback(async () => {
    setMeasuring(true);
    try {
      setSizes(await refreshSizes(folders));
    } finally {
      setMeasuring(false);
    }
  }, [folders]);

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

  /**
   * The games, grouped by the drive they are on.
   *
   * A drive is what a player moves a game between, so that is the grouping that
   * makes the move button obvious. Anything with no recorded folder gets its own
   * group rather than being hidden.
   */
  const byDrive = useMemo(() => {
    const groups = new Map<string, Game[]>();
    for (const g of games) {
      const drive = (g.drive || g.installDir?.slice(0, 2) || '').toUpperCase() || 'Unknown drive';
      groups.set(drive, [...(groups.get(drive) ?? []), g]);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => b.sizeBytes - a.sizeBytes || a.title.localeCompare(b.title));
    }
    // Closest to full first: D: is the one someone is trying to empty.
    const freeOf = (drive: string) => drives.find((d) => d.drive.toUpperCase().startsWith(drive))?.free ?? Number.MAX_SAFE_INTEGER;
    return [...groups.entries()].sort((a, b) => freeOf(a[0]) - freeOf(b[0]));
  }, [games, drives]);

  const totalSize = games.reduce((s, g) => s + (g.sizeBytes || 0), 0);
  const grand = folders.reduce((s, f) => s + (sizes[f] ?? 0), 0);
  const movable = games.filter((g) => g.installDir).length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HardDrive className="size-6 text-accent" />
            Storage
          </h1>
          <p className="mt-1 text-sm text-muted">
            Where the games in your library live, and how to move them somewhere with more room.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{fmtBytes(totalSize)}</p>
          <p className="text-[11px] text-muted">
            {games.length} {games.length === 1 ? 'game' : 'games'}
            {movable < games.length && ` · ${games.length - movable} with no folder recorded`}
          </p>
        </div>
      </header>

      {drives.length > 0 && (
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
      )}

      <section className="glass rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted">
            <HardDrive className="size-4" />
            Your games
          </h2>
          <div className="flex-1" />
          <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void measure()} disabled={measuring}>
            <RefreshCw className={`size-4 ${measuring ? 'animate-spin' : ''}`} />
            {measuring ? 'Measuring…' : 'Measure again'}
          </button>
        </div>

        {games.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Nothing in the library yet.</p>
        ) : (
          <div className="space-y-4">
            {byDrive.map(([drive, list]) => {
              const info = drives.find((d) => d.drive.toUpperCase().startsWith(drive));
              return (
                <div key={drive}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-accent">{drive}</h3>
                    <span className="text-[11px] text-muted">
                      {fmtBytes(list.reduce((s, g) => s + (g.sizeBytes || 0), 0))}
                      {info ? ` · ${fmtBytes(info.free)} free` : ''}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {list.map((g) => (
                      <li
                        key={g.id}
                        className="flex items-center gap-3 rounded-xl border border-line bg-panel2/40 px-3 py-2"
                      >
                        <Cover game={g} className="size-9 shrink-0 rounded-lg [&_span]:text-[10px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{g.title}</p>
                          <p className="truncate font-mono text-[11px] text-muted">
                            {g.installDir ?? 'no folder recorded, so Orbit cannot move this one'}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-muted">
                          {g.sizeBytes > 0 ? fmtBytes(g.sizeBytes) : '-'}
                        </span>
                        {g.installDir ? (
                          <button
                            onClick={() => onMove(g.id)}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                          >
                            <MoveRight className="size-3.5" />
                            Move…
                          </button>
                        ) : (
                          <span className="shrink-0 text-[11px] text-muted">not movable</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">Library folders</h2>
          <div className="flex-1" />
          <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void addFolder()}>
            <FolderPlus className="size-4" />
            Add folder
          </button>
        </div>

        {folders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No library folders yet. Add one and Orbit will only ever move games between folders you list here.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {fmtBytes(grand)} across {folders.length} {folders.length === 1 ? 'folder' : 'folders'}, measured once when
              Orbit starts. Games are only ever moved between these.
            </p>
            {folders.map((path) => {
              const list = games.filter((g) => ownerOf(g) === path);
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
                    <span className="font-mono text-sm" title={sizes[path] === undefined ? 'Still being measured in the background' : undefined}>
                      {sizes[path] !== undefined ? fmtBytes(sizes[path]) : 'measuring…'}
                    </span>
                    <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void revealInExplorer(path)}>
                      <FolderOpen className="size-4" />
                      Open
                    </button>
                    <button
                      className={`${btnGhost} flex items-center gap-2`}
                      onClick={() => onImport(path)}
                      title="Look through this folder for games that are not in the library yet"
                    >
                      <PackagePlus className="size-4" />
                      Scan for games
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
      </section>
    </div>
  );
}
