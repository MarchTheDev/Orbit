/**
 * What the music does when nobody has said anything about it.
 *
 * A fresh library has no sound settings at all, and that has to mean "play",
 * not "stay quiet". Silent by default is indistinguishable from broken, which
 * is what two rounds of "the sound does not work on Linux" turned out to be.
 *
 * The button is the honest place to ask, because its tooltip is derived from
 * the same reading of the setting that App uses to decide whether to start
 * anything.
 */
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MusicButton } from '../src/components/MusicButton.tsx';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const [name, value] of [
  ['window', dom.window],
  ['document', dom.window.document],
  ['navigator', dom.window.navigator],
  ['HTMLElement', dom.window.HTMLElement],
  ['IS_REACT_ACT_ENVIRONMENT', true],
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const root = createRoot(document.getElementById('root'));
const noop = () => {};

const tooltip = async (sound) => {
  await act(async () => {
    root.render(createElement(MusicButton, { sound, onChange: noop, showBars: false, onOpenSettings: noop }));
  });
  return document.querySelector('[aria-label="Music"]').getAttribute('title');
};

console.log('the music when nobody has chosen');

check('a library with no sound settings plays', (await tooltip(undefined)) === 'Music is on',
  await tooltip(undefined));
check('and an empty object is the same thing',
  (await tooltip({})) === 'Music is on', await tooltip({}));

console.log('and when somebody has');

check('turning it off is still turning it off',
  (await tooltip({ enabled: false, volume: 0.35, unfocused: false })) === 'Music is off');
check('as is muting it',
  (await tooltip({ enabled: true, volume: 0, unfocused: false })) === 'Music is muted');
check('and asking for it explicitly still works',
  (await tooltip({ enabled: true, volume: 0.35, unfocused: false })) === 'Music is on');

await act(async () => root.unmount());
dom.window.close();
for (const name of globalNames) {
  const descriptor = previousGlobals.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
