//! How a game gets started.
//!
//! A game is launched one of four ways: not at all (Orbit only times it), by
//! running a program, by asking Steam, or by feeding a ROM to an emulator. The
//! choice is stored on the game as one small JSON object, so adding a kind later
//! does not mean another migration.

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
    Steam {
        app_id: u32,
    },
    Emulator {
        emulator_path: PathBuf,
        args_template: String,
        rom_path: PathBuf,
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
            LaunchTarget::Emulator { rom_path, .. } => file_name(rom_path),
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
            LaunchTarget::Emulator { emulator_path, .. } => Some(emulator_path),
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
        LaunchTarget::Emulator {
            emulator_path,
            args_template,
            rom_path,
        } => {
            if !rom_path.exists() {
                return Err(format!("{} is not there any more.", rom_path.display()));
            }
            if !emulator_path.exists() {
                return Err(format!(
                    "{} is not there any more.",
                    emulator_path.display()
                ));
            }
            let args = expand_template(args_template, rom_path);
            let mut cmd = Command::new(emulator_path);
            if !args.trim().is_empty() {
                cmd.args(parse_args(&args));
            }
            if let Some(dir) = emulator_path.parent() {
                cmd.current_dir(dir);
            }
            Ok(Some(quiet(&mut cmd).map_err(|e| {
                format!("Could not start {}: {e}", emulator_path.display())
            })?))
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

/// Put the ROM path into an emulator's argument string.
///
/// Both spellings are accepted because emulator front ends disagree about which
/// one they use, and neither is worth a preference setting.
pub fn expand_template(template: &str, rom: &Path) -> String {
    let rom = rom.to_string_lossy().to_string();
    template.replace("{rom}", &rom).replace("%ROM%", &rom)
}

/// Take an app id out of whatever was pasted into the box.
///
/// The Steam store page is what most people copy, so a URL is accepted as well
/// as a bare number. Anything else is refused rather than guessed at, because a
/// wrong app id starts the wrong game.
pub fn parse_steam_id(text: &str) -> Option<u32> {
    let text = text.trim().trim_end_matches('/');
    if let Some(index) = text.find("/app/") {
        let digits: String = text[index + 5..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        return digits.parse().ok();
    }
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
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
    fn a_pasted_store_link_becomes_an_app_id() {
        assert_eq!(parse_steam_id("620"), Some(620));
        assert_eq!(
            parse_steam_id("https://store.steampowered.com/app/620/"),
            Some(620)
        );
        assert_eq!(parse_steam_id("  1091500  "), Some(1_091_500));
        assert_eq!(parse_steam_id("Portal 2"), None);
        assert_eq!(parse_steam_id(""), None);
    }

    #[test]
    fn both_rom_placeholders_are_filled_in() {
        let rom = Path::new(r"C:\ROMs\Chrono Trigger.sfc");
        assert_eq!(
            expand_template("-f {rom} --fullscreen", rom),
            r"-f C:\ROMs\Chrono Trigger.sfc --fullscreen"
        );
        assert_eq!(expand_template("%ROM%", rom), r"C:\ROMs\Chrono Trigger.sfc");
    }

    #[test]
    fn a_target_survives_a_json_round_trip() {
        let target = LaunchTarget::Steam { app_id: 620 };
        let text = target.to_json();
        // camelCase fields, which is the shape the TypeScript side sends.
        assert_eq!(text, r#"{"kind":"steam","appId":620}"#);
        assert_eq!(LaunchTarget::parse(Some(&text)), target);
    }

    #[test]
    fn a_target_written_by_the_front_end_is_understood() {
        let from_ui = r#"{"kind":"emulator","emulatorPath":"C:\\Retro\\retroarch.exe","argsTemplate":"-f {rom}","romPath":"D:\\Roms\\game.nes"}"#;
        assert_eq!(
            LaunchTarget::parse(Some(from_ui)),
            LaunchTarget::Emulator {
                emulator_path: PathBuf::from(r"C:\Retro\retroarch.exe"),
                args_template: "-f {rom}".to_string(),
                rom_path: PathBuf::from(r"D:\Roms\game.nes"),
            }
        );
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
                path: PathBuf::from(r"C:\Games\Hades\Hades.exe"),
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
