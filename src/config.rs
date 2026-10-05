use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::paths::AppPaths;

/// How the library page lays out games.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum LibraryView {
    /// Poster tiles, the default.
    #[default]
    Catalog,
    /// One compact row per game.
    List,
}

/// User-controlled settings, persisted as JSON.
///
/// Every field has a `default_*` so that adding one later never breaks an
/// existing config file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: String,
    /// Set false to hide the time-tracking column and totals.
    pub track_playtime: bool,
    /// Countdown that ends a session after this many hours, 0 disables.
    pub session_limit_hours: f64,
    /// Warn when a launch was not stopped manually.
    pub warn_on_unclean_exit: bool,
    pub close_to_tray: bool,
    pub minimize_to_tray: bool,
    pub autostart_tracker: bool,
    pub confirm_before_delete: bool,
    pub grid_tile_size: f64,
    pub show_cover_art: bool,
    pub show_platform_badges: bool,
    pub ui_scale: f64,
    pub library_columns: usize,
    pub hltb_enabled: bool,
    pub igdb_enabled: bool,
    /// When true, new sessions ask for a note before saving.
    pub prompt_session_note: bool,
    pub default_notes: String,
    /// Twitch application credentials for the IGDB API.
    pub twitch_client_id: String,
    pub twitch_client_secret: String,
    pub log_verbose: bool,
    /// Folders Orbit keeps games in, one per drive is the usual arrangement.
    ///
    /// Games are only moved between these; anything outside them is listed but
    /// left alone.
    pub library_folders: Vec<String>,
    /// Where new installs are expected to go. Must be one of `library_folders`.
    pub default_folder: String,
    pub library_view: LibraryView,
}

impl LibraryView {
    pub fn label(&self) -> &'static str {
        match self {
            LibraryView::Catalog => "Catalog",
            LibraryView::List => "List",
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "orbit-dark".into(),
            track_playtime: true,
            session_limit_hours: 0.0,
            warn_on_unclean_exit: true,
            close_to_tray: false,
            minimize_to_tray: true,
            autostart_tracker: true,
            confirm_before_delete: true,
            grid_tile_size: 168.0,
            show_cover_art: true,
            show_platform_badges: true,
            ui_scale: 1.0,
            library_columns: 0,
            hltb_enabled: true,
            igdb_enabled: true,
            prompt_session_note: false,
            default_notes: String::new(),
            twitch_client_id: String::new(),
            twitch_client_secret: String::new(),
            log_verbose: false,
            library_folders: Vec::new(),
            default_folder: String::new(),
            library_view: LibraryView::default(),
        }
    }
}

/// Drop a UTF-8 byte order mark.
///
/// Windows editors write one by default and JSON does not allow it, so without
/// this a hand-edited config reads as corrupt and the player's library folders
/// are thrown away on the next launch.
fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

impl Settings {
    /// Load settings, falling back to defaults if the file is missing or corrupt.
    ///
    /// A corrupt config should never prevent launch, so the bad file is moved
    /// aside for inspection rather than deleted.
    pub fn load(paths: &AppPaths) -> Self {
        let file = &paths.config_file;
        if !file.exists() {
            return Self::default();
        }
        match fs::read_to_string(file) {
            Ok(text) => match serde_json::from_str::<Self>(strip_bom(&text)) {
                Ok(settings) => {
                    tracing::info!("loaded settings from {}", file.display());
                    settings
                }
                Err(e) => {
                    tracing::error!("settings file is corrupt ({e}); using defaults");
                    Self::quarantine(paths);
                    Self::default()
                }
            },
            Err(e) => {
                tracing::error!("could not read settings ({e}); using defaults");
                Self::default()
            }
        }
    }

    fn quarantine(paths: &AppPaths) {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let backup = paths.data_dir.join(format!("config.broken-{stamp}.json"));
        let _ = fs::rename(&paths.config_file, &backup);
        tracing::warn!("moved corrupt settings to {}", backup.display());
    }

    /// Persist settings atomically so a crash mid-write cannot corrupt the file.
    pub fn save(&self, paths: &AppPaths) -> anyhow::Result<()> {
        let target = &paths.config_file;
        let tmp = target.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(self)?;
        fs::write(&tmp, text)?;
        fs::rename(&tmp, target)?;
        tracing::debug!("saved settings to {}", target.display());
        Ok(())
    }

    /// True when IGDB credentials are present and metadata lookups are enabled.
    pub fn igdb_ready(&self) -> bool {
        self.igdb_enabled
            && !self.twitch_client_id.trim().is_empty()
            && !self.twitch_client_secret.trim().is_empty()
    }

    /// The folder new installs go to: the configured default, or the first
    /// library folder if the default no longer exists.
    pub fn default_library_folder(&self) -> Option<&str> {
        let hit = self
            .library_folders
            .iter()
            .find(|f| *f == &self.default_folder)
            .or_else(|| self.library_folders.first());
        hit.map(String::as_str)
    }

