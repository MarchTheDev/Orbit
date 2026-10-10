/**
 * Run the checks in this folder.
 *
 * The app's own modules are TypeScript, and Node will not read those straight
 * out of the tree, so the test file is bundled first and then run. esbuild comes
 * with Vite, which is already a dependency, so this adds nothing to install.
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Written inside the project, so that `import 'jsdom'` in the bundle finds the
// copy that is installed here rather than looking next to a temporary folder.
const dir = path.join('.test-build');
mkdirSync(dir, { recursive: true });
const checks = [
  'tests/appearance.test.mjs',
  'tests/favorite-star.test.mjs',
  'tests/settings.test.mjs',
  'tests/markdown.test.mjs',
  'tests/markdownInput.test.mjs',
  'tests/playtime.test.mjs',
  'tests/movedGamePaths.test.mjs',
  'tests/move-job.test.mjs',
  'tests/session-error.test.mjs',
  'tests/storage-open.test.mjs',
  'tests/reader.test.mjs',
  'tests/editor.test.mjs',
  'tests/gameTitle.test.mjs',
  'tests/launcherGame.test.mjs',
  'tests/steam.test.mjs',
  'tests/updates.test.mjs',
  'tests/version.test.mjs',
  'tests/x11-entry.test.mjs',
  'tests/audio-deps.test.mjs',
  'tests/hover-tint.test.mjs',
];

try {
  for (const file of checks) {
    const out = path.join(dir, path.basename(file).replace('.test.mjs', '.mjs'));
    await build({
      entryPoints: [file],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: out,
      // Left to Node, so the bundle finds the copies installed here.
      external: ['jsdom', 'react', 'react-dom', 'react-dom/server', 'lucide-react'],
      jsx: 'automatic',
      logLevel: 'silent',
    });
    await import(pathToFileURL(path.resolve(out)).href);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Each check file adds to this rather than exiting on its own, so one failing
// file cannot stop the next one from being looked at.
const failed = globalThis.__orbitFailures ?? 0;
console.log(failed === 0 ? '\nevery check passed' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
