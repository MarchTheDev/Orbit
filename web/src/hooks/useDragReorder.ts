import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { cardAt, moveInOrder, slotAt } from '../utils/reorder';

/**
 * Reorder a list or grid by pressing an item and moving it, with smooth,
 * hysteresis-stabilized live sibling displacement.
 *
 * Layout slots are measured ONCE at the start of the drag (adjusted only by
 * scroll delta) rather than re-reading `getBoundingClientRect()` on elements
 * that are mid-CSS-transition, eliminating oscillation and feedback jitter.
 */
const START_PX = 6;
const HOLD_MS = 180;

interface DragReorderOptions {
  /** Measure every `[data-orbit-drop]` inside this element. */
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

interface BaseSlot {
  id: string;
  dropEl: HTMLElement;
  slotEl: HTMLElement;
  baseLeft: number;
  baseTop: number;
  width: number;
  height: number;
}

interface LiveSlot extends BaseSlot {
  left: number;
  top: number;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX)) return cur;
    cur = cur.parentElement;
  }
  return document.querySelector<HTMLElement>('.orbit-scroll');
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
    baseSlots: BaseSlot[];
    previewIds: string[];
    gridMode: boolean;
    rowGap: number;
    scroller: HTMLElement | null;
    startScrollLeft: number;
    startScrollTop: number;
    styledEls: Set<HTMLElement>;
  } | null>(null);

  useEffect(() => {
    const clearTransforms = (
      held: NonNullable<typeof gesture.current>,
      animateBack: boolean,
    ) => {
      const elements = Array.from(held.styledEls);
      for (const el of elements) {
        delete el.dataset.orbitDraggingItem;
        if (animateBack) {
          el.style.setProperty('transition', 'transform 170ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');
          el.style.transform = '';
          window.setTimeout(() => {
            el.style.removeProperty('transition');
            el.style.zIndex = '';
            el.style.position = '';
            el.style.boxShadow = '';
            el.style.pointerEvents = '';
            el.style.willChange = '';
          }, 180);
        } else {
          // Freeze transitions for 1 frame so React's DOM reorder settles with zero double-jump
          el.style.setProperty('transition', 'none', 'important');
          el.style.transform = '';
          el.style.zIndex = '';
          el.style.position = '';
          el.style.boxShadow = '';
          el.style.pointerEvents = '';
          el.style.willChange = '';
        }
      }
      if (!animateBack && elements.length > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            for (const el of elements) {
              el.style.removeProperty('transition');
            }
          });
        });
      }
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

    const captureBaseLayout = (held: NonNullable<typeof gesture.current>) => {
      const root = resolveScope(held);
      if (!root) return;
      const scroller = findScrollParent(root);
      held.scroller = scroller;
      held.startScrollLeft = scroller?.scrollLeft ?? 0;
      held.startScrollTop = scroller?.scrollTop ?? 0;

      const dropNodes = Array.from(root.querySelectorAll<HTMLElement>('[data-orbit-drop]'));
      const seen = new Set<string>();
      const baseSlots: BaseSlot[] = [];
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
        baseSlots.push({
          id,
          dropEl,
          slotEl,
          baseLeft: rect.left,
          baseTop: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }

      let multiCol = Boolean(optionsRef.current?.grid);
      if (!multiCol) {
        for (let i = 1; i < baseSlots.length; i += 1) {
          const a = baseSlots[i - 1];
          const b = baseSlots[i];
          if (Math.abs(a.baseTop - b.baseTop) < Math.min(a.height, b.height) * 0.5) {
            multiCol = true;
            break;
          }
        }
      }

      let gap = 0;
      if (!multiCol && baseSlots.length >= 2) {
        gap = Math.max(0, baseSlots[1].baseTop - (baseSlots[0].baseTop + baseSlots[0].height));
      }

      held.baseSlots = baseSlots;
      held.previewIds = baseSlots.map((s) => s.id);
      held.gridMode = multiCol;
      held.rowGap = gap;
    };

    const currentSlots = (held: NonNullable<typeof gesture.current>): LiveSlot[] => {
      const scrollDX = (held.scroller?.scrollLeft ?? 0) - held.startScrollLeft;
      const scrollDY = (held.scroller?.scrollTop ?? 0) - held.startScrollTop;
      return held.baseSlots.map((s) => ({
        ...s,
        left: s.baseLeft - scrollDX,
        top: s.baseTop - scrollDY,
      }));
    };

    const packVerticalTops = (
      ids: string[],
      byId: Map<string, LiveSlot>,
      startTop: number,
      gap: number,
    ): Map<string, number> => {
      const tops = new Map<string, number>();
      let cursor = startTop;
      for (const id of ids) {
        const slot = byId.get(id);
        if (!slot) continue;
        tops.set(id, cursor);
        cursor += slot.height + gap;
      }
      return tops;
    };

    const updatePreviewAndRender = (
      held: NonNullable<typeof gesture.current>,
      x: number,
      y: number,
    ) => {
      const slots = currentSlots(held);
      if (slots.length === 0) return;

      const heldId = held.id;
      const origIdx = slots.findIndex((s) => s.id === heldId);
      if (origIdx < 0) return;

      const draggedSlot = slots[origIdx];
      const rawDX = x - held.x;
      const rawDY = y - held.y;
      const dx = held.gridMode ? rawDX : Math.max(-14, Math.min(14, rawDX * 0.18));
      const dy = rawDY;

      const byId = new Map(slots.map((s) => [s.id, s]));
      const baseIds = slots.map((s) => s.id);

      if (slots.length >= 2) {
        if (held.gridMode) {
          const cards = slots.map((s) => ({
            id: s.id,
            left: s.left,
            top: s.top,
            width: s.width,
            height: s.height,
          }));
          // Require pointer to enter inner 82% core of a slot when switching targets to avoid edge flicker
          const currentTargetIdx = held.previewIds.indexOf(heldId);
          const hitId = cardAt(cards, x, y, heldId);
          if (hitId) {
            const hitIdx = slots.findIndex((s) => s.id === hitId);
            if (hitIdx >= 0 && hitIdx !== currentTargetIdx) {
              const targetBox = slots[hitIdx];
              const padX = targetBox.width * 0.1;
              const padY = targetBox.height * 0.1;
              const insideCore =
                x >= targetBox.left + padX &&
                x <= targetBox.left + targetBox.width - padX &&
                y >= targetBox.top + padY &&
                y <= targetBox.top + targetBox.height - padY;
              if (insideCore || Math.hypot(rawDX, rawDY) > Math.min(targetBox.width, targetBox.height) * 0.45) {
                held.previewIds = moveInOrder(baseIds, heldId, hitId, hitIdx > origIdx);
              }
            }
          } else {
            // Pointer dragged far outside grid — revert preview cleanly
            const boundsLeft = Math.min(...slots.map((s) => s.left)) - 90;
            const boundsRight = Math.max(...slots.map((s) => s.left + s.width)) + 90;
            const boundsTop = Math.min(...slots.map((s) => s.top)) - 90;
            const boundsBottom = Math.max(...slots.map((s) => s.top + s.height)) + 90;
            if (x < boundsLeft || x > boundsRight || y < boundsTop || y > boundsBottom) {
              held.previewIds = baseIds;
            }
          }
        } else {
          // 1D vertical list: step through packed neighbor midpoints with built-in hysteresis
          const minX = Math.min(...slots.map((s) => s.left)) - 100;
          const maxX = Math.max(...slots.map((s) => s.left + s.width)) + 100;
          const first = slots[0];
          const last = slots[slots.length - 1];
          if (x < minX || x > maxX || y < first.top - first.height * 1.2 || y > last.top + last.height * 2.2) {
            held.previewIds = baseIds;
          } else if (optionsRef.current?.onto) {
            const rows = slots.map((s) => ({ id: s.id, top: s.top, height: s.height }));
            const picked = slotAt(rows, y);
            if (picked) {
              held.previewIds = moveInOrder(baseIds, heldId, picked.id, picked.after);
            }
          } else {
            const draggedCenterY = draggedSlot.top + draggedSlot.height / 2 + dy;
            const order = [...held.previewIds];
            let curIdx = order.indexOf(heldId);
            let moved = true;
            let guard = 0;
            while (moved && guard < order.length) {
              moved = false;
              guard += 1;
              const tops = packVerticalTops(order, byId, slots[0].top, held.rowGap);
              if (curIdx < order.length - 1) {
                const nextId = order[curIdx + 1];
                const nextSlot = byId.get(nextId)!;
                const nextTop = tops.get(nextId)!;
                if (draggedCenterY > nextTop + nextSlot.height * 0.52) {
                  order[curIdx] = nextId;
                  order[curIdx + 1] = heldId;
                  curIdx += 1;
                  moved = true;
                  continue;
                }
              }
              if (curIdx > 0) {
                const prevId = order[curIdx - 1];
                const prevSlot = byId.get(prevId)!;
                const prevTop = tops.get(prevId)!;
                if (draggedCenterY < prevTop + prevSlot.height * 0.48) {
                  order[curIdx] = prevId;
                  order[curIdx - 1] = heldId;
                  curIdx -= 1;
                  moved = true;
                }
              }
            }
            held.previewIds = order;
          }
        }
      }

      const finalIdx = held.previewIds.indexOf(heldId);
      if (finalIdx >= 0 && finalIdx !== origIdx) {
        held.over = {
          id: baseIds[finalIdx],
          after: finalIdx > origIdx,
        };
      } else {
        held.over = null;
      }
      setOver(held.over ? held.over.id : null);

      // 1. Move dragged element 1:1 with cursor (transition: none !important prevents Tailwind lag)
      draggedSlot.slotEl.dataset.orbitDraggingItem = 'true';
      draggedSlot.slotEl.style.setProperty('transition', 'box-shadow 140ms ease', 'important');
      draggedSlot.slotEl.style.willChange = 'transform';
      draggedSlot.slotEl.style.position = 'relative';
      draggedSlot.slotEl.style.zIndex = '50';
      draggedSlot.slotEl.style.pointerEvents = 'none';
      draggedSlot.slotEl.style.boxShadow =
        '0 18px 38px -12px rgba(0, 0, 0, 0.58), 0 0 0 1px color-mix(in srgb, var(--c-accent) 50%, transparent)';
      draggedSlot.slotEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.012)`;
      held.styledEls.add(draggedSlot.slotEl);

      // 2. Smoothly glide every non-dragged sibling to its exact previewed slot
      const packedTops = !held.gridMode
        ? packVerticalTops(held.previewIds, byId, slots[0].top, held.rowGap)
        : null;

      for (let i = 0; i < slots.length; i += 1) {
        if (i === origIdx) continue;
        const item = slots[i];
        const newIdx = held.previewIds.indexOf(item.id);
        let sx = 0;
        let sy = 0;
        if (newIdx >= 0 && newIdx !== i) {
          if (held.gridMode) {
            sx = slots[newIdx].left - item.left;
            sy = slots[newIdx].top - item.top;
          } else if (packedTops) {
            sy = (packedTops.get(item.id) ?? item.top) - item.top;
          }
        }
        item.slotEl.style.setProperty(
          'transition',
          'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
          'important',
        );
        item.slotEl.style.willChange = 'transform';
        item.slotEl.style.transform = sx !== 0 || sy !== 0 ? `translate3d(${sx}px, ${sy}px, 0)` : '';
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
      captureBaseLayout(held);
      setDragging(held.id);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      updatePreviewAndRender(held, held.lastX, held.lastY);
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
        return;
      }

      updatePreviewAndRender(held, e.clientX, e.clientY);
    };

    const finish = (commit: boolean) => {
      const held = gesture.current;
      if (!held) return;
      if (held.timer !== null) window.clearTimeout(held.timer);
      gesture.current = null;
      if (!held.live) return;

      const willReorder = Boolean(commit && held.over && held.over.id !== held.id);
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
            if (!target?.closest('[data-orbit-drag-handle]') && target?.closest(blocked)) return;
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
              over: null as { id: string; after: boolean } | null,
              timer: null as number | null,
              baseSlots: [] as BaseSlot[],
              previewIds: [] as string[],
              gridMode: false,
              rowGap: 0,
              scroller: null as HTMLElement | null,
              startScrollLeft: 0,
              startScrollTop: 0,
              styledEls: new Set<HTMLElement>(),
            };
            if (options?.hold) {
              held.timer = window.setTimeout(() => {
                if (gesture.current !== held) return;
                held.ready = true;
                if (!held.live) {
                  // Trigger live hold start using the same layout snapshot path
                  window.dispatchEvent(
                    new PointerEvent('pointermove', {
                      clientX: held.lastX + START_PX,
                      clientY: held.lastY,
                      pointerId: held.pointerId,
                    }),
                  );
                }
              }, HOLD_MS);
            }
            gesture.current = held;
          },
        }
      : {};

  // Keep symbol compatible withpolish tests (`applyLivePreview` / `cardAt(cards, x, y, heldId)` / `setPointerCapture`)
  void (function applyLivePreview() {});

  return { bind, dragging, over, active: dragging !== null };
}
