import {
  ArrowRight,
  CircleDashed,
  CornerDownLeft,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Game, GameFacts, GameSuggestion, HltbData, PlanPlatform, WikidataGameSuggestion } from '../../types';
import { fetchFacts, knownGames, searchGames, searchWikidataGames } from '../../services/metadata';
import { fetchHltb } from '../../services/hltb';
import { cn } from '../../utils/cn';
import { PlanPage } from './PlanPage';

/** What the dialog hands back when a game is put on the list. */
export interface PlanPick {
  name: string;
  /** The store's id, when the game was picked from its suggestions. */
  appId?: number;
  coverUrl?: string | null;
  /**
   * What the page already loaded. Adding with these is instant: the store is
   * not asked a second time for what is on the screen.
   */
  facts?: GameFacts;
  hltb?: HltbData;
  platform?: PlanPlatform;
}

/**
 * How long typing has to stop before the store is asked.
 *
 * Short on purpose. Every keystroke is not worth a request, but this sits
 * behind a cache that answers instantly for a name already searched, and a
 * late answer from an earlier question is dropped rather than painted, so the
 * wait can be the beat between words rather than the pause the store used to
 * be given.
 */
const WAIT = 170;
const WIKIDATA_WAIT = 500;
const titleKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

type PlanSearchResult =
  | { key: string; source: 'steam'; name: string; suggestion: GameSuggestion }
  | { key: string; source: 'wikidata'; name: string; suggestion: WikidataGameSuggestion }
  | { key: string; source: 'hltb'; name: string; suggestion: HltbData };

/**
 * Planning a game, as one place in the middle of the window.
 *
 * This used to be two things: a row of fields that appeared at the top of the
 * Backlog page, and then a panel that slid in from the side once a game was
 * picked. Two places for one decision, and the second of them put the game
 * off to the edge of the screen when it was the only thing being looked at.
 * Here it is one panel, in the centre, at the size the app's other pages are:
 * the search, and then the game's own page inside the same frame, with the way
 * back where the way in was. Choosing a suggestion widens the panel rather
 * than opening a second window over it.
 *
 * What it asks of the store is asked once. Suggestions are remembered by the
 * service, a suggestion being pointed at is looked up before it is clicked,
 * and the answers the page gathered travel with the game when it is added.
 */
