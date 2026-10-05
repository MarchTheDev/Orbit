import { useId } from 'react';

/**
 * The Orbit mark.
 *
 * A planet with one lit side, an orbit broken in two places — once for the moon
 * that rides it, once for the twinkle that answers it — and a second, lighter
 * orbit inside turning the other way. Drawn here rather than imported so the
 * pieces can move: `orbit-spin-outer`, `orbit-spin-inner` and `orbit-twinkle`
 * are the CSS hooks in index.css, and the same drawing is what
 * `src/assets/orbit-mark.svg` and the application icon are made from.
 *
 * Colour is `currentColor`, so the mark follows the theme and whatever surface
 * it sits on. It is always animated — the turning is most of what makes it the
 * Orbit mark — and stops for anyone who has asked for less motion.
 */
export function Logo({
  className,
  animated = true,
  title = 'Orbit',
}: {
  className?: string;
  animated?: boolean;
  title?: string;
}) {
  // A mask is referenced by id, and the mark can be on screen more than once, so
  // each instance names its own rather than sharing one with whatever else the
  // browser happens to find first.
  // React's ids carry colons, which are legal but awkward inside `url(#…)`, so
  // they are stripped: the mask is referenced, not read.
  const maskId = `orbit-lit-${useId().replace(/:/g, '')}`;

  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      className={className}
      fill="currentColor"
    >
      <defs>
        <mask id={maskId}>
          <rect width="512" height="512" fill="white" />
          {/* Where the light does not reach. */}
          <ellipse cx="330" cy="256" rx="62" ry="104" fill="black" fillOpacity="0.55" />
        </mask>
      </defs>

      {/* The outer orbit, broken twice: once where the moon rides, once where
          the twinkle sits. The group is centred on the drawing, so it turns
          about the middle of the mark and not about the corner of the element. */}
      <g transform="translate(256 256)">
        <g className={animated ? 'orbit-spin-outer' : undefined}>
          <circle
            r="206"
            fill="none"
            stroke="currentColor"
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray="451 100 645 100"
            transform="rotate(276)"
          />
          <circle cx="118" cy="169" r="36" fill="currentColor" />
        </g>
      </g>

      {/* The inner orbit, turning the other way. */}
      <g transform="translate(256 256)">
        <g className={animated ? 'orbit-spin-inner' : undefined} opacity="0.6">
          <circle
            r="152"
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray="477 478"
            transform="rotate(69)"
          />
        </g>
      </g>

      {/* The planet, lit from the left. */}
      <circle cx="256" cy="256" r="104" fill="currentColor" mask={`url(#${maskId})`} />

      {/* A point of light in the outer orbit's other break. */}
      <path
        className={animated ? 'orbit-twinkle' : undefined}
        d="M227 22 Q 231 48 257 52 Q 231 56 227 82 Q 223 56 197 52 Q 223 48 227 22 Z"
        fill="currentColor"
      />
    </svg>
  );
}
