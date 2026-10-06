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
 * Each file keeps its own formatting: these are edits, not rewrites, so a
 * version bump is one line in a diff and not a reformatted Cargo.toml.
 *
 *   node packaging/version.mjs 0.2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wanted = (process.argv[2] ?? '').trim().replace(/^v/i, '');

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(wanted)) {
  console.error(`usage: node packaging/version.mjs 0.2.0   (got "${process.argv[2] ?? ''}")`);
  process.exit(1);
}

const changed = [];
const stringify = (file, pattern, replace) => {
  const full = path.join(root, file);
  const before = readFileSync(full, 'utf8');
  const after = before.replace(pattern, replace);
  if (after !== before) changed.push(file);
  writeFileSync(full, after);
};

stringify('web/src-tauri/tauri.conf.json', /("version"\s*:\s*")[^"]*(")/, `$1${wanted}$2`);
stringify('web/package.json', /("version"\s*:\s*")[^"]*(")/, `$1${wanted}$2`);
stringify('web/src-tauri/Cargo.toml', /^(version\s*=\s*")[^"]*(")/m, `$1${wanted}$2`);

// The Rust lock file records the version of the crate itself. Only the crate's
// own entry is touched; dependency versions remain Cargo's business.
stringify(
  'web/src-tauri/Cargo.lock',
  /(\[\[package\]\]\nname = "orbit"\nversion = ")[^"]*(")/,
  `$1${wanted}$2`,
);

// The lock file carries the package's own version in two places, and leaving
// them behind makes `npm ci` disagree with `package.json` about what is being
// built. Only the first two lines of the file are touched: every dependency has
// a version of its own, and those are npm's business.
// A lock file records the package's own version twice, at the head and in the
// entry for the folder itself, and leaving those behind makes `npm ci` disagree
// with `package.json` about what is being built. Nothing else in the lock is
// touched: every dependency has a version of its own, and those are npm's.
const lock = path.join(root, 'web/package-lock.json');
const lockBefore = readFileSync(lock, 'utf8');
const lockAfter = lockBefore
  .replace(/^(\{\s*"name":\s*"orbit",\s*"version":\s*")[^"]*(")/m, `$1${wanted}$2`)
  .replace(/("":\s*\{\s*"name":\s*"orbit",\s*"version":\s*")[^"]*(")/, `$1${wanted}$2`);
if (lockAfter !== lockBefore) {
  writeFileSync(lock, lockAfter);
  changed.push('web/package-lock.json');
}

const versionFile = path.join(root, 'VERSION');
const current = readFileSync(versionFile, 'utf8').trim();
if (current !== wanted) {
  writeFileSync(versionFile, `${wanted}\n`);
  changed.push('VERSION');
}

console.log(
  changed.length === 0
    ? `Already ${wanted}.`
    : `Orbit ${wanted} in ${changed.join(', ')}.`,
);
