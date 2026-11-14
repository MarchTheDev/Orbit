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
