export type GameStatus = 'backlog' | 'playing' | 'completed' | 'dropped';
/** The Library has an Unplayed filter; Backlog is its own page. */
export type LibraryFilter = 'all' | 'favorites' | Exclude<GameStatus, 'backlog'> | 'unplayed' | 'hidden';
export type OtherLauncher = 'Epic Games' | 'Ubisoft Connect' | 'GOG Galaxy' | 'EA app' | 'Xbox';
export type LauncherId = 'Steam' | OtherLauncher;
export type FontChoice = 'system' | 'rounded' | 'serif' | 'mono' | 'humanist' | 'book';

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
  /**
   * True once the player has corrected something about this game by hand.
   *
   * Background lookups leave it alone from then on: a title typed in on purpose
   * must not be quietly replaced by whatever the store thinks the file name
   * means. Buttons that ask for a fresh lookup still work, because those are
   * asked for rather than assumed.
   */
  edited?: boolean;
  /** How the cover fills its frame: `cover` crops, `contain` fits it whole. */
  coverFit?: 'cover' | 'contain';
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
  /** Bigger, softer art for the backdrop of a game's own page, when there is a
   *  separate one. Falls back to the header. */
  backgroundUrl?: string | null;
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
  /** True for a game the player means to play but does not have here. */
  planned?: boolean;
  /**
   * On the library's shelf with nothing to start yet.
   *
   * A game added by title alone is in the library from the moment it is added:
   * the program can be pointed at later, and until then it is a game timed by
   * hand. A game written down on the Backlog is the other way round, and says
   * so with `planned`.
   */
  inLibrary?: boolean;
  /**
   * Kept out of the library without being taken out of it.
   *
   * A hidden game is still in Orbit: its sessions, its notes and its playtime
   * are all there, and it can be started again the moment it is unhidden. It is
   * only out of the way, which is what a finished game or one somebody does not
   * want to see every day needs.
   */
  hidden?: boolean;
  /** Achievements as last read, with the player's own ticks. */
  achievements?: Achievement[];
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
  /**
   * Everything played, in seconds: the sessions plus any time typed in by hand.
   *
   * Seconds rather than minutes because rounding down hid short sessions: a
   * session under a minute used to add nothing at all to the total.
   */
  playSecs: number;
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
/** One achievement, as the game's Steam Community page lists it. */
export interface Achievement {
  /** Steam's own API name, which does not change when a title does. */
  id: string;
  name: string;
  description: string;
  icon: string;
  /** The share of players who have it, as a percentage. */
  percent: number;
  /** The player's own mark, kept in the library. Locked until they say so. */
  unlocked: boolean;
  /**
   * When it was unlocked, in seconds since the epoch.
   *
   * Only Steam knows this, and only when it has been asked with a key. Zero
   * means locked, or unlocked by hand, which has no moment attached.
   */
  unlockedAt?: number;
}

/** A suggested game while a title is being typed. */
export interface GameSuggestion {
  appId: number;
  name: string;
  coverUrl: string | null;
}

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

/** A locally discovered install from a launcher other than Steam. */
export interface LauncherGame {
  launcher: string;
  name: string;
  installDir: string;
  /** A path recorded by Epic, if it still exists; imports do not auto-launch it. */
  exePath: string | null;
  sizeBytes: number;
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
  /** Longer free text about this entry, separate from what happened. */
  details: string;
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
  /** Every second in the library: sessions plus any time typed in by hand. */
  totalSecs: number;
  /**
   * The seconds the sessions recorded, on their own.
   *
   * Kept apart from `totalSecs` because the Sessions page is about sessions: a
   * game whose time was typed in by hand is tracked, but it is not a session,
   * and averaging hand-written time into "average session" was wrong.
   */
  sessionSecs: number;
  /**
   * How many games have been played, counted from the sessions themselves.
   *
   * Deleting the last session of a game has to stop it counting, which is what
   * made this read off the session table rather than off the library's cached
   * playtime.
   */
  trackedGames: number;
  totalGames: number;
  sessionCount: number;
  longestSecs: number;
  firstPlay: number | null;
  lastPlay: number | null;
}

