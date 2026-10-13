//! Backups of a game's save files.
//!
//! Orbit finds the folder the way a launcher does: look in the usual places
//! for a directory named after the game, then copy that directory. Nothing else
//! has to be installed, nothing is uploaded, and the original files are left
//! where the game wrote them. A folder the player names is used instead of the
//! search. PCGamingWiki can still be asked where a game usually keeps its
//! saves; that is a free page, not a program.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackup {
    pub at: i64,
    pub path: String,
    pub kind: String,
    pub note: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStatus {
    pub root: String,
}

/// Extra places to look, taken from the game itself.
#[derive(Clone, Debug, Default)]
pub struct Hints<'a> {
    pub install_dir: Option<&'a str>,
    pub prefix: Option<&'a str>,
    pub steam_app_id: Option<u32>,
}

pub fn root_of(data_dir: &Path, custom: Option<&str>) -> PathBuf {
    let custom = custom.map(str::trim).filter(|path| !path.is_empty());
    match custom {
        Some(path) => PathBuf::from(path),
        None => data_dir.join("backups"),
    }
}

pub fn status(data_dir: &Path, custom: Option<&str>) -> SaveStatus {
    SaveStatus {
        root: root_of(data_dir, custom).to_string_lossy().to_string(),
    }
}

/// Copy the save folder. A named folder wins. Otherwise Orbit looks.
pub fn backup(
    data_dir: &Path,
    _game_id: &str,
    title: &str,
    save_dir: Option<&str>,
    hints: &Hints<'_>,
    publisher: Option<&str>,
    backup_root: Option<&str>,
) -> Result<SaveBackup, String> {
    let from = resolve(title, save_dir, hints)?;
    let root = root_of(data_dir, backup_root);
    if from.starts_with(&root) {
        return Err("That folder is a backup Orbit already made, not the game's saves.".into());
    }
    copy_folder(&root, title, publisher, &from)
}

/// Put the newest backup back where it came from.
pub fn restore(
    data_dir: &Path,
    game_id: &str,
    title: &str,
    save_dir: Option<&str>,
    hints: &Hints<'_>,
    publisher: Option<&str>,
    backup_root: Option<&str>,
) -> Result<String, String> {
    let backups = list(data_dir, game_id, title, publisher, backup_root);
    let Some(latest) = backups.into_iter().max_by_key(|b| b.at) else {
        return Err("There is no backup to restore.".into());
    };
    let dest = resolve(title, save_dir, hints)?;
    copy_tree(&PathBuf::from(&latest.path), &dest, 0, true)?;
    Ok(format!("Restored the copy into {}.", dest.display()))
}

pub fn list(
    data_dir: &Path,
    game_id: &str,
    title: &str,
    publisher: Option<&str>,
    backup_root: Option<&str>,
) -> Vec<SaveBackup> {
    let root = root_of(data_dir, backup_root);
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in game_backup_dirs(&root, game_id, title, publisher) {
        for backup in list_folder_backups(&dir) {
            if seen.insert(backup.path.clone()) {
                found.push(backup);
            }
        }
    }
    // A copy made before the folders used the real names still lives under the
    // old id, next to Orbit's own files, even if the player has since chosen
    // another folder.
    if backup_root.is_some() {
        let previous = data_dir.join("backups");
        if previous != root {
            for dir in game_backup_dirs(&previous, game_id, title, publisher) {
                for backup in list_folder_backups(&dir) {
                    if seen.insert(backup.path.clone()) {
                        found.push(backup);
                    }
                }
            }
        }
    }
    found.sort_by_key(|b| std::cmp::Reverse(b.at));
    found
}

/// The folder a backup would copy, if Orbit can see one.
pub fn detect(title: &str, hints: &Hints<'_>) -> Option<PathBuf> {
    resolve(title, None, hints).ok()
}

fn resolve(title: &str, save_dir: Option<&str>, hints: &Hints<'_>) -> Result<PathBuf, String> {
    if let Some(named) = save_dir.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(named);
        if path.is_dir() {
            return Ok(path);
        }
        return Err(format!("{} is not a folder.", path.display()));
    }
    let title = title.trim();
    if title.is_empty() {
        return Err("This game has no name to look up a save folder with.".into());
    }
    if let Some(found) = search(title, hints) {
        return Ok(found);
    }
    Err(format!(
        "Orbit could not find a save folder for {title}. Name the folder, and the next copy will use that."
    ))
}

