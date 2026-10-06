/** A plain, reliable Markdown source editor with a rendered preview. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Bold, Code2, Eye, EyeOff, Heading2, Italic, Link2, List, ListOrdered, PencilLine, Quote, Strikethrough, Underline } from 'lucide-react';
import { cn } from '../../utils/cn';
import { insertMarkdownNewline } from '../../utils/markdownInput';
import { Markdown } from './MarkdownPreview';

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}

type Mode = 'write' | 'preview';

/**
 * Keep the Markdown visible while writing it, and let the browser handle text
 * editing. A native textarea gives the caret, arrow keys, selection, undo,
 * spaces and IME input their normal behaviour; Preview shows the actual heading,
 * list, quote and inline-code sizes without trying to move the caret around a
 * contenteditable DOM.
 */
export function MarkdownEditor({ value, onChange, rows = 6, placeholder, className }: Props) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const autoHeight = useRef(0);
  const userResized = useRef(false);
  const [mode, setMode] = useState<Mode>('write');

  // Grow with a note until it reaches a comfortable part of the window. After a
  // manual resize, respect the size the player chose instead.
  useEffect(() => {
    const el = box.current;
    if (!el || mode !== 'write' || userResized.current) return;
    const min = rows * 24;
    const max = Math.max(min, Math.round(window.innerHeight * 0.55));
    el.style.height = 'auto';
    const height = Math.min(Math.max(el.scrollHeight, min), max);
    el.style.height = `${height}px`;
    autoHeight.current = height;
  }, [mode, rows, value]);

  const wrapSelection = useCallback(
    (prefix: string, suffix = prefix) => {
      const el = box.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = value.slice(start, end);
      const next = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        const innerStart = start + prefix.length;
        el.setSelectionRange(innerStart, innerStart + selected.length);
      });
    },
    [onChange, value],
  );

  const prefixLine = useCallback(
    (prefix: string) => {
      const el = box.current;
      if (!el) return;
      const start = el.selectionStart;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEndAt = value.indexOf('\n', start);
      const lineEnd = lineEndAt === -1 ? value.length : lineEndAt;
      const line = value.slice(lineStart, lineEnd);
      const alreadyHasPrefix = line.startsWith(prefix);
      const replacement = alreadyHasPrefix ? line.slice(prefix.length) : `${prefix}${line}`;
      const next = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;
      const nextCaret = Math.max(lineStart, start + (alreadyHasPrefix ? -prefix.length : prefix.length));
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [onChange, value],
  );

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      const el = event.currentTarget;
      const edit = insertMarkdownNewline(value, el.selectionStart, el.selectionEnd, !event.shiftKey);
      onChange(edit.value);
      requestAnimationFrame(() => {
        if (!box.current) return;
        box.current.focus();
        box.current.setSelectionRange(edit.caret, edit.caret);
      });
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      wrapSelection('**');
    } else if (key === 'i') {
      event.preventDefault();
      wrapSelection('*');
    } else if (key === 'e') {
      event.preventDefault();
      wrapSelection('`');
    } else if (key === 'x' && event.shiftKey) {
      event.preventDefault();
      wrapSelection('~~');
    }
  };

  const toolbarButton = (
    label: string,
    Icon: typeof Bold,
    action: () => void,
  ) => (
    <button
      type="button"
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
      onClick={action}
      title={label}
      aria-label={label}
      className="grid size-8 place-items-center rounded-lg border border-transparent text-muted transition hover:border-line hover:bg-panel2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon className="size-4" strokeWidth={1.9} />
    </button>
  );

  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line bg-bg/55 shadow-inner focus-within:border-accent/60', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/80 bg-panel2/55 px-3 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="Note editor view">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'write'}
            onClick={() => setMode('write')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              mode === 'write' ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            <PencilLine className="size-3.5" />
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            onClick={() => setMode('preview')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              mode === 'preview' ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            <Eye className="size-3.5" />
            Preview
          </button>
        </div>
        <span className="rounded-full border border-line/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted">
          Markdown
        </span>
      </div>

      {mode === 'write' ? (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-line/60 px-2 py-1.5">
            {toolbarButton('Bold (Ctrl/⌘+B)', Bold, () => wrapSelection('**'))}
            {toolbarButton('Italic (Ctrl/⌘+I)', Italic, () => wrapSelection('*'))}
            {toolbarButton('Strikethrough (Ctrl/⌘+Shift+X)', Strikethrough, () => wrapSelection('~~'))}
            {toolbarButton('Underline', Underline, () => wrapSelection('__'))}
            {toolbarButton('Spoiler', EyeOff, () => wrapSelection('||'))}
            {toolbarButton('Inline code (Ctrl/⌘+E)', Code2, () => wrapSelection('`'))}
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            {toolbarButton('Heading', Heading2, () => prefixLine('## '))}
            {toolbarButton('Bullet list', List, () => prefixLine('- '))}
            {toolbarButton('Numbered list', ListOrdered, () => prefixLine('1. '))}
            {toolbarButton('Quote', Quote, () => prefixLine('> '))}
            {toolbarButton('Link', Link2, () => wrapSelection('[', '](https://)'))}
            <span className="ml-auto hidden text-[10px] text-muted sm:block">Formatting stays as text here; Preview shows the finished note.</span>
          </div>
          <textarea
            ref={box}
            rows={rows}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onEditorKeyDown}
            onMouseUp={() => {
              const el = box.current;
              if (el && Math.abs(el.offsetHeight - autoHeight.current) > 8) userResized.current = true;
            }}
            placeholder={placeholder}
            aria-label="Game note in Markdown"
            spellCheck
            style={{ minHeight: rows * 24, maxHeight: '55vh' }}
            className="block w-full resize-y overflow-auto bg-transparent px-4 py-3 text-sm leading-6 text-fg outline-none placeholder:text-muted/70"
          />
          <p className="border-t border-line/60 px-4 py-2 text-[10px] leading-relaxed text-muted">
            Use <code className="rounded bg-panel2 px-1"># Heading</code>,{' '}
            <code className="rounded bg-panel2 px-1">- list</code>,{' '}
            <code className="rounded bg-panel2 px-1">**bold**</code> or{' '}
            <code className="rounded bg-panel2 px-1">`code`</code>. Enter makes a new line and continues lists and quotes.
          </p>
        </>
      ) : (
        <div className="md-preview min-h-36 max-h-[55vh] overflow-y-auto bg-bg/35 px-4 py-4">
          {value.trim() ? (
            <Markdown text={value} />
          ) : (
            <p className="text-sm text-muted">Nothing to preview yet. Switch to Write to add a note.</p>
          )}
        </div>
      )}
    </div>
  );
}
