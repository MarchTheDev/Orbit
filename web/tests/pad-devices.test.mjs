/**
 * A controller is a guess about a device node, and the guess has to be narrow.
 *
 * On Linux a pad is found by reading `/dev/input`, where a pointer lives too -
 * and a virtual machine is the case that makes this visible: its pointer is an
 * *absolute* device, so joydev gives it a `js*` node, and a node taken on its
 * name alone turns the cursor into a d-pad. Moving the mouse towards a corner
 * of the screen then walks the page that way, and a click arrives as a face
 * button. Nothing here can be run against a real device, so the rules are read
 * out of the source and the pure parts are run.
 */
import { readFileSync } from 'node:fs';
import {
  defaultSpots,
  fitScale,
  fitSpot,
  fitSpots,
  fitsWindow,
} from '../src/utils/overlayLayout.ts';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const pad = readFileSync(new URL('../src-tauri/src/gamepad.rs', import.meta.url), 'utf8');
const overlayRs = readFileSync(new URL('../src-tauri/src/overlay.rs', import.meta.url), 'utf8');
const overlayTs = readFileSync(
  new URL('../src/components/OverlayView.tsx', import.meta.url),
  'utf8',
);

console.log('a pointer is not a controller');

check(
  'the names a pointer answers to are refused',
  pad.includes('fn pointer_name(lower: &str) -> bool') &&
    ['touchpad', 'mouse', 'keyboard', 'trackpoint', 'tablet', 'touchscreen', 'stylus', 'digitizer']
      .every((word) => pad.includes(`lower.contains("${word}")`)),
  'a device named as a pointer can still be read as a pad',
);
check(
  'a left click is a pointer, and no pad sends one',
  /if !gamepad_bits && \(bitmap_has_bit\(key_bits, 0x110\) \|\| bitmap_has_bit\(key_bits, 0x145\)\)/.test(
    pad,
  ),
);
check(
  'a pad with an odd extra button still counts',
  // The refusal only applies to a device with no gamepad button at all.
  /if !gamepad_bits &&/.test(pad),
);
check('a joystick node is asked what the device behind it is',
  pad.includes('fn joystick_is_pad(index: u32) -> bool') &&
    pad.includes('/sys/class/input/js{index}/device') &&
    pad.includes('capabilities/key') &&
    pad.includes('pad_score(name.trim(), &keys, false) > 0'));
check('and a node nothing can describe is refused, not guessed',
  /fn joystick_is_pad[\s\S]{0,700}return false;/.test(pad));
check('every way into a joystick node asks the same question',
  pad.includes('fn path_is_pad_joystick(path: &Path) -> bool') &&
    /matches!\(kind, DeviceKind::Joystick\) && !path_is_pad_joystick\(&path\)/.test(pad) &&
    /if path\.exists\(\) && joystick_is_pad\(index\)/.test(pad));
check(
  'the device Orbit settled on is written down where a player can read it',
  pad.includes('crate::overlay::note_device(') &&
    overlayRs.includes('pub(crate) fn note_device(text: &str)'),
);

console.log('the panel waits for its page instead of rebuilding it');

