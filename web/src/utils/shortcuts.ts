import type { OverlayShortcuts, PadChord } from '../types';

/**
 * The capture shortcuts: what a controller and a keyboard press do inside a
 * game.
 *
 * Kept in one place because three things have to agree about them. The settings
 * page draws them, the desktop side registers the keyboard ones with the system
 * and reads the pad ones from the pad, and the overlay says what they are. A
 * shortcut that is drawn but not registered is worse than no shortcut at all,
 * so the list of actions, the button names, and the defaults all live here.
 */

export type CaptureAction = 'shot' | 'record' | 'replay';

export interface ActionWords {
  id: CaptureAction;
  /** What the settings row is called. */
  label: string;
  /** What a press does, in one line. */
  hint: string;
}

/** The three actions, in the order the settings page shows them. */
export const CAPTURE_ACTIONS: ActionWords[] = [
  { id: 'shot', label: 'Screenshot', hint: 'Takes a picture of the game.' },
  { id: 'record', label: 'Recording', hint: 'Starts a recording, or stops the one running.' },
  { id: 'replay', label: 'Replay', hint: 'Saves the last few seconds of play.' },
];

/** A controller button, by the index the pad reports and the name on the pad. */
export interface PadButtonName {
  index: number;
  label: string;
}

/**
 * The buttons a chord can use.
 *
 * The same indices the rest of Orbit reads: a face button, a shoulder, a
 * trigger, Start or Select, and the d-pad. The sticks are left out on purpose -
 * a stick crossing its dead zone is how the ring moves, and a shortcut bound to
 * one would fire every time somebody steered.
 */
export const PAD_BUTTONS: PadButtonName[] = [
  { index: 0, label: 'A' },
  { index: 1, label: 'B' },
  { index: 2, label: 'X' },
  { index: 3, label: 'Y' },
  { index: 4, label: 'LB' },
  { index: 5, label: 'RB' },
  { index: 6, label: 'LT' },
  { index: 7, label: 'RT' },
  { index: 14, label: 'D-pad left' },
  { index: 15, label: 'D-pad right' },
  { index: 12, label: 'D-pad up' },
  { index: 13, label: 'D-pad down' },
  { index: 8, label: 'Select' },
  { index: 9, label: 'Start' },
];

const PAD_NAMES = new Map(PAD_BUTTONS.map((button) => [button.index, button.label]));

/** The name of a pad button, for a chord that was saved with an older list. */
export function padButtonName(index: number): string {
  return PAD_NAMES.get(index) ?? `Button ${index}`;
}

/** The shipped shortcuts: LB with RB, left, and right; F12 and the F keys. */
export const DEFAULT_SHORTCUTS: OverlayShortcuts = {
  pad: {
    shot: { hold: 4, button: 5 },
    record: { hold: 4, button: 14 },
    replay: { hold: 4, button: 15 },
  },
  keys: { shot: 'F12', record: 'Ctrl+F11', replay: 'Ctrl+F10' },
};

/**
 * A chord, written the way a game writes one.
 *
 * "LB + RB" is read as two presses; "RB" on its own as one. Nothing is ever a
 * bare "+", which is what an empty chord would look like.
 */
export function padChordLabel(chord: PadChord | undefined): string {
  if (!chord) return 'Not set';
  const button = padButtonName(chord.button);
  if (chord.hold === null || chord.hold === undefined) return button;
  return `${padButtonName(chord.hold)} + ${button}`;
}

/**
 * A keyboard combination, written the way a game writes it.
 *
 * What is stored is the name the system parses - `Ctrl+KeyS` - because that is
 * the one string that has to be right for the shortcut to work at all. What is
 * drawn is the one a player reads: `Ctrl + S`. The two are one value, shown
 * twice, so a shortcut can never be registered as one thing and displayed as
 * another.
 */
export function keyLabel(combo: string | undefined): string {
  const trimmed = (combo ?? '').trim();
  if (trimmed === '') return 'Not set';
  return trimmed
    .split('+')
    .map((part) => {
      const token = part.trim();
      if (/^Key[A-Z]$/.test(token)) return token.slice(3);
      if (/^Digit\d$/.test(token)) return token.slice(5);
      if (/^Numpad\d$/.test(token)) return `Num ${token.slice(6)}`;
      return KEY_NAMES[token] ?? token;
    })
    .join(' + ');
}

/** The codes whose name on screen is not their name in the settings file. */
const KEY_NAMES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Space: 'Space',
};

/** The codes a shortcut can be made of, as the system names them. */
const CODES = new Set([
  'Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown', 'PrintScreen',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Equal', 'Minus', 'Comma', 'Period', 'Slash', 'Backslash', 'Semicolon',
  'Quote', 'Backquote', 'BracketLeft', 'BracketRight',
]);

function isCode(token: string): boolean {
  return (
    /^Key[A-Z]$/.test(token) ||
    /^Digit\d$/.test(token) ||
    /^Numpad\d$/.test(token) ||
    /^F\d{1,2}$/.test(token) ||
    CODES.has(token)
  );
}

/**
 * What the setting should be, whatever was saved.
 *
 * A settings file can be older than this feature, half-written, or edited by
 * hand. Every field is filled from the defaults and only a value that makes
 * sense survives, so a bad file cannot leave a shortcut pointing at nothing.
 */
