/** Which desktop this window is running on. The web view's own report, not a guess. */
export type DesktopOs = 'windows' | 'linux' | 'other';

export function desktopOs(): DesktopOs {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) return 'windows';
  if (/linux|x11/i.test(ua)) return 'linux';
  return 'other';
}
