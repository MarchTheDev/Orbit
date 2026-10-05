import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/**
 * A search box with its icon.
 *
 * The icon comes after the input in the document rather than before it: the
 * field itself paints a translucent panel and a backdrop blur, which is enough
 * for a stacking context to swallow an icon that gets in front of it. Placed
 * after, and lifted, it cannot be covered.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  className,
  inputClassName,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Wraps the field, for a width or a margin. */
  className?: string;
  inputClassName?: string;
  /** Anything that belongs on the right, such as a count or a button. */
  children?: ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'glass w-56 rounded-full py-2 pl-4 pr-10 text-sm outline-none focus:border-accent',
            inputClassName,
          )}
        />
        <Search
          className="pointer-events-none absolute right-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
      {children}
    </div>
  );
}
