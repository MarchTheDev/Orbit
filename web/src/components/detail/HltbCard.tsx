import { RefreshCw, Timer } from 'lucide-react';
import type { Game } from '../../types';

/**
 * How far the player has got, as a colour.
 *
 * The bars used to be one gradient whatever the game: a game barely started and
 * one finished twice looked identical. These bands colour the bar by how far the
 * played time has got towards that estimate. The band is also the tooltip, so
 * the meaning of the colour is there for anyone who cannot separate them.
 */
function grade(played: number, target: number): { pct: number; colour: string; word: string } {
  const pct = target > 0 ? (played / target) * 100 : 0;
  if (pct >= 115) return { pct: 100, colour: '#f472b6', word: 'Runaway' };
  if (pct >= 90) return { pct, colour: '#34d399', word: 'Finished' };
  if (pct >= 55) return { pct, colour: '#fbbf24', word: 'Nearly there' };
  if (pct >= 20) return { pct, colour: '#a78bfa', word: 'Under way' };
  return { pct, colour: '#38bdf8', word: pct > 0 ? 'Early' : 'Not started' };
}

/** `12h 30m`, or `45m` under an hour. */
function fmtHours(secs: number): string {
  const minutes = Math.floor(secs / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * How long the game takes, and how far into it the player is.
 *
 * Three answers from HowLongToBeat, because "how long is this" depends on what
 * somebody means by finished: the main story alone, the main story with the
 * side content, or everything there is. Each one gets a bar with the played
 * time against it, coloured by how close that is, and the row that is the next
 * one in reach is marked as the goal, so the card says something rather than
 * just listing three numbers.
 */
export function HltbCard({
  game,
  onFetch,
  loading,
  error,
}: {
  game: Game;
  onFetch: () => void;
  loading: boolean;
  /** Why the last lookup came back empty, if it did. */
  error?: string | null;
}) {
  const h = game.hltb;
  const played = game.playSecs / 3600;
  const rows = h
    ? [
        { label: 'Main story', hours: h.main, colour: '#38bdf8' },
        { label: 'Main + extras', hours: h.mainExtra, colour: '#a78bfa' },
        { label: 'Completionist', hours: h.completionist, colour: '#f472b6' },
      ].filter((r) => r.hours > 0)
    : [];

  // The first target that has not been passed is the one worth showing as the
  // goal: saying "90% of the completionist run" to somebody halfway through the
  // story is true and useless.
  const next = rows.find((r) => played < r.hours) ?? null;

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Timer className="size-4 text-accent" />
          HowLongToBeat
        </h3>
        <button
          onClick={onFetch}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Fetching…' : h ? 'Refresh' : 'Fetch'}
        </button>
      </div>

      {!h ? (
        <p className="text-xs text-muted">No times yet. Orbit fetches these by itself when a game is added.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted">Played</span>
            <span className="font-mono text-sm font-semibold">{fmtHours(game.playSecs)}</span>
          </div>

          {rows.map((r) => {
            const g = grade(played, r.hours);
            const isGoal = next?.label === r.label;
            return (
              <div key={r.label} className={isGoal ? 'rounded-lg bg-bg/40 p-2 -mx-2' : ''}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                  <span className={isGoal ? 'font-medium text-fg' : 'text-muted'}>{r.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono font-semibold">{r.hours}h</span>
                    <span className="w-10 text-right font-mono text-[10px]" style={{ color: g.colour }} title={g.word}>
                      {Math.round(g.pct)}%
                    </span>
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full"
                  style={{ background: `color-mix(in srgb, ${r.colour} 20%, transparent)` }}
                  title={`${g.word}: ${fmtHours(game.playSecs)} of ${r.hours}h`}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.max(g.pct, played > 0 ? 2 : 0)}%`, background: r.colour }}
                  />
                </div>
              </div>
            );
          })}

          {/* A game played past every estimate is worth saying plainly: the
              numbers are other people's averages, not a rule. */}
          {played > 0 && rows.length > 0 && !next && (
            <p className="text-[11px] text-emerald-400">
              Past every estimate, by {Math.round(played - rows[rows.length - 1].hours)}h.
            </p>
          )}
        </div>
      )}

      {h?.source === 'estimate' && (
        <p className="mt-2 text-[10px] text-muted">Estimated: the real lookup needs the desktop app.</p>
      )}
      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </section>
  );
}
