/**
 * Looking for a new version.
 *
 * Orbit is a desktop app that cannot patch itself without being signed for it,
 * so the honest thing is to notice a release, say so, and hand the player the
 * installer. The check asks GitHub for the repository's newest published
 * releases, which is one unauthenticated request to a public API and nothing
 * else: no identifier, no telemetry, no account. A release only becomes visible
 * here once it is published, so a draft sitting on GitHub is invisible until
 * its author decides otherwise.
 *
 * The newest is taken from the list rather than from `/releases/latest`, which
 * is the one GitHub calls latest and which skips pre-releases entirely. A
 * pre-release is how a build is tested before it is announced, so an app that
 * cannot see one can never be used to test the thing that updates it. They are
 * still ignored unless the setting asks for them.
 */
import { APP_VERSION } from '../version';
import { newestIn, pickReleaseAsset, type GitHubRelease } from './updates.logic';
import { httpJson, downloadUpdate, runUpdate, isNative } from './native';
import { openExternal } from './desktop';

/** The repository the app looks at. Both the releases and the update check. */
export const REPO = 'MarchTheDev/Orbit';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;

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

/**
 * The newest published release, if it is newer than what is running.
 *
 * `includePrereleases` is off unless Settings has asked for it, which is what
 * somebody testing a build before it is announced turns on. Anything unreadable
 * answers `null` rather than throwing: a check that runs by itself when the app
 * opens must never be able to interrupt opening the app, and being offline is
 * not an error worth a message.
 */
export async function checkForUpdate(
  current: string = APP_VERSION,
  includePrereleases = false,
): Promise<ReleaseInfo | null> {
  try {
    const answer = await httpJson<GitHubRelease[] | GitHubRelease>(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    // Which release to believe is decided in `updates.logic`, where it can be
    // checked without a network: that is the part that was wrong. The list
    // arrives in the order things were published, and a hotfix for an older
    // version published today is still older than what is installed.
    const best = newestIn(Array.isArray(answer) ? answer : [answer], current, includePrereleases);
    if (!best) return null;
    const { version, release } = best;
    return {
      version,
      url: release.html_url ?? `${RELEASES_URL}/tag/v${version}`,
      asset: pickReleaseAsset(release.assets ?? [], typeof navigator === 'undefined' ? '' : navigator.userAgent),
    };
  } catch {
    return null;
  }
}


export { isNewer, versionOfRelease } from './updates.logic';

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
  if (/^(?:Orbit\.exe|.*-standalone\.exe)$/i.test(info.asset.name)) {
    await openExternal(info.url);
    return 'That release only includes the standalone Orbit.exe. Its page is open; close Orbit before replacing your current copy.';
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
