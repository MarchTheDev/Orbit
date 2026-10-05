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
 * The picture's colours are read out of the image itself: it is drawn into a
 * tiny canvas and the pixels are sorted into hue buckets, weighted by how much
 * of the picture each one covers. Nothing clever happens after that, a hue and a
 * lightness band are enough to make a gradient that matches the art.
 *
 * Two things make this safe to do at all. The image is fetched with CORS, so a
 * host that does not allow it simply fails and the theme colours are used
 * instead. And nothing is measured until a tile is actually hovered, so opening
 * a library of four hundred games does not decode four hundred pictures.
 */

/** Themes' two colours, mixed the same way a sampled pair is. */
const THEME_TINT =
  'linear-gradient(to top, color-mix(in srgb, var(--c-accent) 88%, transparent), color-mix(in srgb, var(--c-accent2) 45%, transparent) 55%, transparent 88%)';

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

function tintOf([one, two]: [string, string]): string {
  return `linear-gradient(to top, color-mix(in srgb, ${one} 88%, transparent), color-mix(in srgb, ${two} 45%, transparent) 55%, transparent 88%)`;
}

export function useHoverTint(game: Game, fromCover: boolean, active: boolean): string {
  const url = fromCover && active ? coverArt(game) : null;
  const [tint, setTint] = useState(THEME_TINT);

  useEffect(() => {
    if (!url) {
      setTint(THEME_TINT);
      return;
    }
    const known = CACHE.get(url);
    if (known) {
      setTint(tintOf(known));
      return;
    }
    let alive = true;
    void dominant(url).then((pair) => {
      CACHE.set(url, pair);
      if (alive && pair) setTint(tintOf(pair));
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return tint;
}

/** Draw the picture small and ask the pixels what colours it is made of. */
function dominant(url: string): Promise<[string, string] | null> {
  return new Promise((resolve) => {
    // No crossOrigin means a tainted canvas, and a tainted canvas cannot be
    // read, so this attempt is the one that has to be allowed. A host that
    // refuses is not an error worth showing anyone: the theme answers instead.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const give = (value: [string, string] | null) => {
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return give(null);
        ctx.drawImage(img, 0, 0, size, size);
        give(coloursIn(ctx.getImageData(0, 0, size, size).data));
      } catch {
        give(null);
      }
    };
    img.onerror = () => give(null);
    img.src = url;
  });
}

/** The two hues a picture is mostly made of, as colours dark enough to read on. */
function coloursIn(data: Uint8ClampedArray): [string, string] | null {
  const buckets = new Map<number, { n: number; h: number; s: number; l: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = hslOf(data[i], data[i + 1], data[i + 2]);
    // Near-black, near-white and grey say nothing about a picture's colour,
    // and they are most of what a dark game's screenshot is made of.
    if (l < 0.1 || l > 0.92 || s < 0.15) continue;
    const key = Math.round(h / 30) % 12;
    const b = buckets.get(key) ?? { n: 0, h: 0, s: 0, l: 0 };
    b.n += 1;
    b.h += h;
    b.s += s;
    b.l += l;
    buckets.set(key, b);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 2);
  if (ranked.length === 0) return null;

  const built = ranked.map((b) => {
    const hue = Math.round(b.h / b.n);
    // Saturated enough to be a colour, dark enough that white text and the Play
    // button still read over it.
    const sat = Math.round(Math.min(0.85, b.s / b.n + 0.2) * 100);
    const light = Math.round(Math.min(0.42, Math.max(0.2, (b.l / b.n) * 0.5 + 0.18)) * 100);
    return `hsl(${hue} ${sat}% ${light}%)`;
  });
  return [built[0], built[1] ?? built[0]];
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
