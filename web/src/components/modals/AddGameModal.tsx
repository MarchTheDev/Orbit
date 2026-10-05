import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, Plus, TriangleAlert, X } from 'lucide-react';
import type { Game, LaunchTarget } from '../../types';
import { exeInfo, isNative, scanFolder } from '../../services/native';
import { fileSrc, pickAnyFile, pickFile, pickFolder } from '../../services/desktop';
import { hashHue, uid } from '../../utils/format';
import { Modal, btnBrowse, btnGhost, btnPrimary, inputCls, labelCls } from '../ui/Modal';

/** What the player has told us so far. */
interface Draft {
  title: string;
  exePath: string;
  installDir: string;
  drive: string;
  sizeGb: number;
  status: Game['status'];
  favorite: boolean;
  notes: string;
  coverPath: string | null;
  steamAppId: string;
  emulatorPath: string;
  romPath: string;
  argsTemplate: string;
}

/**
 * Add a game, however the player has it.
 *
 * Three ways in, because people keep games in different places:
 * - drop the `.exe` on the window
 * - Browse for the `.exe`, which finds the folder around it by itself
 * - Browse for a folder
 * - or type the path, which is the only option in a browser preview
 *
 * Steam and emulator games are handled too, since those have no `.exe` of their
 * own: pick the emulator and the ROM, and Orbit builds the command line.
 */
