import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { cardAt, moveInOrder, slotAt } from '../utils/reorder';

/**
 * Reorder a list or grid by pressing an item and moving it, with live
 * GitHub-style sibling displacement so neighboring items smoothly glide into
 * their previewed slots before release.
 *
 * Plain HTML5 drag-and-drop (`draggable` + `dragover`) is unreliable inside the
 * desktop WebView here: Tauri's own file-drop listener sits on the window and
 * claims drags that carry text data, so `drop` never reaches the list. Pointer
 * events stay inside the page and work identically in the browser and in the
 * shell.
 *
 * A click still has to be a click, so nothing happens until the pointer has
 * travelled a few pixels from where it went down. Once it has, the click that
 * follows `pointerup` is swallowed on capture so releasing a card over itself
 * does not open it.
 */
const START_PX = 6;
/** Long enough that a tap has already released, short enough to feel immediate. */
const HOLD_MS = 180;

interface DragReorderOptions {
  /**
   * Measure every `[data-orbit-drop]` inside this element and pick the slot from
   * the pointer's coordinates instead of from `elementFromPoint`.
   */
  container?: RefObject<HTMLElement | null>;
  /** Allow a drag to start on a button row when the whole row is a `<button>`. */
  fromButtons?: boolean;
  /** Measure both directions of a card grid instead of only list height. */
  grid?: boolean;
  /** Drop onto the hovered row's slot (`takePlace` semantics). */
  onto?: boolean;
  /** Wait briefly before grabbing, so a tap on a button row still clicks it. */
  hold?: boolean;
}

