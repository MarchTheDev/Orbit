/** Result of inserting a new line in the Markdown source. */
export interface NewlineEdit {
  value: string;
  caret: number;
}

/**
 * Insert an explicit newline at the textarea selection.
 *
 * The browser normally inserts Enter for a textarea. Handling it here as well
 * makes the behaviour independent of parent key handlers, and continuing a
 * list/quote is the chat-composer behaviour most people expect from Markdown.
 */
export function insertMarkdownNewline(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  continueMarkers = true,
): NewlineEdit {
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const before = value.slice(lineStart, start);
  const after = value.slice(end, lineEnd);

  if (continueMarkers && start === end && after.length === 0) {
    const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(before);
    const numbered = /^(\s*)(\d+)([.)])\s+(.*)$/.exec(before);
    const quote = /^(\s*)(>{1,3})\s+(.*)$/.exec(before);
    const marker = bullet ?? numbered ?? quote;

    if (marker) {
      const indent = marker[1];
      const content = marker[marker.length - 1];
      const markerStart = lineStart + indent.length;

      // Pressing Enter on an empty marker exits the list/quote instead of
      // creating an endless stack of blank bullets.
      if (!content.trim()) {
        const next = `${value.slice(0, markerStart)}\n${value.slice(lineEnd)}`;
        return { value: next, caret: markerStart + 1 };
      }

      let continuation = '';
      if (bullet) {
        const task = /^\[[ xX]\]\s+/.exec(content);
        continuation = `${indent}${bullet[2]} ${task ? '[ ] ' : ''}`;
      } else if (numbered) {
        continuation = `${indent}${Number(numbered[2]) + 1}${numbered[3]} `;
      } else if (quote) {
        continuation = `${indent}${quote[2]} `;
      }

      const next = `${value.slice(0, start)}\n${continuation}${value.slice(end)}`;
      return { value: next, caret: start + 1 + continuation.length };
    }
  }

  return {
    value: `${value.slice(0, start)}\n${value.slice(end)}`,
    caret: start + 1,
  };
}
