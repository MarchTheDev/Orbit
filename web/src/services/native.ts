/**
 * The bridge to Windows.
 *
 * Inside the packaged app every call goes to a Rust command. Opened in a plain
 * browser (`npm run dev`, no Tauri) the same calls fall back to a preview, so
 * the UI can be worked on in a normal tab without the desktop shell.
 */
import { disable, enable } from '@tauri-apps/plugin-autostart';
import type {
  ActiveSession,
  Game,
  GameLog,
  Playthrough,
  LaunchInfo,
  LaunchTarget,
  Session,
  Settings,
  Stats,
  SteamGame,
  FolderProgram,
  Achievement,
  GameSuggestion,
  LauncherGame,
  OtherLauncher,
} from '../types';
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
  /** The game's old and new root folders, used to update every saved path. */
  fromDir: string;
  toDir: string;
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
/**
 * Tell Orbit the front end has drawn its first frame.
 *
 * The window is created hidden, so the first thing anybody sees is the app
 * rather than a frame of empty window that the animation then covers. This is
 * what puts it on screen; Rust shows it anyway after a few seconds, so a front
 * end that never gets this far still ends up with a window.
 */
export function windowReady(): Promise<void> {
  return call('window_ready', {}, () => undefined);
}

/** Whether the current desktop shell runs on Windows. */
export function isWindows(): Promise<boolean> {
  return call('is_windows', {}, () => false);
}

/** Add or remove Orbit's per-user `.exe` right-click action in Explorer. */
export function setExeContextMenu(enabled: boolean): Promise<void> {
  return call('set_exe_context_menu', { enabled }, () => undefined);
}

/** Paths queued from the Explorer action, including the app's first launch. */
export function takeOpenExePaths(): Promise<string[]> {
  return call('take_open_exe_paths', {}, () => []);
}

/** Listen for an Explorer request delivered by a second Orbit invocation. */
export function onOpenExeRequested(onRequest: () => void): Promise<() => void> {
  const t = tauri();
  if (!t) return Promise.resolve(() => {});
  return t.event.listen('open-exe-requested', () => onRequest());
}

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
export function addGameLog(gameId: string, at: number, secs: number, note: string, details: string): Promise<GameLog | null> {
  return call('add_game_log', { gameId, at, secs, note, details }, () => null);
}

/** Correct a note already written. */
export function updateGameLog(id: number, at: number, secs: number, note: string, details: string): Promise<void> {
  return call('update_game_log', { id, at, secs, note, details }, () => undefined);
}

/** Remove a note. */
export function deleteGameLog(id: number): Promise<void> {
  return call('delete_game_log', { id }, () => undefined);
}

/** Remove one game's Journal entries without changing its general notes. */
export function clearGameLogs(gameId: string): Promise<void> {
  return call('clear_game_logs', { gameId }, () => undefined);
}

/** Remove one playthrough's journal entries. Other runs, notes, and sessions stay. */
export function clearPlaythroughLogs(gameId: string, playthroughId: string): Promise<void> {
  return call('clear_playthrough_logs', { gameId, playthroughId }, () => undefined);
}

/** The run each game is currently writing into. */
export interface CurrentPlaythrough {
  gameId: string;
  id: string;
  name: string;
  /** How many runs the game has, so an unassigned entry can be counted like the journal. */
  runs: number;
}

export function listCurrentPlaythroughs(): Promise<CurrentPlaythrough[]> {
  return call('list_current_playthroughs', {}, () => []);
}

/** The runs of one game. A browser preview gets a single Main run. */
export function listPlaythroughs(gameId: string): Promise<Playthrough[]> {
  return call('list_playthroughs', { gameId }, () => [
    { id: `main-${gameId}`, gameId, name: 'Main', notes: '', current: true },
  ]);
}

export function addPlaythrough(gameId: string, name: string): Promise<Playthrough> {
  return call('add_playthrough', { gameId, name }, () => ({
    id: `pt-${Date.now()}`,
    gameId,
    name,
    notes: '',
    current: true,
  }));
}

export function renamePlaythrough(id: string, name: string): Promise<void> {
  return call('rename_playthrough', { id, name }, () => undefined);
}

export function deletePlaythrough(id: string): Promise<Playthrough> {
  return call('delete_playthrough', { id }, async () => {
    throw new Error('Playthroughs need the desktop app.');
  });
}

export function setCurrentPlaythrough(id: string): Promise<Playthrough> {
  return call('set_current_playthrough', { id }, async () => {
    throw new Error('Playthroughs need the desktop app.');
  });
}

/**
 * Save notes onto the run they were typed for.
 *
 * `playthroughId` is omitted only when the edit screen has not been told which
 * run is open, in which case the current run is the right one.
 */
