import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Images,
  Info,
  LoaderCircle,
  MonitorCog,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Star,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameFacts, GameSuggestion, HltbData } from '../../types';
import { fetchFacts } from '../../services/metadata';
import { fetchHltb } from '../../services/hltb';
import { openExternal } from '../../services/desktop';
import { cn } from '../../utils/cn';

/**
 * What a game is before it is anyone's to play.
 *
 * Clicking a suggestion while planning used to write it down at once, at the
 * speed of a thumbnail. This page instead answers the question a player has in
 * that moment - what is this game, really. The store's own page, read through
 * Bonker's cache, fills it: story, price, the people behind it, how it was
 * received, stills and trailers. HowLongToBeat says the one thing the store
 * never knew: how long it takes. The only choice the page asks for is at its
 * foot - put it on the list, or not yet.
 *
 * It sits in the middle like a page of the app rather than sliding in from the
 * side: it is a place, not a drawer, and leaving it returns to exactly the
 * search that opened it. Portals draw it at the end of the document, the way
 * every other dialog in Orbit is drawn, because a transformed ancestor is
 * where a fixed box stops meaning what it says.
 */
export function PlanSheet({
  suggestion,
  adding,
  onAdd,
  onClose,
}: {
  /** The suggestion this page opened on: app id, name and a small picture. */
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
  /** How far the long text is let run: false means only the opening. */
  const [more, setMore] = useState(false);

  /**
   * Load everything the page shows, all in flight at once. The store facts
   * take the app id; the times take the name, and the suggestion's name is
   * already the store's own, so neither waits on the other.
   */
  const load = useCallback(() => {
    let live = true;
    setLoadingFacts(true);
    setLoadingHltb(true);
    setFactsError(null);
    void fetchFacts(suggestion.appId)
      .then((found) => {
        if (!live) return;
        setFacts(found);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setFactsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (live) setLoadingFacts(false);
      });
    void fetchHltb(suggestion.name)
      .then((times) => {
        if (live) setHltb(times);
      })
      .catch(() => {
        /* No times is information too: the row just reads quieter. */
      })
      .finally(() => {
        if (live) setLoadingHltb(false);
      });
    return () => {
      live = false;
    };
  }, [suggestion.appId, suggestion.name]);

  useEffect(() => load(), [load]);

  // Escape closes the lightbox first, then the page; the arrows step through
  // the stills while one is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (shot !== null) {
          setShot(null);
          event.stopImmediatePropagation();
        } else {
          onClose();
        }
        return;
      }
      if (shot === null || !facts) return;
      if (event.key === 'ArrowRight') setShot((shot + 1) % facts.screenshots.length);
      if (event.key === 'ArrowLeft') setShot((shot + facts.screenshots.length - 1) % facts.screenshots.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, shot, facts]);

  const title = facts?.name || suggestion.name;
  const banner = facts?.heroUrl ?? facts?.headerUrl ?? suggestion.coverUrl;
  const playable = (facts?.movies ?? []).filter((movie) => movie.mp4 || movie.webm);
  const trailer = playable[Math.min(showing, playable.length - 1)];
  const reviews = facts?.reviews ?? null;
  const reviewTone =
    !reviews
      ? ''
      : reviews.percent >= 80
        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
        : reviews.percent >= 70
          ? 'border-lime-400/30 bg-lime-400/10 text-lime-300'
          : reviews.percent >= 40
            ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
            : 'border-rose-400/30 bg-rose-400/10 text-rose-300';

  const hltbRows = hltb
    ? [
        { label: 'Main story', hours: hltb.main },
        { label: 'Main + extras', hours: hltb.mainExtra },
        { label: 'Completionist', hours: hltb.completionist },
      ].filter((row) => row.hours > 0)
    : [];

  const description = facts?.description ?? '';
  const longEnough = description.length > 700;

  const panel = (
    <div
      // A dialog is modal even over the in-game overlay, which is what this
      // marker is for elsewhere; being a page of the app does not exempt it.
      data-overlay-hit="1"
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={`About ${title}`}
        className="modal-panel-enter relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* The banner: the game's own hero behind, its name in front, and the
            close on top - a page about deciding to play something should look
            like playing already. */}
        <div className="relative h-56 shrink-0 overflow-hidden sm:h-64">
          {banner ? (
            <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-panel2" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-xl bg-black/45 text-white/70 transition hover:bg-black/70 hover:text-white"
          >
            <X className="size-4" />
          </button>
          {facts && (
            <div className="absolute left-5 top-4 flex items-center gap-2">
              <span className="rounded-lg border border-white/15 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                {facts.comingSoon ? 'Coming soon' : facts.isFree ? 'Free to play' : (facts.priceText ?? 'Not for sale')}
              </span>
              {reviews && (
                <span
                  className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold backdrop-blur', reviewTone)}
                  title={`${reviews.percent}% of ${reviews.total.toLocaleString()} reviews are positive`}
                >
                  <Star className="size-3.5" fill="currentColor" strokeWidth={0} />
                  {reviews.summary} · {reviews.percent}%
                </span>
              )}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 p-6">
            {facts?.logoUrl && (
              <img src={facts.logoUrl} alt="" className="mb-2.5 max-h-12 w-auto max-w-64 object-contain drop-shadow-lg" />
            )}
            <h2 className="text-3xl font-bold leading-tight text-white [text-shadow:0_1px_8px_rgba(0,0,0,.6)]">{title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-white/75">
              {facts?.developer && (
                <span className="flex items-center gap-1.5">
                  <PenLine className="size-3.5" />
                  {facts.developer}
                </span>
              )}
              {facts?.publisher && facts.publisher !== facts.developer && <span>· {facts.publisher}</span>}
              {facts?.releaseDate && <span>· {facts.releaseDate}</span>}
              {facts?.genres.map((genre) => (
                <span key={genre} className="rounded-md border border-white/15 bg-white/10 px-1.5 py-px text-[11px] text-white/85">
                  {genre}
                </span>
              ))}
            </p>
          </div>
        </div>

        {/* The middle scrolls; the decision never does. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {factsError && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-panel2/40 p-4">
              <p className="text-sm text-muted">The store page could not be read: {factsError}</p>
              <button
                onClick={load}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
              >
                <RefreshCw className="size-3.5" />
                Try again
              </button>
            </div>
          )}

          <div className="space-y-7">
            {/* How long it takes is the answer a plan is decided by, so it does
                not wait its turn under the pictures. */}
            <section>
              <SheetLabel icon={Clock}>How long to beat</SheetLabel>
              {hltbRows.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {hltbRows.map((row) => (
                    <div key={row.label} className="rounded-2xl border border-line bg-panel2/40 px-3 py-2.5">
                      <p className="text-lg font-bold text-fg">{fmtHours(row.hours)}</p>
                      <p className="text-[11px] text-muted">{row.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-line bg-panel2/40 px-4 py-3 text-xs text-muted">
                  {loadingHltb
                    ? 'Timing it…'
                    : hltb?.source === 'estimate'
                      ? 'Only an estimate without the desktop app.'
                      : 'Nobody has written down how long this one takes yet.'}
                </p>
              )}
            </section>

            {loadingFacts && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-muted">
                  <LoaderCircle className="size-4 animate-spin" />
                  Reading the store page…
                </div>
                <div className="h-20 animate-pulse rounded-2xl bg-panel2/40" />
                <div className="h-40 animate-pulse rounded-2xl bg-panel2/40" />
              </div>
            )}

            {facts && (
              <>
                {(facts.summary || facts.description) && (
                  <section>
                    <SheetLabel icon={Info}>What it is</SheetLabel>
                    {facts.summary && <p className="text-sm font-medium leading-relaxed text-fg">{facts.summary}</p>}
                    {description && description !== facts.summary && (
                      <p className={cn('mt-2 text-[13px] leading-relaxed text-muted', !more && longEnough && 'line-clamp-[7]')}>
                        {description}
                      </p>
                    )}
                    {longEnough && (
                      <button onClick={() => setMore(!more)} className="mt-1.5 text-xs font-medium text-accent hover:underline">
                        {more ? 'Show less' : 'Read the whole page'}
                      </button>
                    )}
                  </section>
                )}

                {playable.length > 0 && trailer && (
                  <section>
                    <SheetLabel icon={Play}>Trailers</SheetLabel>
                    <video
                      key={trailer.mp4 ?? trailer.webm ?? trailer.thumbnail}
                      src={trailer.mp4 ?? trailer.webm ?? undefined}
                      poster={trailer.thumbnail || undefined}
                      controls
                      preload="metadata"
                      className="aspect-video w-full rounded-2xl border border-line bg-black"
                    />
                    {playable.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {playable.map((movie, at) => (
                          <button
                            key={movie.name || at}
                            onClick={() => setShowing(at)}
                            className={cn(
                              'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition',
                              at === Math.min(showing, playable.length - 1)
                                ? 'border-accent text-fg'
                                : 'border-line bg-panel2/40 text-muted hover:border-accent/60 hover:text-fg',
                            )}
                          >
                            {movie.name || `Trailer ${at + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {facts.screenshots.length > 0 && (
                  <section>
                    <SheetLabel icon={Images}>Screenshots</SheetLabel>
                    <div className="grid grid-cols-3 gap-2">
                      {facts.screenshots.slice(0, 5).map((picture, at) => (
                        <button key={picture.full} onClick={() => setShot(at)} className="group relative overflow-hidden rounded-xl border border-line">
                          <img
                            src={picture.thumb}
                            alt={`${title} screenshot ${at + 1}`}
                            loading="lazy"
                            className="aspect-video w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                          />
                        </button>
                      ))}
                      {facts.screenshots.length > 5 && (
                        <button
                          onClick={() => setShot(5)}
                          className="relative overflow-hidden rounded-xl border border-line"
                        >
                          <img
                            src={facts.screenshots[5].thumb}
                            alt=""
                            loading="lazy"
                            className="aspect-video w-full object-cover opacity-50"
                          />
                          <span className="absolute inset-0 grid place-items-center bg-black/40 text-sm font-semibold text-white">
                            +{facts.screenshots.length - 5}
                          </span>
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {facts.pcMinimum && (
                  <section>
                    <SheetLabel icon={MonitorCog}>What runs it</SheetLabel>
                    <pre className="whitespace-pre-wrap rounded-2xl border border-line bg-panel2/40 p-4 font-sans text-xs leading-relaxed text-muted">
                      {facts.pcMinimum}
                    </pre>
                  </section>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-line bg-panel2/40 px-6 py-4">
          <p className="hidden flex-1 text-[10px] leading-tight text-muted/60 sm:block">
            Store details via Steam &amp; bonker.dev · times via HowLongToBeat
          </p>
          {facts?.homepage && (
            <button
              onClick={() => void openExternal(facts.homepage ?? '')}
              title="Open the game's own site"
              className="grid size-9 place-items-center rounded-xl border border-line bg-panel text-muted transition hover:border-accent hover:text-fg"
            >
              <Globe className="size-4" />
            </button>
          )}
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-muted hover:text-fg">
            Not yet
          </button>
          <button
            disabled={adding}
            onClick={() =>
              onAdd({
                name: title,
                appId: suggestion.appId,
                coverUrl: facts?.portraitUrl ?? suggestion.coverUrl,
              })
            }
            className="btn-accent flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add to backlog
          </button>
        </div>
      </div>
    </div>
  );

  const lightbox =
    shot !== null && facts && facts.screenshots[shot]
      ? createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-8"
            onClick={() => setShot(null)}
          >
            <button
              aria-label="Close"
              className="absolute right-4 top-4 grid size-9 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
            >
              <X className="size-4" />
            </button>
            <img
              src={facts.screenshots[shot].full}
              alt={`${title} screenshot ${shot + 1}`}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            {facts.screenshots.length > 1 && (
              <>
                <button
                  aria-label="Previous screenshot"
                  className="absolute left-4 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShot((shot + facts.screenshots.length - 1) % facts.screenshots.length);
                  }}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  aria-label="Next screenshot"
                  className="absolute right-4 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
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
          </div>,
          document.body,
        )
      : null;

  // No exit animation: the app's other dialogs simply leave, and so does this
  // page. The entrance rise is the motion of arriving somewhere, which stays.
  return createPortal(
    <>
      {panel}
      {lightbox}
    </>,
    document.body,
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

/** The small uppercase heading each part of the page opens with. */
function SheetLabel({ icon: Icon, children }: { icon: typeof Clock; children: string }) {
  return (
    <p className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
      <Icon className="size-3.5" />
      {children}
    </p>
  );
}
