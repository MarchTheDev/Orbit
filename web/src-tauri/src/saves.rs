//! Backups of a game's save files.
//!
//! [ludusavi](https://github.com/mtkennerly/ludusavi) already knows where a game
//! keeps its saves, from PCGamingWiki, and Orbit uses it when it is installed.
//! When it is not, a folder the player named is copied instead. Nothing here
//! uploads a save, and nothing deletes the original.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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
    pub ludusavi: bool,
    pub root: String,
}

pub fn root_of(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

pub fn status(data_dir: &Path) -> SaveStatus {
    SaveStatus {
        ludusavi: which("ludusavi").is_some(),
        root: root_of(data_dir).to_string_lossy().to_string(),
    }
}

/// Copy or ask ludusavi to copy, and remember which one it was.
pub fn backup(
    data_dir: &Path,
    game_id: &str,
    title: &str,
    save_dir: Option<&str>,
) -> Result<SaveBackup, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("This game has no name to back up under.".into());
    }
    if which("ludusavi").is_some() {
        return ludusavi_backup(data_dir, title);
    }
    let Some(from) = save_dir.map(str::trim).filter(|p| !p.is_empty()) else {
        return Err(
            "ludusavi is not installed, and no save folder has been named for this game.".into(),
        );
    };
    copy_folder(data_dir, game_id, Path::new(from))
}

/// Put the newest backup back where it came from.
pub fn restore(
    data_dir: &Path,
    game_id: &str,
    title: &str,
    save_dir: Option<&str>,
) -> Result<String, String> {
    if which("ludusavi").is_some() {
        ludusavi(data_dir, "restore", title.trim())?;
        return Ok(format!("Restored {title} with ludusavi."));
    }
    let backups = list_folder_backups(data_dir, game_id);
    let Some(latest) = backups.into_iter().max_by_key(|b| b.at) else {
        return Err("There is no folder backup to restore.".into());
    };
    let Some(dest) = save_dir.map(str::trim).filter(|p| !p.is_empty()) else {
        return Err("Name the save folder before restoring a copy into it.".into());
    };
    copy_tree(&PathBuf::from(&latest.path), Path::new(dest))?;
    Ok(format!("Restored the copy from {}.", latest.path))
}

pub fn list(data_dir: &Path, game_id: &str, title: &str) -> Vec<SaveBackup> {
    let mut found = list_folder_backups(data_dir, game_id);
    if which("ludusavi").is_some() {
        let dir = ludusavi_root(data_dir).join(safe_name(title));
        if dir.is_dir() {
            found.push(SaveBackup {
                at: mtime(&dir),
                path: dir.to_string_lossy().to_string(),
                kind: "ludusavi".into(),
                note: "Kept by ludusavi".into(),
            });
        }
    }
    found.sort_by_key(|b| std::cmp::Reverse(b.at));
    found
}

fn ludusavi_backup(data_dir: &Path, title: &str) -> Result<SaveBackup, String> {
    ludusavi(data_dir, "backup", title)?;
    Ok(SaveBackup {
        at: now(),
        path: ludusavi_root(data_dir).to_string_lossy().to_string(),
        kind: "ludusavi".into(),
        note: format!("ludusavi backup of {title}"),
    })
}

/// `--path` belongs to the backup and restore commands, not in front of them.
fn ludusavi(data_dir: &Path, command: &str, title: &str) -> Result<(), String> {
    let root = ludusavi_root(data_dir);
    fs::create_dir_all(&root).map_err(|e| format!("Could not create {}: {e}", root.display()))?;
    let mut cmd = Command::new("ludusavi");
    cmd.arg(command)
        .arg("--force")
        .arg("--path")
        .arg(&root)
        .arg(title)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let out = cmd
        .output()
        .map_err(|e| format!("Could not run ludusavi: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let msg = err.trim();
    if msg.is_empty() {
        Err(format!("ludusavi exited with {}", out.status))
    } else {
        Err(format!("ludusavi: {msg}"))
    }
}

fn copy_folder(data_dir: &Path, game_id: &str, from: &Path) -> Result<SaveBackup, String> {
    if !from.is_dir() {
        return Err(format!("{} is not a folder.", from.display()));
    }
    let at = now();
    let dest = root_of(data_dir)
        .join(safe_name(game_id))
        .join(at.to_string());
    copy_tree(from, &dest)?;
    let note = format!("Copied from {}", from.display());
    fs::write(dest.join(".orbit-note"), &note).ok();
    Ok(SaveBackup {
        at,
        path: dest.to_string_lossy().to_string(),
        kind: "folder".into(),
        note,
    })
}

fn list_folder_backups(data_dir: &Path, game_id: &str) -> Vec<SaveBackup> {
    let dir = root_of(data_dir).join(safe_name(game_id));
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let at = name.parse::<i64>().unwrap_or_else(|_| mtime(&entry.path()));
        let note = fs::read_to_string(entry.path().join(".orbit-note")).unwrap_or_default();
        found.push(SaveBackup {
            at,
            path: entry.path().to_string_lossy().to_string(),
            kind: "folder".into(),
            note: note.trim().to_string(),
        });
    }
    found
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Could not create {}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("Could not read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("Could not read {}: {e}", from.display()))?;
        let dest = to.join(entry.file_name());
        let kind = entry
            .file_type()
            .map_err(|e| format!("Could not read {}: {e}", entry.path().display()))?;
        // A link can point anywhere. Copying it as a file would either follow it
        // out of the save folder or write a link the restore cannot trust.
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &dest).map_err(|e| {
                format!("Could not copy {} to {}: {e}", entry.path().display(), dest.display())
            })?;
        }
    }
    Ok(())
}

fn ludusavi_root(data_dir: &Path) -> PathBuf {
    root_of(data_dir).join("ludusavi")
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
    let mut depth = 0;
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
    let mut depth = 0;
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
}
