import { useEffect } from 'react';
import { heldDirection, padEdges, type PadSnapshot } from '../utils/gamepad';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function snapshot(pad: Gamepad): PadSnapshot {
  return {
    buttons: pad.buttons.map((button) => button.pressed),
    axes: Array.from(pad.axes),
  };
}

function visible(el: HTMLElement): boolean {
  if (el.getAttribute('disabled') !== null || el.getAttribute('aria-hidden') === 'true') return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

/**
 * The next control in a direction.
 *
 * Document order is wrong for a grid of covers: right should mean the tile to
 * the right, not the next button in the markup. The nearest edge in that
 * direction wins, and a tie goes to the closer one.
 */
function neighbor(from: HTMLElement, direction: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
  const origin = from.getBoundingClientRect();
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of focusables()) {
    if (el === from) continue;
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const forward =
      direction === 'right' ? dx :
      direction === 'left' ? -dx :
      direction === 'down' ? dy :
      -dy;
    if (forward < 8) continue;
    const sideways = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = forward + sideways * 1.6;
    if (!best || score < best.score) best = { el, score };
  }
  return best?.el ?? null;
}

function move(direction: 'up' | 'down' | 'left' | 'right') {
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const list = focusables();
  if (list.length === 0) return;
  const next = current && list.includes(current) ? neighbor(current, direction) : list[0];
  (next ?? list[0]).focus();
}

function activate() {
  const current = document.activeElement;
  if (current instanceof HTMLElement) current.click();
}

function back() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new CustomEvent('orbit-pad-back'));
}

function play() {
  window.dispatchEvent(new CustomEvent('orbit-pad-play'));
}

/**
 * Drive the window from a controller, and only while one is connected.
 *
 * A loop that ran with no pad attached would be the same always-on work the
 * Linux slowdown came from. `gamepadconnected` starts it; the last disconnect
 * stops it.
 */
export function useGamepad() {
  useEffect(() => {
    let timer = 0;
    let previous: PadSnapshot | null = null;
    let heldFor = 0;
    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((item) => item && item.connected) ?? null;
      if (!pad) {
        previous = null;
        return;
      }
      document.documentElement.classList.add('orbit-pad');
      const now = snapshot(pad);
      for (const action of padEdges(previous, now)) {
        if (action === 'activate') activate();
        else if (action === 'back') back();
        else if (action === 'play') play();
        else if (action === 'up' || action === 'down' || action === 'left' || action === 'right') move(action);
        heldFor = 0;
      }
      const held = heldDirection(now);
      if (held) {
        heldFor += 1;
        if (heldFor === 10 || (heldFor > 10 && heldFor % 4 === 0)) move(held);
      } else {
        heldFor = 0;
      }
      previous = now;
    };
    const start = () => {
      if (timer) return;
      document.documentElement.classList.add('orbit-pad');
      timer = window.setInterval(tick, 50);
    };
    const stop = () => {
      const still = Array.from(navigator.getGamepads?.() ?? []).some((item) => item && item.connected);
      if (still) return;
      window.clearInterval(timer);
      timer = 0;
      previous = null;
      document.documentElement.classList.remove('orbit-pad');
    };
    window.addEventListener('gamepadconnected', start);
    window.addEventListener('gamepaddisconnected', stop);
    if (Array.from(navigator.getGamepads?.() ?? []).some((item) => item && item.connected)) start();
    return () => {
      window.removeEventListener('gamepadconnected', start);
      window.removeEventListener('gamepaddisconnected', stop);
      window.clearInterval(timer);
      document.documentElement.classList.remove('orbit-pad');
    };
  }, []);
}
