import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Images,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Star,
  Timer,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameFacts, GameSuggestion, HltbData } from '../../types';
import { fetchFacts } from '../../services/metadata';
import { fetchHltb } from '../../services/hltb';
import { openExternal } from '../../services/desktop';
import { cn } from '../../utils/cn';

/** Matches `.drawer-out` in the stylesheet. */
const LEAVE_MS = 300;

/**
 * What a game is before it is anyone's to play.
 *
 * Clicking a suggestion while planning a game used to write it down at once,
 * which made the choice permanent at the speed of a thumbnail. This sheet is
 * the answer to the question a player actually has in that moment: what is
 * this game, really. The store's own page, read through Bonker's cache, fills
 * it - description, price, the people behind it, how it was received, the
 * screenshots and trailers - and HowLongToBeat says what a plan needs most,
 * how long it takes. The only decision the sheet asks for is the one at the
 * foot: put it on the list, or not yet.
 */
export function PlanSheet({
  suggestion,
  adding,
  onAdd,
  onClose,
}: {
  /** The suggestion this sheet opened on: app id, name and a small picture. */
  suggestion: GameSuggestion;
  /** True while the add it asked for is being written. */
  adding: boolean;
  onAdd: (pick: { name: string; appId: number; coverUrl: string | null }) => void;
  onClose: () => void;
}) {
  const [facts, setFacts] = useState<GameFacts | null>(null);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [loadingFacts, setLoadingFacts] = useState(true);
  const [hltb, setHltb] = useState<HltbData | null>(null);
  const [loadingHltb, setLoadingHltb] = useState(true);
  /** The open still, as its number in the rail. */
  const [shot, setShot] = useState<number | null>(null);
  /** The trailer that is playing, as its number in the list. */
  const [showing, setShowing] = useState(0);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [slideIn, setSlideIn] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const beginClose = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onCloseRef.current();
      return;
    }
    setLeaving(true);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), LEAVE_MS);
  }, []);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setSlideIn(true));
    return () => {
      window.cancelAnimationFrame(id);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  /**
   * Load everything the page shows, once per app id. Facts come from the store
   * through Bonker; how long the game takes comes from HowLongToBeat, which
   * answers by name rather than by id, so it starts once the facts have the
   * game's real name.
   */
  const load = useCallback(() => {
    let live = true;
    setLoadingFacts(true);
    setFactsError(null);
    setLoadingHltb(true);
    void fetchFacts(suggestion.appId)
      .then((found) => {
        if (!live) return;
        setFacts(found);
        setLoadingFacts(false);
        void fetchHltb(found.name || suggestion.name)
          .then((times) => {
            if (live) setHltb(times);
          })
          .catch(() => {
            /* No times is information too: the row just reads quieter. */
          })
          .finally(() => {
            if (live) setLoadingHltb(false);
          });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setFactsError(error instanceof Error ? error.message : String(error));
        setLoadingFacts(false);
        setLoadingHltb(false);
      });
    return () => {
      live = false;
    };
  }, [suggestion.appId, suggestion.name]);

  useEffect(() => load(), [load]);

  // Escape closes the lightbox first, then the sheet; the arrows step through
  // the stills while one is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (shot !== null) setShot(null);
        else beginClose();
        return;
      }
      if (shot === null || !facts) return;
      if (event.key === 'ArrowRight') setShot((shot + 1) % facts.screenshots.length);
      if (event.key === 'ArrowLeft') setShot((shot + facts.screenshots.length - 1) % facts.screenshots.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beginClose, shot, facts]);

  const title = facts?.name || suggestion.name;
  const playable = (facts?.movies ?? []).filter((movie) => movie.mp4 || movie.webm);
  const trailer = playable[Math.min(showing, playable.length - 1)];
  const reviews = facts?.reviews ?? null;
  const reviewTone =
    !reviews ? ''
    : reviews.percent >= 80
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : reviews.percent >= 70
        ? 'border-lime-500/30 bg-lime-500/10 text-lime-300'
        : reviews.percent >= 40
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-300';

  const hltbRows = hltb
    ? [
        { label: 'Main story', hours: hltb.main },
        { label: 'Main + extras', hours: hltb.mainExtra },
        { label: 'Completionist', hours: hltb.completionist },
      ].filter((row) => row.hours > 0)
    : [];

  return (
    <>
      <div
        className={`orbit-detail-scrim ${leaving ? 'fade-out pointer-events-none' : ''} fixed inset-0 z-40 bg-black/40`}
        onClick={beginClose}
      />
      <aside
        className={`${leaving ? 'drawer-out pointer-events-none' : slideIn ? 'drawer-in' : 'drawer-off'} fixed inset-y-3 right-3 z-50 flex w-[560px] max-w-[calc(100vw-24px)]`}
        aria-label={`About ${title}`}
      >
        <div className="orbit-detail glass flex h-full min-h-0 w-full flex-col overflow-y-auto rounded-3xl">
          {/* The banner: the game's own hero art behind, its name in front, and
              the close on top. A page about deciding to play something should
              look like playing already. */}
          <div className="relative h-48 shrink-0 overflow-hidden rounded-t-3xl bg-panel">
            {(facts?.heroUrl ?? facts?.headerUrl) && (
              <img
                src={facts?.heroUrl ?? facts?.headerUrl ?? undefined}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10" />
            <button
              onClick={beginClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 grid size-7 place-items-center rounded-lg bg-black/40 text-muted hover:bg-black/60 hover:text-fg"
            >
              <X className="size-4" />
            </button>
            {facts && (
              <div className="absolute left-3 top-3 flex items-center gap-2">
                <span className="rounded-lg bg-black/50 px-2.5 py-1 text-xs font-medium text-fg">
                  {facts.comingSoon ? 'Coming soon' : facts.isFree ? 'Free' : (facts.priceText ?? null)}
                </span>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 flex items-end gap-4 p-5">
              <div className="min-w-0">
                {facts?.logoUrl && (
                  <img src={facts.logoUrl} alt="" className="mb-2 h-10 w-auto max-w-56 object-contain" />
                )}
                <h2 className="text-2xl font-bold leading-tight text-white">{title}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/70">
                  {facts?.developer && <span>by {facts.developer}</span>}
                  {facts?.publisher && facts.publisher !== facts.developer && <span>· {facts.publisher}</span>}
                  {facts?.releaseDate && <span>· {facts.releaseDate}</span>}
                </p>
              </div>
            </div>
          </div>

          {factsError && (
            <div className="m-5 flex flex-col items-start gap-3 rounded-2xl border border-line bg-panel p-4">
              <p className="text-sm text-muted">The store page could not be read: {factsError}</p>
              <button
                onClick={load}
                className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-1.5 text-xs font-medium text-fg hover:text-white"
              >
                <RefreshCw className="size-3.5" />
                Try again
              </button>
            </div>
          )}

          <div className="flex flex-1 flex-col gap-6 p-5">
            {loadingFacts && (
              <div className="flex items-center gap-3 text-sm text-muted">
                <LoaderCircle className="size-4 animate-spin" />
                Reading the store page…
              </div>
            )}

            {facts && (
              <>
                {/* The quick read: how players received it, what kind of game
                    it is, and when it came out of beta if it still is in one. */}
                {(reviews || facts.genres.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {reviews && (
                      <span
                        className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium', reviewTone)}
                        title={`${reviews.percent}% of ${reviews.total.toLocaleString()} reviews are positive`}
                      >
                        <Star className="size-3.5" fill="currentColor" strokeWidth={0} />
                        {reviews.summary} · {reviews.percent}%
                      </span>
                    )}
                    {facts.genres.map((genre) => (
                      <span key={genre} className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-muted">
                        {genre}
                      </span>
                    ))}
                  </div>
                )}

                {/* How long it takes is the answer a plan is decided by. */}
                <div>
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    <Clock className="size-3.5" />
                    How long to beat
                  </p>
                  {hltbRows.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {hltbRows.map((row) => (
                        <div key={row.label} className="rounded-xl border border-line bg-panel px-3 py-2.5">
                          <p className="text-base font-bold text-fg">{fmtHours(row.hours)}</p>
                          <p className="text-[11px] text-muted">{row.label}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-line bg-panel px-3 py-2.5 text-xs text-muted">
                      {loadingHltb
                        ? 'Timing it…'
                        : hltb?.source === 'estimate'
                          ? 'Only an estimate in the browser preview.'
                          : 'Nobody has written down how long this one takes yet.'}
                    </p>
                  )}
                </div>

                {(facts.summary || facts.description) && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      <Timer className="size-3.5" />
                      What it is
                    </p>
                    <p className="text-sm leading-relaxed text-fg/90">{facts.summary}</p>
                    {facts.description && facts.description !== facts.summary && (
                      <p className="mt-2 text-[13px] leading-relaxed text-muted">{facts.description}</p>
                    )}
                  </div>
                )}

                {playable.length > 0 && trailer && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      <Play className="size-3.5" />
                      Trailers
                    </p>
                    <video
                      key={trailer.mp4 ?? trailer.webm ?? trailer.thumbnail}
                      src={trailer.mp4 ?? trailer.webm ?? undefined}
                      poster={trailer.thumbnail || undefined}
                      controls
                      preload="metadata"
                      className="aspect-video w-full rounded-xl border border-line bg-black"
                    />
                    {playable.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {playable.map((movie, at) => (
                          <button
                            key={movie.name || at}
                            onClick={() => setShowing(at)}
                            className={cn(
                              'rounded-lg border px-2 py-1 text-[11px]',
                              at === Math.min(showing, playable.length - 1)
                                ? 'border-accent text-fg'
                                : 'border-line bg-panel text-muted hover:text-fg',
                            )}
                          >
                            {movie.name || `Trailer ${at + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {facts.screenshots.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      <Images className="size-3.5" />
                      Screenshots
                    </p>
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                      {facts.screenshots.map((picture, at) => (
                        <button key={picture.full} onClick={() => setShot(at)} className="shrink-0">
                          <img
                            src={picture.thumb}
                            alt={`${title} screenshot ${at + 1}`}
                            loading="lazy"
                            className="h-24 w-auto cursor-zoom-in rounded-lg border border-line object-cover hover:border-accent"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {facts.pcMinimum && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">What runs it</p>
                    <pre className="whitespace-pre-wrap rounded-xl border border-line bg-panel p-3 font-sans text-xs leading-relaxed text-muted">
                      {facts.pcMinimum}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="sticky bottom-0 mt-auto flex items-center gap-3 border-t border-line bg-panel/90 px-5 py-4 backdrop-blur">
            <button
              disabled={adding}
              onClick={() =>
                onAdd({
                  name: title,
                  appId: suggestion.appId,
                  coverUrl: facts?.portraitUrl ?? suggestion.coverUrl,
                })
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add to backlog
            </button>
            {facts?.homepage && (
              <button
                onClick={() => void openExternal(facts.homepage ?? '')}
                title="Open the game's own site"
                className="grid size-10 place-items-center rounded-xl border border-line bg-panel text-muted hover:text-fg"
              >
                <Globe className="size-4" />
              </button>
            )}
            <button onClick={beginClose} className="rounded-xl px-3 py-2.5 text-sm text-muted hover:text-fg">
              Not yet
            </button>
          </div>

          <p className="px-5 pb-4 pt-1 text-[10px] text-muted/70">
            Store details via Steam &amp; bonker.dev · times via HowLongToBeat
          </p>
        </div>
      </aside>

      {/* One still, as big as the screen lets it be. */}
      {shot !== null && facts && facts.screenshots[shot] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-8"
          onClick={() => setShot(null)}
        >
          <button
            aria-label="Close"
            className="absolute right-4 top-4 grid size-9 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            <X className="size-4" />
          </button>
          <img
            src={facts.screenshots[shot].full}
            alt={`${title} screenshot ${shot + 1}`}
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {facts.screenshots.length > 1 && (
            <>
              <button
                aria-label="Previous"
                className="absolute left-4 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  setShot((shot + facts.screenshots.length - 1) % facts.screenshots.length);
                }}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                aria-label="Next"
                className="absolute right-4 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  setShot((shot + 1) % facts.screenshots.length);
                }}
              >
                <ChevronRight className="size-4" />
              </button>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80">
                {shot + 1} / {facts.screenshots.length}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** `12h`, or `12h 30m` when a half hour matters. */
function fmtHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
