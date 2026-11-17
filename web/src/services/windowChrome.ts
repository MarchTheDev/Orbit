/**
 * The window's own buttons, drawn by Orbit.
 *
 * On Windows the frame is taken off the window at startup so the app can carry
 * the title bar itself: the bar is already there, and a second one stacked
 * above it was the only part of Orbit that did not belong to it. Linux keeps
 * its own decorations, which the desktop draws to match the rest of the
 * system, so the custom buttons are only ever shown where they are ours.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isNative } from './native';
import { desktopOs } from '../utils/platform';

/** Whether the window draws its own frame and Orbit has to supply the buttons. */
export const customTitleBar = isNative() && desktopOs() === 'windows';

export async function minimizeWindow(): Promise<void> {
  if (!customTitleBar) return;
  try {
    await getCurrentWindow().minimize();
  } catch {
    /* The window is going away; nothing to report. */
  }
}

/** Maximize, or put the window back, whichever the window is not doing now. */
export async function toggleMaximizeWindow(): Promise<void> {
  if (!customTitleBar) return;
  try {
    await getCurrentWindow().toggleMaximize();
  } catch {
    /* Not ours to resize any more. */
  }
}

/** The same close path as the frame's button: the tray policy still applies. */
export async function closeWindow(): Promise<void> {
  if (!customTitleBar) return;
  try {
    await getCurrentWindow().close();
  } catch {
    /* Already closing. */
  }
}

/**
 * Close the window the way its own frame button does.
 *
 * Not gated on `customTitleBar`: a Linux window still has a close path, and the
 * shell behind it decides whether closing means quitting or going to the tray,
 * and asks about a cloud copy that is still running. Stardeck's power switch is
 * that same asks-nothing path, so the two can never disagree.
 */
export async function closeApp(): Promise<void> {
  if (!isNative()) return;
  try {
    await getCurrentWindow().close();
  } catch {
    /* Already on its way out. */
  }
}

/** Watch whether the window is maximized, for the restore glyph. */
export async function watchMaximized(onChange: (maximized: boolean) => void): Promise<() => void> {
  if (!customTitleBar) return () => {};
  const window = getCurrentWindow();
  let stop = () => {};
  void window
    .isMaximized()
    .then(onChange)
    .catch(() => undefined);
  void window
    .onResized(() => {
      void window.isMaximized().then(onChange).catch(() => undefined);
    })
    .then((unlisten) => {
      stop = unlisten;
    })
    .catch(() => undefined);
  return () => stop();
}
