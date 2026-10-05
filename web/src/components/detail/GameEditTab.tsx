import { useEffect, useState } from 'react';
import { Check, FolderOpen, Image, Pencil, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { Game, HltbData, MetaData } from '../../types';
import { isNative } from '../../services/native';
import { pickAnyFile } from '../../services/desktop';
import { fetchHltb } from '../../services/hltb';
import { fmtBytes } from '../../utils/format';
import { Cover } from '../ui/Cover';
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
  const [saved, setSaved] = useState(false);

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
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      coverPath: coverPath.trim() || null,
      sizeBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1e9) : 0,
      sizeGb: Number.isFinite(gb) && gb > 0 ? gb : 0,
      meta: nextMeta,
      hltb: nextHltb ?? undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
      </div>

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

      <label className="block">
        <span className={labelCls}>Notes</span>
        <textarea
          className={`${inputCls} h-24 resize-y`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you want to remember."
        />
      </label>

      {game.installDir && (
        <p className="break-all font-mono text-[11px] text-muted">
          {game.installDir}
          {game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          onClick={save}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-2 text-sm font-semibold text-white"
        >
          <Check className="size-4" />
          Save changes
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved.</span>}
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
