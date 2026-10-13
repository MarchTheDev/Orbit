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

  const beforeX = previous?.axes[0] ?? 0;
  const beforeY = previous?.axes[1] ?? 0;
  const x = next.axes[0] ?? 0;
  const y = next.axes[1] ?? 0;
  if (y < -DEAD && beforeY >= -DEAD) actions.push('up');
  if (y > DEAD && beforeY <= DEAD) actions.push('down');
  if (x < -DEAD && beforeX >= -DEAD) actions.push('left');
  if (x > DEAD && beforeX <= DEAD) actions.push('right');
  return actions;
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

/** Whether a direction is still held, so a grid can keep stepping. */
export function heldDirection(pad: PadSnapshot): 'up' | 'down' | 'left' | 'right' | null {
  if (pad.buttons[12] || (pad.axes[1] ?? 0) < -DEAD) return 'up';
  if (pad.buttons[13] || (pad.axes[1] ?? 0) > DEAD) return 'down';
  if (pad.buttons[14] || (pad.axes[0] ?? 0) < -DEAD) return 'left';
  if (pad.buttons[15] || (pad.axes[0] ?? 0) > DEAD) return 'right';
  return null;
}
