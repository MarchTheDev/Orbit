import type { Game, LauncherGame } from '../types';
import { hashHue, uid } from './format';

/** Normalize separators and casing so the same install is only imported once. */
export function normalizeInstallPath(path: string | null | undefined): string {
  return path?.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLocaleLowerCase() ?? '';
}

/** Return launcher records that are not already represented by path or title. */
export function newLauncherGames(found: LauncherGame[], existing: Game[]): LauncherGame[] {
  const paths = new Set(existing.map((game) => normalizeInstallPath(game.installDir)).filter(Boolean));
  const titles = new Set(existing.map((game) => game.title.trim().toLocaleLowerCase()).filter(Boolean));
  return found.filter((game) => {
    const path = normalizeInstallPath(game.installDir);
    const title = game.name.trim().toLocaleLowerCase();
    if ((path && paths.has(path)) || (title && titles.has(title))) return false;
    if (path) paths.add(path);
    if (title) titles.add(title);
    return Boolean(path && title);
  });
}

/** A launcher record becomes a timer-only library entry until the player configures Play. */
export function gameFromLauncher(row: LauncherGame): Game {
  const drive = /^[a-z]:/i.test(row.installDir) ? row.installDir.slice(0, 2).toUpperCase() : '';
  return {
    id: uid(),
    title: row.name,
    inLibrary: true,
    launch: { kind: 'none' },
    exePath: null,
    installDir: row.installDir,
    drive,
    sizeBytes: row.sizeBytes,
    sizeGb: Math.round((row.sizeBytes / 1e9) * 10) / 10,
    status: 'backlog',
    favorite: false,
    manualPlaySecs: 0,
    playSecs: 0,
    lastPlayed: null,
    addedAt: new Date().toISOString(),
    notes: '',
    hue: hashHue(row.name),
    coverPath: null,
    sessionCount: 0,
    longestSecs: 0,
    running: false,
    companions: [],
  };
}
