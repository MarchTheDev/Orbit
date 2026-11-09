import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, PackagePlus, X } from 'lucide-react';
import type { FolderProgram, Game } from '../types';
import { findCover, folderPrograms, knownExePaths } from '../services/native';
import { pickAnyFile, pickFile, pickFolder } from '../services/desktop';
import { fetchMetadata as fetchGameMetadata } from '../services/metadata';
import { fetchHltb } from '../services/hltb';
import { fmtBytes, hashHue, uid } from '../utils/format';
import { desktopOs, launchForAddedProgram } from '../utils/platform';
import { driveScanDepth } from '../utils/driveScan';
import { gameFolderFromScan, gameTitleFromPath, gameTitleFromScannedProgram } from '../utils/gameTitle';
import { Modal, btnGhost, btnPrimary, inputCls } from './ui/Modal';
import { CheckboxBox } from './ui/Checkbox';
import { ArtworkThumb } from './ui/ArtworkThumb';

/** One game Orbit found, with every program it could be started from. */
interface Candidate {
  key: string;
  title: string;
  installDir: string;
  drive: string;
  sizeBytes: number;
  coverPath: string | null;
  programs: FolderProgram[];
  /** The program currently chosen, as a path. */
  exePath: string;
  include: boolean;
}

/**
 * Bring a folder of games into the library.
 *
 * A game folder usually holds several programs, and the one to run is not
 * always the biggest: a launcher, a crash reporter, a settings tool and the game
 * itself sit together, and the real one may be one or two folders down. So the
 * scan goes deeper, groups what it finds by folder, and every group offers its
 * programs to choose from before anything is added.
 */
