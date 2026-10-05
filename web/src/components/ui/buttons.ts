/**
 * The one button that does something.
 *
 * Every primary action in Orbit wears the same gradient, so "this will do
 * something" is a colour rather than a guess: the add button in the browser,
 * Save on a page of edits, Fetch, Import, Start session. The gradient itself
 * lives in `index.css` as `.btn-grad`, because it has to be built from the
 * theme's own accent colour, and one class cannot drift out of step with itself
 * the way six copies of the utilities did.
 *
 * Add the sizing and shape where it is used: `rounded-lg px-4 py-2 text-sm` and
 * so on. Everything else lives here.
 */
export const btnGradient = 'btn-grad';
