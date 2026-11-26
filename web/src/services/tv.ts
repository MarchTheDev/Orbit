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

/**
 * Whether *this* code is the reason the window is fullscreen.
 *
 * This is the difference between a fullscreen that comes apart cleanly and one
 * that does not. Toggling fullscreen is not a property Orbit owns: the player
 * can make the window fullscreen themselves, a compositor can, and a second
 * press can arrive before the first has settled. Leaving Stardeck must give
 * back exactly what was taken - so the flag is only set when the toggle was
 * ours, is cleared the moment the window is handed back, and is checked again
 * against the window's real state before anything is toggled.
 */
let weWentFullscreen = false;
let fullscreenRequestGeneration = 0;
let pendingFocusUnlisten: (() => void) | null = null;
let pendingNativeFullscreen: Promise<void> | null = null;

type Bounds = { x: number; y: number; width: number; height: number; maximized: boolean };

let previousNativeBounds: Bounds | null = null;

/**
 * The window's placement, kept across restarts.
 *
 * The window's place is written whenever a move or resize comes to rest,
 * and never writes the fullscreen rectangle: a window that reopens fullscreen is
 * how a launcher ends up oversized under the taskbar. Orbit's restore already
 * clamps into the desk area, but the rectangle it clamps was only held in
 * memory, so a crash or an update while Stardeck was on discarded it. This is
 * the same placement, written to storage the moment the screen is taken over.
 */
const BOUNDS_KEY = 'orbit.window.bounds';

function savedBounds(): Bounds | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(BOUNDS_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const numbers = ['x', 'y', 'width', 'height'].map((key) => value[key]);
    if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    if ((value.width as number) < 320 || (value.height as number) < 240) return null;
    return {
      x: value.x as number,
      y: value.y as number,
      width: value.width as number,
      height: value.height as number,
      maximized: value.maximized === true,
    };
  } catch {
    return null;
  }
}

function rememberBounds(bounds: Bounds | null) {
  try {
    if (bounds) localStorage.setItem(BOUNDS_KEY, JSON.stringify(bounds));
    else localStorage.removeItem(BOUNDS_KEY);
  } catch {
    /* Storage may be unavailable; the in-memory copy still holds. */
  }
}

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
  const generation = ++fullscreenRequestGeneration;
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
      rememberBounds(previousNativeBounds);
      // A window that is already fullscreen is not ours to claim, and one the
      // player made fullscreen should stay fullscreen when Stardeck closes.
      if (await window.isFullscreen().catch(() => false)) {
        weWentFullscreen = false;
        return true;
      }
      // Some compositors ignore a fullscreen request made while another window
      // is active - the usual case here, since Stardeck is opened from a
      // window that has just been clicked but not yet raised. The toggle is
      // deferred to the moment the window is actually in front.
      const focused = await window.isFocused().catch(() => true);
      if (!focused) {
        const unlisten = await window.onFocusChanged(({ payload }) => {
          if (!payload) return;
          unlisten();
          if (pendingFocusUnlisten === unlisten) pendingFocusUnlisten = null;
          if (generation !== fullscreenRequestGeneration) return;
          const request = window.setFullscreen(true).then(() => {
            if (generation === fullscreenRequestGeneration) weWentFullscreen = true;
            void paintFrame(ROOM_COLOUR);
            remeasureViewport();
          }).catch(() => undefined);
          pendingNativeFullscreen = request;
          void request.finally(() => {
            if (pendingNativeFullscreen === request) pendingNativeFullscreen = null;
          });
        });
        pendingFocusUnlisten = unlisten;
        // A window that never comes forward stays in its own frame; Stardeck
        // fills it either way.
        globalThis.setTimeout(() => {
          if (pendingFocusUnlisten === unlisten) {
            unlisten();
            pendingFocusUnlisten = null;
          }
        }, 4000);
        return true;
      }
      await window.setFullscreen(true);
      weWentFullscreen = true;
      void paintFrame(ROOM_COLOUR);
      remeasureViewport();
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
 * The colour of the window itself, behind the page.
 *
 * The frame is what shows in any strip the web view has not covered yet, and it
 * was a near-black that matched neither surface: a band of it under Stardeck
 * read as a black bar rather than as the room. Painting it the colour of what
 * is on screen means the same strip, on a compositor that hands the new frame
 * over a beat late, is invisible instead.
 */
const ROOM_COLOUR = '#05040d';
const DESK_COLOUR = '#0a0b0d';