export function writePlaythroughNotes(gameId: string, notes: string, playthroughId?: string | null): Promise<void> {
  return call('write_playthrough_notes', { gameId, playthroughId: playthroughId ?? null, notes }, () => undefined);
}

/**
 * Every note in the library at once, newest first.
 *
 * The Logs page lists all of them, so they arrive in one read with their game's
 * title attached rather than as one request per game.
 */
export function listAllLogs(limit = 500, offset = 0): Promise<GameLog[]> {
  return call('list_all_logs', { limit, offset }, async () => []);
}

export function countLogs(): Promise<number> {
  return call('count_logs', {}, async () => 0);
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
    totalSecs: SAMPLE_GAMES.reduce((s, g) => s + g.playSecs, 0),
    sessionSecs: SAMPLE_GAMES.reduce((s, g) => s + g.playSecs, 0),
    trackedGames: SAMPLE_GAMES.filter((g) => g.playSecs > 0).length,
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

/**
 * Every folder size Orbit has already measured.
 *
 * Sizes are walked in the background when the app starts, because measuring a
 * game folder means reading every file in it. This returns what is known right
 * now: a folder missing from the map has not been measured yet, which is worth
 * showing as such rather than as zero.
 */
export function cachedSizes(): Promise<Record<string, number>> {
  return call('cached_sizes', {}, async () => ({}));
}

/**
 * Measure these folders again, walking the disk for each one.
 *
 * The Refresh button. Everything else reads the cache, so this is the only
 * call that can take a while on a drive full of games.
 */
export function refreshSizes(paths: string[]): Promise<Record<string, number>> {
  return call('refresh_sizes', { paths }, async () => ({}));
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
    const movedInstallDir = installDir.replace(/^[A-Z]:/i, toFolder.slice(0, 2));
    return { installDir: movedInstallDir, fromDir: installDir, toDir: movedInstallDir, message: null };
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

/**
 * Details and artwork for a title.
 *
 * Rust asks the Steam catalogue, which needs no key. A cover from SteamGridDB
 * or IGDB is added only when those keys are in Settings. A browser preview
 * has no stores to ask, so it answers with something deterministic and says it
 * is only an estimate.
 */
export function metadataLookup<T>(title: string, appId?: number): Promise<T> {
  return call('metadata_lookup', { title, appId: appId ?? null }, async () => {
    await sleep(400);
    return {
      summary: appId
        ? `Details for Steam app ${appId} appear here once Orbit runs as the desktop app.`
        : `Details for "${title}" appear here once Orbit runs as the desktop app.`,
      genres: [],
      developer: '',
      releaseYear: null,
      rating: null,
      coverUrl: null,
      headerUrl: null,
      steamAppId: null,
      source: 'estimate',
    } as T;
  });
}

/** Titles a store suggests for a partial name. */
export function metadataSuggest(title: string): Promise<string[]> {
  return call('metadata_suggest', { title }, async () => []);
}

/**
 * The games a partial title suggests, with the store's own little capsule.
 *
 * Used while a name is being typed, because picking the right game out of a list
 * of similar titles is much easier with the picture in front of you.
 */
export function gameSuggestions(title: string): Promise<GameSuggestion[]> {
  return call('metadata_cards', { title }, async () => {
    // In a browser there is no store to ask, so a few plausible titles stand in
    // and the layout can still be looked at.
    await sleep(250);
    return ['Silksong', 'Hollow Knight: Silksong', 'Crowsworn'].map((name, index) => ({
      appId: 9000 + index,
      name: `${name}${title.trim() ? ` (${title.trim()})` : ''}`,
      coverUrl: null,
    }));
  });
}

/**
 * Every achievement the game's Steam Community page lists.
 *
 * The list is read fresh, because the share of players who have each one moves.
 * Whether an achievement is ticked is the player's own mark and is kept when
 * this comes back.
 */
export function fetchAchievements(gameId: string): Promise<Achievement[]> {
  return call('achievements_fetch', { gameId }, async () => {
    await sleep(250);
    // Four rows so the ticks, the filters and the counters can be tried out.
    return [
      { id: 'FIRST_STEPS', name: 'First Steps', description: 'Set foot in the ruins', icon: '', percent: 88.4, unlocked: false },
      { id: 'NO_SHORTCUTS', name: 'No Shortcuts', description: 'Finish the story without a guide', icon: '', percent: 12.1, unlocked: false },
      { id: 'COLLECTOR', name: 'Collector', description: 'Find every trinket', icon: '', percent: 4.7, unlocked: false },
      { id: 'SPEEDRUN', name: 'Two Hours Flat', description: 'Beat the game in under two hours', icon: '', percent: 0.9, unlocked: false },
    ];
  });
}

/**
 * Every picture the store has for a game, so a cover that crops badly can be
 * swapped for a better one.
 */
export function findArtworkChoices(title: string, appId?: number | null, page = 0): Promise<ArtworkFound> {
  return call('artwork_choices', { title, appId: appId ?? null, page }, async () => ({ appId: null, picks: [] }));
}

export function findArtwork(gameId: string, page = 0): Promise<ArtworkFound> {
  return call(
    'artwork_candidates',
    { gameId, page },
    async () => {
      await sleep(250);
      // Nothing to ask in a browser, and the sample library has no store pages.
      return { appId: null, picks: [] } satisfies ArtworkFound;
    },
  );
}

/**
 * One picture the store has, and what sort of picture it is.
 *
 * `kind` is what decides where a click sends it: a portrait or a capsule is a
 * cover, a hero shot, a logo or a screenshot is a backdrop.
 */
export interface ArtworkPick {
  url: string;
  kind: 'portrait' | 'hero' | 'logo' | 'header' | 'capsule' | 'screenshot';
  label: string;
}

export interface ArtworkFound {
  appId: number | null;
  picks: ArtworkPick[];
  /** Missing on a preview fallback, which has no pages to turn. */
  page?: number;
  hasMore?: boolean;
}

/** Put one game's notes in the order they were dragged into. */
export function reorderGameLogs(gameId: string, ids: number[]): Promise<void> {
  return call('reorder_game_logs', { gameId, ids }, () => undefined);
}

/**
 * Every program in a folder, so an import can ask which one is the game.
 *
 * A different question from `scanFolder`, which guesses one per folder: this
 * returns all of them, with the folder each sits in.
 */
export function folderPrograms(path: string, maxDepth = 3): Promise<FolderProgram[]> {
  return call('folder_programs', { path, maxDepth }, async () => []);
}

/** The player's installed Steam games, for the import dialog. */
/**
 * The player's installed Steam games.
 *
 * `extraPaths` is where the player says Steam is, from Settings. Steam on Linux,
 * and inside a sandbox, is often somewhere Orbit cannot work out from the
 * machine, so it can be told.
 */
export function steamLibrary(extraPaths?: string[]): Promise<SteamGame[]> {
  return call('steam_library', { extraPaths: extraPaths ?? null }, async () => []);
}

/**
 * Installed games one launcher has recorded locally, read only when its picker
 * is opened.
 *
 * `path` is a folder to search as well as the defaults, for the launchers that
 * keep their files somewhere Orbit would not think to look.
 */
export function launcherGames(launcher?: OtherLauncher, path?: string): Promise<LauncherGame[]> {
  const args: Record<string, string> = {};
  if (launcher) args.launcher = launcher;
  if (path?.trim()) args.path = path.trim();
  return call('launcher_games', args, async () => []);
}

/** Register or remove Orbit from the operating system's sign-in startup list. */
export async function setLaunchOnStartup(enabled: boolean): Promise<void> {
  if (!isNative()) throw new Error('Startup settings are only available in the desktop app.');
  if (enabled) await enable();
  else await disable();
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

// ------------------------------------------------------------------- updates

/**
 * Fetch a new version's installer into a temporary folder, and answer where it
 * landed. Only the desktop shell can write files, so a browser says so.
 */
export function downloadUpdate(url: string, fileName: string): Promise<string> {
  return call('download_update', { url, fileName }, async () => {
    throw new Error('Downloading an update needs the desktop app.');
  });
}

/** Hand a downloaded installer to the system. */
export function runUpdate(path: string): Promise<void> {
  return call('run_update', { path }, async () => {
    throw new Error('Running an installer needs the desktop app.');
  });
}

/** Throw away a downloaded installer that is not wanted. */
export function forgetUpdate(path: string): Promise<void> {
  return call('forget_update', { path }, () => undefined);
}

/** Select a file or folder in Explorer. */
export function revealInExplorer(path: string): Promise<void> {
  return call('reveal_in_explorer', { path }, () => undefined);
}

/** Open the game's install folder in the system file manager. */
export function openGameFolder(path: string): Promise<void> {
  return call('open_game_folder', { path }, () => undefined);
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

// ------------------------------------------------------------------- the pad

/**
 * Play the background pad through the system, on Linux.
 *
 * Returns false when no system player is available, which is the web view's
 * cue to try its own audio instead. Anywhere else this is a no-op that says
 * the web view should play.
 */
export function ambientSet(enabled: boolean, volume: number, audible: boolean): Promise<boolean> {
  return call('ambient_set', { enabled, volume, audible }, () => false);
}

/** Play a picked file through the system. False means the web view should try. */
export function ambientFile(path: string, volume: number, audible: boolean): Promise<boolean> {
  return call('ambient_file', { path, volume, audible }, () => false);
}

export interface CopyPreview {
  version: number;
  exportedAt: string;
  hasSettings: boolean;
  playthroughs: number;
  logs: number;
  sessions: number;
  clouds?: number;
}

export interface ExportInfo {
  playthroughs: number;
  logs: number;
  sessions: number;
  clouds?: number;
}

export interface CopyResult {
  settingsApplied: boolean;
  settings: Record<string, unknown> | null;
  playthroughsAdded: number;
  logsAdded: number;
  sessionsAdded: number;
  notesFilled: number;
  skipped: number;
  unmatched: string[];
  unmatchedCount: number;
  notesUpdated: { gameId: string; notes: string }[];
  cloudsRestored?: boolean;
}

export function previewCopy(path: string): Promise<CopyPreview> {
  return call('preview_copy', { path }, async () => {
    throw new Error('Saving or bringing in a file needs the desktop app.');
  });
}

export function exportCopy(path: string, settings: unknown, journal: boolean, sessions: boolean): Promise<ExportInfo> {
  return call('export_copy', { path, settings, journal, sessions }, async () => {
    throw new Error('Saving or bringing in a file needs the desktop app.');
  });
}

export function importCopy(path: string, journal: boolean, sessions: boolean, clouds: boolean): Promise<CopyResult> {
  return call('import_copy', { path, journal, sessions, clouds }, async () => {
    throw new Error('Saving or bringing in a file needs the desktop app.');
  });
}

/** Keep a picked music file with Orbit and return the path that should be saved. */
export function rememberMusic(source: string): Promise<string> {
  return call('remember_music', { source }, async () => source);
}

// ----------------------------------------------------------------- save copies

export interface SaveBackup {
  at: number;
  path: string;
  kind: string;
  note: string;
}

export interface SaveStatus {
  root: string;
}

/** Where a game is installed, so a save search can look in that prefix. */
export interface SaveHints {
  installDir?: string | null;
  prefix?: string | null;
  steamAppId?: number | null;
}

export function saveHintsOf(game: { installDir: string | null; launch: { kind: string; prefix?: string | null; appId?: number } }): SaveHints {
  const launch = game.launch;
  return {
    installDir: game.installDir,
    prefix: launch.kind === 'wine' || launch.kind === 'lutris' ? launch.prefix ?? null : null,
    steamAppId: launch.kind === 'steam' ? launch.appId ?? null : null,
  };
}

export interface SavePlace {
  publisher?: string | null;
  backupRoot?: string | null;
}

export function savePlaceOf(
  game: { meta?: { developer?: string } | null },
  settings?: { saves?: { backupRoot?: string } } | null,
): SavePlace {
  return {
    publisher: game.meta?.developer?.trim() || null,
    backupRoot: settings?.saves?.backupRoot?.trim() || null,
  };
}

export function savesStatus(backupRoot?: string | null): Promise<SaveStatus> {
  return call('saves_status', { backupRoot: backupRoot || null }, () => ({ root: '' }));
}

export function backupSave(
  gameId: string,
  title: string,
  saveDir: string | null,
  hints?: SaveHints,
  place?: SavePlace,
): Promise<SaveBackup> {
  return call('saves_backup', { gameId, title, saveDir, ...hints, ...place }, async () => {
    throw new Error('Backups need the desktop app.');
  });
}

export function restoreSave(
  gameId: string,
  title: string,
  saveDir: string | null,
  hints?: SaveHints,
  place?: SavePlace,
): Promise<string> {
  return call('saves_restore', { gameId, title, saveDir, ...hints, ...place }, async () => {
    throw new Error('Restoring needs the desktop app.');
  });
}

export function findSave(title: string, hints?: SaveHints): Promise<string | null> {
  return call('saves_find', { title, ...hints }, async () => null);
}

export function listSaves(gameId: string, title: string, place?: SavePlace): Promise<SaveBackup[]> {
  return call('saves_list', { gameId, title, ...place }, () => []);
}

export interface CloudStatus {
  ready: boolean;
  version: string;
  /** True when Orbit's own copy will run, rather than rclone already on this PC. */
  placed: boolean;
  /** Folder Orbit keeps its own rclone in. */
  folder: string;
  /** True only when Orbit's own copy is older than the current release. */
  update?: boolean;
  /** The current release, when it was looked up. */
  latest?: string;
}

export function cloudStatus(): Promise<CloudStatus> {
  return call('cloud_status', {}, async () => ({ ready: false, version: '', placed: false, folder: '', update: false, latest: '' }));
}

export function cloudFetch(replace = false): Promise<string> {
  return call('cloud_fetch', { replace }, async () => {
    throw new Error('Cloud copies need the desktop app.');
  });
}

export function cloudCancel(): Promise<void> {
  return call('cloud_cancel', {}, async () => {});
}

export function cloudConnect(
  provider: string,
  fields: { host?: string; user?: string; password?: string; url?: string; extra?: boolean; folder?: string | null; name?: string | null; code?: string | null; mailbox?: string | null } = {},
): Promise<string> {
  return call(
    'cloud_connect',
    {
      provider,
      host: fields.host ?? '',
      user: fields.user ?? '',
      password: fields.password ?? '',
      url: fields.url ?? '',
      extra: !!fields.extra,
      folder: fields.folder ?? null,
      name: fields.name ?? null,
      code: fields.code ?? null,
      mailbox: fields.mailbox ?? null,
    },
    async () => {
      throw new Error('Cloud copies need the desktop app.');
    },
  );
}

export function cloudRemotes(): Promise<string[]> {
  return call('cloud_remotes', {}, async () => []);
}

export function cloudAttach(remote: string, folder?: string | null): Promise<void> {
  return call('cloud_attach', { remote, folder: folder ?? null }, async () => {
    throw new Error('Cloud copies need the desktop app.');
  });
}

export interface CloudGame {
  id: string;
  title: string;
  publisher?: string | null;
  /** The game's own save folder, so a cloud copy does not need a local backup first. */
  dir?: string | null;
}

export function cloudGameOf(
  game: { id: string; title: string; meta?: { developer?: string | null } | null },
  dir?: string | null,
): CloudGame {
  return { id: game.id, title: game.title, publisher: game.meta?.developer?.trim() || null, dir: dir?.trim() || null };
}

export function restoreCloudText(titles: string[], cloud: string): { title: string; description: string } {
  if (titles.length === 1) {
    const title = titles[0] || 'this game';
    return {
      title: `Restore ${title}?`,
      description: `The copy of ${title} on ${cloud} is put back into the save folder. The files there now are replaced. The copy on the cloud is kept.`,
    };
  }
  const count = titles.length;
  return {
    title: `Restore ${count} games?`,
    description: `The copies of ${count} games on ${cloud} are put back into their save folders. The files there now are replaced. The copies on the cloud are kept.`,
  };
}

export function restoreFromCloud(
  account: CloudAccount,
  backupRoot: string | null | undefined,
  games: CloudGame[],
): Promise<string> {
  if (games.length === 0) return Promise.reject(new Error('Choose a game to restore.'));
  return cloudCopy(false, account.remote, account.own, backupRoot, account.folder, games);
}

let cloudDepth = 0;
let cloudKind: 'backup' | 'restore' = 'backup';

/** What the corner ring is showing while a cloud copy runs. */
export interface CloudPulse {
  up: boolean;
  heading: string;
  title: string;
  percent: number | null;
  detail: string;
}

type CloudWatch = (pulse: CloudPulse | null) => void;
let cloudWatch: CloudWatch | null = null;
let cloudActive = false;

/** What a close prompt should say while a cloud copy is running. */
export function currentCloudTransfer(): 'backup' | 'restore' | null {
  return cloudDepth > 0 ? cloudKind : null;
}

export function cloudTransferActive(): boolean {
  return cloudActive;
}

export function watchCloudTransfer(fn: CloudWatch): () => void {
  cloudWatch = fn;
  return () => {
    if (cloudWatch === fn) cloudWatch = null;
  };
}

function showCloud(kind: 'backup' | 'restore') {
  cloudActive = true;
  cloudWatch?.({
    up: kind === 'backup',
    heading: kind === 'backup' ? 'Sending to the cloud' : 'Restoring from the cloud',
    title: '',
    percent: null,
    detail: 'Starting…',
  });
}

function hideCloud() {
  cloudActive = false;
  cloudWatch?.(null);
}

function duringCloud<T>(kind: 'backup' | 'restore', run: () => Promise<T>): Promise<T> {
  cloudDepth += 1;
  cloudKind = kind;
  if (cloudDepth === 1) showCloud(kind);
  return run().finally(() => {
    cloudDepth = Math.max(0, cloudDepth - 1);
    if (cloudDepth === 0) hideCloud();
  });
}

/** Keep the corner ring up for a whole backup, including the copy that stays on this PC. */
export function trackCloud<T>(kind: 'backup' | 'restore', run: () => Promise<T>): Promise<T> {
  return duringCloud(kind, run);
}

export function quitDespiteCloud(): Promise<void> {
  return call('cloud_quit', {}, async () => undefined);
}

export function cloudCopy(
  up: boolean,
  remote: string,
  own: boolean,
  backupRoot?: string | null,
  folder?: string | null,
  only?: CloudGame[] | null,
): Promise<string> {
  return duringCloud(up ? 'backup' : 'restore', () => call(
    'cloud_copy',
    { up, remote, own, backupRoot: backupRoot || null, folder: folder || null, only: only ?? null },
    async () => {
      throw new Error('Cloud copies need the desktop app.');
    },
  ));
}

export function cloudMove(remote: string, own: boolean, from: string, to: string): Promise<string> {
  return duringCloud('backup', () => call('cloud_move', { remote, own, from, to }, async () => {
    throw new Error('Cloud copies need the desktop app.');
  }));
}

export function cloudTransfer(
  fromRemote: string,
  fromOwn: boolean,
  toRemote: string,
  toOwn: boolean,
  folder?: string | null,
): Promise<string> {
  return duringCloud('backup', () => call('cloud_transfer', { fromRemote, fromOwn, toRemote, toOwn, folder: folder || null }, async () => {
    throw new Error('Cloud copies need the desktop app.');
  }));
}

export function cloudAdopt(): Promise<string> {
  return call('cloud_adopt', {}, async () => {
    throw new Error('Cloud copies need the desktop app.');
  });
}

export function cloudDropNext(): Promise<void> {
  return call('cloud_drop_next', {}, async () => undefined);
}

export function cloudPage(remote: string, own: boolean, provider: string): Promise<string | null> {
  return call('cloud_page', { remote, own, provider }, async () => null);
}

export function cloudPending(): Promise<string | null> {
  return call('cloud_pending', {}, async () => null);
}

export function cloudForget(remote?: string | null): Promise<void> {
  return call('cloud_forget', { remote: remote || null }, async () => undefined);
}

export interface CloudAccount {
  remote: string;
  provider: string;
  own: boolean;
  folder?: string;
  on?: boolean;
  /** The email, when this service signed in with one. */
  account?: string;
}

/** A name that tells two accounts of the same service apart. */
export function cloudLabel(account: CloudAccount, all: CloudAccount[]): string {
  const name = account.provider || account.remote;
  const email = account.account?.trim();
  if (email) return `${name} · ${email}`;
  const same = all.filter((item) => item.provider === account.provider);
  if (same.length < 2) return name;
  const index = same.findIndex((item) => item.remote === account.remote) + 1;
  return index > 0 ? `${name} ${index}` : name;
}

/** Connected clouds, including one saved before more than one was allowed. */
export function cloudAccounts(saves?: Settings['saves']): CloudAccount[] {
  if (saves?.clouds) return saves.clouds;
  const one = saves?.cloud;
  if (!one?.remote) return [];
  return [{
    remote: one.remote,
    provider: one.provider || one.remote,
    own: !!one.own,
    folder: one.folder,
    on: true,
  }];
}

export function cloudAutoOn(saves?: Settings['saves']): boolean {
  if (typeof saves?.cloudAuto === 'boolean') return saves.cloudAuto;
  return !!saves?.cloud?.auto;
}

export function cloudSkipOf(saves?: Settings['saves']): string[] {
  if (saves?.cloudSkip) return saves.cloudSkip;
  return saves?.cloud?.skip ?? [];
}

export function chosenClouds(accounts: CloudAccount[]): CloudAccount[] {
  return accounts.filter((account) => account.on !== false);
}

export function freshRemote(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `orbit-${id}`;
}

/** Replace the cloud list and drop the older single connection. */
export function savesWithClouds(
  saves: Settings['saves'] | undefined,
  patch: { clouds?: CloudAccount[]; cloudAuto?: boolean; cloudSkip?: string[] } = {},
): NonNullable<Settings['saves']> {
  const next = { ...(saves ?? {}) } as NonNullable<Settings['saves']> & { syncTo?: string };
  delete next.syncTo;
  delete next.cloud;
  return {
    ...next,
    clouds: patch.clouds ?? cloudAccounts(saves),
    cloudAuto: patch.cloudAuto ?? cloudAutoOn(saves),
    cloudSkip: patch.cloudSkip ?? cloudSkipOf(saves),
  };
}

export async function sendToClouds(
  accounts: CloudAccount[],
  which: 'chosen' | 'all',
  backupRoot?: string | null,
  only?: CloudGame[] | null,
): Promise<string> {
  const targets = which === 'all' ? accounts : chosenClouds(accounts);
  if (targets.length === 0) {
    throw new Error(accounts.length === 0 ? 'Sign in to a cloud first.' : 'Choose a cloud first.');
  }
  const notes: string[] = [];
  for (const account of targets) {
    notes.push(await cloudCopy(true, account.remote, account.own, backupRoot, account.folder, only));
  }
  if (targets.length === 1) return notes[0] ?? 'Sent the copies.';
  return `Sent the copies to ${targets.map((account) => cloudLabel(account, accounts)).join(', ')}.`;
}

/**
 * Send the copies after a backup, when that was asked for.
 *
 * The caller has already kept the copy on this PC. A failure here must be
 * caught there, so the cloud does not undo that.
 */
export function sendCloudAfterBackup(
  saves: Settings['saves'] | undefined,
  backupRoot?: string | null,
  only?: CloudGame[] | null,
): Promise<void> {
  if (!cloudAutoOn(saves)) return Promise.resolve();
  const targets = chosenClouds(cloudAccounts(saves));
  if (targets.length === 0) return Promise.resolve();
  const skip = new Set(cloudSkipOf(saves));
  const games = only?.filter((game) => !skip.has(game.id));
  if (only && (!games || games.length === 0)) return Promise.resolve();
  return sendToClouds(targets, 'all', backupRoot, games).then(() => undefined);
}

export interface OverlayStatus {
  enabled: boolean;
  recording: boolean;
  replay: boolean;
  playing: boolean;
  ffmpeg: boolean;
  seconds: number;
  lengths?: number[];
  quality?: string;
  fps?: number;
  game: string;
  folder: string;
  note: string;
  readyNotice?: string | null;
  /** The last open was covered by the game itself; the panel says so. */
  coverNote?: boolean;
  /** What became of the panel last time, for the Settings page. */
  diag?: string;
}

export function clampOverlaySeconds(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 30;
  return Math.min(300, Math.max(5, Math.round(value)));
}

/** 30, 45, and 60, plus any lengths the player added. */
export function overlayLengths(extra?: number[]): number[] {
  const all = new Set([30, 45, 60]);
  for (const length of extra ?? []) {
    if (!Number.isFinite(length)) continue;
    all.add(clampOverlaySeconds(length));
  }
  return [...all].sort((a, b) => a - b);
}

export function overlayQuality(value?: string): '720p' | '1080p' | '1440p' | '4k' {
  if (value === '720p' || value === '1080p' || value === '1440p' || value === '4k') return value;
  if (value === 'lighter') return '720p';
  if (value === 'sharper') return '1440p';
  return '1080p';
}

export function overlayFps(value?: number): 30 | 60 {
  return value === 60 ? 60 : 30;
}

export function overlayConfigure(options: {
  enabled: boolean;
  replay: boolean;
  seconds: number;
  lengths?: number[];
  quality?: string;
  fps?: number;
  ffmpeg: string;
  screenshotDirectory: string;
  recordingDirectory: string;
  replayDirectory: string;
}): Promise<void> {
  return call('overlay_configure', options, () => undefined);
}

export interface NowPlaying {
  id: string;
  title: string;
  artist: string;
  app: string;
  playing: boolean;
  art: string;
  volumeId: string;
  volume: number;
  muted: boolean;
}

export function mediaNow(): Promise<NowPlaying[]> {
  return call('media_now', {}, () => []);
}

export function mediaControl(id: string, action: 'toggle' | 'next' | 'previous'): Promise<void> {
  return call('media_control', { id, action }, async () => {
    throw new Error('Media controls need the desktop app.');
  });
}

export function overlayMode(): Promise<{ open: boolean; resting: boolean }> {
  return call('overlay_mode', {}, () => ({ open: true, resting: false }));
}

export function overlayPins(has: boolean): Promise<void> {
  return call('overlay_pins', { has }, () => undefined);
}

export function overlayHits(boxes: { x: number; y: number; w: number; h: number }[]): Promise<void> {
  return call('overlay_hits', { boxes }, () => undefined);
}

export function overlayShowPins(): Promise<void> {
  return call('overlay_show_pins', {}, () => undefined);
}

export interface AppAudio {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  device: boolean;
}

export function audioApps(): Promise<AppAudio[]> {
  return call('audio_apps', {}, () => []);
}

export function audioSet(id: string, volume: number, muted: boolean): Promise<void> {
  return call('audio_set', { id, volume, muted }, () => undefined);
}

export interface AudioDevice {
  id: string;
  name: string;
  kind: 'output' | 'input' | string;
  current: boolean;
}

export function audioDevices(): Promise<AudioDevice[]> {
  return call('audio_devices', {}, () => []);
}

export function audioUseDevice(id: string, kind: string): Promise<void> {
  return call('audio_use_device', { id, kind }, async () => {
    throw new Error('Switching audio devices needs the desktop app.');
  });
}

/** Set an app's volume by its name, when the mixer has not handed over an id yet. */
export function audioSetNamed(name: string, volume: number, muted: boolean): Promise<void> {
  return call('audio_set_named', { name, volume, muted }, async () => {
    throw new Error('That app is not playing sound.');
  });
}

export interface MachineStats {
  cpu: number | null;
  ram: number | null;
  ramUsed: number;
  ramTotal: number;
  gpu: number | null;
  vram: number | null;
  vramUsed: number;
  vramTotal: number;
  fps: number | null;
}

/** Whether the last run ended while the panel was reading live stats. */
export function liveStatsSuspect(): Promise<boolean> {
  return call('live_stats_suspect', {}, () => false);
}

export function machineStats(wantFps: boolean): Promise<MachineStats> {
  return call('machine_stats', { wantFps }, () => ({
    cpu: null,
    ram: null,
    ramUsed: 0,
    ramTotal: 0,
    gpu: null,
    vram: null,
    vramUsed: 0,
    vramTotal: 0,
    fps: null,
  }));
}

export function appendPlaythroughNotes(notes: string): Promise<void> {
  return call('append_playthrough_notes', { notes }, async () => {
    throw new Error('Saving a note needs the desktop app.');
  });
}

export function overlayOpenSettings(): Promise<void> {
  return call('overlay_open_settings', {}, () => undefined);
}

export function overlayPlaying(title: string): Promise<void> {
  return call('overlay_playing', { title }, () => undefined);
}

export function overlayReadyNotice(): Promise<void> {
  return call('overlay_ready_notice', {}, () => undefined);
}

/**
 * Give the native card the colours of the player's theme. The card is drawn by
 * Rust, so it is told the palette rather than reading it from the page.
 */
export function overlayTheme(colours: { panel: string; text: string; muted: string; accent: string }): Promise<void> {
  return call('overlay_theme', colours, () => undefined);
}

export function overlayStatus(): Promise<OverlayStatus> {
  return call('overlay_status', {}, () => ({
    enabled: true,
    recording: false,
    replay: true,
    playing: false,
    ffmpeg: false,
    seconds: 30,
    lengths: [30, 45, 60],
    game: '',
    folder: '',
    note: '',
  }));
}

export function overlayShot(stamp: string): Promise<string> {
  return call('overlay_shot', { stamp }, async () => {
    throw new Error('A screenshot needs the desktop app.');
  });
}

export function overlayRecord(stamp: string): Promise<string> {
  return call('overlay_record', { stamp }, async () => {
    throw new Error('Recording needs the desktop app.');
  });
}

export function overlayReplay(seconds: number, stamp: string): Promise<string> {
  return call('overlay_replay', { seconds, stamp }, async () => {
    throw new Error('Saving a clip needs the desktop app.');
  });
}

export function overlayHide(): Promise<void> {
  return call('overlay_hide', {}, () => undefined);
}

/** Proof for the native side that this page is still drawn, sent every second. */
export function overlayAlive(): Promise<void> {
  return call('overlay_alive', {}, () => undefined);
}

export function overlayFolder(): Promise<string> {
  return call('overlay_folder', {}, async () => {
    throw new Error('The clips folder is in the desktop app.');
  });
}

export interface GalleryItem {
  kind: 'screenshot' | 'recording' | 'replay' | string;
  name: string;
  game: string;
  path: string;
}

export function overlayGallery(): Promise<GalleryItem[]> {
  return call('overlay_gallery', {}, () => []);
}

export function overlayOpen(path: string): Promise<void> {
  return call('overlay_open', { path }, async () => {
    throw new Error('Opening a capture needs the desktop app.');
  });
}

export function overlayDelete(path: string): Promise<void> {
  return call('overlay_delete', { path }, async () => {
    throw new Error('Deleting a capture needs the desktop app.');
  });
}

export function overlayCopy(path: string): Promise<void> {
  return call('overlay_copy', { path }, async () => {
    throw new Error('Copying a screenshot needs the desktop app.');
  });
}

export function overlayOpenKind(kind: string): Promise<string> {
  return call('overlay_open_kind', { kind }, async () => {
    throw new Error('Opening a capture folder needs the desktop app.');
  });
}

export function suggestSaves(title: string): Promise<string[]> {
  return call('saves_suggest', { title }, async () => {
    throw new Error('Looking up save paths needs the desktop app.');
  });
}