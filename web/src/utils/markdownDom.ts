/**
 * The two directions between a note and the box it is typed in.
 *
 * The editor is a `contenteditable` element, because that is the only thing in a
 * browser where the text *is* the styling: the markers can disappear as a note
 * is written, the way they do in Discord, and the caret is placed by the browser
 * inside the very text it will end up in, so it can never drift away from where
 * the letters are.
 *
 * Markdown stays the thing that is stored. This module turns markdown into the
 * HTML the editor holds, and turns what the editor holds back into markdown, so
 * the database keeps plain text that can be read, searched and exported, and the
 * editor can do whatever it likes with the picture.
 *
 * Blocks are one line each, marked with `data-md`. A real `<ul>` would fight with
 * the browser's own editing: pressing Enter inside one produces whatever the
 * engine feels like, and half the work is undoing that. A styled line cannot
 * fight back, and the markdown it produces is the same either way.
 */
import { parseBlocks, type Block, type Inline } from './markdown';

/** What a line is, kept on the line itself. */
export const MARK = 'data-md';

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
    // A blank line is a line with an empty box on it, which is exactly what the
    // editor shows: one line, nothing on it.
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
 * line somebody emptied, the `<br>` it keeps at the end of a line as a place for
 * the caret, and the `<span>` it wraps around something for no reason at all.
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

/** The element a caret is in: the line it belongs to, one level under the box. */
export function lineOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  if (el && el.nodeType === 3) el = el.parentElement;
  while (el && isElement(el) && el.parentElement && el.parentElement !== root) el = el.parentElement;
  return isElement(el) && el.parentElement === root ? el : null;
}

/** Is the caret at the very beginning of this line? */
export function atStartOf(line: HTMLElement, range: Range): boolean {
  const upTo = range.cloneRange();
  upTo.selectNodeContents(line);
  upTo.setEnd(range.startContainer, range.startOffset);
  return upTo.toString() === '';
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
  caretTo(selection, next, 0);
  return next;
}

/** Replace a range with the HTML for one inline token, and stand after it. */
export function replaceRange(
  range: Range,
  html: string,
  selection: Selection,
): void {
  const holder = range.startContainer.ownerDocument!.createElement('div');
  holder.innerHTML = html;
  const nodes = Array.from(holder.childNodes);
  if (nodes.length === 0) return;
  const fragment = range.startContainer.ownerDocument!.createDocumentFragment();
  for (const node of nodes) fragment.appendChild(node);
  range.deleteContents();
  range.insertNode(fragment);
  const after = range.startContainer.ownerDocument!.createRange();
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

// ------------------------------------------------------------------- the text

function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3;
}

function isElement(node: Node | null | undefined): node is HTMLElement {
  return !!node && node.nodeType === 1;
}

/** What a text node really says, with the browser's own padding taken out. */
function plain(text: string): string {
  return text.replace(/\u00a0/g, ' ');
}

export function escape(text: string, attribute = false): string {
  const out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return attribute ? out.replace(/"/g, '&quot;') : out;
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
