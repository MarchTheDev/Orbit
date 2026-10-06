/**
 * Typing, Return and Backspace, driven the way the browser drives them.
 *
 * Each check builds the box the editor would hold, puts the caret where a
 * person would have it, makes the change a keystroke would make, and then asks
 * the same two questions the editor asks: what does the box look like now, and
 * what markdown comes back out of it.
 *
 * This is what a browser-less environment can still prove: the rules, the
 * splitting, the fillers that keep an empty line typable, and that nothing ever
 * lands outside the box. It is how the Return that "did nothing" was found.
 */
import { JSDOM } from 'jsdom';
import {
  applyBackspace,
  applyReturn,
  applyTyping,
  htmlToMarkdown,
  markdownToHtml,
  tidy,
} from '../src/utils/markdownDom.ts';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
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

/** The box, holding what a note would have put there. */
function box(markdown) {
  const el = document.createElement('div');
  el.innerHTML = markdownToHtml(markdown || '');
  tidy(el);
  document.body.appendChild(el);
  return el;
}

function select(node, offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

/** Put the caret at the end of a line, which is where typing happens. */
function caretAtEnd(selection, line) {
  const last = line.lastChild;
  if (last && last.nodeType === 3) select(last, last.textContent.length);
  else if (last && last.tagName === 'BR') select(line, line.childNodes.length - 1);
  else select(line, line.childNodes.length);
}

/**
 * Type at the end of a line: the characters land in the text, the caret follows,
 * and then the editor's own pass runs on the result.
 */
function type(el, text, selection, lineIndex = el.childNodes.length - 1) {
  const line = el.childNodes[lineIndex];
  if (!line || line.nodeType !== 1) throw new Error('no line to type into');
  // Where the caret will be once the browser has inserted the characters.
  if (line.lastChild && line.lastChild.tagName === 'BR') {
    line.removeChild(line.lastChild);
  }
  const node = line.firstChild && line.firstChild.nodeType === 3 ? line.firstChild : null;
  if (node) node.textContent += text;
  else line.appendChild(document.createTextNode(text));
  if (line.childNodes.length === 0) line.appendChild(document.createElement('br'));
  caretAtEnd(selection, line);
  tidy(el);
  caretAtEnd(selection, line);
  applyTyping(el, selection);
  return line;
}

/** Where the caret is, as "line index: text". */
function caret(selection, el) {
  const range = selection.getRangeAt(0);
  let node = range.startContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const line = el.childNodes.length > 0 ? Array.from(el.childNodes).find((c) => c.contains(node) || c === node) : null;
  const index = line ? Array.from(el.childNodes).indexOf(line) : -1;
  return `${index}:${(line?.textContent ?? '').slice(0, range.startOffset)}`;
}

console.log('a line marker turns into the thing it means');
const lineCases = [
  ['#', 'h1'],
  ['##', 'h2'],
  ['###', 'h3'],
  ['-', 'ul'],
  ['*', 'ul'],
  ['>', 'quote'],
  ['1.', 'ol'],
  ['- [ ]', 'task'],
  ['- [x]', 'task-done'],
];
for (const [typed, mark] of lineCases) {
  const el = box('');
  const selection = window.getSelection();
  select(el.firstChild, 0);
  type(el, `${typed} `, selection);
  const line = el.childNodes[el.childNodes.length - 1];
  check(`${JSON.stringify(`${typed} `)} -> ${mark}`, line.getAttribute('data-md') === mark, line.outerHTML);
}

console.log('\ntyping carries on inside the line that was just made');
{
  const el = box('');
  const selection = window.getSelection();
  select(el.firstChild, 0);
  type(el, '# ', selection);
  type(el, 'Attempt 3', selection);
  const line = el.firstChild;
  check('the heading kept its text', line.textContent === 'Attempt 3', line.outerHTML);
  check('and still says it is a heading', line.getAttribute('data-md') === 'h1');
  check('markdown comes back out', htmlToMarkdown(el) === '# Attempt 3', JSON.stringify(htmlToMarkdown(el)));
  check('the caret stayed in the line', caret(selection, el).startsWith('0:'), caret(selection, el));
}

console.log('\nan inline marker turns into formatting as it closes');
const inlineCases = [
  [' **bold**', '<strong>bold</strong>', 'a **bold**'],
  [' *it*', '<em>it</em>', 'a *it*'],
  [' `code`', '<code>code</code>', 'a `code`'],
  [' [wiki](https://e.com)', '<a href="https://e.com">wiki</a>', 'a [wiki](https://e.com)'],
];
for (const [typed, html, markdown] of inlineCases) {
  const el = box('a');
  const selection = window.getSelection();
  const line = el.firstChild;
  caretAtEnd(selection, line);
  type(el, typed, selection);
  check(`${JSON.stringify(typed)} -> ${html}`, line.innerHTML.includes(html), line.innerHTML);
  check(`${JSON.stringify(typed)} back out as markdown`, htmlToMarkdown(el) === markdown, JSON.stringify(htmlToMarkdown(el)));
}

console.log('\nReturn: a new line, inside the box, with the caret on it');
{
  const el = box('one');
  const selection = window.getSelection();
  caretAtEnd(selection, el.firstChild);
  applyReturn(el, selection);
  check('there are two lines', el.childNodes.length === 2, el.innerHTML);
  check('the first kept its text', el.childNodes[0].textContent === 'one');
  check('the second is empty but typable', el.childNodes[1].childNodes.length > 0, el.childNodes[1].outerHTML);
  check('the caret is in the second line', caret(selection, el).startsWith('1:'), caret(selection, el));
  // A blank line at the very end is not stored: it is the place the caret is,
  // not something anybody wrote.
  check('markdown has the line that was written', htmlToMarkdown(el) === 'one', JSON.stringify(htmlToMarkdown(el)));

  // And typing on the new line lands there rather than anywhere else.
  type(el, 'two', selection);
  check('typing goes on the new line', htmlToMarkdown(el) === 'one\ntwo', JSON.stringify(htmlToMarkdown(el)));
}

console.log('\nReturn in a list gives the next item');
{
  const el = box('- milk');
  const selection = window.getSelection();
  caretAtEnd(selection, el.firstChild);
  applyReturn(el, selection);
  check('the new line is a bullet too', el.childNodes[1].getAttribute('data-md') === 'ul', el.innerHTML);
  type(el, 'eggs', selection);
  check('markdown is a two item list', htmlToMarkdown(el) === '- milk\n- eggs', JSON.stringify(htmlToMarkdown(el)));
}

console.log('\nReturn in a numbered list counts on');
{
  const el = box('1. first');
  const selection = window.getSelection();
  caretAtEnd(selection, el.firstChild);
  applyReturn(el, selection);
  type(el, 'second', selection);
  check('the second line is 2.', el.childNodes[1].getAttribute('data-n') === '2', el.innerHTML);
  check('markdown keeps both numbers', htmlToMarkdown(el) === '1. first\n2. second', JSON.stringify(htmlToMarkdown(el)));
}

console.log('\nReturn on an empty bullet leaves the list');
{
  // What the editor holds the moment somebody finishes typing `- ` and it turns
  // into a bullet: one empty bulleted line.
  const el = box('');
  el.innerHTML = '<div data-md="ul"><br></div>';
  const selection = window.getSelection();
  caretAtEnd(selection, el.firstChild);
  applyReturn(el, selection);
  check('the bullet is gone', el.firstChild.getAttribute('data-md') === null, el.firstChild.outerHTML);
  check('there is still one line', el.childNodes.length === 1, el.innerHTML);
  type(el, 'plain text', selection);
  check('and the line is plain', htmlToMarkdown(el) === 'plain text', JSON.stringify(htmlToMarkdown(el)));
}

console.log('\nReturn with the caret loose in the box still makes a line inside it');
{
  // What the box looks like after everything in it has been deleted: the caret
  // sits on the box itself, with no line around it.
  const el = box('');
  el.innerHTML = '';
  const selection = window.getSelection();
  select(el, 0);
  applyReturn(el, selection);
  check('the box still has one line', el.childNodes.length === 1, el.innerHTML);
  check('the line is inside the box', el.childNodes[0].parentNode === el);
  type(el, 'first thing typed', selection);
  check('typing lands in it', htmlToMarkdown(el) === 'first thing typed', JSON.stringify(htmlToMarkdown(el)));

  // And once there is something on the line, Return makes another one.
  applyReturn(el, selection);
  check('now it makes a second line', el.childNodes.length === 2, el.innerHTML);
}

console.log('\nBackspace at the front of a styled line takes the shape first');
{
  const el = box('# Heading');
  const selection = window.getSelection();
  const line = el.firstChild;
  select(line.firstChild, 0);
  const result = applyBackspace(el, selection);
  check('the heading shape is gone', result === 'changed' && line.getAttribute('data-md') === null, line.outerHTML);
  check('the words are still there', htmlToMarkdown(el) === 'Heading', JSON.stringify(htmlToMarkdown(el)));

  const el2 = box('# Heading');
  const selection2 = window.getSelection();
  const line2 = el2.firstChild;
  caretAtEnd(selection2, line2);
  check('backspace at the end is left to the browser', applyBackspace(el2, selection2) === 'none');
}

console.log('\nan empty line is always somewhere to type');
{
  const el = box('');
  tidy(el);
  check('an empty box has a line with a filler', el.childNodes.length === 1 && el.firstChild.childNodes.length === 1, el.innerHTML);
  check('and still reads as empty', htmlToMarkdown(el) === '', JSON.stringify(htmlToMarkdown(el)));

  const el2 = box('# Heading');
  el2.firstChild.textContent = '';
  tidy(el2);
  check('a line emptied by hand gets its filler back', el2.firstChild.childNodes.length === 1, el2.firstChild.outerHTML);
  check('and reads as an empty heading', htmlToMarkdown(el2) === '# ', JSON.stringify(htmlToMarkdown(el2)));
}

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
