import type { OtherLauncher } from '../types';

/** Choices shown anywhere Orbit offers a local launcher import. */
export const OTHER_LAUNCHERS: {
  id: OtherLauncher;
  description: string;
  badge: string;
  color: string;
}[] = [
  { id: 'Epic Games', description: 'Epic library manifests', badge: 'E', color: '#a78bfa' },
  { id: 'Ubisoft Connect', description: 'Ubisoft install records', badge: 'U', color: '#60a5fa' },
  { id: 'GOG Galaxy', description: 'GOG Galaxy installs', badge: 'G', color: '#fb923c' },
  { id: 'EA app', description: 'EA app install records', badge: 'EA', color: '#fb7185' },
];
