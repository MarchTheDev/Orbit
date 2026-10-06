/**
 * Looking for a new version.
 *
 * Orbit is a desktop app that cannot patch itself without being signed for it,
 * so the honest thing is to notice a release, say so, and hand the player the
 * installer. The check asks GitHub for the repository's newest published
 * release, which is one unauthenticated request to a public API and nothing
 * else: no identifier, no telemetry, no account. A release only becomes visible
 * here once it is published, so a draft sitting on GitHub is invisible until
 * its author decides otherwise.
 */
import { APP_VERSION } from '../version';
import { httpJson, downloadUpdate, runUpdate, isNative } from './native';
import { openExternal } from './desktop';

/** The repository the app looks at. Both the releases and the update check. */
export const REPO = 'MarchTheDev/Orbit';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface ReleaseInfo {
  /** Without the leading `v`. */
  version: string;
  /** The release's own page, for the notes and for anybody who wants a file. */
  url: string;
  asset: ReleaseAsset | null;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/**
 * The newest published release, if it is newer than what is running.
 *
 * Anything unreadable answers `null` rather than throwing: a check that runs by
 * itself when the app opens must never be able to interrupt opening the app,
 * and being offline is not an error worth a message.
 */
export async function checkForUpdate(current: string = APP_VERSION): Promise<ReleaseInfo | null> {
  try {
    const release = await httpJson<GitHubRelease>(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!release || release.draft || release.prerelease) return null;
    const version = (release.tag_name ?? release.name ?? '').replace(/^v/i, '').trim();
    if (!version || !isNewer(version, current)) return null;
    return {
      version,
      url: release.html_url ?? `${RELEASES_URL}/tag/v${version}`,
      asset: pickAsset(release.assets ?? []),
    };
  } catch {
    return null;
  }
}

/**
 * Which file to fetch on this machine.
 *
 * Ordered by what installs with the least fuss on each system. The names come
 * from the release workflow, so they end in things like `-windows-setup.exe`
 * and `_amd64.deb`.
 */
function pickAsset(assets: { name?: string; browser_download_url?: string }[]): ReleaseAsset | null {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const wanted = /Windows/i.test(ua)
    ? ['-setup.exe', '.msi', '-standalone.exe']
    : /Linux/i.test(ua)
      ? ['_amd64.deb', '.AppImage', '.x86_64.rpm', '.tar.gz']
      : ['-windows-setup.exe', '_amd64.deb', '.AppImage'];

  for (const ending of wanted) {
    const match = assets.find(
      (a) => a.name && a.browser_download_url && a.name.toLowerCase().endsWith(ending.toLowerCase()),
    );
    if (match?.name && match.browser_download_url) {
      return { name: match.name, url: match.browser_download_url };
    }
  }
  return null;
}

/** Is this version newer than the one running? */
export function isNewer(candidate: string, current: string): boolean {
  return compare(candidate, current) > 0;
}

/** Numeric dotted version compare, with anything after a dash counting as older. */
function compare(a: string, b: string): number {
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

export type InstallStep = 'downloading' | 'opening';

/**
 * Fetch the installer and hand it to the system.
 *
 * Orbit does not replace itself: the download lands in a temporary folder and
 * the installer the project ships is started, which is the same program
 * anybody would run after downloading it by hand. On Windows that is the setup
 * exe, on Debian and Ubuntu the system's package installer, and on a system
 * where nothing here matches, the release page is opened instead.
 */
export async function installUpdate(
  info: ReleaseInfo,
  onStep?: (step: InstallStep) => void,
): Promise<string | null> {
  if (!info.asset) {
    await openExternal(info.url);
    return 'That release has no file for this machine, so its page has been opened instead.';
  }
  if (!isNative()) {
    await openExternal(`${RELEASES_URL}/tag/v${info.version}`);
    return 'Installing needs the desktop app, so its page has been opened instead.';
  }
  onStep?.('downloading');
  const path = await downloadUpdate(info.asset.url, info.asset.name);
  onStep?.('opening');
  await runUpdate(path);
  // Nothing to say: the caller knows what an installer opening means.
  return null;
}
