/**
 * Saves sits before Storage.
 *
 * That is the default list, and a saved copy of the previous default is the
 * list rather than a choice, so it follows.
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
const saves = tabs.indexOf("id: 'saves'");
const storage = tabs.indexOf("id: 'storage'");
check('Saves is defined before Storage', saves !== -1 && storage !== -1 && saves < storage, tabs);

const ids = (order) => orderedTabs(order).map((tab) => tab.id);
check('the default puts Saves before Storage', ids(undefined).indexOf('saves') < ids(undefined).indexOf('storage'));
check(
  'the old default is not kept',
  ids(['library', 'sessions', 'backlog', 'logs', 'storage', 'saves']).indexOf('saves') <
    ids(['library', 'sessions', 'backlog', 'logs', 'storage', 'saves']).indexOf('storage'),
);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
