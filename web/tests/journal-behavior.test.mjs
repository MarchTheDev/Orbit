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
    datePicker.includes('--:--') && datePicker.includes('Clear time') && journal.includes("return 'No date'"));
check('starting a game writes a Started playing entry with the actual session start time',
  app.includes("addGameLog(g.id, started.startedAt, 0, 'Started playing', '')") &&
    app.indexOf("addGameLog(g.id, started.startedAt, 0, 'Started playing', '')") > app.indexOf('const started = await play(g.id);'));
check('the Journal and Logs list refresh after an automatic start entry is saved',
  journal.includes("addEventListener('orbit-journal-changed'") &&
    logs.includes("addEventListener('orbit-journal-changed'"));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
