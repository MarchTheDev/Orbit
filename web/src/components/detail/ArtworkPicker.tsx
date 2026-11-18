import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, ImageOff, LoaderCircle, Plus, Search, Sparkles, X } from 'lucide-react';
import type { ArtworkFound, ArtworkPick } from '../../services/native';
import { cn } from '../../utils/cn';

/**
 * The shapes a game's art comes in.
 *
 * These are the frames the game is actually drawn in: a tall poster on a library
 * tile, a wide picture behind Stardeck. Each is fetched and offered on its own,
 * because the best picture of a game is a different picture in each shape - and
 * a wide hero picked for a tall slot crops whatever was in the middle of it.
 */
export type ArtShape = 'portrait' | 'wide';

/** One picture a source found, with the source written on it. */
type Found = ArtworkPick & { source: string };

/** What each source is, in a few words, for the row under the grid. */
const SOURCE_NOTE: Record<string, string> = {
  Steam: 'the store’s own art',
  SteamGridDB: 'community art',
  Web: 'found on the web',
  Library: 'already in the library',
};

/** How a source draws a picture's own shape, for the small mark on a tile. */
const SOURCE_MARK: Record<string, string> = {
  Steam: 'store',
  SteamGridDB: 'community',
  Web: 'web',
  Library: 'here',
};

/**
 * The covers dialog, as Orbit can have it.
 *
 * The dialog is two columns with two jobs, which is the whole of the idea:
 *
 * - **On the left, the slots.** One per shape, each showing the picture the game
 *   has now *in the shape it is kept in*, with a line saying where that picture
 *   came from and what else can be done to it. Switching slot changes what the
 *   right column is searching for; it does not change the game.
 * - **On the right, what was found for that slot.** The store's own art first,
 *   then SteamGridDB, then the web, each labelled with its source, in the slot's
 *   shape, paged 15 at a time with "Load more", and searchable under a name of
 *   your choosing. Picking one writes it to the game and leaves the search open,
 *   so the next slot can be done in the same visit - which is how a game with a
 *   bad cover and a bad backdrop gets both fixed without opening the dialog
 *   twice.
 *
 * The current picture stays on screen the whole time, so a replacement is a
 * comparison rather than a memory.
 */
