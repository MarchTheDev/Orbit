import { useEffect } from 'react';
import {
  directionsHeld,
  heldDirection,
  journalMove,
  mayHandleGamepadInput,
  padDistance,
  padEdgesWhenOwned,
  releaseRest,
  withoutRest,
  type HeldDirs,
  type JournalZone,
  type PadBox,
  type PadSnapshot,
} from '../utils/gamepad';

interface NativePad {
  connected: boolean;
  buttons: boolean[];
  axes: number[];
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
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (!visible(el)) return false;
    // The star and the edit button sit on the tile. A stick should land on the
    // game, not on a control that only appears when the pointer is over it.
    if (el.closest('[data-orbit-pad-skip]')) return false;
    const tile = el.closest('[data-orbit-pad="tile"]');
    return !tile || tile === el;
  });
}

/**
 * The next control in a direction.
 *
 * Document order is wrong for a grid of covers: right should mean the tile to
 * the right, not the next button in the markup. The nearest edge in that
 * direction wins, and a tie goes to the closer one.
 */
function boxOf(el: HTMLElement): PadBox {
  const box = el.getBoundingClientRect();
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
}

function inTopbar(el: HTMLElement): boolean {
  return el.closest('.orbit-topbar') !== null;
}

/** The sticky bar is only a step away when you are already at the top of the page. */
function topbarAllowed(from: HTMLElement, direction: 'up' | 'down' | 'left' | 'right'): boolean {
  if (inTopbar(from)) return true;
  if (direction !== 'up') return false;
  const bar = document.querySelector('.orbit-topbar');
  if (!(bar instanceof HTMLElement)) return true;
  return from.getBoundingClientRect().top - bar.getBoundingClientRect().bottom < 140;
}

function neighbor(
  from: HTMLElement,
  direction: 'up' | 'down' | 'left' | 'right',
  root?: HTMLElement | null,
): HTMLElement | null {
  const origin = boxOf(from);
  const allowBar = !root && topbarAllowed(from, direction);
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of focusables()) {
    if (el === from) continue;
    if (root && !root.contains(el)) continue;
    if (!allowBar && inTopbar(el)) continue;
    const score = padDistance(origin, boxOf(el), direction);
    if (score == null) continue;
    if (!best || score < best.score) best = { el, score };
  }
  return best?.el ?? null;
}

function zoneRoot(name: string): HTMLElement | null {
  const root = document.querySelector(`[data-orbit-pad-zone="${name}"]`);
  return root instanceof HTMLElement ? root : null;
}

function zoneName(el: HTMLElement): JournalZone | null {
  if (el.hasAttribute('data-orbit-journal-game')) return 'journal-game';
  const name = el.closest('[data-orbit-pad-zone]')?.getAttribute('data-orbit-pad-zone');
  if (name === 'journal-logs' || name === 'journal-notes') return name;
  return null;
}

function firstInZone(name: string): HTMLElement | null {
  const root = zoneRoot(name);
  if (!root) return null;
  const entry = root.querySelector('[data-orbit-pad="journal-entry"]');
  if (entry instanceof HTMLElement && visible(entry)) return entry;
  return focusables().find((el) => root.contains(el)) ?? null;
}

function lastInZone(name: string): HTMLElement | null {
  const root = zoneRoot(name);
  if (!root) return null;
  const entries = Array.from(root.querySelectorAll<HTMLElement>('[data-orbit-pad="journal-entry"]')).filter(visible);
  if (entries.length > 0) return entries[entries.length - 1];
  const items = focusables().filter((el) => root.contains(el));
  return items[items.length - 1] ?? null;
}

function selectedJournalGame(): HTMLElement | null {
  const id = zoneRoot('journal-logs')?.getAttribute('data-orbit-pad-game');
  if (!id || typeof CSS === 'undefined' || !CSS.escape) return null;
  const el = document.querySelector(`[data-orbit-journal-game="${CSS.escape(id)}"]`);
  return el instanceof HTMLElement && visible(el) ? el : null;
}

