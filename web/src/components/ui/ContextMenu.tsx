import { useEffect, useRef } from 'react';
import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '../../utils/cn';
import type { Game } from '../../types';

/**
 * A menu where the pointer was right-clicked.
 *
 * A desktop app is expected to answer a right click, and a library of games is
 * exactly the place for it: everything that can be done to a game is one press
 * away from the game itself, without opening it first.
 *
 * Two details make it feel like the platform's own menu rather than a box that
 * happens to appear: it never opens past the edge of the window, and it closes
 * on anything that is not a click inside it, including a scroll, another right
 * click and the window losing focus.
 */
export interface MenuItem {
  /** A separator between groups, or a heading when it has a label. */
  kind?: 'sep' | 'label';
  label?: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** What a list needs to hand a right click up to the app. */
export type ContextHandler = (game: Game, e: ReactMouseEvent) => void;

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  // Pulled back inside the window after it is measured, so a right click near
  // the bottom or the right edge still shows the whole menu.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overflowX = rect.right - window.innerWidth + 8;
    const overflowY = rect.bottom - window.innerHeight + 8;
    if (overflowX > 0) el.style.left = `${Math.max(8, x - overflowX)}px`;
    if (overflowY > 0) el.style.top = `${Math.max(8, y - overflowY)}px`;
  }, [x, y]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      // A right click on another game moves the menu rather than closing it:
      // the app's own handler reopens it where the pointer is.
      if (
        e.type === 'contextmenu' &&
        (e.target as HTMLElement | null)?.closest?.('[data-orbit-game], [data-orbit-session], [data-orbit-journal-game], [data-orbit-session-game]')
      ) return;
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // A scroll anywhere, or the window losing focus, leaves the menu pointing at
    // something that has moved or at nothing at all.
    document.addEventListener('mousedown', away);
    document.addEventListener('contextmenu', away);
    window.addEventListener('keydown', escape);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('contextmenu', away);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-52 overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-2xl"
    >
      {items.map((item, i) => {
        if (item.kind === 'sep') return <div key={i} className="my-1 h-px bg-line" />;
        if (item.kind === 'label') {
          return (
            <p key={i} className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-widest text-muted">
              {item.label}
            </p>
          );
        }
        const Icon = item.icon;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition',
              item.danger ? 'text-rose-400' : 'text-fg',
              item.disabled
                ? 'cursor-not-allowed opacity-40'
                : item.danger
                  ? 'hover:bg-rose-500/10'
                  : 'hover:bg-panel2',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0 opacity-80" />}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
