/**
 * What a game asks of the machine that runs it.
 *
 * The store writes its requirements as one long line with a few labels buried
 * in it - "OS: Windows 10 Processor: Intel i5 Memory: 8 GB RAM Storage: 60 GB"
 * - which, printed as it arrives, is a wall with no shape to it. The labels are
 * the shape: split on them and the wall becomes a short list a player can read
 * in two glances, and the one number they actually act on - how much room it
 * takes - can be lifted out of it and shown on its own.
 *
 * This is presentation, not truth: whatever the store leaves out stays out, and
 * a text with no labels at all is handed back untouched rather than guessed at.
 */

/** One line of the requirements: what it is, and what it needs to be. */
export interface Requirement {
  label: string;
  value: string;
}

/**
 * The words the store uses, with the name each is shown under.
 *
 * Longer names come first so that "Sound Card" is not read as a card and
 * "Hard Drive" is not read as a drive: with labels matched in order, the
 * first one to reach a colon wins.
 */
const NAMES: { words: string[]; label: string }[] = [
  { words: ['additional notes', 'notes'], label: 'Additional notes' },
  { words: ['sound card'], label: 'Sound card' },
  { words: ['directx'], label: 'DirectX' },
  { words: ['network'], label: 'Network' },
  { words: ['storage', 'hard drive', 'hard disk', 'disk space'], label: 'Storage' },
  { words: ['graphics', 'video card', 'gpu'], label: 'Graphics' },
  { words: ['memory', 'ram'], label: 'Memory' },
  { words: ['processor', 'cpu'], label: 'Processor' },
  { words: ['operating system', 'os'], label: 'OS' },
];

/** The name a store word is shown under, or nothing when it is not one of ours. */
function labelFor(word: string): string | null {
  const wanted = word.trim().toLowerCase();
  const found = NAMES.find((name) => name.words.includes(wanted));
  return found ? found.label : null;
}

/** Every label word, longest first, so a two-word name is matched before its last word. */
const MARKERS = NAMES.flatMap((name) => name.words)
  .sort((a, b) => b.length - a.length)
  .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** `OS:`, `Hard Drive:` and the rest, wherever they sit in the text. */
const MARKER = new RegExp(`\\b(${MARKERS})\\s*:`, 'gi');

/**
 * The requirements as rows, in the order the store wrote them.
 *
 * Nothing is reordered: a short list reads the way the shop's own page does,
 * and a label repeated twice is only kept the first time, because the second is
 * the recommended side of the same question and this page does not take sides.
 */
export function parseRequirements(text: string): Requirement[] {
  const flat = text
    // Windows line breaks, tags that survived, and every run of whitespace in
    // between become one space: the labels are what carries the shape here.
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^ *minimum: */i, '')
    .trim();
  if (!flat) return [];

  const found: { at: number; end: number; label: string }[] = [];
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(flat)) !== null) {
    const label = labelFor(match[1]);
    if (!label) continue;
    found.push({ at: match.index, end: match.index + match[0].length, label });
  }

  const rows: Requirement[] = [];
  for (let index = 0; index < found.length; index += 1) {
    const here = found[index];
    const next = found[index + 1];
    const value = flat.slice(here.end, next ? next.at : flat.length).trim();
    // A label with nothing after it says nothing; so does the same label again.
    if (!value || rows.some((row) => row.label === here.label)) continue;
    rows.push({ label: here.label, value });
  }
  return rows;
}

/** A size as the store writes it: `60 GB`, `1.5 GB`, `700 MB`. */
const SIZE = /(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\b/i;

/**
 * How much room the game takes, when the store said.
 *
 * The figure is the store's own - "60 GB available space" - so only the number
 * is lifted out of it. Anything in a unit this does not know is handed back
 * whole rather than silently dropped.
 */
export function storageOf(rows: Requirement[]): { size: string; note: string } | null {
  const storage = rows.find((row) => row.label === 'Storage');
  if (!storage) return null;
  const size = SIZE.exec(storage.value);
  if (size) {
    const rest = storage.value.replace(size[0], '').replace(/^[\s,·-]+|[\s,·-]+$/g, '');
    // "available space" and "free space" are the store clearing its throat, not
    // a requirement: they are dropped so the line underneath can say something
    // a player did not already know.
    const noise = /^(?:of\s+)?(?:available|free|disk|hard\s+drive|hd|ssd)?\s*(?:space)?$/i;
    return {
      size: `${size[1].replace(',', '.')} ${size[2].toUpperCase()}`,
      note: noise.test(rest) ? '' : rest,
    };
  }
  return { size: storage.value, note: '' };
}

/** The requirements without the room it takes, which is shown on its own. */
export function withoutStorage(rows: Requirement[]): Requirement[] {
  return rows.filter((row) => row.label !== 'Storage');
}
