import { useEffect, useRef, useState } from 'react';
import type { Game } from '../types';
import { coverArtCandidates } from '../utils/art';

/**
 * The app's own light, taken from whichever game is in hand.
 *
 * Heronite changes the colour of its whole interface to whatever is selected:
 * the covers behind it, the shading, the accent. Orbit's shell is a dark room
 * with one accent, which is what makes a library of four hundred unrelated
 * pictures readable - so this is the quiet version of the same idea. The
 * selected game's cover is thrown a long way out of focus behind the page and
 * the game's own hue is washed over it, which tints the room without touching
 * the accent every button is drawn in.
 *
 * Two layers, so the picture arrives as a cross-fade rather than as a swap: the
 * one behind stays until the one in front has finished coming up.
 */
export function AdaptiveBackdrop({ game }: { game: Game | null }) {
  const [layers, setLayers] = useState<{ key: number; url: string }[]>([]);
  const nextKey = useRef(1);
  const last = layers[layers.length - 1] ?? null;
  const wanted = game ? coverArtCandidates(game)[0] ?? null : null;

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
