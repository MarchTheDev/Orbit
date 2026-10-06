import type { Game } from '../types';

/**
 * Whether this game is a Steam game, which means one thing: Orbit starts it
 * through Steam.
 *
 * That is true of the games brought in from a Steam library, and false of
 * everything else. A game whose details, cover or achievements were found in
 * the Steam store is not a Steam game, and treating it as one is what made
 * every game in the library look like an import.
 */
export function isSteamGame(game: Game): boolean {
  return game.launch.kind === 'steam';
}

/**
 * The store's numbered page for a game, when there is one.
 *
 * From the launch target on an imported game, and from the details on a game
 * the store was asked about, which is what the achievement list is read for.
 */
export function storeAppId(game: Game): number | null {
  if (game.launch.kind === 'steam') return game.launch.appId;
  return game.meta?.steamAppId ?? null;
}
