import { journalMove, padDistance } from '../src/utils/gamepad.ts';

let failures = 0;
const check = (name, pass) => {
  console.log(`  ${pass ? 'ok   ' : 'FAIL '}${name}`);
  if (!pass) failures += 1;
};

const game = { left: 24, top: 420, right: 300, bottom: 476 };
const log = { left: 360, top: 400, right: 980, bottom: 448 };
const notes = { left: 360, top: 640, right: 980, bottom: 860 };
const tab = { left: 520, top: 12, right: 620, bottom: 44 };

console.log('controller moves stay with the control in that direction');
const rightLog = padDistance(game, log, 'right');
const rightNotes = padDistance(game, notes, 'right');
const rightTab = padDistance(game, tab, 'right');
check('a log row to the right beats the notes below it', rightLog !== null && rightNotes !== null && rightLog < rightNotes);
check('a log row beats a tab that is also to the right', rightLog !== null && rightTab !== null && rightLog < rightTab);

const upLog = padDistance(notes, log, 'up');
const upTab = padDistance(notes, tab, 'up');
check('up from the notes reaches the log before the tab', upLog !== null && upTab !== null && upLog < upTab);
check('a control the other way is not a candidate', padDistance(game, log, 'left') === null);

console.log('the journal has its own routes');
check('right from a game opens the log', journalMove('journal-game', 'right', false) === 'logs');
check('up and down stay in the game list', journalMove('journal-game', 'down', false) === 'leave');
check('up from the notes returns to the last log', journalMove('journal-notes', 'up', false) === 'logs-last');
check('left from a log entry stays on that row when edit is beside it', journalMove('journal-logs', 'left', true) === 'inside');
check('left from the log itself returns to the game', journalMove('journal-logs', 'left', false) === 'game');
check('down from the last log opens the notes', journalMove('journal-logs', 'down', false) === 'notes');
check('right from the end of a log row does not escape', journalMove('journal-logs', 'right', false) === 'stay');

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
