/** The Library is a focus workspace, not a modal-opened cover grid. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const workspace = readFileSync(path.join(root, 'src/components/LibraryWorkspace.tsx'), 'utf8');
const styles = readFileSync(path.join(root, 'src/components/LibraryWorkspace.css'), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`);
  }
}

check('the app mounts the new Library workspace', app.includes("import { LibraryWorkspace } from './components/LibraryWorkspace'") && app.includes('<LibraryWorkspace'));
check('selecting a cover changes focus without forcing the legacy details drawer open', app.includes('detailOpen && (') && workspace.includes('onSelect={onSelect}'));
check('the Focus workspace has filters, game actions, screenshots, overview, and timeline',
  ['library-browser-filters', 'library-focus-game', 'library-media-strip', 'library-overview-card', 'library-timeline-card'].every((name) => workspace.includes(name)));
check('the library provides Focus and cover Grid views with manual ordering', workspace.includes("setView('list')") && workspace.includes("setView('grid')") && workspace.includes('<GameGrid') && workspace.includes("sort === 'manual'"));
check('the screenshot strip shows this game’s Orbit captures and journal entries', workspace.includes('listGameLogs(selected.id)') && workspace.includes('overlayGallery()') && workspace.includes('gameCaptures.slice(0, 4)'));
check('responsive multi-pane layout collapses for narrow windows', styles.includes('.library-focus-layout') && styles.includes('@media (max-width: 650px)'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
