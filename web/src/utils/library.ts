import type { Game } from '../types';

/** A game the Library would still show after it leaves the Backlog. */
export function inLibraryShelf(game: Game): boolean {
  return !game.planned && (game.inLibrary || onDisk(game));
}

/** The Library total, excluding planned-only Backlog entries. */
export function libraryCount(games: readonly Game[]): number {
  return games.filter(inLibraryShelf).length;
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
  // Sync controls every Library game, whether it has a path or was added by
  // title for a console. Backlog-only owned games stay here independently.
  return !inLibraryShelf(game) || syncLibrary;
}

/** Whether a game belongs in the Journal list, including explicit overrides. */
export function onJournalPage(id: string, syncLibrary: boolean, on: readonly string[] = [], off: readonly string[] = []): boolean {
  if (off.includes(id)) return false;
  if (on.includes(id)) return true;
  return syncLibrary;
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
