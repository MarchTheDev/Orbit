import type { Game } from '../../types';

export function HltbCard({ game, onFetch, loading }: { game: Game; onFetch: () => void; loading: boolean }) {
  const h = game.hltb;
  const played = game.playMinutes / 60;
  const rows = h ? [
    { label: 'Main Story', hours: h.main },
    { label: 'Main + Extras', hours: h.mainExtra },
    { label: 'Completionist', hours: h.completionist },
  ] : [];

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">HowLongToBeat</h3>
        <button onClick={onFetch} disabled={loading} className="text-xs text-accent hover:underline disabled:opacity-50">
          {loading ? 'Fetching…' : h ? 'Refresh' : 'Fetch'}
        </button>
      </div>
      {!h ? <p className="text-xs text-muted">No data yet.</p> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = Math.min(100, (played / r.hours) * 100);
            return (
              <div key={r.label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted">{r.label}</span>
                  <span className="font-semibold">{r.hours}h</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {h.source === 'estimate' && <p className="text-[10px] text-muted">Estimated (preview mode)</p>}
        </div>
      )}
    </section>
  );
}
