import { useEffect, useState } from 'react';
import type { Game } from '../types';
import { fileSrc } from '../services/desktop';

/**
 * The tint behind the Play button when a cover is hovered.
 *
 * A cover tile darkens at the bottom on hover so the button and the title read
 * over the art. Which colours that darkening uses is a matter of taste, so there
 * are two answers: the picture's own colours, which makes the tile look like one
 * object, or Orbit's theme, which makes the whole library look like one object.
 *
 * With the picture's colours, it is *only* the picture's colours. There used to
 * be a theme-coloured gradient underneath as a fallback, which meant every tile
 * showed a little of the theme no matter what it was set to; now a picture that
 * cannot be measured gets a plain dark fade, which reads as shadow rather than
 * as somebody else's colour.
 *
 * How the colours are found: the picture is fetched, drawn into a small canvas
 * and the pixels are read. Fetching it rather than pointing an `<img>` at it is
 * what makes that possible at all, because a cross-origin image taints the
 * canvas and a tainted canvas cannot be read. A fetch that is refused, which is
 * down to the host, ends in the plain fade.
 *
 * Nothing is measured until a tile is actually hovered, so a library of four
 * hundred games does not decode four hundred pictures to draw itself, and a
 * picture that has been measured once is remembered.
 */

/** A plain dark fade, for a picture whose colours could not be read. */
const SHADOW = 'linear-gradient(to top, rgb(0 0 0 / 0.82), rgb(0 0 0 / 0.35) 55%, transparent 88%)';

/** Themes' two colours, mixed the way a sampled pair is. */
function themeTint(): string {
  return (
    'linear-gradient(to top, color-mix(in srgb, var(--c-accent) 88%, transparent), ' +
    'color-mix(in srgb, var(--c-accent2) 45%, transparent) 55%, transparent 88%)'
  );
}

/** Sampled colours, so a cover already measured is never measured twice. */
const CACHE = new Map<string, number | null>();

/** The picture a game's tile is showing, in the same order `Cover` tries them. */
function coverArt(game: Game): string | null {
  if (game.coverPath) return fileSrc(game.coverPath);
  if (game.meta?.coverUrl) return game.meta.coverUrl;
  if (game.meta?.headerUrl) return game.meta.headerUrl;
  if (game.meta?.backgroundUrl) return game.meta.backgroundUrl;
  return null;
}

/**
 * The gradient, from one hue and one lightness.
 *
 * One colour, not two. A second colour was picked from the next biggest patch
 * of the picture, and on real cover art that patch is often a highlight, a sky
 * or a logo, so the gradient came out with a colour that had nothing to do with
 * the game. The same hue, darker at the bottom and lighter where it fades,
 * always looks like the picture it came from.
 */
function tintOf(hue: number | null, light: number): string {
  if (hue === null) return SHADOW;
  const top = Math.round(Math.min(46, light + 12));
  return (
    `linear-gradient(to top, hsl(${hue} 44% ${Math.round(light)}% / 0.95), ` +
    `hsl(${hue} 40% ${top}% / 0.42) 55%, transparent 88%)`
  );
}

/**
 * The gradient to draw behind a tile's Play button.
 *
 * `fromCover` is the player's setting; `active` is whether the pointer is over
 * the tile, which is what starts the measuring.
 */
export function useHoverTint(game: Game, fromCover: boolean, active: boolean): string {
  const url = fromCover && active ? coverArt(game) : null;
  const [tint, setTint] = useState<string>(() => (fromCover ? SHADOW : themeTint()));

  useEffect(() => {
    if (!fromCover) {
      setTint(themeTint());
      return;
    }
    if (!url) {
      setTint(SHADOW);
      return;
    }
    const known = CACHE.get(url);
    if (known !== undefined) {
      setTint(tintOf(known, 26));
      return;
    }
    let alive = true;
    void dominant(url).then((hue) => {
      CACHE.set(url, hue);
      if (alive) setTint(tintOf(hue, 26));
    });
    return () => {
      alive = false;
    };
  }, [url, fromCover]);

  return tint;
}

/**
 * Read a picture's colours by fetching it and drawing it into a small canvas.
 *
 * Fetching is what makes it possible at all: a cross-origin image taints the
 * canvas and a tainted canvas cannot be read, whatever the host allows, but a
 * picture that has been fetched can be drawn from a `blob:` URL that is
 * same-origin.
 */
async function dominant(url: string): Promise<number | null> {
  try {
    const reply = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (reply.ok) {
      const blob = await reply.blob();
      if (blob.type.startsWith('image/')) {
        const objectUrl = URL.createObjectURL(blob);
        try {
          return hueOf(await loadImage(objectUrl, false));
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    }
  } catch {
    // Fall through: the local asset protocol, for one, has to be asked the
    // other way.
  }

  try {
    return hueOf(await loadImage(url, true));
  } catch {
    return null;
  }
}

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('that picture would not load'));
    img.src = src;
  });
}

function hueOf(img: HTMLImageElement): number | null {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    return hueIn(ctx.getImageData(0, 0, size, size).data);
  } catch {
    // A tainted canvas throws here rather than anywhere useful.
    return null;
  }
}

interface Bucket {
  /** Saturation, summed: how colourful a patch is, not how many pixels it has.
   *  A grey sky should not outvote a red logo. */
  weight: number;
  hueSin: number;
  hueCos: number;
}

/**
 * The hue a picture is mostly made of.
 *
 * Hues are bucketed in 30 degree slices and weighted by saturation, and the hue
 * of the winning bucket is recovered from the sum of its sines and cosines.
 * Averaging the degree numbers instead, which is what this did first, sends a
 * red that straddles 0 degrees straight through orange, yellow and green to
 * cyan, which is why some tiles came out with a colour that was plainly wrong.
 */
function hueIn(data: Uint8ClampedArray): number | null {
  const buckets = new Map<number, Bucket>();
  for (let i = 0; i < data.length; i += 4) {
    // Ignore anything transparent: a PNG's empty margin is not a colour.
    if (data[i + 3] < 200) continue;
    const [h, s, l] = hslOf(data[i], data[i + 1], data[i + 2]);
    // Near-black, near-white and grey say nothing about a picture's colour, and
    // they are most of what a dark game's screenshot is made of.
    if (l < 0.12 || l > 0.9 || s < 0.18) continue;
    const key = Math.floor(h / 30) % 12;
    const b = buckets.get(key) ?? { weight: 0, hueSin: 0, hueCos: 0 };
    const rad = (h * Math.PI) / 180;
    b.weight += s;
    b.hueSin += Math.sin(rad) * s;
    b.hueCos += Math.cos(rad) * s;
    buckets.set(key, b);
  }

  const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return null;
  const angle = (Math.atan2(best.hueSin, best.hueCos) * 180) / Math.PI;
  return Math.round((angle + 360) % 360);
}

/** Hue in degrees, saturation and lightness as 0 to 1. */
function hslOf(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}
