/**
 * The two directions between a note and the box it is typed in, and every
 * editing decision that happens in between.
 *
 * The editor is a `contenteditable` element, because that is the only thing in a
 * browser where the text *is* the styling: the markers disappear as a note is
 * written, the way they do in Discord, and the caret is placed by the browser
 * inside the very text it will end up in, so it can never drift away from where
 * the letters are.
 *
 * Markdown stays the thing that is stored. This module turns markdown into the
 * HTML the editor holds, turns what the editor holds back into markdown, and
 * decides what a keystroke means. All of it is plain DOM work with no React in
 * it, which is on purpose: `web/tests` drives it in jsdom and checks the typing
 * rules, Return, Backspace and the round trip without a browser anywhere.
 *
 * Blocks are one line each, marked with `data-md`. A real `<ul>` would fight
 * with the browser's own editing: pressing Return inside one produces whatever
 * the engine feels like, and half the work would be undoing that. A styled line
 * cannot fight back, and the markdown it produces is the same either way.
 */
import { parseBlocks, type Block, type Inline } from './markdown';

/** What a line is, kept on the line itself. */
export const MARK = 'data-md';

/**
 * The invisible character that gives the caret somewhere to stand.
 *
 * A line that ends in something styled, `` `code` `` or **bold**, has no text
 * after it, and a caret between two elements is a caret the browser is free to
 * ignore: pressing Right does nothing, and the next character typed goes back
 * inside the styling. One zero-width space after the element is a real text
 * node, so the caret can stand there, the arrow keys move through it, and a
 * space typed there lands outside the code rather than inside it.
 *
 * It is not part of the note. `plain()` takes it out of every text node on the
 * way to markdown, so a holder can never end up saved.
 */
export const HOLDER = '\u200b';

/**
 * Give a line somewhere for the caret to stand after its last styled run.
 *
 * Called everywhere a line is finished with, so the state the browser edits is
 * always one where the caret can move out of what it is in.
 */
export function padLine(line: HTMLElement): boolean {
  const last = line.lastChild;
  if (!last || !isElement(last) || last.tagName === 'BR') return false;
  line.appendChild(line.ownerDocument.createTextNode(HOLDER));
  return true;
}

/** Is this an element the caret would otherwise be trapped inside of? */
function isInline(el: Element): boolean {
  return ['STRONG', 'B', 'EM', 'I', 'CODE', 'A'].includes(el.tagName);
}

/** How many a numbered line is, so the numbers survive editing. */
export const COUNT = 'data-n';

export function markdownToHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  // An empty box still has to have somewhere for the caret to be.
  if (blocks.length === 0) return '<div><br></div>';
  return blocks.map(blockToHtml).join('');
}

function blockToHtml(block: Block): string {
  switch (block.kind) {
    // A blank line is a line with an empty box on it, which is what the editor
    // shows: one line, nothing on it.
    case 'blank':
      return '<div><br></div>';
    case 'p':
      return `<div>${inlinesToHtml(block.inlines)}</div>`;
    case 'h':
      return `<div ${MARK}="h${block.level}">${inlinesToHtml(block.inlines)}</div>`;
    case 'ul':
      return block.items
        .map((item) => {
          const mark = item.box ? (item.done ? 'task-done' : 'task') : 'ul';
          return `<div ${MARK}="${mark}">${inlinesToHtml(item.inlines)}</div>`;
        })
        .join('');
    case 'ol':
      return block.items
        // The number the line was written with, not a count of where it sits in
        // the list: a note that says `3.` keeps saying `3.`.
        .map((item, i) => `<div ${MARK}="ol" ${COUNT}="${item.number ?? i + 1}">${inlinesToHtml(item.inlines)}</div>`)
        .join('');
    case 'quote':
      return `<div ${MARK}="quote">${inlinesToHtml(block.inlines)}</div>`;
    case 'rule':
      return `<div ${MARK}="rule"></div>`;
  }
}

function inlinesToHtml(inlines: Inline[]): string {
  return inlines.map(inlineToHtml).join('');
}

