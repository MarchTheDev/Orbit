import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const overlay = readFileSync(path.join(root, 'web', 'src', 'components', 'OverlayView.tsx'), 'utf8');
const settings = readFileSync(path.join(root, 'web', 'src', 'components', 'SettingsView.tsx'), 'utf8');
const cover = readFileSync(path.join(root, 'web', 'src', 'components', 'ui', 'Cover.tsx'), 'utf8');
const gamepad = readFileSync(path.join(root, 'web', 'src', 'hooks', 'useGamepad.ts'), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`);
  }
}

console.log('capture chime only follows a successful save');
const runStart = overlay.indexOf('const run = async');
const runEnd = overlay.indexOf('\n  const chooseLength', runStart);
const run = overlay.slice(runStart, runEnd);
check('the chime is gated by a save-capable action after the capture resolves', /const result = await work\(\);[\s\S]*?if \(chimeOnSuccess \|\| recordingSaved\)[\s\S]*?if \(on\) void playShutter\(volume\)/.test(run));
check('a recording chimes based on the native save result, even if button status was stale', run.includes("const recordingSaved = typeof result === 'string' && /^Saved the recording as\\b/i.test(result);"));
check('the Audio box no longer shows the helper sentence', !overlay.includes('Up to three active sources are shown. More opens the rest; left and right change a volume by 1.'));
check('a saved capture plays using cached settings without waiting for settings I/O', run.includes('const current = settingsRef.current;') && !run.includes('await loadSettings()'));
check('screenshots keep the existing chime', /primeShutter\(\); void run\(\(\) => overlayShot\(stamp\(\)\), true, 'Screenshot saved'\)/.test(overlay));
check('starting a recording does not request a chime', /const stopping = !!status\?\.recording;[\s\S]*?run\(\(\) => overlayRecord\(stamp\(\)\), stopping, stopping \? 'Recording saved' : 'Recording started'\)/.test(overlay));
check('stopping a recording requests the chime only after save succeeds', /run\(\(\) => overlayRecord\(stamp\(\)\), stopping, stopping \? 'Recording saved' : 'Recording started'\)/.test(overlay));
check('a saved replay requests the same chime after save succeeds', /primeShutter\(\); void run\(\(\) => overlayReplay\(seconds, stamp\(\)\), true, 'Replay saved'\)/.test(overlay));
check('settings describe the chime for screenshots, recordings, and replays', /after a screenshot, recording, or replay is saved/.test(settings) && !settings.includes('Recordings stay quiet'));

console.log('library artwork avoids eager decoding for every game');
const imageTags = [...cover.matchAll(/<img\b[\s\S]*?\/>/g)].map(([tag]) => tag);
check('both the visible and blurred cover image use native lazy loading', imageTags.length === 2 && imageTags.every((tag) => /loading="lazy"/.test(tag)));

console.log('background controller input cannot relaunch a library game');
check('the main gamepad window must be visible, focused, and not yield to the overlay', /mayHandleGamepadInput\([\s\S]*?document\.visibilityState === 'visible'[\s\S]*?document\.hasFocus\(\)/.test(gamepad));
check('background input only updates a quiet baseline, without polling or dispatching actions', /if \(!ownsPad\(\)\) \{\s*padOwnedLast = false;[\s\S]*const current = nativeOn && native \? native : linux \? null : previous;[\s\S]*resetUnowned\(current\);\s*return;/.test(gamepad));
check('refocus samples the current pad once as a baseline before acting on it', /if \(!padOwnedLast\) \{[\s\S]*webPadSnapshot\(\)[\s\S]*resetUnowned\(current\);\s*return;/.test(gamepad));
check('stick scrolling also stops while the main window is not focused', /if \(!ownsPad\(\)\) \{\s*lastScroll = 0;\s*return;/.test(gamepad));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
