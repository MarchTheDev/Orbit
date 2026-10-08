import { siEa, siEpicgames, siGogdotcom, siSteam, siUbisoft } from 'simple-icons';
import { Gamepad2 } from 'lucide-react';
import type { LauncherId } from '../../types';
import { cn } from '../../utils/cn';

/** Every launcher whose official mark simple-icons still carries. */
const BRAND_ICONS: Partial<Record<LauncherId, { path: string }>> = {
  Steam: siSteam,
  'Epic Games': siEpicgames,
  'Ubisoft Connect': siUbisoft,
  'GOG Galaxy': siGogdotcom,
  'EA app': siEa,
};

/** Official launcher brand mark, kept as a small local SVG path. */
export function LauncherIcon({ launcher, className }: { launcher: LauncherId; className?: string }) {
  const icon = BRAND_ICONS[launcher];
  // simple-icons dropped the Xbox mark, so there is no official path to draw.
  // A gamepad says the same thing without pretending to be a logo.
  if (!icon) {
    return <Gamepad2 className={cn('size-5 shrink-0', className)} aria-hidden focusable="false" />;
  }
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