fn search(title: &str, hints: &Hints<'_>) -> Option<PathBuf> {
    let names = candidates(title, hints.install_dir);
    if names.is_empty() {
        return None;
    }

    if let Some(install) = hints.install_dir.map(str::trim).filter(|p| !p.is_empty()) {
        if let Some(found) = install_saves(Path::new(install)) {
            return Some(found);
        }
    }

    let mut roots = Vec::new();
    if let Some(prefix) = hints.prefix.map(str::trim).filter(|p| !p.is_empty()) {
        roots.extend(wine_user_roots(Path::new(prefix)));
    }
    if let Some(app_id) = hints.steam_app_id {
        for prefix in steam_prefixes_for(app_id) {
            roots.extend(wine_user_roots(&prefix));
        }
    }
    roots.extend(home_roots());

    if let Some(found) = scan_roots(&roots, &names) {
        return Some(found);
    }

    // A Steam game that was not imported as one still keeps its prefix under a
    // number. Look only at the user folders, and stop after a handful.
    let mut extra = Vec::new();
    for prefix in other_steam_prefixes(hints.steam_app_id) {
        extra.extend(wine_user_roots(&prefix));
        if extra.len() > 240 {
            break;
        }
    }
    scan_roots(&extra, &names)
}

fn scan_roots(roots: &[PathBuf], names: &[String]) -> Option<PathBuf> {
    for root in roots {
        if let Some(found) = match_in(root, names, true) {
            if !too_broad(&found) {
                return Some(prefer_inner(found));
            }
        }
    }
    None
}

/// A child of `root` whose name is the game, or a publisher folder's child.
pub fn match_in(root: &Path, names: &[String], nested: bool) -> Option<PathBuf> {
    if !root.is_dir() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?.flatten().collect::<Vec<_>>();
    for entry in &entries {
        if entry.path().is_dir() && name_matches(&entry.file_name().to_string_lossy(), names) {
            return Some(entry.path());
        }
    }
    if !nested || entries.len() > 400 {
        return None;
    }
    for entry in &entries {
        if !entry.path().is_dir() {
            continue;
        }
        let Ok(children) = fs::read_dir(entry.path()) else {
            continue;
        };
        for child in children.flatten() {
            if child.path().is_dir() && name_matches(&child.file_name().to_string_lossy(), names) {
                return Some(child.path());
            }
        }
    }
    None
}

fn prefer_inner(found: PathBuf) -> PathBuf {
    let saved = found.join("Saved").join("SaveGames");
    if saved.is_dir() {
        return saved;
    }
    for sub in ["Saves", "saves", "SaveGames"] {
        let inner = found.join(sub);
        if inner.is_dir() {
            return inner;
        }
    }
    found
}

fn install_saves(install: &Path) -> Option<PathBuf> {
    if !install.is_dir() {
        return None;
    }
    for sub in ["Saved/SaveGames", "Saved", "Saves", "saves", "Save", "save", "SaveGames"] {
        let candidate = install.join(sub);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

fn wine_user_roots(prefix: &Path) -> Vec<PathBuf> {
    let users = prefix.join("drive_c").join("users");
    let Ok(entries) = fs::read_dir(&users) else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.eq_ignore_ascii_case("Public") || !entry.path().is_dir() {
            continue;
        }
        let user = entry.path();
        for sub in [
            "Saved Games",
            "Documents/My Games",
            "Documents",
            "AppData/LocalLow",
            "AppData/Local",
            "AppData/Roaming",
        ] {
            roots.push(user.join(sub));
        }
    }
    roots
}

fn home_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let base = PathBuf::from(profile);
            roots.push(base.join("Saved Games"));
            roots.push(base.join("Documents").join("My Games"));
            roots.push(base.join("Documents"));
            roots.push(base.join("AppData").join("LocalLow"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            roots.push(PathBuf::from(local));
        }
        if let Ok(roaming) = std::env::var("APPDATA") {
            roots.push(PathBuf::from(roaming));
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = home_dir() {
            if let Some(data) = std::env::var_os("XDG_DATA_HOME") {
                roots.push(PathBuf::from(data));
            } else {
                roots.push(home.join(".local/share"));
            }
            if let Some(config) = std::env::var_os("XDG_CONFIG_HOME") {
                roots.push(PathBuf::from(config));
            } else {
                roots.push(home.join(".config"));
            }
            roots.push(home.join(".config/unity3d"));
            roots.push(home.join("Documents"));
            roots.push(home.join("Documents/My Games"));
            roots.extend(wine_user_roots(&home.join(".wine")));
        }
    }
    roots
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Steam"));
        }
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Ok(dir) = std::env::var(var) {
                roots.push(PathBuf::from(dir).join("Steam"));
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = home_dir() {
            roots.extend([
                home.join(".steam/steam"),
                home.join(".steam/root"),
                home.join(".local/share/Steam"),
                home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
                home.join(".var/app/com.valvesoftware.Steam/.steam/steam"),
                home.join("snap/steam/common/.steam/steam"),
            ]);
        }
    }
    roots.into_iter().filter(|path| path.is_dir()).collect()
}

