import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImageOff, LoaderCircle, Plus, Search, Sparkles, X } from 'lucide-react';
import type { ArtworkFound, ArtworkPick } from '../../services/native';
import { cn } from '../../utils/cn';

/**
 * The shapes a game's art comes in.
 *
 * These are the frames the game is actually drawn in: a tall poster on a
 * library tile, a wide picture behind Stardeck. Each is fetched and offered on
 * its own, because the best picture of a game is a different picture in each
 * shape - and a wide hero picked for a tall slot crops whatever was in the
 * middle of it.
 */
export type ArtShape = 'portrait' | 'wide';

/** One picture a source found, with where it came from. */
type Found = ArtworkPick & { source: string };

const SOURCE_MARK: Record<string, string> = {
  Steam: 'store',
  SteamGridDB: 'community',
  Web: 'web',
  Library: 'here',
};

/**
 * The artwork search, in a room of its own.
 *
 * Heronite's version is a dialog for a reason, and the reason is the one thing
 * a page of thumbnails inside a form cannot do: give the pictures the whole
 * width. A 90 px tile in a column beside a summary is not a picture anyone can
 * judge - the crop, the logo, the region, the noise - and judging them is the
 * entire job. So the page shows what the game has now, and a search opens this:
 *
 * - **The current picture, at size, first**, in the shape it will be drawn in,
 *   so a replacement is always a comparison rather than a memory.
 * - **One source at a time, with counts.** The store's own art, SteamGridDB and
 *   the web are different rooms in the same gallery; the counts say where the
 *   pictures are before a click is spent finding out.
 * - **A name to search under.** The art for a game is often filed under a
 *   shorter title, or under the sequel's - so the field starts with this game's
 *   name and can be told otherwise without renaming anything.
 * - **A page at a time**, with "Load more" as a second ask rather than a slower
 *   first one.
 *
 * Choosing a picture hands its URL back and saves it there. Escape closes
 * without choosing, which is also the only way to change your mind.
 */
