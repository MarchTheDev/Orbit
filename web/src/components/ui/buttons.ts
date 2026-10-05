/**
 * The one button that does something.
 *
 * Every primary action in Orbit wears the same gradient, so "this will do
 * something" is a colour rather than a guess: the add button in the browser,
 * Save on a page of edits, Fetch, Import. It sits in one place because it had
 * been written out six times and had drifted: some buttons were a flat block of
 * the accent colour, some were a gradient, and the flat ones read as disabled.
 *
 * The rest of the look is the same everywhere too: a shadow tinted with the
 * accent so the button looks lit rather than pasted on, a small lift on hover,
 * and a real press that sinks it a pixel.
 */
export const btnGradient =
  'bg-gradient-to-r from-accent to-accent2 text-white font-semibold shadow-lg shadow-accent/25 ' +
  'transition duration-150 hover:brightness-110 hover:shadow-accent/40 ' +
  'active:translate-y-[1px] active:brightness-95 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100';
