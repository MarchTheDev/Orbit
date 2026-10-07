import { useEffect, useState } from 'react';
import { Logo } from './ui/Logo';

/**
 * Orbit opening.
 *
 * The mark comes up out of the dark with its orbits already turning, a ring
 * sweeps out past it the way the panel's own highlight does, and the name
 * arrives under it. Then the whole thing lifts away and the library is there.
 *
 * It is deliberately short: about a second and a half, which is roughly the
 * moment the library and the covers take to arrive anyway, so it covers the wait
 * rather than adding to it. Turned off in Settings for anybody who would rather
 * the app simply be there, and cut to a plain fade when the system asks for less
 * movement.
 */
export function Startup({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = window.setTimeout(() => setLeaving(true), 1150);
    const done = window.setTimeout(onDone, 1650);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`orbit-startup fixed inset-0 z-[60] grid place-items-center bg-bg ${leaving ? 'orbit-startup-out' : ''}`}
      aria-hidden
    >
      {/* The rings: two circles leaving the mark, one after the other, so the
          window reads as a place in orbit rather than a splash screen. */}
      <span className="orbit-ring" />
      <span className="orbit-ring orbit-ring-late" />

      <div className="relative flex flex-col items-center">
        <Logo className="orbit-startup-mark size-28 text-accent drop-shadow-[0_0_45px_var(--c-accent)]" />
        <p className="orbit-startup-name mt-6 text-2xl font-black tracking-[0.5em] text-fg">ORBIT</p>
        <p className="orbit-startup-name mt-2 text-[11px] uppercase tracking-[0.35em] text-muted">
          your games, in one place
        </p>
      </div>
    </div>
  );
}
