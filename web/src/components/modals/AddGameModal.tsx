import { useCallback, useEffect, useState } from 'react';
import { Download, FolderOpen, LoaderCircle, Plus, Search, TriangleAlert, X } from 'lucide-react';
import type { Game, GameSuggestion, LaunchTarget, MetaData } from '../../types';
import { exeInfo, folderPrograms, isNative, scanFolder } from '../../services/native';
import { fetchMetadata, searchGames } from '../../services/metadata';
import { fileSrc, pickAnyFile, pickFile } from '../../services/desktop';
import { fmtBytes, hashHue, uid } from '../../utils/format';
import type { FolderProgram } from '../../types';
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
 * - drop the `.exe` (or the game's folder) on the window
 * - Browse for the `.exe`, which finds the folder around it by itself
 * - Browse for a folder (or type a path, which is all a browser preview can do)
 *
 * Whatever the door, the dialog shows what Orbit found before anything is
 * saved: the title a store gives the game rather than the one its file name
 * happens to have, its author and year, and the cover it would wear. A dropped
 * `Hades.exe` inside a folder called `Hades v1.382` becomes Hades, and the
 * player can see that happen rather than find out afterwards.
 *
 * Steam games are not typed in by hand. The door to the Steam library is at the
 * bottom of this form, under everything that is filled in here.
 */
export function AddGameModal({
  onClose,
  onAdd,
  onImportSteam,
  initialPaths,
}: {
  onClose: () => void;
  onAdd: (g: Game, fetchMeta: boolean) => void;
  /**
   * Opens the Steam library picker, over this dialog.
   *
   * Steam games are not typed in by hand, so the door to them is here rather
   * than a second form. The library opens on top of this one and closing it
   * comes back to the form that was already open.
   */
  onImportSteam: () => void;
  /** Programs dropped on the window before the dialog was opened. */
  initialPaths?: string[] | null;
}) {
  const native = isNative();
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [looked, setLooked] = useState(false);
  const [matches, setMatches] = useState<GameSuggestion[]>([]);
  const [match, setMatch] = useState<GameSuggestion | null>(null);
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [fetchMeta, setFetchMeta] = useState(true);
  const [dropped, setDropped] = useState<string[]>([]);
  const [programs, setPrograms] = useState<FolderProgram[]>([]);
  const [d, setD] = useState<Draft>(() => blank());

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((current) => ({ ...current, [key]: value }));
  }, []);

  /**
   * Ask the store what this title is.
   *
   * The first answer is taken as the game, and the others are kept so a wrong
   * guess is one click to fix rather than something to type around. It runs on
   * its own after a drop, which is the moment the title is a file name and
   * nothing else.
   */
  const lookUp = useCallback(async (title: string): Promise<void> => {
    const wanted = title.trim();
    if (wanted.length < 2) return;
    setLooking(true);
    setLooked(true);
    try {
      const found = await searchGames(wanted);
      setMatches(found);
      const best = found[0] ?? null;
      setMatch(best);
      if (best) setD((current) => ({ ...current, title: best.name }));
      setMeta(best ? await fetchMetadata(best.name, best.appId).catch(() => null) : null);
    } catch {
      setMatches([]);
      setMatch(null);
      setMeta(null);
    } finally {
      setLooking(false);
    }
  }, []);

  /** One of the store's answers, taken as the game. */
  const takeMatch = useCallback(async (choice: GameSuggestion) => {
    setMatch(choice);
    setD((current) => ({ ...current, title: choice.name }));
    setLooking(true);
    try {
      setMeta(await fetchMetadata(choice.name, choice.appId).catch(() => null));
    } finally {
      setLooking(false);
    }
  }, []);

  /** A program tells us the title, where it lives and how big it is. */
  const takeExe = useCallback(
    async (exe: string, guessTitle?: string): Promise<boolean> => {
      const info = await describeExe(exe);
      setD((current) => ({
        ...current,
        ...info,
        // A title already typed or picked from a store match wins over the file
        // name, which is the whole reason the store is asked in the first place.
        title: current.title || guessTitle || info.title || '',
      }));
      return true;
    },
    [],
  );

  /**
   * Fill the form from what was dropped.
   *
   * A program is used as it is. A folder is looked through first, because
   * dropping a game folder is the more natural thing to do and there is no
   * program to find in the drag itself. When a folder holds several, they are
   * all offered and the biggest leads, so a wrong guess is visible and easy to
   * change.
   */
  const takePaths = useCallback(
    async (paths: string[]): Promise<boolean> => {
      const exe = paths.find((p) => /\.(exe|bat|cmd)$/i.test(p));
      if (exe) {
        setPrograms([]);
        return takeExe(exe);
      }
      const folder = paths.find((p) => !/\.[a-z0-9]{1,4}$/i.test(p));
      if (!folder) return false;
      const found = await folderPrograms(folder, 2).catch(() => []);
      const best = [...found].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
      if (!best) {
        // A folder with nothing to run is still worth adding as a timer: the
        // folder says where it lives and the store says what it is.
        setD((current) => ({ ...current, installDir: folder, drive: driveOf(folder) }));
        void lookUp(baseName(folder));
        return true;
      }
      setPrograms(found.slice(0, 8));
      return takeExe(best.exePath);
    },
    [lookUp, takeExe],
  );

  // The window watches for drops and hands them over as `initialPaths`, whether
  // the dialog was just opened or was already up. Listening here as well would
  // measure the same program twice.
  useEffect(() => {
    if (!initialPaths || initialPaths.length === 0) return;
    setDropped(initialPaths);
    void takePaths(initialPaths).then((took) => {
      // Nothing to read in the drop: the store is still worth asking about the
      // folder's name, because that is what the player dropped it for.
      if (!took) void lookUp(titleFromPath(initialPaths[0] ?? ''));
    });
  }, [initialPaths, lookUp, takePaths]);

  const title = d.title.trim();
  // The picture the tile would wear: the store's portrait cover, then one the
  // store's search showed, then a file on disk, then the initials placeholder.
  const storeCover = meta?.coverUrl ?? (match ? portraitOf(match.appId) : null);

  const browseExe = async () => {
    const picked = await pickFile('Choose the game program', ['exe', 'bat', 'cmd'], d.installDir || undefined);
    if (picked) {
      setPrograms([]);
      await takePaths([picked]);
      await lookUp(title || baseName(d.installDir) || '');
    }
  };

  const browseCover = async () => {
    const picked = await pickAnyFile('Choose cover art', d.installDir || undefined);
    if (picked) set('coverPath', picked);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;
    setBusy(true);
    try {
      onAdd(buildGame(d, meta, match?.appId ?? null), fetchMeta);
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
      subtitle="Drop a program on the window, or browse for it. Orbit looks the title up before it is added."
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
            <button className={`${btnPrimary} flex items-center gap-2`} onClick={submit} disabled={!title || busy}>
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
              <span className="text-muted">Dropped on Orbit:</span>
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

        {/* What Orbit made of the drop, before anything is saved. The title is
            editable right here, and a wrong guess is one click to replace. */}
        {looked && (
          <section className="flex items-start gap-3 rounded-2xl border border-line bg-panel2/40 p-3">
            <div className="grid h-20 w-[3.75rem] shrink-0 place-items-center overflow-hidden rounded-lg bg-panel">
              {d.coverPath ? (
                <img src={fileSrc(d.coverPath)} alt="" className="size-full object-cover" />
              ) : storeCover ? (
                <img src={storeCover} alt="" className="size-full object-cover" />
              ) : (
                <span
                  className="grid size-full place-items-center text-sm font-black text-white/90"
                  style={{
                    background: `radial-gradient(circle at 30% 20%, hsl(${hashHue(title || 'Orbit')} 80% 55%), hsl(${(hashHue(title || 'Orbit') + 60) % 360} 70% 22%) 70%)`,
                  }}
                >
                  {initials(title || 'Orbit')}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
                {match ? 'Found in the store' : 'Nothing found'}
                {looking && <LoaderCircle className="size-3 animate-spin" />}
              </span>
              <p className="truncate text-sm font-medium">{match?.name ?? title ?? ''}</p>
              <p className="text-xs text-muted">
                {meta
                  ? [meta.developer, meta.releaseYear, meta.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ') ||
                    'No details on its store page'
                  : match
                    ? 'Looking the details up…'
                    : 'Orbit could not match this title, so the name is yours to write.'}
              </p>
              {matches.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {matches.slice(0, 4).map((m) => (
                    <button
                      key={m.appId}
                      type="button"
                      onClick={() => void takeMatch(m)}
                      title={m.name}
                      className={`flex max-w-[11rem] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] ${
                        m.appId === match?.appId
                          ? 'border-accent/60 text-accent'
                          : 'border-line text-muted hover:border-accent/50 hover:text-fg'
                      }`}
                    >
                      {m.coverUrl && <img src={m.coverUrl} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />}
                      <span className="truncate">{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className={labelCls}>Title</span>
            <input
              className={inputCls}
              value={d.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Hollow Knight"
            />
          </label>
          <button
            type="button"
            className={`${btnBrowse} mt-5 flex items-center gap-2`}
            onClick={() => void lookUp(d.title)}
            disabled={looking || d.title.trim().length < 2}
            title="Ask the store what this title is"
          >
            {looking ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            {match ? 'Not this one' : 'Look up'}
          </button>
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
          {/* A folder with several programs in it: the biggest leads, and the
              rest are there so a helper is never mistaken for the game. */}
          {programs.length > 1 && (
            <div className="space-y-1 pt-1">
              <span className="text-[11px] text-muted">Orbit found more than one program here. Which one starts it?</span>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {programs.map((p) => (
                  <button
                    key={p.exePath}
                    type="button"
                    onClick={() => void takeExe(p.exePath)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1 text-left text-[11px] ${
                      p.exePath === d.exePath ? 'border-accent/60 text-accent' : 'border-line text-muted hover:border-accent/40 hover:text-fg'
                    }`}
                  >
                    <span className="truncate font-mono">{baseName(p.exePath)}</span>
                    <span className="shrink-0">{fmtBytes(p.sizeBytes)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Where a game with nothing to point at ends up, said before it is
              added rather than discovered afterwards in the Library. */}
          {!d.exePath.trim() && !d.installDir.trim() && (
            <p className="text-[11px] text-muted">
              With no program and no folder this stays on the Backlog, with the rest of what you have not installed
              yet. It can be pointed at a program later from its own page.
            </p>
          )}
        </section>

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className={labelCls}>Cover image (optional)</span>
            <div className="flex items-center gap-2">
              {/* A preview of what the tile will look like. The store's cover
                  wins until a file is chosen, and with neither this is the
                  initials placeholder the library falls back to. */}
              {d.coverPath ? (
                <img src={fileSrc(d.coverPath)} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
              ) : storeCover ? (
                <img src={storeCover} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
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
                placeholder={storeCover ? 'Using the store cover' : 'Leave empty and Orbit will look for it'}
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

        {/* The second door, under everything that is typed by hand: a game that
            is already installed on Steam is brought over rather than typed in. */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel2/40 px-3 py-2">
          <p className="text-xs text-muted">
            Already installed on Steam? Bring games over from the Steam library rather than typing them in.
          </p>
          <button
            type="button"
            onClick={onImportSteam}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
          >
            <Download className="size-3.5" />
            From Steam…
          </button>
        </div>
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

/** The last piece of a path, whichever separator it was written with. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** A file name is a guess at a title, so the extension comes off it. */
function titleFromPath(path: string): string {
  return baseName(path).replace(/\.[a-z0-9]{1,4}$/i, '');
}

function driveOf(folder: string): string {
  return /^[a-z]:/i.test(folder) ? folder.slice(0, 2).toUpperCase() : '';
}

/** The portrait cover the store keeps for an app, which is what a tile wants. */
export function portraitOf(appId: number): string {
  return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;
}

/**
 * What a dropped program can say about itself.
 *
 * A field the file cannot answer is left `undefined` rather than blanked, so
 * spreading this over a draft never throws away something the player filled in.
 */
async function describeExe(exe: string): Promise<Partial<Draft>> {
  const folder = exe.replace(/[\\/][^\\/]*$/, '');
  const out: Partial<Draft> = {
    title: baseName(folder),
    exePath: exe,
    installDir: folder,
    drive: driveOf(folder),
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
 * folders keep the real program and leave small helpers behind. The dialog
 * offers the rest, so the guess can be corrected before anything is saved.
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
 * Nothing in the app adds a game without showing it first any more, so this is
 * used by callers that have already asked.
 */
export async function gameFromDropped(paths: string[]): Promise<Game | null> {
  const exe = await findDroppedExe(paths);
  if (!exe) return null;
  return buildGame({ ...blank(), ...(await describeExe(exe)) }, null, null);
}

/**
 * Turn the form into the row the database expects.
 *
 * A game with no program still saves, as a timer only: that is the honest
 * outcome, and the launch settings on the game itself can fill the gap later.
 *
 * The store match travels with the game as its starting details, so a cover and
 * a proper name are there even when the lookups are turned off, and the app id
 * is what the achievements and the artwork picker read later.
 */
export function buildGame(d: Draft, meta: MetaData | null, appId: number | null): Game {
  const launch: LaunchTarget = d.exePath
    ? { kind: 'executable', path: d.exePath, args: '', workingDir: d.installDir || null }
    : { kind: 'none' };

  return {
    id: uid(),
    title: d.title.trim(),
    // The add dialog is the library's own door, so what comes through it is in
    // the library even when there is no program to start yet. A game written
    // down on the Backlog is planned instead, and the two are not the same.
    inLibrary: true,
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
    ...(meta || appId
      ? {
          meta: {
            ...(meta ?? {
              summary: '',
              genres: [],
              developer: '',
              releaseYear: null,
              rating: null,
            }),
            name: meta?.name ?? d.title.trim(),
            steamAppId: meta?.steamAppId ?? appId,
            source: meta?.source ?? 'steam',
          },
        }
      : {}),
  };
}