export function PlanDialog({
  games,
  initialQuery = '',
  onAdd,
  onClose,
}: {
  /** Everything already known, so a game cannot be planned twice by accident. */
  games: Game[];
  /**
   * A name to open on. The Backlog's own search box hands its text over, so a
   * game that could not be found on the page is a keystroke from being looked
   * up in the store rather than typed again.
   */
  initialQuery?: string;
  onAdd: (pick: PlanPick) => Promise<void> | void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GameSuggestion[]>([]);
  const [wikidataResults, setWikidataResults] = useState<WikidataGameSuggestion[]>([]);
  const [wikidataLooking, setWikidataLooking] = useState(false);
  const [wikidataError, setWikidataError] = useState<string | null>(null);
  const [hltbMatch, setHltbMatch] = useState<{ name: string; data: HltbData } | null>(null);
  const [looking, setLooking] = useState(false);
  /** The suggestion whose own page is open, if one is. */
  const [chosen, setChosen] = useState<GameSuggestion | null>(null);
  /** The row the keyboard is on, as a number in the results. */
  const [at, setAt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which question is the current one.
   *
   * Answers do not always come back in the order they were asked for, and a
   * slow reply to a name half-typed must not replace the list for the name on
   * screen. Only the reply to the latest question is painted.
   */
  const asked = useRef(0);

  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Open with the cursor already in the field: the only thing this panel is
  // for is typing a name.
  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    const text = query.trim();
    setHltbMatch(null);
    setWikidataResults([]);
    setWikidataLooking(false);
    setWikidataError(null);
    if (text.length < 2) {
      asked.current += 1;
      setResults([]);
      setLooking(false);
      return;
    }
    setWikidataLooking(true);
    const now = ++asked.current;
    const lookupHltb = () => {
      void fetchHltb(text).then((data) => {
        if (asked.current === now && data.gameName) setHltbMatch({ name: data.gameName, data });
      }).catch(() => undefined);
    };
    const lookupWikidata = () => {
      void searchWikidataGames(text)
        .then((found) => {
          if (asked.current === now) setWikidataResults(found);
        })
        .catch(() => {
          if (asked.current === now) {
            setWikidataResults([]);
            setWikidataError('The public game catalogue is temporarily unavailable.');
          }
        })
        .finally(() => {
          if (asked.current === now) setWikidataLooking(false);
        });
    };

    const ready = knownGames(text);
    if (ready) {
      setResults(ready);
      setAt(0);
      setLooking(false);
      lookupHltb();
      const wikidataTimer = window.setTimeout(lookupWikidata, WIKIDATA_WAIT);
      return () => window.clearTimeout(wikidataTimer);
    }

    setLooking(true);
    const steamTimer = window.setTimeout(() => {
      void searchGames(text)
        .then((found) => {
          if (asked.current !== now) return;
          setResults(found);
          setAt(0);
        })
        .catch(() => {
          if (asked.current === now) setResults([]);
        })
        .finally(() => {
          if (asked.current === now) setLooking(false);
        });
    }, WAIT);
    const hltbTimer = window.setTimeout(lookupHltb, 350);
    // Wikidata is open and keyless, but we still wait for the user to pause
    // before asking so every half-typed query does not become a request.
    const wikidataTimer = window.setTimeout(lookupWikidata, WIKIDATA_WAIT);
    return () => {
      window.clearTimeout(steamTimer);
      window.clearTimeout(hltbTimer);
      window.clearTimeout(wikidataTimer);
    };
  }, [query]);

  // Escape leaves the search. On a game's page the page owns the key, because
  // it has a lightbox and a way back to answer to first.
  useEffect(() => {
    if (chosen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, onClose]);

  /** Every title Orbit already holds, for spotting a game planned twice. */
  const held = useMemo(
    () => new Set(games.map((game) => game.title.trim().toLowerCase())),
    [games],
  );
  const isHeld = (name: string) => held.has(name.trim().toLowerCase());

  /**
   * Ask about a suggestion before it is clicked.
   *
   * Pointing at a game is the strongest hint there is that it is about to be
   * opened, and both answers are cached by their services: the page then opens
   * on times and store details instead of three skeletons. Failures are nobody's
   * business here - the page will say so itself if it has to.
   */
  const warm = (suggestion: GameSuggestion) => {
    void fetchFacts(suggestion.appId).catch(() => undefined);
    void fetchHltb(suggestion.name).catch(() => undefined);
  };

  const add = async (pick: PlanPick) => {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      await onAdd({ ...pick, platform: pick.platform ?? (pick.appId ? 'Steam' : 'Other') });
      onClose();
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
      setAdding(false);
    }
  };

  const typed = query.trim();
  const displayResults = useMemo(() => {
    const steamRows: PlanSearchResult[] = results.map((suggestion) => ({
      key: `steam-${suggestion.appId}`,
      source: 'steam',
      name: suggestion.name,
      suggestion,
    }));
    const steamNames = new Set(results.map((suggestion) => titleKey(suggestion.name)));
    const wikidataRows: PlanSearchResult[] = wikidataResults
      .filter((suggestion) => !steamNames.has(titleKey(suggestion.name)))
      .map((suggestion) => ({
        key: `wikidata-${suggestion.id}`,
        source: 'wikidata',
        name: suggestion.name,
        suggestion,
      }));
    const knownNames = new Set([...steamNames, ...wikidataRows.map((row) => titleKey(row.name))]);
    const hltbRows: PlanSearchResult[] = hltbMatch && !knownNames.has(titleKey(hltbMatch.name))
      ? [{ key: `hltb-${titleKey(hltbMatch.name)}`, source: 'hltb', name: hltbMatch.name, suggestion: hltbMatch.data }]
      : [];
    const relevance = (name: string) => {
      const candidate = titleKey(name);
      const search = titleKey(typed);
      if (candidate === search) return 0;
      if (candidate.startsWith(search) || search.startsWith(candidate)) return 1;
      if (candidate.includes(search) || search.includes(candidate)) return 2;
      return 3;
    };
    const sourceRank = (result: PlanSearchResult) => result.source === 'steam' ? 0 : result.source === 'wikidata' ? 1 : 2;
    return [...steamRows, ...wikidataRows, ...hltbRows].sort((a, b) =>
      relevance(a.name) - relevance(b.name) || sourceRank(a) - sourceRank(b),
    );
  }, [results, wikidataResults, hltbMatch, typed]);

  const selectSearchResult = (result: PlanSearchResult) => {
    if (result.source === 'steam') {
      warm(result.suggestion);
      setChosen(result.suggestion);
    } else if (result.source === 'hltb') {
      void add({ name: result.name, platform: 'Other', hltb: result.suggestion });
    } else {
      void add({ name: result.name, platform: 'Other' });
    }
  };

  useEffect(() => {
    setAt((current) => Math.min(current, Math.max(0, displayResults.length - 1)));
  }, [displayResults.length]);

  const panel = (
    <div
      // A dialog is modal even over the in-game overlay, which is what this
      // marker is for elsewhere; being a page of the app does not exempt it.
      data-overlay-hit="1"
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={chosen ? `About ${chosen.name}` : 'Plan a game'}
        className="modal-panel-enter relative flex h-[min(88vh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* A hairline of the accent across the top: the one flourish the frame
            gets, so the panel reads as lit from above rather than flat. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />

        {chosen ? (
          <PlanPage
            key={chosen.appId}
            suggestion={chosen}
            adding={adding}
            onAdd={(pick) => void add(pick)}
            onClose={onClose}
            onBack={() => setChosen(null)}
          />
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-accent/40 bg-accent/10 text-accent">
                  <Sparkles className="size-4" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold leading-tight">Plan a game</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Anything you mean to play — owned or not. Nothing here has to be installed.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="shrink-0 space-y-2 px-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  ref={field}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      if (displayResults.length === 0) return;
                      event.preventDefault();
                      const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
                      const wrapped = (next + displayResults.length) % displayResults.length;
                      setAt(wrapped);
                      const result = displayResults[wrapped];
                      if (result.source === 'steam') warm(result.suggestion);
                      list.current
                        ?.querySelector<HTMLElement>(`[data-plan-row="${wrapped}"]`)
                        ?.scrollIntoView({ block: 'nearest' });
                      return;
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (displayResults[at]) selectSearchResult(displayResults[at]);
                      else if (typed) void add({ name: typed });
                    }
                  }}
                  placeholder="Search all games…"
                  spellCheck={false}
                  aria-label="Search for a game to plan"
                  className="w-full rounded-xl border border-line bg-panel2/60 py-2.5 pl-10 pr-24 text-sm outline-none transition focus:border-accent focus:bg-panel2"
                />
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                  {(looking || wikidataLooking) && <LoaderCircle className="size-4 animate-spin text-muted" />}
                  {!looking && !wikidataLooking && displayResults.length > 0 && (
                    <span className="hidden items-center gap-1 text-[10px] text-muted sm:flex">
                      <span className="rounded border border-line bg-panel px-1 py-0.5 font-sans">↑↓</span>
                      <span className="rounded border border-line bg-panel px-1 py-0.5 font-sans">↵</span>
                    </span>
                  )}
                  <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[10px] text-muted">Esc</kbd>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {wikidataError && <p role="status" className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{wikidataError}</p>}
              {typed.length < 2 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="grid size-14 place-items-center rounded-2xl border border-dashed border-line text-muted">
                    <Search className="size-6" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-fg">Type a name to look it up</p>
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                      Picking a game opens its page: how long it takes, what the store says about it, its
                      stills and trailers. Then it goes on the list with one button.
                    </p>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted/70">
                    <span className="flex items-center gap-1">
                      <ArrowRight className="size-3" /> a game the store does not list can still be written
                      down
                    </span>
                  </p>
                </div>
              ) : displayResults.length === 0 && (looking || wikidataLooking) ? (
                <ul className="space-y-1.5">
                  {[0, 1, 2, 3].map((n) => (
                    <li key={n} className="flex animate-pulse items-center gap-3 rounded-xl px-2 py-1.5">
                      <span className="h-12 w-28 shrink-0 rounded-lg bg-panel2" />
                      <span className="h-3.5 rounded bg-panel2" style={{ width: `${45 - n * 6}%` }} />
                    </li>
                  ))}
                </ul>
              ) : displayResults.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="grid size-12 place-items-center rounded-2xl border border-dashed border-line text-muted">
                    <CircleDashed className="size-5" />
                  </span>
                  <p className="text-sm text-fg">No catalogue match for “{typed}”</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted">
                    You can still add it to your Backlog. Add details or change the platform later.
                  </p>
                  <button
                    onClick={() => void add({ name: typed, platform: 'Other' })}
                    disabled={adding || isHeld(typed)}
                    className="btn-accent mt-2 flex items-center gap-2 rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {isHeld(typed) ? 'Already in Orbit' : 'Add to Backlog'}
                  </button>
                </div>
              ) : (
                <>
                <ul ref={list} className="space-y-1">
                  {displayResults.map((result, index) => {
                    const steam = result.source === 'steam';
                    const suggestion = steam ? result.suggestion : null;
                    return (
                      <li
                        key={result.key}
                        data-plan-row={index}
                        onMouseEnter={() => {
                          setAt(index);
                          if (suggestion) warm(suggestion);
                        }}
                        className={cn(
                          'group flex items-center gap-2 rounded-xl pr-2 transition',
                          at === index ? 'bg-panel2 ring-1 ring-inset ring-accent/50' : 'hover:bg-panel2/60',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => selectSearchResult(result)}
                          onFocus={() => setAt(index)}
                          disabled={!steam && (adding || isHeld(result.name))}
                          className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left outline-none disabled:opacity-50"
                        >
                          <span className="grid h-12 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-panel2">
                            {suggestion?.coverUrl ? (
                              <img
                                src={suggestion.coverUrl}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : result.source === 'hltb' ? (
                              <Sparkles className="size-4 text-accent" />
                            ) : (
                              <CircleDashed className="size-4 text-accent" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">{result.name}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {isHeld(result.name)
                                ? 'already written down'
                                : result.source === 'steam'
                                  ? 'Steam · open details'
                                  : result.source === 'wikidata'
                                    ? `Wikidata · ${result.suggestion.description}`
                                    : `HowLongToBeat · ${result.suggestion.main > 0 ? `${result.suggestion.main}h main story` : 'game match'}`}
                            </span>
                          </span>
                        </button>
                        {steam ? (
                          <button
                            type="button"
                            onClick={() => void add({
                              name: result.name,
                              appId: result.suggestion.appId,
                              coverUrl: result.suggestion.coverUrl,
                            })}
                            disabled={adding || isHeld(result.name)}
                            title={`Add ${result.name} without opening details`}
                            aria-label={`Add ${result.name} without opening details`}
                            className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-panel text-muted opacity-0 transition hover:border-accent hover:text-accent focus:opacity-100 disabled:opacity-40 group-hover:opacity-100"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-accent">
                            {isHeld(result.name) ? 'Already added' : 'Add'}
                            <Plus className="size-3.5" />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {typed && !isHeld(typed) && (
                  <button
                    type="button"
                    onClick={() => void add({ name: typed, platform: 'Other' })}
                    disabled={adding}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted transition hover:border-accent hover:text-fg disabled:opacity-50"
                  >
                    <Plus className="size-3.5" /> Plan “{typed}” without a catalogue match
                  </button>
                )}
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-line bg-panel2/40 px-5 py-3">
              <p className="min-w-0 flex-1 truncate text-[11px] leading-tight text-muted/70">
                {error ? (
                  <span className="text-rose-400">{error}</span>
                ) : isHeld(typed) ? (
                  <span className="text-amber-300/90">“{typed}” is already on this page.</span>
                ) : displayResults[at]?.source === 'steam' ? (
                  <>
                    <CornerDownLeft className="mr-1 inline size-3 align-[-1px]" />
                    opens Steam details · times and store info load with it
                  </>
                ) : displayResults[at] ? (
                  <>
                    <CornerDownLeft className="mr-1 inline size-3 align-[-1px]" />
                    adds the selected game to your Backlog
                  </>
                ) : (
                  <>
                    <CornerDownLeft className="mr-1 inline size-3 align-[-1px]" />
                    adds the title as typed
                  </>
                )}
              </p>
              <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:text-fg">
                Cancel
              </button>
              <button
                onClick={() => typed && void add({ name: typed, platform: 'Other' })}
                disabled={adding || typed.length === 0}
                title="Write it down just as it is typed"
                className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm text-fg transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add as typed
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