fn steam_prefixes_for(app_id: u32) -> Vec<PathBuf> {
    steam_roots()
        .into_iter()
        .map(|root| {
            root.join("steamapps")
                .join("compatdata")
                .join(app_id.to_string())
                .join("pfx")
        })
        .filter(|path| path.is_dir())
        .collect()
}

fn other_steam_prefixes(skip: Option<u32>) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for root in steam_roots() {
        let compat = root.join("steamapps").join("compatdata");
        let Ok(entries) = fs::read_dir(&compat) else {
            continue;
        };
        for entry in entries.flatten().take(48) {
            let name = entry.file_name().to_string_lossy().to_string();
            if skip.is_some_and(|id| name == id.to_string()) {
                continue;
            }
            let prefix = entry.path().join("pfx");
            if prefix.is_dir() {
                found.push(prefix);
            }
            if found.len() >= 48 {
                return found;
            }
        }
    }
    found
}

fn candidates(title: &str, install_dir: Option<&str>) -> Vec<String> {
    let mut names = Vec::new();
    push_name(&mut names, title);
    if let Some((main, sub)) = title.split_once(':').or_else(|| title.split_once(" - ")) {
        push_name(&mut names, main);
        push_name(&mut names, sub);
    }
    if let Some(install) = install_dir {
        if let Some(folder) = Path::new(install).file_name().and_then(|n| n.to_str()) {
            push_name(&mut names, folder);
        }
    }
    names
}

fn push_name(names: &mut Vec<String>, raw: &str) {
    let trimmed = raw.trim().trim_matches(|c: char| c == '™' || c == '®' || c == '©');
    if trimmed.chars().count() >= 3 {
        names.push(trimmed.to_string());
    }
    let normalized = normalize(trimmed);
    if normalized.len() >= 3 && !names.iter().any(|n| normalize(n) == normalized) {
        names.push(normalized);
    }
}

fn name_matches(dir_name: &str, names: &[String]) -> bool {
    let dir_norm = normalize(dir_name);
    if dir_norm.len() < 3 {
        return false;
    }
    names.iter().any(|name| {
        name.eq_ignore_ascii_case(dir_name) || normalize(name) == dir_norm
    })
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn too_broad(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return true;
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "users"
            | "documents"
            | "saved games"
            | "my games"
            | "appdata"
            | "local"
            | "roaming"
            | "locallow"
            | "share"
            | "config"
            | ".config"
            | ".local"
            | "home"
            | "public"
            | "steamuser"
    )
}

#[allow(dead_code)]
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .filter(|home| !home.is_empty())
            .map(PathBuf::from)
    }
}

fn copy_folder(
    root: &Path,
    title: &str,
    publisher: Option<&str>,
    from: &Path,
) -> Result<SaveBackup, String> {
    if !from.is_dir() {
        return Err(format!("{} is not a folder.", from.display()));
    }
    let at = now();
    let (studio, game) = place_names(title, publisher, from);
    let dest = root.join(&studio).join(&game);
    // The date lives in the note. Another folder named after the clock only
    // made the copy harder to find, and a new copy replaces the last one.
    clear_direct_copy(&dest)?;
    copy_tree(from, &dest, 0, false)?;
    let when = when_text(at);
    let note = format!(
        "Game: {game}\nPublisher: {studio}\nCopied from: {}\nWhen (UTC): {when}\nAt: {at}\n",
        from.display()
    );
    fs::write(dest.join("note.txt"), &note).map_err(|e| format!("Could not write the note: {e}"))?;
    Ok(SaveBackup {
        at,
        path: dest.to_string_lossy().to_string(),
        kind: "folder".into(),
        note,
    })
}

