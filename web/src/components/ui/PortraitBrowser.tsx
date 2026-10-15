import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Sparkles } from 'lucide-react';
import type { ArtworkFound, ArtworkPick } from '../../services/native';
import { btnGhost } from './Modal';
import { cn } from '../../utils/cn';

/**
 * A 2:3 frame the picture fills.
 *
 * A wide banner letterboxed in a tall tile left a gray half, and a transparent
 * PNG on the panel colour did the same. The frame is the tile shape, black
 * behind the picture, and the picture covers it.
 */
export function PortraitFrame({
  src,
  className,
  children,
}: {
  src?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('h-28 w-[4.67rem] shrink-0 overflow-hidden rounded-xl bg-black', className)}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : children}
    </div>
  );
}

/**
 * Portrait covers, one page at a time, started by a button.
 *
 * Nothing is fetched when the form opens. A game can have far more covers than
 * fit on one screen, so the next page is a separate ask.
 */
export function PortraitBrowser({
  resetKey,
  disabled,
  selected,
  load,
  onFound,
  onChoose,
}: {
  resetKey: string;
  disabled?: boolean;
  selected?: string | null;
  load: (page: number) => Promise<ArtworkFound>;
  onFound?: (found: ArtworkFound) => void;
  onChoose: (pick: ArtworkPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [picks, setPicks] = useState<ArtworkPick[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current += 1;
    setOpen(false);
    setPage(0);
    setPicks([]);
    setHasMore(false);
    setFinding(false);
    setError(null);
  }, [resetKey]);

  const ask = async (next: number) => {
    const id = ++gen.current;
    setOpen(true);
    setFinding(true);
    setError(null);
    try {
      const found = await load(next);
      if (id !== gen.current) return;
      onFound?.(found);
      setPicks(found.picks);
      setPage(found.page ?? next);
      setHasMore(Boolean(found.hasMore));
      if (found.picks.length === 0) {
        setError(next === 0 ? 'No portrait covers for this game. A file can still be chosen.' : 'No more covers on this page.');
      }
    } catch (e) {
      if (id !== gen.current) return;
      setPicks([]);
      setHasMore(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === gen.current) setFinding(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        disabled={disabled || finding}
        onClick={() => void ask(0)}
        className={`${btnGhost} flex items-center gap-2 text-xs disabled:opacity-50`}
      >
        {finding ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {finding ? 'Looking…' : 'Browse covers'}
      </button>
      {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
      {open && picks.length > 0 && (
        <ul
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))' }}
        >
          {picks.map((pick) => (
            <li key={pick.url}>
              <button
                type="button"
                title={pick.label}
                onClick={() => onChoose(pick)}
                className={cn(
                  'aspect-[2/3] w-full overflow-hidden rounded-lg border-2 bg-black',
                  selected === pick.url ? 'border-accent' : 'border-transparent hover:border-muted',
                )}
              >
                <img src={pick.url} alt="" className="aspect-[2/3] w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (page > 0 || hasMore) && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={finding || page === 0}
            onClick={() => void ask(page - 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-fg disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" />
            Previous
          </button>
          <span className="text-[11px] text-muted">Page {page + 1}</span>
          <button
            type="button"
            disabled={finding || !hasMore}
            onClick={() => void ask(page + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-fg disabled:opacity-40"
          >
            More covers
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
