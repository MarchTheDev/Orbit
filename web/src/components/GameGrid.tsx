import { useState } from 'react';
import { Play, Star } from 'lucide-react';
import type { Game } from '../types';
import { fmtMinutes } from '../utils/format';
import { Cover } from './ui/Cover';
import { useDragReorder } from '../hooks/useDragReorder';
import { useHoverTint } from '../utils/palette';
import { cn } from '../utils/cn';

/** What `useDragReorder`'s `bind` hands a tile. */
type DragBinding = {
  'data-orbit-drop'?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
};

interface Props {
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlay: (g: Game) => void;
  /** Drawn at this percentage of the base tile, from the toolbar's slider. */
  scale: number;
  /** Set while the library is in the player's own order. */
  onReorder?: (fromId: string, toId: string, after: boolean) => void;

  /**
   * Whether the tint behind a hovered cover comes from the picture itself or
   * from Orbit's theme. A preference rather than a taste Orbit decides for
   * anybody: both answers look deliberate.
   */
  coverTint?: boolean;
}

export function GameGrid({
  games,
  selectedId,
  onSelect,
  onPlay,
  scale,
  onReorder,
  coverTint = true,
}: Props) {
  const { bind, dragging, over } = useDragReorder(onReorder);

  return (
    <div
      className="grid gap-6 p-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(170 * (scale / 100))}px, 1fr))` }}
    >
      {games.map((g) => (
        <Tile
          key={g.id}
          game={g}
          selected={selectedId === g.id}
          onSelect={onSelect}
          onPlay={onPlay}
          scale={scale}
          coverTint={coverTint}
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
  onPlay,
  scale,
  coverTint,
  bound,
  dragging,
  over,
}: {
  game: Game;
  selected: boolean;
  onSelect: (id: string) => void;
  onPlay: (g: Game) => void;
  scale: number;
  coverTint: boolean;
  /** The props that make the tile draggable, from `useDragReorder`. */
  bound: DragBinding;
  dragging: boolean;
  over: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const tint = useHoverTint(game, coverTint, hovered);

  return (
    <div
      onClick={() => onSelect(game.id)}
      onDoubleClick={() => onPlay(game)}
      // What the app's one right-click handler looks for, so the menu works
      // from anywhere on the tile, including the artwork and the title.
      data-orbit-game={game.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...bound}
      className={cn(
        'group',
        'cursor-pointer active:cursor-grabbing',
        // The card the pointer is over while something is being moved.
        over && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
        dragging && 'opacity-60',
      )}
    >
      <div
        className={cn(
          // A neutral shadow on hover, not an accent-coloured one: with the
          // tint set to follow the artwork, nothing from the theme should be
          // drawn over a cover.
          'relative aspect-[3/4] overflow-hidden rounded-2xl transition duration-300 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-black/50',
          selected && 'ring-2 ring-accent ring-offset-4 ring-offset-bg',
        )}
      >
        <Cover game={game} className="size-full" />
        <div
          className="absolute inset-0 opacity-0 transition duration-200 group-hover:opacity-100"
          style={{ background: tint }}
        />
        {game.favorite && (
          <span className="absolute left-3 top-3 grid size-7 place-items-center rounded-full bg-black/40 text-yellow-300 backdrop-blur">
            <Star className="size-3.5" fill="currentColor" strokeWidth={0} />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(game);
          }}
          aria-label={`Play ${game.title}`}
          className="absolute bottom-3 right-3 grid size-11 translate-y-3 place-items-center rounded-full bg-white text-black opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
        >
          <Play className="size-5" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
      <p className="mt-3 truncate font-semibold" style={{ fontSize: `${Math.max(12, Math.round(14 * (scale / 100)))}px` }}>
        {game.title}
      </p>
      <p className="text-xs text-muted">
        {fmtMinutes(game.playSecs / 60)}
        {game.drive && ` · ${game.drive}`}
      </p>
    </div>
  );
}
