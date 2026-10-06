/**
 * The markdown Orbit understands, read once and used twice.
 *
 * The reader draws a note as it is stored, and the editor draws the same note
 * while somebody is typing it, so both are fed from this: one parser, and no
 * chance of the two disagreeing about what `- [x] done` means.
 *
 * It is deliberately small. This is not a markdown engine: it is the subset
 * somebody writes in a note about a game, and every rule here exists because a
 * line of a game log turns up that way. Nothing is interpreted as markup beyond
 * this list, and nothing here can execute: the reader turns these nodes into
 * React elements rather than into HTML.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export interface ListItem {
  inlines: Inline[];
  /** A `- [ ]` line, which is drawn as a box rather than as a dot. */
  box?: boolean;
  done?: boolean;
  /** The number a `3.` line was written with, kept so it stays that number. */
  number?: number;
}

export type Block =
  /** A blank line. Nothing is drawn for it, but it is what separates one
   *  paragraph from the next, so it has to survive being read. */
  | { kind: 'blank' }
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'h'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'ul'; items: ListItem[] }
  | { kind: 'ol'; items: ListItem[] }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'rule' };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^>\s?(.*)$/;

/** The pieces of a line that carry meaning, markers and all. */
const TOKEN =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/**
 * The lines of a note, grouped into the blocks they make.
 *
 * A blank line starts a new paragraph, a run of `-` lines is one list rather
 * than five lists of one, and everything else keeps the shape it was typed in.
 */
export function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    out.push({ kind: 'p', inlines: parseLines(paragraph) });
    paragraph = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      flush();
      out.push({ kind: 'blank' });
      continue;
    }
    if (RULE.test(trimmed)) {
      flush();
      out.push({ kind: 'rule' });
      continue;
    }
    const heading = HEADING.exec(trimmed);
    if (heading) {
      flush();
      out.push({
        kind: 'h',
        level: heading[1].length as 1 | 2 | 3,
        inlines: parseInline(heading[2]),
      });
      continue;
    }
    const quote = QUOTE.exec(trimmed);
    if (quote) {
      flush();
      const last = out[out.length - 1];
      // Consecutive quote lines are one quote, not five of them.
      if (last?.kind === 'quote') last.inlines.push({ kind: 'br' }, ...parseInline(quote[1]));
      else out.push({ kind: 'quote', inlines: parseInline(quote[1]) });
      continue;
    }
    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      flush();
      const item: ListItem = { inlines: parseInline(bullet[1]) };
      const box = CHECK.exec(collapse(item.inlines));
      if (box) {
        item.box = true;
        item.done = box[1].toLowerCase() === 'x';
        item.inlines = parseInline(box[2]);
      }
      const last = out[out.length - 1];
      if (last?.kind === 'ul') last.items.push(item);
      else out.push({ kind: 'ul', items: [item] });
      continue;
    }
    const numbered = NUMBERED.exec(trimmed);
    if (numbered) {
      flush();
      const last = out[out.length - 1];
      const item: ListItem = {
        inlines: parseInline(numbered[1]),
        number: Number.parseInt(trimmed, 10) || undefined,
      };
      if (last?.kind === 'ol') last.items.push(item);
      else out.push({ kind: 'ol', items: [item] });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return out;
}

/** The text of a run of inlines, markers dropped: used to look for a check box. */
function collapse(inlines: Inline[]): string {
  return inlines.map((i) => (i.kind === 'br' ? '\n' : i.text)).join('');
}

/** One line's worth of inlines. */
export function parseInline(text: string): Inline[] {
  return text
    .split(TOKEN)
    .filter((piece) => piece !== '')
    .map((piece) => {
      const bold = /^(\*\*|__)(.+)(\*\*|__)$/.exec(piece);
      if (bold) return { kind: 'strong', text: bold[2] } as Inline;
      const italic = /^(\*|_)(.+)(\*|_)$/.exec(piece);
      if (italic) return { kind: 'em', text: italic[2] } as Inline;
      const code = /^`(.+)`$/.exec(piece);
      if (code) return { kind: 'code', text: code[1] } as Inline;
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
      if (link) return { kind: 'link', text: link[1], href: link[2] } as Inline;
      return { kind: 'text', text: piece } as Inline;
    });
}

/** Lines of one paragraph, with the line breaks the player typed kept. */
function parseLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ kind: 'br' });
    out.push(...parseInline(line));
  });
  return out;
}