function inlineToHtml(inline: Inline): string {
  switch (inline.kind) {
    case 'text':
      return escape(inline.text);
    case 'br':
      return '<br>';
    case 'strong':
      return `<strong>${escape(inline.text)}</strong>`;
    case 'em':
      return `<em>${escape(inline.text)}</em>`;
    case 'code':
      return `<code>${escape(inline.text)}</code>`;
    case 'link':
      return `<a href="${escape(inline.href, true)}">${escape(inline.text)}</a>`;
  }
}

/**
 * What the editor is holding, written back as markdown.
 *
 * Everything the browser can leave behind is handled: the `&nbsp;` it puts in a
 * line somebody emptied, the `<br>` it keeps as a place for the caret, and the
 * `<span>` it wraps around something for no reason at all.
 */
export function htmlToMarkdown(root: HTMLElement): string {
  const lines: string[] = [];

  for (const node of Array.from(root.childNodes)) {
    if (isText(node)) {
      const text = plain(node.textContent ?? '').trim();
      if (text) lines.push(text);
      continue;
    }
    if (!isElement(node)) continue;
    if (node.tagName === 'BR') {
      lines.push('');
      continue;
    }
    const mark = node.getAttribute(MARK) ?? '';
    const prefix = prefixFor(mark, node);
    // A soft break inside one line becomes a line of its own, with the same
    // bullet or number in front of it.
    for (const part of elementToMarkdown(node).split('\n')) lines.push(prefix + part);
  }

  // Nothing after the last line anybody typed.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

function prefixFor(mark: string, el: HTMLElement): string {
  switch (mark) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'ul':
      return '- ';
    case 'task':
      return '- [ ] ';
    case 'task-done':
      return '- [x] ';
    case 'ol':
      return `${el.getAttribute(COUNT) ?? '1'}. `;
    case 'quote':
      return '> ';
    case 'rule':
      return '---';
    default:
      return '';
  }
}

function elementToMarkdown(el: HTMLElement): string {
  const kids = Array.from(el.childNodes);
  let out = '';

  kids.forEach((node, i) => {
    if (isText(node)) {
      out += plain(node.textContent ?? '');
      return;
    }
    if (!isElement(node)) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      // A break at the very end of a line is the browser's own caret holder
      // rather than a break anybody pressed.
      if (i === kids.length - 1) return;
      out += '\n';
      return;
    }

    const inner = elementToMarkdown(node);
    if (tag === 'STRONG' || tag === 'B') out += `**${inner}**`;
    else if (tag === 'EM' || tag === 'I') out += `*${inner}*`;
    else if (tag === 'CODE') out += '`' + inner + '`';
    else if (tag === 'A') out += `[${inner}](${node.getAttribute('href') ?? ''})`;
    // A span, a div left by a paste, anything else: what is inside it is the
    // text, and the wrapper is the browser's business.
    else out += inner;
  });

  return out;
}

/* ------------------------------------------------------- finding your place */

/** The element a caret is in: the line it belongs to, one level under the box. */
export function lineOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  if (isText(el)) el = el.parentElement;
  while (el && isElement(el) && el.parentElement && el.parentElement !== root) el = el.parentElement;
  return isElement(el) && el.parentElement === root ? el : null;
}

