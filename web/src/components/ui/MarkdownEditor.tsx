/**
 * Notes, written in one pane, with the markdown applied as it is typed.
 *
 * This is the part that cannot be done with a textarea. A textarea holds plain
 * characters and cannot style them, so the first two attempts drew a second copy
 * of the text behind the box and made the box's own letters transparent. That
 * works until the two copies disagree, and they do: a wrapped line breaks in a
 * different place, and hidden markers still take up room in the box that holds
 * the caret, so the caret ends up a word away from the letters it is in.
 *
 * A `contenteditable` element has none of that, because the text *is* the
 * styling: `**bold**` becomes a real `<strong>` with the asterisks gone, and the
 * browser puts the caret inside the very text it will end up in.
 *
 * Every decision about *what* to do lives in `utils/markdownDom`, which the
 * checks can reach without a browser: this file is the wiring around it, and the
 * three things it does in its own right are all recovery, for the moments when
 * the browser has left the box in a state nobody planned.
 *
 * Markdown is still what is stored. `utils/markdownDom` turns a note into the
 * HTML this edits and turns the result back into markdown on the way out, and
 * `web/tests` checks that a note comes back exactly as it went in.
 *
 * What turns into formatting while typing:
 *   `**bold**`, `*italic*`, `_italic_`, `` `code` `` and `[text](url)` as the
 *   closing character is typed; `# `, `## `, `### `, `- `, `* `, `1. `, `> `,
 *   `- [ ] ` and `- [x] ` when the space after the marker is typed.
 * Return on an empty bullet leaves the list rather than making another one, and
 * Backspace at the front of a styled line gives it back its plain shape first.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../../utils/cn';
import {
  applyBackspace,
  applyReturn,
  applyTyping,
  htmlToMarkdown,
  markdownToHtml,
  tidy,
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
  /** The last height this set itself, so a resize by hand can be told apart. */
  const auto = useRef(0);
  const resized = useRef(false);
  /** The markdown this editor last produced, so its own echo is not re-rendered. */
  const emitted = useRef<string | null>(null);
  const composing = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;

  /**
   * Grow with what is written, up to most of the window.
   *
   * A note box with a fixed height is a box somebody has to scroll inside to
   * read what they just wrote, which makes a short note feel cramped and a long
   * one feel broken. It starts at the size it was asked for and gets taller as
   * the note does; dragging its own corner is respected, and then it leaves the
   * height alone.
   */
  const grow = useCallback(() => {
    const el = box.current;
    if (!el || resized.current) return;
    el.style.height = 'auto';
    const ceiling = Math.max(rows * LINE, Math.round(window.innerHeight * 0.6));
    const wanted = Math.min(Math.max(el.scrollHeight, rows * LINE), ceiling);
    el.style.height = `${wanted}px`;
    auto.current = wanted;
  }, [rows]);

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
    grow();
    if (markdown === emitted.current) return;
    emitted.current = markdown;
    change.current(markdown);
  }, [grow, syncEmpty]);

  /**
   * Whatever is in the note when it opens, and anything changed from outside.
   *
   * The guard is what keeps typing safe. A re-render can arrive with an older
   * value than what is in the box: a page that keeps its own draft, a write that
   * has not landed yet, a clock that re-renders every second. Reading the box
   * and finding it already says what the value says means nothing has to happen,
   * and while the box has the focus nothing is ever thrown away, because the
   * person typing is the authority on what the note says.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (value === emitted.current) return;
    if (htmlToMarkdown(el) === value || document.activeElement === el) {
      emitted.current = value;
      return;
    }
    el.innerHTML = markdownToHtml(value);
    tidy(el);
    emitted.current = value;
    syncEmpty();
    grow();
  }, [grow, value, syncEmpty]);

  /** Where the caret is, in the box, or null if it is not in the box at all. */
  const here = useCallback((): { el: HTMLDivElement; selection: Selection } | null => {
    const el = box.current;
    if (!el) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    if (!el.contains(selection.getRangeAt(0).startContainer)) return null;
    return { el, selection };
  }, []);

  /** The whole pass: put the filler back, then do whatever was just typed. */
  const afterEdit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    if (!composing.current) {
      const spot = here();
      if (spot) {
        try {
          tidy(spot.el);
          applyTyping(spot.el, spot.selection);
        } catch {
          // A note somebody is typing is worth more than a marker getting
          // styled: if anything about the caret is not what it was expected to
          // be, the text is left exactly as it was typed.
        }
      } else {
        tidy(el);
      }
    }
    emit();
  }, [emit, here]);

  const onInput = useCallback(() => {
    afterEdit();
    // Some engines update the box after the event rather than before it, so the
    // same pass is offered again once the frame has been drawn. It is
    // idempotent: a marker already turned into formatting matches nothing the
    // second time.
    if (!composing.current) {
      requestAnimationFrame(() => {
        const spot = here();
        if (!spot) return;
        try {
          applyTyping(spot.el, spot.selection);
        } catch {
          // Same as above.
        }
        emit();
      });
    }
  }, [afterEdit, emit, here]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const spot = here();
      if (!spot) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        // Shift+Return is a line break inside the paragraph, and is left to the
        // browser: it is a different thing from a new line, and markdown writes
        // the two differently.
        if (!spot.selection.isCollapsed) return;
        event.preventDefault();
        try {
          tidy(spot.el);
          applyReturn(spot.el, spot.selection);
        } catch {
          // If Return cannot be handled here, it is put back rather than done
          // badly: the box keeps the caret and the browser's own behaviour runs.
          document.execCommand('insertParagraph');
        }
        emit();
        return;
      }

      if (event.key === 'Backspace') {
        try {
          if (applyBackspace(spot.el, spot.selection) === 'changed') {
            event.preventDefault();
            emit();
          }
        } catch {
          // Left to the browser.
        }
      }
    },
    [emit, here],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      // Plain text only: a paste from a browser would otherwise bring its fonts,
      // its colours and its own markup into a note.
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      document.execCommand('insertText', false, text);
      afterEdit();
    },
    [afterEdit],
  );

  return (
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
      // A drag of the box's own corner is the player saying how tall they want
      // it, so the growing stops for as long as that lasts.
      onMouseUp={() => {
        const el = box.current;
        if (el && Math.abs(el.offsetHeight - auto.current) > 8) resized.current = true;
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        afterEdit();
      }}
      style={{ height: rows * LINE, maxHeight: '60vh' }}
      className={cn(
        'md-editor w-full resize-y overflow-auto rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent/60',
        className,
      )}
    />
  );
}
