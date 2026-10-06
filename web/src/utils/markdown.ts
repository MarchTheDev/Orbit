/**
 * Discord-like Markdown for Orbit's game notes and journal entries.
 *
 * It intentionally renders a small safe subset as React nodes rather than
 * turning Markdown into HTML. The editor and reader share this parser so the
 * Preview always agrees with what is saved.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | { kind: 'strong'; text: string }
  | { kind: 'strongEm'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'underline'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'spoiler'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export interface ListItem {
  inlines: Inline[];
  /** A `- [ ]` line, which is drawn as a checkbox rather than a dot. */
  box?: boolean;
  done?: boolean;
  /** The number a `3.` line was written with, kept so it stays that number. */
  number?: number;
}

export type Block =
  | { kind: 'blank' }
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'h'; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: 'ul'; items: ListItem[] }
  | { kind: 'ol'; items: ListItem[] }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'rule' };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;
const RULE = /^(---+|\*\*\*+|___+)$/;
const QUOTE = /^(>{1,3})\s?(.*)$/;

/** Markdown markers that are common in Discord messages, ordered longest first. */
const TOKEN =
  /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<>]+)/gi;

/** The lines of a note, grouped into the blocks they make. */
export function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let fenced: { language: string; lines: string[] } | null = null;
  let quoteAll = false;

  const flush = () => {
    if (paragraph.length === 0) return;
    out.push({ kind: 'p', inlines: parseLines(paragraph) });
    paragraph = [];
  };

  const appendQuoteLine = (line: string) => {
    const last = out[out.length - 1];
    if (last?.kind === 'quote') last.inlines.push({ kind: 'br' }, ...parseInline(line));
    else out.push({ kind: 'quote', inlines: parseInline(line) });
  };

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (fenced) {
      if (/^```\s*$/.test(trimmed)) {
        out.push({ kind: 'code', text: fenced.lines.join('\n'), language: fenced.language });
        fenced = null;
      } else {
        fenced.lines.push(raw);
      }
      continue;
    }

    if (/^```/.test(trimmed)) {
      flush();
      fenced = { language: trimmed.slice(3).trim().split(/\s+/)[0] ?? '', lines: [] };
      quoteAll = false;
      continue;
    }

    if (trimmed === '') {
      flush();
      quoteAll = false;
      out.push({ kind: 'blank' });
      continue;
    }

    // Discord's `>>>` form quotes every following line up to the next blank.
    if (quoteAll && !QUOTE.test(trimmed)) {
      flush();
      appendQuoteLine(raw.trimEnd());
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flush();
      quoteAll = false;
      out.push({ kind: 'h', level: heading[1].length as 1 | 2 | 3, inlines: parseInline(heading[2]) });
      continue;
    }

    if (RULE.test(trimmed)) {
      flush();
      quoteAll = false;
      out.push({ kind: 'rule' });
      continue;
    }

    const quote = QUOTE.exec(trimmed);
    if (quote) {
      flush();
      appendQuoteLine(quote[2]);
      quoteAll = quoteAll || quote[1].length === 3;
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      flush();
      quoteAll = false;
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
      quoteAll = false;
      const item: ListItem = { inlines: parseInline(numbered[2]), number: Number.parseInt(numbered[1], 10) };
      const last = out[out.length - 1];
      if (last?.kind === 'ol') last.items.push(item);
      else out.push({ kind: 'ol', items: [item] });
      continue;
    }

    quoteAll = false;
    paragraph.push(raw.trimEnd());
  }

  flush();
  if (fenced) out.push({ kind: 'code', text: fenced.lines.join('\n'), language: fenced.language });
  return out;
}

/** The text of a run of inlines, markers dropped: used to look for a check box. */
function collapse(inlines: Inline[]): string {
  return inlines.map((inline) => (inline.kind === 'br' ? '\n' : inline.text)).join('');
}

/** One line's worth of Discord-style inline formatting. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const piece of text.split(TOKEN).filter((part) => part !== '')) {
    const both = /^\*\*\*(.+)\*\*\*$/.exec(piece);
    if (both) {
      out.push({ kind: 'strongEm', text: both[1] });
      continue;
    }
    const bold = /^\*\*(.+)\*\*$/.exec(piece);
    if (bold) {
      out.push({ kind: 'strong', text: bold[1] });
      continue;
    }
    const underline = /^__(.+)__$/.exec(piece);
    if (underline) {
      out.push({ kind: 'underline', text: underline[1] });
      continue;
    }
    const strike = /^~~(.+)~~$/.exec(piece);
    if (strike) {
      out.push({ kind: 'strike', text: strike[1] });
      continue;
    }
    const spoiler = /^\|\|(.+)\|\|$/.exec(piece);
    if (spoiler) {
      out.push({ kind: 'spoiler', text: spoiler[1] });
      continue;
    }
    const italic = /^(\*|_)(.+)\1$/.exec(piece);
    if (italic) {
      out.push({ kind: 'em', text: italic[2] });
      continue;
    }
    const code = /^`(.+)`$/.exec(piece);
    if (code) {
      out.push({ kind: 'code', text: code[1] });
      continue;
    }
    const link = /^\[([^\]]+)\]\(((?:https?:\/\/|steam:\/\/)[^)\s]+)\)$/i.exec(piece);
    if (link) {
      out.push({ kind: 'link', text: link[1], href: link[2] });
      continue;
    }
    const autolink = /^<(https?:\/\/[^>\s]+)>$/i.exec(piece);
    if (autolink) {
      out.push({ kind: 'link', text: autolink[1], href: autolink[1] });
      continue;
    }
    const url = /^(https?:\/\/[^\s<>]+)$/i.exec(piece);
    if (url) {
      // Sentence punctuation belongs after the link, not in its address.
      const href = url[1].replace(/[.,!?;:]+$/, '');
      const trailing = url[1].slice(href.length);
      if (href) out.push({ kind: 'link', text: href, href });
      if (trailing) out.push({ kind: 'text', text: trailing });
      continue;
    }
    out.push({ kind: 'text', text: piece });
  }
  return out;
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
