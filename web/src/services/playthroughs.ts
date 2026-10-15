/**
 * Which playthrough the notes box was writing into when the words were typed.
 *
 * A save can still be on its way out when the player switches runs. The id is
 * remembered here, at the moment of the keystroke, so those words land on the
 * run they were written for and not on whichever run became current later.
 */
const current = new Map<string, string>();

export function rememberPlaythrough(gameId: string, id: string): void {
  current.set(gameId, id);
}

export function rememberedPlaythrough(gameId: string): string | null {
  return current.get(gameId) ?? null;
}
