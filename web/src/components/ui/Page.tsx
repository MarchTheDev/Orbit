import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/**
 * The shape every page in Orbit shares.
 *
 * The Library grew a page header, a hairline, and a column of content, and the
 * pages beside it were still starting with a card, a different heading size and
 * a third set of margins. This is that shape, written once: the display title,
 * the readings that belong beside it, an optional toolbar, and then the page
 * itself.
 *
 * It is deliberately not a card. Nothing here has a border of its own, so the
 * sections inside it can draw the rules and the reader always knows where the
 * page ends and a panel begins.
 */
export function PageHead({
  title,
  kicker,
  lead,
  meta,
  children,
  className,
}: {
  title: string;
  /** The small word above the title, as the Library uses. */
  kicker?: string;
  /** One sentence, under the title. Quiet enough to skip. */
  lead?: string;
  /** Readings on the right, each `{ value, label }` or free text. */
  meta?: ReactNode;
  /** Buttons that belong to the whole page, under the title. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('orbit-pagehead', className)}>
      <div className="min-w-0">
        {kicker && <p className="orbit-kicker mb-2">{kicker}</p>}
        <h1>{title}</h1>
        {lead && <p className="orbit-pagehead-lead">{lead}</p>}
        {children}
      </div>
      {meta && <div className="orbit-pagehead-meta">{meta}</div>}
    </header>
  );
}

/**
 * One reading in a header: a number and what it counts.
 *
 * Values are tabular so a row of them does not shuffle as the figures change,
 * which is the whole point of putting them in a line.
 */
export function HeadStat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <span>
      <b>{value}</b> {label}
    </span>
  );
}

/**
 * A group of readings on hairlines, the way the game page draws its telemetry.
 *
 * Not a row of cards: five small cards said "five unrelated things" where five
 * columns on one rule say "the numbers for this page". The last cell loses its
 * right-hand rule.
 */
export function Telemetry({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('orbit-telemetry', className)}>{children}</div>;
}

export function TelemetryCell({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="orbit-telemetry-cell">
      <p>{label}</p>
      {value !== undefined && <b>{value}</b>}
      {children}
      {hint && <span>{hint}</span>}
    </div>
  );
}

/**
 * A page section: a heading on a hairline, then whatever it holds.
 *
 * The heading is a small held label rather than a sentence, so the page reads
 * as named groups and the reader can find one without reading the others.
 */
export function Panel({
  title,
  icon: Icon,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Something small on the right of the heading: a count, a button. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('orbit-panelblock', className)}>
      <div className="orbit-panelblock-head">
        <h2>
          {Icon && <Icon className="size-3.5" strokeWidth={1.9} />}
          {title}
        </h2>
        {aside}
      </div>
      <div className={cn('orbit-panelblock-body', bodyClassName)}>{children}</div>
    </section>
  );
}