function journalTarget(current: HTMLElement, direction: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
  const zone = zoneName(current);
  if (!zone) return null;
  const root = zone === 'journal-game' ? null : zoneRoot(zone);
  const inside = root ? neighbor(current, direction, root) : null;
  const hop = journalMove(zone, direction, inside !== null);
  if (hop === 'inside') return inside;
  if (hop === 'logs') return firstInZone('journal-logs') ?? firstInZone('journal-notes');
  if (hop === 'logs-last') return lastInZone('journal-logs') ?? firstInZone('journal-logs');
  if (hop === 'notes') return firstInZone('journal-notes');
  if (hop === 'game') return selectedJournalGame();
  if (hop === 'stay') return current;
  return null;
}

/** The ring follows the pad, not whatever the mouse last clicked. */
export function markPadFocus(el: HTMLElement | null) {
  document.querySelectorAll('.orbit-pad-focus').forEach((node) => {
    if (node !== el) node.classList.remove('orbit-pad-focus');
  });
  el?.classList.add('orbit-pad-focus');
}

function focusFromPad(el: HTMLElement) {
  document.documentElement.classList.add('orbit-pad');
  markPadFocus(el);
  if (document.activeElement !== el) el.focus();
}

function move(direction: 'up' | 'down' | 'left' | 'right') {
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const list = focusables();
  if (list.length === 0) return;
  if (!current || !list.includes(current)) {
    focusFromPad(list[0]);
    return;
  }
  const routed = journalTarget(current, direction);
  if (routed) {
    focusFromPad(routed);
    return;
  }
  focusFromPad(neighbor(current, direction) ?? current);
}

let padActivateAt = 0;
let overlayOpen = false;

/** A confirm press on a game, recent enough that the details drawer should land on Play. */
export function padJustActivated(withinMs = 800): boolean {
  return padActivateAt > 0 && performance.now() - padActivateAt <= withinMs;
}

function activate() {
  const current = document.activeElement;
  if (!(current instanceof HTMLElement)) return;
  if (current.matches('[data-orbit-pad="tile"]')) padActivateAt = performance.now();
  current.click();
}

function back() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new CustomEvent('orbit-pad-back'));
}

function play() {
  window.dispatchEvent(new CustomEvent('orbit-pad-play'));
}

function page(direction: 'left' | 'right') {
  window.dispatchEvent(new CustomEvent('orbit-pad-page', { detail: direction }));
}

/** Pixels per second from a stick axis. A light tilt stays slow; full tilt moves. */
function stickSpeed(value: number): number {
  const dead = 0.12;
  const abs = Math.abs(value);
  if (abs <= dead) return 0;
  const span = Math.min(1, (abs - dead) / (1 - dead));
  return Math.sign(value) * span * span * 780;
}

function scrollByStick(pad: PadSnapshot, dt: number) {
  const x = stickSpeed(pad.axes[2] ?? 0);
  const y = stickSpeed(pad.axes[3] ?? 0);
  if (x === 0 && y === 0) return;
  // Details, when open, are the page being read. Scrolling the library behind
  // them repaints that whole grid under the drawer.
  const drawer = document.querySelector('.orbit-detail');
  const scroller =
    drawer instanceof HTMLElement && drawer.scrollHeight > drawer.clientHeight + 1
      ? drawer
      : document.querySelector('.orbit-scroll');
  if (!(scroller instanceof HTMLElement)) return;
  scroller.scrollBy({ left: x * dt, top: y * dt });
}

function act(action: 'up' | 'down' | 'left' | 'right' | 'activate' | 'back' | 'play' | 'page-left' | 'page-right') {
  if (action === 'activate') activate();
  else if (action === 'back') back();
  else if (action === 'play') play();
  else if (action === 'page-left') page('left');
  else if (action === 'page-right') page('right');
  else move(action);
}

