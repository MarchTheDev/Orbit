/**
 * The X11 entry point, and the four packages that have to carry it.
 *
 * `orbit-x11` is not a second build: it is the same binary with GDK_BACKEND set
 * before GDK starts. That makes the wiring the fragile part rather than the
 * code, because nothing fails loudly when a package quietly stops shipping the
 * wrapper — the menu entry just is not there. So every path that has to include
 * it is checked here: Arch, the deb, the rpm and the portable tarball.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('the X11 wrapper');

const wrapper = read('packaging', 'linux', 'orbit-x11');
const mode = statSync(path.join(root, 'packaging', 'linux', 'orbit-x11')).mode;

check('it sets GDK_BACKEND to x11', /GDK_BACKEND=x11/.test(wrapper));
// The exact line that does the work, so a rewrite cannot quietly turn it into
// a second binary or drop the passthrough.
check('it runs the one binary with the variable set',
  /^exec env GDK_BACKEND=x11 orbit "\$@"$/m.test(wrapper),
  wrapper.split('\n').filter((line) => line.startsWith('exec')).join(' | '));
// Without exec, a failure in orbit would leave the wrapper sitting in the
// process table as the parent of a program that has already gone.
check('it execs rather than waits', /^exec /m.test(wrapper));
check('it passes arguments through', /\$\@/.test(wrapper));
check('it is executable', (mode & 0o111) !== 0, `mode ${(mode & 0o777).toString(8)}`);
check('it is a shell script, so no build step is needed', wrapper.startsWith('#!'));

console.log('its menu entry');

const entry = read('packaging', 'linux', 'orbit-x11.desktop');
// Calls `env` rather than the wrapper, so the entry still works if a package
// lost the executable bit on the way in.
check('it sets the variable itself', /^Exec=env GDK_BACKEND=x11 orbit$/m.test(entry));
check('it is named apart from the ordinary entry', /^Name=Orbit \(X11\)$/m.test(entry));
check('it reuses the same icon', /^Icon=orbit$/m.test(entry));
check('it does not open a terminal', /^Terminal=false$/m.test(entry));

console.log('every Linux package carries it');

const pkgbuild = read('packaging', 'arch', 'PKGBUILD');
check('Arch lists both in its sources', /source=\([^)]*'orbit-x11'[^)]*'orbit-x11\.desktop'[^)]*\)/.test(pkgbuild));
check('Arch installs the wrapper executable', /install -Dm755 "\$srcdir\/orbit-x11" "\$pkgdir\/usr\/bin\/orbit-x11"/.test(pkgbuild));
check('Arch installs the menu entry', /install -Dm644 "\$srcdir\/orbit-x11\.desktop" "\$pkgdir\/usr\/share\/applications\/orbit-x11\.desktop"/.test(pkgbuild));
// makepkg refuses to build when these two arrays disagree, and it only finds
// out in the release job.
const list = (name) => (pkgbuild.match(new RegExp(`^${name}=\\((.*)\\)$`, 'm'))?.[1] ?? '')
  .split("'").filter((part) => part.trim() && part.trim() !== ' ');
const archSources = list('source');
const archSums = list('sha256sums');
check('Arch has one checksum per source', archSums.length === archSources.length && archSources.length > 0,
  `${archSources.length} sources, ${archSums.length} checksums`);

// The map is { path inside the package: file on disk }. Read from the bundler
// this repo actually pins (@tauri-apps/cli 2.12.1): fs_utils::copy_custom_files
// iterates (pkg_path, path) and rpm.rs iterates (rpm_path, src_path). The
// example in Tauri's own config schema shows it the other way round and is
// wrong — writing it that way fails every Linux job at bundling time with
// "Failed to copy custom files: /usr/bin/orbit-x11 does not exist".
const tauri = JSON.parse(read('web', 'src-tauri', 'tauri.conf.json'));
for (const kind of ['deb', 'rpm']) {
  const files = tauri.bundle?.linux?.[kind]?.files ?? {};
  check(`${kind} ships the wrapper to /usr/bin`, files['/usr/bin/orbit-x11'] === '../../packaging/linux/orbit-x11', JSON.stringify(files));
  check(`${kind} ships the menu entry`, files['/usr/share/applications/orbit-x11.desktop'] === '../../packaging/linux/orbit-x11.desktop');
  // A source that does not exist is exactly what breaks the bundler, and it
  // reads as a typo rather than a wiring mistake when it does.
  for (const [target, source] of Object.entries(files)) {
    check(`${kind}: ${target} exists in the repo`, existsSync(path.join(root, 'web', 'src-tauri', source)), source);
  }
}

const release = read('.github', 'workflows', 'release.yml');
check('the Arch job copies both beside the PKGBUILD',
  /cp packaging\/linux\/orbit-x11 "\$work\/orbit-x11"/.test(release) &&
  /cp packaging\/linux\/orbit-x11\.desktop "\$work\/orbit-x11\.desktop"/.test(release));
check('the portable tarball carries both',
  /cp packaging\/linux\/orbit-x11 "\$portable\/orbit-x11"/.test(release) &&
  /cp packaging\/linux\/orbit-x11\.desktop "\$portable\/orbit-x11\.desktop"/.test(release));

console.log('nothing forces X11 on anybody who did not ask');

const desktop = read('packaging', 'linux', 'orbit.desktop');
check('the ordinary entry has no GDK_BACKEND in it', !/GDK_BACKEND/.test(desktop));
check('the ordinary entry still just runs orbit', /^Exec=orbit$/m.test(desktop));
const sources = read('web', 'src-tauri', 'src', 'lib.rs') + read('web', 'src-tauri', 'src', 'launch.rs');
check('the program does not set the backend itself', !/GDK_BACKEND/.test(sources));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
