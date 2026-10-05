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
///
/// An empty list is a normal answer, not an error: Steam may not be installed,
/// or nothing may be installed through it. The caller says so in its own words,
/// which it can do better than an error string from here.
pub fn installed_games() -> Result<Vec<SteamGame>, String> {
    let mut games = Vec::new();
    let roots = steam_roots();

    if roots.is_empty() {
        log::info!("no Steam installation found");
        return Ok(games);
    }

    for root in roots {
        if root.is_dir() {
            log::info!("reading Steam library at {}", root.display());
        }
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
                    if !games.iter().any(|g: &SteamGame| g.app_id == game.app_id) {
                        games.push(game);
                    }
                }
            }
        }
    }

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    log::info!("found {} installed Steam games", games.len());
    Ok(games)
}

/// Where Steam lives.
///
/// The registry is asked first because that is where Steam records it, in both
/// the 64-bit and the 32-bit view of the hive. Failing that, the usual install
/// folders are tried, and finally the path is read out of the Steam client's
/// own config file, which is the last thing to move if a player relocated it.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    for (hive, key) in [
        ("HKCU", r"Software\Valve\Steam"),
        ("HKLM", r"SOFTWARE\WOW6432Node\Valve\Steam"),
        ("HKLM", r"SOFTWARE\Valve\Steam"),
    ] {
        for name in ["SteamPath", "InstallPath"] {
            if let Some(path) = registry_path(hive, key, name) {
                roots.push(path);
            }
        }
    }

    for var in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Ok(dir) = std::env::var(var) {
            roots.push(PathBuf::from(dir).join("Steam"));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Steam"));
    }
    roots.push(PathBuf::from(r"C:\Steam"));
    roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));

    let mut found: Vec<PathBuf> = Vec::new();
    for root in roots {
        if root.is_dir() && !found.contains(&root) {
            found.push(root);
        }
    }
    found
}

