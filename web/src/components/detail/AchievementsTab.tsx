import { useEffect, useMemo, useState } from 'react';
import { Check, Lock, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import type { Achievement, Game } from '../../types';
import { fetchAchievements } from '../../services/native';
import { fmtDate } from '../../utils/format';
import { Cover } from '../ui/Cover';
import { SearchField } from '../ui/SearchField';
import { cn } from '../../utils/cn';

/**
 * The game's achievements, read from its Steam Community page.
 *
 * Whether an achievement is unlocked is the player's own mark, and clicking it
 * is the whole interaction — unless the Steam client on this machine has the
 * game, in which case it already knows the list and the moment each one
 * happened, needs nothing to be asked, and overwrites the ticks in both
 * directions because it knows what has *not* been unlocked too. For a game with
 * no local record the list comes from the community page instead, which cannot
 * say who has what, so the ticks stay the player's own. Nothing is ever
 * reported back. The share of players who have each one comes from Steam and is
 * worth showing: it is what tells you an achievement is rare.
 */
export function AchievementsTab({
  game,
  onUpdate,
}: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
}) {
  const rows = game.achievements ?? [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** `all`, `unlocked` or `locked`, so a long list can be narrowed. */
  const [show, setShow] = useState<'all' | 'unlocked' | 'locked'>('all');

  const unlocked = rows.filter((a) => a.unlocked).length;

  const read = async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await fetchAchievements(game.id);
      // What the player ticked was carried over by Rust; the rest of the list is
      // replaced, because the share of players moves and names get edited.
      onUpdate({ achievements: fresh });
      if (fresh.length === 0) setError('That game has no achievements to read.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // The list is worth reading once when the tab is first opened, so the page is
  // not an empty box with a button in it. `rows.length` is deliberately not a
  // dependency: a read that comes back empty must not be retried forever.
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (tried || rows.length > 0) return;
    setTried(true);
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tried, rows.length]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((a) => {
      if (show === 'unlocked' && !a.unlocked) return false;
      if (show === 'locked' && a.unlocked) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    });
  }, [rows, query, show]);

  const toggle = (id: string) => {
    const next: Achievement[] = rows.map((a) =>
      // Locking it again by hand drops the moment Steam gave it: that date
      // described a real unlock, not this tick.
      a.id === id ? { ...a, unlocked: !a.unlocked, unlockedAt: a.unlocked ? 0 : a.unlockedAt } : a,
    );
    onUpdate({ achievements: next });
  };

  /** Anything Steam itself said, as opposed to a tick done here. */
  const synced = rows.some((a) => (a.unlockedAt ?? 0) > 0);

  const pct = rows.length > 0 ? Math.round((unlocked / rows.length) * 100) : 0;

  return (
    <section className="orbit-achievements">
      <div className="orbit-panelblock-head">
        <h2>
          <Trophy className="size-3.5" strokeWidth={1.9} />
          Achievements
        </h2>
        <button className="orbit-btnquiet" onClick={() => void read()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>
      <div className="mt-3 flex items-start gap-4">
        <Cover game={game} className="size-14 shrink-0 rounded-lg [&_span]:text-sm" />
        <div className="min-w-0 flex-1">
          {/* The count and the share, plus whether Steam had a hand in it. */}
          <p className="text-xs text-muted">
            {rows.length === 0
              ? 'Nothing read yet. Orbit reads the list from the game\'s Steam page.'
              : `${unlocked} of ${rows.length} unlocked · ${pct}%${
                  synced ? ' · read from Steam' : ''
                }`}
          </p>
          {rows.length > 0 && (
            <div className="orbit-rail mt-2">
              <span className="transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg border border-line/70 px-3 py-2 text-xs text-muted">{error}</p>}

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SearchField value={query} onChange={setQuery} placeholder="Find an achievement" inputClassName="w-56" />
          <div className="orbit-seg !w-auto">
            {(
              [
                ['all', `All ${rows.length}`],
                ['unlocked', `Unlocked ${unlocked}`],
                ['locked', `Locked ${rows.length - unlocked}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setShow(id)}
                className="!px-2.5"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-2">
          {visible.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => toggle(a.id)}
                title={a.unlocked ? 'Click to lock this again' : 'Click to mark this as unlocked'}
                className={cn('orbit-row !rounded-none', a.unlocked && 'bg-[color-mix(in_srgb,var(--c-accent)_7%,transparent)]')}
              >
                {a.icon ? (
                  <img
                    src={a.icon}
                    alt=""
                    className={cn(
                      'size-10 shrink-0 rounded-lg object-cover',
                      // A locked achievement is dimmed rather than hidden, so the
                      // shape of what is left to do is still visible.
                      !a.unlocked && 'opacity-35 grayscale',
                    )}
                  />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-panel2 text-muted">
                    <Trophy className="size-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-medium', !a.unlocked && 'text-muted')}>{a.name}</span>
                  {a.description && <span className="block truncate text-[11px] text-muted">{a.description}</span>}
                </span>
                {/* The day it happened is the one thing Steam can say that a
                    tick by hand cannot. */}
                {(a.unlockedAt ?? 0) > 0 && (
                  <span className="hidden shrink-0 text-[11px] text-muted sm:block">
                    {fmtDate(new Date((a.unlockedAt ?? 0) * 1000).toISOString())}
                  </span>
                )}
                <span className="shrink-0 text-right">
                  {a.percent > 0 && <span className="block text-[11px] text-muted">{a.percent}% have it</span>}
                  <span
                    className={cn(
                      'mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      a.unlocked ? 'bg-accent/20 text-accent' : 'bg-panel text-muted',
                    )}
                  >
                    {a.unlocked ? <Check className="size-3" /> : <Lock className="size-3" />}
                    {a.unlocked ? 'Unlocked' : 'Locked'}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
              Nothing matches that.
            </li>
          )}
        </ul>
      )}

      {rows.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-muted">
          <Sparkles className="size-6 opacity-60" />
          <p className="text-xs">No achievements here yet. Refresh, or look the game up first.</p>
        </div>
      )}
    </section>
  );
}