export function normalizeShortcuts(value: Partial<OverlayShortcuts> | undefined | null): OverlayShortcuts {
  const pad: Partial<OverlayShortcuts['pad']> = value?.pad ?? {};
  const keys: Partial<OverlayShortcuts['keys']> = value?.keys ?? {};
  const chord = (saved: PadChord | undefined, fallback: PadChord): PadChord => {
    if (!saved || typeof saved !== 'object') return fallback;
    const button = Number(saved.button);
    if (!Number.isInteger(button) || !PAD_NAMES.has(button)) return fallback;
    const hold = saved.hold === null || saved.hold === undefined ? null : Number(saved.hold);
    if (hold !== null && (!Number.isInteger(hold) || !PAD_NAMES.has(hold) || hold === button)) {
      return { hold: null, button };
    }
    return { hold, button };
  };
  // A combination that is written but empty is one the player turned off; one
  // that was never written at all falls back to the shortcut Orbit ships.
  const key = (saved: string | undefined, fallback: string) =>
    typeof saved === 'string' ? shortcutForRegistration(saved) : fallback;
  return {
    pad: {
      shot: chord(pad.shot, DEFAULT_SHORTCUTS.pad.shot),
      record: chord(pad.record, DEFAULT_SHORTCUTS.pad.record),
      replay: chord(pad.replay, DEFAULT_SHORTCUTS.pad.replay),
    },
    keys: {
      shot: key(keys.shot, DEFAULT_SHORTCUTS.keys.shot),
      record: key(keys.record, DEFAULT_SHORTCUTS.keys.record),
      replay: key(keys.replay, DEFAULT_SHORTCUTS.keys.replay),
    },
  };
}

const NAMED_KEYS: Record<string, string> = {
  ESC: 'Escape',
  ESCAPE: 'Escape',
  SPACE: 'Space',
  SPACEBAR: 'Space',
  RETURN: 'Enter',
  ENTER: 'Enter',
  TAB: 'Tab',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  INSERT: 'Insert',
  HOME: 'Home',
  END: 'End',
  PAGEUP: 'PageUp',
  PAGEDOWN: 'PageDown',
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  PRINTSCREEN: 'PrintScreen',
  PLUS: 'Equal',
  MINUS: 'Minus',
  COMMA: 'Comma',
  PERIOD: 'Period',
  SLASH: 'Slash',
  BACKSLASH: 'Backslash',
  SEMICOLON: 'Semicolon',
  QUOTE: 'Quote',
  BACKQUOTE: 'Backquote',
  BRACKETLEFT: 'BracketLeft',
  BRACKETRIGHT: 'BracketRight',
};

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'OS',
  'AltGraph',
  'CapsLock',
  'Super',
]);

/** The key a press was, as the system names it. */
function codeOf(event: { key: string; code?: string }): string | null {
  const code = event.code ?? '';
  if (isCode(code)) return code;
  const key = event.key;
  if (!key) return null;
  // No code, which is a synthetic event or an old browser: the readable name is
  // all there is to go on.
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  if (key === ' ') return 'Space';
  if (/^F\d{1,2}$/.test(key)) return key;
  const fromName = Object.entries(KEY_NAMES).find(([, shown]) => shown === key);
  return fromName ? fromName[0] : key;
}

/**
 * A key press, written as the shortcut it would become.
 *
 * The order is fixed - Ctrl, Alt, Shift, Super, then the key - so the same
 * press is always the same string. A modifier on its own is not a shortcut, and
 * returns null: a shortcut that is only Shift would fire on every capital
 * letter.
 */
export function shortcutFromEvent(event: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): string | null {
  if (!event.key || MODIFIER_KEYS.has(event.key)) return null;
  // A dead key - the accent key on a European layout - never becomes a
  // character, and would leave the shortcut unreadable.
  if (event.key === 'Dead' || event.key === 'Unidentified') return null;
  const code = codeOf(event);
  // A key whose name is `+` cannot be written in a combination joined by `+`,
  // so it is refused rather than saved as something the system would misread.
  if (!code || code.includes('+')) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(code);
  return parts.join('+');
}

/**
 * A combination written by hand, put into the form the system parses.
 *
 * Settings can be edited in a text editor and files from older versions are
 * read as they are, so `Ctrl+S` and `ctrl+keyS` both have to arrive as the same
 * registered shortcut. A value already in that form is left alone, which is
 * what makes this safe to run on every load.
 */
export function shortcutForRegistration(combo: string): string {
  const parts = combo.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const key = parts.pop() as string;
  if (isCode(key)) {
    const modifiers = parts.map((part) => (part === 'Meta' ? 'Super' : part));
    return [...modifiers, key].join('+');
  }
  const upper = key.toUpperCase();
  const resolved =
    /^F\d{1,2}$/.test(upper) || /^KEY[A-Z]$/.test(upper) || /^DIGIT\d$/.test(upper) || /^NUMPAD\d$/.test(upper)
      ? upper.replace(/^KEY([A-Z])$/, 'Key$1').replace(/^DIGIT(\d)$/, 'Digit$1').replace(/^NUMPAD(\d)$/, 'Numpad$1')
      : NAMED_KEYS[upper] ?? (/^[A-Z]$/.test(upper) ? `Key${upper}` : upper);
  const modifiers = parts.map((part) => (part === 'Meta' ? 'Super' : part));
  return [...modifiers, resolved].join('+');
}
