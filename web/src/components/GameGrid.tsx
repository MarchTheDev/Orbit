import { useLayoutEffect, useRef, useState } from 'react';
import { Pencil, Play, Star } from 'lucide-react';
import type { CoverShape, Game, GridLabel } from '../types';
import { fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
import { useDragReorder } from '../hooks/useDragReorder';
import { useHoverTint } from '../utils/palette';
import { cn } from '../utils/cn';
import { driveLabel } from '../utils/drive';

/** What `useDragReorder`'s `bind` hands a tile. */
type DragBinding = {
  'data-orbit-drop'?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
};

interface Props {
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlay: (g: Game) => void;
  /** Drawn at this percentage of the base tile, from the toolbar's slider. */
  scale?: number;
  /** The cover's own width in pixels; wins over `scale` when it is given. */
  width?: number;
  /** Set while the library is in the player's own order. */
  onReorder?: (fromId: string, toId: string, after: boolean) => void;

  /**
   * Whether the tint behind a hovered cover comes from the picture itself or
   * from Orbit's theme. A preference rather than a taste Orbit decides for
   * anybody: both answers look deliberate.
   */
  coverTint?: boolean;
  /** The shape every cover is drawn in. */
  shape?: CoverShape;
  /** What sits under a cover: nothing, the title, its readings, or both. */
  label?: GridLabel;
  /** Whether a hovered cover rises a little. */
  lift?: boolean;
}

function shapeRatio(shape: CoverShape): string {
  return shape.replace(':', ' / ');
}

export function GameGrid({
  games,
  selectedId,
  onSelect,
  onEdit,
  onToggleFavorite,
  onPlay,
  scale = 100,
  width,
  onReorder,
  coverTint = true,
  shape = '3:4',
  label = 'title-info',
  lift = true,
}: Props) {
  const { bind, dragging, over } = useDragReorder(onReorder);
  const tileWidth = width ?? Math.round(170 * (scale / 100));

  return (
    <div
      className="grid gap-x-5 gap-y-7 p-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileWidth}px, 1fr))` }}
    >
      {games.map((g) => (
        <Tile
          key={g.id}
          game={g}
          selected={selectedId === g.id}
          onSelect={onSelect}
          onEdit={onEdit}
          onToggleFavorite={onToggleFavorite}
          onPlay={onPlay}
          width={tileWidth}
          coverTint={coverTint}
          shape={shape}
          label={label}
          lift={lift}
          bound={bind(g.id)}
          dragging={dragging === g.id}
          over={over === g.id && dragging !== null && dragging !== g.id}
        />
      ))}
    </div>
  );
}

/**
 * One tile.
 *
 * Apart from the cover it is mostly the hover state: the tint that comes up
 * under the title and the Play button is measured from the artwork (or taken
 * from the theme, if that is the preference), and measuring only happens once
 * somebody has actually hovered, so a library of four hundred games does not
 * read four hundred pictures to draw itself.
 */
function Tile({
  game,
  selected,
  onSelect,
  onEdit,
  onToggleFavorite,
  onPlay,
  width,
  coverTint,
  shape,
  label,
  lift,
  bound,
  dragging,
  over,
}: {
  game: Game;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onPlay: (g: Game) => void;
  /** The tile's own width, so the title reads at the size the cover is drawn. */
  width: number;
  coverTint: boolean;
  shape: CoverShape;
  label: GridLabel;
  lift: boolean;
  /** The props that make the tile draggable, from `useDragReorder`. */
  bound: DragBinding;
  dragging: boolean;
  over: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [dismissedUnfilledStar, setDismissedUnfilledStar] = useState(false);
  const previousFavorite = useRef(game.favorite);
  const tint = useHoverTint(game, coverTint, hovered);
  const showTitle = label === 'title' || label === 'title-info';
  const showInfo = label === 'info' || label === 'title-info';

  // A context-menu action changes the game prop without going through the
  // quick-star button. Keep the same hover dismissal for either route, before
  // the browser paints the now-empty star again.
  useLayoutEffect(() => {
    if (previousFavorite.current && !game.favorite) setDismissedUnfilledStar(true);
    else if (!previousFavorite.current && game.favorite) setDismissedUnfilledStar(false);
    previousFavorite.current = game.favorite;
  }, [game.favorite]);

  return (
    <div
      onClick={() => onSelect(game.id)}
      onDoubleClick={() => onPlay(game)}
      // What the app's one right-click handler looks for, so the menu works
      // from anywhere on the tile, including the artwork and the title.
      data-orbit-game={game.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setDismissedUnfilledStar(false);
      }}
      {...bound}
      className={cn(
        'group',
        'cursor-pointer active:cursor-grabbing',
        dragging && 'opacity-60',
      )}
    >
      <div
        tabIndex={0}
        data-orbit-pad="tile"
        aria-label={game.title}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(game.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSelect(game.id);
          }
        }}
        style={{ aspectRatio: shapeRatio(shape), borderRadius: 'var(--orbit-cover-radius, 16px)' }}
        className={cn(
          // A neutral shadow on hover, not an accent-coloured one: with the
          // tint set to follow the artwork, nothing from the theme should be
          // drawn over a cover. The pad ring lives on this element, not on the
          // title underneath.
          'orbit-cover relative overflow-hidden transition duration-150 group-hover:shadow-2xl group-hover:shadow-black/50',
          lift && 'group-hover:-translate-y-0.5',
          selected && 'ring-1 ring-accent ring-offset-[3px] ring-offset-bg',
          // The same rounded cover ring as a selected tile. A square ring on the
          // outer box sat around the title and looked like a stock overlay.
          over && !selected && 'ring-1 ring-accent ring-offset-[3px] ring-offset-bg',
        )}
      >
        <Cover game={game} className="size-full" />
        <div
          className="absolute inset-0 opacity-0 transition duration-150 group-hover:opacity-100"
          style={{ background: tint }}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(game.id);
          }}
          data-orbit-pad-skip=""
          aria-label={`Edit ${game.title}`}
          title={`Edit ${game.title}`}
          className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full border border-white/20 bg-black/60 text-white opacity-100 shadow-lg backdrop-blur transition hover:bg-black/80 sm:-translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 focus:translate-y-0 focus:opacity-100"
        >
          <Pencil className="size-4" />
        </button>
        {(game.favorite || !dismissedUnfilledStar) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (game.favorite) setDismissedUnfilledStar(true);
              else setDismissedUnfilledStar(false);
              onToggleFavorite(game.id);
            }}
            data-orbit-pad-skip=""
            aria-label={game.favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}
            aria-pressed={game.favorite}
            title={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'absolute left-3 top-3 z-10 grid size-8 place-items-center rounded-full border border-white/20 bg-black/60 text-yellow-300 shadow-lg backdrop-blur transition hover:bg-black/80',
              game.favorite ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100',
            )}
          >
            <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(game);
          }}
          data-orbit-pad-skip=""
          aria-label={`Play ${game.title}`}
          className="absolute bottom-3 right-3 grid size-10 translate-y-2 place-items-center rounded-lg bg-accent text-[var(--c-on-accent)] opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
        >
          <Play className="size-4" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      {showTitle && (
        <p className="mt-2.5 truncate font-medium" style={{ fontSize: `${Math.max(12, Math.round(13 * (width / 170)))}px` }}>
          {game.title}
        </p>
      )}
      {showInfo && (
        <p className={cn('orbit-num truncate text-[11px] text-muted', showTitle ? 'mt-0.5' : 'mt-2.5')}>
          {fmtMinutes(game.playSecs / 60)}
          {game.drive && ` · ${driveLabel(game.drive)}`}
        </p>
      )}
    </div>
  );
}
