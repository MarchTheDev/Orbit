import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { slotAt } from '../utils/reorder';

/** How far the pointer travels before a press counts as a drag. */
const THRESHOLD = 6;

/**
 * Reordering by pointer, rather than by the browser's drag and drop.
 *
 * The webview Orbit runs in reserves drag and drop for files coming from the
 * desktop, which is the same channel a card drag would use, and on Windows that
 * means the browser's drag events never start. Pressing on a card and moving the
 * pointer works regardless: no cooperation from the webview is needed, and it
 * behaves the same with a mouse, a trackpad or a finger.
 *
 * A press that never moves is left alone, so clicking a card still selects it and
 * clicking a button inside one still presses it.
 */
export function useDragReorder(
  onReorder?: (fromId: string, toId: string, after: boolean) => void,
  /**
   * Set for a plain vertical list, and the list reorders itself by where the
   * pointer is rather than by what happens to be under it.
   *
   * `elementFromPoint` is exact, which is the wrong thing for a list of one-line
   * rows: releasing in the few pixels of a gap, or just past the last row, finds
   * nothing at all and the drag is thrown away. Give the list's own element and
   * the nearest slot is worked out from the pointer's height, so a drag that
   * reaches a row always means something.
   */
  options?: {
    container?: RefObject<HTMLElement | null>;
    /**
     * Allow a drag to start on a button.
     *
     * Off by default, because a card with a Play button in it has to keep that
     * button pressable. On for a row that is *itself* a button, which is how the
     * Journal's game list is built: there, refusing the press would mean the row
     * could never be picked up at all. A press that does not move is still a
     * plain click, because the click is only swallowed once something was
     * actually dragged.
     */
    fromButtons?: boolean;
  },
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const press = useRef<{ id: string; x: number; y: number; live: boolean } | null>(null);
  const overRef = useRef<{ id: string; after: boolean } | null>(null);
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const held = press.current;
      if (!held) return;
      if (!held.live) {
        if (Math.hypot(e.clientX - held.x, e.clientY - held.y) < THRESHOLD) return;
        held.live = true;
        setDragging(held.id);
        document.body.style.userSelect = 'none';
      }
      const next = slotUnder(e.clientX, e.clientY, held.id);
      if (next?.id !== overRef.current?.id || next?.after !== overRef.current?.after) {
        overRef.current = next;
        setOver(next?.id ?? null);
      }
    };

    const finish = () => {
      const held = press.current;
      press.current = null;
      document.body.style.userSelect = '';
      if (held?.live) {
        const to = overRef.current;
        if (to) reorderRef.current?.(held.id, to.id, to.after);
        // The release lands on the card the press started on, which the browser
        // reads as a click. It is the end of a drag, so it is swallowed.
        const swallow = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true } as EventListenerOptions), 0);
      }
      overRef.current = null;
      setDragging(null);
      setOver(null);
    };

    /**
     * Which row the pointer is next to, in a vertical list.
     *
     * The rows are walked in the order they are drawn and the pointer's height
     * is compared with the middle of each: everything above the pointer is
     * passed, and the slot is the one after the last of those. Above the first
     * row is the top of the list, below the last row is the bottom of it, and
     * the gap between two rows belongs to whichever one the pointer is nearer,
     * so no pixel in the list is a dead zone.
     */
    const slotUnder = (x: number, y: number, heldId: string): { id: string; after: boolean } | null => {
      const container = optionsRef.current?.container?.current ?? null;
      if (!container) {
        // Not a list: what is under the pointer is the answer, and which half of
        // it the pointer is in decides before or after. Without that, dragging a
        // card downwards only ever moved it one place, because it was always
        // placed before the card it was dropped on.
        const under = document.elementFromPoint(x, y);
        const element = under?.closest('[data-orbit-drop]') ?? null;
        const id = element?.getAttribute('data-orbit-drop') ?? null;
        if (!id || id === heldId) return null;
        const rect = element?.getBoundingClientRect();
        return { id, after: rect ? y > rect.top + rect.height / 2 : false };
      }
      const rows = [...container.querySelectorAll<HTMLElement>('[data-orbit-drop]')].filter(
        (el) => el.getAttribute('data-orbit-drop') !== heldId,
      );
      if (rows.length === 0) return null;
      return slotAt(
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return { id: row.getAttribute('data-orbit-drop')!, top: rect.top, height: rect.height };
        }),
        y,
      );
    };

    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current) finish();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', cancel);
      document.body.style.userSelect = '';
    };
  }, []);

  /**
   * The props for one draggable row or card.
   *
   * `data-orbit-drop` is what the pointer finds under itself; the press is only
   * recorded, and the moving and releasing are handled once for the whole list.
   */
  const bind = useCallback(
    (id: string) =>
      onReorder
        ? {
            'data-orbit-drop': id,
            onPointerDown: (e: ReactPointerEvent) => {
              if (e.button !== 0) return;
              // A button inside the card is being pressed, not the card.
              const interactive = (e.target as HTMLElement).closest('button, a, input, select, textarea');
              if (interactive && !optionsRef.current?.fromButtons) return;
              press.current = { id, x: e.clientX, y: e.clientY, live: false };
            },
          }
        : {},
    [onReorder],
  );

  return { bind, dragging, over, active: dragging !== null };
}
