/** The custom path field shows up for the launchers that have a folder to name, and only those. */
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { OtherLauncherImportModal } from '../src/components/OtherLauncherImportModal.tsx';
import { pathPromptFor } from '../src/data/launchers.ts';

// The modal asks whether it is running inside the desktop app while it renders,
// and it draws itself through a portal, so it needs a real DOM and the client
// renderer rather than the static one.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const holder = document.getElementById('root');

/** Render the picker for one launcher and return the markup it produced. */
async function render(launcher, path) {
  const root = createRoot(holder);
  await act(async () => {
    root.render(
      createElement(OtherLauncherImportModal, {
        existing: [],
        launcher,
        path,
        onPath: () => {},
        onAdd: () => {},
        onClose: () => {},
      }),
    );
  });
  const html = document.body.innerHTML;
  // A root cannot be reused once it is unmounted, so each render needs its own.
  await act(async () => root.unmount());
  return html;
}

console.log('the custom path field');
const heroic = await render('Heroic Games Library', '/srv/heroic');
check('Heroic gets one', heroic.includes('Custom path'));
check(
  'and it holds the folder already saved',
  heroic.includes('value="/srv/heroic"'),
  heroic.match(/<input[^>]*>/g)?.join(' ') ?? 'no input at all',
);
check(
  'an empty one says the defaults will be used',
  (await render('Heroic Games Library', undefined)).includes('Leave empty to find it automatically'),
);

for (const launcher of ['Epic Games', 'Ubisoft Connect', 'GOG Galaxy', 'EA app']) {
  check(
    `${launcher} does not get one`,
    !(await render(launcher)).includes('Custom path'),
    'a launcher with no folder to name must not offer a box to type one into',
  );
}

check(
  'Xbox gets one, which is what the data says it should',
  (await render('Xbox')).includes('Custom path') && pathPromptFor('Xbox') !== undefined,
);
check(
  'Amazon Luna gets one, pointing at the folder Nile writes',
  (await render('Amazon Luna')).includes('Custom path') && pathPromptFor('Amazon Luna') !== undefined,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
