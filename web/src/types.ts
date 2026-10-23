export type GameStatus = 'backlog' | 'playing' | 'completed' | 'dropped';
/** The Library has an Unplayed filter; Backlog is its own page. */
export type LibraryFilter = 'all' | 'favorites' | Exclude<GameStatus, 'backlog'> | 'unplayed' | 'hidden';
export type OtherLauncher =
  | 'Epic Games'
  | 'Ubisoft Connect'
  | 'GOG Galaxy'
  | 'EA app'
  | 'Xbox'
  | 'Heroic Games Library'
  | 'Amazon Luna'
  | 'Lutris';
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
  | { kind: 'steam'; appId: number }
  | {
      kind: 'wine';
      path: string;
      args: string;
      /** The Wine prefix. Empty means Wine's default. */
      prefix: string | null;
      /** The wine binary. Empty means `wine` on PATH, or the one in Settings. */
      wine: string | null;
    }
  | {
      kind: 'lutris';
      slug: string;
      gameId: number | null;
      exe: string | null;
      prefix: string | null;
    };

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
export type Page = 'library' | 'sessions' | 'backlog' | 'logs' | 'storage' | 'saves' | 'settings';

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

/** A still from the store page, thumbnailed and full. */
export interface GameFactShot {
  thumb: string;
  full: string;
}

/** A trailer, with the playable file the store page publishes. */
export interface GameFactMovie {
  name: string;
  thumbnail: string;
  mp4: string | null;
  webm: string | null;
}

/** How players received the game, in the store's own words and numbers. */
export interface GameFactReviews {
  summary: string;
  percent: number;
  total: number;
}

/**
 * Everything the store can say about a game before it is anyone's.
 *
 * Shown by the planning sheet that opens from a search suggestion: what the
 * game is, who made it, what it costs, how it was received, and the pictures
 * that make a decision. Filled from Bonker's cache of the Steam catalogue with
 * the store page filling the gaps; how long it takes arrives separately, from
 * HowLongToBeat, because the store does not know it.
 */
export interface GameFacts {
  appId: number;
  name: string;
  summary: string;
  /** The longer store text, plain and trimmed to a page. */
  description: string;
  genres: string[];
  releaseYear: number | null;
  /** The date as the store writes it, "Aug 21, 2012". */
  releaseDate: string | null;
  comingSoon: boolean;
  isFree: boolean;
  /** What the store asks, already in the reader's currency. */
  priceText: string | null;
  developer: string | null;
  publisher: string | null;
  homepage: string | null;
  headerUrl: string | null;
  heroUrl: string | null;
  portraitUrl: string | null;
  logoUrl: string | null;
  screenshots: GameFactShot[];
  movies: GameFactMovie[];
  reviews: GameFactReviews | null;
  /** The low end of what runs it, in the store's own words. */
  pcMinimum: string | null;
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
  /** Lutris's own slug, when the row came from there. */
  slug?: string | null;
  /** Lutris's numeric id, for `lutris:rungameid`. */
  lutrisId?: number | null;
  runner?: string | null;
  winePrefix?: string | null;
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
  /** Which run this time was played on. The game's total is still the whole game. */
  playthroughId?: string | null;
  playthroughName?: string;
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
  /** Which run this entry belongs to. */
  playthroughId?: string | null;
  playthroughName?: string;
}

/**
 * One run of a game.
 *
 * Journal entries and notes belong to the run. Time already counted stays on
 * the game, so two playthroughs do not split the hours in half.
 */
