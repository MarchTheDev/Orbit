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
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isNative } from './native';

/** Whether the document itself is the thing that was made fullscreen. */
let askedTheDocument = false;

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
      await getCurrentWindow().setFullscreen(true);
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

/** Give the window back its chrome. Leaving something that was never taken is fine. */
export async function leaveFullscreen(): Promise<void> {
  if (isNative()) {
    try {
      await getCurrentWindow().setFullscreen(false);
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