export interface Settings {
  theme: string;
  /** The system font stack used throughout the interface. */
  fontFamily?: FontChoice;
  /** The order of the Library filter chips. Missing filters are appended. */
  libraryFilterOrder?: LibraryFilter[];
  /** Library filters the player has chosen not to show. */
  hiddenLibraryFilters?: LibraryFilter[];
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
  /**
   * Where Steam is installed, for the installs Orbit cannot find on its own.
   *
   * Linux and sandboxed builds are the usual reason: Steam under Flatpak or snap
   * sits in a folder of its own, and a player who relocated it has moved it
   * somewhere no list of guesses covers. Empty means Orbit works it out from the
   * machine, which is enough on Windows.
   */
  steamPath?: string;
  /** Other launcher libraries to rescan on Orbit launch. Off for every launcher by default. */
  launcherScanOnLaunch?: OtherLauncher[];
  /** Whether Orbit should be registered to start when the user signs in. Off by default. */
  launchOnStartup?: boolean;
  /** Keep the window hidden in the tray when Orbit is started by the sign-in entry. */
  launchOnStartupBackground?: boolean;
  /** Add or remove Orbit's per-user Windows Explorer action for `.exe` files. On by default. */
  openExeInOrbit?: boolean;
  /**
   * A SteamGridDB API key, for the community's artwork on top of Steam's own.
   *
   * Empty means SteamGridDB is never asked: the store's catalogue needs no key
   * and stays the default. A key is free but it is personal, so Orbit neither
   * ships one nor invents one.
   */
  sgdbApiKey?: string;
  /**
   * A Steam Web API key, for reading back what you have actually unlocked.
   *
   * Empty means achievements stay hand-ticked, which is all Orbit can honestly
   * do without one. With it, plus `steamId`, the list is read from your own
   * account with the moment each one happened.
   */
  steamApiKey?: string;
  /**
   * Your Steam account, as the 17-digit id or as a profile link.
   *
   * A link with a custom name in it is looked up, so either works. Needed
   * alongside `steamApiKey` and for nothing else.
   */
  steamId?: string;
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
  /**
   * Where the tint behind a hovered cover comes from.
   *
   * On by default: the picture's own colours, so the tile reads as one thing.
   * Turned off, the tile is tinted with Orbit's theme colours instead, so the
   * whole library reads as one thing.
   */
  coverTint: boolean;
  /**
   * The player's own order for the tabs along the top.
   *
   * The shape of the app is the same for everybody, but the order somebody
   * works in is not: an imported Steam library wants Library first, somebody
   * clearing a backlog wants Backlog first. Missing tabs are appended where
   * they belong, so an order saved before a tab existed still shows that tab
   * rather than hiding it.
   */
  tabOrder?: Page[];
  /**
   * The player's own order for the games in the Journal, as game ids.
   *
   * The Journal has its own question from the library's: which game am I in the
   * middle of writing about. Games that are not in the list sit at the end, in
   * the order the counts would have put them.
   */
  logOrder?: string[];
  /**
   * The player's own order for the backlog, as game ids.
   *
   * Kept apart from the library order because the two questions are different:
   * the library is a shelf, the backlog is a plan.
   */
  backlogOrder: string[];
  /**
   * Whether a game added with nothing but a title also waits in the Backlog.
   *
   * Off by default, and the difference matters: with it off, a title with no
   * program is a library game Orbit keeps time for, which is what somebody
   * adding a game they own on a console or in another launcher is after. There
   * is no software to point Orbit at, and the Backlog is a list of things to
   * buy, not a list of things to play.
   */
  syncBacklog?: boolean;
  /**
   * Whether the interface fades in when the app opens. On by default: it is
   * forty-five hundredths of a second, and it covers the moment the library is
   * still arriving. Off for anybody who would rather it simply be there.
   */
  startupAnimation?: boolean;
  /**
   * Music to play behind everything else, made by the app rather than shipped
   * with it. Silent until it is turned on.
   */
  sound?: {
    enabled: boolean;
    /** 0 to 1. */
    volume: number;
    /** Keep playing while another window has the focus. */
    unfocused: boolean;
  };
  /**
   * Whether the library's own "Jump back in" panel is drawn.
   *
   * On by default, and it can also be turned off from the panel itself, which
   * is where somebody who does not want it will notice it.
   */
  showHero?: boolean;
  /**
   * Whether the music controls sit in the top bar, beside Settings.
   *
   * On by default: a switch for something you can hear belongs where the sound
   * is, not two clicks away.
   */
  topbarMusic?: boolean;
  /** Whether the top bar's controls dance while the music plays. */
  musicBars?: boolean;
  /**
   * Whether the update check also considers pre-releases.
   *
   * Off by default. A pre-release is published by hand and is often there for a
   * reason, but somebody testing one needs the app to be able to see it.
   */
  updatePrerelease?: boolean;
  /**
   * Whether Orbit asks GitHub for a newer release when it opens.
   *
   * One request to a public API, with nothing attached to it. On by default
   * because a build that never says a new version exists is a build nobody
   * updates, but it is a request leaving the machine, so it is a switch.
   */
  updateCheck?: boolean;
  /**
   * What Orbit's own window does while a game is starting and when it closes.
   *
   * Both are deliberate choices rather than conveniences: closing on launch
   * means no time is tracked after that moment, which the setting says out loud.
   */
  window: {
    /** `nothing`, `minimize` or `close`. */
    onLaunch: 'nothing' | 'minimize' | 'tray' | 'close';
    /** `nothing`, `show` or `quit`. */
    onClose: 'nothing' | 'show' | 'quit';
  };
}