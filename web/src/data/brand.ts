/**
 * Orbit's own colours, in one place.
 *
 * The interface is drawn from CSS variables and the theme list; the application
 * icon is a file that has to be rendered before any of that exists. These are
 * the values both of them are made from, so the mark on the desktop and the
 * room behind the library can never drift apart.
 *
 * The accent is solar gold, not the graphite-lime the first builds shipped: the
 * icon was still wearing the old green while the window had already gone gold,
 * which made the app look like two different programs.
 */
export const ORBIT_BRAND = {
  /** The default theme's id, kept because a saved choice has to survive. */
  themeId: 'nebula',
  name: 'Orbital',
  bg: '#07090f',
  panel: '#0c1119',
  panel2: '#121a26',
  border: '#1e2938',
  text: '#eef2f7',
  muted: '#8b98ab',
  accent: '#e9a23b',
  accent2: '#63c9d6',
  onAccent: '#160f04',
} as const;

/**
 * The icon's own drawing colours.
 *
 * A desktop icon is small and often on a bright dock, so it is not the theme's
 * near-black: the plate is a deep indigo that still reads as space, and the mark
 * is white warmed towards the gold at its lower edge, which is how the solid
 * mark is tinted in the app.
 */
export const ORBIT_ICON = {
  plateFrom: '#151b2b',
  plateTo: '#080a12',
  glow: '#e9a23b',
  inkFrom: '#fffdf8',
  inkTo: '#f2c078',
} as const;