export function ArtworkSearch({
  shape,
  title,
  current,
  load,
  onChoose,
  onClose,
  onUseFile,
  onPickSlot,
}: {
  /** The slot the dialog opens on. */
  shape: ArtShape;
  title: string;
  current: { portrait: string | null; wide: string | null };
  /** Finds one page for a slot, under a name. */
  load: (shape: ArtShape, query: string, page: number) => Promise<ArtworkFound>;
  onChoose: (shape: ArtShape, url: string, source: string) => void;
  onClose: () => void;
  /** A picture from this machine, which no search can find. */
  onUseFile?: (shape: ArtShape) => void;
  /** Told when the slot changes, so the page behind can follow. */
  onPickSlot?: (shape: ArtShape) => void;
}) {
  const [slot, setSlot] = useState<ArtShape>(shape);
  const [query, setQuery] = useState(title);
  const [searched, setSearched] = useState(title);
  const [picks, setPicks] = useState<Found[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const run = useRef(0);
  const field = useRef<HTMLInputElement>(null);

  const loadSlot = useCallback(
    async (which: ArtShape, nextPage: number, text: string, replace: boolean) => {
      const token = ++run.current;
      setBusy(true);
      setError(null);
      try {
        const found = await load(which, text, nextPage);
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

  // The search runs on open, and again when the slot changes. A dialog that
  // opens on an empty box is asking for a decision before it has shown anything
  // to decide between.
  useEffect(() => {
    void loadSlot(slot, 0, searched, true);
  }, [loadSlot, slot, searched]);

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
  const currentPicture = current[slot];
  const unit = slot === 'portrait' ? 'cover' : 'backdrop';

  const chooseSlot = (next: ArtShape) => {
    setSlot(next);
    onPickSlot?.(next);
  };

  return createPortal(
    <div
      className="orbit-covers-wrap"
      role="dialog"
      aria-modal="true"
      aria-label={`Artwork for ${title}`}
    >
      <button type="button" tabIndex={-1} aria-label="Close artwork" className="orbit-covers-scrim" onClick={onClose} />

      <div className="orbit-covers">
        <header className="orbit-covers-head">
          <div className="min-w-0">
            <p className="orbit-covers-kicker">Artwork</p>
            <h2 className="orbit-covers-title">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="orbit-covers-x">
            <X className="size-4" />
          </button>
        </header>

        <div className="orbit-covers-body">
          {/* --- the slots: what the game keeps, in the shape it keeps it in -- */}
          <aside className="orbit-covers-slots" aria-label="Picture slots">
            {(['portrait', 'wide'] as ArtShape[]).map((which) => {
              const picture = current[which];
              const on = which === slot;
              return (
                <button
                  key={which}
                  type="button"
                  aria-pressed={on}
                  className={cn('orbit-covers-slot', on && 'is-on')}
                  onClick={() => chooseSlot(which)}
                >
                  <span className={cn('orbit-covers-slot-frame', which === 'wide' ? 'is-wide' : 'is-portrait')}>
                    {picture ? <img src={picture} alt="" /> : <span>None</span>}
                  </span>
                  <span className="orbit-covers-slot-copy">
                    <b>{which === 'portrait' ? 'Cover' : 'Backdrop'}</b>
                    <i>{which === 'portrait' ? '2:3 · library tiles' : '16:9 · Stardeck'}</i>
                    <i>{picture ? 'A picture of its own' : 'Nothing set yet'}</i>
                  </span>
                </button>
              );
            })}

            <div className="orbit-covers-slot-actions">
              {onUseFile && (
                <button type="button" className="orbit-covers-file" onClick={() => onUseFile(slot)}>
                  <FolderOpen className="size-3.5" />
                  Choose a file…
                </button>
              )}
            </div>
          </aside>

          {/* --- what was found for the slot --------------------------------- */}
          <div className="orbit-covers-found">
            <div className="orbit-covers-bar">
              <label className="orbit-covers-search">
                <Search className="size-4" aria-hidden />
                <input
                  ref={field}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    setSearched(query.trim() || title);
                  }}
                  placeholder={`Search ${unit} art by name`}
                  aria-label={`Search name for ${unit} art`}
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="orbit-covers-find"
                disabled={busy}
                onClick={() => setSearched(query.trim() || title)}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Search
              </button>
            </div>

            <div className="orbit-covers-results">
              <div className="orbit-covers-results-head">
                <p className="orbit-covers-results-title">
                  {started ? `Found for “${searched}”` : 'Looking…'}
                  {picks.length > 0 && <span>{picks.length}</span>}
                </p>
                {picks.length > 0 && (
                  <div className="orbit-covers-sources" role="group" aria-label="Where the pictures came from">
                    <button type="button" aria-pressed={source === null} onClick={() => setSource(null)}>
                      All<span>{picks.length}</span>
                    </button>
                    {[...counts.entries()].map(([id, n]) => (
                      <button key={id} type="button" aria-pressed={source === id} onClick={() => setSource(id)}>
                        {id}<span>{n}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error && <p role="alert" className="orbit-covers-error">{error}</p>}

              {!started && busy && (
                <p className="orbit-covers-idle">
                  <LoaderCircle className="size-4 animate-spin" />
                  Looking for {unit} art…
                </p>
              )}

              {started && shown.length === 0 && !busy && (
                <p className="orbit-covers-idle">
                  <ImageOff className="size-4" />
                  Nothing came back for “{searched}”. A shorter name, or the name the store uses, usually finds it.
                </p>
              )}

              {shown.length > 0 && (
                <ul className={cn('orbit-covers-grid', slot === 'wide' && 'is-wide')}>
                  {shown.map((pick) => {
                    const chosen = currentPicture === pick.url;
                    return (
                      <li key={pick.url}>
                        <button
                          type="button"
                          className={cn('orbit-covers-tile', slot === 'wide' ? 'is-wide' : 'is-portrait', chosen && 'is-chosen')}
                          aria-pressed={chosen}
                          title={`${pick.label} · ${pick.source}`}
                          onClick={() => onChoose(slot, pick.url, pick.source)}
                        >
                          <img src={pick.url} alt={pick.label} loading="lazy" draggable={false} />
                          <span className="orbit-covers-mark">{SOURCE_MARK[pick.source] ?? 'found'}</span>
                          <span className="orbit-covers-from">{pick.source}</span>
                          {chosen && (
                            <span className="orbit-covers-tick">
                              <Check className="size-3.5" />
                            </span>
                          )}
                        </button>
                        <p className="orbit-covers-caption">{pick.label}</p>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="orbit-covers-foot">
                {hasMore && (
                  <button type="button" disabled={busy} onClick={() => void loadSlot(slot, page + 1, searched, false)}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Load more
                  </button>
                )}
                <span className="orbit-covers-lede">
                  {[...counts.entries()].map(([id, n]) => `${n} from ${SOURCE_NOTE[id] ?? id}`).join(' · ')}
                </span>
              </div>
            </div>
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
