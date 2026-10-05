//! Reading the player's own Steam library.
//!
//! Steam keeps everything on disk in plain text: the library list in
//! `steamapps/libraryfolders.vdf`, and one `appmanifest_<id>.acf` per installed
//! game with its name, folder and size. That is enough to offer the collection
//! for import without a key, a login or a network call.
//!
//! Nothing here changes a file: it is all reads, so a bad parse can only mean an
//! empty list, never damage.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// One installed Steam game.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGame {
    pub app_id: u32,
    pub name: String,
    /// Where the game actually sits, which is `steamapps/common/<folder>`.
    pub install_dir: String,
    pub size_bytes: u64,
    /// When Steam last ran it, in Unix seconds, if it says.
    pub last_played: Option<i64>,
    /// Which of the player's libraries it is on, for grouping in the dialog.
    pub library: String,
}

/// Every installed game across every Steam library on the machine.
pub fn installed_games() -> Result<Vec<SteamGame>, String> {
    let Some(root) = steam_root() else {
        return Err("Steam does not look like it is installed on this machine.".into());
    };

    let mut games = Vec::new();
    for library in library_folders(&root) {
        let apps = library.join("steamapps");
        let Ok(entries) = std::fs::read_dir(&apps) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // One manifest per installed game; anything else in there (the
            // common folder, the workshop) is not a game entry.
            if !file.starts_with("appmanifest_") || !file.ends_with(".acf") {
                continue;
            }
            if let Some(game) = parse_manifest(&path, &apps, &library) {
                games.push(game);
            }
        }
    }

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    games.dedup_by(|a, b| a.app_id == b.app_id);
    if games.is_empty() {
        return Err("No installed Steam games were found.".into());
    }
    log::info!("found {} installed Steam games", games.len());
    Ok(games)
}

/// Where Steam lives, asked of the registry first because that is where Steam
/// itself records it, then guessed at the two places it normally installs.
fn steam_root() -> Option<PathBuf> {
    if let Some(path) = from_registry() {
        return Some(path);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    for key in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Ok(dir) = std::env::var(key) {
            candidates.push(PathBuf::from(dir).join("Steam"));
        }
    }
    candidates.push(PathBuf::from(r"C:\Steam"));
    candidates.into_iter().find(|p| p.is_dir())
}

/// `HKCU\Software\Valve\Steam\SteamPath`, read with the `reg` command.
///
/// Not the Windows API: that needs features this crate does not pull in, and a
/// single read of one value does not justify them.
fn from_registry() -> Option<PathBuf> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // `    SteamPath    REG_SZ    c:/program files (x86)/steam`
    let value = text
        .lines()
        .find(|line| line.contains("SteamPath"))?
        .split("REG_SZ")
        .nth(1)?
        .trim();
    if value.is_empty() {
        return None;
    }
    // The registry keeps forward slashes; Windows is happy either way, but this
    // keeps every path in the app spelled the same way.
    let path = PathBuf::from(value.replace('/', "\\"));
    path.is_dir().then_some(path)
}

/// Every place Steam keeps games, the main installation included.
fn library_folders(root: &Path) -> Vec<PathBuf> {
    let mut folders = vec![root.to_path_buf()];

    let vdf = root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(&vdf) {
        for (key, value) in pairs(&text) {
            if key.eq_ignore_ascii_case("path") && !value.trim().is_empty() {
                let path = PathBuf::from(value.replace('/', "\\"));
                if path.is_dir() && !folders.contains(&path) {
                    folders.push(path);
                }
            }
        }
    }
    folders
}

