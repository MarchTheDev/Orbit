import { AlertTriangle, Check, X } from 'lucide-react';
import type { MoveJob } from '../hooks/useGameMove';
import { cn } from '../utils/cn';

/** The ring's radius, in the SVG's own units. */
const R = 20;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * A move, minimized.
 *
 * One circle in the corner that fills as the copy goes, so the rest of the app
 * is usable while a large game is being moved and the answer to "how much is
 * left" is a glance rather than a dialog to open. Pressing it brings the move
 * dialog back; once it has finished, the cross puts it away.
 *
 * It is a button rather than a status badge because the whole point is that the
 * dialog it came from is one press away.
 */
export function MoveProgressOrb({
  job,
  onOpen,
  onDismiss,
}: {
  job: MoveJob;
  /** Brings the move dialog back for this game. */
  onOpen: (gameId: string) => void;
  onDismiss: () => void;
}) {
  const pct = job.progress ?? 0;
  const done = job.state === 'done';
  const failed = job.state === 'error';
  const ring = done ? 'stroke-emerald-400' : failed ? 'stroke-rose-400' : 'stroke-accent';

  const label = done
    ? `${job.title} has been moved`
    : failed
      ? `${job.title} could not be moved`
      : job.progress === null
        ? `Moving ${job.title}`
        : `Moving ${job.title}, ${Math.round(pct * 100)} per cent`;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
      {/* The name travels with the ring: a percentage on its own does not say
          which game it belongs to, and more than one game can be on screen. */}
      <div className="pointer-events-none max-w-44 rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-lg">
        <p className="truncate text-xs font-semibold text-fg">{job.title}</p>
        <p className="truncate text-[11px] text-muted">
          {done ? 'Moved' : failed ? (job.error ?? 'Could not be moved') : 'Moving…'}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onOpen(job.gameId)}
        aria-label={label}
        title={label}
        className={cn(
          'group relative grid size-14 shrink-0 place-items-center rounded-full border border-line bg-panel/95 shadow-lg transition',
          'hover:border-accent',
        )}
      >
        <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
          <circle cx="24" cy="24" r={R} fill="none" strokeWidth="3.5" className="stroke-line" />
          <circle
            cx="24"
            cy="24"
            r={R}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            className={cn(ring, 'transition-[stroke-dashoffset] duration-200')}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - pct)}
          />
        </svg>

        {done ? (
          <Check className="size-5 text-emerald-400" />
        ) : failed ? (
          <AlertTriangle className="size-5 text-rose-400" />
        ) : job.progress === null ? (
          // The folder could not be measured, so there is no honest number to
          // put here; the ring breathes instead of pretending to fill.
          <span className="absolute inset-0 animate-pulse rounded-full border-2 border-accent/70" />
        ) : (
          <span className="text-[11px] font-bold tabular-nums text-fg">{Math.round(pct * 100)}%</span>
        )}
      </button>

      {job.state !== 'running' && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Put the move away"
          title="Put the move away"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-panel/95 text-muted transition hover:border-accent hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
