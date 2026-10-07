/**
 * What the update check decides.
 *
 * The thing that went wrong: the app asked GitHub for "the latest release",
 * which is the one GitHub calls latest and which skips pre-releases entirely, so
 * a build published as a pre-release was invisible to the app testing it. The
 * check reads the list now and picks the highest version in it.
 *
 * `checkForUpdate` itself is not called here: it makes a network request. What
 * is checked is the decision it makes from an answer, which is where the bug
 * was: the version a release carries, whether it is newer, and whether a
 * pre-release counts.
 */
import { compare, isNewer, versionOfRelease, newestIn, pickReleaseAsset } from '../src/services/updates.logic.ts';

let failures = 0;
/** Plain JavaScript on purpose: esbuild reads a `.mjs` file as JavaScript. */
const ok = (what, pass) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${what}`);
  if (!pass) failures += 1;
};

console.log('checking the update decision');

ok('a higher version is newer', isNewer('0.1.2', '0.1.0') === true);
ok('the same version is not', isNewer('0.1.2', '0.1.2') === false);
ok('a lower version is not', isNewer('0.1.0', '0.1.2') === false);
ok('10 beats 9', isNewer('0.10.0', '0.9.0') === true);
ok('a release beats its own pre-release', isNewer('0.2.0', '0.2.0-beta.1') === true);

ok('a tag names the version', versionOfRelease({ tag_name: 'v0.1.2' }) === '0.1.2');
ok('a title is read as well', versionOfRelease({ name: 'Orbit v0.1.3' }) === '0.1.3');

const published = [
  { tag_name: 'v0.1.2', prerelease: true },
  { tag_name: 'v0.1.0' },
];

ok(
  'a published pre-release is found now',
  newestIn(published, '0.1.0', true)?.version === '0.1.2',
);
ok(
  'and skipped unless it was asked for',
  newestIn(published, '0.1.0', false) === null,
);
ok(
  'a draft never counts',
  newestIn([...published, { tag_name: 'v9.9.9', draft: true }], '0.1.0', true)?.version === '0.1.2',
);
ok(
  'the highest version wins, not the newest listed',
  newestIn([{ tag_name: 'v0.1.3' }, { tag_name: 'v0.2.0' }], '0.1.0', true)?.version === '0.2.0',
);
ok(
  'something already installed is not offered again',
  newestIn(published, '0.2.0', true) === null,
);

const windowsAssets = [
  { name: 'Orbit.exe', browser_download_url: 'https://example.com/Orbit.exe' },
  { name: 'Orbit-0.2.0-windows-setup.exe', browser_download_url: 'https://example.com/setup.exe' },
  { name: 'Orbit-0.2.0-windows-portable.zip', browser_download_url: 'https://example.com/portable.zip' },
];
ok(
  'Windows prefers the installer when a release has one',
  pickReleaseAsset(windowsAssets, 'Windows NT 10.0')?.name === 'Orbit-0.2.0-windows-setup.exe',
);
ok(
  'Windows can download the standalone Orbit.exe when there is no installer',
  pickReleaseAsset([windowsAssets[0]], 'Windows NT 10.0')?.name === 'Orbit.exe',
);
ok(
  'Linux prefers its Debian package',
  pickReleaseAsset([
    { name: 'Orbit-0.2.0-linux-x86_64.AppImage', browser_download_url: 'https://example.com/orbit.AppImage' },
    { name: 'orbit_0.2.0_amd64.deb', browser_download_url: 'https://example.com/orbit.deb' },
  ], 'Linux x86_64')?.name === 'orbit_0.2.0_amd64.deb',
);

// The release label is `1.0` while the tag GitHub carries can be either form,
// so the two have to read as the same release or an installed copy offers
// itself as an update.
ok('a two-part label and its three-part tag are the same release', compare('1.0', '1.0.0') === 0);
ok('a padded tag is not newer than the label it came from', !isNewer('1.0.0', '1.0'));
ok('and the label is not newer than the tag', !isNewer('1.0', '1.0.0'));
ok('the next release is still newer than a two-part label', isNewer('1.1', '1.0'));
ok('as is a patch on top of it', isNewer('1.0.1', '1.0'));
ok(
  'a published v1.0.0 is not offered to somebody running 1.0',
  newestIn([{ tag_name: 'v1.0.0', draft: false }], '1.0', false) === null,
);
ok(
  'a published v1.0 is offered to somebody running 0.1.2',
  newestIn([{ tag_name: 'v1.0', draft: false }], '0.1.2', false)?.version === '1.0',
);

// The names the release workflow actually produces, in the order GitHub lists
// them, so the choice of file is checked against a real release and not
// against a name made up for the test.
const realAssets = [
  'orbit-1.0-1-x86_64.pkg.tar.zst',
  'orbit-1.0-1.fc.x86_64.rpm',
  'orbit-1.0-1.x86_64.rpm',
  'Orbit-1.0-linux-portable.tar.gz',
  'Orbit-1.0-linux-x86_64.AppImage',
  'Orbit-1.0-windows-portable.zip',
  'Orbit-1.0-windows-setup.exe',
  'Orbit-1.0-windows.msi',
  'Orbit.exe',
  'orbit_1.0_amd64.deb',
  'orbit_1.0_debian_amd64.deb',
].map((name) => ({ name, browser_download_url: `https://example.com/${name}` }));

ok(
  'Windows takes the setup exe out of a real release',
  pickReleaseAsset(realAssets, 'Windows NT 10.0')?.name === 'Orbit-1.0-windows-setup.exe',
);
ok(
  'Linux takes the deb built on Ubuntu, not the Debian one',
  pickReleaseAsset(realAssets, 'Linux x86_64')?.name === 'orbit_1.0_amd64.deb',
);
ok(
  'the setup exe is not mistaken for the standalone program',
  !/^(?:Orbit\.exe|.*-standalone\.exe)$/i.test('Orbit-1.0-windows-setup.exe'),
);
ok(
  'the standalone program is recognised, so its page is opened instead',
  /^(?:Orbit\.exe|.*-standalone\.exe)$/i.test('Orbit.exe'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
