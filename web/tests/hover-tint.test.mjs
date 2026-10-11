/**
 * The tint behind a hovered cover, and what it does when the pointer leaves.
 *
 * The tile fades its overlay in over a fifth of a second. If the colour behind
 * that overlay changes while it is fading, the tile visibly changes twice for
 * one pass of the mouse, which reads as a stutter rather than as a transition.
 * So what is checked here is the sequence of colours a tile goes through, not
 * what any one of them looks like.
 */
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoverTint } from '../src/utils/palette.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'Image', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, value });
setGlobal('window', dom.window);
setGlobal('document', dom.window.document);
setGlobal('navigator', dom.window.navigator);
setGlobal('HTMLElement', dom.window.HTMLElement);
setGlobal('IS_REACT_ACT_ENVIRONMENT', true);

// The picture is never fetched for real: the fetch is refused so the hook falls
// back to loading it as an image, the image reports itself loaded at once, and
// the canvas hands back a solid red. Red is 0 degrees, which is easy to
// recognize in the gradient that comes out.
setGlobal('fetch', () => Promise.reject(new Error('refused on purpose')));
class FakeImage {
  set src(value) {
    this.source = value;
    setTimeout(() => this.onload?.(), 0);
  }
}
setGlobal('Image', FakeImage);
dom.window.HTMLCanvasElement.prototype.getContext = () => ({
  drawImage() {},
  getImageData: (_x, _y, width, height) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 3] = 255;
    }
    return { data };
  },
});

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const SHADOW = 'rgb(0 0 0';
const game = {
  id: 'tint-test',
  title: 'Tint Test',
  meta: { coverUrl: 'https://example.invalid/cover.jpg' },
};

/** Puts the gradient on the element so each render can be read back. */
function Tile({ active, coverTint }) {
  const tint = useHoverTint(game, coverTint, active);
  return createElement('div', { 'data-tint': tint });
}

const root = createRoot(document.getElementById('root'));
const render = async (props) => {
  await act(async () => {
    root.render(createElement(Tile, props));
  });
  // Measuring a picture takes several turns of the event loop: a fetch that is
  // refused, then the image loading, then the pixels being read. Wait for all
  // of them rather than guessing at one delay.
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
};
const tintOf = () => document.querySelector('[data-tint]').getAttribute('data-tint');

console.log('the tint behind a hovered cover');

await render({ active: false, coverTint: true });
check('an unhovered tile is dark', tintOf().includes(SHADOW), tintOf());

// The pointer arrives, and the picture is measured for the first time.
await render({ active: true, coverTint: true });
const measured = tintOf();
check('hovering brings up the cover\'s own colour', measured.includes('hsl(0 ') && !measured.includes(SHADOW), measured);

// The pointer leaves. This is where the tile used to go dark again, which is
// what made the next hover change colour twice.
await render({ active: false, coverTint: true });
check('leaving does not throw the colour away', tintOf() === measured, `was ${tintOf()}`);

// And the pointer comes back: one colour, from the first frame.
await render({ active: true, coverTint: true });
check('coming back does not change it either', tintOf() === measured, `was ${tintOf()}`);

// A tile whose picture cannot be measured at all should still be stable, and
// a tile set to the theme should never involve the picture.
await render({ active: false, coverTint: false });
const themed = tintOf();
check('the theme setting uses the theme', themed.includes('var(--c-accent)'), themed);
await render({ active: true, coverTint: false });
check('and hovering leaves it alone', tintOf() === themed, `was ${tintOf()}`);

await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