    /// Add a library folder, ignoring duplicates however they were written.
    pub fn add_library_folder(&mut self, path: &str) -> bool {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return false;
        }
        if self
            .library_folders
            .iter()
            .any(|f| crate::storage::same_path(Path::new(f), Path::new(trimmed)))
        {
            return false;
        }
        self.library_folders.push(trimmed.to_string());
        // The first folder added becomes the default, so a fresh install has
        // somewhere obvious to go.
        if self.default_folder.is_empty() {
            self.default_folder = trimmed.to_string();
        }
        true
    }

    /// Remove a library folder, moving the default on if it was the one removed.
    ///
    /// Games already installed there keep their folder and simply become
    /// unmanaged: still listed, no longer moved by Orbit.
    pub fn remove_library_folder(&mut self, path: &str) {
        let keep = |f: &String| !crate::storage::same_path(Path::new(f), Path::new(path));
        self.library_folders.retain(keep);
        if !keep(&self.default_folder) {
            self.default_folder = self.library_folders.first().cloned().unwrap_or_default();
        }
    }

    /// Point the default at another library folder, if it is one of them.
    pub fn set_default_folder(&mut self, path: &str) -> bool {
        let ok = self
            .library_folders
            .iter()
            .any(|f| crate::storage::same_path(Path::new(f), Path::new(path)));
        if ok {
            self.default_folder = path.trim().to_string();
        }
        ok
    }

    pub fn apply_env_overrides(&mut self) {
        if let Ok(scale) = std::env::var("ORBIT_UI_SCALE") {
            if let Ok(v) = scale.parse::<f64>() {
                self.ui_scale = v.clamp(0.5, 3.0);
            }
        }
        if let Ok(theme) = std::env::var("ORBIT_THEME") {
            if !theme.is_empty() {
                self.theme = theme;
            }
        }
    }
}

/// Log level when the environment does not override it.
pub fn default_log_level(settings: &Settings) -> &'static str {
    if settings.log_verbose {
        "debug"
    } else {
        "info"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_folder_becomes_the_default() {
        let mut s = Settings::default();
        assert!(s.library_folders.is_empty());
        assert!(s.default_library_folder().is_none());

        assert!(s.add_library_folder(r"D:\Games"));
        assert_eq!(s.default_folder, r"D:\Games");
        assert_eq!(s.default_library_folder(), Some(r"D:\Games"));
    }

    #[test]
    fn the_default_ignores_how_the_path_is_spelled() {
        let mut s = Settings::default();
        s.add_library_folder(r"D:\Games");
        // Same folder, different trailing slash.
        assert!(!s.add_library_folder(r"D:\Games\"));
    }

    #[test]
    fn removing_the_default_promotes_another_folder() {
        let mut s = Settings::default();
        s.add_library_folder(r"D:\Games");
        s.add_library_folder(r"E:\Games");

        s.remove_library_folder(r"D:\Games");
        assert_eq!(s.library_folders, vec![r"E:\Games".to_string()]);
        assert_eq!(s.default_library_folder(), Some(r"E:\Games"));

        // With nothing left there is no default rather than a stale one.
        s.remove_library_folder(r"E:\Games");
        assert!(s.library_folders.is_empty());
        assert_eq!(s.default_folder, "");
        assert!(s.default_library_folder().is_none());
    }

    #[test]
    fn the_default_must_be_one_of_the_folders() {
        let mut s = Settings::default();
        s.add_library_folder(r"D:\Games");
        assert!(!s.set_default_folder(r"Z:\Elsewhere"));
        assert_eq!(s.default_library_folder(), Some(r"D:\Games"));
        assert!(s.set_default_folder(r"D:\Games"));
    }

    #[test]
    fn an_old_config_file_still_loads() {
        // Settings written before library folders existed have no such key.
        let old = r#"{
            "theme": "nebula",
            "track_playtime": false,
            "twitch_client_id": "abc"
        }"#;
        let s: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(s.theme, "nebula");
        assert!(!s.track_playtime);
        assert_eq!(s.twitch_client_id, "abc");
        assert!(s.library_folders.is_empty());
        assert_eq!(s.library_view, LibraryView::Catalog);
    }

    #[test]
    fn the_view_mode_round_trips_through_json() {
        let s = Settings {
            library_view: LibraryView::List,
            ..Default::default()
        };
        let text = serde_json::to_string(&s).unwrap();
        assert!(text.contains("\"list\""));
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(back.library_view, LibraryView::List);
    }

    /// Notepad and PowerShell both write a byte order mark. Without this the
    /// file reads as corrupt, gets moved aside, and the player silently loses
    /// every library folder they had set up.
    #[test]
    fn a_config_written_by_a_windows_editor_still_loads() {
        let dir = std::env::temp_dir().join("orbit-config-bom");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let paths = AppPaths {
            data_dir: dir.clone(),
            db_file: dir.join("orbit.db"),
            config_file: dir.join("config.json"),
            log_dir: dir.join("logs"),
            cache_dir: dir.join("cache"),
        };

        let text = r#"{"library_folders":["D:\\Games","E:\\Games"],"default_folder":"D:\\Games","library_view":"list"}"#;
        std::fs::write(&paths.config_file, format!("\u{feff}{text}")).unwrap();

        let s = Settings::load(&paths);
        assert_eq!(s.library_folders.len(), 2, "the folders survived");
        assert_eq!(s.library_view, LibraryView::List);
        assert!(
            paths.config_file.exists(),
            "the file is left where the player put it"
        );
        let quarantined: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("config.broken-"))
            .collect();
        assert!(
            quarantined.is_empty(),
            "and it was not quarantined: {quarantined:?}"
        );

        let _ = std::fs::remove_dir_all(dir);
    }
}