interface MeasuredSlot {
  id: string;
  dropEl: HTMLElement;
  slotEl: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useDragReorder(
  onReorder: ((fromId: string, toId: string, after: boolean) => void) | undefined,
  options?: DragReorderOptions,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const callback = useRef(onReorder);
  useEffect(() => {
    callback.current = onReorder;
  });
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const gesture = useRef<{
    id: string;
    pointerId: number;
    target: HTMLElement;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    live: boolean;
    ready: boolean;
    over: { id: string; after: boolean } | null;
    timer: number | null;
    shifts: Map<HTMLElement, { x: number; y: number }>;
    styledEls: Set<HTMLElement>;
  } | null>(null);

  useEffect(() => {
    const clearTransforms = (
      held: NonNullable<typeof gesture.current>,
      animateReset = false,
    ) => {
      for (const el of held.styledEls) {
        if (animateReset) {
          el.style.transition = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)';
          el.style.transform = '';
          window.setTimeout(() => {
            el.style.transition = '';
            el.style.zIndex = '';
            el.style.position = '';
            el.style.boxShadow = '';
            el.style.pointerEvents = '';
            el.style.willChange = '';
          }, 170);
        } else {
          el.style.transition = '';
          el.style.transform = '';
          el.style.zIndex = '';
          el.style.position = '';
          el.style.boxShadow = '';
          el.style.pointerEvents = '';
          el.style.willChange = '';
        }
        delete el.dataset.orbitDraggingItem;
      }
      held.shifts.clear();
      held.styledEls.clear();
    };

    const resolveScope = (held: NonNullable<typeof gesture.current>): HTMLElement | null => {
      const explicit = optionsRef.current?.container?.current;
      if (explicit) return explicit;
      let cur: HTMLElement | null = held.target.parentElement;
      while (cur && cur !== document.body) {
        if (cur.querySelectorAll('[data-orbit-drop]').length >= 2) return cur;
        cur = cur.parentElement;
      }
      return held.target.parentElement;
    };

    const measureSlots = (held: NonNullable<typeof gesture.current>): MeasuredSlot[] => {
      const root = resolveScope(held);
      if (!root) return [];
      const dropNodes = Array.from(root.querySelectorAll<HTMLElement>('[data-orbit-drop]'));
      const seen = new Set<string>();
      const slots: MeasuredSlot[] = [];
      for (const dropEl of dropNodes) {
        const id = dropEl.dataset.orbitDrop;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        let slotEl: HTMLElement = dropEl;
        while (slotEl.parentElement && slotEl.parentElement !== root) {
          slotEl = slotEl.parentElement;
        }
        const rect = slotEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const applied = held.shifts.get(slotEl) ?? { x: 0, y: 0 };
        slots.push({
          id,
          dropEl,
          slotEl,
          left: rect.left - applied.x,
          top: rect.top - applied.y,
          width: rect.width,
          height: rect.height,
        });
      }
      return slots;
    };

    const isMultiColumn = (slots: MeasuredSlot[]): boolean => {
      if (optionsRef.current?.grid) return true;
      for (let i = 1; i < slots.length; i += 1) {
        const a = slots[i - 1];
        const b = slots[i];
        if (Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.5) {
          return true;
        }
      }
      return false;
    };

    /** Pick the target slot from untransformed layout boxes so shifting items never jitter hit-testing. */
    const slotUnder = (
      held: NonNullable<typeof gesture.current>,
      slots: MeasuredSlot[],
      x: number,
      y: number,
    ): { id: string; after: boolean } | null => {
      const heldId = held.id;
      if (slots.length < 2) return null;

      if (isMultiColumn(slots) || optionsRef.current?.onto) {
        const cards = slots.map((s) => ({
          id: s.id,
          left: s.left,
          top: s.top,
          width: s.width,
          height: s.height,
        }));
        const id = cardAt(cards, x, y, heldId);
        if (!id) return null;
        const from = cards.findIndex((card) => card.id === heldId);
        const to = cards.findIndex((card) => card.id === id);
        if (from < 0 || to < 0 || from === to) return null;
        return { id, after: to > from };
      }

      const first = slots[0];
      const last = slots[slots.length - 1];
      const minX = Math.min(...slots.map((s) => s.left)) - 80;
      const maxX = Math.max(...slots.map((s) => s.left + s.width)) + 80;
      if (x < minX || x > maxX || y < first.top - first.height || y > last.top + last.height * 2) {
        return null;
      }

      const rows = slots.map((s) => ({ id: s.id, top: s.top, height: s.height }));
      const picked = slotAt(rows, y);
      if (!picked) return null;
      const nextIds = moveInOrder(
        slots.map((s) => s.id),
        heldId,
        picked.id,
        picked.after,
      );
      if (nextIds.every((id, idx) => id === slots[idx].id)) {
        return null;
      }
      return picked;
    };

    const applyLivePreview = (
      held: NonNullable<typeof gesture.current>,
      slots: MeasuredSlot[],
      to: { id: string; after: boolean } | null,
    ) => {
      const fromIdx = slots.findIndex((s) => s.id === held.id);
      if (fromIdx < 0) return;

      const gridMode = isMultiColumn(slots);
      const baseIds = slots.map((s) => s.id);
      const nextIds =
        to && to.id !== held.id ? moveInOrder(baseIds, held.id, to.id, to.after) : baseIds;
      const targetIdx = nextIds.indexOf(held.id);

      // Dragged card follows the pointer directly with crisp elevation
      const draggedSlot = slots[fromIdx];
      const dx = gridMode ? held.lastX - held.x : (held.lastX - held.x) * 0.14;
      const dy = held.lastY - held.y;
      draggedSlot.slotEl.dataset.orbitDraggingItem = 'true';
      draggedSlot.slotEl.style.transition = 'box-shadow 140ms ease';
      draggedSlot.slotEl.style.willChange = 'transform';
      draggedSlot.slotEl.style.position = 'relative';
      draggedSlot.slotEl.style.zIndex = '40';
      draggedSlot.slotEl.style.pointerEvents = 'none';
      draggedSlot.slotEl.style.boxShadow =
        '0 16px 34px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px color-mix(in srgb, var(--c-accent) 45%, transparent)';
      draggedSlot.slotEl.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      held.shifts.set(draggedSlot.slotEl, { x: dx, y: dy });
      held.styledEls.add(draggedSlot.slotEl);

      // Neighboring items smoothly animate into their previewed positions
      for (let origIdx = 0; origIdx < slots.length; origIdx += 1) {
        if (origIdx === fromIdx) continue;
        const item = slots[origIdx];
        const newIdx = nextIds.indexOf(item.id);
        let sx = 0;
        let sy = 0;

        if (newIdx >= 0 && newIdx !== origIdx) {
          if (gridMode) {
            sx = slots[newIdx].left - item.left;
            sy = slots[newIdx].top - item.top;
          } else if (targetIdx > fromIdx && origIdx > fromIdx && origIdx <= targetIdx) {
            // Dragging downward: items between fromIdx+1..targetIdx shift up by the vacated span
            const step = slots[fromIdx + 1].top - slots[fromIdx].top;
            sy = -step;
          } else if (targetIdx < fromIdx && origIdx >= targetIdx && origIdx < fromIdx) {
            // Dragging upward: items between targetIdx..fromIdx-1 shift down by the vacated span
            const prev = slots[fromIdx - 1];
            const step = (slots[fromIdx].top + slots[fromIdx].height) - (prev.top + prev.height);
            sy = step;
          }
        }

        item.slotEl.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
        item.slotEl.style.willChange = 'transform';
        item.slotEl.style.transform = sx !== 0 || sy !== 0 ? `translate3d(${sx}px, ${sy}px, 0)` : '';
        held.shifts.set(item.slotEl, { x: sx, y: sy });
        held.styledEls.add(item.slotEl);
      }
    };

    const start = (held: NonNullable<typeof gesture.current>) => {
      if (held.live) return;
      held.live = true;
      try {
        held.target.setPointerCapture?.(held.pointerId);
      } catch {
        // Synthetic test events may not have an active pointer id.
      }
      setDragging(held.id);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      const slots = measureSlots(held);
      applyLivePreview(held, slots, held.over);
    };

    const move = (e: PointerEvent) => {
      const held = gesture.current;
      if (!held) return;
      held.lastX = e.clientX;
      held.lastY = e.clientY;

      if (!held.live) {
        const moved = Math.hypot(e.clientX - held.x, e.clientY - held.y);
        if (!held.ready) {
          if (moved >= START_PX) {
            if (held.timer !== null) window.clearTimeout(held.timer);
            gesture.current = null;
          }
          return;
        }
        if (moved < START_PX) return;
        start(held);
      }

      const slots = measureSlots(held);
      const to = slotUnder(held, slots, e.clientX, e.clientY);
      held.over = to;
      setOver(to && to.id !== held.id ? to.id : null);
      applyLivePreview(held, slots, to);
    };

    const finish = (commit: boolean) => {
      const held = gesture.current;
      if (!held) return;
      if (held.timer !== null) window.clearTimeout(held.timer);
      gesture.current = null;
      if (!held.live) return;

      const willReorder = Boolean(commit && held.over && held.over.id !== held.id);
      // Clear inline transforms right before React commits the new DOM order so
      // items land seamlessly in their final layout slots with zero flash.
      clearTransforms(held, !willReorder);

      setDragging(null);
      setOver(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      if (willReorder && held.over) {
        callback.current?.(held.id, held.over.id, held.over.after);
      }

      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 80);
    };

    const up = () => finish(true);
    const cancel = () => finish(false);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      const held = gesture.current;
      if (held) {
        if (held.timer !== null) window.clearTimeout(held.timer);
        clearTransforms(held, false);
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  /** Spread onto each movable element. Renders as nothing at all when disabled. */
  const bind = (id: string) =>
    onReorder
      ? {
          'data-orbit-drop': id,
          onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            const blocked = options?.fromButtons
              ? 'a, input, textarea, select, [role="button"], [data-orbit-no-drag]'
              : 'button, a, input, textarea, select, [role="button"], [data-orbit-no-drag]';
            if (target?.closest(blocked)) return;
            const held = {
              id,
              pointerId: e.pointerId,
              target: e.currentTarget,
              x: e.clientX,
              y: e.clientY,
              lastX: e.clientX,
              lastY: e.clientY,
              live: false,
              ready: !options?.hold,
              over: null,
              timer: null as number | null,
              shifts: new Map<HTMLElement, { x: number; y: number }>(),
              styledEls: new Set<HTMLElement>(),
            };
            if (options?.hold) {
              held.timer = window.setTimeout(() => {
                if (gesture.current !== held) return;
                held.ready = true;
                startIfStillHeld(held);
              }, HOLD_MS);
            }
            gesture.current = held;
          },
        }
      : {};

  function startIfStillHeld(held: NonNullable<typeof gesture.current>) {
    if (held.live) return;
    held.live = true;
    try {
      held.target.setPointerCapture?.(held.pointerId);
    } catch {
      // Synthetic test events may not have an active pointer id.
    }
    setDragging(held.id);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }

  return { bind, dragging, over, active: dragging !== null };
}
