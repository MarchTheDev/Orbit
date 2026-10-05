/**
 * The shape Tauri puts on `window` when `withGlobalTauri` is on, so the UI can
 * reach the native side without importing the API package in every file.
 */
interface TauriInvoke {
  <T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface Window {
  __TAURI__?: {
    core: { invoke: TauriInvoke };
    event: {
      listen: (name: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
    };
  };
}