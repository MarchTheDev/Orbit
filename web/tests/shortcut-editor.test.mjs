/** The open/close binding is controlled by Settings so each change is visible immediately. */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShortcutEditor } from '../src/components/ShortcutEditor.tsx';
import { DEFAULT_SHORTCUTS } from '../src/utils/shortcuts.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const [name, value] of [
  ['window', dom.window],
  ['document', dom.window.document],
  ['navigator', dom.window.navigator],
  ['HTMLElement', dom.window.HTMLElement],
  ['IS_REACT_ACT_ENVIRONMENT', true],
]) Object.defineProperty(globalThis, name, { configurable: true, value });

function Harness() {
  const [openShortcut, setOpenShortcut] = useState('Alt+X');
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  return createElement(ShortcutEditor, {
    value: shortcuts,
    openShortcut,
    onOpenShortcutChange: setOpenShortcut,
    onChange: (next, resetOpenShortcut) => {
      setShortcuts(next);
      if (resetOpenShortcut !== undefined) setOpenShortcut(resetOpenShortcut);
    },
  });
}

const root = createRoot(document.getElementById('root'));
const render = async () => act(async () => root.render(createElement(Harness)));
const capture = async (key, modifiers = {}) => {
  await act(async () => document.querySelector('[aria-label^="Open overlay keyboard shortcut:"]').click());
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true, ...modifiers,
    }));
  });
};
const shown = () => document.querySelector('[aria-label^="Open overlay keyboard shortcut:"]')?.getAttribute('aria-label');
let failures = 0;
function check(name, okay, detail = '') {
  if (okay) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

console.log('repeated shortcut capture and reset');
await render();
await capture('a', { ctrlKey: true });
check('the first captured shortcut is shown immediately', shown() === 'Open overlay keyboard shortcut: Ctrl + A', shown());
await capture('b', { altKey: true });
check('a second capture replaces it without remounting Settings', shown() === 'Open overlay keyboard shortcut: Alt + B', shown());
await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Reset all'))?.click());
check('reset shows the default before leaving Settings', shown() === 'Open overlay keyboard shortcut: Alt + X', shown());

// The separate overlay WebView must opt into the Linux CSS safeguards; the
// main App's effect cannot do that for another window.
const overlay = readFileSync(new URL('../src/components/OverlayView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
check('the overlay WebView applies the Linux rendering class itself',
  overlay.includes("classList.toggle('orbit-linux', linuxPlatform)") && overlay.includes("classList.remove('orbit-linux')"));
check('Linux disables the exact medium backdrop blur used by overlay panels',
  /html\.orbit-linux \.backdrop-blur-md,[\s\S]{0,300}backdrop-filter: none !important/.test(css),
  'the Linux override must include .backdrop-blur-md');

// Let the editor's deferred native-conflict check settle inside act, so this
// component-level test also observes its final asynchronous update cleanly.
await act(async () => new Promise((resolve) => window.setTimeout(resolve, 450)));
await act(async () => root.unmount());
dom.window.close();
for (const name of names) {
  const descriptor = previous.get(name);
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
if (failures) process.exitCode = 1;
