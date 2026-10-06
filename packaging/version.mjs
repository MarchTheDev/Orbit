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
