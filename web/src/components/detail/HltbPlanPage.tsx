import { ArrowLeft, Clock, ExternalLink, LoaderCircle, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HltbGameDetails, HltbSuggestion } from '../../types';
import { fetchHltbDetails } from '../../services/hltb';
import { fetchNonSteamFacts } from '../../services/nonSteam';
import { openExternal } from '../../services/desktop';
import { cn } from '../../utils/cn';

const HLTB_GAME_URL = 'https://howlongtobeat.com/game/';

/** A non-Steam catalogue entry, reviewed before it is put on the Backlog. */
export function HltbPlanPage({
  suggestion,
  adding,
  alreadyAdded,
  onAdd,
  onEnriched,
  onBack,
  onClose,
}: {
  suggestion: HltbSuggestion;
  adding: boolean;
  alreadyAdded: boolean;
  onAdd: (details?: HltbGameDetails) => void;
  onEnriched?: (details: Partial<HltbGameDetails>) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<HltbGameDetails | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void Promise.all([fetchHltbDetails(suggestion.id), fetchNonSteamFacts(suggestion.name)])
      .then(([result, external]) => {
        const combined: HltbGameDetails = {
          ...result,
          ...external,
          releaseDate: normalizeReleaseDate(result.releaseDate || external.releaseDate || null),
          developers: result.developers?.length ? result.developers : external.developers,
          publishers: result.publishers?.length ? result.publishers : external.publishers,
          genres: result.genres?.length ? result.genres : external.genres,
        };
        if (current) {
          setDetails(combined);
          onEnriched?.(combined);
        }
      })
      .catch(() => {
        if (current) setLoadError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [suggestion.id]);

  const times = [
    { label: 'Main story', hours: suggestion.hltb.main, color: '#38bdf8' },
    { label: 'Main + extras', hours: suggestion.hltb.mainExtra, color: '#a78bfa' },
    { label: 'Completionist', hours: suggestion.hltb.completionist, color: '#f472b6' },
  ].filter((item) => item.hours > 0);
  const longest = Math.max(...times.map((item) => item.hours), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="relative h-56 shrink-0 overflow-hidden bg-panel2">
        {suggestion.coverUrl && (
          <img src={suggestion.coverUrl} alt="" className="absolute inset-0 size-full scale-105 object-cover opacity-35 blur-xl" />
        )}
        {suggestion.coverUrl ? (
          <img src={suggestion.coverUrl} alt={`${suggestion.name} cover`} className="absolute inset-0 size-full object-contain" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-accent/60"><Sparkles className="size-12" /></div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-black/35 to-black/10" />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the search"
          className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-xl border border-white/15 bg-black/45 py-1.5 pl-2 pr-3 text-xs font-medium text-white/85 backdrop-blur hover:bg-black/70"
        >
          <ArrowLeft className="size-3.5" /> Search
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-xl bg-black/45 text-white/75 transition hover:bg-black/70 hover:text-white"
        >
          <X className="size-4" />
        </button>
        <div className="absolute bottom-0 inset-x-0 p-6">
          <span className="mb-2 inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80">
            <Sparkles className="size-3" /> HowLongToBeat
          </span>
          <h2 className="text-3xl font-bold leading-tight text-white [text-shadow:0_1px_8px_rgba(0,0,0,.75)]">{suggestion.name}</h2>
          {details?.platforms.length ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {details.platforms.map((platform) => (
                <span key={platform} className="rounded-md border border-white/15 bg-white/10 px-1.5 py-px text-[11px] text-white/85">{platform}</span>
              ))}
            </p>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {(details?.releaseDate || details?.developers?.length || details?.publishers?.length || details?.genres?.length || details?.wikipediaSummary) && (
          <section className="rounded-2xl border border-line bg-panel2/35 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Release & catalogue information</h3>
            {details.releaseDate && (
              <p className="mb-2 flex flex-wrap items-center gap-2 text-sm text-fg">
                <span className="font-semibold">Release date</span>
                <span>{formatRelease(details.releaseDate)}</span>
                {isUpcoming(details.releaseDate) && <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">Upcoming</span>}
              </p>
            )}
            {details.releaseRegions?.length ? <p className="mb-2 text-xs text-muted"><b className="text-fg">Regional release dates:</b> {details.releaseRegions.map(formatRelease).join(' · ')}</p> : null}
            {details.developers?.length ? <p className="text-xs text-muted"><b className="text-fg">Developer:</b> {details.developers.join(', ')}</p> : null}
            {details.publishers?.length ? <p className="mt-1 text-xs text-muted"><b className="text-fg">Publisher:</b> {details.publishers.join(', ')}</p> : null}
            {details.genres?.length ? <p className="mt-1 text-xs text-muted"><b className="text-fg">Genres:</b> {details.genres.join(', ')}</p> : null}
            {details.wikipediaSummary && <p className="mt-3 text-sm leading-relaxed text-muted">{details.wikipediaSummary}</p>}
            <p className="mt-3 text-[10px] text-muted/70">HLTB catalogue · Wikidata / Wikipedia when available</p>
          </section>
        )}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            <Clock className="size-3.5" /> How long to beat
          </h3>
          {times.length ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {times.map((item) => (
                <div key={item.label} className="rounded-2xl border border-line bg-panel2/40 px-3.5 py-3">
                  <p className="font-mono text-xl font-bold leading-none" style={{ color: item.color }}>{formatHours(item.hours)}</p>
                  <p className="mt-1.5 text-[11px] text-muted">{item.label}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full" style={{ width: `${(item.hours / longest) * 100}%`, background: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line bg-panel2/30 px-4 py-3 text-xs text-muted">
              HowLongToBeat has no completion times for this entry yet.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">HowLongToBeat description</h3>
          {details?.description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-fg">{details.description}</p>
          ) : loading ? (
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-panel2/30 px-4 py-3 text-xs text-muted">
              <LoaderCircle className="size-3.5 animate-spin" /> Loading the game description…
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line bg-panel2/30 px-4 py-3 text-xs text-muted">
              {loadError
                ? 'The HLTB description could not be loaded right now.'
                : 'HowLongToBeat does not provide a description for this game.'}
            </p>
          )}
          <button
            type="button"
            onClick={() => void openExternal(`${HLTB_GAME_URL}${suggestion.id}`)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted underline decoration-dotted hover:text-accent"
          >
            Read on HowLongToBeat <ExternalLink className="size-3" />
          </button>
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-panel2/40 px-6 py-4">
        <p className="hidden flex-1 text-[10px] leading-tight text-muted/60 sm:block">Times and description via HowLongToBeat</p>
        <button type="button" onClick={onBack} className="rounded-xl px-4 py-2.5 text-sm text-muted hover:text-fg">Not yet</button>
        <button
          type="button"
          disabled={adding || alreadyAdded}
          onClick={() => onAdd(details ?? undefined)}
          className={cn('btn-accent flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold disabled:opacity-50')}
        >
          {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {alreadyAdded ? 'Already in Orbit' : 'Add to backlog'}
        </button>
      </footer>
    </div>
  );
}

function normalizeReleaseDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{9,13}$/.test(value)) {
    const numeric = Number(value);
    const date = new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  }
  return value;
}

function releaseTimestamp(value: string): number {
  if (/^\d{9,13}$/.test(value)) {
    const numeric = Number(value);
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  return Date.parse(value);
}

function formatRelease(value: string): string {
  const date = new Date(releaseTimestamp(value));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function isUpcoming(value: string): boolean {
  const timestamp = releaseTimestamp(value);
  const year = Number(value.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  return (Number.isFinite(timestamp) && timestamp > Date.now()) || year > new Date().getFullYear();
}

function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const whole = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!whole) return `${remainder}m`;
  return remainder ? `${whole}h ${remainder}m` : `${whole}h`;
}
