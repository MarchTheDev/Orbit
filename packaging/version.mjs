#!/usr/bin/env node
/**
 * Put one version everywhere it is written down.
 *
 * The number on a release, the number inside the app, and the number on the
 * files in that release are the same number, and the only place it is typed is
 * the VERSION file at the top of the repository. The release workflow runs this
 * before it builds, so the bundles are named and stamped with the version it
 * was told to build rather than with whatever was left in the tree.
 *
 * The number is a label, and a label can be short. `1.0` is a perfectly good
 * thing to call a release, but Cargo, npm and Tauri all want three parts, so a
 * label of two becomes `1.0.0` for those three and their lock files, while the
 * label itself is what the app shows, what the tag is called and what the files
 * in the release are named. Writing `1.0.0` into Cargo.toml is not a lie: it is
 * the same release, in the form the tooling insists on.
 *
 * Each file keeps its own formatting: these are edits, not rewrites, so a
 * version bump is one line in a diff and not a reformatted Cargo.toml.
 *
 *   node packaging/version.mjs 1.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Read a label off the command line.
 *
 * Two or three numbers, an optional `v`, and an optional pre-release or build
 * suffix. Returns null for anything else, which is how the caller knows to
 * print its usage line rather than stamp a half-understood number into four
 * files.
 */
export function parseVersion(input) {
  const raw = String(input ?? '')
    .trim()
    .replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?([-+][0-9A-Za-z.-]+)?$/.exec(raw);
  if (!match) return null;
  const [, major, minor, patch, suffix = ''] = match;
  // The label is what was typed, with a leading zero or two left alone; the
  // semver is the same number padded out to the three parts the tooling wants.
  const label = `${major}.${minor}${patch === undefined ? '' : `.${patch}`}${suffix}`;
  const semver = `${major}.${minor}.${patch ?? 0}${suffix}`;
  return { label, semver };
}

/** The files the semver is written into, and the one place each keeps it. */
export const SEMVER_FILES = [
  'web/src-tauri/tauri.conf.json',
  'web/package.json',
  'web/src-tauri/Cargo.toml',
  'web/src-tauri/Cargo.lock',
  'web/package-lock.json',
];

/** What a label and its semver are written into, as file and pattern pairs. */
const writes = [
  ['web/src-tauri/tauri.conf.json', /("version"\s*:\s*")[^"]*(")/],
  ['web/package.json', /("version"\s*:\s*")[^"]*(")/],
  ['web/src-tauri/Cargo.toml', /^(version\s*=\s*")[^"]*(")/m],
  // The Rust lock file records the version of the crate itself. Only the
  // crate's own entry is touched; dependency versions remain Cargo's business.
  ['web/src-tauri/Cargo.lock', /(\[\[package\]\]\nname = "orbit"\nversion = ")[^"]*(")/],
];

/**
 * The two places a lock file carries the package's own version, at the head of
 * the file and in the entry for the folder itself. Leaving them behind makes
 * `npm ci` disagree with `package.json` about what is being built. Nothing else
 * in the lock is touched: every dependency has a version of its own, and those
 * are npm's business.
 */
const lockWrites = [
  [/^(\{\s*"name":\s*"orbit",\s*"version":\s*")[^"]*(")/m],
  [/("":\s*\{\s*"name":\s*"orbit",\s*"version":\s*")[^"]*(")/],
];

/**
 * Write the version down, and say what moved.
 *
 * Exported so the check in `web/tests` can run it against a copy of the real
 * files rather than against a second copy of this logic.
 */
export function main(argv, root) {
  const parsed = parseVersion(argv[2]);
  if (!parsed) {
    console.error(
      `usage: node packaging/version.mjs 1.0   (got "${argv[2] ?? ''}")`,
    );
    return 1;
  }
  const { label, semver } = parsed;
  const changed = [];

  for (const [file, pattern] of writes) {
    const full = path.join(root, file);
    const before = readFileSync(full, 'utf8');
    const after = before.replace(pattern, `$1${semver}$2`);
    if (after !== before) changed.push(file);
    writeFileSync(full, after);
  }

  const lock = path.join(root, 'web/package-lock.json');
  const lockBefore = readFileSync(lock, 'utf8');
  let lockAfter = lockBefore;
  for (const [pattern] of lockWrites) {
    lockAfter = lockAfter.replace(pattern, `$1${semver}$2`);
  }
  if (lockAfter !== lockBefore) {
    writeFileSync(lock, lockAfter);
    changed.push('web/package-lock.json');
  }

  // The label, not the semver: this file is what the release is called.
  const versionFile = path.join(root, 'VERSION');
  const current = readFileSync(versionFile, 'utf8').trim();
  if (current !== label) {
    writeFileSync(versionFile, `${label}\n`);
    changed.push('VERSION');
  }

  if (changed.length === 0) {
    console.log(`Already ${label}.`);
  } else {
    const padded = label === semver ? '' : ` (${semver} for Cargo, npm and Tauri)`;
    console.log(`Orbit ${label}${padded} in ${changed.join(', ')}.`);
  }
  return 0;
}

// Only when run as a program: importing this file must not go and edit four
// files, which is what lets the check in web/tests read the helpers above.
const invoked =
  !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invoked) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = main(process.argv, root);
}