fn list_folder_backups(dir: &Path) -> Vec<SaveBackup> {
    let mut found = Vec::new();
    // A copy now sits in the game folder itself, with the date in note.txt.
    if has_note(dir) {
        found.push(backup_record(dir));
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        // Older copies are still a dated folder, or a numbered one, beside it.
        if legacy_child(&entry.path()) {
            found.push(backup_record(&entry.path()));
        }
    }
    found
}

fn backup_record(dir: &Path) -> SaveBackup {
    let name = dir.file_name().map(|part| part.to_string_lossy().into_owned()).unwrap_or_default();
    let note = fs::read_to_string(dir.join("note.txt"))
        .or_else(|_| fs::read_to_string(dir.join(".orbit-note")))
        .unwrap_or_default();
    let at = note
        .lines()
        .find_map(|line| line.strip_prefix("At: ").and_then(|rest| rest.trim().parse().ok()))
        .or_else(|| name.parse().ok())
        .unwrap_or_else(|| mtime(dir));
    SaveBackup {
        at,
        path: dir.to_string_lossy().to_string(),
        kind: "folder".into(),
        note: note.trim().to_string(),
    }
}

fn has_note(dir: &Path) -> bool {
    dir.join("note.txt").is_file() || dir.join(".orbit-note").is_file()
}

/// A previous copy, not a folder the game itself saved.
fn kept_aside(path: &Path) -> bool {
    path.is_dir()
        && (has_note(path)
            || path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(looks_like_stamp))
}

fn legacy_child(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    if kept_aside(path) {
        return true;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_digit()))
}

fn looks_like_stamp(name: &str) -> bool {
    let Some((date, rest)) = name.split_once(' ') else {
        return false;
    };
    let date: Vec<&str> = date.split('-').collect();
    if date.len() != 3 || date[0].len() != 4 || date[1].len() != 2 || date[2].len() != 2 {
        return false;
    }
    if !date.iter().all(|part| part.bytes().all(|byte| byte.is_ascii_digit())) {
        return false;
    }
    let mut clock = rest.split('-');
    let pair = |part: Option<&str>| {
        part.is_some_and(|value| value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_digit()))
    };
    let hour = clock.next();
    let minute = clock.next();
    let second = clock.next();
    let extra = clock.next();
    pair(hour)
        && pair(minute)
        && pair(second)
        && extra
            .map(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .unwrap_or(true)
        && clock.next().is_none()
}

