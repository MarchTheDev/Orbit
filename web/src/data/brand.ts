/**
 * Orbit's own colours, in one place.
 *
 * The interface is drawn from CSS variables and the theme list; the application
 * icon is a file that has to be rendered before any of that exists. These are
 * the values both of them are made from, so the mark on the desktop and the
 * room behind the library can never drift apart.
 *
 * The accent is a lime signal on a graphite room. It was solar gold for a while,
 * and before that a quieter green; this one is the loudest thing on the page on
 * purpose, because everything else here is grey and a single bright control is
 * easier to find than a page full of tinted ones. Every other colour in the
 * interface is neutral, so the accent can carry all of the emphasis by itself.
 */
export const ORBIT_BRAND = {
  /** The default theme's id, kept because a saved choice has to survive. */
  themeId: 'nebula',
  name: 'Orbital',
  bg: '#0a0b0d',
  panel: '#111214',
  panel2: '#181a1d',
  border: '#26282d',
  text: '#f2f3f5',
  muted: '#8d9097',
  /** The signal: lime, the one loud colour in the room. */
  accent: '#d3f36b',
  /** Cool cyan, for numbers and the second thing that matters. */
  accent2: '#63c9d6',
  /** Read on top of the accent - lime is bright, so this is nearly black. */
  onAccent: '#141a06',
} as const;

/**
 * The icon's own drawing colours.
 *
 * A desktop icon is small and often on a bright dock, so it is not inverted
 * the way the in-app mark is. The plate is the graphite of the window with a
 * lime glow behind it, and the mark on it is the dark that a lit surface would
 * leave - which is the one arrangement of these two colours that still reads at
 * 16 pixels on a white taskbar and on a black one.
 */
export const ORBIT_ICON = {
  plateFrom: '#1b1d22',
  plateTo: '#08090b',
  /** The glow behind the mark is the signal itself, not a warmer cousin of it. */
  glow: '#d3f36b',
  /** The mark is the signal itself, warmed towards white at its upper edge. */
  inkFrom: '#f4ffd6',
  inkTo: '#cded63',
} as const;
