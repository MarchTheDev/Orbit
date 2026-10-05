/** What a play session can be logged as. */
export const CATEGORIES = [
  'Main story',
  'DLC',
  'Multiplayer',
  'Co-op',
  'Side content',
  'Replay',
  'Mods',
  'Other',
] as const;

export const DEFAULT_CATEGORY = CATEGORIES[0];