export function AddGameModal({
  onClose,
  onAdd,
  initialPaths,
}: {
  onClose: () => void;
  onAdd: (g: Game, fetchMeta: boolean) => void;
  /** Programs dropped on the window before the dialog was opened. */
  initialPaths?: string[] | null;
}) {
  const native = isNative();
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<'auto' | 'exe' | 'folder' | 'steam' | 'emulator'>('auto');
  const [fetchMeta, setFetchMeta] = useState(true);
  const [dropped, setDropped] = useState<string[]>([]);
  const [d, setD] = useState<Draft>(() => blank());

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((current) => ({ ...current, [key]: value }));
  }, []);

  /** A program tells us the title, where it lives and how big it is. */
  const takeExe = useCallback(async (exe: string): Promise<boolean> => {
    const info = await describeExe(exe);
    setD((current) => ({
      ...current,
      ...info,
      // A title already typed or picked from a search wins over the file name.
      title: current.title || info.title || '',
    }));
    return true;
  }, []);

  /**
   * Fill the form from what was dropped.
   *
   * A program is used as it is. A folder is looked through first, because
   * dropping a game folder is the more natural thing to do and there is no
   * program to find in the drag itself.
   */
  const takePaths = useCallback(
    async (paths: string[]): Promise<boolean> => {
      const exe = await findDroppedExe(paths);
      return exe ? takeExe(exe) : false;
    },
    [takeExe],
  );

  // The window watches for drops and hands them over as `initialPaths`, whether
  // the dialog was just opened or was already up. Listening here as well would
  // measure the same program twice.
  useEffect(() => {
    if (!initialPaths || initialPaths.length === 0) return;
    setDropped(initialPaths);
    void takePaths(initialPaths).then((ok) => {
      if (ok) setMode('exe');
    });
  }, [initialPaths, takePaths]);

  // Guess from a folder: the biggest thing in it is the game.
  const takeFolder = useCallback(
    async (folder: string) => {
      const found = await scanFolder(folder, 1);
      const best = found.sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
      setD((current) => ({
        ...current,
        installDir: best?.installDir ?? folder,
        drive: folder.slice(0, 2).toUpperCase(),
        exePath: best?.exePath ?? current.exePath,
        title: current.title || best?.title || folder.replace(/\\+$/, '').split('\\').pop() || current.title,
      }));
      if (best?.exePath) await takePaths([best.exePath]);
    },
    [takePaths],
  );

  const browseExe = async () => {
    const picked = await pickFile('Choose the game program', ['exe', 'bat', 'cmd'], d.installDir || undefined);
    if (picked) await takePaths([picked]);
  };

  const browseFolder = async () => {
    const picked = await pickFolder('Choose the game folder', d.installDir || undefined);
    if (picked) await takeFolder(picked);
  };

  const browseRom = async () => {
    const picked = await pickAnyFile('Choose the ROM', d.emulatorPath || undefined);
    if (picked) {
      set('romPath', picked);
      if (!d.title) set('title', picked.replace(/\\[^\\]+$/, '').split('\\').pop() ?? '');
    }
  };

  const browseEmulator = async () => {
    const picked = await pickFile('Choose the emulator', ['exe', 'bat', 'cmd']);
    if (picked) set('emulatorPath', picked);
  };

  const browseCover = async () => {
    const picked = await pickAnyFile('Choose cover art', d.installDir || undefined);
    if (picked) set('coverPath', picked);
  };

  /** Offer the store's own titles, so a typo does not become a permanent entry. */
  const search = async () => {
    const title = d.title.trim();
    if (title.length < 2) return;
    setSearching(true);
    try {
      const { searchTitles } = await import('../../services/metadata');
      setSuggestions(await searchTitles(title));
      setFetchMeta(true);
    } finally {
      setSearching(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true);
    try {
      onAdd(buildGame(d, mode), fetchMeta);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Whatever the chosen mode still needs, named so the form can say it out loud.
   * Without this the game would save as a timer and the reason would only turn up
   * when Play did nothing.
   */
  const missing =
    mode === 'steam'
      ? d.steamAppId.trim()
        ? null
        : 'a Steam app id'
      : mode === 'emulator'
        ? !d.emulatorPath
          ? 'the emulator'
          : !d.romPath
            ? 'the ROM'
            : null
        : !d.exePath.trim()
          ? 'the program'
          : null;

  return (
    <Modal
      title="Add a game"
      subtitle="Drop a program on the window, or browse for it."
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={fetchMeta} onChange={(e) => setFetchMeta(e.target.checked)} />
            Fetch artwork and details
          </label>
          <div className="flex gap-2">
            <button type="button" className={`${btnGhost} flex items-center gap-2`} onClick={onClose}>
              <X className="size-4" />
              Cancel
            </button>
            <button
              className={`${btnPrimary} flex items-center gap-2`}
              onClick={submit}
              disabled={!d.title.trim() || busy}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? 'Adding…' : 'Add game'}
            </button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {dropped.length > 0 && (
          <div className="space-y-1 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Ready to add:</span>
              {dropped.map((p) => (
                <span key={p} className="max-w-[18rem] truncate font-mono">
                  {p}
                </span>
              ))}
            </div>
            {dropped.some((p) => /\.lnk$/i.test(p)) && (
              <p className="flex items-start gap-1.5 text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                A Windows shortcut does not say where the program lives. Browse for the game's .exe instead.
              </p>
            )}
          </div>
        )}

        <div>
          <span className={labelCls}>How is this game launched?</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['auto', 'Just a program'],
                ['exe', 'Browse for .exe'],
                ['folder', 'Browse for folder'],
                ['steam', 'Steam'],
                ['emulator', 'Emulator + ROM'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${
                  mode === id ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:border-accent/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {missing && (
            <p className="mt-2 text-xs text-muted">
              Without {missing}, this game is only timed — Orbit will not start it. You can fill it in later.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className={labelCls}>Title</span>
            <input
              className={inputCls}
              value={d.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Hollow Knight"
              list="orbit-title-suggestions"
            />
            <datalist id="orbit-title-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          {native && (
            <button type="button" className={`${btnBrowse} mt-5 flex items-center gap-2`} onClick={() => void search()} disabled={searching}>
              {searching ? 'Searching…' : 'Search IGDB'}
            </button>
          )}
        </div>

        {(mode === 'auto' || mode === 'exe' || mode === 'folder') && (
          <>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className={labelCls}>Program</span>
                <input
                  className={inputCls}
                  value={d.exePath}
                  onChange={(e) => set('exePath', e.target.value)}
                  placeholder="D:\Games\Hollow Knight\hollow_knight.exe"
                  spellCheck={false}
                />
              </label>
              <button type="button" className={`${btnBrowse} mt-5 flex items-center gap-2`} onClick={() => void browseExe()}>
                <FolderOpen className="size-4" />
                Browse…
              </button>
            </div>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className={labelCls}>Install folder</span>
                <input
                  className={inputCls}
                  value={d.installDir}
                  onChange={(e) => set('installDir', e.target.value)}
                  placeholder="D:\Games\Hollow Knight"
                  spellCheck={false}
                />
              </label>
              <button type="button" className={`${btnBrowse} mt-5 flex items-center gap-2`} onClick={() => void browseFolder()}>
                <FolderOpen className="size-4" />
                Browse…
              </button>
            </div>
          </>
        )}

        {mode === 'steam' && (
          <div className="space-y-3 rounded-xl border border-line bg-panel2/40 p-3">
            <label className="block">
              <span className={labelCls}>Steam app id</span>
              <input
                className={inputCls}
                value={d.steamAppId}
                onChange={(e) => set('steamAppId', e.target.value.replace(/\D/g, ''))}
                placeholder="367520, or 620 for Portal 2"
                inputMode="numeric"
              />
            </label>
            <p className="text-xs text-muted">
              Open the game in Steam. The number at the end of the store page URL is the app id. Orbit asks Steam to run it, so
              this only works for games in your own library.
            </p>
          </div>
        )}

        {mode === 'emulator' && (
          <div className="space-y-3 rounded-xl border border-line bg-panel2/40 p-3">
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className={labelCls}>Emulator</span>
                <input
                  className={inputCls}
                  value={d.emulatorPath}
                  onChange={(e) => set('emulatorPath', e.target.value)}
                  placeholder="C:\\Retro\\rpcs3.exe"
                  spellCheck={false}
                />
              </label>
              <button type="button" className={`${btnBrowse} mt-5 flex items-center gap-2`} onClick={() => void browseEmulator()}>
                <FolderOpen className="size-4" />
                Browse…
              </button>
            </div>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className={labelCls}>ROM or ISO</span>
                <input className={inputCls} value={d.romPath} onChange={(e) => set('romPath', e.target.value)} spellCheck={false} />
              </label>
              <button type="button" className={`${btnBrowse} mt-5 flex items-center gap-2`} onClick={() => void browseRom()}>
                <FolderOpen className="size-4" />
                Browse…
              </button>
            </div>
            <label className="block">
              <span className={labelCls}>Extra arguments</span>
              <input
                className={inputCls}
                value={d.argsTemplate}
                onChange={(e) => set('argsTemplate', e.target.value)}
                placeholder="--fullscreen -f {rom}"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-muted">
                <code>{'{rom}'}</code> is where the ROM path goes. Everything else is passed through as written.
              </p>
            </label>
          </div>
        )}

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className={labelCls}>Cover image (optional)</span>
            <div className="flex items-center gap-2">
              {d.coverPath ? (
                <img src={fileSrc(d.coverPath)} alt="" className="h-12 w-9 rounded object-cover" />
              ) : (
                <div className="grid h-12 w-9 place-items-center rounded bg-panel2 text-[10px] text-muted">none</div>
              )}
              <input
                className={inputCls}
                value={d.coverPath ?? ''}
                onChange={(e) => set('coverPath', e.target.value || null)}
                placeholder="Leave empty and Orbit will look next to the game"
                spellCheck={false}
              />
              <button type="button" className={`${btnBrowse} flex items-center gap-2`} onClick={() => void browseCover()}>
                <FolderOpen className="size-4" />
                Browse…
              </button>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className={labelCls}>Size (GB)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              className={inputCls}
              value={d.sizeGb}
              onChange={(e) => set('sizeGb', Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Status</span>
            <select className={inputCls} value={d.status} onChange={(e) => set('status', e.target.value as Game['status'])}>
              <option value="backlog">Backlog</option>
              <option value="playing">Playing</option>
              <option value="completed">Completed</option>
              <option value="dropped">Dropped</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={d.favorite} onChange={(e) => set('favorite', e.target.checked)} />
            Favorite
          </label>
          <label className="block">
            <span className={labelCls}>Notes</span>
            <input className={inputCls} value={d.notes} onChange={(e) => set('notes', e.target.value)} placeholder="optional" />
          </label>
        </div>

        {!native && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            This is a browser preview, so the Browse buttons do nothing and nothing is launched. Run Orbit with
            <code className="mx-1">npm run tauri dev</code> for the real thing.
          </p>
        )}

        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function blank(): Draft {
  return {
    title: '',
    exePath: '',
    installDir: '',
    drive: '',
    sizeGb: 0,
    status: 'backlog',
    favorite: false,
    notes: '',
    coverPath: null,
    steamAppId: '',
    emulatorPath: '',
    romPath: '',
    argsTemplate: '',
  };
}

/**
 * What a dropped program can say about itself.
 *
 * A field the file cannot answer is left `undefined` rather than blanked, so
 * spreading this over a draft never throws away something the player filled in.
 */
async function describeExe(exe: string): Promise<Partial<Draft>> {
  const folder = exe.replace(/\\[^\\]+$/, '');
  const out: Partial<Draft> = {
    title: folder.split('\\').pop() ?? '',
    exePath: exe,
    installDir: folder,
    drive: folder.slice(0, 2).toUpperCase(),
  };
  try {
    const info = await exeInfo(exe);
    if (info.title) out.title = info.title;
    if (info.sizeBytes > 0) out.sizeGb = Math.round((info.sizeBytes / 1e9) * 10) / 10;
    if (info.coverPath) out.coverPath = info.coverPath;
    if (info.drive) out.drive = info.drive;
  } catch {
    // A path that cannot be measured is still worth adding.
  }
  return out;
}

/**
 * The program a drop refers to.
 *
 * A dropped program is taken as it is. A dropped folder is searched, because a
 * folder is the more natural thing to drag in and the program inside it is the
 * one the player means. When a folder holds several, the largest wins: game
 * folders keep the real program and leave small helpers behind.
 */
export async function findDroppedExe(paths: string[]): Promise<string | null> {
  const exe = paths.find((p) => /\.(exe|bat|cmd)$/i.test(p));
  if (exe) return exe;

  const folder = paths.find((p) => !/\.[a-z0-9]{1,4}$/i.test(p));
  if (!folder) return null;
  const found = await scanFolder(folder, 1).catch(() => []);
  const best = [...found].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
  return best?.exePath ?? null;
}

/**
 * A finished game built straight from dropped paths.
 *
 * This is what makes dropping a program into the library actually add it,
 * instead of only filling in a dialog that still had to be confirmed. Returns
 * `null` when the drop holds nothing Orbit can run, which is the one case that
 * still deserves a person to look at it.
 */
export async function gameFromDropped(paths: string[]): Promise<Game | null> {
  const exe = await findDroppedExe(paths);
  if (!exe) return null;
  return buildGame({ ...blank(), ...(await describeExe(exe)) }, 'exe');
}

/**
 * Turn the form into the row the database expects.
 *
 * The chosen mode decides the launch target, rather than being kept alongside it,
 * so a game picked as Steam or emulator cannot be saved as a timer by accident.
 * A mode that is missing its pieces still saves as a timer, which is the honest
 * outcome: Orbit would otherwise hold a target it could not run.
 */
export function buildGame(d: Draft, mode: 'auto' | 'exe' | 'folder' | 'steam' | 'emulator'): Game {
  let launch: LaunchTarget = { kind: 'none' };
  if (mode === 'steam' && d.steamAppId) {
    launch = { kind: 'steam', appId: Number(d.steamAppId) };
  } else if (mode === 'emulator' && d.emulatorPath && d.romPath) {
    launch = {
      kind: 'emulator',
      emulatorPath: d.emulatorPath,
      romPath: d.romPath,
      argsTemplate: d.argsTemplate || '{rom}',
    };
  } else if (mode !== 'steam' && mode !== 'emulator' && d.exePath) {
    launch = { kind: 'executable', path: d.exePath, args: '', workingDir: d.installDir || null };
  }

  return {
    id: uid(),
    title: d.title.trim(),
    launch,
    exePath: d.exePath || null,
    installDir: d.installDir || null,
    drive: d.drive || d.installDir.slice(0, 2) || '',
    sizeBytes: Math.round(d.sizeGb * 1e9),
    sizeGb: d.sizeGb,
    status: d.status,
    favorite: d.favorite,
    manualPlaySecs: 0,
    playMinutes: 0,
    lastPlayed: null,
    addedAt: new Date().toISOString(),
    notes: d.notes,
    hue: hashHue(d.title),
    coverPath: d.coverPath,
    sessionCount: 0,
    longestSecs: 0,
    running: false,
    logs: [],
  };
}