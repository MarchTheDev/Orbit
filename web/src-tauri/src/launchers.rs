//! Read-only discovery of games already installed by other launchers.
//!
//! This module is only called from the explicit import dialog. It reads Epic
//! `.item` manifests and Windows uninstall/Ubisoft registry records; it never
//! starts a launcher, contacts an account service, or writes launcher data.

#[cfg(any(windows, test))]
use std::collections::BTreeMap;
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

use serde::Serialize;

/// One locally discovered installation, ready for the player to review.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LauncherGame {
    pub launcher: String,
    pub name: String,
    pub install_dir: String,
    /// A manifest-provided candidate only. Orbit does not launch it by default:
    /// some games must go through their launcher for DRM, overlays, or updates.
    pub exe_path: Option<String>,
    /// Unknown for registry/manifest records; scanning entire game folders just
    /// to calculate a size would be slow and surprising during discovery.
    pub size_bytes: u64,
}

/// Find installed games on Windows, or return an empty list elsewhere.
///
/// All discovery is local and read-only. Callers decide when to run it; it is
/// deliberately not used during startup.
pub fn installed_games() -> Result<Vec<LauncherGame>, String> {
    // The platform scanners are compiled only on Windows, so type the empty
    // non-Windows result explicitly for the sort below.
    let mut games: Vec<LauncherGame> = Vec::new();

    #[cfg(windows)]
    {
        scan_epic(&mut games);
        scan_windows_registry(&mut games);
    }

    games.sort_by(|a, b| {
        a.launcher
            .cmp(&b.launcher)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    deduplicate_installations(&mut games);
    Ok(games)
}

/// Parse one Epic manifest without touching the filesystem.
#[cfg(any(windows, test))]
fn parse_epic_manifest(text: &str) -> Option<LauncherGame> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value
        .get("bIsIncompleteInstall")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }

    let name = value
        .get("DisplayName")
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .or_else(|| value.get("AppName").and_then(serde_json::Value::as_str))?
        .trim()
        .to_string();
    let install_dir = value
        .get("InstallLocation")
        .and_then(serde_json::Value::as_str)?
        .trim()
        .to_string();
    if name.is_empty() || install_dir.is_empty() {
        return None;
    }

    let app_name = value
        .get("AppName")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if app_name.contains("epicgameslauncher") || app_name.contains("epiconlineservices") {
        return None;
    }

    Some(LauncherGame {
        launcher: "Epic Games".to_string(),
        name,
        install_dir,
        exe_path: value
            .get("LaunchExecutable")
            .and_then(serde_json::Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(str::to_string),
        size_bytes: value
            .get("InstallSize")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
    })
}

#[cfg(windows)]
fn scan_epic(games: &mut Vec<LauncherGame>) {
    let Some(program_data) = std::env::var_os("ProgramData") else {
        return;
    };
    let manifests = PathBuf::from(program_data)
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
        .join("Manifests");
    let Ok(files) = std::fs::read_dir(manifests) else {
        return;
    };

    for file in files.flatten() {
        let path = file.path();
        if !path.is_file()
            || !path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("item"))
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(mut game) = parse_epic_manifest(&text) else {
            continue;
        };
        let install = Path::new(&game.install_dir);
        if !install.is_dir() {
            continue;
        }
        game.exe_path = game.exe_path.and_then(|exe| {
            let path = Path::new(&exe);
            let candidate = if path.is_absolute() { path.to_path_buf() } else { install.join(path) };
            candidate.is_file().then(|| candidate.to_string_lossy().into_owned())
        });
        games.push(game);
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Debug, Default)]
struct RegistryEntry {
    key: String,
    values: BTreeMap<String, String>,
}

/// Parse the plain text returned by `reg query /s`, for unit tests as well as
/// the Windows-only discovery path.
#[cfg(any(windows, test))]
fn parse_registry_entries(output: &str) -> Vec<RegistryEntry> {
    let mut entries = Vec::new();
    let mut current: Option<RegistryEntry> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_ascii_uppercase().starts_with("HKEY_") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(RegistryEntry {
                key: trimmed.to_string(),
                values: BTreeMap::new(),
            });
            continue;
        }
        let Some(entry) = current.as_mut() else { continue };
        for kind in ["REG_EXPAND_SZ", "REG_MULTI_SZ", "REG_SZ", "REG_DWORD"] {
            if let Some((name, value)) = trimmed.split_once(kind) {
                let name = name.trim();
                if !name.is_empty() {
                    entry.values.insert(name.to_ascii_lowercase(), value.trim().to_string());
                }
                break;
            }
        }
    }
    if let Some(entry) = current {
        entries.push(entry);
    }
    entries
}

