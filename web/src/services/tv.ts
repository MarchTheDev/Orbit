/**
 * Taking the window over, and giving it back.
 *
 * TV mode is meant to be the only thing on the screen. A panel filling the app
 * is not that: the desktop's own title bar and taskbar are still around it, and
 * a couch is further from the window than a chair is.
 *
 * In the packaged app the window itself goes fullscreen, which is the only way
 * that holds when the window is dragged to another monitor mid-evening. In a
 * browser - the preview, or the app opened in a tab - there is no window of
 * ours to enlarge, so the document asks for the whole screen instead. Neither
 * is a promise: a browser can refuse, and a refusal leaves TV mode working in
 * the window it is already in.
 */
import { currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { isNative } from './native';

/**
 * Frosted glass on the TV: WebKit on Linux repaints the blur under every
 * element every frame, which is the hub crawling on the couch machine. The
 * shapes stay; the frost outside Linux turns into steadier colour there. One
 * check for the session, so nothing measures the platform mid-render.
 */
export const tvLite = navigator.userAgent.includes('Linux');

/** Whether the document itself is the thing that was made fullscreen. */
let askedTheDocument = false;
let previousNativeBounds: { x: number; y: number; width: number; height: number; maximized: boolean } | null = null;

/** The last thing to go wrong, for a caller that wants to say so. */
let lastError: string | null = null;

/** What went wrong the last time, if anything did. */
export function fullscreenError(): string | null {
  return lastError;
}

/**
 * Fill the screen.
 *
 * The desktop window is asked first because it is the one that survives focus
 * changes and monitor switches. A browser document has to be asked from a user
 * gesture, which the click that turns TV mode on already is, so the call is
 * made directly rather than after a fetch or a timeout.
 */
export async function enterFullscreen(): Promise<boolean> {
  lastError = null;
  if (isNative()) {
    try {
      const window = getCurrentWindow();
      const [position, size, maximized] = await Promise.all([window.outerPosition(), window.outerSize(), window.isMaximized()]);
      previousNativeBounds = { x: position.x, y: position.y, width: size.width, height: size.height, maximized };
      await window.setFullscreen(true);
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== 'function') {
    lastError = 'This window cannot go fullscreen.';
    return false;
  }
  try {
    await root.requestFullscreen({ navigationUI: 'hide' });
    askedTheDocument = true;
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

/**
 * The work area of the monitor the window is on: the screen minus its taskbar.
 *
 * A maximized window has to fit inside this. Asking the window itself to
 * maximize is normally enough, but on a window that has just come out of
 * fullscreen the compositor can keep the fullscreen frame for a moment and
 * clamp the restored size to the whole screen instead - which is exactly how
 * the bottom edge ends up underneath the taskbar. Knowing the work area lets
 * the restore check its own answer and correct it.
 */
async function workArea(): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const monitor = (await currentMonitor().catch(() => null)) ?? (await primaryMonitor().catch(() => null));
    if (!monitor) return null;
    const { position, size } = monitor.workArea;
    return { x: position.x, y: position.y, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

/** Wait, briefly, for fullscreen to actually be over. */
async function waitForFullscreenExit(window: ReturnType<typeof getCurrentWindow>): Promise<void> {
  // Fullscreen exits asynchronously on Windows and some Linux compositors.
  // Restore only after Tauri reports the fullscreen state has actually gone
  // away; otherwise maximize can preserve the fullscreen frame and put the
  // bottom edge behind the taskbar.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (!(await window.isFullscreen())) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
}

/** Give the window back its chrome. Leaving something that was never taken is fine. */
export async function leaveFullscreen(): Promise<void> {
  if (isNative()) {
    const window = getCurrentWindow();
    const bounds = previousNativeBounds;
    previousNativeBounds = null;
    try { await window.setFullscreen(false); } catch { /* Still try to restore the saved window state. */ }

    try {
      await waitForFullscreenExit(window);

      if (!bounds) {
        // Nothing was saved - an older session, or a window that grew into
        // fullscreen some other way. A maximized window is still the right
        // answer here, and it is the one that cannot leave the frame behind a
        // taskbar once the work area is known.
        await window.unmaximize().catch(() => undefined);
        await new Promise((resolve) => globalThis.setTimeout(resolve, 60));
        await window.maximize();
        return;
      }

      await window.unmaximize().catch(() => undefined);
      // The frame is put back by the compositor a beat after fullscreen ends,
      // and a size asked for before that is clamped to the screen.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 90));

      if (bounds.maximized) {
        await window.maximize();
      } else {
        // Position first, then size: on Windows the requested size is clamped
        // to the monitor work area after the compositor has restored chrome.
        await window.setPosition(new PhysicalPosition(bounds.x, bounds.y));
        await window.setSize(new PhysicalSize(bounds.width, bounds.height));
      }

      // A last look at what actually happened. A window that came out larger
      // than the space the desktop leaves for it - or one that is sitting
      // under the taskbar - is put back exactly, or maximized when it cannot
      // be put back exactly. This is the step that keeps the bottom of the
      // window, and so the bottom of the deck, on the screen.
      const [size, position, area, maximized] = await Promise.all([
        window.outerSize().catch(() => null),
        window.outerPosition().catch(() => null),
        workArea(),
        window.isMaximized().catch(() => bounds.maximized),
      ]);
      if (!size || !area) return;
      const overflows = size.height > area.height + 2 || size.width > area.width + 2;
      const below = position ? position.y + size.height > area.y + area.height + 2 : false;
      const outside = position ? position.y < area.y - 2 : false;
      if (overflows || below || outside) {
        if (maximized) {
          // Maximized but measured too big: the compositor is still holding the
          // fullscreen frame. Putting the window back and maximizing again asks
          // it for a fresh frame instead of reusing that one.
          await window.unmaximize().catch(() => undefined);
          await new Promise((resolve) => globalThis.setTimeout(resolve, 60));
          await window.maximize();
        } else {
          const width = Math.min(bounds.width, area.width);
          const height = Math.min(bounds.height, area.height);
          const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
          const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
          await window.setPosition(new PhysicalPosition(x, y));
          await window.setSize(new PhysicalSize(width, height));
        }
      }
    } catch {
      /* The window was closed, or is not ours to resize any more. */
    }
    return;
  }
  if (!askedTheDocument && !document.fullscreenElement) return;
  askedTheDocument = false;
  try {
    await document.exitFullscreen();
  } catch {
    /* Already out: nothing to do, and nothing worth saying. */
  }
}
