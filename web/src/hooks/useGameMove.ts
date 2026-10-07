import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game } from '../types';
import { moveGameToFolder } from '../services/native';
import { movedGamePaths, type MovedGamePaths } from '../utils/movedGamePaths';

/** Where a move has got to. */
export type MoveState = 'running' | 'done' | 'error';

/** One game being moved, and how far along it is. */
export interface MoveJob {
  gameId: string;
  title: string;
  /** Where it started, which is what the ring is a picture of. */
  from: string;
  to: string;
  /** 0 to 1, or null until the first byte lands. */
  progress: number | null;
  state: MoveState;
  /** Where the game ended up, once it is there. */
  dir?: string;
  /** Set when the copy went through but the original could not be removed. */
  message?: string | null;
  error?: string;
}

/**
 * The move, kept out of the dialog that starts it.
 *
 * A move is a copy of every file in a game, which for a large one is minutes of
 * waiting, and the dialog it started in is a modal - so leaving the dialog open
 * for the duration meant the rest of the app was unusable while a game was
 * being copied. This lives above the dialog instead: the dialog can be
 * minimized and put back, and the copy carries on either way, because nothing
 * here is tied to the dialog being mounted.
 *
 * One move at a time, on purpose. Two copies competing for the same disk is
 * slower than one, and a single ring in the corner is a thing a player can
 * read at a glance where two are not.
 */
export function useGameMove(onApplied: (gameId: string, paths: MovedGamePaths) => void) {
  const [job, setJob] = useState<MoveJob | null>(null);

  // The apply callback is whatever the caller passed on this render, but the
  // move finishes long after that render, so it is kept in a ref and read at
  // the end rather than captured at the start.
  const apply = useRef(onApplied);
  useEffect(() => {
    apply.current = onApplied;
  }, [onApplied]);

  // Likewise the running flag, which the dialog reads synchronously.
  const running = job?.state === 'running';

  const start = useCallback(
    async (game: Game, toFolder: string, folders: string[]) => {
      const from = game.installDir;
      if (!from) return;
      setJob({ gameId: game.id, title: game.title, from, to: toFolder, progress: null, state: 'running' });
      try {
        const moved = await moveGameToFolder(from, toFolder, folders, (p) => {
          // A negative report means the folder could not be measured, which is
          // "no idea how far along this is" and not "0 per cent done": it goes
          // back to unknown rather than to a number that looks like progress.
          // Anything else only ever moves forwards, since a folder that
          // finishes early must not make the ring go backwards.
          setJob((current) => {
            if (!current || current.gameId !== game.id) return current;
            if (p < 0) return current.progress === null ? current : { ...current, progress: null };
            return { ...current, progress: Math.max(current.progress ?? 0, Math.min(1, p)) };
          });
        });
        apply.current(game.id, movedGamePaths(game, moved));
        setJob((current) =>
          current && current.gameId === game.id
            ? {
                ...current,
                progress: 1,
                state: 'done',
                dir: moved.installDir,
                message: moved.message,
              }
            : current,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setJob((current) =>
          current && current.gameId === game.id ? { ...current, state: 'error', error: message } : current,
        );
      }
    },
    [],
  );

  /** Put the finished or failed ring away. A running one is left alone. */
  const dismiss = useCallback(() => {
    setJob((current) => (current && current.state === 'running' ? current : null));
  }, []);

  return { job, running, start, dismiss };
}
