import { useCallback, useEffect, useRef, useState } from 'react';

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
export function useDragReorder(onReorder?: (fromId: string, toId: string) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const press = useRef<{ id: string; x: number; y: number; live: boolean } | null>(null);
  const overRef = useRef<string | null>(null);
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  overRef.current = over;

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
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under?.closest('[data-orbit-drop]')?.getAttribute('data-orbit-drop') ?? null;
      const next = target && target !== held.id ? target : null;
      if (next !== overRef.current) setOver(next);
    };

    const finish = () => {
      const held = press.current;
      press.current = null;
      document.body.style.userSelect = '';
      if (held?.live) {
        const to = overRef.current;
        if (to) reorderRef.current?.(held.id, to);
        // The release lands on the card the press started on, which the browser
        // reads as a click. It is the end of a drag, so it is swallowed.
        const swallow = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true } as EventListenerOptions), 0);
      }
      setDragging(null);
      setOver(null);
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
            onPointerDown: (e: React.PointerEvent) => {
              if (e.button !== 0) return;
              // A button inside the card is being pressed, not the card.
              if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
              press.current = { id, x: e.clientX, y: e.clientY, live: false };
            },
          }
        : {},
    [onReorder],
  );

  return { bind, dragging, over, active: dragging !== null };
}
