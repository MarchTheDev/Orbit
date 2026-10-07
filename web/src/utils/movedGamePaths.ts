import type { Game, LaunchTarget } from '../types';
import { driveOf, rebasePath } from './paths';

/** The paths on a game record that can live inside its moved folder. */
export type MovedGamePaths = Pick<Game, 'installDir' | 'exePath' | 'drive' | 'launch' | 'coverPath' | 'companions'>;

/** Where the move operation left the game's root and recorded install folder. */
export interface MovedGameLocation {
  installDir: string;
  fromDir: string;
  toDir: string;
}

/**
 * Update every saved game path that followed the moved directory.
 *
 * The launch target is what the session runner actually starts, so changing
 * only `exePath` would leave Play pointing at the old disk. Companion tools,
 * local covers, and an explicit working directory can move with the game too.
 */
export function movedGamePaths(game: Game, moved: MovedGameLocation): MovedGamePaths {
  const rebase = (path: string | null): string | null =>
    path === null ? null : rebasePath(path, moved.fromDir, moved.toDir);

  let launch: LaunchTarget = game.launch;
  if (game.launch.kind === 'executable') {
    launch = {
      ...game.launch,
      path: rebasePath(game.launch.path, moved.fromDir, moved.toDir),
      workingDir: rebase(game.launch.workingDir),
    };
  }

  return {
    installDir: moved.installDir,
    exePath: rebase(game.exePath),
    drive: driveOf(moved.installDir) || game.drive,
    launch,
    coverPath: rebase(game.coverPath),
    companions: game.companions.map((companion) => ({
      ...companion,
      path: rebasePath(companion.path, moved.fromDir, moved.toDir),
    })),
  };
}
