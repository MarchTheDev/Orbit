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

export type PadAction = 'up' | 'down' | 'left' | 'right' | 'activate' | 'back' | 'play';

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

/** Whether a direction is still held, so a grid can keep stepping. */
export function heldDirection(pad: PadSnapshot): 'up' | 'down' | 'left' | 'right' | null {
  if (pad.buttons[12] || (pad.axes[1] ?? 0) < -DEAD) return 'up';
  if (pad.buttons[13] || (pad.axes[1] ?? 0) > DEAD) return 'down';
  if (pad.buttons[14] || (pad.axes[0] ?? 0) < -DEAD) return 'left';
  if (pad.buttons[15] || (pad.axes[0] ?? 0) > DEAD) return 'right';
  return null;
}
