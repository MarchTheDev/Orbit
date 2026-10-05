export type GameStatus = 'backlog' | 'playing' | 'completed' | 'dropped';

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
export interface MetaData {
  /** What the store calls the game, when the lookup started from an app id. */
  name?: string | null;
  summary: string;
  genres: string[];
  developer: string;
  releaseYear: number | null;
  rating: number | null;
  /** Portrait artwork, when the store has it. */
  coverUrl?: string | null;
  /** The wide header picture, which every store page has. */
  headerUrl?: string | null;
  /** The store's own id, so Play can hand the game to Steam. */
  steamAppId?: number | null;
  source?: 'steam' | 'estimate';
}

/**
 * How a game gets started.
 *
 * `none` means Orbit only runs the clock, and the player starts the game
 * themselves, Play still works, it just does not launch anything. `steam` is
 * not something the launch editor offers: it is set on games brought in from a
 * Steam library, which have to go through Steam to start at all.
 */
export type LaunchTarget =
  | { kind: 'none' }
  | { kind: 'executable'; path: string; args: string; workingDir: string | null }
  | { kind: 'steam'; appId: number };

/** A program Orbit starts at the same time as the game. */
export interface Companion {
  path: string;
  args: string;
}

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
  coverPath: string | null;
  /** What a store knows about the game. */
  meta?: MetaData;
  hltb?: HltbData;
  /** Programs started alongside the game, such as a frame-rate tool. */
  companions: Companion[];
  hue: number; // fallback cover gradient
  sessionCount: number;
  longestSecs: number;
  /** True while a session for this game is open. */
  running: boolean;
}

export type ViewMode = 'grid' | 'list';
export type SortKey = 'title' | 'lastPlayed' | 'playtime' | 'added' | 'size' | 'manual';

/** The three top-level screens; Settings is reached from the gear. */
export type Page = 'library' | 'sessions' | 'backlog' | 'logs' | 'storage' | 'settings';

/** A game imported from a Steam library. */
/** A program found while looking through a folder, for the import dialog. */
export interface FolderProgram {
  folder: string;
  title: string;
  exePath: string;
  sizeBytes: number;
  folderBytes: number;
  depth: number;
}

/** A game imported from a Steam library. */
export interface SteamGame {
  appId: number;
  name: string;
  installDir: string;
  sizeBytes: number;
  lastPlayed: number | null;
  library: string;
}

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
  /** The game's title, filled in when logs are read across the library. */
  gameTitle?: string;
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
   * Folders games are installed in. Orbit will only ever move a game between
   * these, and never touches a game that sits outside them.
   */
  libraryFolders: string[];
  /**
   * Whether Orbit reads the Steam library at launch and adds anything that is
   * installed but missing here. Off by default: nothing arrives without the
   * player asking for it.
   */
  steamOnLaunch: boolean;
  /** Fetch details and cover art when a game is added. */
  fetchMetadata: boolean;
  /** Also fill in details for games that are already in the library. */
  autoFetchMetadata: boolean;
  /**
   * The player's own order for the library, as game ids.
   *
   * Kept here rather than in the browser's storage, so an order someone
   * arranged survives clearing the WebView profile. Ids that no longer exist
   * are simply ignored, and a game that is not in the list sits at the end.
   */
  sortOrder: string[];
  /** How big the covers and rows are drawn, as a percentage. */
  coverScale: number;
}