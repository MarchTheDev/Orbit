import type { Game } from '../types';

/** A game the Library would still show after it leaves the Backlog. */
export function inLibraryShelf(game: Game): boolean {
  return !game.planned && (game.inLibrary || onDisk(game));
}

/**
 * Whether the Backlog page lists this game.
 *
 * `backlogOff` wins, so taking a game off the page does not delete it.
 * `backlogOn` puts a library game back without changing how the Library works.
 */
export function onBacklogPage(game: Game, syncLibrary: boolean, on: readonly string[] = [], off: readonly string[] = []): boolean {
  if (game.planned) return false;
  if (off.includes(game.id)) return false;
  if (on.includes(game.id)) return true;
  return onDisk(game) || !game.inLibrary || syncLibrary;
}

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
 *
 * A game added by title alone is the exception, and says so with `inLibrary`:
 * the player put it on the shelf, so it stays on the shelf, waiting for a
 * program or kept as something to time by hand.
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