export interface Playthrough {
  id: string;
  gameId: string;
  name: string;
  notes: string;
  current: boolean;
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

/** Boxes the overlay can show. Hidden ones stay out until Settings turns them back on. */
export const OVERLAY_BOXES = [
  { id: 'fps', label: 'FPS' },
  { id: 'performance', label: 'Performance' },
  { id: 'clock', label: 'Clock' },
  { id: 'notes', label: 'Notes' },
  { id: 'player', label: 'Playing' },
  { id: 'audio', label: 'Audio' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'capture', label: 'Capture' },
] as const;

export type OverlayBoxId = (typeof OVERLAY_BOXES)[number]['id'];

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
  /**
   * Where a launcher keeps its files, when the places Orbit looks by default do
   * not cover it: a Flatpak sandbox, a portable install, a drive the walk does
   * not reach. Only launchers that can be pointed somewhere appear here.
   */
  launcherPaths?: Partial<Record<OtherLauncher, string>>;
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
   * Games put on the Backlog by hand, even when they would otherwise stay in
   * the Library only.
   */
  backlogOn?: string[];
  /**
   * Games taken off the Backlog without being removed from the Library.
   */
  backlogOff?: string[];
  /**
   * Whether the interface fades in when the app opens. On by default: it is
   * forty-five hundredths of a second, and it covers the moment the library is
   * still arriving. Off for anybody who would rather it simply be there.
   */
  startupAnimation?: boolean;
  /**
   * Music to play behind everything else, made by the app rather than shipped
   * with it. On unless it has been turned off, so that a fresh install is not
   * silent in a way that reads as broken.
   */
  sound?: {
    enabled: boolean;
    /** 0 to 1. */
    volume: number;
    /** Keep playing while another window has the focus. */
    unfocused: boolean;
    /**
     * A music file kept in Orbit's own folder. Empty means the chord the app
     * makes itself, which is the sound a fresh install plays.
     */
    file?: string | null;
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
    /**
     * What the close button does. `quit` leaves, `tray` hides.
     *
     * Missing means quit, which is what a library saved before this choice
     * already did. Hiding is only honoured when a tray icon exists.
     */
    onAppClose?: 'quit' | 'tray';
    /** Where the minimise button puts the window. Missing means the taskbar. */
    onMinimize?: 'taskbar' | 'tray';
  };
  /** The wine binary to use when a game does not name one. */
  winePath?: string;
  /**
   * The panel opened with Alt+X or Start+Select.
   *
   * On unless it has been turned off. The replay length is seconds, from 5 to
   * 300, and is what "save the last few seconds" keeps while a game is playing.
   */
  overlay?: {
    enabled?: boolean;
    replay?: boolean;
    seconds?: number;
    /**
     * 720p, 1080p, 1440p, or 4k. Older lighter, normal, and sharper values
     * still read as 720p, 1080p, and 1440p. Missing means 1080p.
     */
    quality?: '720p' | '1080p' | '1440p' | '4k' | 'lighter' | 'normal' | 'sharper';
    /** 30 or 60. Missing means 30. */
    fps?: number;
    /** A soft chime when a picture is saved. On unless turned off. */
    shutter?: boolean;
    /** 0 to 100. Missing means a quiet 40. */
    shutterVolume?: number;
    /**
     * Lengths added beside 30, 45, and 60. Each one shows up in the overlay.
     * 5 to 300 seconds.
     */
    lengths?: number[];
    /** Where the overlay boxes were dragged, how big they were made, and which ones stay up. */
    layout?: Partial<Record<OverlayBoxId, { x: number; y: number; w?: number; h?: number; pinned?: boolean }>>;
    /**
     * Which default arrangement is saved. Missing means the older positions,
     * which are placed again once so the new arrangement shows up.
     */
    layoutRevision?: number;
    /** A small note when a screenshot, recording, or replay is saved. On unless turned off. */
    captureToast?: boolean;
    /** A note in Orbit when a game starts, not when the overlay opens. On unless turned off. */
    readyNotice?: boolean;
    /**
     * Read the FPS and performance numbers while the panel is open. On unless
     * turned off. Reading them is the one thing in the panel that reaches into
     * the desktop, and it is turned off by itself when it is the thing that
     * closed the panel last time.
     */
    liveStats?: boolean;
    /** Boxes the player turned off. Missing means every box is shown. */
    hidden?: OverlayBoxId[];
    /** Optional folders for each capture type. Empty means its folder in Orbit's data directory. */
    screenshotDirectory?: string;
    recordingDirectory?: string;
    replayDirectory?: string;
    /** Empty means the built-in recorder. A path is only a fallback. */
    ffmpeg?: string;
  };
  /**
   * Which games back themselves up, and a folder to copy when Orbit cannot
   * find one by looking.
   */
  saves?: {
    auto?: string[];
    dirs?: Record<string, string>;
    /** Where copies are kept. Empty means Orbit's own backups folder. */
    backupRoot?: string;
    /** The Saves list, in the order it was dragged. Games not listed wait at the end. */
    order?: string[];
    /** The cloud page's games, in the order they were dragged. */
    cloudOrder?: string[];
    /** Games left out of the Saves list. They stay in the library, and can be shown again from Saves. */
    hidden?: string[];
    /**
     * Clouds the copies can be sent to. More than one can be connected.
     *
     * `on` missing means that cloud is included. `own` is a remote rclone already
     * had. Orbit does not delete that one. `folder` empty means Orbit.
     * `account` is the email, when the service signed in with one.
     *
     * `cloud` is the older single connection. It is only read when `clouds` is
     * missing, then replaced.
     */
    clouds?: {
      remote: string;
      provider: string;
      own: boolean;
      folder?: string;
      on?: boolean;
      account?: string;
    }[];
    /** After a backup, send to the clouds that are included. */
    cloudAuto?: boolean;
    /** Games left out of the cloud backup. A game can still be sent on its own. */
    cloudSkip?: string[];
    cloud?: {
      remote: string;
      provider: string;
      own: boolean;
      auto?: boolean;
      folder?: string;
      skip?: string[];
    };
  };
}
