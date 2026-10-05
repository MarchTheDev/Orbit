/**
 * The Orbit mark.
 *
 * One file, deliberately: the header, the empty states and the app icon all
 * come from the same drawing, so replacing it with a different one is a single
 * edit rather than a hunt through the app. Colours are CSS variables, which is
 * what keeps it in step with the chosen theme.
 *
 * `animated` sets the moon going around the ring; the motion is CSS (see
 * index.css) and stops for anyone who has asked for less of it.
 */
export function Logo({
  className,
  animated = false,
  title = 'Orbit',
}: {
  className?: string;
  animated?: boolean;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={className}>
      <defs>
        <linearGradient id="orbit-planet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--c-accent)" />
          <stop offset="100%" stopColor="var(--c-accent2)" />
        </linearGradient>
      </defs>

      {/* The ring, drawn behind the planet so the near side passes in front. */}
      <ellipse
        cx="32"
        cy="32"
        rx="27"
        ry="10.5"
        fill="none"
        stroke="var(--c-accent)"
        strokeOpacity="0.7"
        strokeWidth="2.6"
        transform="rotate(-24 32 32)"
      />
      <circle cx="32" cy="32" r="15.5" fill="url(#orbit-planet)" />
      <circle cx="25" cy="26" r="4.2" fill="#fff" fillOpacity="0.32" />

      {/* The far half of the ring, over the planet, so it reads as an orbit. */}
      <path
        d="M12.5 45.5 A 27 10.5 -24 0 0 51.5 18.5"
        fill="none"
        stroke="var(--c-accent)"
        strokeOpacity="0.7"
        strokeWidth="2.6"
      />

      <g className={animated ? 'orbit-moon' : undefined} style={{ transformOrigin: '32px 32px' }}>
        <circle cx="32" cy="5" r="3.6" fill="var(--c-accent2)" />
      </g>
    </svg>
  );
}