function ensureFocus() {
  const current = document.activeElement;
  if (current instanceof HTMLElement && current !== document.body && focusables().includes(current)) {
    markPadFocus(current);
    return;
  }
  const first = focusables()[0];
  if (first) focusFromPad(first);
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
    let alive = true;
    let lastNative = 0;
    let latest: PadSnapshot | null = null;
    let frame = 0;
    let lastScroll = 0;
    let scrolling = false;
    let restReady = false;
    let restHold: HeldDirs = { up: false, down: false, left: false, right: false };
    const pump = (time: number) => {
      if (!scrolling) return;
      frame = window.requestAnimationFrame(pump);
      if (!ownsPad()) {
        lastScroll = 0;
        return;
      }
      if (!latest) return;
      const dt = lastScroll ? Math.min(0.05, (time - lastScroll) / 1000) : 0.016;
      lastScroll = time;
      scrollByStick(latest, dt);
    };
    const startScroll = () => {
      if (scrolling) return;
      scrolling = true;
      lastScroll = 0;
      frame = window.requestAnimationFrame(pump);
    };
    const stopScroll = () => {
      scrolling = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastScroll = 0;
    };
    const linux = /linux|x11/i.test(navigator.userAgent);
    const ownsPad = () => mayHandleGamepadInput(
      overlayOpen,
      document.visibilityState === 'visible',
      document.hasFocus(),
    );
    let padOwnedLast = ownsPad();
    const webPadSnapshot = (): PadSnapshot | null => {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((item) => item && item.connected) ?? null;
      return pad ? snapshot(pad) : null;
    };
    const resetUnowned = (now: PadSnapshot | null) => {
      // Keep a quiet baseline while a game or another window owns the pad.
      // That way a held Start button cannot become a new Play press on refocus.
      latest = now;
      previous = now;
      heldFor = 0;
      restReady = now !== null;
      restHold = now ? directionsHeld(now) : { up: false, down: false, left: false, right: false };
    };

    const apply = (now: PadSnapshot) => {
      // The overlay has its own input path. Start+Select is its shortcut, not
      // Play. The main window also stays silent unless it is visible and focused.
      if (!ownsPad() || (now.buttons[8] === true && now.buttons[9] === true)) {
        resetUnowned(now);
        return;
      }
      const heldNow = directionsHeld(now);
      // The first snapshot is the device at rest. A stick already at the rail
      // is the same reading as holding up, and repeating it pulls every move
      // back to the top. It starts counting only after it has been let go.
      restHold = restReady ? releaseRest(restHold, heldNow) : heldNow;
      restReady = true;
      const edges = withoutRest(padEdgesWhenOwned(ownsPad(), previous, now), restHold);
      previous = now;
      if (edges.length === 0) return;
      document.documentElement.classList.add('orbit-pad');
      ensureFocus();
      for (const action of edges) {
        act(action);
        heldFor = 0;
      }
      const current = document.activeElement;
      if (current instanceof HTMLElement && current !== document.body) markPadFocus(current);
    };
    const tick = () => {
      if (!ownsPad()) {
        padOwnedLast = false;
        // Do not poll the browser's Gamepad API while a game owns the window.
        // Its current reading is sampled once on refocus, as a quiet baseline.
        const current = nativeOn && native ? native : linux ? null : previous;
        resetUnowned(current);
        return;
      }
      if (!padOwnedLast) {
        padOwnedLast = true;
        const current = nativeOn && native ? native : linux ? null : webPadSnapshot();
        resetUnowned(current);
        return;
      }
      if (nativeOn && native) {
        latest = native;
        const held = heldDirection(native, restHold);
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
        restReady = false;
        restHold = { up: false, down: false, left: false, right: false };
        return;
      }
      const now = snapshot(pad);
      latest = now;
      apply(now);
      const held = heldDirection(now, restHold);
      if (held) {
        heldFor += 1;
        if (heldFor === 10 || (heldFor > 10 && heldFor % 4 === 0)) move(held);
      } else {
        heldFor = 0;
      }
    };
    const start = () => {
      if (timer) return;
      padOwnedLast = ownsPad();
      // A device that only looks connected must not paint the ring. The ring
      // is added when a press actually moves focus.
      startScroll();
      timer = window.setInterval(tick, 50);
    };
    const webConnected = () => Array.from(navigator.getGamepads?.() ?? []).some((item) => item && item.connected);
    const stop = () => {
      if (nativeOn || (!linux && webConnected())) return;
      window.clearInterval(timer);
      timer = 0;
      previous = null;
      heldFor = 0;
      latest = null;
      restReady = false;
      restHold = { up: false, down: false, left: false, right: false };
      stopScroll();
      document.documentElement.classList.remove('orbit-pad');
      document.querySelectorAll('.orbit-pad-focus').forEach((node) => node.classList.remove('orbit-pad-focus'));
    };
    if (!linux) {
      window.addEventListener('gamepadconnected', start);
      window.addEventListener('gamepaddisconnected', stop);
      if (webConnected()) start();
    }
    const eventApi = window.__TAURI__?.event;
    let stopOverlay = () => {};
    if (eventApi) {
      void eventApi.listen('overlay-visible', (event) => {
        overlayOpen = event.payload === true || event.payload === 'true';
        if (overlayOpen) {
          document.querySelectorAll('.orbit-pad-focus').forEach((node) => node.classList.remove('orbit-pad-focus'));
        }
      }).then((unlisten) => {
        if (alive) stopOverlay = unlisten;
        else unlisten();
      }).catch(() => undefined);
    }
    // A click is the mouse. It must not keep the controller ring on the control
    // it focused, and it must not grow one around the thing under the pointer.
    const clearPadRing = () => {
      document.querySelectorAll('.orbit-pad-focus').forEach((node) => node.classList.remove('orbit-pad-focus'));
    };
    window.addEventListener('pointerdown', clearPadRing, true);

    const onNative = (payload: NativePad | null) => {
      if (!payload?.connected) {
        if (!nativeOn) return;
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
      const buttonEdge = !nativeOn || buttons.some((down, index) => down !== (native?.buttons[index] === true));
      // Stick reports can wait. A button cannot, or the press that arrived
      // with a stick report is thrown away and the pad feels dead.
      if (!buttonEdge && stamp - lastNative < 40) return;
      lastNative = stamp;
      const now = { buttons, axes: payload.axes ?? [] };
      latest = now;
      if (!nativeOn) {
        nativeOn = true;
        native = now;
        // A face button already down still counts: it may have landed before
        // this listener existed. A direction already held is the device at
        // rest, and apply() does not treat that as a push.
        previous = { buttons: buttons.map(() => false), axes: (payload.axes ?? []).map(() => 0) };
        start();
        apply(now);
        return;
      }
      native = now;
      apply(now);
      if (!timer) start();
    };

    // Linux asks. The event is the path that never arrived, and applying both
    // would press a button twice. Windows keeps the browser gamepad.
    let pullTimer = 0;
    if (linux) {
      const pull = () => {
        const core = window.__TAURI__?.core;
        if (!core || !alive) return;
        void core.invoke<NativePad>('gamepad_poll').then((payload) => {
          if (alive) onNative(payload);
        }).catch(() => {});
      };
      pull();
      pullTimer = window.setInterval(pull, 50);
    }

    return () => {
      alive = false;
      stopOverlay();
      window.clearInterval(pullTimer);
      window.removeEventListener('pointerdown', clearPadRing, true);
      if (!linux) {
        window.removeEventListener('gamepadconnected', start);
        window.removeEventListener('gamepaddisconnected', stop);
      }
      window.clearInterval(timer);
      stopScroll();
      document.documentElement.classList.remove('orbit-pad');
      document.querySelectorAll('.orbit-pad-focus').forEach((node) => node.classList.remove('orbit-pad-focus'));
    };
  }, []);
}
