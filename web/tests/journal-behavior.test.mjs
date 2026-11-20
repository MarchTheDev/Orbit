import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const journal = readFileSync(new URL('../src/components/detail/GameLogView.tsx', import.meta.url), 'utf8');
const datePicker = readFileSync(new URL('../src/components/ui/DateTimePicker.tsx', import.meta.url), 'utf8');
const logs = readFileSync(new URL('../src/components/LogsView.tsx', import.meta.url), 'utf8');

let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

console.log('Journal entries and game starts');
check('new Journal entries leave the calendar and play duration blank',
  journal.includes("const blank = (): Draft => ({ id: null, at: '', secs: '', note: '', details: '' });"));
check('the single calendar requires a day and makes clock time and play duration optional',
  journal.includes('Day (required) · time optional') && journal.includes('optionalTime') &&
    journal.includes("if (!draft.at.trim())") && journal.includes('fromLocalInput(draft.at)') &&
    journal.includes("draft.secs.trim() === '' ? 0 : parseDuration(draft.secs)") &&
    journal.includes("row.at > 0 ? toLocalInput(row.at) : ''") &&
    datePicker.includes('--:--') && datePicker.includes('Clear time') && datePicker.includes('const selectedDate = parseValue(value)') && datePicker.includes('const hasTime = Boolean(selectedDate') && journal.includes("return 'No date'"));
// The Journal belongs to the player. Orbit writes one line on the very first
// launch of a game (in the backend) and never again - least of all one per
// press of Play, which used to fill the page with the same sentence.
check('starting a game never writes a Started playing entry of its own',
  !app.includes("'Started playing'") && !app.includes('addGameLog') &&
    app.includes("dispatchEvent(new Event('orbit-journal-changed'))"));
check('the Journal and Logs list refresh after an automatic start entry is saved',
  journal.includes("addEventListener('orbit-journal-changed'") &&
    logs.includes("addEventListener('orbit-journal-changed'"));
check('the Journal uses one add-games control: the plus beside search',
  logs.includes('aria-label="Add games to the Journal"') &&
    logs.includes('Use + beside the game search to add games to the Journal.') &&
    !logs.includes('> Add games</button>'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
