/** Formatting shared across the screens. */

/** Minutes as `12h 30m`, or `45m`. */
export function fmtMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Seconds as `1h 04m 09s`, for the session clock. */
export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Read a duration someone typed, in seconds, or null when it makes no sense.
 *
 * Accepts plain numbers and `h`/`m`/`s` parts in any order, so `90`, `1h 30m`
 * and `30m 90s` all work. The player is typing a playtime, not filling in a
 * form, so being forgiving beats being strict.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const units: Record<string, number> = { h: 3600, hr: 3600, hrs: 3600, m: 60, min: 60, mins: 60, s: 1, sec: 1, secs: 1 };
  let total = 0;
  let matched = false;
  let bare = '';

  // Walk `12h`, `30m`, `90` runs, adding each up as it goes.
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]*)|(\S+)/g)) {
    const [, number, unit, word] = match;
    if (number !== undefined) {
      if (unit && unit in units) {
        total += Number(number) * units[unit];
      } else if (unit) {
        return null;
      } else {
        // A bare number is seconds, which is what the old editor asked for.
        bare += number;
      }
      matched = true;
    } else if (word !== undefined && !(word in units)) {
      return null;
    }
  }

  if (!matched) return null;
  total += Number(bare || 0);
  return Number.isFinite(total) && total >= 0 ? Math.round(total) : null;
}

/** Bytes as `49.2 GB`, or `812 MB` for anything smaller. */
export function fmtBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return '0 B';
}

/** A date, or an em dash when there is not one. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A date and time, for the session log. */
export function fmtDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** How a session ended, in words a player would use. */
export function fmtEndedBy(endedBy: string | null, manual: boolean): string {
  if (manual) return 'Logged by hand';
  switch (endedBy) {
    case 'process exit':
      return 'Game closed';
    case 'recovered':
      return 'Recovered after a crash';
    case 'failed':
      return 'Could not start';
    case null:
      return 'Running';
    default:
      return 'Stopped';
  }
}

/** Today at noon, as Unix seconds, for logging time by hand. */
export function todayAtNoon(): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Midnight today, as Unix seconds. */
export function todayAtMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** A short, unique id. */
/**
 * A `datetime-local` value from a moment, in the viewer's own timezone.
 *
 * `datetime-local` has no timezone in it, so this deliberately reads and writes
 * local wall-clock time: a session at 9am stays at 9am wherever the library is.
 */
export function toLocalInput(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Read a `datetime-local` value back as Unix seconds, in local time. */
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** A stable colour per title, so placeholder covers do not shuffle. */
export function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/** The folder a path is in. */
export function dirOf(path: string): string {
  return path.replace(/\\[^\\]+$/, '');
}