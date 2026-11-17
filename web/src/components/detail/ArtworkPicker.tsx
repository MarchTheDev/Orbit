import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImageOff, LoaderCircle, Plus, Search, Sparkles } from 'lucide-react';
import type { ArtworkFound, ArtworkPick } from '../../services/native';
import { cn } from '../../utils/cn';

/**
 * The shapes a game's art comes in.
 *
 * These are the frames the game is actually drawn in: a tall poster on a
 * library tile, a wide picture behind Stardeck, a square icon for a console
 * grid. Each one is fetched and offered on its own, because the best picture of
 * a game is a different picture in each shape - and picking a wide hero for a
 * tall slot used to crop whatever was in the middle of it.
 */
export type ArtShape = 'portrait' | 'wide' | 'square';

/** What the two slots are for, in the words the page uses. */
export const ART_SLOTS: { id: ArtShape; title: string; hint: string }[] = [
  { id: 'portrait', title: 'Cover', hint: 'The poster on library tiles and in the deck.' },
  { id: 'wide', title: 'Backdrop', hint: 'The picture behind the game in Stardeck.' },
];

/** How wide a tile asks to be drawn, per shape, so the grid stays even. */
const SHAPE_TILE: Record<ArtShape, string> = {
  portrait: 'orbit-arttile is-portrait',
  wide: 'orbit-arttile is-wide',
  square: 'orbit-arttile is-square',
};

/**
 * One picture a source found.
 *
 * The same shape as Heronite's: the source it came from, and the region when a
 * source knows one. A player looking at six near-identical covers is helped by
 * "SteamGridDB" and "web" more than by anything else on the tile, because it
 * tells them which of the two is the store's own art.
 */
type Found = ArtworkPick & { source: string };

/**
 * Covers and backdrops, found rather than guessed at.
 *
 * This is the shape Heronite uses, and it is the one that makes a page of
 * artwork usable:
 *
 * - **A slot per shape.** The page shows what the game has now, then the
 *   pictures found for that shape. A cover choice never lands in the backdrop
 *   slot.
 * - **Every source at once, labelled.** The store's own picture, SteamGridDB
 *   when a key is set, and the web as a last resort. Each tile says where it
 *   came from, so a choice is a choice between pictures and not between
 *   invisible sources.
 * - **A page at a time.** Nothing is fetched until the player asks for it, and
 *   "Show more" is a second ask rather than a slower first one.
 * - **Search by name.** The art for a game is often under a shorter title, or
 *   under its sequel's name; the field is there to say so without renaming the
 *   game.
 *
 * Choosing one writes it into the game at once. Everything here is a picture,
 * and a picture that has been picked is the player's decision.
 */
