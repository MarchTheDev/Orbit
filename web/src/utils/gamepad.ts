/**
 * What a controller press means, with the hardware left outside.
 *
 * The hook reads the pad and asks this what to do. Keeping the mapping here
 * means a check can press the same buttons without a browser attached, and a
 * later overlay can use the same answers.
 */

export interface PadSnapshot {
  buttons: boolean[];
  axes: number[];
}

export type PadAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate'
  | 'back'
  | 'play'
  | 'page-left'
  | 'page-right';

const DEAD = 0.45;

/**
 * The main library shares a controller with whatever game is in front. It may
 * only act on input while its own visible window has focus; the overlay has a
 * separate native input path and is handled independently.
 */
export function mayHandleGamepadInput(overlayOpen: boolean, visible: boolean, focused: boolean): boolean {
  return !overlayOpen && visible && focused;
}

/** Do not turn a button held in the background into a fresh action on refocus. */
export function padEdgesWhenOwned(ownsWindow: boolean, previous: PadSnapshot | null, next: PadSnapshot): PadAction[] {
  return ownsWindow ? padEdges(previous, next) : [];
}

/**
 * The edge of a press: a button that was up and is now down, or a stick that
 * has just crossed the dead zone. Holding a direction repeats elsewhere, so
 * this function itself fires once per press.
 */
export function padEdges(previous: PadSnapshot | null, next: PadSnapshot): PadAction[] {
  const actions: PadAction[] = [];
  const pressed = (index: number) => next.buttons[index] === true && previous?.buttons[index] !== true;
  if (pressed(0)) actions.push('activate');
  if (pressed(1)) actions.push('back');
  if (pressed(9)) actions.push('play');
  if (pressed(4)) actions.push('page-left');
  if (pressed(5)) actions.push('page-right');
  if (pressed(12)) actions.push('up');
  if (pressed(13)) actions.push('down');
  if (pressed(14)) actions.push('left');
  if (pressed(15)) actions.push('right');

  // The same direction can arrive twice - a hat plus its button - and one press
  // should move the ring once.
  const hatBefore = hatDirection(previous?.axes ?? []);
  const hatNow = hatDirection(next.axes);
  if (hatNow && hatNow !== hatBefore) actions.push(hatNow);

  const beforeX = previous?.axes[0] ?? 0;
  const beforeY = previous?.axes[1] ?? 0;
  const x = next.axes[0] ?? 0;
  const y = next.axes[1] ?? 0;
  if (y < -DEAD && beforeY >= -DEAD) actions.push('up');
  if (y > DEAD && beforeY <= DEAD) actions.push('down');
  if (x < -DEAD && beforeX >= -DEAD) actions.push('left');
  if (x > DEAD && beforeX <= DEAD) actions.push('right');
  return actions.filter((action, index) => actions.indexOf(action) === index);
}

/**
 * A d-pad that arrives as a hat on axes 6 and 7 instead of as four buttons.
 *
 * Most controllers send the d-pad as buttons 12 to 15, but enough of them - and
 * most of them on Linux - report it as a little axis pair with exactly one
 * direction down at a time. A pad whose d-pad reads as nothing but buttons
 * would leave a whole control lying dead, which is the one thing a couch
 * interface cannot afford.
 */
