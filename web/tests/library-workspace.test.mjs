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
check('the Heronite-style window uses one hamburger navigation drawer across Orbit pages', app.includes('orbit-library-shell') && app.includes('onMenu={() => setNavOpen(true)}') && app.includes('className="orbit-page-menu"') && app.includes('drawerOpen={navOpen}') && styles.includes('.orbit-app-frame:not(.orbit-library-shell)'));
check('selecting a title updates the focus panel and the Grid drawer', workspace.includes('onClick={() => onSelect(game.id)}') && workspace.includes('onSelect={selectGame}'));
check('Focus follows Heronite’s grouped shelf, cover/actions, screenshots, overview, timeline, and details columns',
  ['library-game-browser', 'library-focus-game', 'library-journal-section', 'library-overview-card', 'library-timeline-section', 'library-focus-details'].every((name) => workspace.includes(name)));
check('the library provides Focus and cover Grid views with manual ordering', workspace.includes("setView('list')") && workspace.includes("setView('grid')") && workspace.includes('<GameGrid') && workspace.includes("sort === 'manual'"));
check('the screenshot strip shows this game’s Orbit captures and journal entries', workspace.includes('listGameLogs(selected.id)') && workspace.includes('overlayGallery()') && workspace.includes('gameCaptures.slice(0, 4)'));
check('Grid uses the full available width and reduces each tile to cover plus playtime', styles.includes('.orbit-library-shell') && styles.includes('.library-grid-page > .grid > div > p:first-of-type') && styles.includes('.library-grid-caption'));
check('responsive Focus and Grid layouts adapt to narrow windows', styles.includes('.library-focus-layout') && styles.includes('@media (max-width: 560px)'));
check('category shortcuts are removed from the top of the Library', !workspace.includes('className="library-filter-strip"'));
check('an empty filtered result can reset filters and search back to all games', workspace.includes('Show all games') && workspace.includes("setFilter('all'); setQuery('')"));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
