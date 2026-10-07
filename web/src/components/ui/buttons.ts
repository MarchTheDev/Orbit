/**
 * The one style every button that does something wears.
 *
 * The accent colour as a fine border and as the text, on a barely-tinted
 * background, rather than a filled block: the button sits in the page instead of
 * on top of it. It lives in `index.css` as `.btn-accent` because it is built
 * from the theme's own accent, and one class cannot drift out of step with
 * itself the way six copies of the utilities did.
 *
 * Add the sizing and shape where it is used: `rounded-lg px-4 py-2 text-sm` and
 * so on. `btnDanger` is the same thing in red, for the button that takes
 * something away.
 */
export const btnAccent = 'btn-accent';
export const btnDanger = 'btn-danger';
