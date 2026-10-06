import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Modal({
  title,
  subtitle,
  size = 'md',
  bare = false,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  size?: keyof typeof SIZES;
  /**
   * A dialog that is part of the app rather than a card floating over it.
   *
   * The background is a dim of the page rather than a blur, and the frame is
   * wider and squarer, which is what a list of two hundred games wants: a page
   * big enough to read through rather than a window to be talked into.
   */
  bare?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Pinned to the bottom, for long forms that should not scroll their buttons away. */
  footer?: ReactNode;
}) {
  // Drawn at the end of the document rather than where it is written.
  //
  // A dialog is positioned against the window, and an ancestor with a transform
  // on it, even one left over from an animation, becomes the thing a fixed
  // element is measured against instead: the dialog then sits in the page's own
  // scroll and has to be scrolled to. Nothing in here has to know where it was
  // opened from.
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        bare ? 'bg-bg/85' : 'bg-black/60 backdrop-blur-sm',
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          'flex w-full flex-col overflow-hidden border border-line bg-panel shadow-2xl',
          bare ? 'max-h-[92vh] max-w-6xl rounded-3xl' : `max-h-[88vh] ${SIZES[size]} rounded-2xl`,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The header and footer stay put and the middle scrolls, so a long form
            never pushes its own buttons out of view. Everything sits inside the
            frame with room to breathe: px-6 py-5. */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted hover:bg-panel2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-line bg-panel2/40 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const inputCls = 'w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent';
export const labelCls = 'mb-1 block text-xs uppercase tracking-widest text-muted';
export const btnPrimary = 'btn-accent rounded-lg px-4 py-2 text-sm';
export const btnGhost = 'rounded-lg border border-line bg-panel2 px-4 py-2 text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-40';
/** A Browse button: looks like part of the field it fills. */
export const btnBrowse = 'shrink-0 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent';