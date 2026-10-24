import { overlayRecord, overlayReplay, overlayShot } from './native';

/**
 * A capture asked for by a shortcut, with no panel in front of anybody.
 *
 * A shortcut can be pressed while a game owns the screen, so nothing happens in
 * Orbit's own window until the game is let go. What matters is that the file is
 * saved, and that the desktop side says so - it draws its own card and plays its
 * own chime when no panel is up, which is exactly what this case is.
 *
 * The timestamp is made here rather than in Rust because it is the player's
 * local time: a screenshot named in UTC is filed under yesterday for anyone who
 * was playing after midnight east of Greenwich.
 */

/** The three things a shortcut can ask for. */
export type CaptureHotkey = 'screenshot' | 'recording' | 'replay';

/** The stamp the captures are named with, in the player's own time. */
export function stampNow(now: Date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())} ${part(
    now.getHours(),
  )}-${part(now.getMinutes())}-${part(now.getSeconds())}`;
}

/** Whether a string that arrived from the desktop side is one of the three. */
export function isCaptureHotkey(value: unknown): value is CaptureHotkey {
  return value === 'screenshot' || value === 'recording' || value === 'replay';
}

/**
 * Run one. Returns what the desktop side said, so a caller can report it when
 * there is somewhere to report it to.
 */
export async function runCaptureHotkey(
  action: CaptureHotkey,
  options: { seconds?: number; at?: Date } = {},
): Promise<string> {
  const stamp = stampNow(options.at);
  if (action === 'screenshot') return overlayShot(stamp);
  if (action === 'recording') return overlayRecord(stamp);
  return overlayReplay(Math.max(5, Math.min(300, options.seconds ?? 30)), stamp);
}
