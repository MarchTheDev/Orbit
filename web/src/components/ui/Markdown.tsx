import { useRef } from 'react';
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


/* ------------------------------------------------------------------ writing */

/**
 * Notes, written in one pane with the markdown applied as it is typed.
 *
 * A textarea cannot style what is inside it, so the styling is drawn behind it
 * instead: a mirror layer holds the same characters with the markers muted and
 * the content styled, and the textarea sits on top with transparent text, its
 * caret and its selection still its own. That is the same shape as Discord's
 * message box, where `**this**` turns bold while the asterisks stay visible.
 *
 * Everything is monospace and every line is the same height, on purpose: the
 * textarea's own metrics are what place the caret, so the mirror has to agree
 * with them to the pixel, and a monospace face keeps its advance width when it
 * is bold. Nothing is parsed twice: the same subset as the reader above.
 */
export function MarkdownEditor({
  value,
  onChange,
  rows = 6,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // The mirror does not scroll on its own, so it follows the box that does.
  const follow = () => {
    if (mirror.current && area.current) mirror.current.scrollTop = area.current.scrollTop;
  };

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-line bg-bg/60', className)}>
      <div
        ref={mirror}
        aria-hidden
        // `pr-8` is the scrollbar's width: the box on top reserves that much
        // for one, so the mirror has to as well or a wrapped line breaks in a
        // different place than the caret thinks it does.
        className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 pr-8 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words"
      >
        <Highlight text={value} />
      </div>
      <textarea
        ref={area}
        value={value}
        rows={rows}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={follow}
        placeholder={placeholder}
        // The characters are painted by the mirror; the box keeps the caret,
        // the selection and the scroll.
        style={{ scrollbarGutter: 'stable' }}
        className="relative block w-full resize-y bg-transparent px-3 py-2 font-mono text-[13px] leading-6 text-transparent caret-accent outline-none placeholder:text-muted/60 focus:outline-none selection:bg-accent/30"
      />
    </div>
  );
}

/** The mirror: the same text, with the markdown that carries meaning shown. */
function Highlight({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <div key={i}>{shape(line) ?? '\u200b'}</div>
      ))}
    </>
  );
}

/** The marker characters, dimmed rather than hidden, so the syntax stays visible. */
function Marker({ children }: { children: ReactNode }) {
  return <span className="text-muted/45">{children}</span>;
}

/** One line, styled by what it starts with. */
function shape(line: string): ReactNode {
  const heading = /^(#{1,3})(\s)(.*)$/.exec(line);
  if (heading) {
    return (
      <>
        <Marker>{heading[1]}</Marker>
        {heading[2]}
        <span className="font-bold text-fg">{inlineStyled(heading[3])}</span>
      </>
    );
  }
  const bullet = /^(\s*)([-*])(\s)(.*)$/.exec(line);
  if (bullet) {
    return (
      <>
        {bullet[1]}
        <Marker>{bullet[2]}</Marker>
        {bullet[3]}
        <span className="text-muted">{inlineStyled(bullet[4])}</span>
      </>
    );
  }
  const numbered = /^(\s*)(\d+[.)])(\s)(.*)$/.exec(line);
  if (numbered) {
    return (
      <>
        {numbered[1]}
        <Marker>{numbered[2]}</Marker>
        {numbered[3]}
        {inlineStyled(numbered[4])}
      </>
    );
  }
  const quote = /^(\s*)(>)(\s?)(.*)$/.exec(line);
  if (quote) {
    return (
      <>
        {quote[1]}
        <Marker>{quote[2]}</Marker>
        {quote[3]}
        <span className="italic text-muted">{inlineStyled(quote[4])}</span>
      </>
    );
  }
  if (/^(\s*)(-{3,}|\*{3,}|_{3,})$/.test(line)) return <Marker>{line}</Marker>;
  return <>{inlineStyled(line)}</>;
}

/** Bold, italic, code and links, with their markers left in place. */
function inlineStyled(line: string): ReactNode[] {
  return line
    .split(TOKEN)
    .filter((piece) => piece !== '')
    .map((piece, i) => {
      const bold = /^(\*\*|__)(.+)(\*\*|__)$/.exec(piece);
      if (bold) {
        return (
          <span key={i}>
            <Marker>{bold[1]}</Marker>
            <strong className="font-bold text-fg">{bold[2]}</strong>
            <Marker>{bold[3]}</Marker>
          </span>
        );
      }
      const italic = /^(\*|_)(.+)(\*|_)$/.exec(piece);
      if (italic) {
        return (
          <span key={i}>
            <Marker>{italic[1]}</Marker>
            <em>{italic[2]}</em>
            <Marker>{italic[3]}</Marker>
          </span>
        );
      }
      const code = /^`(.+)`$/.exec(piece);
      if (code) {
        return (
          <span key={i}>
            <Marker>`</Marker>
            <span className="rounded-sm bg-accent/15 text-accent">{code[1]}</span>
            <Marker>`</Marker>
          </span>
        );
      }
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
      if (link) {
        return (
          <span key={i}>
            <Marker>[</Marker>
            <span className="text-accent underline decoration-accent/40 underline-offset-2">{link[1]}</span>
            <Marker>]({link[2]})</Marker>
          </span>
        );
      }
      return piece;
    });
}
