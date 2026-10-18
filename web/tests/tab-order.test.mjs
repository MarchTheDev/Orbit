/**
 * Journal sits before Backlog in the default tab order.
 *
 * The two previously shipped defaults are migrated, while a genuinely custom
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
const journal = tabs.indexOf("id: 'logs'");
const backlog = tabs.indexOf("id: 'backlog'");
const saves = tabs.indexOf("id: 'saves'");
const storage = tabs.indexOf("id: 'storage'");
check('Journal is defined before Backlog', journal !== -1 && backlog !== -1 && journal < backlog, tabs);
check('Saves is defined before Storage', saves !== -1 && storage !== -1 && saves < storage, tabs);

const ids = (order) => orderedTabs(order).map((tab) => tab.id);
const defaultIds = ids(undefined);
check('the default puts Journal before Backlog', defaultIds.indexOf('logs') < defaultIds.indexOf('backlog'));
check('the default puts Saves before Storage', defaultIds.indexOf('saves') < defaultIds.indexOf('storage'));

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