export function ArtworkPicker({
  shape,
  title,
  load,
  current,
  onChoose,
  onReset,
  canReset,
  onUseFile,
}: {
  shape: ArtShape;
  /** The game's name, as the search field starts. */
  title: string;
  /** Finds one more page for this shape and this search text. */
  load: (query: string, page: number) => Promise<ArtworkFound>;
  /** What the game shows now, if anything. */
  current: string | null;
  onChoose: (url: string, source: string) => void;
  /** Back to whatever the library would draw on its own. */
  onReset: () => void;
  canReset: boolean;
  /** A picture on this machine, which no search can find. */
  onUseFile?: () => void;
}) {
  const [query, setQuery] = useState(title);
  const [picks, setPicks] = useState<Found[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  /** Which sources found something, for the filter row. */
  const [source, setSource] = useState<string | null>(null);
  const run = useRef(0);

  // A different game, or a different title, starts over: the pictures found for
  // one game are never offered for another.
  useEffect(() => {
    run.current += 1;
    setQuery(title);
    setPicks([]);
    setPage(0);
    setHasMore(false);
    setSearched(false);
    setError(null);
    setSource(null);
  }, [title, shape]);

  const fetchPage = useCallback(
    async (nextPage: number, text: string, replace: boolean) => {
      const token = ++run.current;
      setBusy(true);
      setError(null);
      try {
        const found = await load(text, nextPage);
        if (token !== run.current) return;
        const incoming: Found[] = found.picks.map((pick) => ({
          ...pick,
          source: sourceOf(pick.kind, pick.label),
        }));
        setPicks((have) => {
          const merged = replace ? incoming : [...have, ...incoming];
          // The same picture can be offered by two sources; it is one picture.
          const seen = new Set<string>();
          return merged.filter((pick) => {
            if (seen.has(pick.url)) return false;
            seen.add(pick.url);
            return true;
          });
        });
        setPage(nextPage);
        setHasMore(incoming.length > 0);
        setSearched(true);
      } catch (cause) {
        if (token === run.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (token === run.current) setBusy(false);
      }
    },
    [load],
  );

  const sources = Array.from(new Set(picks.map((pick) => pick.source)));
  const shown = source ? picks.filter((pick) => pick.source === source) : picks;

  return (
    <div className="orbit-artpicker">
      <div className="orbit-artpicker-bar">
        <label className="orbit-artpicker-search">
          <Search className="size-3.5" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void fetchPage(0, query.trim() || title, true);
            }}
            placeholder={`Search ${shape === 'portrait' ? 'covers' : 'pictures'} for ${title}`}
            aria-label="Search for artwork by name"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="orbit-artpicker-find"
          disabled={busy}
          onClick={() => void fetchPage(0, query.trim() || title, true)}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {searched ? 'Search again' : 'Find artwork'}
        </button>
      </div>

      {sources.length > 1 && (
        <div className="orbit-artpicker-sources" role="group" aria-label="Sources">
          <button type="button" aria-pressed={source === null} onClick={() => setSource(null)}>
            Every source
            <span>{picks.length}</span>
          </button>
          {sources.map((id) => (
            <button key={id} type="button" aria-pressed={source === id} onClick={() => setSource(id)}>
              {id}
              <span>{picks.filter((pick) => pick.source === id).length}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="orbit-artpicker-error">{error}</p>}

      {!searched && !busy && (
        <p className="orbit-artpicker-idle">
          {shape === 'portrait'
            ? 'Find a cover from the store, SteamGridDB and the web, or choose a picture from this machine.'
            : 'Find a wide picture for Stardeck, or choose one from this machine.'}
        </p>
      )}

      {searched && shown.length === 0 && !busy && (
        <p className="orbit-artpicker-empty">
          <ImageOff className="size-4" />
          Nothing was found under “{query.trim() || title}”. A shorter name, or the game's other title, often finds it.
        </p>
      )}

      {shown.length > 0 && (
        <ul className={cn('orbit-artpicker-grid', shape === 'portrait' && 'is-portrait')}>
          {shown.map((pick) => {
            const chosen = current === pick.url;
            return (
              <li key={pick.url}>
                <button
                  type="button"
                  className={cn(SHAPE_TILE[shape], chosen && 'is-chosen')}
                  aria-pressed={chosen}
                  title={`${pick.label} · ${pick.source}`}
                  onClick={() => onChoose(pick.url, pick.source)}
                >
                  <img src={pick.url} alt={pick.label} loading="lazy" draggable={false} />
                  <span className="orbit-arttile-source">{pick.source}</span>
                  {chosen && (
                    <span className="orbit-arttile-chosen">
                      <Check className="size-3.5" />
                    </span>
                  )}
                </button>
                <p className="orbit-arttile-label">{pick.label}</p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="orbit-artpicker-foot">
        {hasMore && (
          <button type="button" className="orbit-artpicker-more" disabled={busy} onClick={() => void fetchPage(page + 1, query.trim() || title, false)}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Show more
          </button>
        )}
        {onUseFile && (
          <button type="button" className="orbit-artpicker-more" onClick={onUseFile}>
            Choose a file…
          </button>
        )}
        {canReset && (
          <button type="button" className="orbit-artpicker-reset" onClick={onReset}>
            Use the library's own
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Which source a picture came from, from what the backend says about it.
 *
 * The backend labels a picture by what it is ("SteamGridDB hero", "Steam
 * capsule", "Web image"); this turns that into the short name a tile can carry.
 */
function sourceOf(kind: string, label: string): string {
  const text = `${kind} ${label}`.toLowerCase();
  if (text.includes('steamgriddb') || text.includes('sgdb')) return 'SteamGridDB';
  if (text.includes('bonker') || text.includes('cloudflare')) return 'SteamGridDB';
  if (text.includes('web')) return 'Web';
  if (text.includes('steam') || kind === 'portrait' || kind === 'hero' || kind === 'header' || kind === 'capsule') return 'Steam';
  return 'Library';
}
