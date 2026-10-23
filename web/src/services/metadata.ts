/**
 * Game details.
 *
 * Steam answers with a description, genres, developer, release year and artwork
 * and asks for no key. A cover from SteamGridDB or IGDB is added only when
 * those keys are in Settings, and only when Steam has no portrait.
 */
import type { GameFacts, GameSuggestion, MetaData } from '../types';
import { gameFacts, gameSuggestions, metadataLookup, metadataSuggest } from './native';

/**
 * Details for one title.
 *
 * With an app id the store page is read directly, which also brings the game's
 * proper name, that is what makes importing by id work when the id is all the
 * player has.
 */
export function fetchMetadata(title: string, appId?: number): Promise<MetaData> {
  return metadataLookup<MetaData>(title, appId);
}

/** Titles a store suggests while a name is being typed. */
export function searchTitles(title: string): Promise<string[]> {
  return metadataSuggest(title);
}

/** The same suggestions, as games with pictures rather than names. */
export function searchGames(title: string): Promise<GameSuggestion[]> {
  return gameSuggestions(title);
}

/**
 * Everything the store can say about a game before it is anyone's.
 *
 * The planning sheet's whole page: description, prices, the people behind it,
 * how it was received, screenshots and trailers. Bonker's cache of the Steam
 * catalogue answers, the store page fills the gaps.
 */
export function fetchFacts(appId: number): Promise<GameFacts> {
  return gameFacts(appId);
}
