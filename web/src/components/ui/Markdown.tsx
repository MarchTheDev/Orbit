/**
 * Notes, read back.
 *
 * A log entry is written in a hurry, and the shape of what was written carries
 * meaning: a line starting with a dash is a list of things done, a heading is a
 * new attempt, a blank line is a new thought. Showing all of that as one grey
 * paragraph throws away what the person already typed.
 *
 * The parsing lives in `utils/markdown`, which the editor uses as well, so what
 * is drawn here and what is drawn while typing cannot disagree. Everything is
 * React elements: there is no `dangerouslySetInnerHTML` anywhere in this file,
 * so a note can never become a way to run something.
 *
 * Links open in the browser rather than navigating the app's own window away
 * from itself, which is why they are buttons and not anchors.
 */
import type { ReactNode } from 'react';
import { openExternal } from '../../services/desktop';
import { cn } from '../../utils/cn';
import { parseBlocks, type Block, type Inline, type ListItem } from '../../utils/markdown';

export { MarkdownEditor } from './MarkdownEditor';

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-fg', className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'blank':
      // The blank line is spacing, and the spacing is already there.
      return null;
    case 'p':
      return (
        <p>
          <Run inlines={block.inlines} />
        </p>
      );
    case 'h':
      return (
        <p
          className={cn(
            // Three sizes that can be told apart, matching what the editor
            // draws as the markers disappear: a heading is a heading at a
            // glance, not a slightly larger paragraph.
            'font-bold tracking-tight text-fg',
            block.level === 1 && 'mt-1 text-xl',
            block.level === 2 && 'mt-1 text-[17px]',
            block.level === 3 && 'text-[15.5px]',
          )}
        >
          <Run inlines={block.inlines} />
        </p>
      );
    case 'ul':
      return (
        <ul className="space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <Box item={item} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 font-mono text-xs text-muted">{item.number ?? i + 1}.</span>
              <span className="min-w-0">
                <Run inlines={item.inlines} />
              </span>
            </li>
          ))}
        </ol>
      );
    case 'quote':
      return (
        <blockquote className="border-l-2 border-accent/50 pl-3 text-muted">
          <Run inlines={block.inlines} />
        </blockquote>
      );
    case 'rule':
      return <hr className="border-line" />;
  }
}

/** The dot, or the tick box, in front of a list item. */
function Box({ item }: { item: ListItem }) {
  if (!item.box) return <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />;
  return (
    <span
      className={cn(
        'mt-[3px] grid size-3.5 shrink-0 place-items-center rounded border text-[9px]',
        item.done ? 'border-accent bg-accent text-white' : 'border-line',
      )}
      aria-hidden
    >
      {item.done ? '\u2713' : ''}
    </span>
  );
}

function Run({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, i) => (
        <Piece key={i} inline={inline} />
      ))}
    </>
  );
}

function Piece({ inline }: { inline: Inline }): ReactNode {
  switch (inline.kind) {
    case 'text':
      return inline.text;
    case 'br':
      return <br />;
    case 'strong':
      return <strong className="font-bold text-fg">{inline.text}</strong>;
    case 'em':
      return <em>{inline.text}</em>;
    case 'code':
      return (
        <code className="rounded bg-panel2 px-1 py-0.5 font-mono text-[0.9em] text-fg">{inline.text}</code>
      );
    case 'link':
      return (
        <button
          type="button"
          onClick={() => void openExternal(inline.href)}
          title={inline.href}
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {inline.text}
        </button>
      );
  }
}
