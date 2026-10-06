/**
 * The round trip a note makes, checked.
 *
 * The editor turns markdown into the HTML it edits and turns that HTML back into
 * markdown on the way to the database. If that pair of moves is not exactly
 * reversible, notes change shape every time somebody opens one, so this checks
 * the shape of a note before and after: markdown, into the editor, and back out
 * again has to give the same markdown.
 *
 * Run it with `npm test` in `web/`. It needs no browser: jsdom is enough for the
 * DOM walking, and the rules that only need a string are checked as strings.
 */
import { JSDOM } from 'jsdom';
import { parseBlocks } from '../src/utils/markdown.ts';
import {
  COUNT,
  MARK,
  inlineEdit,
  lineEdit,
  atStartOf,
  htmlToMarkdown,
  markdownToHtml,
  replaceRange,
  splitLine,
} from '../src/utils/markdownDom.ts';

const { window } = new JSDOM('<!doctype html><html><body><div id="box"></div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Selection = window.Selection;

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

/** Put markdown in a box, the way the editor does, and read it back out. */
function roundTrip(markdown) {
  const box = document.createElement('div');
  box.innerHTML = markdownToHtml(markdown);
  return htmlToMarkdown(box);
}

function box(markdown) {
  const el = document.createElement('div');
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

console.log('a note keeps its shape through the editor');
const notes = [
  '# Attempt 3',
  '# Attempt 3\nBeat **the boss** on the *third* try.',
  '- milk\n- eggs',
  '1. go left\n2. jump',
  '- [x] found the key\n- [ ] opened the door',
  '> worth remembering',
  '---',
  'Press `F5` to reload.',
  'See [the wiki](https://example.com) for the rest.',
  '# Attempt 3\n\nBeat **the boss** on the *third* try.\n\n- [x] found the key\n- [ ] opened the door\n\n> worth remembering\n\n---\n\nPress `F5`.',
  'line one\nline two',
  '3. a\n4. b',
  'plain text with no markup at all',
];

for (const note of notes) {
  const back = roundTrip(note);
  check(JSON.stringify(note).slice(0, 60), back === note, `got ${JSON.stringify(back)}`);
}

console.log('\nthe blocks that come out');
const parsed = parseBlocks('- [x] done\n\n## Heading\n\n> quoted');
const real = parsed.filter((b) => b.kind !== 'blank');
check('three blocks, with the blank lines kept between them', real.length === 3, JSON.stringify(parsed.map((b) => b.kind)));
check('a ticked box', real[0].items[0].done === true);
check('a level two heading', real[1].kind === 'h' && real[1].level === 2);
check('bold survives parsing', parseBlocks('a **b** c')[0].inlines.some((i) => i.kind === 'strong'));

console.log('\ntyping: markers turn into formatting');
/** What the editor does when the caret is at the end of a text node. */
function typed(text) {
  const el = box('<div>placeholder</div>');
  const line = el.firstChild;
  line.textContent = text;
  const range = document.createRange();
  range.setStart(line.firstChild, text.length);
  range.collapse(true);
  return { el, line, range };
}

{
  const { el } = typed('a **bold**');
  const line = el.firstChild;
  const range = document.createRange();
  range.setStart(line.firstChild, line.textContent.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  replaceRange(
    (() => {
      const r = document.createRange();
      r.setStart(line.firstChild, 2);
      r.setEnd(line.firstChild, 10);
      return r;
    })(),
    '<strong>bold</strong>',
    selection,
  );
  check('the asterisks are gone', !line.textContent.includes('*'), line.innerHTML);
  check('and the word is bold', line.querySelector('strong')?.textContent === 'bold', line.innerHTML);
  check('back out as markdown', htmlToMarkdown(el) === 'a **bold**', JSON.stringify(htmlToMarkdown(el)));
}

console.log('\ntyping: what the rules make of it');
const inlineCases = [
  ['a **bold**', 10, '<strong>', 'bold'],
  ['x *it*', 6, '<em>', 'it'],
  ['x _it_', 6, '<em>', 'it'],
  ['press `F5`', 10, '<code>', 'F5'],
  ['see [wiki](https://e.com)', 25, '<a href="https://e.com">', 'wiki'],
  ['a * and **b**', 13, '<strong>', 'b'],
  ['half a **bold', 13, null, null],
  ['2 * 3 = 6', 9, null, null],
];
for (const [text, offset, tag, inner] of inlineCases) {
  const edit = inlineEdit(text, offset);
  const ok = tag === null ? edit === null : !!edit && edit.html.includes(tag) && edit.html.includes(inner);
  check(`${JSON.stringify(text)} -> ${tag ?? 'nothing'}`, ok, edit ? edit.html : 'no match');
}

const lineCases = [
  ['# Title', 'h1', null, 'Title'],
  ['## Title', 'h2', null, 'Title'],
  ['### Title', 'h3', null, 'Title'],
  ['- milk', 'ul', null, 'milk'],
  ['* milk', 'ul', null, 'milk'],
  ['> quote', 'quote', null, 'quote'],
  ['1. first', 'ol', 1, 'first'],
  ['7) seventh', 'ol', 7, 'seventh'],
  ['- [ ] todo', 'task', null, 'todo'],
  ['- [x] done', 'task-done', null, 'done'],
  ['just words', null, null, null],
  ['-ness is a word', null, null, null],
];
for (const [text, mark, number, rest] of lineCases) {
  const edit = lineEdit(text);
  const ok =
    mark === null
      ? edit === null
      : !!edit && edit.mark === mark && edit.rest === rest && edit.number === number;
  check(`${JSON.stringify(text)} -> ${mark ?? 'plain'}`, ok, JSON.stringify(edit));
}

console.log('\nReturn: a line splits, and a list carries on');
{
  const el = box('- milk');
  const line = el.firstChild;
  check('the bullet is on the line', line.getAttribute(MARK) === 'ul');
  const range = document.createRange();
  range.setStart(line.firstChild, line.firstChild.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const next = splitLine(el, line, range, selection);
  next.setAttribute(MARK, 'ul');
  check('a second bullet appears', el.children.length === 2, el.innerHTML);
  check('nothing was lost', htmlToMarkdown(el) === '- milk\n- ', JSON.stringify(htmlToMarkdown(el)));

  // Splitting in the middle has to move the tail, formatting and all.
  const el2 = box('- milk and eggs');
  const line2 = el2.firstChild;
  const range2 = document.createRange();
  range2.setStart(line2.firstChild, 5); // just before "and"
  range2.collapse(true);
  const selection2 = window.getSelection();
  selection2.removeAllRanges();
  selection2.addRange(range2);
  splitLine(el2, line2, range2, selection2);
  check('the tail moved across', el2.children[1].textContent === 'and eggs', el2.innerHTML);
}

console.log('\nnumbers, and where the caret is in a line');
{
  const el = box('1. first');
  check('numbering is written on the line', el.firstChild.getAttribute(COUNT) === '1');
  const line = el.firstChild;
  const range = document.createRange();
  range.setStart(line.firstChild, 0);
  range.collapse(true);
  check('the caret at the start knows it', atStartOf(line, range) === true);
  const range2 = document.createRange();
  range2.setStart(line.firstChild, 3);
  range2.collapse(true);
  check('and so does one in the middle', atStartOf(line, range2) === false);
}

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
