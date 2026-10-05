import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveSession } from '../types';
import { activeSession, startSession, stopSession } from '../services/native';
import { isNative } from '../services/native';

interface TauriEvent {
  listen: (name: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
}
const eventApi = () =>
  (window as Window & { __TAURI__?: { event: TauriEvent } }).__TAURI__?.event;

/**
 * The running session.
 *
 * The database row and the game process are tied together on the Rust side, so
 * this only has to start it, stop it, and be told when it ended by itself. The
 * `onEnded` callback is how the library learns that playtime has changed.
 */
export function useSession(onEnded: (gameId: string) => void) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  // A window reload should not lose the clock, so ask Rust what is running.
  useEffect(() => {
    let alive = true;
    void activeSession().then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Rust closes the session when the game exits, and says so.
  useEffect(() => {
    const api = eventApi();
    if (!api) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void api.listen('session-ended', (e) => {
      const p = e.payload as { sessionId: number; gameId: string };
      setSession((current) => (current?.sessionId === p.sessionId ? null : current));
      endedRef.current(p.gameId);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const play = useCallback(async (gameId: string, category?: string) => {
    setBusy(true);
    setError(null);
    try {
      const started = await startSession(gameId, category);
      setSession(started);
      return started;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    const current = session;
    if (!current) return;
    // Clear it straight away, so the button cannot be pressed twice, then write
    // the time into the library.
    setSession(null);
    try {
      await stopSession(current.sessionId);
      endedRef.current(current.gameId);
    } catch (e) {
      setError(String(e));
    }
  }, [session]);

  return { session, busy, error, play, stop, native: isNative() };
}