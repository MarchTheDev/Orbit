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
        { label: 'Main Story', hours: h.main },
        { label: 'Main + Extras', hours: h.mainExtra },
        { label: 'Completionist', hours: h.completionist },
      ]
    : [];

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
          className="flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Fetching…' : h ? 'Refresh' : 'Fetch'}
        </button>
      </div>

      {!h ? (
        <p className="text-xs text-muted">
          No times yet. Orbit fetches these by itself when a game is added.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const g = grade(played, r.hours);
            return (
              <div key={r.label}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted">{r.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold">{r.hours > 0 ? `${r.hours}h` : 'no data'}</span>
                    {r.hours > 0 && (
                      <span
                        className="w-14 text-right text-[10px] font-medium"
                        style={{ color: g.colour }}
                        title={g.word}
                      >
                        {Math.round(g.pct)}%
                      </span>
                    )}
                  </span>
                </div>
                {/* The track carries the colour at a quarter strength, so a row
                    reads as coloured even before anything has been played, and
                    the fill shows how far along the player is. */}
                <div
                  className="h-1.5 overflow-hidden rounded-full"
                  style={{ background: `color-mix(in srgb, ${g.colour} 25%, transparent)` }}
                >
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${Math.max(g.pct, played > 0 ? 3 : 0)}%`, background: g.colour }}
                  />
                </div>
              </div>
            );
          })}
          {h.source === 'estimate' && (
            <p className="text-[10px] text-muted">Estimated: the real lookup needs the desktop app.</p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </section>
  );
}
