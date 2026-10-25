/**
 * Keeping the panel's boxes on the screen they are opened on.
 *
 * Where each box sits is saved in pixels, because that is what a drag produces
 * and what the panel is sized in. Pixels are only true for the screen they were
 * measured on: a layout arranged on a 1920-wide desktop puts the gallery, the
 * player and the notes off the right edge of a laptop or a virtual machine
 * running at 1280, and boxes past the bottom are boxes nobody can see. The
 * saved layout is therefore read through here, which moves a box back inside
 * whatever window it is being drawn in - and does it again whenever the window
 * changes size.
 *
 * Nothing is written back: the arrangement the player made is still theirs, and
 * the day they go back to the bigger screen it is where they left it.
 */

/** The smallest a box is allowed to be, which is its own content's size. */
export interface BoxSize {
  minW: number;
  minH: number;
}

/** Where a box is, in pixels of the window it is drawn in. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The margin kept between a box and the edge of the screen. */
export const EDGE = 24;

/**
 * The closest place to `spot` that is wholly on a `width` by `height` screen.
 *
 * A box wider than the screen is shrunk to fit rather than hung off the side,
 * and an unreasonably small window (before the first resize, or a screen too
 * small to hold the box at all) leaves the spot alone instead of folding it
 * into the corner.
 */
export function fitSpot(spot: Spot, size: BoxSize, width: number, height: number): Spot {
  if (!(width > 0) || !(height > 0)) return spot;
  const w = Math.max(size.minW, Math.min(spot.w, width - EDGE * 2));
  const h = Math.max(size.minH, Math.min(spot.h, height - EDGE * 2));
  const x = Math.min(Math.max(EDGE, spot.x), Math.max(EDGE, width - w - EDGE));
  const y = Math.min(Math.max(EDGE, spot.y), Math.max(EDGE, height - h - EDGE));
  if (x === spot.x && y === spot.y && w === spot.w && h === spot.h) return spot;
  return { ...spot, x, y, w, h };
}

/** Every box, fitted to the window. Unknown ids and unknown sizes are left be. */
export function fitSpots<T extends Record<string, Spot>>(
  spots: T,
  sizes: Record<string, BoxSize | undefined>,
  width: number,
  height: number,
): T {
  if (!(width > 0) || !(height > 0)) return spots;
  let changed = false;
  const next = { ...spots };
  for (const key of Object.keys(spots)) {
    const size = sizes[key];
    if (!size) continue;
    const fitted = fitSpot(spots[key], size, width, height);
    if (fitted !== spots[key]) {
      next[key as keyof T] = fitted as T[keyof T];
      changed = true;
    }
  }
  return changed ? next : spots;
}