#[cfg(windows)]
fn query_registry(key: &str) -> Vec<RegistryEntry> {
    use std::process::Command;

    Command::new("reg.exe")
        .args(["query", key, "/s"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| parse_registry_entries(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(windows)]
fn scan_windows_registry(games: &mut Vec<LauncherGame>) {
    let uninstall_keys = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    let mut uninstall = Vec::new();
    for key in uninstall_keys {
        uninstall.extend(query_registry(key));
    }

    let mut ubisoft_installs = Vec::new();
    for key in [
        r"HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs",
        r"HKLM\SOFTWARE\Ubisoft\Launcher\Installs",
        r"HKCU\SOFTWARE\Ubisoft\Launcher\Installs",
    ] {
        ubisoft_installs.extend(query_registry(key));
    }

    for install in ubisoft_installs {
        let Some(path) = install
            .values
            .get("installdir")
            .or_else(|| install.values.get("installlocation"))
            .map(|path| PathBuf::from(path.trim_matches('"')))
        else {
            continue;
        };
        if !path.is_dir() {
            continue;
        }
        let known = uninstall.iter().find(|entry| {
            registry_install_path(entry)
                .is_some_and(|candidate| same_path(&candidate, &path))
        });
        let name = known
            .and_then(|entry| entry.values.get("displayname"))
            .filter(|name| !name.trim().is_empty())
            .map(|name| name.trim().to_string())
            .or_else(|| path.file_name().map(|name| name.to_string_lossy().to_string()))
            .unwrap_or_else(|| format!("Ubisoft game {}", install.key.rsplit('\\').next().unwrap_or("")));
        games.push(LauncherGame {
            launcher: "Ubisoft Connect".to_string(),
            name,
            install_dir: path.to_string_lossy().into_owned(),
            exe_path: None,
            size_bytes: 0,
        });
    }

    for entry in uninstall {
        let Some(name) = entry.values.get("displayname").filter(|name| !name.trim().is_empty()) else {
            continue;
        };
        let publisher = entry.values.get("publisher").map(String::as_str).unwrap_or("");
        let key = entry.key.to_ascii_lowercase();
        let publisher = publisher.to_ascii_lowercase();
        let launcher = if publisher.contains("gog") || key.contains("gog") {
            Some("GOG Galaxy")
        } else if publisher.contains("ubisoft") || key.contains("ubisoft") {
            Some("Ubisoft Connect")
        } else if publisher.contains("electronic arts") || publisher == "ea" || key.contains("ea desktop") {
            Some("EA app")
        } else {
            None
        };
        let Some(launcher) = launcher else { continue };
        let Some(path) = registry_install_path(&entry) else { continue };
        if !path.is_dir() {
            continue;
        }
        // The app itself is not a game to add.
        if name.to_ascii_lowercase().contains("ea app") || name.to_ascii_lowercase().contains("gog galaxy") {
            continue;
        }
        games.push(LauncherGame {
            launcher: launcher.to_string(),
            name: name.trim().to_string(),
            install_dir: path.to_string_lossy().into_owned(),
            exe_path: None,
            size_bytes: 0,
        });
    }
}

#[cfg(windows)]
fn registry_install_path(entry: &RegistryEntry) -> Option<PathBuf> {
    entry
        .values
        .get("installlocation")
        .or_else(|| entry.values.get("installdir"))
        .map(|path| PathBuf::from(path.trim_matches('"')))
        .filter(|path| !path.as_os_str().is_empty())
}

#[cfg(windows)]
fn same_path(left: &Path, right: &Path) -> bool {
    normalize_path(left) == normalize_path(right)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn deduplicate_installations(games: &mut Vec<LauncherGame>) {
    let mut seen = std::collections::HashSet::new();
    games.retain(|game| {
        let key = normalize_path(Path::new(&game.install_dir));
        !key.is_empty() && seen.insert(key)
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epic_manifest_names_a_game_and_keeps_only_local_fields() {
        let game = parse_epic_manifest(
            r#"{
                "AppName":"CoolGame",
                "DisplayName":"Cool Game",
                "InstallLocation":"C:\\Games\\CoolGame",
                "LaunchExecutable":"Binaries\\Win64\\CoolGame.exe",
                "InstallSize":123456,
                "bIsIncompleteInstall":false
            }"#,
        )
        .unwrap();
        assert_eq!(game.launcher, "Epic Games");
        assert_eq!(game.name, "Cool Game");
        assert_eq!(game.install_dir, r"C:\Games\CoolGame");
        assert_eq!(game.exe_path.as_deref(), Some(r"Binaries\Win64\CoolGame.exe"));
        assert_eq!(game.size_bytes, 123456);
    }

    #[test]
    fn incomplete_epic_installs_are_not_offered() {
        assert!(parse_epic_manifest(
            r#"{"AppName":"Game","DisplayName":"Game","InstallLocation":"C:\\Games\\Game","bIsIncompleteInstall":true}"#
        )
        .is_none());
    }

    #[test]
    fn registry_output_is_grouped_into_read_only_values() {
        let entries = parse_registry_entries(
            "HKEY_LOCAL_MACHINE\\Software\\Uninstall\\Example\r\n    DisplayName    REG_SZ    Example Game\r\n    InstallLocation    REG_SZ    C:\\Games\\Example\r\n",
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].values.get("displayname").map(String::as_str), Some("Example Game"));
        assert_eq!(entries[0].values.get("installlocation").map(String::as_str), Some(r"C:\Games\Example"));
    }

    #[test]
    fn duplicate_installs_are_collapsed_without_rewriting_records() {
        let mut games = vec![
            LauncherGame {
                launcher: "Epic Games".into(),
                name: "A".into(),
                install_dir: r"C:\Games\A".into(),
                exe_path: None,
                size_bytes: 0,
            },
            LauncherGame {
                launcher: "GOG Galaxy".into(),
                name: "A duplicate".into(),
                install_dir: r"c:/games/a/".into(),
                exe_path: None,
                size_bytes: 0,
            },
        ];
        deduplicate_installations(&mut games);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "A");
    }
}
