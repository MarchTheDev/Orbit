import type { Game } from '../types';

/**
 * Whether Orbit has anywhere to point at for this game.
 *
 * The library is a shelf, not a wish list: it holds the games that are on the
 * machine, which are the ones Orbit can start, measure and move. A game that is
 * only owned, with no folder and no program and nothing it has ever run, is a
 * plan, and plans live on the Backlog page. Before this, marking a planned game
 * as owned dropped it straight into the library and into Storage, where it
 * appeared under a drive it had never been installed on.
 *
 * Playtime counts as somewhere to point at, deliberately: a game with sessions
 * behind it is a game that has been played, whatever has happened to its folder
 * since, and hiding it would hide the time with it.
 */
export function onDisk(game: Game): boolean {
  return Boolean(
    game.installDir ||
      game.exePath ||
      (game.launch && game.launch.kind !== 'none') ||
      game.sessionCount > 0 ||
      game.sizeBytes > 0 ||
      game.manualPlaySecs > 0,
  );
}
