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
use std::sync::Mutex;

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
    /// A Windows program, started through Wine. The prefix is the game's own
    /// bottle when it has one, and empty means Wine's default.
    Wine {
        path: PathBuf,
        #[serde(default)]
        args: String,
        #[serde(default)]
        prefix: Option<String>,
        /// The wine binary. Empty means `wine` on PATH, or the one in Settings.
        #[serde(default)]
        wine: Option<String>,
    },
    /// A game imported from Lutris. An exe and a prefix are started through
    /// Wine and watched. A slug on its own is handed to Lutris.
    Lutris {
        #[serde(default)]
        slug: String,
        #[serde(default)]
        game_id: Option<i64>,
        #[serde(default)]
        exe: Option<String>,
        #[serde(default)]
        prefix: Option<String>,
    },
}

/// The wine binary from Settings, used when a game does not name one.
static WINE_FALLBACK: Mutex<String> = Mutex::new(String::new());

pub fn set_wine_fallback(path: &str) {
    if let Ok(mut slot) = WINE_FALLBACK.lock() {
        *slot = path.trim().to_string();
    }
}

fn wine_fallback() -> Option<String> {
    let slot = WINE_FALLBACK.lock().ok()?;
    let trimmed = slot.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
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
            LaunchTarget::Wine { path, .. } => format!("Wine · {}", file_name(path)),
            LaunchTarget::Lutris { slug, exe, .. } => {
                if !slug.is_empty() {
                    format!("Lutris · {slug}")
                } else if let Some(exe) = exe {
                    format!("Lutris · {}", file_name(Path::new(exe)))
                } else {
                    "Lutris".to_string()
                }
            }
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
            LaunchTarget::Wine { path, .. } => Some(path),
            LaunchTarget::Lutris { exe, .. } => exe.as_deref().map(Path::new),
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
        LaunchTarget::Wine {
            path,
            args,
            prefix,
            wine,
        } => spawn_wine(path, args, prefix.as_deref(), wine.as_deref()),
        LaunchTarget::Lutris {
            slug,
            game_id,
            exe,
            prefix,
        } => {
            // A recorded program and prefix can be started directly, and then
            // the session can watch the process. Anything else is Lutris's job:
            // Orbit is not a prefix manager, and a slug-only game has to go
            // through the launcher that knows how to start it.
            if let Some(exe) = exe.as_deref().map(str::trim).filter(|exe| !exe.is_empty()) {
                let raw = PathBuf::from(exe);
                let joined = prefix.as_deref().map(str::trim).filter(|prefix| !prefix.is_empty()).map(|prefix| Path::new(prefix).join(&raw));
                let exe_path = if raw.is_file() {
                    Some(raw)
                } else {
                    joined.filter(|path| path.is_file())
                };
                if let Some(exe_path) = exe_path {
                    return spawn_wine(&exe_path, "", prefix.as_deref(), None);
                }
            }
            hand_to_lutris(slug, *game_id)?;
            Ok(None)
        }
    }
}

fn spawn_wine(
    path: &Path,
    args: &str,
    prefix: Option<&str>,
    wine: Option<&str>,
) -> Result<Option<Child>, String> {
    if !path.exists() {
        return Err(format!("{} is not there any more.", path.display()));
    }
    let bin = wine
        .map(str::trim)
        .filter(|bin| !bin.is_empty())
        .map(str::to_string)
        .or_else(wine_fallback)
        .unwrap_or_else(|| "wine".to_string());
    let mut cmd = crate::process::command(&bin);
    if let Some(prefix) = prefix.map(str::trim).filter(|prefix| !prefix.is_empty()) {
        cmd.env("WINEPREFIX", prefix);
    }
    cmd.arg(path);
    let args = args.trim();
    if !args.is_empty() {
        cmd.args(parse_args(args));
    }
    if let Some(dir) = path.parent() {
        cmd.current_dir(dir);
    }
    quiet(&mut cmd)
        .map(Some)
        .map_err(|e| format!("Could not start {} through Wine: {e}", path.display()))
}

fn hand_to_lutris(slug: &str, game_id: Option<i64>) -> Result<(), String> {
    let uri = if let Some(id) = game_id.filter(|id| *id > 0) {
        format!("lutris:rungameid/{id}")
    } else if !slug.trim().is_empty() {
        format!("lutris:rungame/{}", slug.trim())
    } else {
        return Err("This Lutris game has no slug and no program.".into());
    };
    if which("lutris").is_some() {
        crate::process::command("lutris")
            .arg(&uri)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not ask Lutris to start the game: {e}"))
    } else if which("flatpak").is_some() {
        crate::process::command("flatpak")
            .args(["run", "net.lutris.Lutris", uri.as_str()])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not ask the Lutris Flatpak to start the game: {e}"))
    } else {
        open_url(&uri)
    }
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn quiet(cmd: &mut Command) -> std::io::Result<Child> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

/// Hand a URL to whatever the machine has registered for it.
///
/// `explorer` is what Windows itself uses, so it needs no extra plugin and works
/// the same as pasting the link into a browser bar. The other platforms get
/// their own opener, which this did not used to have: `steam://` links were
/// Windows-only by accident.
fn open_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let spawned = crate::process::command("explorer").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let spawned = crate::process::command("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = crate::process::command("xdg-open").arg(url).spawn();

    spawned
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
