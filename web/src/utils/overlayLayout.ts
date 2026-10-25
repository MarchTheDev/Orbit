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

/** The screen the arrangement was designed on, at its natural size. */
export const DESIGN_W = 1280;
export const DESIGN_H = 720;

/**
 * How much the arrangement has to shrink for this window.
 *
 * Never more than 1: a bigger screen gets the boxes at their own size, spread
 * to its edges, rather than four enormous panels. A smaller one - a laptop, or
 * a virtual machine running at 1024 by 640 - gets everything shrunk together,
 * because scaling the boxes but not the space between them is what makes them
 * pile on top of each other. Half is the floor; below that the boxes' own
 * minimum sizes take over and the window is simply too small for all of them.
 */
export function fitScale(
  width: number,
  height: number,
  designW = DESIGN_W,
  designH = DESIGN_H,
): number {
  if (!(width > 0) || !(height > 0) || !(designW > 0) || !(designH > 0)) return 1;
  return Math.max(0.5, Math.min(1, width / designW, height / designH));
}

/**
 * Whether every box is wholly on this window.
 *
 * This is the question that decides whether an arrangement the player made is
 * even usable here. A layout saved on a 1920-wide desktop is not wrong, it is
 * just not this screen, and clamping it into a smaller one turns three neat
 * columns into a heap - so it is not used until there is room for it again,
 * and the arrangement designed for this window is used instead.
 */
export function fitsWindow(
  spots: Record<string, { x: number; y: number; w?: number; h?: number }>,
  width: number,
  height: number,
  slack = 1,
): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return Object.values(spots).every((spot) => {
    // A place with no size of its own is drawn at the box's natural one, which
    // is what will be fitted; its corner is all that can be judged here.
    const w = spot.w ?? 0;
    const h = spot.h ?? 0;
    return (
      Number.isFinite(spot.x) &&
      Number.isFinite(spot.y) &&
      spot.x >= -slack &&
      spot.y >= -slack &&
      spot.x + w <= width + slack &&
      spot.y + h <= height + slack
    );
  });
}

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

/** A box the arrangement has to place: its natural size and its own minimum. */
export interface BoxShape {
  w: number;
  h: number;
  minW: number;
  minH: number;
}

/**
 * Where the boxes start out.
 *
 * Two stacks: what the machine is doing down the left - the frame rate, the
 * clock, the mixer, and what the game costs - and what the player is holding
 * down the right: the gallery, what is playing, and the notes on it. Every one
 * of them can be dragged anywhere; this is only the first arrangement.
 *
 * The sizes are scaled to the window first, and the gaps with them. Fitting
 * boxes of their designed size into a small window afterwards is what piles
 * the left column on top of itself: the audio box keeps its 440 pixels, and
 * the performance box that was meant to sit under it has nowhere to go.
 */
export function defaultSpots<S extends Record<string, BoxShape>>(
  boxes: S,
  width: number,
  height: number,
): Record<keyof S, Spot> {
  const edge = EDGE;
  const gap = 16;
  const scale = fitScale(width, height);
  const size = (id: keyof S) => ({
    w: Math.max(boxes[id].minW, Math.round(boxes[id].w * scale)),
    h: Math.max(boxes[id].minH, Math.round(boxes[id].h * scale)),
  });
  const fpsSize = size('fps');
  const clockSize = size('clock');
  const audioSize = size('audio');
  const performanceSize = size('performance');
  const gallerySize = size('gallery');
  const playerSize = size('player');
  const notesSize = size('notes');
  const captureSize = size('capture');
  const fps = { x: edge, y: edge, w: fpsSize.w, h: fpsSize.h };
  const clock = { x: edge, y: fps.y + fps.h + gap, w: clockSize.w, h: clockSize.h };
  const audioY = clock.y + clock.h + gap;
  const audio = {
    x: edge,
    y: audioY,
    w: audioSize.w,
    // The performance numbers sit under the mixer, so the mixer cannot grow
    // until it fills the screen and push them off it.
    h: Math.max(
      boxes.audio.minH,
      Math.min(audioSize.h, height - audioY - performanceSize.h - gap - edge),
    ),
  };
  // A second column, used when the left one has run out of height. It is what
  // stops a short screen from finding nowhere to put the performance box and
  // dropping it on top of the mixer.
  const columnRight = edge + Math.max(fps.w, clock.w, audio.w) + gap;
  const audioBottom = audio.y + audio.h;
  const performanceBelow = audioBottom + gap + performanceSize.h + edge <= height;
  const performance = performanceBelow
    ? { x: edge, y: audioBottom + gap, w: performanceSize.w, h: performanceSize.h }
    : { x: columnRight, y: edge, w: performanceSize.w, h: performanceSize.h };
  const gallery = {
    x: Math.max(edge, width - gallerySize.w - edge),
    y: edge,
    w: gallerySize.w,
    h: gallerySize.h,
  };
  const player = {
    x: Math.max(edge, width - playerSize.w - edge),
    y: Math.max(edge, Math.min(height - playerSize.h - edge, gallery.y + gallery.h + gap)),
    w: playerSize.w,
    h: playerSize.h,
  };
  // The notes belong under what is playing. A screen too short to hold all
  // three boxes down that side gets them in the second column instead of half
  // off the bottom of the display - under the performance box when that is
  // there too, so the two do not land on each other either.
  const notesUnderPlayer = player.y + player.h + gap + notesSize.h + edge <= height;
  const notes = notesUnderPlayer
    ? { x: player.x, y: player.y + player.h + gap, w: playerSize.w, h: notesSize.h }
    : {
        x: columnRight,
        y: performanceBelow ? edge : performance.y + performance.h + gap,
        w: notesSize.w,
        h: notesSize.h,
      };
  const capture = {
    x: Math.max(edge, Math.round((width - captureSize.w) / 2)),
    y: Math.max(edge, height - captureSize.h - edge),
    w: captureSize.w,
    h: captureSize.h,
  };
  // The last word: nothing may start outside the window, whatever was asked
  // for above. A window too small for the boxes at their minimums is a bad
  // window, but it is not an excuse to draw half a box.
  const spots = { fps, clock, audio, performance, gallery, player, notes, capture };
  return fitSpots(spots, boxes, width, height) as Record<keyof S, Spot>;
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
