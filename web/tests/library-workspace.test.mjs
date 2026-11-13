import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const workspace = readFileSync(path.join(root, 'src/components/LibraryWorkspace.tsx'), 'utf8');
const styles = readFileSync(path.join(root, 'src/components/LibraryWorkspace.css'), 'utf8');
const stats = readFileSync(path.join(root, 'src/components/StatisticsView.tsx'), 'utf8');
const toolbar = readFileSync(path.join(root, 'src/components/Toolbar.tsx'), 'utf8');
const topNav = readFileSync(path.join(root, 'src/components/TopNav.tsx'), 'utf8');
const grid = readFileSync(path.join(root, 'src/components/GameGrid.tsx'), 'utf8');
let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}`); }
}

check('the app uses one shared Logo, hamburger, centered search, and sound top bar', app.includes('orbit-appbar') && app.includes('orbit-burger-button') && app.includes('orbit-appbar-search') && app.includes('orbit-appbar-actions'));
check('the hamburger offers Library, unified Statistics, add actions, Console mode, and Settings', ['onAddGame=', 'onAddFolder=', 'onConsole=', 'StatisticsView', 'setPage(next)'].every((name) => app.includes(name)) && ['Add game', 'Add from folder', 'Console mode', 'Settings'].every((name) => readFileSync(path.join(root, 'src/components/TopNav.tsx'), 'utf8').includes(name)));
check('Details and Grid open settings on a second click, without side carets', workspace.includes("setView('list')") && workspace.includes("setView('grid')") && workspace.includes("viewMenu === 'list'") && workspace.includes("viewMenu === 'grid'") && !workspace.includes('library-view-options') && !workspace.includes('ChevronDown size={13}'));
check('the library no longer offers status categories as filters', !toolbar.includes("id: 'playing'") && !toolbar.includes("id: 'completed'") && !toolbar.includes("id: 'dropped'") && toolbar.includes("id: 'favorites'"));
check('Grid settings persist labels, shape, tint, and details-on-select', ['orbit.grid-label', 'orbit.cover-shape', 'orbit.grid-open-on-select', 'Tint on hover', 'Open details on select'].every((name) => workspace.includes(name)) && ['GridLabel', 'CoverShape', 'wide', 'square'].every((name) => grid.includes(name) || workspace.includes(name)));
check('Details settings provide cover layout, size, and shape', workspace.includes('orbit.details-cover-size') && workspace.includes('Cover size') && workspace.includes('Cover shape'));
check('Settings is bottom-pinned in the hamburger menu', topNav.includes('orbit-menu-footer') && topNav.indexOf('orbit-menu-footer') > topNav.indexOf('orbit-menu-nav'));
check('the hamburger lines use a centered vertical stack', styles.includes('flex-direction: column') && styles.includes('align-items: center') && styles.includes('justify-content: center'));
check('Details can switch between cover rows and compact list rows', workspace.includes("setDetailLayout('covers')") && workspace.includes("setDetailLayout('list')") && styles.includes('.layout-list .library-mini-game'));
check('the Details page has overview, facts, HLTB, achievements, journal, and gallery sections', ['library-overview-panel', 'library-detail-facts', 'library-hltb-panel', 'library-achievements', 'library-activity-panel', 'library-gallery-panel'].every((name) => workspace.includes(name)));
check('Grid shows a cover shelf and a restyled selected-game details drawer', workspace.includes('<GameGrid') && workspace.includes('library-grid-drawer') && workspace.includes('library-drawer-actions'));
check('an empty filter or search can always be cleared back to the whole library', workspace.includes('Show all games') && workspace.includes("setFilter('all'); setQuery('')"));
check('Statistics is a single divided page containing sessions, backlog, journal, and a visual overview', ['id: \'overview\'', 'id: \'sessions\'', 'id: \'backlog\'', 'id: \'journal\'', 'statistics-chart', 'Top games'].every((name) => stats.includes(name)));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
