/**
 * Whole-volume scans need a little more room to reach installed titles; a
 * selected game/library folder stays intentionally shallow and quick.
 */
export function driveScanDepth(path: string): number {
  const value = path.trim();
  return /^[a-z]:[\\/]*$/i.test(value) || /^\/+$/u.test(value) ? 6 : 3;
}
