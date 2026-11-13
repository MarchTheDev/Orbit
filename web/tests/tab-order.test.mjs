/**
 * Default navigation keeps each collection, activity, and management category
 * together. Previously shipped defaults migrate, while a genuinely custom
 * order is retained exactly as the player arranged it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderedTabs } from '../src/components/TopNav.tsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const nav = readFileSync(path.join(root, 'web', 'src', 'components', 'TopNav.tsx'), 'utf8');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const tabs = nav.slice(nav.indexOf('export const TABS'), nav.indexOf('];'));
const groups = nav.slice(nav.indexOf('const GROUP_FOR'), nav.indexOf('};', nav.indexOf('const GROUP_FOR')));
const backlog = tabs.indexOf("id: 'backlog'");
const sessions = tabs.indexOf("id: 'sessions'");
const storage = tabs.indexOf("id: 'storage'");
const saves = tabs.indexOf("id: 'saves'");
check('Backlog, Sessions, and Journal share the Activity menu category', ["backlog: 'Activity'", "sessions: 'Activity'", "logs: 'Activity'"].every((entry) => groups.includes(entry)), groups);
check('Library stays in Collection and file management stays in Manage', groups.includes("library: 'Collection'") && groups.includes("storage: 'Manage'") && groups.includes("saves: 'Manage'"), groups);
check('Storage comes before Saves in the menu routes', storage !== -1 && saves !== -1 && storage < saves, tabs);

const ids = (order) => orderedTabs(order).map((tab) => tab.id);
const defaultIds = ids(undefined);
check('Collection is followed by Activity, then Manage', defaultIds.join() === 'library,backlog,sessions,logs,storage,saves');

const previousDefaults = [
  ['library', 'sessions', 'backlog', 'logs', 'storage', 'saves'],
  ['library', 'sessions', 'backlog', 'logs', 'saves', 'storage'],
];
for (const previous of previousDefaults) {
  check(`previous default ${previous.join(' → ')} migrates to the new default`, ids(previous).join() === defaultIds.join());
}

const custom = ['storage', 'logs', 'library', 'backlog', 'sessions', 'saves'];
check('a player-customized order is preserved', ids(custom).join() === custom.join());

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
