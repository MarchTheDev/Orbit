import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, LoaderCircle, Plus, Search, TriangleAlert, X } from 'lucide-react';
import type { Game, GameSuggestion, LaunchTarget, MetaData } from '../../types';
import { exeInfo, folderPrograms, isNative } from '../../services/native';
import { fetchMetadata, searchGames } from '../../services/metadata';
import { fileSrc, pickAnyFile, pickFile } from '../../services/desktop';
import { fmtBytes, hashHue, uid } from '../../utils/format';
import { gameFolderFromExecutable, gameTitleFromExecutable, gameTitleFromPath } from '../../utils/gameTitle';
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

/** The catalogue details Orbit found, editable before the game is saved. */
interface DetailsDraft {
  developer: string;
  releaseYear: string;
  rating: string;
  genres: string;
  summary: string;
  coverUrl: string;
  backgroundUrl: string;
}

const EMPTY_DETAILS: DetailsDraft = {
  developer: '',
  releaseYear: '',
  rating: '',
  genres: '',
  summary: '',
  coverUrl: '',
  backgroundUrl: '',
};

function detailsFromMeta(meta: MetaData | null): DetailsDraft {
  return {
    developer: meta?.developer ?? '',
    releaseYear: meta?.releaseYear ? String(meta.releaseYear) : '',
    rating: meta?.rating !== null && meta?.rating !== undefined ? String(meta.rating) : '',
    genres: (meta?.genres ?? []).join(', '),
    summary: meta?.summary ?? '',
    coverUrl: meta?.coverUrl ?? '',
    backgroundUrl: meta?.backgroundUrl ?? '',
  };
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
  const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
  const [detailsEdited, setDetailsEdited] = useState(false);
  const [coverUrlEdited, setCoverUrlEdited] = useState(false);
  const [fetchMeta, setFetchMeta] = useState(true);
  const [dropped, setDropped] = useState<string[]>([]);
  const [programs, setPrograms] = useState<FolderProgram[]>([]);
  const [d, setD] = useState<Draft>(() => blank());
  /** The draft as it stands right now, for a handler that finishes later. */
  const draft = useRef(d);
  draft.current = d;
  /** Manual titles take precedence over a guess made from a program path. */
  const titleWasEdited = useRef(false);
  /** Ignore a slower lookup if the title or executable has since changed. */
  const lookupSequence = useRef(0);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((current) => ({ ...current, [key]: value }));
  }, []);

  const editDetails = useCallback(<K extends keyof DetailsDraft,>(key: K, value: DetailsDraft[K]) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setDetailsEdited(true);
    if (key === 'coverUrl') setCoverUrlEdited(true);
  }, []);

  const editTitle = (value: string) => {
    titleWasEdited.current = true;
    lookupSequence.current += 1;
    setLooking(false);
    // Preserve the suggested catalogue details while the player corrects the
    // display title. They can explicitly search again if they mean another game.
    set('title', value);
  };

  /**
   * Ask the catalogue what this title is, then let the player review its answer.
   *
   * The best match is suggested, not treated as certain: alternatives stay
   * visible, and the title and details can all be corrected before saving.
   */
  const lookUp = useCallback(async (title: string): Promise<void> => {
    const wanted = title.trim();
    if (wanted.length < 2) return;
    const request = ++lookupSequence.current;
    setLooking(true);
    setLooked(true);
    setMatches([]);
    setMatch(null);
    setMeta(null);
    setDetails(EMPTY_DETAILS);
    setDetailsEdited(false);
    setCoverUrlEdited(false);
    try {
      const found = await searchGames(wanted);
      if (request !== lookupSequence.current) return;
      setMatches(found);
      const best = found[0] ?? null;
      setMatch(best);
      if (best && !titleWasEdited.current) setD((current) => ({ ...current, title: best.name }));
      if (!best && !titleWasEdited.current) {
        setD((current) => ({ ...current, title: current.title || wanted }));
      }
      const nextMeta = best ? await fetchMetadata(best.name, best.appId).catch(() => null) : null;
      if (request !== lookupSequence.current) return;
      setMeta(nextMeta);
      setDetails(detailsFromMeta(nextMeta));
    } catch {
      if (request !== lookupSequence.current) return;
      setMatches([]);
      setMatch(null);
      setMeta(null);
      setDetails(EMPTY_DETAILS);
      setDetailsEdited(false);
      setCoverUrlEdited(false);
      if (!titleWasEdited.current) setD((current) => ({ ...current, title: current.title || wanted }));
    } finally {
      if (request === lookupSequence.current) setLooking(false);
    }
  }, []);

  /** Take one of the catalogue's answers as the game. */
  const takeMatch = useCallback(async (choice: GameSuggestion) => {
    const request = ++lookupSequence.current;
    titleWasEdited.current = false;
    setMatch(choice);
    setD((current) => ({ ...current, title: choice.name }));
    setLooking(true);
    setMeta(null);
    setDetails(EMPTY_DETAILS);
    setDetailsEdited(false);
    setCoverUrlEdited(false);
    try {
      const nextMeta = await fetchMetadata(choice.name, choice.appId).catch(() => null);
      if (request !== lookupSequence.current) return;
      setMeta(nextMeta);
      setDetails(detailsFromMeta(nextMeta));
    } finally {
      if (request === lookupSequence.current) setLooking(false);
    }
  }, []);

  /**
   * Read a program's path, but use its game folder—not its .exe filename—as the
   * title guess. A previous store match is discarded when a different program
   * is chosen, so its cover or app id cannot leak into the next game.
   */
  const takeExe = useCallback(async (exe: string): Promise<string> => {
    const info = await describeExe(exe);
    const manuallyNamed = titleWasEdited.current && draft.current.title.trim();
    const wanted = manuallyNamed ? draft.current.title.trim() : gameTitleFromExecutable(exe) || info.title || '';
    lookupSequence.current += 1;
    setLooking(false);
    setMatch(null);
    setMatches([]);
    setMeta(null);
    setDetails(EMPTY_DETAILS);
    setDetailsEdited(false);
    setCoverUrlEdited(false);
    setD((current) => ({ ...current, sizeGb: 0, ...info, title: manuallyNamed ? current.title : wanted }));
    return wanted;
  }, []);

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
        // Start from the containing game folder. A launcher or packaged build
        // often gives the executable a name that is not the game's title.
        void lookUp(await takeExe(exe));
        return true;
      }
      const folder = paths.find((p) => !/\.[a-z0-9]{1,4}$/i.test(p));
      if (!folder) return false;
      const found = await folderPrograms(folder, 2).catch(() => []);
      const best = [...found].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
      if (!best) {
        // A folder with nothing to run is still worth adding as a timer: the
        // folder says where it lives and the store says what it is.
        setD((current) => ({ ...current, exePath: '', sizeGb: 0, installDir: folder, drive: driveOf(folder) }));
        void lookUp(gameTitleFromPath(folder));
        return true;
      }
      setPrograms(found.slice(0, 8));
      void lookUp(await takeExe(best.exePath));
      return true;
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
      // Nothing in the drop to read at all: the store is still worth asking
      // about the name, because that is what the player dropped it for.
      if (!took) void lookUp(titleFromPath(initialPaths[0] ?? ''));
    });
  }, [initialPaths, lookUp, takePaths]);

  const title = d.title.trim();
  // The picture the tile would wear: the store's portrait cover, then one the
  // store's search showed, then a file on disk, then the initials placeholder.
  const storeCover = coverUrlEdited
    ? details.coverUrl.trim() || null
    : details.coverUrl.trim() || meta?.coverUrl || match?.coverUrl || (match ? portraitOf(match.appId) : null);

  const browseExe = async () => {
    const picked = await pickFile('Choose the game program', ['exe', 'bat', 'cmd'], d.installDir || undefined);
    if (picked) await takePaths([picked]);
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
      const appId = match?.appId ?? null;
      const reviewedCover = coverUrlEdited
        ? details.coverUrl.trim()
        : details.coverUrl.trim() || meta?.coverUrl || match?.coverUrl || (match ? portraitOf(match.appId) : '');
      const reviewedMeta = metadataForReview(meta, { ...details, coverUrl: reviewedCover }, title, appId, detailsEdited);
      onAdd(buildGame(d, reviewedMeta, appId), fetchMeta);
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
      subtitle="Add a local game by title or program. A catalogue lookup can fill in details to review before saving."
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
          <section className="space-y-3 rounded-2xl border border-accent/20 bg-gradient-to-br from-panel2/60 to-panel/60 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-24 w-[4.5rem] shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-panel shadow-lg">
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
                <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                  {looking ? 'Checking the catalogue' : match ? 'Suggested match' : 'Review details'}
                  {looking && <LoaderCircle className="size-3 animate-spin" />}
                </span>
                <p className="truncate text-base font-semibold text-fg">{title || 'Untitled game'}</p>
                <p className="text-xs leading-relaxed text-muted">
                  {details.developer || details.releaseYear || details.genres
                    ? [details.developer, details.releaseYear, details.genres].filter(Boolean).join(' · ')
                    : match
                      ? 'The catalogue found a title. Check the details below before adding it.'
                      : 'No exact catalogue match yet. You can still fill these details in yourself.'}
                </p>
              </div>
            </div>

            {matches.length > 1 && (
              <div className="space-y-1.5 border-t border-line/70 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Choose the right match</p>
                <div className="flex flex-wrap gap-1.5">
                  {matches.slice(0, 5).map((m) => (
                    <button
                      key={m.appId}
                      type="button"
                      onClick={() => void takeMatch(m)}
                      title={m.name}
                      className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                        m.appId === match?.appId
                          ? 'border-accent/60 bg-accent/10 text-accent'
                          : 'border-line bg-panel/60 text-muted hover:border-accent/50 hover:text-fg'
                      }`}
                    >
                      {m.coverUrl && <img src={m.coverUrl} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />}
                      <span className="truncate">{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 border-t border-line/70 pt-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Developer / author</span>
                <input
                  className={inputCls}
                  value={details.developer}
                  onChange={(e) => editDetails('developer', e.target.value)}
                  placeholder="Studio or creator"
                />
              </label>
              <label className="block">
                <span className={labelCls}>Release year</span>
                <input
                  className={inputCls}
                  value={details.releaseYear}
                  onChange={(e) => editDetails('releaseYear', e.target.value)}
                  placeholder="2024"
                  inputMode="numeric"
                />
              </label>
              <label className="block">
                <span className={labelCls}>Score out of 100</span>
                <input
                  className={inputCls}
                  value={details.rating}
                  onChange={(e) => editDetails('rating', e.target.value)}
                  placeholder="Optional"
                  inputMode="decimal"
                />
              </label>
              <label className="block">
                <span className={labelCls}>Genres</span>
                <input
                  className={inputCls}
                  value={details.genres}
                  onChange={(e) => editDetails('genres', e.target.value)}
                  placeholder="Action, RPG"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>Description</span>
                <textarea
                  className={`${inputCls} min-h-20 resize-y`}
                  value={details.summary}
                  onChange={(e) => editDetails('summary', e.target.value)}
                  placeholder="A short description, if you want one."
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>Store cover image URL</span>
                <input
                  className={inputCls}
                  value={details.coverUrl}
                  onChange={(e) => editDetails('coverUrl', e.target.value)}
                  placeholder="Paste a cover URL or choose a local image below"
                  spellCheck={false}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>Background image URL (optional)</span>
                <input
                  className={inputCls}
                  value={details.backgroundUrl}
                  onChange={(e) => editDetails('backgroundUrl', e.target.value)}
                  placeholder="Wide art for the game's detail page"
                  spellCheck={false}
                />
              </label>
            </div>
          </section>
        )}

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className={labelCls}>Title</span>
            <input
              className={inputCls}
              value={d.title}
              onChange={(e) => editTitle(e.target.value)}
              placeholder="Hollow Knight"
            />
          </label>
          <button
            type="button"
            className={`${btnBrowse} mt-5 flex items-center gap-2`}
            onClick={() => void lookUp(d.title)}
            disabled={looking || d.title.trim().length < 2}
            title={match ? 'Search for a different match in the catalogue' : 'Search the catalogue for this title'}
          >
            {looking ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            {match ? 'Find another match' : 'Search catalogue'}
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

        {/* Steam is deliberately the last way into the form: the manual review
            stays together, with the library import offered as a separate route. */}
        <section className="border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/20 bg-gradient-to-r from-accent/10 via-panel2/50 to-panel2/30 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">Already installed through Steam?</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Import it from Steam instead of filling in these details by hand.
              </p>
            </div>
            <button
              type="button"
              onClick={onImportSteam}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-accent/35 bg-panel px-3 py-2 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10"
            >
              <Download className="size-3.5" />
              Import from Steam
            </button>
          </div>
        </section>
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

/** A file or folder name is a title guess; ignore versions and build directories. */
function titleFromPath(path: string): string {
  return gameTitleFromPath(path);
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
  const executableFolder = exe.replace(/[\\/][^\\/]*$/, '');
  const installDir = gameFolderFromExecutable(exe) || executableFolder;
  const out: Partial<Draft> = {
    title: gameTitleFromExecutable(exe) || baseName(executableFolder),
    exePath: exe,
    installDir,
    drive: driveOf(installDir),
  };
  try {
    const info = await exeInfo(exe);
    // The executable may be called Launcher or Shipping; keep the folder-based
    // title guess instead of replacing it with that internal program name.
    if (info.sizeBytes > 0) out.sizeGb = Math.round((info.sizeBytes / 1e9) * 10) / 10;
    if (info.coverPath) out.coverPath = info.coverPath;
    if (info.drive) out.drive = info.drive;
  } catch {
    // A path that cannot be measured is still worth adding.
  }
  return out;
}

/**
 * Save exactly what the review form shows, including any corrections the player
 * made to the catalogue's name, author, cover or other details.
 */
function metadataForReview(
  meta: MetaData | null,
  details: DetailsDraft,
  title: string,
  appId: number | null,
  edited: boolean,
): MetaData | null {
  const hasManualDetails = Object.values(details).some((value) => value.trim() !== '');
  if (!meta && appId === null && !hasManualDetails) return null;

  const year = Number(details.releaseYear.trim());
  const rating = Number(details.rating.trim());
  const genres = details.genres
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean);

  return {
    summary: details.summary.trim(),
    genres,
    developer: details.developer.trim(),
    releaseYear: Number.isFinite(year) && year > 0 ? Math.trunc(year) : null,
    rating: details.rating.trim() !== '' && Number.isFinite(rating) ? rating : null,
    coverUrl: details.coverUrl.trim() || null,
    backgroundUrl: details.backgroundUrl.trim() || null,
    headerUrl: meta?.headerUrl ?? null,
    name: meta?.name ?? title,
    steamAppId: meta?.steamAppId ?? appId,
    source: meta?.source,
    ...(meta?.edited || edited ? { edited: true } : {}),
  };
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
    drive: d.drive || driveOf(d.installDir),
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
