import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/**
 * A checkbox that looks like part of the app.
 *
 * The native control is kept — it is what the keyboard, the screen reader and
 * `:focus-visible` all understand — but it is drawn over rather than shown: an
 * OS tick inside an Orbit panel looks like a browser control that lost its way.
 * The box itself lives in `CheckboxBox`, which every row shares.
 */
export function CheckboxBox({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        title={title}
        className="peer size-4 cursor-pointer appearance-none rounded-[5px] border border-line bg-panel transition checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Check
        className="pointer-events-none absolute size-3 text-white opacity-0 transition peer-checked:opacity-100"
        strokeWidth={3.5}
        aria-hidden
      />
    </span>
  );
}

/** A checkbox in a card, with room for an explanation underneath. */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** A second line under the label, for explaining the consequence. */
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-panel2/50 p-3 text-sm transition hover:border-accent/50',
        className,
      )}
    >
      <span className="mt-0.5 flex">
        <CheckboxBox checked={checked} onChange={onChange} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** A checkbox with no card around it, for a footer or a tight row. */
export function CheckboxInline({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <CheckboxBox checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}
