/** The Library is a focus workspace, not a modal-opened cover grid. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const workspace = readFileSync(path.join(root, 'src/components/LibraryWorkspace.tsx'), 'utf8');
const styles = readFileSync(path.join(root, 'src/index.css'), 'utf8');

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
check('the focus workspace has browse filters, game actions, metadata, and activity',
  ['library-filter-rail', 'library-game-profile', 'library-information-card', 'library-activity-card', 'library-inspector'].every((name) => workspace.includes(name)));
check('the library keeps both collection layouts and manual ordering', workspace.includes('<GameGrid') && workspace.includes('<GameList') && workspace.includes("sort === 'manual'"));
check('responsive multi-pane layout collapses for narrow windows', styles.includes('.library-workspace-grid') && styles.includes('@media (max-width: 760px)'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
