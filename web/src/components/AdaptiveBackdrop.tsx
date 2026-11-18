import { useEffect, useRef, useState } from 'react';
import type { Game } from '../types';
import { coverArtCandidates, resolveWideArt, wideArtImmediateFallback } from '../utils/art';

/**
 * The app's own light, taken from whichever game is in hand.
 *
 * The interface takes the colour of whatever is selected:
 * the covers behind it, the shading, the accent. Orbit's shell is a dark room
 * with one accent, which is what makes a library of four hundred unrelated
 * pictures readable - so this is the quiet version of the same idea. The
 * selected game's cover is thrown a long way out of focus behind the page and
 * the game's own hue is washed over it, which tints the room without touching
 * the accent every button is drawn in.
 *
 * Two layers, so the picture arrives as a cross-fade rather than as a swap: the
 * one behind stays until the one in front has finished coming up.
 *
 * The picture is the game's **banner** - its wide art, the same one Stardeck
 * puts behind the covers - and the cover is only the fallback, for a game whose
 * store has no wide art at all. A poster blown up across a whole page is a crop
 * nobody chose: its middle is a face and its edges are nothing. A banner is the
 * shape of the space the background actually fills.
 */
export function AdaptiveBackdrop({ game }: { game: Game | null }) {
  const [layers, setLayers] = useState<{ key: number; url: string }[]>([]);
  const nextKey = useRef(1);
  const last = layers[layers.length - 1] ?? null;
  /**
   * The banner, best first.
   *
   * The store's own wide art is on screen immediately when the game already
   * carries one; the sharper hero that has to be looked up fades in over it a
   * moment later, the way the game page's own backdrop does. A game with no wide
   * art at all falls back to its cover, which is better than an empty room.
   */
  const immediate = game
    ? wideArtImmediateFallback(game) ?? coverArtCandidates(game)[0] ?? null
    : null;
  const [wanted, setWanted] = useState<string | null>(immediate);
  useEffect(() => {
    setWanted(immediate);
    if (!game) return;
    let alive = true;
    void resolveWideArt(game)
      .then((src) => {
        if (alive && src) setWanted(src);
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // Re-run when the game or any of its art changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, game?.meta?.backgroundUrl, game?.meta?.headerUrl, game?.coverPath, immediate]);

  useEffect(() => {
    if (!wanted || (last && last.url === wanted)) return;
    const layer = { key: nextKey.current, url: wanted };
    nextKey.current += 1;
    setLayers((have) => [...have.slice(-1), layer]);
    const timer = window.setTimeout(() => {
      setLayers((have) => (have.length > 1 ? have.slice(-1) : have));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [wanted]);

  return (
    <div data-orbit-adaptive aria-hidden className="orbit-adaptive">
      {layers.map((layer, index) => (
        <div
          key={layer.key}
          className="orbit-adaptive-layer"
          style={{
            backgroundImage: `url("${layer.url}")`,
            animation: index === layers.length - 1 ? 'orbit-adaptive-in .8s var(--ease-out) both' : undefined,
          }}
        />
      ))}
      <div
        className="orbit-adaptive-hue"
        style={game ? { background: `hsl(${game.hue} 60% 40% / .18)` } : undefined}
      />
      <div className="orbit-adaptive-shade" />
    </div>
  );
}