/** Is the caret at the very beginning of this line? */
export function atStartOf(line: HTMLElement, range: Range): boolean {
  const upTo = line.ownerDocument.createRange();
  upTo.selectNodeContents(line);
  try {
    upTo.setEnd(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  return upTo.toString().split(HOLDER).join('') === '';
}

/**
 * Split a line at the caret, and put the caret on the new one.
 *
 * Written out by hand rather than left to the browser's `execCommand`, which
 * does different things in different engines and cannot be asked what it did.
 * `extractContents` is the part that is specified properly: it moves everything
 * after the caret, formatting and all, into the new line.
 */
export function splitLine(root: HTMLElement, line: HTMLElement, range: Range, selection: Selection): HTMLElement {
  const next = root.ownerDocument.createElement('div');
  const tail = root.ownerDocument.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  if (line.lastChild) tail.setEndAfter(line.lastChild);
  else tail.setEnd(line, 0);
  if (!tail.collapsed) next.appendChild(tail.extractContents());
  line.after(next);
  caretInto(selection, next);
  return next;
}

/** Replace a range with the HTML for one inline token, and stand after it. */
export function replaceRange(range: Range, html: string, selection: Selection): void {
  const doc = range.startContainer.ownerDocument!;
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  const nodes = Array.from(holder.childNodes);
  if (nodes.length === 0) return;
  const fragment = doc.createDocumentFragment();
  for (const node of nodes) fragment.appendChild(node);
  range.deleteContents();
  range.insertNode(fragment);
  const after = doc.createRange();
  after.setStartAfter(nodes[nodes.length - 1]);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Put the caret at a place in a line: a character or an index among children. */
export function caretTo(selection: Selection, line: HTMLElement, offset: number): void {
  const range = line.ownerDocument.createRange();
  range.setStart(line, Math.min(offset, line.childNodes.length));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Stand at the end of a line, in the text rather than between the elements.
 *
 * Placing a caret "at index N" of an element is legal and useless: the next
 * keystroke then goes wherever the browser decides, which is often not inside
 * the line anybody was looking at.
 */
export function caretInto(selection: Selection, line: HTMLElement): void {
  // A line that ends in something styled needs a place for the caret before it
  // can be put anywhere useful.
  const holder = padLine(line);
  const range = line.ownerDocument.createRange();
  const last = line.lastChild;
  if (holder && isText(last)) {
    range.setStart(last, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  if (isText(last)) {
    range.setStart(last, last.textContent?.length ?? 0);
  } else if (isElement(last) && last.tagName === 'BR') {
    // Just before the filler, so the next thing typed lands in the line rather
    // than after it.
    range.setStart(line, line.childNodes.length - 1);
  } else {
    range.setStart(line, line.childNodes.length);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/* --------------------------------------------------------- what typing means */

/** A finished inline marker, and what it should become. */
export interface InlineEdit {
  /** How much of the text before the caret the marker takes up. */
  length: number;
  html: string;
}

/**
 * Is there a finished `**bold**`, `*italic*`, `` `code` `` or `[text](url)` at
 * the end of this text? The longest marker wins, so `**bold**` is never read as
 * two italics, and a marker only counts when it is closed: half of one is just
 * text until somebody finishes it.
 */
export function inlineEdit(text: string, offset: number): InlineEdit | null {
  const before = text.slice(0, offset);
  const rules: [RegExp, (parts: RegExpExecArray) => string][] = [
    [/\*\*([^*]+)\*\*$/, (m) => `<strong>${escape(m[1])}</strong>`],
    [/`([^`]+)`$/, (m) => `<code>${escape(m[1])}</code>`],
    [/\[([^\]]+)\]\(([^)\s]+)\)$/, (m) => `<a href="${escape(m[2], true)}">${escape(m[1])}</a>`],
    [/(?<!\*)\*([^*]+)\*$/, (m) => `<em>${escape(m[1])}</em>`],
    [/(?<!_)_([^_]+)_$/, (m) => `<em>${escape(m[1])}</em>`],
  ];
  for (const [pattern, build] of rules) {
    const match = pattern.exec(before);
    if (!match) continue;
    return { length: match[0].length, html: build(match) };
  }
  return null;
}

/** A finished line marker, and what the line it was typed on becomes. */
export interface LineEdit {
  /** `h1`, `h2`, `h3`, `ul`, `ol`, `quote`, `task` or `task-done`. */
  mark: string;
  /** The number an `ol` line was written with, if it was. */
  number: number | null;
  /** What is left of the line once the marker is gone. */
  rest: string;
}

/**
 * The markers that turn a line into something: `# `, `## `, `### `, `- `, `1. `,
 * `> ` and the check boxes. A line that does not start with one of those is a
 * line of text, which is the answer for almost every line anybody writes.
 */
export function lineEdit(text: string): LineEdit | null {
  const task = /^([-*])\s+\[([ xX])\]\s+(.*)$/.exec(text);
  if (task) {
    return {
      mark: task[2].toLowerCase() === 'x' ? 'task-done' : 'task',
      number: null,
      rest: task[3],
    };
  }
  const mark = /^(#{1,3}|[-*]|>|\d+[.)])\s+(.*)$/.exec(text);
  if (!mark) return null;
  if (mark[1].startsWith('#')) return { mark: `h${mark[1].length}`, number: null, rest: mark[2] };
  if (mark[1] === '>') return { mark: 'quote', number: null, rest: mark[2] };
  if (/^\d/.test(mark[1])) {
    return { mark: 'ol', number: Number.parseInt(mark[1], 10) || 1, rest: mark[2] };
  }
  return { mark: 'ul', number: null, rest: mark[2] };
}

/* ------------------------------------------------ the moves the editor makes */

/** What a piece of editing did. */
export const TYPING = {
  /** Nothing to do: the text stays exactly as it was typed. */
  none: 'none',
  /** The DOM changed and the note should be written out again. */
  changed: 'changed',
} as const;

export type TypingResult = (typeof TYPING)[keyof typeof TYPING];

/**
 * The line the caret is in, creating one if the caret is loose in the box.
 *
 * A `contenteditable` can hold text directly, with no line around it: that is
 * what happens after the box is emptied, and after a paste the browser did not
 * wrap. Everything below works on a line, so one is made rather than each of
 * them having to cope. Getting this wrong is what made Return look like it did
 * nothing at all: the new line went *beside* the box instead of inside it, and
 * typing then went somewhere nobody could see.
 */
export function lineAt(root: HTMLElement, selection: Selection): HTMLElement {
  const range = selection.getRangeAt(0);
  const existing = lineOf(root, range.startContainer);
  if (existing) return existing;

  const doc = root.ownerDocument;
  const line = doc.createElement('div');

  if (range.startContainer === root && root.childNodes.length > 0) {
    // Between two lines: the new line takes the caret's place among its
    // siblings, and nothing else moves.
    const at = Math.min(range.startOffset, root.childNodes.length);
    const after = root.childNodes[at] ?? null;
    if (after) root.insertBefore(line, after);
    else root.appendChild(line);
  } else {
    // Loose text, or an empty box: everything in the box is one line, which is
    // what the box meant anyway.
    Array.from(root.childNodes).forEach((node) => line.appendChild(node));
    root.appendChild(line);
  }

  caretInto(selection, line);
  return line;
}

/**
 * The formatting that happens while typing: `**bold**` becoming bold, `# `
 * becoming a heading, and so on.
 *
 * Runs on every keystroke and answers whether anything changed. Nothing here
 * throws on anything unexpected: a note somebody is in the middle of typing is
 * worth more than a marker getting styled, so anything that does not look
 * exactly like a finished marker is left alone.
 */
export function applyTyping(root: HTMLElement, selection: Selection): TypingResult {
  if (selection.rangeCount === 0) return TYPING.none;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return TYPING.none;

  // Inline markers first: they are the ones that replace text inside a line.
  const node = range.startContainer;
  if (isText(node)) {
    const edit = inlineEdit(node.textContent ?? '', range.startOffset);
    if (edit) {
      const target = root.ownerDocument.createRange();
      target.setStart(node, range.startOffset - edit.length);
      target.setEnd(node, range.startOffset);
      replaceRange(target, edit.html, selection);
      // The caret is standing after the new element; a holder makes that a
      // place it can type a space into without going back inside.
      const after = lineOf(root, selection.getRangeAt(0).startContainer);
      if (after) padLine(after);
      return TYPING.changed;
    }
  }

  const line = lineOf(root, range.startContainer);
  if (!line || line.getAttribute(MARK) === 'rule') return TYPING.none;
  // Only when the marker was just finished: converting a line the caret is
  // sitting in the middle of would move the text out from under it.
  const toEnd = root.ownerDocument.createRange();
  toEnd.selectNodeContents(line);
  try {
    toEnd.setStart(range.endContainer, range.endOffset);
  } catch {
    return TYPING.none;
  }
  if (toEnd.toString() !== '') return TYPING.none;

  const edit = lineEdit(line.textContent ?? '');
  if (!edit) return TYPING.none;

  line.textContent = edit.rest;
  line.setAttribute(MARK, edit.mark);
  if (edit.number === null) line.removeAttribute(COUNT);
  else line.setAttribute(COUNT, String(edit.number));
  caretInto(selection, line);
  return TYPING.changed;
}

/**
 * Return, which is the key that has to keep working whatever else is going on.
 *
 * On an empty bullet it leaves the list, because another empty bullet is what
 * traps people in one. Everywhere else it splits the line at the caret and
 * stands at the front of the new line, keeping whatever the line was: Return in
 * a list should give the next item, not a plain paragraph.
 */
export function applyReturn(root: HTMLElement, selection: Selection): TypingResult {
  if (selection.rangeCount === 0) return TYPING.none;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return TYPING.none;

  // `lineAt` can make a line and move the caret into it, so the range is read
  // again afterwards: a range that still points at the box rather than at a line
  // splits the box itself, which puts the new line outside it.
  const line = lineAt(root, selection);
  const at = selection.getRangeAt(0);
  const mark = line.getAttribute(MARK);
  const empty = (line.textContent ?? '').trim() === '';

  if (mark && empty) {
    line.removeAttribute(MARK);
    line.removeAttribute(COUNT);
    caretInto(selection, line);
    return TYPING.changed;
  }

  // An empty box is already one empty line: Return there has nothing to make.
  if (!mark && empty && root.childNodes.length === 1) return TYPING.none;

  const wasNumber = Number(line.getAttribute(COUNT) ?? '1') || 1;
  const next = splitLine(root, line, at, selection);
  if (mark) next.setAttribute(MARK, mark);
  if (mark === 'ol') next.setAttribute(COUNT, String(empty ? wasNumber : wasNumber + 1));
  caretInto(selection, next);
  return TYPING.changed;
}

/**
 * Backspace at the front of a styled line: the shape goes first, the text
 * second. One press takes the bullet away, the next joins the lines like any
 * other backspace, which is what people expect from an editor that hides its
 * markers.
 */
export function applyBackspace(root: HTMLElement, selection: Selection): TypingResult {
  if (selection.rangeCount === 0 || !selection.isCollapsed) return TYPING.none;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return TYPING.none;
  const line = lineOf(root, range.startContainer);
  if (!line) return TYPING.none;
  const mark = line.getAttribute(MARK);
  if (!mark || !atStartOf(line, range)) return TYPING.none;
  line.removeAttribute(MARK);
  line.removeAttribute(COUNT);
  return TYPING.changed;
}

/**
 * Put back the filler an empty line needs.
 *
 * A line with nothing in it has no place for a caret, so the browser gives up on
 * it: pressing Return and getting nowhere, or typing into a line that never
 * appears, is what that looks like from the outside. A `<br>` gives the line
 * something to be, and still comes out as an empty line in markdown.
 */
export function tidy(root: HTMLElement): boolean {
  let changed = false;
  const doc = root.ownerDocument;

  // Text loose in the box would never come back out as markdown, so it is given
  // a line of its own.
  for (const node of Array.from(root.childNodes)) {
    if (isText(node)) {
      if ((node.textContent ?? '').trim() === '') {
        node.remove();
      } else {
        const line = doc.createElement('div');
        root.insertBefore(line, node);
        line.appendChild(node);
      }
      changed = true;
    } else if (isElement(node) && node.tagName === 'BR') {
      node.remove();
      changed = true;
    }
  }

  if (root.childNodes.length === 0) {
    root.appendChild(doc.createElement('div'));
    changed = true;
  }

  for (const node of Array.from(root.childNodes)) {
    if (!isElement(node) || node.tagName === 'BR') continue;
    if (node.childNodes.length === 0) {
      node.appendChild(doc.createElement('br'));
      changed = true;
      continue;
    }
    // Something styled at the end of a line: the caret gets a text node to
    // stand in, so it can be typed out of rather than being stuck inside.
    if (isInline(node.lastElementChild ?? ({} as Element)) && isElement(node.lastChild)) {
      padLine(node);
      changed = true;
    }
  }
  return changed;
}

/* ------------------------------------------------------------------- helpers */

function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3;
}

function isElement(node: Node | null | undefined): node is HTMLElement {
  return !!node && node.nodeType === 1;
}

/** What a text node really says, with the browser's own padding taken out. */
function plain(text: string): string {
  return text.split(HOLDER).join('').replace(/\u00a0/g, ' ');
}

export function escape(text: string, attribute = false): string {
  const out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return attribute ? out.replace(/"/g, '&quot;') : out;
}
