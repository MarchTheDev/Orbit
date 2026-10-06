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
import { isNewer, versionOfRelease, newestIn } from '../src/services/updates.logic.ts';

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

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