export function ImportModal({
  existing,
  initialFolder,
  fetchMetadata,
  onAdd,
  onUpdate,
  onClose,
}: {
  existing: Game[];
  /** A folder chosen elsewhere, such as on the Storage page. */
  initialFolder: string | null;
  fetchMetadata: boolean;
  onAdd: (games: Game[]) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** The folder last scanned, so the same one is not scanned twice in a row. */
  const scanned = useRef<string | null>(null);

  const inspect = useCallback(
    async (path: string, force = false) => {
      // A scan is expensive enough that the same folder must never be walked
      // twice at once. StrictMode runs effects twice on mount, which would
      // otherwise scan whatever Storage handed over twice.
      if (!force && scanned.current === path) return;
      scanned.current = path;
      setBusy(true);
      setFolder(path);
      try {
        const [programs, known] = await Promise.all([folderPrograms(path, driveScanDepth(path)), knownExePaths()]);
        const already = new Set(known.map((p) => p.toLowerCase()));
        const chosen = new Set(existing.map((g) => g.exePath?.toLowerCase() ?? ''));

        // Group candidates under their likely install folder. The scan helper
        // understands drive roots and common Steam/Epic/GOG library containers,
        // then folds nested `bin\\x64\\game.exe` paths into the actual game.
        const groups = new Map<string, FolderProgram[]>();
        for (const program of programs) {
          if (already.has(program.exePath.toLowerCase()) || chosen.has(program.exePath.toLowerCase())) continue;
          const folder = gameFolderFromScan(program.exePath, path);
          groups.set(folder, [...(groups.get(folder) ?? []), program]);
        }

        const next: Candidate[] = [];
        for (const [dir, list] of groups) {
          // Shallowest first: the program next to the game's own folder is the
          // likely one, and the ones buried deeper are the alternatives.
          const ordered = [...list].sort(
            (a, b) => depthOf(a.exePath, dir) - depthOf(b.exePath, dir) || b.sizeBytes - a.sizeBytes,
          );
          const top = ordered[0];
          // A drive scan can yield hundreds of candidates. Avoid a native
          // command per row here; the scanner already returns bounded sizes in
          // one background walk, and catalogue art can load lazily.
          next.push({
            key: dir,
            title: ordered.map((program) => gameTitleFromScannedProgram(program.exePath, dir)).find((title) => title && title !== gameTitleFromPath(dir)) || gameTitleFromPath(dir) || 'Untitled',
            installDir: dir,
            drive: /^[a-z]:/i.exec(dir)?.[0].toUpperCase() ?? '',
            sizeBytes: top.folderBytes || top.sizeBytes || 0,
            coverPath: null,
            programs: ordered,
            exePath: top.exePath,
            // A path scan can return helper programs as well as games. Nothing
            // is selected until the player reviews the candidates and chooses.
            include: false,
          });
        }

        next.sort((a, b) => b.sizeBytes - a.sizeBytes);
        setRows(next);
      } finally {
        setBusy(false);
      }
    },
    [existing],
  );

  // The Storage page hands a folder over, so scanning starts by itself.
  useEffect(() => {
    if (initialFolder) void inspect(initialFolder);
  }, [initialFolder, inspect]);

  const browse = async () => {
    const picked = await pickFolder('Choose a folder of games to import');
    if (picked) await inspect(picked, true);
  };

  /** Swap one candidate's program for another file the player picks. */
  const changeProgram = async (key: string, current: string) => {
    const picked = desktopOs() === 'linux'
      ? await pickAnyFile('Choose the program to run', current || undefined)
      : await pickFile('Choose the program to run', ['exe', 'bat', 'cmd'], current || undefined);
    if (!picked) return;
    setScanning(true);
    try {
      const coverPath = await findCover(picked).catch(() => null);
      setRows((cur) =>
        cur.map((r) =>
          r.key === key
            ? { ...r, exePath: picked, coverPath: coverPath ?? r.coverPath }
            : r,
        ),
      );
    } finally {
      setScanning(false);
    }
  };

  const importAll = async () => {
    const included = rows.filter((r) => r.include && r.exePath);
    if (included.length === 0) return;
    setSaving(true);
    try {
      const games: Game[] = included.map((c) => ({
        id: uid(),
        title: c.title,
        launch: launchForAddedProgram(c.exePath, c.installDir),
        exePath: c.exePath,
        installDir: c.installDir,
        drive: c.drive,
        sizeBytes: c.sizeBytes,
        sizeGb: Math.round((c.sizeBytes / 1e9) * 10) / 10,
        status: 'backlog',
        favorite: false,
        manualPlaySecs: 0,
        playSecs: 0,
        lastPlayed: null,
        addedAt: new Date().toISOString(),
        notes: '',
        hue: hashHue(c.title),
        coverPath: c.coverPath,
        sessionCount: 0,
        longestSecs: 0,
        running: false,
        companions: [],
      }));
      onAdd(games);
      // The import is complete. Close now; catalogue lookups are background
      // enrichment and must not keep the modal (or the Add tab) open.
      onClose();

      // Artwork and completion times are a bonus, fetched independently after
      // the games have been saved. A better store title also replaces a noisy
      // folder-derived guess such as a repack suffix.
      if (fetchMetadata) {
        void Promise.all(
          games.map(async (g) => {
            const [meta, hltb] = await Promise.allSettled([
              fetchGameMetadata(g.title),
              fetchHltb(g.title),
            ]);
            onUpdate(g.id, {
              ...(meta.status === 'fulfilled' ? { meta: meta.value, title: meta.value.name || g.title } : {}),
              ...(hltb.status === 'fulfilled' ? { hltb: hltb.value } : {}),
            });
          }),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: string) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, include: !r.include } : r)));
  const allSelected = rows.length > 0 && rows.every((row) => row.include);
  const toggleAll = () => setRows((current) => current.map((row) => ({ ...row, include: !allSelected })));

  const included = rows.filter((r) => r.include && r.exePath);
  const total = useMemo(() => included.reduce((s, r) => s + r.sizeBytes, 0), [included]);

  return (
    <Modal
      title="Scan a drive or folder for games"
      subtitle="Orbit reads folders and never changes them. Review the candidates and choose which programs to add."
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {included.length} of {rows.length} selected
            {included.length > 0 && ` · ${fmtBytes(total)}`}
          </span>
          <div className="flex gap-2">
            <button className={`${btnGhost} flex items-center gap-2`} onClick={onClose} disabled={saving}>
              <X className="size-4" />
              Cancel
            </button>
            <button
              className={`${btnPrimary} flex items-center gap-2`}
              onClick={() => void importAll()}
              disabled={included.length === 0 || saving}
            >
              <PackagePlus className="size-4" />
              {saving ? 'Adding…' : `Add ${included.length || ''} ${included.length === 1 ? 'game' : 'games'}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={folder ?? ''}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="D:\Games"
            spellCheck={false}
            readOnly
          />
          <button className={btnGhost} onClick={toggleAll} disabled={rows.length === 0 || busy}>
            {allSelected ? 'Clear selection' : 'Select all'}
          </button>
          <button className={`${btnGhost} flex items-center gap-2`} onClick={() => void browse()}>
            <FolderOpen className="size-4" />
            Browse…
          </button>
          {folder && (
            <button className={btnGhost} onClick={() => void inspect(folder, true)} disabled={busy}>
              {busy ? 'Scanning…' : 'Rescan'}
            </button>
          )}
        </div>

        {busy && <p className="text-sm text-muted">Looking for runnable programs… whole-drive scans go deeper than selected game folders.</p>}

        {!busy && folder && rows.length === 0 && (
          <p className="rounded-lg border border-line bg-panel2/50 px-3 py-2 text-sm text-muted">
            Nothing in there looks like a game. Orbit skips operating-system folders at a drive root, installers and common redistributables.
          </p>
        )}

        {rows.length > 0 && (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="rounded-xl border border-line bg-panel2/40 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <CheckboxBox checked={r.include} onChange={() => toggle(r.key)} title={r.title} />
                    <ArtworkThumb title={r.title} lookup={fetchMetadata} />
                    <span className="min-w-0 flex-1">
                      <input
                        value={r.title}
                        onChange={(e) =>
                          setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, title: e.target.value } : x)))
                        }
                        className="w-full bg-transparent text-sm font-medium outline-none"
                      />
                      <span className="block truncate font-mono text-[11px] text-muted">{r.installDir}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{fmtBytes(r.sizeBytes)}</span>
                  </div>

                  {/* Which program to run. A folder with one program still shows
                      it, because the guess deserves to be visible either way. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                    <span className="text-[11px] uppercase tracking-widest text-muted">Runs</span>
                    {r.programs.length > 1 ? (
                      <div className="relative min-w-0 flex-1">
                        <select
                          value={r.exePath}
                          onChange={(e) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, exePath: e.target.value } : x)))}
                          className="w-full appearance-none rounded-lg border border-line bg-panel px-2.5 py-1 pr-8 font-mono text-[11px] outline-none focus:border-accent"
                          title="Which program Orbit starts"
                        >
                          {r.programs.map((p) => (
                            <option key={p.exePath} value={p.exePath}>
                              {p.exePath.replace(`${r.installDir}\\`, '')} · {fmtBytes(p.sizeBytes)}
                            </option>
                          ))}
                          {!r.programs.some((p) => p.exePath === r.exePath) && (
                            <option value={r.exePath}>{r.exePath}</option>
                          )}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                      </div>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                        {r.exePath.replace(`${r.installDir}\\`, '') || 'nothing chosen'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent"
                      onClick={() => void changeProgram(r.key, r.exePath)}
                      disabled={scanning}
                    >
                      Choose another…
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted">
          Titles come from folder names, so they may need fixing, and a game can be renamed later from its own page.
          {fetchMetadata ? ' Details and artwork are fetched after the games are saved.' : ''}
        </p>
      </div>
    </Modal>
  );
}

/** How far below a game folder a program sits, for ordering the choices. */
function depthOf(exePath: string, gameFolder: string): number {
  const relative = exePath.toLowerCase().startsWith(gameFolder.toLowerCase())
    ? exePath.slice(gameFolder.length)
    : exePath;
  return relative.split(/[\\/]+/).filter(Boolean).length;
}
