import { RefreshCw, Timer } from 'lucide-react';
import type { Game } from '../../types';

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
  const played = game.playMinutes / 60;
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
            const pct = r.hours > 0 ? Math.min(100, (played / r.hours) * 100) : 0;
            return (
              <div key={r.label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted">{r.label}</span>
                  <span className="font-semibold">{r.hours > 0 ? `${r.hours}h` : '—'}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {h.source === 'estimate' && <p className="text-[10px] text-muted">Estimated — the real lookup needs the desktop app.</p>}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </section>
  );
}
