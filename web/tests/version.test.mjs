/**
 * The release label.
 *
 * `1.0` is what the release is called and what the app says it is, while
 * Cargo, npm and Tauri want three parts and get `1.0.0`. The check runs the
 * real script against copies of the real files, so what is tested is the thing
 * the release workflow runs and not a description of it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, parseVersion, SEMVER_FILES } from '../../packaging/version.mjs';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('reading a version label');
const short = parseVersion('1.0');
check('1.0 is accepted', short !== null);
check('1.0 stays the label', short?.label === '1.0', `got ${short?.label}`);
check('1.0 becomes 1.0.0 for the tooling', short?.semver === '1.0.0', `got ${short?.semver}`);

const full = parseVersion('1.2.3');
check('1.2.3 is accepted', full !== null);
check('1.2.3 is its own label', full?.label === '1.2.3', `got ${full?.label}`);
check('1.2.3 needs no padding', full?.semver === '1.2.3', `got ${full?.semver}`);

check('a leading v is dropped', parseVersion('v2.1')?.label === '2.1');
check('surrounding spaces are dropped', parseVersion('  1.0  ')?.label === '1.0');
check('a patch of 0 is kept, not padded away', parseVersion('1.0.0')?.semver === '1.0.0');
check('ten is not read as one', parseVersion('1.10')?.semver === '1.10.0');

const pre = parseVersion('1.1-beta.2');
check('a pre-release is carried', pre?.label === '1.1-beta.2', `got ${pre?.label}`);
check('and padded in front of the suffix', pre?.semver === '1.1.0-beta.2', `got ${pre?.semver}`);

check('a word is refused', parseVersion('banana') === null);
check('an empty line is refused', parseVersion('') === null);
check('nothing is refused', parseVersion(undefined) === null);
check('one number is refused', parseVersion('1') === null);
check('a trailing dot is refused', parseVersion('1.0.') === null);

/**
 * The top of the repository.
 *
 * The checks run from `web/`, but the files this one needs are above it, and
 * the bundle's own location is a temporary folder that says nothing about
 * either. So the tree is walked upwards until a folder holds both the VERSION
 * file and the front end, which is the top by definition.
 */
function findRepoRoot() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'VERSION')) && existsSync(path.join(dir, 'web/package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }
  throw new Error('the repository root was not found above ' + process.cwd());
}

/** A copy of the files the script writes, so the real tree is left alone. */
const repo = findRepoRoot();
const tmp = mkdtempSync(path.join(os.tmpdir(), 'orbit-version-'));
try {
  console.log('\nwriting the version into the files');
  const wanted = ['VERSION', ...SEMVER_FILES];
  for (const file of wanted) {
    const from = path.join(repo, file);
    const to = path.join(tmp, file);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(from, 'utf8'));
  }
  const read = (file) => readFileSync(path.join(tmp, file), 'utf8');
  const run = (label) => main(['node', 'version.mjs', label], tmp);

  // A dependency's own version, which must survive every bump untouched.
  const lockBefore = read('web/package-lock.json');
  const cargoBefore = read('web/src-tauri/Cargo.lock');

  check('a short label is accepted', run('1.0') === 0);
  check('VERSION keeps the label as typed', read('VERSION').trim() === '1.0', `got ${read('VERSION').trim()}`);
  check('Tauri gets the padded number', /"version"\s*:\s*"1\.0\.0"/.test(read('web/src-tauri/tauri.conf.json')));
  check('npm gets the padded number', /"version"\s*:\s*"1\.0\.0"/.test(read('web/package.json')));
  check('Cargo gets the padded number', /^version\s*=\s*"1\.0\.0"/m.test(read('web/src-tauri/Cargo.toml')));
  check('the Rust lock gets the padded number',
    /\[\[package\]\]\nname = "orbit"\nversion = "1\.0\.0"/.test(read('web/src-tauri/Cargo.lock')));
  check('the npm lock gets the padded number, twice',
    (read('web/package-lock.json').match(/"version":\s*"1\.0\.0"/g) ?? []).length >= 2);

  check('a full label is written everywhere', run('1.2.3') === 0);
  check('VERSION takes the full label', read('VERSION').trim() === '1.2.3');
  check('Tauri follows', /"version"\s*:\s*"1\.2\.3"/.test(read('web/src-tauri/tauri.conf.json')));
  check('Cargo follows', /^version\s*=\s*"1\.2\.3"/m.test(read('web/src-tauri/Cargo.toml')));

  check('a short label puts the padding back', run('1.0') === 0);
  check('and the label stays short', read('VERSION').trim() === '1.0');
  check('Tauri is back to 1.0.0', /"version"\s*:\s*"1\.0\.0"/.test(read('web/src-tauri/tauri.conf.json')));

  console.log('\nleaving what is not Orbit alone');
  const lockAfter = read('web/package-lock.json');
  const cargoAfter = read('web/src-tauri/Cargo.lock');
  const countOf = (text, pattern) => (text.match(pattern) ?? []).length;
  const npmVersions = /"version":/g;
  const crateVersions = /^version = /gm;
  check('no dependency version was rewritten in the npm lock',
    countOf(lockAfter, npmVersions) === countOf(lockBefore, npmVersions),
    `${countOf(lockBefore, npmVersions)} before, ${countOf(lockAfter, npmVersions)} after`);
  check('no crate version was rewritten in the Rust lock',
    countOf(cargoAfter, crateVersions) === countOf(cargoBefore, crateVersions),
    `${countOf(cargoBefore, crateVersions)} before, ${countOf(cargoAfter, crateVersions)} after`);

  console.log('\nrefusing to guess');
  const before = read('VERSION');
  check('a word is refused', run('banana') === 1);
  check('and nothing was written', read('VERSION') === before);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
