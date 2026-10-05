/**
 * The parts of the desktop shell that are not commands: the folder and file
 * pickers behind every Browse button, drag and drop from Explorer, and turning
 * a path on disk into something an `<img>` can load.
 *
 * Everything here is desktop-only. In a browser preview the pickers return null
 * and the UI falls back to typing paths, so the app is still usable for design
 * work.
 */
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isNative } from './native';

/** Ask for a folder. `null` means the player cancelled. */
export async function pickFolder(title: string, startAt?: string): Promise<string | null> {
  if (!isNative()) return null;
  const picked = await open({
    directory: true,
    multiple: false,
    title,
    defaultPath: startAt,
  });
  return typeof picked === 'string' ? picked : null;
}

/** Ask for a program. `null` means the player cancelled. */
export async function pickFile(
  title: string,
  extensions: string[] = ['exe', 'bat', 'cmd'],
  startAt?: string,
): Promise<string | null> {
  if (!isNative()) return null;
  const picked = await open({
    directory: false,
    multiple: false,
    title,
    defaultPath: startAt,
    filters: [{ name: 'Programs', extensions }],
  });
  return typeof picked === 'string' ? picked : null;
}

/** Ask for any file, such as a ROM or a cover image. */
export function pickAnyFile(title: string, startAt?: string): Promise<string | null> {
  return pickFile(title, [], startAt);
}

/**
 * A URL an `<img>` can load for a file on disk.
 *
 * The WebView will not read `D:\...` directly, so the path goes through the
 * asset protocol. A browser preview gets the raw path, which will simply fail
 * to load and fall through to whatever comes next.
 */
export function fileSrc(path: string): string {
  if (!isNative()) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

/** What the desktop is doing with a drag. */
export interface DropState {
  type: 'enter' | 'over' | 'drop' | 'leave';
  /**
   * The dragged paths, but only on `enter` and `drop`. The other two events carry
   * a position and nothing else, which is why the event type is passed through
   * rather than leaving the caller to guess from an empty list.
   */
  paths: string[];
}

/**
 * Watch for files dragged in from Explorer or the desktop.
 *
 * Only the desktop shell reports real paths; a browser drag carries a `File`
 * with no location, so `paths` is always empty there and the UI can say so.
 */
export async function onFileDrop(onChange: (state: DropState) => void): Promise<() => void> {
  // A file dropped on a webview that does not intercept it makes the window
  // navigate to that file, which looks exactly like the app falling over. These
  // two listeners stop the default whatever else happens; the desktop shell
  // reports the real paths separately, below, and a browser preview uses them
  // to show the overlay.
  const swallow = (e: DragEvent) => e.preventDefault();
  window.addEventListener('dragover', swallow);
  window.addEventListener('drop', swallow);

  if (!isNative()) {
    // A browser drag has no paths, but the overlay should still react so the
    // feature is visible while designing.
    const on = (type: DropState['type']) => (e: DragEvent) => {
      e.preventDefault();
      onChange({ type, paths: [] });
    };
    window.addEventListener('dragover', on('over'));
    window.addEventListener('dragleave', on('leave'));
    window.addEventListener('drop', on('drop'));
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
      window.removeEventListener('dragover', on('over'));
      window.removeEventListener('dragleave', on('leave'));
      window.removeEventListener('drop', on('drop'));
    };
  }

  // The shell reports the drag through the webview's own event, which is the
  // only place the paths actually exist: a browser drag carries a `File` with
  // no location on it.
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload as { type: DropState['type']; paths?: string[] };
    onChange({ type: payload.type, paths: payload.paths ?? [] });
  });
  return () => {
    window.removeEventListener('dragover', swallow);
    window.removeEventListener('drop', swallow);
    unlisten();
  };
}