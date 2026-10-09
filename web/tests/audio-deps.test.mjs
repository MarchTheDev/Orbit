/**
 * The sound, and the packages that have to make it possible.
 *
 * Orbit's music is synthesized in the page with the Web Audio API, and on Linux
 * WebKit hands that to GStreamer: `webkitwebaudiosrc ! audioconvert !
 * audioresample ! autoaudiosink`. When autoaudiosink cannot be created, WebKit
 * logs one line and returns — the AudioContext still exists and still looks
 * healthy, so nothing in the app can notice. Silence is the only symptom, and
 * the packages are the only place it can be fixed.
 *
 * So what is checked here is the packaging: that each package asks for the
 * plugins, and that the names it asks for are ones the distribution has.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

console.log('the sound is synthesized, so no decoder is needed');

const ambient = read('web', 'src', 'services', 'ambient.ts');
check('the music comes from an AudioContext', /new Ctor\(\)|AudioContext/.test(ambient));
const frontEnd = ['web/src/services/ambient.ts', 'web/src/App.tsx', 'web/src/components/MusicButton.tsx']
  .map((file) => read(...file.split('/')))
  .join('\n');
// If a media file is ever added, base and good will no longer be enough: it
// would need a decoder, and the silence would come back looking identical.
check('nothing plays a media file', !/<audio|new Audio\(|<video|\.src\s*=\s*['"][^'"]*\.(mp3|ogg|wav|m4a)/.test(frontEnd));

console.log('every package asks for the plugins');

const pkgbuild = read('packaging', 'arch', 'PKGBUILD');
const dependsLine = pkgbuild.match(/^depends=\(([^)]*)\)/m)?.[1] ?? '';
for (const want of ['gst-plugins-base', 'gst-plugins-good', 'gst-plugin-pipewire']) {
  check(`Arch asks for ${want}`, new RegExp(`'${want}'`).test(dependsLine), dependsLine.trim());
}

const tauri = JSON.parse(read('web', 'src-tauri', 'tauri.conf.json'));
for (const want of ['gstreamer1.0-plugins-base', 'gstreamer1.0-plugins-good', 'gstreamer1.0-pipewire']) {
  check(`the deb asks for ${want}`, (tauri.bundle?.linux?.deb?.depends ?? []).includes(want),
    JSON.stringify(tauri.bundle?.linux?.deb?.depends));
}
for (const want of ['gstreamer1-plugins-base', 'gstreamer1-plugins-good', 'pipewire-gstreamer']) {
  check(`the rpm asks for ${want}`, (tauri.bundle?.linux?.rpm?.depends ?? []).includes(want),
    JSON.stringify(tauri.bundle?.linux?.rpm?.depends));
}

// Tauri's CLI starts depends_deb from this config and pushes libwebkit2gtk-4.1-0
// and libgtk-3-0 onto it, so naming them here would only repeat what the
// bundler is about to add.

console.log('the release checks the names against real repositories');

const checker = path.join(root, 'packaging', 'linux', 'check-deps.sh');
check('it exists', existsSync(checker));
check('it is executable', (statSync(checker).mode & 0o111) !== 0);

const sandbox = path.join(tmpdir(), `orbit-deps-${process.pid}`);
const bin = path.join(sandbox, 'bin');
mkdirSync(bin, { recursive: true });

// Stand-ins for the three package managers. They are deliberately dumb: the
// package file is a text file holding the dependencies, and a name containing
// "missing" is one the repository does not have.
const stub = (name, body) => {
  const at = path.join(bin, name);
  writeFileSync(at, `#!/bin/sh\n${body}\n`);
  chmodSync(at, 0o755);
};
stub('dpkg-deb', 'cat "$2"');
stub('rpm', 'cat "$3"');
stub('tar', 'cat "$2"');
stub('apt-get', 'for a in "$@"; do case "$a" in *missing*) exit 100;; esac; done; exit 0');
stub('dnf', 'for a in "$@"; do case "$a" in *missing*) exit 0;; esac; done; echo "gstreamer1-plugins-good-1.24.0-1.fc42.x86_64"');
stub('pacman', 'for a in "$@"; do case "$a" in *missing*) exit 1;; esac; done; echo "https://mirror/gst-plugins-good.pkg.tar.zst"');

const write = (name, text) => {
  const at = path.join(sandbox, name);
  writeFileSync(at, text);
  return at;
};
const run = (args) => {
  try {
    return {
      code: 0,
      out: execFileSync(checker, args, {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }),
    };
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
};

const GOOD = ['gst-plugins-base', 'gst-plugins-good', 'gst-plugin-pipewire'];
const pkginfo = (names) => names.map((n) => `depend = ${n}`).join('\n');

const pacmanOk = run(['The Arch package', 'pacman', write('good.pkg.tar.zst', pkginfo(GOOD)), ...GOOD]);
check('a package asking for real plugins passes', pacmanOk.code === 0, pacmanOk.out);
check('it says so in a notice', /::notice title=The Arch package::/.test(pacmanOk.out), pacmanOk.out);

const pacmanGap = run(['The Arch package', 'pacman', write('gap.pkg.tar.zst', pkginfo(GOOD.slice(0, 2))), ...GOOD]);
check('a package that never declared one fails', pacmanGap.code === 1, pacmanGap.out);
check('it names the one that is missing', /gst-plugin-pipewire is not among the dependencies/.test(pacmanGap.out), pacmanGap.out);

const pacmanTypo = run(['The Arch package', 'pacman', write('typo.pkg.tar.zst', pkginfo([...GOOD, 'gst-plugins-missing'])), ...GOOD, 'gst-plugins-missing']);
check('a plugin no repository has fails', pacmanTypo.code === 1, pacmanTypo.out);
check('it says the repository does not have it', /nothing in the repositories provides/.test(pacmanTypo.out), pacmanTypo.out);

const debOk = run(['The deb', 'apt', write('good.deb', ['libwebkit2gtk-4.1-0', 'libgtk-3-0',
  'gstreamer1.0-plugins-base', 'gstreamer1.0-plugins-good', 'gstreamer1.0-pipewire'].join(', ')),
  'gstreamer1.0-plugins-base', 'gstreamer1.0-plugins-good', 'gstreamer1.0-pipewire']);
check('a deb declaring them all passes', debOk.code === 0, debOk.out);

const debTypo = run(['The deb', 'apt', write('typo.deb', 'gstreamer1.0-plugins-good, gstreamer1.0-missing'),
  'gstreamer1.0-plugins-good', 'gstreamer1.0-missing']);
check('a deb naming a package apt cannot install fails', debTypo.code === 1, debTypo.out);
check('it blames the install rather than the listing', /apt cannot install/.test(debTypo.out), debTypo.out);

const rpmOk = run(['The Fedora rpm', 'dnf', write('good.rpm', ['libwebkit2gtk-4.1.so.0()(64bit)',
  'gstreamer1-plugins-base', 'gstreamer1-plugins-good', 'pipewire-gstreamer'].join('\n')),
  'gstreamer1-plugins-base', 'gstreamer1-plugins-good', 'pipewire-gstreamer']);
check('an rpm declaring them all passes', rpmOk.code === 0, rpmOk.out);

const rpmTypo = run(['The Fedora rpm', 'dnf', write('typo.rpm', 'gstreamer1-plugins-missing'), 'gstreamer1-plugins-missing']);
check('an rpm naming something dnf cannot find fails', rpmTypo.code === 1, rpmTypo.out);

check('an unknown package manager is refused', run(['x', 'yum', write('any', ''), 'a']).code === 2);
check('too few arguments is refused', run(['x', 'apt', 'y']).code === 2);

const release = read('.github', 'workflows', 'release.yml');
check('the Ubuntu-built deb is checked against Ubuntu',
  /check-deps\.sh "The deb" apt .*gstreamer1\.0-pipewire/s.test(release));
check('the Debian deb is checked in Debian',
  /check-deps\.sh "The Debian deb" apt/.test(release));
check('the Fedora rpm is checked in Fedora',
  /check-deps\.sh "The Fedora rpm" dnf .*pipewire-gstreamer/s.test(release));
check('the Arch package is checked in Arch',
  /check-deps\.sh "The Arch package" pacman .*gst-plugin-pipewire/s.test(release));

console.log('the one package that cannot ask, tells you instead');

// A tarball has no dependency field, so the note inside it is the only thing
// that can reach somebody whose sound is silent.
const note = read('packaging', 'linux', 'portable-readme.txt');
for (const want of ['gst-plugins-good', 'gstreamer1.0-plugins-good', 'gstreamer1-plugins-good']) {
  check(`the note names ${want}`, note.includes(want));
}
check('the note explains how to tell', note.includes('gst-inspect-1.0 autoaudiosink'));
check('the tarball carries the note', /cp packaging\/linux\/portable-readme\.txt "\$portable\/README\.txt"/.test(release));
check('the release checks it got in', /README\\\.txt\$/.test(release));

rmSync(sandbox, { recursive: true, force: true });

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
