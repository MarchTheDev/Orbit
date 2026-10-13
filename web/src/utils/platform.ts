import type { LaunchTarget } from '../types';

/** Which desktop this window is running on. The web view's own report, not a guess. */
export type DesktopOs = 'windows' | 'linux' | 'other';

export function desktopOs(): DesktopOs {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return 'windows';
  if (/linux|x11/i.test(ua)) return 'linux';
  return 'other';
}

/**
 * How a program just added to the library should start.
 *
 * On Linux a `.exe` is a Windows program, so it goes through Wine. Anything
 * else on that machine is a native program and must not. Windows always starts
 * the file itself.
 */
export function launchForAddedProgram(path: string, installDir: string | null): LaunchTarget {
  const trimmed = path.trim();
  if (!trimmed) return { kind: 'none' };
  if (desktopOs() === 'linux' && /\.exe$/i.test(trimmed)) {
    return { kind: 'wine', path: trimmed, args: '', prefix: null, wine: null };
  }
  return { kind: 'executable', path: trimmed, args: '', workingDir: installDir };
}
