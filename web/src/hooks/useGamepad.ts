import { useEffect } from 'react';
import { heldDirection, padEdges, type PadSnapshot } from '../utils/gamepad';

interface NativePad {
  connected: boolean;
  buttons: boolean[];
  axes: number[];
}

function tauriEvent() {
  return (window as Window & { __TAURI__?: { event: { listen: (name: string, handler: (e: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__?.event;
}

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

function act(action: 'up' | 'down' | 'left' | 'right' | 'activate' | 'back' | 'play') {
  if (action === 'activate') activate();
  else if (action === 'back') back();
  else if (action === 'play') play();
  else move(action);
}

function ensureFocus() {
  const current = document.activeElement;
  if (current instanceof HTMLElement && current !== document.body && focusables().includes(current)) return;
  focusables()[0]?.focus();
}

/**
 * Drive the window from a controller, and only while one is connected.
 *
 * A loop that ran with no pad attached would be the same always-on work the
 * Linux slowdown came from. The browser event starts it where that event
 * exists. On Linux that event, and `getGamepads` itself, can freeze the
 * window the moment a controller is plugged in, so only the desktop reader
 * is used there.
 */
export function useGamepad() {
  useEffect(() => {
    let timer = 0;
    let previous: PadSnapshot | null = null;
    let heldFor = 0;
    let native: PadSnapshot | null = null;
    let nativeOn = false;
    let unlisten: (() => void) | undefined;
    let alive = true;
    let lastNative = 0;
    const linux = /linux|x11/i.test(navigator.userAgent);

    const apply = (now: PadSnapshot) => {
      const edges = padEdges(previous, now);
      previous = now;
      if (edges.length === 0) return;
      document.documentElement.classList.add('orbit-pad');
      ensureFocus();
      for (const action of edges) {
        act(action);
        heldFor = 0;
      }
    };
    const tick = () => {
      if (nativeOn && native) {
        const held = heldDirection(native);
        if (held) {
          heldFor += 1;
          if (heldFor === 10 || (heldFor > 10 && heldFor % 4 === 0)) move(held);
        } else {
          heldFor = 0;
        }
        return;
      }
      // WebKit's gamepad API can block the UI thread when a pad appears.
      if (linux) return;
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((item) => item && item.connected) ?? null;
      if (!pad) {
        previous = null;
        return;
      }
      apply(snapshot(pad));
      const held = heldDirection(snapshot(pad));
      if (held) {
        heldFor += 1;
        if (heldFor === 10 || (heldFor > 10 && heldFor % 4 === 0)) move(held);
      } else {
        heldFor = 0;
      }
    };
    const start = () => {
      if (timer) return;
      document.documentElement.classList.add('orbit-pad');
      ensureFocus();
      timer = window.setInterval(tick, 50);
    };
    const webConnected = () => Array.from(navigator.getGamepads?.() ?? []).some((item) => item && item.connected);
    const stop = () => {
      if (nativeOn || (!linux && webConnected())) return;
      window.clearInterval(timer);
      timer = 0;
      previous = null;
      heldFor = 0;
      document.documentElement.classList.remove('orbit-pad');
    };
    if (!linux) {
      window.addEventListener('gamepadconnected', start);
      window.addEventListener('gamepaddisconnected', stop);
      if (webConnected()) start();
    }

    const api = tauriEvent();
    if (api) {
      void api.listen('orbit-gamepad', (event) => {
        const payload = event.payload as NativePad;
        if (!payload?.connected) {
          nativeOn = false;
          native = null;
          stop();
          return;
        }
        const buttons = payload.buttons ?? [];
        // A mis-read device looks like every button going down at once. That
        // is not a press, and acting on it is what made the window unusable.
        if (buttons.filter(Boolean).length > 4) return;
        const stamp = Date.now();
        if (stamp - lastNative < 40) return;
        lastNative = stamp;
        const now = { buttons, axes: payload.axes ?? [] };
        if (!nativeOn) {
          nativeOn = true;
          native = now;
          previous = now;
          start();
          return;
        }
        native = now;
        apply(now);
        if (!timer) start();
      }).then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });
    }

    return () => {
      alive = false;
      unlisten?.();
      if (!linux) {
        window.removeEventListener('gamepadconnected', start);
        window.removeEventListener('gamepaddisconnected', stop);
      }
      window.clearInterval(timer);
      document.documentElement.classList.remove('orbit-pad');
    };
  }, []);
}
