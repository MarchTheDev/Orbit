use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A game in the library.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Game {
    pub id: i64,
    pub name: String,
    pub developer: String,
    pub publisher: String,
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    pub platforms: Vec<String>,
    /// Free-form notes the user can edit in the detail pane.
    pub notes: String,
    pub cover_path: Option<PathBuf>,
    /// The folder on disk this game lives in, e.g. `D:\Games\Hades`. Set when
    /// the game sits inside one of the configured library folders, which is
    /// what makes Orbit willing to move it between drives.
    pub install_dir: Option<PathBuf>,
    pub description: String,
    /// What Orbit should do when "Play" is pressed.
    pub launch: LaunchTarget,
    pub hltb: Option<HltbData>,
    /// Manually tracked total in seconds, authoritative when not auto-tracking.
    pub manual_playtime_secs: i64,
    /// 0-100, or -1 for unrated.
    pub rating: i32,
    pub hidden: bool,
    /// Unix seconds.
    pub created_at: i64,
    pub updated_at: i64,
    pub last_played: Option<i64>,
}

impl Game {
    pub fn new(name: impl Into<String>) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: 0,
            name: name.into(),
            developer: String::new(),
            publisher: String::new(),
            release_date: None,
            genres: Vec::new(),
            platforms: Vec::new(),
            notes: String::new(),
            cover_path: None,
            install_dir: None,
            description: String::new(),
            launch: LaunchTarget::None,
            hltb: None,
            manual_playtime_secs: 0,
            rating: -1,
            hidden: false,
            created_at: now,
            updated_at: now,
            last_played: None,
        }
    }
}

/// How a game gets started.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LaunchTarget {
    #[default]
    None,
    /// Direct executable, with optional args and working directory.
    Executable {
        path: PathBuf,
        args: String,
        working_dir: Option<PathBuf>,
    },
    /// Steam app id, launched via the steam:// protocol.
    Steam { app_id: u32 },
    /// ROM run through an emulator command template.
    Emulator {
        emulator_path: PathBuf,
        args_template: String,
        rom_path: PathBuf,
    },
}

impl LaunchTarget {
    /// Short label for grid tiles and the library list.
    pub fn label(&self) -> String {
        match self {
            Self::None => "Not set".into(),
            Self::Executable { path, .. } => path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Executable".into()),
            Self::Steam { app_id } => format!("Steam · {app_id}"),
            Self::Emulator { rom_path, .. } => rom_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Emulator".into()),
        }
    }

    pub fn is_configured(&self) -> bool {
        !matches!(self, Self::None)
    }
}

/// Completion-time estimates from HowLongToBeat.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct HltbData {
    /// Main story hours, 0 when unknown.
    pub main: f64,
    pub main_plus: f64,
    pub completionist: f64,
    pub speedrun: f64,
    /// Rating out of 100, -1 when unavailable.
    pub rating: i32,
    /// HowLongToBeat's numeric game id, used to build a page link.
    pub hltb_id: i64,
}

impl HltbData {
    /// Best single estimate for progress display.
    pub fn primary(&self) -> f64 {
        if self.main > 0.0 {
            self.main
        } else if self.main_plus > 0.0 {
            self.main_plus
        } else {
            self.completionist
        }
    }

    /// The HowLongToBeat page for this game.
    pub fn page_url(&self) -> String {
        format!("https://howlongtobeat.com/game/{}", self.hltb_id)
    }
}

/// One play session. `kind` distinguishes real play from manual corrections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaySession {
    pub id: i64,
    pub game_id: i64,
    /// Unix seconds; `ended_at` is null while the session runs.
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// Duration in seconds as recorded, which may differ from the timestamps
    /// when the user edits a log by hand.
    pub duration_secs: i64,
    pub note: String,
    /// What the user was doing: "Main story", "DLC", "Multiplayer", or free text.
    pub category: String,
    /// True when entered by hand rather than produced by the timer.
    pub manual: bool,
    /// Set when the session ended because Orbit detected the process exit.
    pub ended_by: Option<String>,
}

impl PlaySession {
    pub fn is_running(&self) -> bool {
        self.ended_at.is_none()
    }
}

/// Aggregate playtime for a single game.
#[derive(Debug, Clone, Default)]
pub struct PlaytimeSummary {
    /// Total across all sessions.
    pub total_secs: i64,
    pub session_count: usize,
    pub longest_secs: i64,
    pub first_play: Option<i64>,
    pub last_play: Option<i64>,
}

/// Library-wide totals.
#[derive(Debug, Clone, Default)]
pub struct LibraryStats {
    pub total_games: usize,
    pub tracked_games: usize,
    pub total_secs: i64,
    pub sessions: usize,
    pub games_played_last_7_days: usize,
    pub games_played_last_30_days: usize,
}

/// Sort options for the library view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LibrarySort {
    #[default]
    Name,
    LastPlayed,
    Playtime,
    DateAdded,
    Rating,
    Hltb,
}

impl LibrarySort {
    pub const ALL: [LibrarySort; 6] = [
        Self::Name,
        Self::LastPlayed,
        Self::Playtime,
        Self::DateAdded,
        Self::Rating,
        Self::Hltb,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Name => "Name",
            Self::LastPlayed => "Last played",
            Self::Playtime => "Playtime",
            Self::DateAdded => "Date added",
            Self::Rating => "Rating",
            Self::Hltb => "How long to beat",
        }
    }
}

/// A tag used for filtering the sidebar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tag {
    pub name: String,
    pub count: usize,
}
