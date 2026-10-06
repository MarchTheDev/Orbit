/** Render the small, safe Markdown subset Orbit uses for game notes. */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { openExternal } from '../../services/desktop';
import { cn } from '../../utils/cn';
import { parseBlocks, type Block, type Inline, type ListItem } from '../../utils/markdown';

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn('space-y-2.5 text-sm leading-relaxed text-fg', className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'blank':
      return null;
    case 'p':
      return (
        <p className="whitespace-pre-wrap break-words">
          <Run inlines={block.inlines} />
        </p>
      );
    case 'h': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      const size =
        block.level === 1
          ? 'mt-1 text-2xl leading-tight'
          : block.level === 2
            ? 'mt-1 text-xl leading-tight'
            : 'text-base leading-snug';
      return (
        <Tag className={cn('font-bold tracking-tight text-fg', size)}>
          <Run inlines={block.inlines} />
        </Tag>
      );
    }
    case 'ul':
      return (
        <ul className="space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <Box item={item} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 font-mono text-xs text-muted">{item.number ?? i + 1}.</span>
              <span className="min-w-0 break-words">
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
    case 'code':
      return (
        <div className="overflow-hidden rounded-xl border border-line bg-bg/80">
          {block.language && <p className="border-b border-line/70 px-3 py-1 text-[10px] uppercase tracking-widest text-muted">{block.language}</p>}
          <pre className="overflow-x-auto whitespace-pre p-3 font-mono text-xs leading-5 text-fg"><code>{block.text}</code></pre>
        </div>
      );
    case 'rule':
      return <hr className="border-line" />;
  }
}

/** The dot, or the tick box, in front of a list item. */
function Box({ item }: { item: ListItem }) {
  return (
    <>
      {item.box ? (
        <span
          className={cn(
            'mt-[3px] grid size-3.5 shrink-0 place-items-center rounded border text-[9px]',
            item.done ? 'border-accent bg-accent text-white' : 'border-line',
          )}
          aria-hidden
        >
          {item.done ? '\u2713' : ''}
        </span>
      ) : (
        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      )}
      <span className={cn('min-w-0 break-words', item.done && 'text-muted line-through')}>
        <Run inlines={item.inlines} />
      </span>
    </>
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

function Spoiler({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={revealed}
      aria-label={revealed ? 'Hide spoiler' : 'Reveal spoiler'}
      onClick={() => setRevealed((current) => !current)}
      className={cn(
        'rounded px-1 transition-colors',
        revealed ? 'bg-accent/10 text-fg' : 'bg-fg text-fg hover:bg-panel2 focus-visible:bg-panel2 focus-visible:text-fg',
      )}
    >
      {revealed ? text : 'Spoiler'}
    </button>
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
    case 'strongEm':
      return <strong className="font-bold text-fg"><em>{inline.text}</em></strong>;
    case 'em':
      return <em>{inline.text}</em>;
    case 'underline':
      return <u>{inline.text}</u>;
    case 'strike':
      return <del>{inline.text}</del>;
    case 'spoiler':
      return <Spoiler text={inline.text} />;
    case 'code':
      return (
        <code className="break-words rounded-md border border-accent/15 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.9em] text-fg">
          {inline.text}
        </code>
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
