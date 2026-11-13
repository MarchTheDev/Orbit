import type { Game } from '../types';
import { fileSrc } from '../services/desktop';

/** The widest picture the game has: backdrop, then header, then cover. */
export function wideArt(game: Game): string | null {
  if (game.coverPath) return fileSrc(game.coverPath);
  return game.meta?.backgroundUrl ?? game.meta?.headerUrl ?? game.meta?.coverUrl ?? null;
}
