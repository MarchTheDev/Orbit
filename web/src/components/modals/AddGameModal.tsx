import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, Plus, TriangleAlert, X } from 'lucide-react';
import type { Game, LaunchTarget } from '../../types';
import { exeInfo, isNative, scanFolder } from '../../services/native';
import { fileSrc, pickAnyFile, pickFile } from '../../services/desktop';
import { hashHue, uid } from '../../utils/format';
import { Modal, btnBrowse, btnGhost, btnPrimary, inputCls, labelCls } from '../ui/Modal';
import { CheckboxInline } from '../ui/Checkbox';
import { Select } from '../ui/Select';

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
}

/**
 * Add a game, however the player has it.
 *
 * Three ways in, because people keep games in different places:
 * - drop the `.exe` on the window
 * - Browse for the `.exe`, which finds the folder around it by itself
 * - Browse for a folder (or type a path, which is all a browser preview can do)
 *
 * Steam and emulator games are not added here any more. Steam games arrive
 * through the import dialog, which reads the Steam library directly, and an
 * emulator is just a program with a ROM as an argument, which the game's own
 * launch settings can express.
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
    void takePaths(initialPaths);
  }, [initialPaths, takePaths]);

  const browseExe = async () => {
    const picked = await pickFile('Choose the game program', ['exe', 'bat', 'cmd'], d.installDir || undefined);
    if (picked) await takePaths([picked]);
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
      onAdd(buildGame(d), fetchMeta);
      // The dialog has done its job, so it closes rather than leaving the
      // player looking at a form for the game they just added.
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a game"
      subtitle="Drop a program on the window, or browse for it."
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <CheckboxInline checked={fetchMeta} onChange={setFetchMeta} label="Fetch artwork and details" />
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
              {searching ? 'Searching…' : 'Look up title'}
            </button>
          )}
        </div>

        {!d.exePath.trim() && (
          <p className="rounded-lg border border-line bg-panel2/40 px-3 py-2 text-xs text-muted">
            With no program, this game is only timed: Orbit runs the clock and you start it yourself. You can point it
            at a program later from the game's own page.
          </p>
        )}

        {/* Only the program is asked for. The folder around it, the drive it
            sits on and its size all come from that one path, so asking for them
            as well was three questions with only one right answer each. */}
        <section className="space-y-2 rounded-xl border border-line bg-panel2/40 p-3">
          <span className={labelCls}>Where the game lives</span>
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
          {d.installDir && (
            <p className="truncate font-mono text-[11px] text-muted" title={d.installDir}>
              {d.installDir}
            </p>
          )}
        </section>

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className={labelCls}>Cover image (optional)</span>
            <div className="flex items-center gap-2">
              {/* A preview of what the tile will look like. With no file
                  chosen that is the initials placeholder the library falls back
                  to, so it is never an empty box saying "none". */}
              {d.coverPath ? (
                <img src={fileSrc(d.coverPath)} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
              ) : (
                <div
                  className="grid h-12 w-9 shrink-0 place-items-center rounded text-xs font-black text-white/90"
                  style={{
                    background: `radial-gradient(circle at 30% 20%, hsl(${hashHue(d.title || 'Orbit')} 80% 55%), hsl(${(hashHue(d.title || 'Orbit') + 60) % 360} 70% 22%) 70%)`,
                  }}
                  title="The placeholder used until artwork is found"
                >
                  {initials(d.title || 'Orbit')}
                </div>
              )}
              <input
                className={inputCls}
                value={d.coverPath ?? ''}
                onChange={(e) => set('coverPath', e.target.value || null)}
                placeholder="Leave empty and Orbit will look for it"
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
            <Select
              value={d.status}
              onChange={(v) => set('status', v)}
              ariaLabel="Where this game starts out"
              options={[
                { value: 'backlog', label: 'Waiting to play' },
                { value: 'playing', label: 'Playing now' },
                { value: 'completed', label: 'Completed' },
                { value: 'dropped', label: 'Dropped' },
              ]}
            />
          </label>
          <div className="flex items-end pb-1.5">
            <CheckboxInline checked={d.favorite} onChange={(v) => set('favorite', v)} label="Favorite" />
          </div>
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

/** The three letters the library shows for a game with no artwork. */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
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
  return buildGame({ ...blank(), ...(await describeExe(exe)) });
}

/**
 * Turn the form into the row the database expects.
 *
 * A game with no program still saves, as a timer only: that is the honest
 * outcome, and the launch settings on the game itself can fill the gap later.
 */
export function buildGame(d: Draft): Game {
  const launch: LaunchTarget = d.exePath
    ? { kind: 'executable', path: d.exePath, args: '', workingDir: d.installDir || null }
    : { kind: 'none' };

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
    playSecs: 0,
    lastPlayed: null,
    addedAt: new Date().toISOString(),
    notes: d.notes,
    hue: hashHue(d.title),
    coverPath: d.coverPath,
    sessionCount: 0,
    longestSecs: 0,
    running: false,
    companions: [],
  };
}