/// Drop the previous direct copy, and leave an older dated folder where it is.
fn clear_direct_copy(dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dest).map_err(|e| format!("Could not read {}: {e}", dest.display()))? {
        let entry = entry.map_err(|e| format!("Could not read {}: {e}", dest.display()))?;
        let name = entry.file_name();
        if name == "note.txt" || name == ".orbit-note" || kept_aside(&entry.path()) {
            continue;
        }
        let path = entry.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|e| format!("Could not replace {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Publisher, then the game. A copy made from `Documents/Rockstar Games/Red
/// Dead Redemption 2` is filed that way, not under an id and a number.
fn place_names(title: &str, studio: Option<&str>, from: &Path) -> (String, String) {
    let game = folder_name(title);
    let publisher = studio
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(folder_name)
        .or_else(|| publisher_above(from, &game))
        .unwrap_or_else(|| "Unknown".into());
    (publisher, game)
}

fn publisher_above(from: &Path, game: &str) -> Option<String> {
    let mut cursor = Some(from);
    while let Some(dir) = cursor {
        let name = dir.file_name().and_then(|part| part.to_str()).unwrap_or("");
        if !name.is_empty() && folder_name(name).eq_ignore_ascii_case(game) {
            let parent = dir.parent()?;
            let parent_name = parent.file_name().and_then(|part| part.to_str()).unwrap_or("");
            if !parent_name.is_empty() && !generic_folder(parent_name) {
                return Some(folder_name(parent_name));
            }
        }
        cursor = dir.parent();
    }
    None
}

fn game_backup_dirs(root: &Path, game_id: &str, title: &str, publisher: Option<&str>) -> Vec<PathBuf> {
    let game = folder_name(title);
    let mut dirs = Vec::new();
    if let Some(publisher) = publisher.map(str::trim).filter(|name| !name.is_empty()) {
        dirs.push(root.join(folder_name(publisher)).join(&game));
    }
    dirs.push(root.join("Unknown").join(&game));
    dirs.push(root.join(safe_name(game_id)));
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let child = entry.path().join(&game);
            if child.is_dir() {
                dirs.push(child);
            }
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

fn generic_folder(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "users"
            | "user"
            | "documents"
            | "my documents"
            | "saved games"
            | "my games"
            | "profiles"
            | "profile"
            | "savegames"
            | "saves"
            | "saved"
            | "save"
            | "appdata"
            | "local"
            | "locallow"
            | "roaming"
            | "public"
            | "home"
            | "desktop"
            | "downloads"
            | "onedrive"
            | "drive_c"
    )
}

fn copy_tree(from: &Path, to: &Path, depth: i32, skip_snapshots: bool) -> Result<(), String> {
    if depth > 16 {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| format!("Could not create {}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("Could not read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("Could not read {}: {e}", from.display()))?;
        let file_name = entry.file_name();
        if file_name == ".orbit-note" || file_name == "note.txt" {
            continue;
        }
        let dest = to.join(entry.file_name());
        let kind = entry
            .file_type()
            .map_err(|e| format!("Could not read {}: {e}", entry.path().display()))?;
        // A link can point anywhere. Copying it as a file would either follow it
        // out of the save folder or write a link the restore cannot trust.
        if kind.is_symlink() {
            continue;
        }
        // An older dated copy can sit beside the current files. Restoring must
        // not carry that folder back into the game.
        if skip_snapshots && kind.is_dir() && kept_aside(&entry.path()) {
            continue;
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &dest, depth + 1, skip_snapshots)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &dest).map_err(|e| {
                format!(
                    "Could not copy {} to {}: {e}",
                    entry.path().display(),
                    dest.display()
                )
            })?;
        }
    }
    Ok(())
}

fn safe_name(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "game".into()
    } else {
        trimmed
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A folder name that keeps the original spelling. Spaces stay. Only the
/// characters a folder cannot contain are taken out.
fn folder_name(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches(|ch: char| ch == '.' || ch == ' ');
    if trimmed.is_empty() || is_reserved(trimmed) {
        "Game".into()
    } else {
        trimmed.to_string()
    }
}

fn is_reserved(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or(name);
    matches!(
        base.to_ascii_uppercase().as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "LPT1" | "LPT2"
    )
}

fn stamp_folder(at: i64) -> String {
    let (year, month, day, hour, minute, second) = civil_clock(at);
    format!("{year:04}-{month:02}-{day:02} {hour:02}-{minute:02}-{second:02}")
}

/// The same moment, written for a person to read in the note.
fn when_text(at: i64) -> String {
    let (year, month, day, hour, minute, second) = civil_clock(at);
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
}

fn civil_clock(at: i64) -> (i32, u32, u32, i64, i64, i64) {
    let days = at.div_euclid(86_400);
    let tod = at.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    (year, month, day, hour, minute, second)
}

/// Howard Hinnant's civil_from_days, with the Unix epoch.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as i32, month as u32, day as u32)
}

