/**
 * Notes, written in one pane, with the markdown applied as it is typed.
 *
 * This is the part that cannot be done with a textarea. A textarea holds plain
 * characters and cannot style them, so the old version drew a second copy of the
 * text behind the box and made the box's own letters transparent. That works
 * until the two disagree: a wrapped line breaks in a different place, the caret
 * sits somewhere the letters are not, and a hidden marker shifts everything
 * after it. It also cannot hide the markers at all, because hidden characters
 * still take up room in the box that has the caret in it.
 *
 * A `contenteditable` element has none of those problems, because the text *is*
 * the styling: `**bold**` becomes a real `<strong>`, the asterisks are gone, and
 * the browser puts the caret in the very text it will end up in.
 *
 * Markdown stays what is stored: `utils/markdownDom` turns the note into the
 * HTML this edits and turns the result back into markdown, and the tests in
 * `web/tests` check that a note comes back out exactly as it went in.
 *
 * What turns into formatting while typing:
 *   `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `[text](url)` as the
 *   closing marker is typed, and `# `, `## `, `### `, `- `, `* `, `1. `, `> `,
 *   `- [ ] `, `- [x] ` when the space after the marker is typed. Return on an
 *   empty bullet leaves the list rather than making another one, and Backspace
 *   at the front of a styled line gives it back its plain shape first.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../../utils/cn';
import {
  COUNT,
  MARK,
  atStartOf,
  caretTo,
  htmlToMarkdown,
  inlineEdit,
  lineEdit,
  lineOf,
  markdownToHtml,
  replaceRange,
  splitLine,
} from '../../utils/markdownDom';

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}

/** One line box, at the same size the reading is drawn at. */
const LINE = 24;

export function MarkdownEditor({ value, onChange, rows = 6, placeholder, className }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  /** The markdown this editor last produced, so its own echo is not re-rendered. */
  const emitted = useRef<string | null>(null);
  const composing = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;

  const syncEmpty = useCallback(() => {
    const el = box.current;
    if (!el) return;
    el.setAttribute('data-empty', (el.textContent ?? '').trim() === '' ? 'true' : 'false');
  }, []);

  /** Write what is in the box back out as markdown. */
  const emit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const markdown = htmlToMarkdown(el);
    syncEmpty();
    if (markdown === emitted.current) return;
    emitted.current = markdown;
    change.current(markdown);
  }, [syncEmpty]);

  // Whatever is in the note when it opens, and anything changed from outside.
  // The editor's own writing comes back through `value` and is left alone, so
  // the caret is never thrown away mid-word.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (value === emitted.current) return;
    el.innerHTML = markdownToHtml(value);
    emitted.current = value;
    syncEmpty();
  }, [value, syncEmpty]);

  /**
   * Turn a marker that has just been completed into the thing it means.
   *
   * Everything here is done to the DOM by hand rather than through
   * `execCommand`, which does different things in different engines. The rules
   * are written as plain patterns so the tests can check them without a browser.
   */
  const formatAsTyped = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !el.contains(range.startContainer)) return;

    if (inlineAtCaret(range, selection)) return;
    lineAtCaret(el, range, selection);
  }, []);

  const onInput = useCallback(() => {
    if (!composing.current) {
      try {
        formatAsTyped();
      } catch {
        // A note typed is worth more than a marker styled: if anything about the
        // caret or the selection is not what it was expected to be, the text is
        // left exactly as it was typed.
      }
    }
    emit();
  }, [emit, formatAsTyped]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const el = box.current;
      if (!el) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const line = lineOf(el, range.startContainer);

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const mark = line?.getAttribute(MARK) ?? null;
        // Return on an empty bullet is how anybody leaves a list. Making
        // another bullet instead is the thing that traps people in one.
        if (line && mark && (line.textContent ?? '').trim() === '') {
          line.removeAttribute(MARK);
          line.removeAttribute(COUNT);
          emit();
          return;
        }
        const next = splitLine(el, line ?? el, range, selection);
        if (mark) next.setAttribute(MARK, mark);
        if (mark === 'ol') {
          const was = Number(line?.getAttribute(COUNT) ?? '1') || 1;
          const before = (line?.textContent ?? '').trim() === '';
          next.setAttribute(COUNT, String(before ? was : was + 1));
        }
        emit();
        return;
      }

      if (event.key === 'Backspace' && line && line.getAttribute(MARK) && atStartOf(line, range)) {
        // The shape goes first, the text second: one press at the front of a
        // bullet takes the bullet away, the next joins the lines like any other.
        event.preventDefault();
        line.removeAttribute(MARK);
        line.removeAttribute(COUNT);
        emit();
      }
    },
    [emit],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      // Plain text only: a paste from a browser would otherwise bring its fonts,
      // its colours and its own markup into a note.
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      document.execCommand('insertText', false, text);
      try {
        formatAsTyped();
      } catch {
        // Same as above: the text landed, which is what matters.
      }
      emit();
    },
    [emit, formatAsTyped],
  );

  return (
    <div className={cn('relative', className)}>
      <div
        ref={box}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        spellCheck={false}
        data-placeholder={placeholder ?? ''}
        data-empty="true"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={emit}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          emit();
        }}
        style={{ minHeight: rows * LINE }}
        className="md-editor w-full resize-y overflow-auto rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent/60"
      />
    </div>
  );
}

/* --------------------------------------------------------------- the rules */

/** Bold, italic, code and links, as the character that closes them is typed. */
function inlineAtCaret(range: Range, selection: Selection): boolean {
  const node = range.startContainer;
  if (node.nodeType !== 3) return false;
  const edit = inlineEdit(node.textContent ?? '', range.startOffset);
  if (!edit) return false;
  const target = document.createRange();
  target.setStart(node, range.startOffset - edit.length);
  target.setEnd(node, range.startOffset);
  replaceRange(target, edit.html, selection);
  return true;
}

/** `# `, `- `, `1. `, `> ` and the check boxes, once the space is typed after them. */
function lineAtCaret(root: HTMLElement, range: Range, selection: Selection): boolean {
  const line = lineOf(root, range.startContainer);
  if (!line || line.getAttribute(MARK) === 'rule') return false;
  // Only when the marker was just finished: converting a line the caret is
  // sitting in the middle of would move the text out from under it.
  const toEnd = range.cloneRange();
  toEnd.selectNodeContents(line);
  toEnd.setStart(range.endContainer, range.endOffset);
  if (toEnd.toString() !== '') return false;

  const edit = lineEdit(line.textContent ?? '');
  if (!edit) return false;

  line.textContent = edit.rest;
  line.setAttribute(MARK, edit.mark);
  if (edit.number === null) line.removeAttribute(COUNT);
  else line.setAttribute(COUNT, String(edit.number));
  caretTo(selection, line, line.childNodes.length);
  return true;
}