check(
  'a page that has never answered is given time to load',
  overlayRs.includes('const PAGE_COLD: Duration = Duration::from_secs(45)') &&
    /if quiet\.is_none\(\) \{[\s\S]{0,300}since < PAGE_COLD[\s\S]{0,200}nudge\(&window, since\)/.test(
      overlayRs,
    ),
);
check('the panel is not thrown away while that load is still coming',
  /if quiet\.is_none\(\) \{[\s\S]{0,400}return;\n    \}/.test(overlayRs));
check('it is asked to draw again instead, a few seconds apart',
  overlayRs.includes('static NUDGE_AT: Mutex<Option<std::time::Instant>> = Mutex::new(None);') &&
    overlayRs.includes('fn nudge(window: &tauri::WebviewWindow, since: Duration)') &&
    overlayRs.includes('Duration::from_secs(3)') &&
    overlayRs.includes('window.emit("overlay-shown", ())'));
check(
  'on Linux the page is kept between opens, so the bundle is read once',
  /#\[cfg\(target_os = "linux"\)\]\s*\{\s*let _ = window\.emit\("overlay-hidden", \(\)\);/.test(
    overlayRs,
  ) &&
    /#\[cfg\(not\(target_os = "linux"\)\)\][\s\S]{0,400}window\.destroy\(\)\.is_err\(\)/.test(overlayRs),
);
check(
  'and a page that hears it is up is not told by a slower answer that it is not',
  overlayTs.includes('const open = shownSeen.current || mode.open;') &&
    overlayTs.includes('setResting(!shownSeen.current && mode.resting && !mode.open);'),
);

console.log('a layout made on one screen still fits another');

const gallery = { minW: 240, minH: 180 };
check('a box past the right edge comes back',
  fitSpot({ x: 1700, y: 24, w: 320, h: 360 }, gallery, 1280, 800).x === 1280 - 320 - 24);
check('a box past the bottom comes back too',
  fitSpot({ x: 24, y: 900, w: 320, h: 360 }, gallery, 1280, 800).y === 800 - 360 - 24);
check('a box off the top or left comes in',
  fitSpot({ x: -400, y: -90, w: 320, h: 360 }, gallery, 1280, 800).x === 24 &&
    fitSpot({ x: -400, y: -90, w: 320, h: 360 }, gallery, 1280, 800).y === 24);
check('a box that already fits is left exactly where it is',
  fitSpot({ x: 200, y: 120, w: 320, h: 360 }, gallery, 1280, 800).x === 200);
check('a box wider than the screen is shrunk, not hung off it',
  fitSpot({ x: 0, y: 0, w: 2000, h: 360 }, gallery, 1280, 800).w === 1280 - 48);
check('a window that has not been measured yet changes nothing',
  fitSpot({ x: 900, y: 700, w: 320, h: 360 }, gallery, 0, 0).x === 900);
check('everything is fitted in one pass',
  fitSpots(
    { a: { x: 1700, y: 24, w: 320, h: 360 }, b: { x: 24, y: 24, w: 176, h: 112 } },
    { a: gallery, b: { minW: 120, minH: 88 } },
    1280,
    800,
  ).a.x === 1280 - 320 - 24);
check('a layout that already fits is returned untouched',
  (() => {
    const spots = { a: { x: 24, y: 24, w: 320, h: 360 } };
    return fitSpots(spots, { a: gallery }, 1280, 800) === spots;
  })());
