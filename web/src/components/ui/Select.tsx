import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * A dropdown that looks like the rest of Orbit.
 *
 * A native `<select>` is drawn by the operating system: on Windows it is a grey
 * box with a system arrow, in a system popup, sitting in the middle of a dark
 * panel. It cannot be styled into place, so the control is drawn here instead,
 * with the same border, radius and accent as everything else.
 *
 * What matters is kept: it opens on click, closes on escape or on a click
 * outside, moves with the arrow keys, and announces itself as a listbox, so
 * nothing about it is a picture of a dropdown.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  menuClassName,
  placeholder = 'Choose',
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  /** Sizing and colour of the closed control. */
  className?: string;
  /** The popup, when it needs to be wider than the control. */
  menuClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Clicking anywhere else closes it, which is what everybody expects and the
  // only thing that makes a dropdown with no modal behind it usable.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => (e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1)));
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      const picked = options[active];
      if (picked) {
        onChange(picked.value);
        setOpen(false);
      }
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={keys}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-left outline-none transition',
          'hover:border-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30',
          open && 'border-accent',
          className,
        )}
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          role="listbox"
          className={cn(
            // Above the drawer, and never clipped by it.
            'absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-72 min-w-full overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-2xl',
            menuClassName,
          )}
        >
          {options.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition',
                  i === active ? 'bg-accent/15' : 'hover:bg-panel2',
                  o.value === value && 'text-fg',
                )}
              >
                <Check className={cn('mt-0.5 size-3.5 shrink-0 text-accent', o.value === value ? '' : 'opacity-0')} />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block text-[10px] text-muted">{o.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
