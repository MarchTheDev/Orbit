//! Saving the settings to disk.
//!
//! The library itself lives in SQLite (`db.rs`); only the settings are JSON,
//! because there are a handful of them and a player may reasonably want to read
//! or hand-edit the file. They are written to Orbit's own data folder rather
//! than kept in `localStorage`, which lives inside the WebView's profile and
//! disappears when that profile is cleared.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Where Orbit keeps its files.
#[derive(Clone)]
pub struct Store {
    root: PathBuf,
}

/// Settings are the front end's own shape, so they are stored as JSON rather
/// than a Rust struct: a typed copy here would quietly drop any field the UI
/// adds later, and a setting that fails to survive a restart is worse than one
/// that is a little less strict.
pub type Settings = serde_json::Value;

impl Store {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    /// The saved settings, or `None` when there are none yet.
    pub fn load_settings(&self) -> Option<Settings> {
        read_json(&self.settings_file())
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        write_json(&self.settings_file(), settings)
    }

    fn sizes_file(&self) -> PathBuf {
        self.root.join("sizes.json")
    }

    /// The folder sizes the last run measured, and when it measured them.
    ///
    /// A size is found by walking the folder, which across a library of
    /// installed games is a great deal of disk. They used to be thrown away at
    /// every exit, so starting Orbit walked every game folder all over again —
    /// and on a library that had just been imported, that was enough disk to
    /// keep the window from drawing while it was happening. This is a cache
    /// rather than a record: the Storage page can ask for a fresh walk whenever
    /// it likes.
    pub fn load_sizes(&self) -> Option<(u64, std::collections::HashMap<String, u64>)> {
        let saved: serde_json::Value = read_json(&self.sizes_file())?;
        let at = saved.get("measuredAt")?.as_u64()?;
        let sizes = serde_json::from_value(saved.get("sizes")?.clone()).ok()?;
        Some((at, sizes))
    }

    pub fn save_sizes(
        &self,
        at: u64,
        sizes: &std::collections::HashMap<String, u64>,
    ) -> Result<(), String> {
        write_json(
            &self.sizes_file(),
            &serde_json::json!({ "measuredAt": at, "sizes": sizes }),
        )
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str(&text) {
        Ok(v) => Some(v),
        Err(e) => {
            log::warn!("could not read {}: {e}", path.display());
            let _ = std::fs::rename(path, path.with_extension("json.broken"));
            None
        }
    }
}

/// Write JSON so a crash mid-save cannot leave a half-written file.
///
/// The new content goes to a sibling temp file and is then renamed over the
/// old one, which Windows does as a single step.
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("orbit-tauri-store-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn settings_round_trip_through_the_file() {
        let store = Store::new(temp("round-trip"));
        let settings = serde_json::json!({ "theme": "eclipse", "libraryFolders": ["D:\\Games"] });
        store.save_settings(&settings).unwrap();

        let back: Settings = store.load_settings().expect("settings load");
        assert_eq!(back["theme"], "eclipse");
        assert_eq!(back["libraryFolders"][0], "D:\\Games");
    }

    #[test]
    fn an_unknown_field_in_the_file_is_left_alone() {
        // A newer version of the app may write fields this one has never heard
        // of. Saving must not quietly drop them.
        let dir = temp("unknown-field");
        let store = Store::new(dir);
        let settings = serde_json::json!({ "theme": "aurora", "somethingNew": 42 });
        store.save_settings(&settings).unwrap();
        let back: Settings = store.load_settings().unwrap();
        assert_eq!(back["somethingNew"], 42);
    }

    #[test]
    fn an_empty_store_reads_as_nothing_rather_than_failing() {
        let store = Store::new(temp("empty"));
        let settings: Option<Settings> = store.load_settings();
        assert!(settings.is_none());
        assert!(store.save_settings(&Settings::default()).is_ok());
    }

    #[test]
    fn a_corrupt_file_is_kept_for_inspection_and_ignored() {
        let dir = temp("corrupt");
        let store = Store::new(dir.clone());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), b"{ not json").unwrap();

        let settings: Option<Settings> = store.load_settings();
        assert!(settings.is_none());
        assert!(
            dir.join("settings.json.broken").exists(),
            "the unreadable file is kept rather than deleted"
        );
    }

    #[test]
    fn saving_twice_leaves_no_temp_file_behind() {
        let dir = temp("temp-file");
        let store = Store::new(dir.clone());
        store
            .save_settings(&serde_json::json!({ "theme": "nebula" }))
            .unwrap();
        store
            .save_settings(&serde_json::json!({ "theme": "mars" }))
            .unwrap();

        let strays: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(strays.is_empty(), "the temp file was renamed into place");
    }
}
