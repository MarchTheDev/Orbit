import type { ReactNode } from 'react';
import { openExternal } from '../../services/desktop';
import { cn } from '../../utils/cn';

/**
 * Notes, written the way anybody types them.
 *
 * A log entry is written in a hurry, and the shape of what was written carries
 * meaning: a line starting with a dash is a list of things done, a heading is a
 * new attempt, a blank line is a new thought. Showing all of that as one grey
 * paragraph throws away what the person already typed.
 *
 * This is deliberately a small subset, not a markdown engine. It covers what
 * somebody writes in a note about a game, and it renders to React elements
 * rather than to HTML: there is no `dangerouslySetInnerHTML` anywhere in here,
 * so a note can never become a way to run something.
 *
 * What works: `#`, `##` and `###` headings, `-` and `*` bullets, `1.` numbers,
 * `- [ ]` and `- [x]` check boxes, `>` quotes, `---` rules, `**bold**`,
 * `*italic*`, `` `code` ``, and `[text](url)` links, which open in the browser
 * rather than navigating the app's own window away from itself.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed', className)}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'p':
            return (
              <p key={i}>
                <Inline text={block.text} />
              </p>
            );
          case 'h':
            return (
              <p
                key={i}
                className={cn(
                  'font-semibold text-fg',
                  block.level === 1 && 'text-base',
                  block.level === 2 && 'text-sm',
                  block.level === 3 && 'text-[13px]',
                )}
              >
                <Inline text={block.text} />
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="space-y-1">
                {block.items.map((item, j) => (
                  <Bullet key={j} item={item} />
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="space-y-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted">{j + 1}.</span>
                    <span className="min-w-0">
                      <Inline text={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={i} className="border-l-2 border-accent/50 pl-3 text-muted">
                <Inline text={block.text} />
              </blockquote>
            );
          case 'rule':
            return <hr key={i} className="border-line" />;
        }
      })}
    </div>
  );
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul'; items: { text: string; box?: boolean; done?: boolean }[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

/** Group the lines into blocks. Nothing is interpreted as markup, only as shape. */
function parse(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      out.push({ kind: 'p', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      flush();
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
      out.push({ kind: 'h', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flush();
      const last = out[out.length - 1];
      // Consecutive quote lines are one quote, not five of them.
      if (last?.kind === 'quote') last.text += `\n${quote[1]}`;
      else out.push({ kind: 'quote', text: quote[1] });
      continue;
    }
    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      flush();
      const item: { text: string; box?: boolean; done?: boolean } = { text: bullet[1] };
      const box = CHECK.exec(item.text);
      if (box) {
        item.box = true;
        item.done = box[1].toLowerCase() === 'x';
        item.text = box[2];
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
      if (last?.kind === 'ol') last.items.push(numbered[1]);
      else out.push({ kind: 'ol', items: [numbered[1]] });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return out;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {inline(line)}
        </span>
      ))}
    </>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(line: string): ReactNode[] {
  return line
    .split(TOKEN)
    .filter((piece) => piece !== '')
    .map((piece, i) => {
      if (/^(\*\*|__).+(\*\*|__)$/.test(piece)) {
        return (
          <strong key={i} className="font-semibold text-fg">
            {piece.slice(2, -2)}
          </strong>
        );
      }
      if (/^(\*|_).+(\*|_)$/.test(piece)) {
        return <em key={i}>{piece.slice(1, -1)}</em>;
      }
      if (/^`.+`$/.test(piece)) {
        return (
          <code key={i} className="rounded bg-panel2 px-1 py-0.5 font-mono text-[0.9em] text-fg">
            {piece.slice(1, -1)}
          </code>
        );
      }
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
      if (link) {
        const [, label, href] = link;
        return (
          <button
            key={i}
            type="button"
            onClick={() => void openExternal(href)}
            title={href}
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {label}
          </button>
        );
      }
      return piece;
    });
}

function Bullet({ item }: { item: { text: string; box?: boolean; done?: boolean } }) {
  return (
    <li className="flex gap-2">
      {item.box ? (
        <span
          className={cn(
            'mt-[3px] grid size-3.5 shrink-0 place-items-center rounded border text-[9px]',
            item.done ? 'border-accent bg-accent text-white' : 'border-line',
          )}
          aria-hidden
        >
          {item.done ? '✓' : ''}
        </span>
      ) : (
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      )}
      <span className={cn('min-w-0', item.done && 'text-muted line-through')}>
        <Inline text={item.text} />
      </span>
    </li>
  );
}
