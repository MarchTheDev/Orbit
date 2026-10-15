//! Send the copies Orbit already made somewhere else.
//!
//! CloudRedirect hooks Steam itself so a game that is not owned can pretend to
//! use Steam Cloud. That is the wrong tool here: it can overwrite a save, and
//! Orbit is not a Steam plugin. What is worth keeping is the smaller idea — a
//! place the player chooses, and one folder per game so two games never share
//! a file. rsync is the incremental copy, when the computer has it. A folder
//! on this machine does not need it.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::process;
use crate::saves;

/// Copy the backup tree to `destination`.
///
/// A destination with a host in it (`name@computer:folder`) needs rsync. A
/// plain folder is copied directly when rsync is not installed, so nothing
/// extra has to be put on the machine for a local sync.
pub fn copies(data_dir: &Path, backup_root: Option<&str>, destination: &str) -> Result<String, String> {
    let destination = destination.trim();
    if destination.is_empty() {
        return Err("Choose a folder, or an rsync destination, first.".into());
    }
    let source = saves::root_of(data_dir, backup_root);
    if !source.is_dir() {
        return Err("There are no copies to sync yet. Back up a game first.".into());
    }
    if !is_remote(destination) {
        let dest = PathBuf::from(destination);
        if dest.is_file() {
            return Err("That is a file, not a folder.".into());
        }
        if same_place(&source, &dest) {
            return Err("That is the folder the copies are already in.".into());
        }
        if dest.starts_with(&source) || source.starts_with(&dest) {
            return Err("The sync folder cannot sit inside the copies, or the other way around.".into());
        }
    }

    match rsync(&source, destination) {
        Ok(message) => Ok(message),
        Err(reason) if reason == "missing" && !is_remote(destination) => {
            let copied = copy_changed(&source, &PathBuf::from(destination))?;
            Ok(if copied == 0 {
                format!("Already up to date in {destination}.")
            } else {
                format!(
                    "Synced {copied} changed {} to {destination}.",
                    if copied == 1 { "file" } else { "files" }
                )
            })
        }
        Err(reason) if reason == "missing" => Err(
            "rsync is not on this computer, so a destination on another computer cannot be used. A folder on this machine can."
                .into(),
        ),
        Err(reason) => Err(reason),
    }
}

/// `user@host:path` and `host:path` are rsync destinations. A Windows drive is not.
fn is_remote(destination: &str) -> bool {
    let bytes = destination.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return false;
    }
    if destination.starts_with("\\\\") || destination.starts_with("//") {
        return false;
    }
    destination.contains(':') || destination.contains('@')
}

fn same_place(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn rsync(source: &Path, destination: &str) -> Result<String, String> {
    let mut from = source.to_string_lossy().into_owned();
    if !from.ends_with('/') && !from.ends_with('\\') {
        from.push('/');
    }
    let output = process::command("rsync")
        .arg("-a")
        .arg("--")
        .arg(&from)
        .arg(destination)
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "missing".to_string()
            } else {
                format!("Could not start rsync: {error}")
            }
        })?;
    if output.status.success() {
        return Ok(format!("Synced with rsync to {destination}."));
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail = detail.trim();
    Err(if detail.is_empty() {
        "rsync did not finish the sync.".into()
    } else {
        format!("rsync did not finish the sync: {detail}")
    })
}

/// Copy files whose size or time differs. Nothing is deleted at the destination.
fn copy_changed(from: &Path, to: &Path) -> Result<u64, String> {
    fs::create_dir_all(to).map_err(|e| format!("Could not create the sync folder: {e}"))?;
    let mut copied = 0;
    copy_dir(from, to, 0, &mut copied)?;
    Ok(copied)
}

fn copy_dir(from: &Path, to: &Path, depth: u8, copied: &mut u64) -> Result<(), String> {
    if depth > 32 {
        return Ok(());
    }
    let entries = fs::read_dir(from).map_err(|e| format!("Could not read {}: {e}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let dest = to.join(&name);
        if path.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("Could not create {}: {e}", dest.display()))?;
            copy_dir(&path, &dest, depth + 1, copied)?;
            continue;
        }
        if unchanged(&path, &dest) {
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&path, &dest).map_err(|e| format!("Could not copy {}: {e}", path.display()))?;
        stamp(&path, &dest);
        *copied += 1;
    }
    Ok(())
}

fn unchanged(from: &Path, to: &Path) -> bool {
    let (Ok(left), Ok(right)) = (fs::metadata(from), fs::metadata(to)) else {
        return false;
    };
    left.len() == right.len() && modified(&left) == modified(&right)
}

fn modified(meta: &fs::Metadata) -> Option<SystemTime> {
    meta.modified().ok()
}

/// Keep the copy's time, so the next sync can tell it has not changed.
fn stamp(from: &Path, to: &Path) {
    let Ok(meta) = fs::metadata(from) else { return };
    let Ok(modified) = meta.modified() else { return };
    let Ok(file) = fs::File::options().write(true).open(to) else { return };
    let _ = file.set_modified(modified);
}

#[cfg(test)]
mod tests {
    use super::is_remote;

    #[test]
    fn a_drive_letter_is_not_a_remote() {
        assert!(!is_remote(r"C:\Games\Saves"));
        assert!(!is_remote("/home/orbit/saves"));
        assert!(!is_remote(r"\\server\share"));
        assert!(is_remote("me@computer:saves"));
        assert!(is_remote("computer:saves"));
    }

    #[test]
    fn a_changed_file_is_copied_and_an_unchanged_one_is_not() {
        let root = std::env::temp_dir().join(format!("orbit-sync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let from = root.join("from");
        let to = root.join("to");
        fs::create_dir_all(from.join("Publisher").join("Game")).unwrap();
        fs::write(from.join("Publisher").join("Game").join("note.txt"), "hello").unwrap();
        assert_eq!(copy_changed(&from, &to).unwrap(), 1);
        assert_eq!(copy_changed(&from, &to).unwrap(), 0);
        fs::write(from.join("Publisher").join("Game").join("note.txt"), "hello!").unwrap();
        assert_eq!(copy_changed(&from, &to).unwrap(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn syncing_a_folder_into_itself_is_refused() {
        let root = std::env::temp_dir().join(format!("orbit-sync-root-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let backups = root.join("backups");
        fs::create_dir_all(&backups).unwrap();
        let err = copies(&root, None, &backups.to_string_lossy()).unwrap_err();
        assert!(err.contains("already"), "{err}");
        let nested = backups.join("elsewhere");
        fs::create_dir_all(&nested).unwrap();
        let err = copies(&root, None, &nested.to_string_lossy()).unwrap_err();
        assert!(err.contains("inside"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }
}