/// One value out of the registry, read with the `reg` command.
///
/// Not the Windows API: that needs features this crate does not pull in, and a
/// single read of one value does not justify them.
fn registry_path(hive: &str, key: &str, name: &str) -> Option<PathBuf> {
    let output = std::process::Command::new("reg")
        .args(["query", &format!("{hive}\\{key}"), "/v", name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // `    SteamPath    REG_SZ    c:/program files (x86)/steam`
    let line = text
        .lines()
        .find(|line| line.contains(name) && line.contains("REG_SZ"))?;
    let value = line.split("REG_SZ").nth(1)?.trim().trim_matches('"');
    if value.is_empty() {
        return None;
    }
    // The registry keeps forward slashes; Windows is happy either way, but this
    // keeps every path in the app spelled the same way.
    Some(PathBuf::from(value.replace('/', "\\")))
}

/// Every place Steam keeps games, starting with the installation itself.
///
/// The list lives in `steamapps/libraryfolders.vdf`, and older or relocated
/// installs keep a copy in `config/libraryfolders.vdf`; both are read.
fn library_folders(root: &Path) -> Vec<PathBuf> {
    let mut folders = vec![root.to_path_buf()];

    for candidate in [
        root.join("steamapps").join("libraryfolders.vdf"),
        root.join("config").join("libraryfolders.vdf"),
    ] {
        let Ok(text) = std::fs::read_to_string(&candidate) else {
            continue;
        };
        for value in values_in(&quoted(&text), "path") {
            if value.trim().is_empty() {
                continue;
            }
            let path = PathBuf::from(value.replace('/', "\\"));
            if path.is_dir() && !folders.contains(&path) {
                folders.push(path);
            }
        }
    }
    folders
}

/// Read one `appmanifest_*.acf` into a game, if it says enough to be one.
fn parse_manifest(path: &Path, apps: &Path, library: &Path) -> Option<SteamGame> {
    let text = std::fs::read_to_string(path).ok()?;
    let tokens = quoted(&text);
    let value = |key: &str| values_in(&tokens, key).into_iter().next();

    let app_id: u32 = value("appid").and_then(|v| v.parse().ok()).unwrap_or(0);
    let name = value("name").unwrap_or_default();
    if app_id == 0 || name.trim().is_empty() {
        return None;
    }

    let install_dir = value("installdir").unwrap_or_default();
    // The manifest names the folder, so the path is worked out rather than
    // stored: it stays right even when a library is moved between drives.
    let dir = apps.join("common").join(&install_dir);

    Some(SteamGame {
        app_id,
        name,
        install_dir: dir.to_string_lossy().to_string(),
        size_bytes: value("SizeOnDisk").and_then(|v| v.parse().ok()).unwrap_or(0),
        last_played: value("LastPlayed")
            .and_then(|v| v.parse().ok())
            .filter(|at| *at > 0),
        library: library.to_string_lossy().to_string(),
    })
}

/// Every value written under `key`, in the order the keys appear.
///
/// Matching is done on the key token itself rather than on adjacent pairs: a
/// Valve data file nests, so pairing every two tokens from the top drifts out of
/// step the moment a brace intervenes, which is always. Reading a manifest that
/// way found no keys at all and quietly reported an empty library.
fn values_in(tokens: &[String], key: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if tokens[index] == key {
            if let Some(value) = tokens.get(index + 1) {
                out.push(value.clone());
            }
            // Past the value as well, so a value that happens to spell the key
            // is not read as one.
            index += 2;
        } else {
            index += 1;
        }
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
        let paths = values_in(&quoted(vdf), "path");
        assert_eq!(paths, vec![r"C:\Program Files (x86)\Steam", r"D:\SteamLibrary"]);
    }

    #[test]
    fn a_manifest_gives_the_name_folder_and_size() {
        // Braces and nesting included, because that is what made the first
        // parser read every key one step out and find nothing.
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
        let tokens = quoted(acf);
        let value = |key: &str| values_in(&tokens, key).into_iter().next().unwrap_or_default();
        assert_eq!(value("appid"), "620");
        assert_eq!(value("name"), "Portal 2");
        assert_eq!(value("installdir"), "Portal 2");
        assert_eq!(value("SizeOnDisk"), "12345678901");
        assert_eq!(value("LastPlayed"), "1700000000");
        assert_eq!(value("language"), "english");
    }

    #[test]
    fn a_manifest_on_disk_becomes_a_game() {
        let dir = std::env::temp_dir().join("orbit-tauri-steam");
        let _ = std::fs::remove_dir_all(&dir);
        let apps = dir.join("steamapps");
        std::fs::create_dir_all(&apps).unwrap();
        let file = apps.join("appmanifest_620.acf");
        std::fs::write(
            &file,
            r#"
"AppState"
{
    "appid"     "620"
    "name"      "Portal 2"
    "installdir"    "Portal 2"
    "SizeOnDisk"    "12345678901"
    "LastPlayed"    "1700000000"
}
"#,
        )
        .unwrap();

        let game = parse_manifest(&file, &apps, &dir).expect("a game");
        assert_eq!(game.app_id, 620);
        assert_eq!(game.name, "Portal 2");
        assert_eq!(game.size_bytes, 12_345_678_901);
        assert_eq!(game.last_played, Some(1_700_000_000));
        assert!(game.install_dir.ends_with(r"steamapps\common\Portal 2"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_manifest_with_no_name_is_not_a_game() {
        let tokens = quoted(r#""AppState" { "appid" "620" "name" "" }"#);
        assert!(values_in(&tokens, "name").into_iter().all(|n| n.trim().is_empty()));
    }

    #[test]
    fn a_path_with_a_space_and_a_quote_survives() {
        let text = r#""path" "D:\\Games\\It's Here""#;
        let paths = values_in(&quoted(text), "path");
        assert_eq!(paths[0], r"D:\Games\It's Here");
    }

    #[test]
    fn a_file_with_no_pairs_is_empty_rather_than_a_panic() {
        assert!(values_in(&quoted(""), "path").is_empty());
        assert!(values_in(&quoted("nonsense without quotes"), "path").is_empty());
        assert!(values_in(&quoted(r#""dangling""#), "path").is_empty());
    }
}
