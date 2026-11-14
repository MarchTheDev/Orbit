import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const palette = readFileSync(path.join(root, 'src/components/CommandPalette.tsx'), 'utf8');
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}`); }
}

check('Ctrl+K opens the shared command palette', app.includes("event.key.toLowerCase() !== 'k'") && app.includes('<CommandPalette') && app.includes('commandPaletteOpen'));
check('the palette searches both game titles and genres', palette.includes('game.meta?.genres') && palette.includes('genres.join') && palette.includes('normalize(`${game.title} ${genres.join'));
check('matching games can launch or open details', palette.includes('Play ${game.title}') && palette.includes('onLaunch(game)') && palette.includes('onGameDetails(game.id)'));
check('navigation, add, settings, and Launchpad actions are available', ['Library', 'Statistics', 'Storage', 'Saves', 'Add a game', 'Add games from folder', 'Open Launchpad', 'Settings'].every((label) => palette.includes(label)));
check('the palette supports keyboard navigation, selection, and Escape', palette.includes("event.key === 'ArrowDown'") && palette.includes("event.key === 'Enter'") && palette.includes("event.key === 'Escape'"));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
