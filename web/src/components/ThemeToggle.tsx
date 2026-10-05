import type { Settings } from '../types';
import { THEMES } from '../data/themes';

/**
 * Cycles through the themes.
 *
 * A picker would need a popover and a click-outside handler; a single button
 * that steps to the next theme is enough for something nobody changes often.
 */
export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Settings['theme'];
  onChange: (id: Settings['theme']) => void;
}) {
  const index = THEMES.findIndex((t) => t.id === theme);
  const next = THEMES[(index + 1 + THEMES.length) % THEMES.length];
  const current = THEMES[index] ?? THEMES[0];

  return (
    <button
      onClick={() => onChange(next.id)}
      title={`${current.name} · click for ${next.name}`}
      aria-label={`Theme: ${current.name}`}
      className="size-9 rounded-full border border-line transition hover:border-accent"
      style={{ background: `linear-gradient(135deg, ${current.accent}, ${current.accent2})` }}
    />
  );
}