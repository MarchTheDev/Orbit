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
      // A maximized window's own rectangle is not a good thing to remember.
      // Windows reports a maximized frame as the screen plus the invisible
      // resize border - and for a window with no titlebar that frame can be
      // the whole screen rather than the desk area, which is how a restored
      // window ends up with its bottom edge under the taskbar. What is worth
      // remembering is the desk area itself, because that is where a maximized
      // window belongs.
      const area = maximized ? await workArea() : null;
      previousNativeBounds = area
        ? { ...area, maximized: true }
        : { x: position.x, y: position.y, width: size.width, height: size.height, maximized };
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
  // away; otherwise a size set now is preserved against the fullscreen frame
  // and the bottom edge ends up behind the taskbar.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await window.isFullscreen())) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 40));
  }
}

const pause = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/** What a window is doing right now, measured from outside it. */
type Placement = { x: number; y: number; width: number; height: number };

/**
 * Put the window exactly inside the desk area, and keep putting it there until
 * it stays.
 *
 * A single `setPosition` + `setSize` is not enough on Windows. The frame is
 * handed back to the desktop a beat after fullscreen ends, and a maximized
 * frame is re-applied by the compositor *after* the size was asked for - which
 * is how the window came back taller than the screen, with its bottom edge cut
 * off under the taskbar. Telling the desktop it is no longer maximized,
 * laying it out, and then measuring what actually happened is the only
 * sequence that settles: each pass either confirms the window is where it was
 * put, or sees that the compositor moved it and puts it there again.
 *
 * The loop is bounded and short, so a window that refuses - one the desktop has
 * pinned, say - is left alone after a few tries rather than fought over.
 */
async function settleInside(
  window: ReturnType<typeof getCurrentWindow>,
  target: Placement,
  area: Placement | null,
): Promise<void> {
  const limit = area ?? target;
  const want = {
    x: Math.max(limit.x, Math.min(target.x, limit.x + limit.width - Math.min(target.width, limit.width))),
    y: Math.max(limit.y, Math.min(target.y, limit.y + limit.height - Math.min(target.height, limit.height))),
    width: Math.min(target.width, limit.width),
    height: Math.min(target.height, limit.height),
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    // A size asked for while the window is maximized is remembered as the
    // restored size and then never used; leaving the state first is what makes
    // the two calls below visible.
    if (await window.isMaximized().catch(() => false)) {
      await window.unmaximize().catch(() => undefined);
      await pause(60);
    }
    await window.setPosition(new PhysicalPosition(want.x, want.y)).catch(() => undefined);
    await window.setSize(new PhysicalSize(want.width, want.height)).catch(() => undefined);
    await pause(90);

    const [size, position] = await Promise.all([
      window.outerSize().catch(() => null),
      window.outerPosition().catch(() => null),
    ]);
    if (!size || !position) return;

    const right = Math.abs(size.width - want.width) <= 2 && Math.abs(size.height - want.height) <= 2;
    const placed = Math.abs(position.x - want.x) <= 2 && Math.abs(position.y - want.y) <= 2;
    if (right && placed) return;
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
      const area = await workArea();

      // Nothing saved means an older session, or a window that became
      // fullscreen some other way. Covering the desk area is the right answer
      // there too, and unlike a plain maximize it cannot leave the frame
      // behind a taskbar.
      if (!bounds) {
        if (area) await settleInside(window, area, area);
        return;
      }

      // The frame is put back by the compositor a beat after fullscreen ends.
      await pause(90);

      // A window that was maximized goes back to the desk area it had, not
      // through maximize(): a frameless maximized window is the one the
      // desktop may place over the whole screen, taskbar included, and that is
      // both the strip under Stardeck and the window that comes back with its
      // bottom edge off the screen. A window that was not maximized goes back
      // to its own rectangle, kept inside the desk so a saved position from a
      // bigger monitor cannot put it out of reach.
      await settleInside(window, bounds, area);
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
