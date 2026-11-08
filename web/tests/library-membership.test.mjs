import { readFileSync } from 'node:fs';
import { inLibraryShelf, libraryCount, onBacklogPage, onJournalPage } from '../src/utils/library.ts';

let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

const installed = {
  id: 'installed', planned: false, inLibrary: true, installDir: 'D:/Games/Title', exePath: null,
  launch: { kind: 'none' }, sessionCount: 0, sizeBytes: 0, manualPlaySecs: 0,
};
const titleOnly = {
  id: 'title-only', planned: false, inLibrary: true, installDir: null, exePath: null,
  launch: { kind: 'none' }, sessionCount: 0, sizeBytes: 0, manualPlaySecs: 0,
};
const backlogOnly = {
  id: 'backlog-only', planned: false, inLibrary: false, installDir: null, exePath: null,
  launch: { kind: 'none' }, sessionCount: 0, sizeBytes: 0, manualPlaySecs: 0,
};
const planned = { ...backlogOnly, id: 'planned', planned: true };

console.log('Library and Backlog membership');
check('Library games only join the Backlog when membership was recorded on addition', !onBacklogPage(installed, true) && onBacklogPage(installed, false, ['installed']));
check('title-only Library entries use the same persistent membership rule', !onBacklogPage(titleOnly, true) && onBacklogPage(titleOnly, false, ['title-only']));
check('owned Backlog-only games stay there when sync is off', onBacklogPage(backlogOnly, false));
check('manual removal wins even when sync is on', !onBacklogPage(installed, true, [], ['installed']));
check('manual addition works even when sync is off', onBacklogPage(installed, false, ['installed'], []));
check('plans do not count as Library games or synced Backlog entries', !inLibraryShelf(planned) && !onBacklogPage(planned, true));
check('the Library count excludes a planned-only Backlog record', libraryCount([installed, planned]) === 1);
check('Journal membership remains after sync is turned off', onJournalPage(installed, false, ['installed']));
check('a new game without saved Journal membership stays out when sync is off', !onJournalPage(installed, false));
check('manual Journal membership works with sync off', onJournalPage(installed, false, ['installed']));
check('manual Journal removal wins with sync on', !onJournalPage(installed, true, [], ['installed']));
check('planned-only Backlog records can never appear in the Journal', !onJournalPage(planned, true, ['planned']));
check('Backlog-only owned records cannot appear in the Journal', !onJournalPage(backlogOnly, true, ['backlog-only']));
const backlogView = readFileSync(new URL('../src/components/BacklogView.tsx', import.meta.url), 'utf8');
check('Backlog cards show a square drag handle and reserve its width in every lane', backlogView.includes('grid size-8 shrink-0 place-items-center rounded-lg border') && backlogView.includes('<GripVertical className="size-4" />'));
check('removing a plan has a visible rose danger treatment', backlogView.includes('border-rose-500/30 bg-rose-500/10') && backlogView.includes('hover:bg-rose-500/20'));
const logsView = readFileSync(new URL('../src/components/LogsView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const gameEditor = readFileSync(new URL('../src/components/detail/GameEditDialog.tsx', import.meta.url), 'utf8');
check('removing a game from the Journal uses the in-app confirmation and preserves logs and sessions', logsView.includes('<ConfirmDialog') && logsView.includes('title={`Remove ${membershipTarget.title} from the Journal?`') && logsView.includes('Its logs, notes, sessions and Library record stay intact.') && !logsView.includes('confirm(`Remove ${menuGame.title} from the Journal?'));
check('removing a game from the Backlog uses the in-app confirmation and preserves its Library record', app.includes('<ConfirmDialog') && app.includes('title={`Remove ${backlogRemovalTarget.title} from the Backlog?`}') && app.includes('remain in your Library with its files, sessions and notes') && !app.includes('confirm(`Remove ${game.title} from the Backlog?'));
check('the Remove from Backlog editor action uses destructive rose styling', gameEditor.includes('border-rose-500/40 bg-rose-500/10'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