fn mtime(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Save paths named on a PCGamingWiki page.
///
/// The API needs no key. What comes back is wikitext, and the rows Orbit can
/// use are the `Game data/saves` and `Game data/config` templates.
pub fn paths_from_wikitext(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut i = 0;
    while i + 1 < text.len() {
        if !text[i..].starts_with("{{") {
            i += text[i..].chars().next().map(|ch| ch.len_utf8()).unwrap_or(1);
            continue;
        }
        let Some(end) = template_end(text, i) else {
            i += 2;
            continue;
        };
        let body = &text[i + 2..end];
        let lower = body.to_ascii_lowercase();
        if lower.starts_with("game data/saves") || lower.starts_with("game data/config") {
            let parts = split_pipes(body);
            if parts.len() >= 3 {
                let platform = parts[1].trim();
                let path = expand_wiki(parts[2].trim());
                if !path.is_empty() {
                    let line = if platform.is_empty() {
                        path
                    } else {
                        format!("{platform}: {path}")
                    };
                    if !found.contains(&line) {
                        found.push(line);
                    }
                }
            }
        }
        i = end + 2;
    }
    found
}

/// Index of the `}` that closes the template starting at `start` (`{{`).
fn template_end(text: &str, start: usize) -> Option<usize> {
    let rest = text[start..].as_bytes();
    let mut depth: i32 = 0;
    let mut i = 0;
    while i + 1 < rest.len() {
        if rest[i] == b'{' && rest[i + 1] == b'{' {
            depth += 1;
            i += 2;
            continue;
        }
        if rest[i] == b'}' && rest[i + 1] == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(start + i);
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    None
}

/// Split on `|` that are not inside a nested template.
fn split_pipes(body: &str) -> Vec<&str> {
    let bytes = body.as_bytes();
    let mut parts = Vec::new();
    let mut depth: i32 = 0;
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            depth += 1;
            i += 2;
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'}' && bytes[i + 1] == b'}' {
            depth = depth.saturating_sub(1);
            i += 2;
            continue;
        }
        if bytes[i] == b'|' && depth == 0 {
            parts.push(&body[start..i]);
            start = i + 1;
        }
        i += 1;
    }
    parts.push(&body[start..]);
    parts
}

fn expand_wiki(path: &str) -> String {
    let mut out = path.to_string();
    for (token, value) in [
        ("{{p|userprofile}}", "%USERPROFILE%"),
        ("{{p|localappdata}}", "%LOCALAPPDATA%"),
        ("{{p|appdata}}", "%APPDATA%"),
        ("{{p|linuxhome}}", "$HOME"),
        ("{{p|xdghome}}", "$HOME"),
        ("{{p|xdgdatahome}}", "$HOME/.local/share"),
        ("{{p|xdgconfighome}}", "$HOME/.config"),
        ("{{p|osxhome}}", "$HOME"),
        ("{{p|steam}}", "Steam"),
        ("{{p|game}}", "<game folder>"),
    ] {
        let mut lower = out.to_ascii_lowercase();
        let needle = token.to_ascii_lowercase();
        while let Some(at) = lower.find(&needle) {
            out.replace_range(at..at + needle.len(), value);
            lower = out.to_ascii_lowercase();
        }
    }
    // Wiki markup writes a Windows separator as two backslashes.
    out.replace("\\\\", "\\")
}

/// Encode a page title for the query string. Spaces become underscores, which
/// is how MediaWiki names a page.
pub fn wiki_title(title: &str) -> String {
    let mut out = String::new();
    for ch in title.trim().chars() {
        match ch {
            ' ' => out.push('_'),
            'A'..='Z' | 'a'..='z' | '0'..='9' | '_' | '-' | '.' | '(' | ')' => out.push(ch),
            other => {
                let mut buf = [0u8; 4];
                for byte in other.encode_utf8(&mut buf).bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wiki_rows_become_paths() {
        let text = "{{Game data/saves|Windows|{{p|userprofile}}\\AppData\\Celeste}}\n{{Game data/config|Linux|{{p|linuxhome}}/.local/share/Celeste}}";
        let paths = paths_from_wikitext(text);
        assert_eq!(
            paths,
            vec![
                r"Windows: %USERPROFILE%\AppData\Celeste".to_string(),
                "Linux: $HOME/.local/share/Celeste".to_string(),
            ]
        );
    }

    #[test]
    fn a_title_is_safe_in_a_url() {
        assert_eq!(wiki_title("Celeste"), "Celeste");
        assert_eq!(wiki_title("A&B"), "A%26B");
    }

    #[test]
    fn a_name_cannot_leave_its_folder() {
        assert_eq!(safe_name("../nope"), "nope");
        assert_eq!(safe_name("   "), "game");
    }

    #[test]
    fn a_folder_keeps_the_original_name() {
        assert_eq!(folder_name("Red Dead Redemption 2"), "Red Dead Redemption 2");
        assert_eq!(folder_name("Rockstar Games"), "Rockstar Games");
        assert!(!folder_name("Red/Dead").contains('/'));
    }

    #[test]
    fn a_rockstar_save_is_filed_under_the_publisher_and_the_game() {
        let from = Path::new("/home/user/Documents/Rockstar Games/Red Dead Redemption 2/Profiles/abc");
        let (publisher, game) = place_names("Red Dead Redemption 2", None, from);
        assert_eq!(publisher, "Rockstar Games");
        assert_eq!(game, "Red Dead Redemption 2");
        let (named, _) = place_names("Red Dead Redemption 2", Some("Rockstar Games"), Path::new("/tmp/saves"));
        assert_eq!(named, "Rockstar Games");
    }

    #[test]
    fn a_stamp_is_a_date_not_a_bare_number() {
        assert_eq!(stamp_folder(0), "1970-01-01 00-00-00");
        assert_eq!(when_text(0), "1970-01-01 00:00:00");
        assert!(looks_like_stamp("1970-01-01 00-00-00"));
        assert!(looks_like_stamp("1970-01-01 00-00-00-12"));
        assert!(!looks_like_stamp("Profiles"));
    }

    #[test]
    fn a_copy_puts_the_date_in_the_note_instead_of_a_folder() {
        let root = std::env::temp_dir().join(format!("orbit-backup-note-{}", std::process::id()));
        let save = root.join("live");
        fs::create_dir_all(save.join("Profiles")).unwrap();
        fs::write(save.join("Profiles").join("slot"), b"1").unwrap();
        let data = root.join("data");
        let made = backup(
            &data,
            "id",
            "Red Dead Redemption 2",
            Some(save.to_str().unwrap()),
            &Hints::default(),
            Some("Rockstar Games"),
            None,
        )
        .unwrap();
        let game = data.join("backups").join("Rockstar Games").join("Red Dead Redemption 2");
        assert_eq!(std::path::PathBuf::from(&made.path), game);
        let note = fs::read_to_string(game.join("note.txt")).unwrap();
        assert!(note.contains("When: "), "{note}");
        assert!(note.contains("At: "), "{note}");
        assert!(game.join("Profiles").join("slot").is_file());
        let old = game.join("2020-01-02 03-04-05");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("note.txt"), "At: 10\n").unwrap();
        fs::write(save.join("Profiles").join("slot"), b"2").unwrap();
        backup(
            &data,
            "id",
            "Red Dead Redemption 2",
            Some(save.to_str().unwrap()),
            &Hints::default(),
            Some("Rockstar Games"),
            None,
        )
        .unwrap();
        assert!(old.join("note.txt").is_file(), "an older dated copy is left alone");
        let listed = list(&data, "id", "Red Dead Redemption 2", Some("Rockstar Games"), None);
        assert!(listed.iter().any(|item| item.path == game.to_string_lossy()));
        assert!(listed.iter().any(|item| item.path.ends_with("2020-01-02 03-04-05")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_named_after_the_game_is_the_save_folder() {
        let root = std::env::temp_dir().join(format!("orbit-saves-{}", std::process::id()));
        let saved = root.join("Saved Games").join("Celeste");
        fs::create_dir_all(&saved).unwrap();
        let found = match_in(&root.join("Saved Games"), &["Celeste".into()], true);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(found.unwrap(), saved);
    }

    #[test]
    fn a_publisher_folder_does_not_hide_the_game() {
        let root = std::env::temp_dir().join(format!("orbit-saves-nested-{}", std::process::id()));
        let saved = root.join("CD Projekt Red").join("Cyberpunk 2077");
        fs::create_dir_all(&saved).unwrap();
        let found = match_in(&root, &["Cyberpunk 2077".into()], true);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(found.unwrap(), saved);
    }

    #[test]
    fn a_missing_folder_does_not_ask_for_another_program() {
        let dir = std::env::temp_dir().join(format!("orbit-backup-missing-{}", std::process::id()));
        let err = backup(
            &dir,
            "id",
            "Orbit Missing Save Zzq",
            None,
            &Hints::default(),
            None,
            None,
        )
        .unwrap_err();
        let lower = err.to_ascii_lowercase();
        assert!(!lower.contains("ludusavi"), "{err}");
        assert!(!lower.contains("ghost"), "{err}");
    }
}
