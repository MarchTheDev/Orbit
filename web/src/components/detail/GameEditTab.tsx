import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Image, Pencil, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { Game, GameStatus, HltbData, MetaData } from '../../types';
import { findArtwork, isNative } from '../../services/native';
import { say } from '../../utils/toast';
import { fileSrc, pickAnyFile } from '../../services/desktop';
import { fetchHltb } from '../../services/hltb';
import { fmtBytes } from '../../utils/format';
import { LaunchEditor } from './LaunchEditor';
import { Select } from '../ui/Select';
import { MarkdownEditor } from '../ui/Markdown';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';
import { PortraitBrowser, PortraitFrame } from '../ui/PortraitBrowser';

/**
 * Everything about a game, in one place.
 *
 * The rest of the drawer shows a game; this edits it. It is deliberately one
 * form rather than several, because the fields are not independent: a cover is
 * artwork, an author is text, and a completion time is a number, and a player
 * who wants to fix one of them should not have to work out which page it lives
 * on. Closing this editor keeps the fields. There is no separate save step.
 */
export function GameEditTab({ game, onUpdate, hideLaunchSettings = false }: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  hideLaunchSettings?: boolean;
}) {
  const meta = game.meta;
  const hltb = game.hltb;

  const [title, setTitle] = useState(game.title);
  const [summary, setSummary] = useState(meta?.summary ?? '');
  const [developer, setDeveloper] = useState(meta?.developer ?? '');
  const [releaseYear, setReleaseYear] = useState(meta?.releaseYear ? String(meta.releaseYear) : '');
  const [rating, setRating] = useState(meta?.rating !== null && meta?.rating !== undefined ? String(meta.rating) : '');
  const [genres, setGenres] = useState((meta?.genres ?? []).join(', '));
  const [coverUrl, setCoverUrl] = useState(meta?.coverUrl ?? '');
  const [backdropUrl, setBackdropUrl] = useState(meta?.backgroundUrl ?? '');
  const [coverPath, setCoverPath] = useState(game.coverPath ?? '');
  const [main, setMain] = useState(hltb ? String(hltb.main) : '');
  const [mainExtra, setMainExtra] = useState(hltb ? String(hltb.mainExtra) : '');
  const [completionist, setCompletionist] = useState(hltb ? String(hltb.completionist) : '');
  const [sizeGb, setSizeGb] = useState(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
  const [notes, setNotes] = useState(game.notes);
  const [fit, setFit] = useState<'auto' | 'cover' | 'contain'>(meta?.coverFit ?? 'auto');
  const [planned, setPlanned] = useState(!!game.planned);
  const [status, setStatus] = useState<GameStatus>(game.status);
  const [favorite, setFavorite] = useState(game.favorite);
  const [hidden, setHidden] = useState(!!game.hidden);

  // A different game means a different form; the fields are reseeded rather than
  // carrying the last game's title into this one's.
  useEffect(() => {
    setTitle(game.title);
    setSummary(game.meta?.summary ?? '');
    setDeveloper(game.meta?.developer ?? '');
    setReleaseYear(game.meta?.releaseYear ? String(game.meta.releaseYear) : '');
    setRating(game.meta?.rating !== null && game.meta?.rating !== undefined ? String(game.meta.rating) : '');
    setGenres((game.meta?.genres ?? []).join(', '));
    setCoverUrl(game.meta?.coverUrl ?? '');
    setBackdropUrl(game.meta?.backgroundUrl ?? '');
    setCoverPath(game.coverPath ?? '');
    setMain(game.hltb ? String(game.hltb.main) : '');
    setMainExtra(game.hltb ? String(game.hltb.mainExtra) : '');
    setCompletionist(game.hltb ? String(game.hltb.completionist) : '');
    setSizeGb(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
    setNotes(game.notes);
    setFit(game.meta?.coverFit ?? 'auto');
    setPlanned(!!game.planned);
    setStatus(game.status);
    setFavorite(game.favorite);
    setHidden(!!game.hidden);
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A number field, where empty means "no value" rather than zero. */
  const hours = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const formSnap = JSON.stringify({
    title, notes, planned, status, favorite, hidden, coverPath, coverUrl, backdropUrl,
    summary, developer, releaseYear, rating, genres, fit, sizeGb, main, mainExtra, completionist,
  });
  const initialSnap = useRef<string | null>(null);
  if (initialSnap.current === null) initialSnap.current = formSnap;
  const openedTimes = useRef({ main, mainExtra, completionist });
  const timesTouched = main !== openedTimes.current.main
    || mainExtra !== openedTimes.current.mainExtra
    || completionist !== openedTimes.current.completionist;
  // Compared with the form as it opened, not with later background writes, so
  // closing an untouched editor does not mark the game as edited by hand.
  const dirtyRef = useRef(false);
  dirtyRef.current = formSnap !== initialSnap.current;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const commit = () => {
    const nextMeta: MetaData = {
      ...(meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null }),
      name: title.trim() || game.title,
      summary: summary.trim(),
      developer: developer.trim(),
      releaseYear: releaseYear.trim() === '' ? null : Number(releaseYear) || null,
      rating: rating.trim() === '' ? null : Number(rating) || null,
      genres: genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      coverUrl: coverUrl.trim() || null,
      backgroundUrl: backdropUrl.trim() || null,
      coverUrlCustom: Boolean(coverUrl.trim()) && (meta?.coverUrlCustom === true || coverUrl.trim() !== (meta?.coverUrl ?? '')),
      backgroundUrlCustom: Boolean(backdropUrl.trim()) && (meta?.backgroundUrlCustom === true || backdropUrl.trim() !== (meta?.backgroundUrl ?? '')),
      coverFit: fit === 'auto' ? undefined : fit,
      headerUrl: meta?.headerUrl ?? null,
      steamAppId: meta?.steamAppId ?? null,
      // A source is where the details came from. A game nobody has looked up
      // has none, rather than being called a Steam game by default.
      source: meta?.source,
    };

    const hoursIn = [hours(main), hours(mainExtra), hours(completionist)];
    const nextHltb: HltbData | null =
      hoursIn.every((h) => h === null)
        ? null
        : {
            main: hoursIn[0] ?? 0,
            mainExtra: hoursIn[1] ?? 0,
            completionist: hoursIn[2] ?? 0,
            // A time the player typed is theirs, so it is not marked as an
            // estimate from anywhere.
            source: 'hltb',
          };

    const gb = Number(sizeGb.replace(',', '.'));
    onUpdateRef.current({
      title: title.trim() || game.title,
      notes,
      planned,
      status,
      favorite,
      hidden,
      coverPath: coverPath.trim() || null,
      sizeBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1e9) : 0,
      sizeGb: Number.isFinite(gb) && gb > 0 ? gb : 0,
      meta: nextMeta,
      // A refresh writes the times on its own. Closing must not put the old
      // numbers back over that unless the fields themselves were edited.
      ...(timesTouched ? { hltb: nextHltb ?? undefined } : {}),
    });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    return () => {
      if (dirtyRef.current) commitRef.current();
    };
  }, []);

  return (
    <section className="orbit-edit">
      {/* The game's own face, at the top of its own record. A form whose first
          field is "Author / developer" asks somebody to type before it tells
          them which game they opened. */}
      <header className="orbit-edit-face">
        <PortraitFrame
          src={coverPath.trim() ? fileSrc(coverPath.trim()) : coverUrl.trim() || game.meta?.coverUrl || (game.coverPath ? fileSrc(game.coverPath) : null)}
          className="orbit-edit-faceart"
        />
        <div className="orbit-edit-facecopy">
          <span className="orbit-edit-kicker">
            <Pencil className="size-3" />
            Editing
          </span>
          <label className="block">
            <span className="sr-only">Title</span>
            <input
              className="orbit-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              spellCheck={false}
              aria-label="Game title"
            />
          </label>
          <p className="orbit-edit-headmeta">
            {developer || releaseYear || genres
              ? [developer, releaseYear, genres].filter(Boolean).join(' · ')
              : 'Anything the store got wrong, or Orbit guessed from a file name, can be fixed below.'}
          </p>
        </div>
        <p className="orbit-edit-saved">Saved as you type · there is no save button</p>
      </header>

      <section className="orbit-editsection">
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">What it is</h4>
          <p className="orbit-editsection-note">The facts the library sorts and searches by.</p>
        </header>
      <div className="orbit-edit-facts">

        <label className="block">
          <span className={labelCls}>Author / developer</span>
          <input className={inputCls} value={developer} onChange={(e) => setDeveloper(e.target.value)} />
        </label>

        <label className="block">
          <span className={labelCls}>Released</span>
          <input
            className={inputCls}
            value={releaseYear}
            onChange={(e) => setReleaseYear(e.target.value)}
            placeholder="2019"
            inputMode="numeric"
          />
        </label>

        <label className="block">
          <span className={labelCls}>Score out of 100</span>
          <input
            className={inputCls}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            placeholder="Leave empty for none"
            inputMode="numeric"
          />
        </label>

        <label className="block">
          <span className={labelCls}>Size in GB</span>
          <input
            className={inputCls}
            value={sizeGb}
            onChange={(e) => setSizeGb(e.target.value)}
            placeholder="12.5"
            inputMode="decimal"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>Genres, comma separated</span>
          <input className={inputCls} value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Action, RPG" />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>About</span>
          <textarea
            className={`${inputCls} h-28 resize-y`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What the game is, in your own words if you like."
          />
        </label>
      </div>
      </section>

      <section className="orbit-editsection">
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">
            <Image className="size-3.5" />
            Artwork
          </h4>
          <p className="orbit-editsection-note">
            A cover is a portrait poster; a backdrop is the wide picture behind the title. Either can be a
            file on this PC or a link.
          </p>
        </header>

        <div className="orbit-edit-artrow">
          <PortraitFrame
            src={coverPath.trim() ? fileSrc(coverPath.trim()) : coverUrl.trim() || null}
            className="orbit-edit-artpreview"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <label className="block">
              <span className={labelCls}>Cover picture (a file on this PC)</span>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={coverPath}
                  onChange={(e) => setCoverPath(e.target.value)}
                  placeholder="Leave empty and Orbit uses the store's art"
                  spellCheck={false}
                />
                {isNative() && (
                  <button
                    type="button"
                    className={`${btnBrowse} flex items-center gap-2`}
                    onClick={() => void pickAnyFile('Choose cover art').then((p) => p && setCoverPath(p))}
                  >
                    <FolderOpen className="size-4" />
                    Browse
                  </button>
                )}
              </div>
            </label>

            <label className="block">
              <span className={labelCls}>Cover picture (a link)</span>
              <input
                className={inputCls}
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="https://..."
                spellCheck={false}
              />
            </label>
          </div>
        </div>

        <label className="block">
          <span className={labelCls}>Backdrop picture (the wide one behind the title)</span>
          <input
            className={inputCls}
            value={backdropUrl}
            onChange={(e) => setBackdropUrl(e.target.value)}
            placeholder="A link, or leave empty for the header art"
            spellCheck={false}
          />
        </label>

        {/* How the picture sits in a tall tile. The guess based on shape is
            right most of the time; this is for the times it is not. */}
        <div>
          <span className={labelCls}>How the cover sits in its frame</span>
          <div className="flex w-fit rounded-lg border border-line p-0.5">
            {(
              [
                ['auto', 'Automatic'],
                ['cover', 'Fill the frame'],
                ['contain', 'Fit it whole'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFit(id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                  fit === id ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Fill fills the tile and crops what does not fit; fit shows the whole picture. Closing this keeps it.
          </p>
        </div>

        <PortraitBrowser
          resetKey={game.id}
          selected={coverUrl}
          load={(page) => findArtwork(game.id, page)}
          onChoose={(pick) => {
            setCoverUrl(pick.url);
            setCoverPath('');
            say('Cover chosen. Closing this keeps it.');
          }}
        />
      </section>

      <label className="orbit-editrow">
        <input
          type="checkbox"
          checked={planned}
          onChange={(e) => setPlanned(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--c-accent)]"
        />
        <span>
          <span className="block text-[13px] font-semibold">Not owned yet</span>
          <span className="orbit-editrow-hint">
            Tick this for a game you mean to play but do not have here. It stays on the Backlog page instead
            of the library, with no Play button, until a program is pointed at it.
          </span>
        </span>
      </label>

      <section className="orbit-editsection">
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">In the library</h4>
          <p className="orbit-editsection-note">
            Where the game sits on the shelf, and whether it is one you want to see first.
          </p>
        </header>
        <label className="block max-w-sm">
          <span className={labelCls}>Status</span>
          <Select
            value={status}
            onChange={(value) => setStatus(value as GameStatus)}
            ariaLabel="Game status"
            options={[
              { value: 'backlog', label: 'Backlog' },
              { value: 'playing', label: 'Playing' },
              { value: 'completed', label: 'Completed' },
              { value: 'dropped', label: 'Dropped' },
            ]}
          />
        </label>
        <div className="orbit-edit-choices">
          <label className="orbit-editchoice">
            <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} className="size-4 accent-[var(--c-accent)]" />
            <span>
              <b>Favorite</b>
              <i>Kept at the front of the shelf.</i>
            </span>
          </label>
          <label className="orbit-editchoice">
            <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} className="size-4 accent-[var(--c-accent)]" />
            <span>
              <b>Hide from Library</b>
              <i>Still findable by search and in the Journal.</i>
            </span>
          </label>
        </div>
      </section>

      {!hideLaunchSettings && (
        <LaunchEditor game={game} saveOnClose onSave={(launch, companions) => onUpdate({ launch, companions })} />
      )}

      <section className="orbit-editsection">
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">
            <Sparkles className="size-3.5" />
            How long it takes
          </h4>
          <p className="orbit-editsection-note">
            From a HowLongToBeat lookup, in hours. Anything typed here is kept instead; empty means no time
            is known.
          </p>
        </header>
        <div className="orbit-edit-times">
          <label className="block">
            <span className={labelCls}>Main story</span>
            <input className={inputCls} value={main} onChange={(e) => setMain(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className={labelCls}>Main + extras</span>
            <input className={inputCls} value={mainExtra} onChange={(e) => setMainExtra(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className={labelCls}>Completionist</span>
            <input
              className={inputCls}
              value={completionist}
              onChange={(e) => setCompletionist(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <button
          type="button"
          className={`${btnGhost} flex w-fit items-center gap-2 text-xs`}
          onClick={() => void fetchHltb(title || game.title).then((h) => h && onUpdate({ hltb: h }))}
        >
          <RotateCcw className="size-3.5" />
          Look these up again
        </button>
      </section>

      <section className="orbit-editsection">
        <span className={labelCls}>
          Notes
          <span className="ml-2 normal-case tracking-normal text-muted/70">
            For the current playthrough. Markdown, with a rendered View when you need it
          </span>
        </span>
        <MarkdownEditor
          value={notes}
          onChange={setNotes}
          rows={6}
          placeholder="Anything you want to remember."
        />
      </section>

      {game.installDir && (
        <p className="orbit-edit-path">
          {game.installDir}
          {game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}
        </p>
      )}

      <div className="orbit-edit-foot">
        <button
          type="button"
          onClick={() => void fetchHltb(title || game.title).then((h) => h && onUpdate({ hltb: h }))}
          className="orbit-edit-footbtn"
          title="Ask HowLongToBeat for the times again"
        >
          <RotateCcw className="size-3.5" />
          Refresh times
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('Clear the notes for this game?')) {
              setNotes('');
              onUpdate({ notes: '' });
            }
          }}
          className="orbit-edit-footbtn is-danger"
        >
          <Trash2 className="size-3.5" />
          Clear notes
        </button>
      </div>
    </section>
  );
}
