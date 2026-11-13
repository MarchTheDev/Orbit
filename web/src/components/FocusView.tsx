import { ArrowRight, Heart, MoreHorizontal, Play, Sparkles, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Game } from '../types';
import { fmtBytes, fmtDate, fmtMinutes } from '../utils/format';
import { driveLabel } from '../utils/drive';
import { cn } from '../utils/cn';
import { Cover } from './ui/Cover';

const STATUS_TEXT: Record<Game['status'], string> = {
  playing: 'Playing',
  backlog: 'Next up',
  completed: 'Completed',
  dropped: 'Dropped',
};

/** The art that lights the panel: wide art when a game has it, its cover when it does not. */
function wideArt(game: Game) {
  return game.meta?.backgroundUrl ?? game.meta?.headerUrl ?? game.meta?.coverUrl ?? null;
}

/** How long ago a game was last played, the way the design lab wrote it. */
function relPlayed(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  }
  return fmtDate(iso);
}

interface Props {
  games: Game[];
  /** The game the library opens on when nothing else is selected. */
  heroGame: Game | null;
  runningId: string | null;
  onPlay: (game: Game) => void;
  onStop: () => void;
  onDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Opens the Steam library import, the way the list panel's footer promises. */
  onDiscoverSteam: () => void;
}

/**
 * The library the player designed: their games in a quiet list on the left,
 * and the selected game's own panel on the right, its artwork behind the
 * record. The list selects rather than opens: one press changes the panel, a
 * double press starts the game, and the round button in the panel's corner is
 * the way into the full record.
 */