export function ArtworkSearch({
  shape,
  title,
  current,
  load,
  onChoose,
  onClose,
  onUseFile,
}: {
  shape: ArtShape;
  title: string;
  current: string | null;
  load: (query: string, page: number) => Promise<ArtworkFound>;
  onChoose: (url: string, source: string) => void;
  onClose: () => void;
  /** A picture from this machine, which no search can find. */
  onUseFile?: () => void;
}) {
  const what = shape === 'portrait' ? 'cover' : 'backdrop';
  const [query, setQuery] = useState(title);
  const [searched, setQuerySearched] = useState(title);
  const [picks, setPicks] = useState<Found[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const run = useRef(0);
  const field = useRef<HTMLInputElement>(null);

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
        setSource(null);
        setStarted(true);
      } catch (cause) {
        if (token === run.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (token === run.current) setBusy(false);
      }
    },
    [load],
  );

  // The search runs on open. A dialog that opens on an empty box and a button
  // is asking for a decision before it has shown anything to decide between.
  useEffect(() => {
    void fetchPage(0, title, true);
  }, [fetchPage, title]);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const counts = new Map<string, number>();
  for (const pick of picks) counts.set(pick.source, (counts.get(pick.source) ?? 0) + 1);
  const shown = source ? picks.filter((pick) => pick.source === source) : picks;

  return createPortal(
    <div
      className="orbit-artstudio-wrap"
      role="dialog"
      aria-modal="true"
      aria-label={`Find a ${what} for ${title}`}
    >
      <button type="button" tabIndex={-1} aria-label={`Close the ${what} search`} className="orbit-artstudio-scrim" onClick={onClose} />

      <div className="orbit-artstudio">
        <header className="orbit-artstudio-head">
          <div className="min-w-0">
            <p className="orbit-artstudio-kicker">{shape === 'portrait' ? 'Cover art' : 'Wide backdrop'}</p>
            <h2 className="orbit-artstudio-title">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="orbit-artstudio-x">
            <X className="size-4" />
          </button>
        </header>

        <div className="orbit-artstudio-bar">
          <label className="orbit-artstudio-search">
            <Search className="size-4" aria-hidden />
            <input
              ref={field}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const text = query.trim() || title;
                setQuerySearched(text);
                void fetchPage(0, text, true);
              }}
              placeholder={`Search ${shape === 'portrait' ? 'covers' : 'pictures'} by name`}
              aria-label={`Search name for ${what} art`}
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="orbit-artstudio-find"
            disabled={busy}
            onClick={() => {
              const text = query.trim() || title;
              setQuerySearched(text);
              void fetchPage(0, text, true);
            }}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Search
          </button>
        </div>

        <div className="orbit-artstudio-body">
          {/* What the game shows now, at the size it is shown at. Kept on the
              left for the whole visit, so every picture on the right is read
              against it. */}
          <aside className="orbit-artstudio-now">
            <p className="orbit-artstudio-label">Showing now</p>
            <div className={cn('orbit-artstudio-frame', shape === 'wide' ? 'is-wide' : 'is-portrait')}>
              {current ? <img src={current} alt="" /> : <span>{shape === 'wide' ? 'No backdrop yet' : 'No cover yet'}</span>}
            </div>
            {onUseFile && (
              <button type="button" className="orbit-artstudio-file" onClick={onUseFile}>
                A file from this machine…
              </button>
            )}
          </aside>

          <div className="orbit-artstudio-results">
            {picks.length > 0 && (
              <div className="orbit-artstudio-sources" role="group" aria-label="Where the pictures came from">
                <button type="button" aria-pressed={source === null} onClick={() => setSource(null)}>
                  All sources<span>{picks.length}</span>
                </button>
                {[...counts.entries()].map(([id, n]) => (
                  <button key={id} type="button" aria-pressed={source === id} onClick={() => setSource(id)}>
                    {id}<span>{n}</span>
                  </button>
                ))}
              </div>
            )}

            {error && <p role="alert" className="orbit-artstudio-error">{error}</p>}

            {!started && busy && (
              <p className="orbit-artstudio-idle">
                <LoaderCircle className="size-4 animate-spin" />
                Looking for {what} art under “{query.trim() || title}”…
              </p>
            )}

            {started && shown.length === 0 && !busy && (
              <p className="orbit-artstudio-idle">
                <ImageOff className="size-4" />
                Nothing came back for “{searched}”. A shorter name, or the name the store uses, usually finds it.
              </p>
            )}

            {shown.length > 0 && (
              <ul className={cn('orbit-artstudio-grid', shape === 'wide' && 'is-wide')}>
                {shown.map((pick) => {
                  const chosen = current === pick.url;
                  return (
                    <li key={pick.url}>
                      <button
                        type="button"
                        className={cn('orbit-artstudio-tile', shape === 'wide' ? 'is-wide' : 'is-portrait', chosen && 'is-chosen')}
                        aria-pressed={chosen}
                        title={`${pick.label} · ${pick.source}`}
                        onClick={() => onChoose(pick.url, pick.source)}
                      >
                        <img src={pick.url} alt={pick.label} loading="lazy" draggable={false} />
                        <span className="orbit-artstudio-mark">{SOURCE_MARK[pick.source] ?? 'found'}</span>
                        <span className="orbit-artstudio-from">{pick.source}</span>
                        {chosen && (
                          <span className="orbit-artstudio-tick">
                            <Check className="size-3.5" />
                          </span>
                        )}
                      </button>
                      <p className="orbit-artstudio-caption">{pick.label}</p>
                    </li>
                  );
                })}
              </ul>
            )}

            {hasMore && (
              <div className="orbit-artstudio-more">
                <button type="button" disabled={busy} onClick={() => void fetchPage(page + 1, searched, false)}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Load more
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Which source a picture came from, from what the backend says about it.
 *
 * The backend labels a picture by what it is ("SteamGridDB hero", "Steam
 * capsule", "Web image"); this turns that into the short name a tile carries.
 */
function sourceOf(kind: string, label: string): string {
  const text = `${kind} ${label}`.toLowerCase();
  if (text.includes('steamgriddb') || text.includes('sgdb') || text.includes('bonker')) return 'SteamGridDB';
  if (text.includes('web')) return 'Web';
  if (text.includes('steam') || ['portrait', 'hero', 'header', 'capsule'].includes(kind)) return 'Steam';
  return 'Library';
}