async function paintFrame(colour: string): Promise<void> {
  try {
    await getCurrentWindow().setBackgroundColor(colour);
  } catch {
    /* A runtime without the call, or a platform that does not offer it. */
  }
}

/**
 * Ask the page to measure itself again after the window has changed size.
 *
 * GTK gives the window its new frame a beat before the web view is told about
 * it, and a page laid out against the old height keeps that height: the covers
 * stop short of the bottom edge and the frame shows underneath them. A resize
 * event of our own, repeated across the moment the transition settles, makes
 * the page lay out against the size it actually has.
 */
function remeasureViewport(): void {
  const view = globalThis.window;
  if (!view || typeof view.dispatchEvent !== 'function') return;
  for (const delay of [0, 80, 220]) {
    globalThis.setTimeout(() => {
      view.dispatchEvent(new Event('resize'));
    }, delay);
  }
}

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
  // The frame is the whole window - title bar and borders included - because
  // that is what has to fit the desk area, and what `target` describes.
  const frame = {
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

    // `setSize` takes the *inner* size; `outerSize` measures the frame. Asking
    // for the frame's height as the inner height is what handed the window back
    // one title bar too tall, with its bottom edge behind the taskbar and a
    // strip of uncovered frame above it. The difference is measured on every
    // pass, because it is nought while the window is still fullscreen and only
    // appears once the desktop has given the decorations back.
    const [outer, inner] = await Promise.all([
      window.outerSize().catch(() => null),
      window.innerSize().catch(() => null),
    ]);
    const borderX = outer && inner ? Math.max(0, outer.width - inner.width) : 0;
    const borderY = outer && inner ? Math.max(0, outer.height - inner.height) : 0;
    // What each setter takes: an outer position, and an inner size.
    const want = {
      x: frame.x,
      y: frame.y,
      width: Math.max(1, frame.width - borderX),
      height: Math.max(1, frame.height - borderY),
    };

    await window.setPosition(new PhysicalPosition(want.x, want.y)).catch(() => undefined);
    await window.setSize(new PhysicalSize(want.width, want.height)).catch(() => undefined);
    await pause(90);

    const [size, position] = await Promise.all([
      window.innerSize().catch(() => null),
      window.outerPosition().catch(() => null),
    ]);
    if (!size || !position) {
      remeasureViewport();
      return;
    }

    const right = Math.abs(size.width - want.width) <= 2 && Math.abs(size.height - want.height) <= 2;
    const placed = Math.abs(position.x - want.x) <= 2 && Math.abs(position.y - want.y) <= 2;
    if (right && placed) {
      remeasureViewport();
      return;
    }
  }
  remeasureViewport();
}

/** Give the window back its chrome. Leaving something that was never taken is fine. */
export async function leaveFullscreen(): Promise<void> {
  if (isNative()) {
    fullscreenRequestGeneration += 1;
    pendingFocusUnlisten?.();
    pendingFocusUnlisten = null;
    await pendingNativeFullscreen?.catch(() => undefined);
    pendingNativeFullscreen = null;
    const window = getCurrentWindow();
    // The copy in storage is the one that survives a crash mid-session; the one
    // in memory is fresher when both exist, so it wins.
    const bounds = previousNativeBounds ?? savedBounds();
    previousNativeBounds = null;
    const ours = weWentFullscreen;
    weWentFullscreen = false;
    rememberBounds(null);
    try {
      // Only what we took is given back. A window the player made fullscreen
      // by hand keeps it, and a window that is already out of fullscreen is
      // left alone rather than toggled *into* it.
      if (ours && (await window.isFullscreen().catch(() => false))) {
        await window.setFullscreen(false);
      }
    } catch {
      /* Still try to restore the saved window state. */
    }

    // The desktop's own colour goes back on the frame before the window is
    // resized, so the strip the compositor shows mid-transition is the shell's
    // background rather than a black band.
    void paintFrame(DESK_COLOUR);

    try {
      await waitForFullscreenExit(window);

      // A fullscreen the player asked for themselves is theirs to keep, and a
      // window that is still inside it is not ours to lay out: resizing under
      // it is what leaves a frame the desktop then has to reconcile.
      if (!ours && (await window.isFullscreen().catch(() => false))) {
        remeasureViewport();
        return;
      }

      const area = await workArea();
      remeasureViewport();

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
      remeasureViewport();
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
