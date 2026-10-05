use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::error::{Error, Result};
use crate::models::LaunchTarget;

/// Launch a configured target, returning the child process when we spawned one.
///
/// Steam is handled through the `steam://` protocol, which hands off to an
/// already-running Steam client and therefore yields no child we can watch. The
/// caller treats that as a session the user stops manually.
pub fn spawn(target: &LaunchTarget) -> Result<Option<std::process::Child>> {
    match target {
        LaunchTarget::None => Err(Error::Launch("no launch target configured".into())),

        LaunchTarget::Executable {
            path,
            args,
            working_dir,
        } => {
            if !path.exists() {
                return Err(Error::Launch(format!(
                    "{} no longer exists at {}",
                    path.display(),
                    path.display()
                )));
            }
            let mut cmd = Command::new(path);
            let parsed = parse_args(args);
            cmd.args(&parsed);
            if let Some(wd) = working_dir.as_ref().filter(|d| d.is_dir()) {
                cmd.current_dir(wd);
            } else if let Some(parent) = path.parent() {
                cmd.current_dir(parent);
            }
            let child = cmd
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| Error::Launch(format!("could not start {}: {e}", path.display())))?;
            tracing::info!(target = %path.display(), "launched executable");
            Ok(Some(child))
        }

        LaunchTarget::Steam { app_id } => {
            let url = format!("steam://rungameid/{app_id}");
            opener::open(&url).map_err(|e| Error::Launch(format!("could not reach Steam: {e}")))?;
            tracing::info!(app_id, "handed off to Steam");
            Ok(None)
        }

        LaunchTarget::Emulator {
            emulator_path,
            args_template,
            rom_path,
        } => {
            if !emulator_path.exists() {
                return Err(Error::Launch(format!(
                    "emulator not found at {}",
                    emulator_path.display()
                )));
            }
            if !rom_path.exists() {
                return Err(Error::Launch(format!(
                    "ROM not found at {}",
                    rom_path.display()
                )));
            }
            let expanded = expand_template(args_template, rom_path);
            let mut cmd = Command::new(emulator_path);
            cmd.args(parse_args(&expanded));
            let child = cmd
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| {
                    Error::Launch(format!("could not start {}: {e}", emulator_path.display()))
                })?;
            tracing::info!(
                emulator = %emulator_path.display(),
                rom = %rom_path.display(),
                "launched via emulator"
            );
            Ok(Some(child))
        }
    }
}

/// Placeholders supported in emulator argument templates.
pub fn expand_template(template: &str, rom: &Path) -> String {
    let rom_str = rom.to_string_lossy().to_string();
    template
        .replace("{rom}", &rom_str)
        .replace("%ROM%", &rom_str)
}

/// Split a user-typed argument string, honouring double quotes.
///
/// egui's text field gives one flat string, so this needs to behave like a
/// mini shell parser: `"-f" "C:\My Games\rom.rom"` yields two arguments.
pub fn parse_args(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut has_token = false;

    for ch in input.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    out.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        out.push(current);
    }
    out
}

/// True when the path looks like something Windows can run directly.
pub fn is_executable(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("exe" | "bat" | "cmd")
    )
}

/// Guess a cover image next to an executable, since ROM folders often have art.
pub fn nearby_cover(dir: &Path, stem: &str) -> Option<PathBuf> {
    for ext in ["png", "jpg", "jpeg", "webp", "bmp"] {
        for candidate in [
            dir.join(format!("{stem}.{ext}")),
            dir.join(format!("{stem}-cover.{ext}")),
            dir.join(format!("{stem}_cover.{ext}")),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}
