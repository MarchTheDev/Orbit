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

/** Sampled pairs, so a cover already measured is never measured twice. */
const CACHE = new Map<string, [string, string] | null>();

/** The picture a game's tile is showing, in the same order `Cover` tries them. */
function coverArt(game: Game): string | null {
  if (game.coverPath) return fileSrc(game.coverPath);
  if (game.meta?.coverUrl) return game.meta.coverUrl;
  if (game.meta?.headerUrl) return game.meta.headerUrl;
  if (game.meta?.backgroundUrl) return game.meta.backgroundUrl;
  return null;
}

function tintOf(pair: [string, string] | null): string {
  if (!pair) return SHADOW;
  const [one, two] = pair;
  return (
    `linear-gradient(to top, color-mix(in srgb, ${one} 92%, transparent), ` +
    `color-mix(in srgb, ${two} 55%, transparent) 55%, transparent 88%)`
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
      setTint(tintOf(known));
      return;
    }
    let alive = true;
    void dominant(url).then((pair) => {
      CACHE.set(url, pair);
      if (alive) setTint(tintOf(pair));
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
 * The fetch is the whole trick: a `blob:` URL is same-origin, so the canvas that
 * draws it can be read. Pointing an image straight at the remote URL cannot be
 * read at all, whatever the host allows.
 */
async function dominant(url: string): Promise<[string, string] | null> {
  // Fetching turns the picture into a `blob:`, which is same-origin, so the
  // canvas that draws it can be read. Pointing an image straight at a remote URL
  // gives a canvas that cannot be read at all, whatever the host allows.
  try {
    const reply = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (reply.ok) {
      const blob = await reply.blob();
      if (blob.type.startsWith('image/')) {
        const objectUrl = URL.createObjectURL(blob);
        try {
          return coloursOf(await loadImage(objectUrl, false));
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    }
  } catch {
    // Fall through: the local asset protocol, for one, has to be asked the other
    // way.
  }

  // Asked for as a cross-origin image, which is refused unless the host says
  // otherwise, and then read. This is what covers a game's own cover file on
  // disk, which is served over Tauri's asset protocol.
  try {
    return coloursOf(await loadImage(url, true));
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

function coloursOf(img: HTMLImageElement): [string, string] | null {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    return coloursIn(ctx.getImageData(0, 0, size, size).data);
  } catch {
    // A tainted canvas throws here rather than anywhere useful.
    return null;
  }
}

interface Bucket {
  n: number;
  /** Saturation, summed, so a bucket's weight is how colourful it is, not just
   *  how many pixels it has. A grey sky should not outvote a red logo. */
  weight: number;
  hueSin: number;
  hueCos: number;
  light: number;
}

/**
 * The one or two hues a picture is mostly made of.
 *
 * Hues are bucketed in 30 degree slices and weighted by saturation, then turned
 * back into colours at a fixed lightness. Two things matter here and were both
 * wrong before: the hue of a bucket is recovered from the sum of its sines and
 * cosines, so a red that straddles 0 degrees does not average into cyan; and the
 * final saturation and lightness are chosen rather than copied, so the gradient
 * is always dark enough for white text and the Play button to read over it.
 */
function coloursIn(data: Uint8ClampedArray): [string, string] | null {
  const buckets = new Map<number, Bucket>();
  for (let i = 0; i < data.length; i += 4) {
    // Ignore anything transparent: a PNG's empty margin is not a colour.
    if (data[i + 3] < 200) continue;
    const [h, s, l] = hslOf(data[i], data[i + 1], data[i + 2]);
    // Near-black, near-white and grey say nothing about a picture's colour, and
    // they are most of what a dark game's screenshot is made of.
    if (l < 0.12 || l > 0.9 || s < 0.18) continue;
    const key = Math.floor(h / 30) % 12;
    const b = buckets.get(key) ?? { n: 0, weight: 0, hueSin: 0, hueCos: 0, light: 0 };
    const rad = (h * Math.PI) / 180;
    b.n += 1;
    b.weight += s;
    b.hueSin += Math.sin(rad) * s;
    b.hueCos += Math.cos(rad) * s;
    b.light += l;
    buckets.set(key, b);
  }

  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  if (ranked.length === 0) return null;

  const hueOf = (b: Bucket) => {
    const angle = (Math.atan2(b.hueSin, b.hueCos) * 180) / Math.PI;
    return (angle + 360) % 360;
  };
  const base = hueOf(ranked[0]);

  // A second colour only if it is a genuinely different one; otherwise the same
  // hue carries the gradient on its own, which looks deliberate rather than
  // muddy.
  const other = ranked.slice(1).find((b) => angularDistance(hueOf(b), base) > 35);

  // Lightness stays in a band that white text reads over, and follows the
  // picture a little so a bright game's tile is not as black as a dark one's.
  const light = clamp(22 + (ranked[0].light / ranked[0].n) * 22, 22, 40);
  const strong = `hsl(${Math.round(base)} ${Math.round(clamp(45 + ranked[0].weight / ranked[0].n, 45, 78))}% ${Math.round(light)}%)`;
  const soft = other
    ? `hsl(${Math.round(hueOf(other))} ${Math.round(clamp(45 + other.weight / other.n, 45, 72))}% ${Math.round(clamp(light + 12, 30, 52))}%)`
    : `hsl(${Math.round(base)} 55% ${Math.round(clamp(light + 12, 30, 52))}%)`;
  return [strong, soft];
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
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
