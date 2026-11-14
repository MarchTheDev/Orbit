import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}`); }
}

check('Back and Forward retain page, selected game, and library view', ['backHistory', 'forwardHistory', 'selectedId', 'page', 'view'].every((name) => app.includes(name)));
check('new visits clear the forward path and replay does not record itself', app.includes('historyReplay.current') && app.includes('forwardHistory.current = []') && app.includes('destination.current.push(current)'));
check('mouse Back/Forward and Alt+Arrow are handled without webview navigation', app.includes('event.button !== 3 && event.button !== 4') && app.includes("event.key === 'BrowserBack'") && app.includes("event.key === 'BrowserForward'") && app.includes('event.preventDefault()'));
check('page changes keep selected-game history available', !/setSelectedId\(null\);\s*\}, \[page\]\)/.test(app));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
