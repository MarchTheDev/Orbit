import { siEa, siEpicgames, siGogdotcom, siSteam, siUbisoft } from 'simple-icons';
import type { LauncherId } from '../../types';
import { cn } from '../../utils/cn';

const BRAND_ICONS = {
  Steam: siSteam,
  'Epic Games': siEpicgames,
  'Ubisoft Connect': siUbisoft,
  'GOG Galaxy': siGogdotcom,
  'EA app': siEa,
} satisfies Record<LauncherId, { path: string }>;

/** Official launcher brand mark, kept as a small local SVG path. */
export function LauncherIcon({ launcher, className }: { launcher: LauncherId; className?: string }) {
  const icon = BRAND_ICONS[launcher];
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-5 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}
