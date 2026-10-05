/**
 * The bridge to Windows.
 *
 * Inside the packaged app every call goes to a Rust command. Opened in a plain
 * browser (`npm run dev`, no Tauri) the same calls fall back to a preview, so
 * the UI can be worked on in a normal tab without the desktop shell.
 */
import type { ActiveSession, Game, GameLog, LaunchInfo, LaunchTarget, Session, Stats } from '../types';
import { SAMPLE_GAMES } from '../data/sampleGames';

interface TauriCore {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}
interface TauriEvent {
  listen: (name: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
}
type TauriGlobal = { core: TauriCore; event: TauriEvent };

const tauri = () => (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__;

/** True when running as the real desktop app rather than a browser preview. */
export const isNative = () => !!tauri();

/** Ask Rust to do something, or fall back to `preview` in a browser. */
async function call<T>(cmd: string, args: Record<string, unknown>, preview: () => T | Promise<T>): Promise<T> {
  const t = tauri();
  return t ? t.core.invoke<T>(cmd, args) : preview();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Somewhere games can be installed. */
export interface DriveInfo {
  drive: string;
  label: string;
  root: string;
  total: number;
  free: number;
}

/** What a finished move leaves behind. */
export interface Moved {
  installDir: string;
  /** Set when the old folder could not be removed and needs the player. */
  message: string | null;
}

/** A game Orbit found while looking through a folder. */
export interface FoundGame {
  title: string;
  exePath: string;
  installDir: string;
  sizeBytes: number;
}

// ----------------------------------------------------------------- the library

/** Every game, with playtime worked out from its sessions. */
export function listGames(): Promise<Game[]> {
  return call('db_list_games', {}, async () => {
    await sleep(150);
    return SAMPLE_GAMES;
  });
}

export function saveGame(game: Game): Promise<void> {
  return call('db_upsert_game', { game }, () => undefined);
}

export function deleteGame(id: string): Promise<void> {
  return call('db_delete_game', { id }, () => undefined);
}

export function clearLibrary(): Promise<void> {
  return call('db_clear_library', {}, () => undefined);
}

/** Executables already tracked, so an import can skip them. */
export function knownExePaths(): Promise<string[]> {
  return call('db_known_exe_paths', {}, async () => []);
}

/** Everything Orbit can work out about a program on disk. */
export interface ExeInfo {
  exePath: string;
  installDir: string;
  drive: string;
  sizeBytes: number;
  coverPath: string | null;
  title: string;
}

export function exeInfo(exePath: string): Promise<ExeInfo> {
  return call(
    'exe_info',
    { exePath },
    async () => ({
      exePath,
      installDir: exePath.replace(/\\[^\\]+$/, ''),
      drive: exePath.slice(0, 2).toUpperCase(),
      sizeBytes: 0,
      coverPath: null,
      title: exePath.replace(/\\[^\\]+$/, '').split('\\').pop() ?? '',
    }),
  );
}

/** Change only how a game is launched. */
export function setLaunchTarget(id: string, launch: LaunchTarget): Promise<void> {
  return call('set_launch_target', { id, launch }, () => undefined);
}

/**
 * Set the playtime a game should show, in seconds.
 *
 * Rust keeps the sessions and stores the difference, so a total equal to what
 * the sessions already hold clears any correction instead of adding to it.
 */
export function setPlaytime(id: string, totalSecs: number): Promise<void> {
  return call('set_playtime', { id, totalSecs }, () => undefined);
}

/** Everything the player has written about one game. */
export function listGameLogs(gameId: string): Promise<GameLog[]> {
  return call('list_game_logs', { gameId }, () => []);
}

/** Write a note against a game. */
export function addGameLog(gameId: string, at: number, secs: number, note: string): Promise<GameLog | null> {
  return call('add_game_log', { gameId, at, secs, note }, () => null);
}

/** Correct a note already written. */
export function updateGameLog(id: number, at: number, secs: number, note: string): Promise<void> {
  return call('update_game_log', { id, at, secs, note }, () => undefined);
}

/** Remove a note. */
export function deleteGameLog(id: number): Promise<void> {
  return call('delete_game_log', { id }, () => undefined);
}

/** What pressing Play will do for a given target. */
export function launchInfo(launch: LaunchTarget): Promise<LaunchInfo> {
  return call('launch_info', { launch }, async () => ({
    kind: launch.kind,
    label: 'Preview',
    startsSomething: launch.kind !== 'none',
    path: launch.kind === 'executable' ? launch.path : null,
  }));
}

/** Pull an app id out of a pasted Steam store link. */
export function parseSteamId(text: string): Promise<number | null> {
  return call('parse_steam_id', { text }, async () => {
    const match = /\/app\/(\d+)/.exec(text) ?? /^(\d+)$/.exec(text.trim());
    return match ? Number(match[1]) : null;
  });
}

/** Look for cover art sitting next to a game. */
export function findCover(exePath: string): Promise<string | null> {
  return call('find_cover', { exePath }, async () => null);
}

/** Which library folder a game is in, or `null` if it is outside them all. */
export function resolveGameFolder(folders: string[], installDir: string): Promise<string | null> {
  return call('resolve_game_folder', { folders, installDir }, async () => folders[0] ?? null);
}

// ---------------------------------------------------------------- the sessions

/** Start a session, and start the game if it has a launch target. */
export function startSession(gameId: string, category = 'Main story'): Promise<ActiveSession> {
  return call('start_session', { gameId, category }, async () => {
    await sleep(300);
    return {
      sessionId: Math.floor(Date.now() / 1000),
      gameId,
      gameTitle: 'Preview',
      startedAt: Math.floor(Date.now() / 1000),
      startedAtMs: Date.now(),
      manual: true,
    };
  });
}

/** Stop the running session and write the time into the library. */
export function stopSession(sessionId: number): Promise<ActiveSession | null> {
  return call('stop_session', { sessionId }, async () => null);
}

/** The session in progress, so a reloaded window picks the clock back up. */
export function activeSession(): Promise<ActiveSession | null> {
  return call('active_session', {}, async () => null);
}

/** Sessions newest first, a page at a time. */
export function listSessions(limit: number, offset: number, gameId?: string): Promise<Session[]> {
  return call('list_sessions', { limit, offset, gameId: gameId ?? null }, async () => []);
}

export function countSessions(gameId?: string): Promise<number> {
  return call('count_sessions', { gameId: gameId ?? null }, async () => 0);
}

/**
 * Correct a finished session.
 *
 * Both the start and the length are editable; Rust derives the end from the two
 * so a session moved to another day stays the same length.
 */
export function updateSession(
  id: number,
  startedAt: number,
  durationSecs: number,
  category: string,
  note: string,
): Promise<void> {
  return call('update_session', { id, startedAt, durationSecs, category, note }, () => undefined);
}

export function deleteSession(id: number): Promise<void> {
  return call('delete_session', { id }, () => undefined);
}

/** Record time by hand, for playing somewhere Orbit cannot see. */
export function logManualSession(
  gameId: string,
  startedAt: number,
  durationSecs: number,
  category: string,
  note: string,
): Promise<void> {
  return call(
    'log_manual_session',
    { gameId, startedAt, durationSecs, category, note },
    () => undefined,
  );
}

export function libraryStats(): Promise<Stats> {
  return call('library_stats', {}, async () => ({
    totalSecs: SAMPLE_GAMES.reduce((s, g) => s + g.playMinutes * 60, 0),
    trackedGames: SAMPLE_GAMES.filter((g) => g.playMinutes > 0).length,
    totalGames: SAMPLE_GAMES.length,
    sessionCount: 0,
    longestSecs: 0,
    firstPlay: null,
    lastPlay: null,
  }));
}

// -------------------------------------------------------------------- storage

/** Every drive on the machine, with room to spare. */
export function listDrives(): Promise<DriveInfo[]> {
  return call('list_drives', {}, () => [
    { drive: 'C:', label: 'System', root: 'C:\\', total: 512e9, free: 128e9 },
  ]);
}

/** How much room a folder takes on disk. */
export function folderSize(path: string): Promise<number> {
  return call('folder_size', { path }, async () => 0);
}

/** Look through a folder for things that look like games. */
export function scanFolder(path: string, maxDepth = 2): Promise<FoundGame[]> {
  return call('scan_folder', { path, maxDepth }, async () => []);
}

/** Free and total bytes on the drive holding a path. */
export function diskSpace(path: string): Promise<[number, number] | null> {
  return call('disk_space', { path }, async () => null);
}

/** The drive a path is on, as `D:`. */
export function driveOf(path: string): Promise<string> {
  return call('drive_of', { path }, () => 'C:');
}

/**
 * Move a game to another library folder, reporting progress as files land.
 *
 * Only folders the player has added are valid targets, and only games already
 * inside one of them can be moved, so this never touches files Orbit did not
 * put there.
 */
export async function moveGameToFolder(
  installDir: string,
  toFolder: string,
  folders: string[],
  onProgress: (p: number) => void,
): Promise<Moved> {
  const t = tauri();
  if (!t) {
    for (let i = 1; i <= 20; i++) {
      await sleep(90);
      onProgress(i / 20);
    }
    return { installDir: installDir.replace(/^[A-Z]:/i, toFolder.slice(0, 2)), message: null };
  }

  const unlisten = await t.event.listen('move-progress', (e) => {
    const p = e.payload as { copied: number; total: number };
    // A folder Orbit cannot measure has a total of zero, which is not "0% done"
    // but "no idea how far along this is". The caller shows that as an
    // indeterminate bar.
    onProgress(p.total > 0 ? Math.min(1, p.copied / p.total) : -1);
  });
  try {
    return await t.core.invoke<Moved>('move_game', { installDir, toFolder, folders });
  } finally {
    unlisten();
  }
}

// ------------------------------------------------------------------- metadata

/** Make a request the browser would not be allowed to make, such as IGDB. */
export async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const t = tauri();
  if (t) {
    return t.core.invoke<T>('http_request', {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ?? null,
    });
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** What Orbit needs to reach IGDB, all of it optional. */
export interface MetaCredentials {
  clientId: string;
  clientSecret: string;
  /** A token pasted by hand, from before Orbit minted its own. */
  token: string;
}

/**
 * Details and artwork for a title.
 *
 * Rust uses the Steam catalogue, which needs no key, and switches to IGDB when
 * credentials are saved. A browser preview has neither, so it answers with
 * something deterministic and says it is only an estimate.
 */
export function metadataLookup<T>(title: string, credentials: MetaCredentials): Promise<T> {
  return call(
    'metadata_lookup',
    {
      title,
      igdbClientId: credentials.clientId,
      igdbClientSecret: credentials.clientSecret,
    },
    async () => {
      await sleep(400);
      return {
        summary: `Details for "${title}" appear here once Orbit runs as the desktop app.`,
        genres: [],
        developer: '',
        releaseYear: null,
        rating: null,
        coverUrl: null,
        steamAppId: null,
        source: 'estimate',
      } as T;
    },
  );
}

/** Titles a store suggests for a partial name. */
export function metadataSuggest(title: string): Promise<string[]> {
  return call('metadata_suggest', { title }, async () => []);
}

/** Completion-time estimates from HowLongToBeat. */
export function hltbSearch<T>(title: string): Promise<T> {
  return call('hltb_search', { title }, async () => {
    await sleep(400);
    // A deterministic stand-in, so the preview still shows something sensible.
    let h = 0;
    for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const main = 8 + (h % 45);
    return {
      main,
      mainExtra: Math.round(main * 1.7),
      completionist: Math.round(main * 2.6),
      source: 'estimate',
    } as T;
  });
}

/** Open a folder in Explorer. */
export function revealInExplorer(path: string): Promise<void> {
  return call('reveal_in_explorer', { path }, () => undefined);
}

// ------------------------------------------------------------------- settings

/** Where Orbit keeps its files. */
export function dataDir(): Promise<string | null> {
  const t = tauri();
  return t ? t.core.invoke<string>('data_dir') : Promise.resolve(null);
}

/** How much space Orbit's own files take. */
export function dataDirSize(): Promise<number> {
  return call('data_dir_size', {}, async () => 0);
}