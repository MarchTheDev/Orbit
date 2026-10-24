import { directionsHeld, hatDirection, heldDirection, journalMove, mayHandleGamepadInput, padDistance, padEdges, padEdgesWhenOwned, padNearest, releaseRest, withoutRest } from '../src/utils/gamepad.ts';

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

console.log('a d-pad that reports as a hat still walks the rail');

const flat = Array(16).fill(false);
const withHat = (x, y, buttons = flat) => ({ buttons, axes: [0, 0, 0, 0, 0, 0, x, y] });
check('a hat at rest points nowhere', hatDirection(withHat(0, 0).axes) === null);
check('and a pushed one points the way it is pushed',
  hatDirection(withHat(-1, 0).axes) === 'left' &&
    hatDirection(withHat(1, 0).axes) === 'right' &&
    hatDirection(withHat(0, -1).axes) === 'up' &&
    hatDirection(withHat(0, 1).axes) === 'down');
check('a hat press is a move', padEdges(withHat(0, 0), withHat(1, 0)).includes('right'));
check('holding it keeps stepping', heldDirection(withHat(0, 1)) === 'down');
check('and letting it go stops', heldDirection(withHat(0, 0)) === null);
check('the same direction from a hat and its button moves once',
  padEdges(withHat(0, 0), { buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0].map(Boolean), axes: [0, 0, 0, 0, 0, 0, 0, 1] })
    .filter((action) => action === 'down').length === 1);

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
// The overlay's default layout, roughly: what the machine is doing down the
// left - the frame rate, the clock, the mixer, and the performance numbers
// under it - and what the player is holding down the right: the gallery, what
// is playing, and the notes under that.
const overlayBoxes = {
  fps: { left: 24, top: 24, right: 200, bottom: 136 },
  clock: { left: 24, top: 152, right: 200, bottom: 264 },
  audio: { left: 24, top: 280, right: 324, bottom: 720 },
  performance: { left: 24, top: 736, right: 264, bottom: 932 },
  gallery: { left: 1576, top: 24, right: 1896, bottom: 384 },
  player: { left: 1576, top: 400, right: 1896, bottom: 668 },
  notes: { left: 1576, top: 684, right: 1896, bottom: 894 },
  capture: { left: 680, top: 836, right: 1240, bottom: 1056 },
};
const list = Object.values(overlayBoxes);
const choose = (from, direction) => padNearest(overlayBoxes[from], list, direction);
check('down from the FPS box lands on the clock', choose('fps', 'down') === 1);
check('down from the clock lands on the mixer', choose('clock', 'down') === 2);
check('the performance box hangs under the mixer', choose('audio', 'down') === 3);
check('and up from it returns to the mixer', choose('performance', 'up') === 2);
check('the notes hang under what is playing', choose('player', 'down') === 6);
check('and up from them returns to the player', choose('notes', 'up') === 5);
check('the gallery heads that column', choose('gallery', 'down') === 5);
check('nothing above the FPS box', choose('fps', 'up') === null);

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
