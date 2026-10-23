/**
 * Planning a game: one panel, in the middle, that answers in one breath.
 *
 * The dialog is the whole of planning now - the search and the game's page are
 * the same frame - so these checks are about what would be easy to break
 * without noticing: that it is drawn in the centre rather than against an
 * edge, that a name opens the game inside the same panel, that going back
 * returns to the list rather than closing everything, that a game the store
 * has never heard of can still be written down, and that adding a game from its
 * page carries the answers the page already has rather than asking again.
 *
 * The search is entered through `initialQuery` rather than by typing. React
 * decides once, when it is first imported, whether a document can deliver the
 * input events it relies on, and a bundled test imports it before any of these
 * globals exist - so a simulated keystroke is never seen by it.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SAMPLE_GAMES } from '../src/data/sampleGames.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
// React carries a fallback for browsers that predate the input event, and it
// reaches for the old IE subscription methods when a field is involved. jsdom
// has neither, and nothing here relies on them: the fallback is never used
// because the event it waits for is never fired.
dom.window.Node.prototype.attachEvent = () => {};
dom.window.Node.prototype.detachEvent = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PlanDialog } = await import('../src/components/detail/PlanDialog.tsx');
const { knownGames } = await import('../src/services/metadata.ts');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

/** Long enough for the debounce and the browser preview's own stand-in delays. */
const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

const rows = () => [...document.querySelectorAll('[data-plan-row]')];
const buttonWith = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
const dialog = () => document.querySelector('[role="dialog"]');

const root = createRoot(document.getElementById('root'));
const added = [];
let closed = 0;

const open = async (initialQuery) => {
  await act(async () => {
    root.render(
      createElement(PlanDialog, {
        // A different name is a different panel: state does not carry over.
        key: initialQuery,
        games: SAMPLE_GAMES,
        initialQuery,
        onAdd: (pick) => {
          added.push(pick);
        },
        onClose: () => {
          closed += 1;
        },
      }),
    );
  });
};

console.log('the planning dialog is one panel in the middle');

await open('hollow');
check('it is a dialog rather than a drawer sliding in at an edge',
  !!dialog() && !document.querySelector('aside'));
check('it is drawn in the middle of the window',
  dialog()?.parentElement?.className.includes('justify-center') === true &&
    dialog()?.parentElement?.className.includes('items-center') === true);
check('nothing is asked of the store until a name is typed', rows().length === 0);

await act(async () => settle());
const found = rows().length;
check('a name brings back suggestions', found > 0, `found ${found}`);
check('the answer is kept, so the same name is not asked twice',
  (knownGames('hollow') ?? []).length === found);

console.log('a search already answered is shown at once');

await open('  HOLLOW ');
check('a name searched before paints in the same frame as the open', rows().length === found);

console.log('a game opens its page inside the same frame');

await act(async () => {
  rows()[0].querySelector('button').click();
});
check('the page replaces the list rather than stacking a second window',
  document.querySelectorAll('[role="dialog"]').length === 1);
check('and it is about this game: times first', dialog()?.textContent?.includes('How long to beat'));
check('there is a way straight back to the search', !!buttonWith('Search'));

await act(async () => {
  buttonWith('Search').click();
});
check('back puts the results under the cursor again', rows().length === found);
check('back does not close the whole thing', closed === 0);

console.log('adding from the page carries the answers it already has');

await act(async () => {
  rows()[0].querySelector('button').click();
});
await act(async () => settle(1200));
const addToBacklog = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Add to backlog').pop();
check("the game's page offers the one button that writes it down", !!addToBacklog);
await act(async () => {
  addToBacklog.click();
});
await act(async () => settle(50));
check('the game is handed over with the store details it fetched',
  !!added[0]?.facts?.name, JSON.stringify(added[0]?.facts ?? null));
check('and with the times it fetched', (added[0]?.hltb?.main ?? 0) > 0, JSON.stringify(added[0]?.hltb ?? null));
check('and adding it closes the panel', closed === 1);

console.log('a game can be written down as it is typed');

const unknown = 'A Game Nobody Has Heard Of';
await open(unknown);
await act(async () => settle());
const asTyped = buttonWith('Add as typed');
check('the panel offers the name as it was typed, not just what the store found', !!asTyped);
await act(async () => {
  asTyped.click();
});
await act(async () => settle(50));
check('it goes on the list exactly as it was typed',
  added[1]?.name === unknown,
  JSON.stringify(added.map((pick) => pick.name)));
check('and adding it closes the panel', closed === 2);

// The one state this document cannot reach on its own: in the desktop app the
// store can answer with nothing at all, and the panel has to say so rather than
// sit blank. The browser preview always invents a few titles, so this is read
// from the source instead.
const source = readFileSync(new URL('../src/components/detail/PlanDialog.tsx', import.meta.url), 'utf8');
check('an answer with nothing in it is a sentence, not a blank panel',
  source.includes('The store has nothing for'));

console.log('the Backlog page opens it where the player is looking');

const { BacklogView } = await import('../src/components/BacklogView.tsx');
const pageAdded = [];
const view = (extra = {}) =>
  createElement(BacklogView, {
    games: SAMPLE_GAMES,
    onSelect: () => {},
    onEdit: () => {},
    onStatus: () => {},
    onAdd: (game) => pageAdded.push(game),
    onUpdate: () => {},
    onRemove: () => {},
    fetchMetadata: true,
    syncLibrary: false,
    backlogOn: [],
    backlogOff: [],
    onBacklogMembership: () => {},
    myOrder: [],
    setMyOrder: () => {},
    ...extra,
  });

await act(async () => {
  root.render(view());
});
const planButton = buttonWith('Plan a game');
check('the page has one button that opens the plan', !!planButton);
await act(async () => {
  planButton.click();
});
check('pressing it opens the panel over the page', !!dialog() && !document.querySelector('aside'));
check('and the page underneath is untouched by it', !!buttonWith('From the library'));

await act(async () => {
  dialog().parentElement.click();
});
check('clicking outside it leaves, the way every dialog here does', !dialog());
check('and the page is still the page', !!buttonWith('Plan a game'));

await act(async () => settle(300));
root.unmount();

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
for (const [name, descriptor] of previousGlobals) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
