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
check('Backlog sync off excludes installed Library games', !onBacklogPage(installed, false));
check('Backlog sync on includes installed Library games', onBacklogPage(installed, true));
check('title-only Library entries follow the same sync setting', !onBacklogPage(titleOnly, false) && onBacklogPage(titleOnly, true));
check('owned Backlog-only games stay there when sync is off', onBacklogPage(backlogOnly, false));
check('manual removal wins even when sync is on', !onBacklogPage(installed, true, [], ['installed']));
check('manual addition works even when sync is off', onBacklogPage(installed, false, ['installed'], []));
check('plans do not count as Library games or synced Backlog entries', !inLibraryShelf(planned) && !onBacklogPage(planned, true));
check('the Library count excludes a planned-only Backlog record', libraryCount([installed, planned]) === 1);
check('Journal sync includes games by default', onJournalPage('installed', true));
check('Journal sync off hides unpinned games', !onJournalPage('installed', false));
check('manual Journal membership works with sync off', onJournalPage('installed', false, ['installed']));
check('manual Journal removal wins with sync on', !onJournalPage('installed', true, [], ['installed']));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