/// Read one `appmanifest_*.acf` into a game, if it says enough to be one.
fn parse_manifest(path: &Path, apps: &Path, library: &Path) -> Option<SteamGame> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut game = SteamGame {
        app_id: 0,
        name: String::new(),
        install_dir: String::new(),
        size_bytes: 0,
        last_played: None,
        library: library.to_string_lossy().to_string(),
    };

    for (key, value) in pairs(&text) {
        match key.as_str() {
            "appid" => game.app_id = value.parse().unwrap_or(0),
            "name" => game.name = value,
            "installdir" => game.install_dir = value,
            "SizeOnDisk" => game.size_bytes = value.parse().unwrap_or(0),
            "LastPlayed" => {
                game.last_played = value.parse().ok().filter(|at| *at > 0);
            }
            _ => {}
        }
    }

    if game.app_id == 0 || game.name.trim().is_empty() {
        return None;
    }
    // The manifest names the folder, so the path is worked out rather than
    // stored: it stays right even when a library is moved between drives.
    let dir = apps.join("common").join(&game.install_dir);
    game.install_dir = dir.to_string_lossy().to_string();
    Some(game)
}

/// Every `"key" "value"` pair in a Valve data file, in the order they appear.
///
/// The format is nested, but nothing read here needs the nesting: the library
/// list has one `path` per entry, and a manifest has one of each key. Strings
/// are unescaped only as far as a Windows path needs (`\\` for `\`).
fn pairs(text: &str) -> Vec<(String, String)> {
    let tokens = quoted(text);
    let mut out = Vec::new();
    let mut index = 0;
    while index + 1 < tokens.len() {
        out.push((tokens[index].clone(), tokens[index + 1].clone()));
        // A pair is two tokens, but a backslash-escaped quote inside a value
        // can leave an odd token behind; stepping by two keeps the pairing
        // right for the files Steam actually writes.
        index += 2;
    }
    out
}

/// The quoted strings in a file, in order, with escapes resolved.
fn quoted(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut value = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\\' => {
                    // `\\` is a path separator, `\"` is a quote inside a value;
                    // both are written through as themselves.
                    if let Some(next) = chars.next() {
                        value.push(next);
                    }
                }
                '"' => break,
                _ => value.push(c),
            }
        }
        out.push(value);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_library_list_yields_every_folder() {
        let vdf = r#"
"libraryfolders"
{
    "0"
    {
        "path"      "C:\\Program Files (x86)\\Steam"
        "label"     ""
    }
    "1"
    {
        "path"      "D:\\SteamLibrary"
        "label"     "Games"
    }
}
"#;
        let paths: Vec<String> = pairs(vdf)
            .into_iter()
            .filter(|(k, _)| k == "path")
            .map(|(_, v)| v)
            .collect();
        assert_eq!(paths, vec![r"C:\Program Files (x86)\Steam", r"D:\SteamLibrary"]);
    }

    #[test]
    fn a_manifest_gives_the_name_folder_and_size() {
        let acf = r#"
"AppState"
{
    "appid"     "620"
    "name"      "Portal 2"
    "installdir"    "Portal 2"
    "SizeOnDisk"    "12345678901"
    "LastPlayed"    "1700000000"
    "UserConfig"
    {
        "language"  "english"
    }
}
"#;
        let found: Vec<(String, String)> = pairs(acf);
        let value = |key: &str| {
            found
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };
        assert_eq!(value("appid"), "620");
        assert_eq!(value("name"), "Portal 2");
        assert_eq!(value("installdir"), "Portal 2");
        assert_eq!(value("SizeOnDisk"), "12345678901");
        assert_eq!(value("LastPlayed"), "1700000000");
    }

    #[test]
    fn a_path_with_a_space_and_a_quote_survives() {
        let text = r#""path" "D:\\Games\\It's Here""#;
        let found = pairs(text);
        assert_eq!(found[0].1, r"D:\Games\It's Here");
    }

    #[test]
    fn a_file_with_no_pairs_is_empty_rather_than_a_panic() {
        assert!(pairs("").is_empty());
        assert!(pairs("nonsense without quotes").is_empty());
        assert!(pairs(r#""dangling"#).is_empty());
    }
}
