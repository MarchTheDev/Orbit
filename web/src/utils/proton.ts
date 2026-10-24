/**
 * Ordering the Proton-GE shelf.
 *
 * GitHub returns releases newest first, which is only a promise as long as
 * nobody publishes out of order, and the tags sort wrongly as text anyway:
 * `GE-Proton9-9` is older than `GE-Proton9-20`, and letters would put it after.
 * So each tag is compared as the numbers in it, in the order they appear.
 */
import type { ProtonRelease } from '../types';

/** The numbers a tag carries, which is what makes it newer or older. */
export function tagNumbers(tag: string): number[] {
  return tag
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}

/** Newest first. A tag with no numbers keeps the place the list gave it. */
export function sortReleases(list: ProtonRelease[]): ProtonRelease[] {
  return list
    .map((release, index) => ({ release, index }))
    .sort((a, b) => {
      const x = tagNumbers(a.release.tag);
      const y = tagNumbers(b.release.tag);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const step = (y[i] ?? 0) - (x[i] ?? 0);
        if (step !== 0) return step;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.release);
}

/**
 * The folder name a build is stored by, which is how a game remembers it.
 *
 * A path is stored rather than a name, so the folder is only ever read back for
 * a label. Windows and Linux both cut at either slash.
 */
export function buildName(path: string | null | undefined): string | null {
  const trimmed = (path ?? '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}