export function FocusView({
  games,
  heroGame,
  runningId,
  onPlay,
  onStop,
  onDetails,
  onEdit,
  onToggleFavorite,
  onDiscoverSteam,
}: Props) {
  const fallbackId = heroGame?.id ?? games[0]?.id ?? null;
  const [focusId, setFocusId] = useState<string | null>(fallbackId);

  // A filter or a deleted game can take the focused game out of the list.
  // Move the focus to the first thing still visible rather than showing a hole.
  useEffect(() => {
    if (focusId && games.some((game) => game.id === focusId)) return;
    setFocusId(fallbackId);
  }, [focusId, games, fallbackId]);

  const game = games.find((candidate) => candidate.id === focusId) ?? games[0] ?? null;

  if (!game) return null;

  const running = runningId === game.id;
  const art = wideArt(game);
  const meta = game.meta;
  const genres = meta?.genres ?? [];
  const kicker = [genres.slice(0, 2).join(' · ') || 'Game', meta?.releaseYear].filter(Boolean).join(' · ');
  const pct = game.hltb && game.hltb.main > 0
    ? Math.min(100, Math.round((game.playSecs / 3600 / game.hltb.main) * 100))
    : null;

  return (
    <div className="orbit-focus-layout">
      {/* -------------------------------------------------------- the list */}
      <section className="orbit-lib-panel orbit-glass" aria-label="Your games">
        <div className="orbit-panel-head">
          <div>
            <h2>Your games</h2>
            <span>{games.length} in this view</span>
          </div>
          <button
            type="button"
            onClick={() => onEdit(game.id)}
            className="orbit-square-btn !h-[31px] !w-[31px]"
            title={`Edit ${game.title}`}
            aria-label={`Edit ${game.title}`}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="orbit-game-rows">
          {games.map((row) => {
            const active = row.id === game.id;
            const rowPct = row.hltb && row.hltb.main > 0
              ? Math.min(100, Math.round((row.playSecs / 3600 / row.hltb.main) * 100))
              : null;
            return (
              <button
                key={row.id}
                type="button"
                data-orbit-game={row.id}
                aria-current={active ? 'true' : undefined}
                aria-label={`${row.title} — double-click to play`}
                title={`${row.title} — double-click to play`}
                onClick={() => setFocusId(row.id)}
                onDoubleClick={() => onPlay(row)}
                className="orbit-game-row"
              >
                <Cover game={row} className="orbit-row-cover [&_span]:text-[11px]" />
                <span className="orbit-row-main">
                  <span className="orbit-row-title">
                    <strong>{row.title}</strong>
                    {row.favorite && <Heart className="size-3" aria-label="Favourite" />}
                  </span>
                  <span className="orbit-row-sub">
                    {[row.meta?.genres?.[0], row.meta?.releaseYear].filter(Boolean).join(' · ') || 'No store details yet'}
                  </span>
                  <span className="orbit-mini-progress" aria-hidden>
                    <i style={{ width: `${rowPct ?? 0}%` }} />
                  </span>
                </span>
                <span className="orbit-row-time">
                  <strong>{fmtMinutes(row.playSecs / 60)}</strong>
                  <span>{relPlayed(row.lastPlayed)}</span>
                </span>
              </button>
            );
          })}
        </div>

        <button type="button" className="orbit-import-btn" onClick={onDiscoverSteam}>
          <span>
            <Sparkles className="size-4" strokeWidth={1.8} />
            Discover games from Steam
          </span>
          <ArrowRight className="size-4" strokeWidth={1.8} />
        </button>
      </section>

      {/* -------------------------------------------------------- the game */}
      <article className="orbit-detail-panel orbit-glass" key={game.id} aria-label={game.title}>
        {art ? (
          <div
            className="orbit-detail-art"
            style={{ backgroundImage: `url(${art})` }}
            aria-hidden
          />
        ) : (
          // No store art: wash the panel with the game's own hue instead of
          // leaving a flat slab, so games without artwork still light the room.
          <div
            className="orbit-detail-art"
            style={{
              backgroundImage: `radial-gradient(120% 90% at 76% 16%, hsl(${game.hue} 48% 34% / .72), transparent 62%), radial-gradient(90% 70% at 10% 90%, hsl(${game.hue} 44% 26% / .45), transparent 62%)`,
              backgroundSize: 'auto, auto',
            }}
            aria-hidden
          />
        )}
        <div className="orbit-detail-shade" aria-hidden />

        <div className="orbit-detail-inner">
          <div className="orbit-detail-top">
            <span className={cn('orbit-state-pill', running && 'is-playing')}>
              <i aria-hidden />
              {running ? 'Playing now' : STATUS_TEXT[game.status]}
            </span>
            <button
              type="button"
              onClick={() => onDetails(game.id)}
              className="orbit-square-btn !h-[31px] !w-[31px]"
              title={`All actions for ${game.title}`}
              aria-label={`All actions for ${game.title}`}
            >
              <MoreHorizontal className="size-4" strokeWidth={1.8} />
            </button>
          </div>

          <div className="orbit-detail-main">
            <Cover game={game} className="orbit-detail-coverimg [&_span]:text-3xl" loading="eager" />
            <div className="min-w-0">
              <p className="orbit-detail-kicker">{kicker}</p>
              <h2 className="orbit-detail-title">{game.title}</h2>
              <p className="orbit-detail-desc">
                {meta?.summary || 'Orbit has not looked this title up yet. Fetching works with no setup and no key.'}
              </p>
              <div className="orbit-detail-actions">
                {running ? (
                  <button type="button" className="orbit-play-btn is-stop" onClick={onStop}>
                    <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
                    Stop
                  </button>
                ) : (
                  <button type="button" className="orbit-play-btn" onClick={() => onPlay(game)}>
                    <Play className="size-4" fill="currentColor" strokeWidth={0} />
                    Play
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onToggleFavorite(game.id)}
                  aria-label={game.favorite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`}
                  aria-pressed={game.favorite}
                  title="Favourite"
                  className={cn('orbit-fav-btn', game.favorite && 'is-favorite')}
                >
                  <Heart className="size-4" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </div>

          <div className="orbit-metrics">
            <div className="orbit-metric">
              <span>Playtime</span>
              <strong>{fmtMinutes(game.playSecs / 60)}</strong>
              <small>
                {game.sessionCount > 0
                  ? `Across ${game.sessionCount} ${game.sessionCount === 1 ? 'session' : 'sessions'}`
                  : 'No sessions yet'}
              </small>
            </div>
            <div className="orbit-metric">
              <span>Progress</span>
              <strong>{pct !== null ? `${pct}%` : '—'}</strong>
              <small>
                {pct !== null ? (
                  <i className="orbit-metric-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Main story progress">
                    <b style={{ width: `${pct}%` }} />
                  </i>
                ) : (
                  'No main-story estimate'
                )}
              </small>
            </div>
            <div className="orbit-metric">
              <span>Last played</span>
              <strong>{relPlayed(game.lastPlayed)}</strong>
              <small>{meta?.developer || 'Developer unknown'}</small>
            </div>
            <div className="orbit-metric">
              <span>On disk</span>
              <strong>{game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : '—'}</strong>
              <small>{game.drive ? `${driveLabel(game.drive)} drive` : 'Size not measured'}</small>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