export function hatDirection(axes: number[], dead = 0.5): 'up' | 'down' | 'left' | 'right' | null {
  const x = axes[6] ?? 0;
  const y = axes[7] ?? 0;
  if (Math.abs(x) < dead && Math.abs(y) < dead) return null;
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

export interface PadBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far `to` is from `from` in one direction, or null when it is not that way.
 *
 * The gap is measured edge to edge, and a control that shares the cross axis
 * beats one that merely has a closer centre. A sticky tab at the top of the
 * window would otherwise win every upward press once the page has scrolled.
 */
export function padDistance(from: PadBox, to: PadBox, direction: 'up' | 'down' | 'left' | 'right'): number | null {
  const horizontal = direction === 'left' || direction === 'right';
  const forward = direction === 'right' || direction === 'down';
  const fromStart = horizontal ? from.left : from.top;
  const fromEnd = horizontal ? from.right : from.bottom;
  const toStart = horizontal ? to.left : to.top;
  const toEnd = horizontal ? to.right : to.bottom;
  const gap = forward ? toStart - fromEnd : fromStart - toEnd;
  if (gap < -8) {
    const fromCenter = (fromStart + fromEnd) / 2;
    const toCenter = (toStart + toEnd) / 2;
    const centerDelta = forward ? toCenter - fromCenter : fromCenter - toCenter;
    if (centerDelta < 8) return null;
  }
  const fromCrossStart = horizontal ? from.top : from.left;
  const fromCrossEnd = horizontal ? from.bottom : from.right;
  const toCrossStart = horizontal ? to.top : to.left;
  const toCrossEnd = horizontal ? to.bottom : to.right;
  const overlap = Math.min(fromCrossEnd, toCrossEnd) - Math.max(fromCrossStart, toCrossStart);
  const crossGap = overlap > 0
    ? 0
    : Math.min(Math.abs(toCrossStart - fromCrossEnd), Math.abs(fromCrossStart - toCrossEnd));
  // A miss has to be almost touching to beat a control that actually lines up.
  const align = overlap > 0 ? 0 : crossGap + 240;
  return Math.max(0, gap) + align;
}

/**
 * The nearest of a set of things in one direction, or null when none is that
 * way. It is `padDistance` applied to a list: the overlay's boxes are found
 * this way, so right from the FPS box lands on whatever is actually to its
 * right instead of walking through every control in between.
 */
export function padNearest(
  from: PadBox,
  targets: PadBox[],
  direction: 'up' | 'down' | 'left' | 'right',
): number | null {
  let best: { index: number; score: number } | null = null;
  for (let index = 0; index < targets.length; index += 1) {
    const score = padDistance(from, targets[index], direction);
    if (score == null) continue;
    if (!best || score < best.score) best = { index, score };
  }
  return best ? best.index : null;
}

export type JournalZone = 'journal-game' | 'journal-logs' | 'journal-notes';

/**
 * Where a Journal press should land, before the generic search.
 *
 * Right from a game is the log, not the notes underneath it. Up from the notes
 * is the log, not the Journal tab stuck to the top of the window.
 */
export function journalMove(
  zone: JournalZone | null,
  direction: 'up' | 'down' | 'left' | 'right',
  hasInside: boolean,
): 'logs' | 'logs-last' | 'notes' | 'game' | 'inside' | 'leave' | 'stay' {
  if (zone === 'journal-game' && direction === 'right') return 'logs';
  if (zone === 'journal-logs') {
    if (hasInside) return 'inside';
    if (direction === 'left') return 'game';
    if (direction === 'down') return 'notes';
    if (direction === 'right') return 'stay';
    return 'leave';
  }
  if (zone === 'journal-notes') {
    if (direction === 'up') return 'logs-last';
    if (direction === 'left') return hasInside ? 'inside' : 'game';
    if (hasInside && (direction === 'down' || direction === 'right')) return 'inside';
    if (direction === 'down' || direction === 'right') return 'stay';
    return 'leave';
  }
  return 'leave';
}

export interface HeldDirs {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const NONE_HELD: HeldDirs = { up: false, down: false, left: false, right: false };

/** Directions a snapshot is already holding. The opening one is rest, not a press. */
export function directionsHeld(pad: PadSnapshot): HeldDirs {
  const y = pad.axes[1] ?? 0;
  const x = pad.axes[0] ?? 0;
  const hat = hatDirection(pad.axes);
  return {
    up: pad.buttons[12] === true || y < -DEAD || hat === 'up',
    down: pad.buttons[13] === true || y > DEAD || hat === 'down',
    left: pad.buttons[14] === true || x < -DEAD || hat === 'left',
    right: pad.buttons[15] === true || x > DEAD || hat === 'right',
  };
}

/** Drop a rest direction once the device has let it go. A later press then counts. */
export function releaseRest(rest: HeldDirs, now: HeldDirs): HeldDirs {
  return {
    up: rest.up && now.up,
    down: rest.down && now.down,
    left: rest.left && now.left,
    right: rest.right && now.right,
  };
}

export function withoutRest(actions: PadAction[], rest: HeldDirs): PadAction[] {
  return actions.filter((action) => {
    if (action === 'up') return !rest.up;
    if (action === 'down') return !rest.down;
    if (action === 'left') return !rest.left;
    if (action === 'right') return !rest.right;
    return true;
  });
}

/** Whether a direction is still held, so a grid can keep stepping. */
export function heldDirection(pad: PadSnapshot, rest: HeldDirs = NONE_HELD): 'up' | 'down' | 'left' | 'right' | null {
  const hat = hatDirection(pad.axes);
  if ((pad.buttons[12] || (pad.axes[1] ?? 0) < -DEAD || hat === 'up') && !rest.up) return 'up';
  if ((pad.buttons[13] || (pad.axes[1] ?? 0) > DEAD || hat === 'down') && !rest.down) return 'down';
  if ((pad.buttons[14] || (pad.axes[0] ?? 0) < -DEAD || hat === 'left') && !rest.left) return 'left';
  if ((pad.buttons[15] || (pad.axes[0] ?? 0) > DEAD || hat === 'right') && !rest.right) return 'right';
  return null;
}
