import { CloudDownload, CloudUpload, LoaderCircle } from 'lucide-react';
import { cn } from '../utils/cn';
import type { CloudPulse } from '../services/native';

const R = 20;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * A cloud copy, kept in the corner the same way a drive move is.
 *
 * rclone can sit quiet for a long time while a folder opens, so a button that
 * only says "Sending…" looks frozen. This ring is the proof it is still going:
 * it fills when the copy reports how far it is, and turns while that number is
 * not known yet.
 */
export function CloudTransferOrb({
  job,
  lift = false,
}: {
  job: CloudPulse;
  /** Sit above the drive-move ring when both are on screen. */
  lift?: boolean;
}) {
  const known = job.percent !== null && job.percent > 0;
  const pct = known ? Math.min(100, job.percent ?? 0) / 100 : 0;
  const heading = job.heading || (job.up ? 'Sending to the cloud' : 'Restoring from the cloud');
  const detail = job.detail || (job.title ? job.title : 'Copying…');

  return (
    <div className={cn('fixed right-5 z-50 flex items-center gap-2', lift ? 'bottom-24' : 'bottom-5')}>
      <div className="pointer-events-none max-w-52 rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-lg">
        <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-fg">
          {job.up ? <CloudUpload className="size-3.5 shrink-0 text-accent" /> : <CloudDownload className="size-3.5 shrink-0 text-accent" />}
          <span className="truncate">{heading}</span>
        </p>
        {job.title && job.title !== heading && (
          <p className="truncate text-[11px] text-fg">{job.title}</p>
        )}
        <p className="truncate text-[11px] text-muted">{detail}</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
          {known ? (
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all duration-500"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent to-accent2" />
          )}
        </div>
      </div>

      <div
        className="relative grid size-14 shrink-0 place-items-center rounded-full border border-line bg-panel/95 shadow-lg"
        aria-label={known ? `${heading}, ${Math.round(pct * 100)} per cent` : heading}
        title={heading}
      >
        <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
          <circle cx="24" cy="24" r={R} fill="none" strokeWidth="3.5" className="stroke-line" />
          {known ? (
            <circle
              cx="24"
              cy="24"
              r={R}
              fill="none"
              strokeWidth="3.5"
              strokeLinecap="round"
              className="stroke-accent transition-[stroke-dashoffset] duration-500"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - pct)}
            />
          ) : null}
        </svg>
        {known ? (
          <span className="text-[11px] font-bold tabular-nums text-fg">{Math.round(pct * 100)}%</span>
        ) : (
          <>
            <span className="absolute inset-1 animate-pulse rounded-full border-2 border-accent/70" />
            <LoaderCircle className="size-5 animate-spin text-accent" />
          </>
        )}
      </div>
    </div>
  );
}
