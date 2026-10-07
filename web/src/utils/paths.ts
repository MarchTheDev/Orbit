/**
 * Path handling on the front end.
 *
 * There is no path library in the browser, so these are small and deliberately
 * literal. They exist because plain `startsWith` gets Windows wrong:
 * `"D:\\Games2\\Rimworld".startsWith("D:\\Games")` is true, and those are not
 * the same folder.
 */

/** Lower cased, back-slashed, with any trailing separator removed. */
function norm(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * True when `dir` is `root` itself or sits somewhere inside it.
 *
 * Compares whole path segments, so `D:\Games2` is not inside `D:\Games`. This
 * mirrors the component-wise check Rust does in `storage::game_folder`; that is
 * the rule that decides which folder Orbit will move a game into.
 */
export function isInside(dir: string, root: string): boolean {
  const d = norm(dir);
  const r = norm(root);
  if (!r || !d) return false;
  if (d === r) return true;
  return d.startsWith(r.endsWith('\\') ? r : `${r}\\`);
}

/**
 * Point a stored path at the equivalent place inside a moved folder.
 *
 * `isInside` does the boundary check first, so a sibling such as `Games2` is
 * never rewritten when the moved folder was `Games`. Separators and case are
 * normalized only for that check; the suffix keeps its spelling and is joined
 * using the destination path's separator.
 */
export function rebasePath(path: string, fromRoot: string, toRoot: string): string {
  if (!isInside(path, fromRoot)) return path;

  const normalizedPath = path.replace(/\//g, '\\').replace(/\\+$/, '');
  const normalizedRoot = fromRoot.replace(/\//g, '\\').replace(/\\+$/, '');
  const remainder = normalizedPath.slice(normalizedRoot.length).replace(/^\\+/, '');
  const separator = toRoot.includes('\\') ? '\\' : '/';
  const destination = toRoot.replace(/[\\/]+$/, '');
  return remainder ? `${destination}${separator}${remainder.replace(/\\/g, separator)}` : destination;
}

/** The `D:` at the start of a path, or an empty string when there is not one. */
export function driveOf(path: string): string {
  return /^[a-z]:/i.test(path) ? path.slice(0, 2).toUpperCase() : '';
}

/**
 * Which of `folders` a path belongs to, longest match first.
 *
 * Longest first because a folder listed inside another one should win: with
 * `D:\Games` and `D:\Games\Emulators` both listed, a ROM under the second is
 * reported there rather than in the first.
 */
export function folderOf(folders: string[], dir: string): string | null {
  return [...folders].sort((a, b) => b.length - a.length).find((f) => isInside(dir, f)) ?? null;
}
