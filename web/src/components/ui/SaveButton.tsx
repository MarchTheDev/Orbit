import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { cn } from '../../utils/cn';
import { btnGradient } from './buttons';

/**
 * The button that keeps a page of edits.
 *
 * It has to look like something that can be pressed, and then look like it was:
 * a lifted gradient at rest, a real press on the way down, and a moment of
 * check-marked confirmation afterwards. Saving quietly was the problem: a
 * button that never moves is a button nobody is sure they pressed.
 */
export function SaveButton({
  onSave,
  label = 'Save changes',
  savedLabel = 'Saved',
  className,
}: {
  /** Returning a promise keeps the button busy until the write is done. */
  onSave: () => void | Promise<void>;
  label?: string;
  savedLabel?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  const run = async () => {
    if (state === 'busy') return;
    setState('busy');
    try {
      await onSave();
      setState('done');
      // Long enough to be seen, short enough not to be in the way.
      setTimeout(() => setState((s) => (s === 'done' ? 'idle' : s)), 1600);
    } catch {
      setState('idle');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === 'busy'}
      className={cn(
        'group relative flex items-center gap-2 overflow-hidden rounded-xl px-4 py-2 text-sm',
        // The same gradient as every other button that does something, plus the
        // extra press this one has earned: it sinks into the panel on the way
        // down and the glow goes with it.
        btnGradient,
        'active:scale-[0.98] active:shadow-[0_2px_8px_-4px_var(--c-accent)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
        state === 'done' && 'from-emerald-500 to-emerald-400 shadow-[0_6px_18px_-6px_rgb(16_185_129)] hover:brightness-100',
        state === 'busy' && 'cursor-wait opacity-90',
        className,
      )}
    >
      {/* A highlight that sweeps across on hover, so the surface reads as a
          thing with a top, rather than as a flat block of colour. */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
      {state === 'busy' ? (
        <LoaderCircle className="relative size-4 animate-spin" />
      ) : (
        <Check className={cn('relative size-4', state === 'done' && 'save-tick')} />
      )}
      <span className="relative">{state === 'idle' ? label : state === 'busy' ? 'Saving' : savedLabel}</span>
    </button>
  );
}
