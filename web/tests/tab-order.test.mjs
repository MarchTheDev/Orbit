import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderedTabs } from '../src/components/TopNav.tsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const nav = readFileSync(path.join(root, 'web', 'src', 'components', 'TopNav.tsx'), 'utf8');
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
}

const tabs = nav.slice(nav.indexOf('export const TABS'), nav.indexOf('];'));
check('the main navigation has a single Statistics destination alongside Library', tabs.includes("id: 'library', label: 'Library'") && tabs.includes("id: 'sessions', label: 'Statistics'") && !tabs.includes("label: 'Backlog'") && !tabs.includes("label: 'Journal'") && !tabs.includes("label: 'Sessions'"), tabs);
check('the menu contains the requested add, folder, console, and settings actions', ['Add game', 'Add from folder', 'Console mode', 'Settings'].every((label) => nav.includes(label)));

const ids = (order) => orderedTabs(order).map((tab) => tab.id);
check('Library and Statistics are the default main menu order', ids().join() === 'library,sessions');
check('old saved orders resolve to the compact main menu', ids(['library', 'sessions', 'backlog', 'logs', 'storage', 'saves']).join() === 'library,sessions');
check('a customized ordering of the two main destinations is retained', ids(['sessions', 'library']).join() === 'sessions,library');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
