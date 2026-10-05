export type GameStatus = 'backlog' | 'playing' | 'completed' | 'dropped';

export interface TimeLog {
  id: string;
  label: string; // e.g. "Main story", "DLC 2"
  minutes: number;
  date: string; // ISO
}

export interface HltbData {
  main: number; // hours
  mainExtra: number;
  completionist: number;
  source: 'hltb' | 'estimate';
}

/**
 * What a store knows about a game.
 *
 * The name predates Orbit fetching anything other than IGDB: details now come
 * from the Steam catalogue by default and from IGDB when a Twitch app has been
 * saved, which is what `source` says.
 */
export interface IgdbData {
  summary: string;
  genres: string[];
  developer: string;
  releaseYear: number | null;
  rating: number | null;
  coverUrl?: string | null;
  /** The store's own id, so Play can hand the game to Steam. */
  steamAppId?: number | null;
  source?: 'steam' | 'igdb' | 'estimate';
}

/**
 * How a game gets started.
 *
 * `none` means Orbit only runs the clock, and the player starts the game
 * themselves — Play still works, it just does not launch anything.
 */
export type LaunchTarget =
  | { kind: 'none' }
  | { kind: 'executable'; path: string; args: string; workingDir: string | null }
  | { kind: 'steam'; appId: number }
  | { kind: 'emulator'; emulatorPath: string; argsTemplate: string; romPath: string };

export interface LaunchInfo {
  kind: LaunchTarget['kind'];
  label: string;
  startsSomething: boolean;
  path: string | null;
}

export interface Game {
  id: string;
  title: string;
  /** What Orbit starts. Always present, defaulting to time-only. */
  launch: LaunchTarget;
  exePath: string | null;
  installDir: string | null;
  drive: string; // e.g. "C:"
  sizeBytes: number;
  sizeGb: number;
  status: GameStatus;
  favorite: boolean;
  /**
   * A total the player typed in. When it is above zero it replaces the sum of
   * sessions, so playtime added before Orbit was tracking still counts.
   */
  manualPlaySecs: number;
  playMinutes: number;
  lastPlayed: string | null;
  addedAt: string;
  notes: string;
  logs: TimeLog[];
  coverPath: string | null;
  igdb?: IgdbData;
  hltb?: HltbData;
  hue: number; // fallback cover gradient
  sessionCount: number;
  longestSecs: number;
  /** True while a session for this game is open. */
  running: boolean;
}

export type ViewMode = 'grid' | 'list';
export type SortKey = 'title' | 'lastPlayed' | 'playtime' | 'added' | 'size';

/** The three top-level screens; Settings is reached from the gear. */
export type Page = 'library' | 'backlog' | 'sessions' | 'storage' | 'settings';

/** One play session, as stored. */
export interface Session {
  id: number;
  gameId: string;
  gameTitle: string;
  startedAt: number; // Unix seconds
  endedAt: number | null;
  durationSecs: number;
  category: string;
  note: string;
  /** True when the time was typed in rather than played. */
  manual: boolean;
  endedBy: string | null;
}

/**
 * A note the player wrote about a game, with the moment and the time it covers.
 *
 * Nothing creates these automatically. They are the player's own record, such as
 * "finished main story" or "beat the DLC", and unlike a session the date and the
 * duration are both chosen by hand.
 */
export interface GameLog {
  id: number;
  gameId: string;
  /** When it happened, as Unix seconds. */
  at: number;
  /** How much playtime the note is about, in seconds. */
  secs: number;
  note: string;
  createdAt: number;
}

/** The session in progress, if there is one. */
export interface ActiveSession {
  sessionId: number;
  gameId: string;
  gameTitle: string;
  startedAt: number; // Unix seconds
  /** The same moment in milliseconds, for a clock that ticks without rounding. */
  startedAtMs: number;
  /** True when Orbit started nothing, so the player stops it by hand. */
  manual: boolean;
}

export interface Stats {
  totalSecs: number;
  trackedGames: number;
  totalGames: number;
  sessionCount: number;
  longestSecs: number;
  firstPlay: number | null;
  lastPlay: number | null;
}

export interface Settings {
  theme: string;
  /**
   * A Twitch application, which is entirely optional: details and artwork come
   * from the Steam catalogue with no key at all, and IGDB is used instead once
   * these two are filled in. Orbit mints and refreshes the token itself, so
   * there is nothing here that expires or needs pasting again.
   */
  igdbClientId: string;
  igdbClientSecret: string;
  /** A token pasted by hand in an older Orbit, still honoured if present. */
  igdbToken: string;
  /**
   * Folders games are installed in. Orbit will only ever move a game between
   * these, and never touches a game that sits outside them.
   */
  libraryFolders: string[];
  /** Fetch details and cover art when a game is added. */
  fetchMetadata: boolean;
  /** Also fill in details for games that are already in the library. */
  autoFetchMetadata: boolean;
}