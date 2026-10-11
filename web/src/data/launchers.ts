import type { LauncherId } from '../types';

/** One place for every launcher that can be selected for a library scan. */
export const LAUNCHERS: {
  id: LauncherId;
  color: string;
  scannable?: boolean;
  /**
   * The question to ask when this launcher's files are not where Orbit looks.
   * Present only for the launchers that keep their files in a folder a player
   * can move, which is not all of them: Epic's manifests sit in ProgramData,
   * which Windows fixes, and Ubisoft, GOG and EA are read out of the Windows
   * registry, where there is no folder to name at all.
   */
  pathPrompt?: string;
}[] = [
  { id: 'Steam', color: '#9bc6e8' },
  { id: 'Epic Games', color: '#f1f5f9' },
  { id: 'Ubisoft Connect', color: '#77b7ff' },
  { id: 'GOG Galaxy', color: '#d8a1ff' },
  { id: 'EA app', color: '#ff747d' },
  { id: 'Xbox', color: '#9cca3c', pathPrompt: 'Where is your XboxGames folder?' },
  { id: 'Heroic Games Library', color: '#7fd4ff',
    pathPrompt: 'Where is Heroic\u2019s config folder?' },
  // Luna itself streams its games, so there is nothing of its own on disk. What
  // a scan can find is what the Amazon Games client downloaded, through the
  // records Nile keeps beside its config. A player who has never run Nile has
  // nothing to find, and an empty list is the honest answer for them.
  { id: 'Amazon Luna', color: '#c2a3ff',
    pathPrompt: 'Where is Nile\u2019s config folder?' },
];

/**
 * Whether pressing this launcher can find games on this machine.
 *
 * On unless it has been turned off, matching how the rest of the settings read
 * defaults, so a launcher only has to say so when it cannot be scanned.
 */
export function canScan(launcher: { scannable?: boolean }): boolean {
  return launcher.scannable !== false;
}

/** The question to ask for this launcher's folder, if it has one to name. */
export function pathPromptFor(launcherId: LauncherId): string | undefined {
  return LAUNCHERS.find((launcher) => launcher.id === launcherId)?.pathPrompt;
}

/** The line shown under a launcher that has nothing on disk to find. */
export const NOT_SCANNABLE_NOTE = 'Streaming service — add games by hand';
