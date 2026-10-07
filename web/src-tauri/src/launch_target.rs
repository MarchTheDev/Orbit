//! How a game gets started.
//!
//! Two ways are offered: running a program, or not starting anything at all and
//! letting Orbit keep the clock. A third exists for games brought in from a
//! Steam library, which have to go through Steam to start properly; it is not
//! something the launch editor offers, but a game imported from Steam is
//! launched that way and the choice is kept in the same small JSON object, so
//! adding a kind later does not mean another migration.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::launch::parse_args;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
// The `kind` tag is snake_case on the wire, but the fields inside each variant are
// camelCase, because that is what the TypeScript side writes and reads.
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LaunchTarget {
    /// Time only: Orbit runs the clock and never starts anything.
    #[default]
    None,
    Executable {
        path: PathBuf,
        #[serde(default)]
        args: String,
        #[serde(default)]
        working_dir: Option<PathBuf>,
    },
    /// Started through Steam, which is how an imported Steam game has to be
    /// run: the executable inside its folder usually will not start on its own.
    Steam {
        app_id: u32,
    },
}

impl LaunchTarget {
    /// Read a target, falling back to "time only" for anything unreadable.
    ///
    /// A corrupt value must not stop the game being timed, so the worst case is
    /// that the player has to press Start themselves.
    pub fn parse(text: Option<&str>) -> Self {
        text.and_then(|t| serde_json::from_str(t).ok())
            .unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| r#"{"kind":"none"}"#.into())
    }

    /// A short description, for the detail page and tooltips.
    pub fn label(&self) -> String {
        match self {
            LaunchTarget::None => "Time only".to_string(),
            LaunchTarget::Executable { path, .. } => file_name(path),
            LaunchTarget::Steam { app_id } => format!("Steam · {app_id}"),
        }
    }

    /// False when Orbit would start nothing, so the player must press Play.
    pub fn starts_something(&self) -> bool {
        !matches!(self, LaunchTarget::None)
    }

    /// The file Orbit would open in Explorer for this target, if there is one.
    pub fn primary_path(&self) -> Option<&Path> {
        match self {
            LaunchTarget::None => None,
            LaunchTarget::Executable { path, .. } => Some(path),
            LaunchTarget::Steam { .. } => None,
        }
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string()
}

/// Start the game.
///
/// `Ok(None)` means Orbit asked Steam to do it, and there is no process to
/// watch, so the session has to be stopped by hand.
pub fn spawn(target: &LaunchTarget) -> Result<Option<Child>, String> {
    match target {
        LaunchTarget::None => Ok(None),
        LaunchTarget::Executable {
            path,
            args,
            working_dir,
        } => {
            if !path.exists() {
                return Err(format!("{} is not there any more.", path.display()));
            }
            let mut cmd = Command::new(path);
            let args = args.trim();
            if !args.is_empty() {
                cmd.args(parse_args(args));
            }
            // Games usually expect their own folder as the working directory,
            // but only if the player pointed at one that exists.
            let dir = working_dir
                .as_ref()
                .filter(|d| d.is_dir())
                .map(|d| d.as_path())
                .or_else(|| path.parent());
            if let Some(dir) = dir {
                cmd.current_dir(dir);
            }
            Ok(Some(quiet(&mut cmd).map_err(|e| {
                format!("Could not start {}: {e}", path.display())
            })?))
        }
        LaunchTarget::Steam { app_id } => {
            open_url(&format!("steam://rungameid/{app_id}"))?;
            Ok(None)
        }
    }
}

fn quiet(cmd: &mut Command) -> std::io::Result<Child> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

/// Hand a URL to whatever the machine has registered for it.
fn open_url(url: &str) -> Result<(), String> {
    // `explorer` is what Windows itself uses to open a URL, so this needs no
    // extra plugin and works the same as pasting the link into a browser bar.
    Command::new("explorer")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open {url}: {e}"))
}

/// Find cover art sitting next to a game.
///
/// Only the obvious names are tried: the exe's own name, and the two spellings
/// people actually use. Nothing is searched for recursively, because a library
/// folder holds hundreds of games and a deep walk would be slow for no gain.
pub fn nearby_cover(exe_path: &Path) -> Option<PathBuf> {
    let dir = exe_path.parent()?;
    let stem = exe_path.file_stem()?.to_str()?;
    for ext in ["png", "jpg", "jpeg", "webp", "bmp"] {
        for name in [
            format!("{stem}.{ext}"),
            format!("{stem}-cover.{ext}"),
            format!("{stem}_cover.{ext}"),
        ] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_target_survives_a_json_round_trip() {
        let target = LaunchTarget::Steam { app_id: 620 };
        let text = target.to_json();
        // camelCase fields, which is the shape the TypeScript side sends.
        assert_eq!(text, r#"{"kind":"steam","appId":620}"#);
        assert_eq!(LaunchTarget::parse(Some(&text)), target);
    }

    #[test]
    fn a_target_from_an_older_orbit_still_parses() {
        // Emulator support was removed, but a game saved with it must still
        // open: an unknown shape falls back to the timer rather than an error.
        let from_ui = r#"{"kind":"emulator","emulatorPath":"C:\\Retro\\retroarch.exe","argsTemplate":"-f {rom}","romPath":"D:\\Roms\\game.nes"}"#;
        assert_eq!(LaunchTarget::parse(Some(from_ui)), LaunchTarget::None);
    }

    #[test]
    fn unreadable_json_falls_back_to_time_only() {
        // Better to time the game and make the player press Start than to
        // refuse to open a game at all.
        assert_eq!(LaunchTarget::parse(Some("{ not json")), LaunchTarget::None);
        assert_eq!(LaunchTarget::parse(None), LaunchTarget::None);
        assert!(!LaunchTarget::None.starts_something());
        assert!(LaunchTarget::Steam { app_id: 1 }.starts_something());
    }

    #[test]
    fn labels_name_the_thing_that_starts() {
        assert_eq!(LaunchTarget::None.label(), "Time only");
        assert_eq!(LaunchTarget::Steam { app_id: 620 }.label(), "Steam · 620");
        assert_eq!(
            LaunchTarget::Executable {
                // Joined rather than written with backslashes: the label is the
                // program's own name, and a path typed with the wrong separator
                // is a single file name that happens to contain colons.
                path: ["C:", "Games", "Hades", "Hades.exe"].iter().collect(),
                args: String::new(),
                working_dir: None,
            }
            .label(),
            "Hades.exe"
        );
    }

    #[test]
    fn cover_art_is_found_next_to_the_executable() {
        let dir = std::env::temp_dir().join("orbit-tauri-cover");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Hades.exe");
        std::fs::write(&exe, b"x").unwrap();
        assert_eq!(nearby_cover(&exe), None);

        let art = dir.join("Hades-cover.png");
        std::fs::write(&art, b"x").unwrap();
        assert_eq!(nearby_cover(&exe), Some(art));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
