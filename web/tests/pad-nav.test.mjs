import { directionsHeld, heldDirection, journalMove, mayHandleGamepadInput, padDistance, padEdges, padEdgesWhenOwned, padNearest, releaseRest, withoutRest } from '../src/utils/gamepad.ts';

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

console.log('a stick already held when the pad is first heard is rest, not up');
const stuckButtons = Array(16).fill(false);
stuckButtons[12] = true;
const stuck = { buttons: stuckButtons, axes: [0, -1, 0, 0] };
const rest = directionsHeld(stuck);
check('a parked stick and d-pad are already up', rest.up && !rest.down && !rest.left && !rest.right);
check('that opening reading is not a press', withoutRest(padEdges(null, stuck), rest).includes('up') === false);
check('and it does not keep stepping', heldDirection(stuck, rest) === null);
const rightButtons = Array(16).fill(false);
rightButtons[12] = true;
rightButtons[15] = true;
const rightWhileStuck = { buttons: rightButtons, axes: [0.8, -1, 0, 0] };
check('another direction still counts while up is only the opening hold', heldDirection(rightWhileStuck, rest) === 'right');
const cleared = releaseRest(rest, directionsHeld({ buttons: Array(16).fill(false), axes: [0, 0, 0, 0] }));
check('letting the stick go clears the hold', !cleared.up);
check('a later push up still counts', heldDirection({ buttons: Array(16).fill(false), axes: [0, -0.8, 0, 0] }, cleared) === 'up');

console.log('the library only acts on a controller while its window owns focus');
const startButtons = Array(16).fill(false);
startButtons[9] = true;
const startPress = { buttons: startButtons, axes: [0, 0, 0, 0] };
check('Start still maps to Play in the focused library', padEdgesWhenOwned(mayHandleGamepadInput(false, true, true), null, startPress).includes('play'));
check('Start is ignored while the library is unfocused', padEdgesWhenOwned(mayHandleGamepadInput(false, true, false), null, startPress).length === 0);
check('Start is ignored while the library is hidden', padEdgesWhenOwned(mayHandleGamepadInput(false, false, true), null, startPress).length === 0);
check('the main window leaves input to the overlay when it is open', padEdgesWhenOwned(mayHandleGamepadInput(true, true, true), null, startPress).length === 0);
check('a held Start button does not become a new press on refocus', padEdgesWhenOwned(mayHandleGamepadInput(false, true, true), startPress, startPress).length === 0);

console.log('the overlay chooses boxes by where they are on screen');
// The overlay's default layout, roughly: two small boxes on the left, the
// performance reading with the notes under it, the capture bar at the bottom.
const overlayBoxes = {
  fps: { left: 24, top: 24, right: 200, bottom: 136 },
  clock: { left: 24, top: 152, right: 200, bottom: 264 },
  audio: { left: 24, top: 280, right: 324, bottom: 600 },
  performance: { left: 340, top: 24, right: 580, bottom: 220 },
  notes: { left: 340, top: 236, right: 640, bottom: 446 },
  capture: { left: 360, top: 600, right: 920, bottom: 820 },
};
const list = Object.values(overlayBoxes);
const choose = (from, direction) => padNearest(overlayBoxes[from], list, direction);
check('right from the clock lands on the performance box', choose('clock', 'right') === 3);
check('down from the notes lands on the capture bar', choose('notes', 'down') === 5);
check('the box beside the audio box is the notes card, not a walk through the list', choose('audio', 'right') === 4);
check('down from the audio box reaches the capture bar', choose('audio', 'down') === 5);
check('nothing above the FPS box', choose('fps', 'up') === null);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
