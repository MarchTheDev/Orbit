/** A damaged per-box arrangement can be discarded without resetting overlay preferences. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = readFileSync(path.join(root, 'src/components/SettingsView.tsx'), 'utf8');
const overlay = readFileSync(path.join(root, 'src/components/OverlayView.tsx'), 'utf8');
let failures = 0;
function check(label, ok) {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}`); }
}

check('Settings has an explicit restore-default-layout action',
  settings.includes('Restore default positions') &&
    settings.includes("setOverlay({ layout: {}, layoutRevision: 0 })"));
check('the reset broadcasts only a layout reset and leaves other preferences alone',
  settings.includes("emit('overlay-layout-reset')") &&
    !/onClick=\{\(\)\s*=>\s*onReset\(\)/.test(settings));
check('an open panel immediately lays out the boxes for its own window',
  overlay.includes("listen('overlay-layout-reset'") &&
    overlay.includes('defaults(window.innerWidth || 1280, window.innerHeight || 720)') &&
    overlay.includes('setPlaces(next)'));
check('the new layout is saved and stale pins are cleared',
  overlay.includes("emit('overlay-settings', { layout: next, layoutRevision: LAYOUT_REVISION })") &&
    overlay.includes('overlayPins(false)'));

const settingsOrder = settings.indexOf('Capture folders');
const paths = settings.indexOf('{captureFolders.map((folder) => (');
const boxes = settings.indexOf('Overlay boxes', paths);
check('capture paths stay grouped under Capture folders before Overlay boxes', settingsOrder >= 0 && paths > settingsOrder && boxes > paths);
check('the diagnostic card is removed from Overlay settings', !settings.includes('What the overlay did') && !settings.includes('function PanelDiag()'));

if (failures) process.exitCode = 1;