check(
  'pinned state survives a box being fitted',
  (() => {
    const fitted = fitSpots(
      { a: { x: 1700, y: 24, w: 320, h: 360, pinned: true } },
      { a: gallery },
      1280,
      800,
    ).a;
    return fitted.x === 1280 - 320 - 24 && fitted.pinned === true;
  })(),
);
check(
  'the arrangement designed for this window is used while the saved one cannot fit',
  overlayTs.includes('fitsWindow(savedPlaces.current, window.innerWidth, window.innerHeight)') &&
    overlayTs.includes('setPlaces(usable ? savedPlaces.current! : base);'),
);
check(
  'and it is revisited whenever the window changes size',
  /window\.addEventListener\('resize', fit\)/.test(overlayTs) &&
    /setPlaces\(\(current\) => \{[\s\S]{0,400}fitsWindow\(current, width, height\) \? current : defaults\(width, height\)/.test(
      overlayTs,
    ),
);

console.log('the arrangement itself has to fit the screen it is drawn on');

/** Two boxes that overlap, by the numbers the panel draws with. */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const BOX = {
  fps: { w: 176, h: 112, minW: 120, minH: 88 },
  clock: { w: 176, h: 112, minW: 120, minH: 88 },
  audio: { w: 300, h: 440, minW: 220, minH: 160 },
  performance: { w: 240, h: 196, minW: 200, minH: 140 },
  gallery: { w: 320, h: 360, minW: 240, minH: 180 },
  player: { w: 320, h: 268, minW: 240, minH: 180 },
  notes: { w: 300, h: 210, minW: 220, minH: 140 },
  capture: { w: 560, h: 220, minW: 320, minH: 160 },
};

function trouble(width, height) {
  const spots = defaultSpots(BOX, width, height);
  const ids = Object.keys(spots);
  const bad = [];
  for (const id of ids) {
    const spot = spots[id];
    if (spot.x < 0 || spot.y < 0 || spot.x + spot.w > width || spot.y + spot.h > height) {
      bad.push(`${id} off screen`);
    }
    for (const other of ids) {
      if (other <= id) continue;
      if (overlaps(spot, spots[other])) bad.push(`${id} on ${other}`);
    }
  }
  return bad;
}

for (const [width, height] of [
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1920, 1080],
  [1024, 640],
  [960, 540],
  [1280, 1024],
]) {
  const bad = trouble(width, height);
  check(`nothing overlaps and nothing hangs off at ${width} by ${height}`, bad.length === 0, bad.join(', '));
}
check('a big screen keeps the boxes at their own size and puts them at its edges',
  (() => {
    const spots = defaultSpots(BOX, 1920, 1080);
    return (
      spots.gallery.w === BOX.gallery.w &&
      spots.gallery.x === 1920 - BOX.gallery.w - 24 &&
      spots.fps.x === 24
    );
  })());
check('a small one shrinks them with the space between them, instead of stacking them',
  (() => {
    const big = defaultSpots(BOX, 1280, 720);
    const small = defaultSpots(BOX, 1024, 640);
    return small.gallery.w < big.gallery.w && small.audio.w < big.audio.w;
  })());
check('the scale never grows the arrangement past its design',
  fitScale(3840, 2160) === 1 && fitScale(1280, 720) === 1);
check('and shrinks it for a smaller window',
  Math.abs(fitScale(1024, 640) - 0.8) < 0.001 && Math.abs(fitScale(1280, 576) - 0.8) < 0.001);
check('a window that has not been measured yet is not shrunk',
  fitScale(0, 0) === 1);
check('a layout that is wholly inside the window fits it',
  fitsWindow({ a: { x: 24, y: 24, w: 100, h: 100 } }, 1280, 720) &&
    !fitsWindow({ a: { x: 1200, y: 24, w: 100, h: 100 } }, 1280, 720) &&
    !fitsWindow({ a: { x: 24, y: 700, w: 100, h: 100 } }, 1280, 720));
check('a box exactly against the edge still counts as fitting',
  fitsWindow({ a: { x: 0, y: 0, w: 1280, h: 720 } }, 1280, 720));

console.log('the tweak fields cannot push their own panel open');

const wine = readFileSync(
  new URL('../src/components/detail/WineSettings.tsx', import.meta.url),
  'utf8',
);
const editor = readFileSync(
  new URL('../src/components/detail/LaunchEditor.tsx', import.meta.url),
  'utf8',
);
check('every column in the switch grid can shrink below its text',
  wine.includes('[&>*]:min-w-0') && (wine.match(/\[&>\*\]:min-w-0/g) ?? []).length === 2);
check('the fields themselves are allowed to be narrower than their hint',
  (wine.match(/<label className="block min-w-0"/g) ?? []).length >= 4);
check('an environment row shares its width instead of overflowing',
  wine.includes('flex min-w-0 items-center gap-1.5') &&
    (wine.match(/min-w-0 flex-1/g) ?? []).length >= 2 &&
    wine.includes('shrink-0 px-2 py-1.5'));
check('the path fields in the launch editor can shrink too',
  editor.includes('flex min-w-0 gap-2') && editor.includes('block min-w-0 flex-1'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
