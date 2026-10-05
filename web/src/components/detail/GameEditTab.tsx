import { useEffect, useState } from 'react';
import { FolderOpen, Image, LoaderCircle, Pencil, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { Game, HltbData, MetaData } from '../../types';
import { findArtwork, isNative, type ArtworkPick } from '../../services/native';
import { say } from '../../utils/toast';
import { pickAnyFile } from '../../services/desktop';
import { fetchHltb } from '../../services/hltb';
import { fmtBytes } from '../../utils/format';
import { Cover } from '../ui/Cover';
import { SaveButton } from '../ui/SaveButton';
import { MarkdownEditor } from '../ui/Markdown';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';

/**
 * Everything about a game, in one place.
 *
 * The rest of the drawer shows a game; this edits it. It is deliberately one
 * form rather than several, because the fields are not independent: a cover is
 * artwork, an author is text, and a completion time is a number, and a player
 * who wants to fix one of them should not have to work out which page it lives
 * on. Every field saves with the same button at the bottom.
 */
/**
 * The shapes of artwork the store publishes, in the order they are worth
 * looking at, each saying where it belongs.
 */
const GROUPS = [
  { kind: 'portrait', title: 'Portrait', where: 'fills a tile, the shape the library is built for', shape: 'tall' },
  { kind: 'hero', title: 'Hero art', where: 'wide, for the backdrop behind a page', shape: 'wide' },
  { kind: 'screenshot', title: 'Screenshots', where: 'wide, for the backdrop behind a page', shape: 'wide' },
  { kind: 'capsule', title: 'Capsule', where: 'the store\'s own tile art; used as a cover', shape: 'tall' },
  { kind: 'header', title: 'Header', where: 'wide and short; used as a cover', shape: 'wide' },
  { kind: 'logo', title: 'Logo', where: 'the name on its own, over the backdrop', shape: 'wide' },
] as const;

export function GameEditTab({ game, onUpdate }: { game: Game; onUpdate: (patch: Partial<Game>) => void }) {
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
  /** Pictures the store offers, once the player asks for them. */
  const [options, setOptions] = useState<ArtworkPick[]>([]);
  const [finding, setFinding] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);

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
    setOptions([]);
    setArtError(null);
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Ask the store for every picture it has of this game.
   *
   * A cover that crops badly is usually the wrong crop rather than the wrong
   * picture, and the store publishes several. The list is offered as pictures to
   * look at, because a URL tells nobody anything.
   */
  const findArt = async () => {
    setFinding(true);
    setArtError(null);
    try {
      const found = await findArtwork(game.id);
      setOptions(found.picks);
      if (found.picks.length === 0) {
        setArtError('The store has no pictures for this game. A file can still be chosen by hand.');
      }
    } catch (e) {
      setArtError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinding(false);
    }
  };

  /** A number field, where empty means "no value" rather than zero. */
  const hours = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const save = () => {
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
      coverFit: fit === 'auto' ? undefined : fit,
      headerUrl: meta?.headerUrl ?? null,
      steamAppId: meta?.steamAppId ?? null,
      source: meta?.source ?? 'steam',
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
    onUpdate({
      title: title.trim() || game.title,
      notes,
      planned,
      coverPath: coverPath.trim() || null,
      sizeBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1e9) : 0,
      sizeGb: Number.isFinite(gb) && gb > 0 ? gb : 0,
      meta: nextMeta,
      hltb: nextHltb ?? undefined,
    });
    // Said out loud in the corner rather than next to the button: a line of text
    // appearing beside it moved the row and made the whole footer jump.
    say(planned ? `${nextMeta.name ?? game.title} saved, still not owned` : `${nextMeta.name ?? game.title} saved`);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <Cover game={game} className="h-24 w-16 shrink-0 rounded-lg [&_span]:text-lg" />
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Pencil className="size-4 text-accent" />
            Edit this game
          </h3>
          <p className="text-xs text-muted">
            Anything a store got wrong, or that Orbit guessed from a file name, can be fixed here.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelCls}>Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
        </label>

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

      <div className="space-y-3 rounded-xl border border-line bg-panel2/40 p-3">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
          <Image className="size-3.5" />
          Artwork
        </h4>

        <div className="flex gap-3">
          <Cover game={game} className="h-28 w-20 shrink-0 rounded-lg [&_span]:text-lg" />
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
          <div className="glass flex w-fit rounded-full p-1">
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
                className={`rounded-full px-3 py-1 text-[11px] ${
                  fit === id ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Fill fills the tile and crops what does not fit; fit shows the whole picture. Save to keep it.
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void findArt()}
              disabled={finding}
              className={`${btnGhost} flex items-center gap-2 text-xs disabled:opacity-50`}
            >
              {finding ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {finding ? 'Looking…' : 'Find other artwork'}
            </button>
            <span className="text-[11px] text-muted">
              Every picture the store has, grouped by the shape it is, so a badly cropped cover can be swapped.
            </span>
          </div>

          {artError && <p className="mt-2 text-[11px] text-rose-400">{artError}</p>}

          {options.length > 0 && (
            <div className="mt-3 space-y-3">
              {GROUPS.map(({ kind, title, where, shape }) => {
                const picks = options.filter((o) => o.kind === kind);
                if (picks.length === 0) return null;
                return (
                  <div key={kind}>
                    <p className="mb-1.5 text-[11px] text-muted">
                      <span className="font-medium text-fg">{title}</span> · {where}
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {picks.map((pick) => (
                        <li key={pick.url}>
                          <button
                            type="button"
                            onClick={() => {
                              // Where a click sends the picture is decided by
                              // what it is, not by what its file name happens to
                              // contain: a portrait is a cover, the wide ones
                              // are backdrops.
                              if (pick.kind === 'portrait' || pick.kind === 'capsule' || pick.kind === 'header') {
                                setCoverUrl(pick.url);
                              } else {
                                setBackdropUrl(pick.url);
                              }
                              say(`${pick.label} chosen. Save to keep it.`);
                            }}
                            title={`${pick.label}. ${where}`}
                            className={`group block overflow-hidden rounded-lg border-2 transition ${
                              pick.url === coverUrl || pick.url === backdropUrl
                                ? 'border-accent'
                                : 'border-line hover:border-muted'
                            }`}
                          >
                            <img
                              src={pick.url}
                              alt={pick.label}
                              loading="lazy"
                              className={shape === 'wide' ? 'h-16 w-28 object-cover' : 'h-24 w-16 object-cover'}
                            />
                            <span className="block max-w-28 truncate bg-panel px-1.5 py-1 text-left text-[10px] text-muted group-hover:text-fg">
                              {pick.label}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-line bg-panel2/40 p-3">
        <input
          type="checkbox"
          checked={planned}
          onChange={(e) => setPlanned(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--c-accent)]"
        />
        <span>
          <span className="block text-sm font-medium">Not owned yet</span>
          <span className="block text-xs text-muted">
            Tick this for a game you mean to play but do not have here. It stays on the Backlog page instead of the
            library, with no Play button, until a program is pointed at it.
          </span>
        </span>
      </label>

      <div className="space-y-2 rounded-xl border border-line bg-panel2/40 p-3">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
          <Sparkles className="size-3.5" />
          HowLongToBeat, in hours
        </h4>
        <p className="text-[11px] text-muted">
          These come from a lookup, and anything typed here is kept instead. Empty means no time known.
        </p>
        <div className="grid grid-cols-3 gap-2">
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
          className={`${btnGhost} flex items-center gap-2 text-xs`}
          onClick={() => void fetchHltb(title || game.title).then((h) => h && onUpdate({ hltb: h }))}
        >
          <RotateCcw className="size-3.5" />
          Look these up again
        </button>
      </div>

      <div className="block">
        <span className={labelCls}>
          Notes
          <span className="ml-2 normal-case tracking-normal text-muted/70">
            markdown, applied as you type: **bold**, - list, # heading, `code`
          </span>
        </span>
        <MarkdownEditor
          value={notes}
          onChange={setNotes}
          rows={6}
          placeholder="Anything you want to remember."
        />
      </div>

      {game.installDir && (
        <p className="break-all font-mono text-[11px] text-muted">
          {game.installDir}
          {game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <SaveButton onSave={save} />
        <button
          type="button"
          onClick={() => void fetchHltb(title || game.title).then((h) => h && onUpdate({ hltb: h }))}
          className="ml-auto flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-accent"
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
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-rose-400 hover:text-rose-400"
        >
          <Trash2 className="size-3.5" />
          Clear notes
        </button>
      </div>
    </section>
  );
}
