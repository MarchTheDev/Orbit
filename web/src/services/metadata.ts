/**
 * Game details.
 *
 * Nothing here needs setting up, and there is no second provider: the Steam
 * catalogue answers with a description, genres, developer, release year and
 * artwork and asks for no key at all. That is what makes a dropped-in game fill
 * itself out.
 */
import type { GameSuggestion, MetaData } from '../types';
import { gameSuggestions, metadataLookup, metadataSuggest } from './native';

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
