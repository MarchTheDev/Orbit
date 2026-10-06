/**
 * The decisions the update check makes, with nothing else in the file.
 *
 * `updates.ts` asks GitHub and then installs things, so it cannot be run in a
 * check without a network and an app around it. The part that went wrong was
 * never the request: it was which release to believe, and that part lives here
 * where it can be tested on its own.
 */

export interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/** The version a release carries, from its tag or, failing that, its title. */
export function versionOfRelease(release: GitHubRelease): string {
  const tag = (release.tag_name ?? '').replace(/^v/i, '').trim();
  if (tag) return tag;
  // A title like "Orbit v0.1.3" is the other place the number is written.
  return (release.name ?? '').replace(/^[^0-9]*v?/i, '').trim();
}

/** Is this version newer than the one running? */
export function isNewer(candidate: string, current: string): boolean {
  return compare(candidate, current) > 0;
}

/**
 * The release to offer, out of everything GitHub answered with.
 *
 * Drafts are never anything, and a pre-release only counts when it was asked
 * for. The highest version wins rather than the first one listed: the list
 * arrives in the order things were published, and a hotfix for an older version
 * published today is still older than what is already installed.
 */
export function newestIn(
  releases: GitHubRelease[],
  current: string,
  includePrereleases: boolean,
): { version: string; release: GitHubRelease } | null {
  let best: { version: string; release: GitHubRelease } | null = null;
  for (const release of releases ?? []) {
    if (!release || release.draft) continue;
    if (release.prerelease && !includePrereleases) continue;
    const version = versionOfRelease(release);
    if (!version || !isNewer(version, current)) continue;
    if (!best || compare(version, best.version) > 0) best = { version, release };
  }
  return best;
}

/** Numeric dotted version compare, with anything after a dash counting as older. */
export function compare(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre = ''] = v.replace(/^v/i, '').trim().split('-');
    return { parts: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const la = parse(a);
  const lb = parse(b);
  for (let i = 0; i < Math.max(la.parts.length, lb.parts.length); i += 1) {
    const diff = (la.parts[i] ?? 0) - (lb.parts[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (la.pre === lb.pre) return 0;
  if (la.pre === '') return 1; // 0.2.0 beats 0.2.0-beta
  if (lb.pre === '') return -1;
  return la.pre > lb.pre ? 1 : -1;
}
