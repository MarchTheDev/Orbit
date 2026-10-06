import type { LauncherId } from '../types';

/** One place for every launcher that can be selected for a library scan. */
export const LAUNCHERS: { id: LauncherId; color: string }[] = [
  { id: 'Steam', color: '#9bc6e8' },
  { id: 'Epic Games', color: '#f1f5f9' },
  { id: 'Ubisoft Connect', color: '#77b7ff' },
  { id: 'GOG Galaxy', color: '#d8a1ff' },
  { id: 'EA app', color: '#ff747d' },
];
