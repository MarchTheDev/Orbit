import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, PackagePlus, X } from 'lucide-react';
import type { Game } from '../types';
import { exeInfo, knownExePaths, scanFolder, type FoundGame } from '../services/native';
import { pickFolder } from '../services/desktop';
import { fetchMetadata as fetchGameMetadata } from '../services/metadata';
import { fetchHltb } from '../services/hltb';
import { fmtBytes, hashHue, uid } from '../utils/format';
import { Modal, btnGhost, btnPrimary, inputCls } from './ui/Modal';

/** A game Orbit found on disk, with the player's say-so on each one. */
interface Candidate {
  key: string;
  title: string;
  exePath: string;
  installDir: string;
  drive: string;
  sizeBytes: number;
  coverPath: string | null;
  include: boolean;
}

/**
 * Bring a folder of games into the library.
 *
 * Orbit looks for things that look like a game, shows what it found with the
 * size and cover it worked out, and adds only what is ticked. Anything already
 * in the library is greyed out rather than added twice.
 */
export function ImportModal({
  existing,
  initialFolder,
  credentials,
  fetchMetadata,
  onAdd,
  onUpdate,
  onClose,
}: {
  existing: Game[];
  /** A folder chosen elsewhere, such as on the Storage page. */
  initialFolder: string | null;
  /** IGDB credentials, if the player saved any. The store needs none. */
  credentials: { clientId: string; clientSecret: string; token: string };
  fetchMetadata: boolean;
  onAdd: (games: Game[]) => void;
  onUpdate: (id: string, patch: Partial<Game>) => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The folder currently being looked at, so a repeat ask can be ignored. */
  const scanned = useRef<string | null>(null);

  const inspect = useCallback(
    async (path: string, force = false) => {
      // A scan walks the folder and measures every candidate, so the same folder
      // is never scanned twice at once. StrictMode runs effects twice on mount,
      // which would otherwise scan whatever the Storage page handed over twice.
      if (!force && scanned.current === path) return;
      scanned.current = path;
      setBusy(true);
      setFolder(path);
      try {
        const [found, known] = await Promise.all([scanFolder(path, 1), knownExePaths()]);
        const already = new Set(known.map((p) => p.toLowerCase()));
        const chosen = new Set(existing.map((g) => g.exePath?.toLowerCase() ?? ''));

        const next: Candidate[] = [];
        for (const f of found) {
          // Anything already tracked, by path or by folder, is not offered again.
          if (already.has(f.exePath.toLowerCase()) || chosen.has(f.exePath.toLowerCase())) continue;
          next.push(await describe(f, path));
        }
        // Keep the biggest first: that is usually the game rather than a launcher
        // or a redistributable.
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

  const importAll = async () => {
    const included = rows.filter((r) => r.include);
    if (included.length === 0) return;
    setSaving(true);
    try {
      const games: Game[] = included.map((c) => ({
        id: uid(),
        title: c.title,
        launch: { kind: 'executable', path: c.exePath, args: '', workingDir: c.installDir },
        exePath: c.exePath,
        installDir: c.installDir,
        drive: c.drive,
        sizeBytes: c.sizeBytes,
        sizeGb: Math.round((c.sizeBytes / 1e9) * 10) / 10,
        status: 'backlog',
        favorite: false,
        manualPlaySecs: 0,
        playMinutes: 0,
        lastPlayed: null,
        addedAt: new Date().toISOString(),
        notes: '',
        hue: hashHue(c.title),
        coverPath: c.coverPath,
        sessionCount: 0,
        longestSecs: 0,
        running: false,
        logs: [],
      }));
      onAdd(games);

      // Artwork and completion times are a bonus, so they are fetched after the
      // games are already saved. The two sources are independent, so whichever
      // answers is kept and a failure in one never blocks the other.
      if (fetchMetadata) {
        await Promise.all(
          games.map(async (g) => {
            const [meta, hltb] = await Promise.allSettled([
              fetchGameMetadata(g.title, credentials),
              fetchHltb(g.title),
            ]);
            onUpdate(g.id, {
              ...(meta.status === 'fulfilled' ? { igdb: meta.value } : {}),
              ...(hltb.status === 'fulfilled' ? { hltb: hltb.value } : {}),
            });
          }),
        );
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: string) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, include: !r.include } : r)));

  const included = rows.filter((r) => r.include);

  return (
    <Modal
      title="Import from a folder"
      subtitle="Orbit never changes files while importing. It only reads them."
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {included.length} of {rows.length} selected
            {included.length > 0 && ` · ${fmtBytes(included.reduce((s, r) => s + r.sizeBytes, 0))}`}
          </span>
          <div className="flex gap-2">
            <button className={`${btnGhost} flex items-center gap-2`} onClick={onClose} disabled={saving}>
              <X className="size-4" />
              Cancel
            </button>
            <button
              className={`${btnPrimary} flex items-center gap-2`}
              onClick={importAll}
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
          <input className={inputCls} value={folder ?? ''} onChange={(e) => setFolder(e.target.value)} placeholder="D:\Games" spellCheck={false} readOnly />
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

        {busy && <p className="text-sm text-muted">Looking through the folder…</p>}

        {!busy && folder && rows.length === 0 && (
          <p className="rounded-lg border border-line bg-panel2/50 px-3 py-2 text-sm text-muted">
            Nothing in there looks like a game. Orbit looks one folder deep for a program it can run.
          </p>
        )}

        {rows.length > 0 && (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.key}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel2/40 px-3 py-2 hover:border-accent/60">
                  <input type="checkbox" checked={r.include} onChange={() => toggle(r.key)} />
                  <span className="min-w-0 flex-1">
                    <input
                      value={r.title}
                      onChange={(e) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, title: e.target.value } : x)))}
                      onClick={(e) => e.preventDefault()}
                      className="w-full bg-transparent text-sm font-medium outline-none"
                    />
                    <span className="block truncate font-mono text-[11px] text-muted">{r.exePath}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{fmtBytes(r.sizeBytes)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted">
          Titles come from folder and file names, so they may need fixing. {fetchMetadata ? 'Details and artwork are fetched after the games are saved.' : ''}
        </p>
      </div>
    </Modal>
  );
}

/** Measure one found game and work out what to call it. */
async function describe(f: FoundGame, root: string): Promise<Candidate> {
  const info = await exeInfo(f.exePath).catch(() => null);
  return {
    key: f.exePath,
    title: clean(f.title) || clean(f.installDir.replace(root, '').replace(/^[\\/]+/, '')) || 'Untitled',
    exePath: f.exePath,
    installDir: info?.installDir ?? f.installDir,
    drive: info?.drive ?? f.installDir.slice(0, 2).toUpperCase(),
    sizeBytes: f.sizeBytes || info?.sizeBytes || 0,
    coverPath: info?.coverPath ?? null,
    include: true,
  };
}

/** Tidy a folder or file name into something worth showing. */
function clean(name: string): string {
  return name
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}