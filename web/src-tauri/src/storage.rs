//! Library folders, drives, and moving games between them.
//!
//! A library folder is somewhere games are installed, one folder per drive if
//! you like. Orbit owns the games that sit directly inside one of them and
//! reports what each takes, so a full drive is explained rather than guessed
//! at. A game added from somewhere else is listed but never moved or deleted:
//! Orbit did not put it there.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Total and free bytes on the drive holding `path`.
///
/// Walks up to the nearest existing parent, so a folder that does not exist
/// yet still reports the drive it would be created on.
pub fn disk_space(path: &Path) -> Option<(u64, u64)> {
    let mut p = path.to_path_buf();
    while !p.exists() {
        p = p.parent()?.to_path_buf();
    }
    disk_space_of(&p)
}

/// Folder sizes that have already been measured.
///
/// Walking a game folder means reading every file in it, which on a spinning
/// drive is seconds, not milliseconds. Doing that when the app starts and again
/// every time a page is opened made both feel broken, so a size is measured once
/// and remembered until somebody asks for it to be measured again.
///
/// The lock is only held while reading or writing the map, never while walking
/// the disk, so a slow folder cannot block a request for a size that is already
/// known.
#[derive(Clone, Default)]
pub struct SizeCache {
    sizes: Arc<Mutex<HashMap<String, u64>>>,
}

impl SizeCache {
    /// What is known about one folder, if anything.
    pub fn get(&self, path: &str) -> Option<u64> {
        self.sizes.lock().ok()?.get(&key(path)).copied()
    }

    /// Everything measured so far, for a page that wants it all at once.
    ///
    /// A path may appear twice, once as it was given and once normalized. That
    /// is deliberate: the map is a cache, not a list, and a caller looks up the
    /// string it knows.
    pub fn snapshot(&self) -> HashMap<String, u64> {
        self.sizes.lock().map(|m| m.clone()).unwrap_or_default()
    }

    /// Measure whatever is not known yet, and return everything asked for.
    ///
    /// Folders already measured are not walked again: this is the call the
    /// Storage page makes on open, and it should be instant when nothing has
    /// changed.
    pub fn measure(&self, paths: &[String]) -> HashMap<String, u64> {
        let mut out = HashMap::new();
        for path in paths {
            if let Some(size) = self.get(path) {
                out.insert(path.clone(), size);
                continue;
            }
            let size = dir_size(Path::new(path));
            if let Ok(mut map) = self.sizes.lock() {
                // Kept under both spellings: the normalized one so a lookup
                // never misses because of case or a trailing slash, and the one
                // it arrived as so the front end can look up the exact string it
                // stored in its settings.
                map.insert(key(path), size);
                map.insert(path.clone(), size);
            }
            out.insert(path.clone(), size);
        }
        out
    }

    /// Forget everything, so the next measurement is a fresh walk of the disk.
    pub fn clear(&self) {
        if let Ok(mut map) = self.sizes.lock() {
            map.clear();
        }
    }
}

/// Paths are compared case-insensitively and without a trailing slash, because
/// Windows treats `D:\Games` and `d:\games\` as the same folder and the front
/// end may hand over either.
fn key(path: &str) -> String {
    path.trim_end_matches(['\\', '/']).to_lowercase()
}

#[cfg(windows)]
fn disk_space_of(path: &Path) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let (mut free_to_caller, mut total, mut free) = (0u64, 0u64, 0u64);
    // SAFETY: `wide` is NUL-terminated and the three out-pointers are live u64s.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide.as_ptr()),
            Some(&mut free_to_caller),
            Some(&mut total),
            Some(&mut free),
        )
    };
    ok.is_ok().then_some((total, free_to_caller))
}

#[cfg(not(windows))]
fn disk_space_of(_path: &Path) -> Option<(u64, u64)> {
    None
}

/// Every mounted drive, as `C:`-style names plus how much room is left.
///
/// `GetLogicalDrives` can report removable slots that are empty, so anything
/// without a root or without a readable size is dropped rather than shown as a
/// drive with an unknown size.
pub fn list_drives() -> Vec<DriveInfo> {
    #[cfg(windows)]
    {
        use windows::Win32::Storage::FileSystem::GetLogicalDrives;

        // SAFETY: the call takes no arguments and only writes to its own return
        // value, which is a plain bitmask.
        let mask = unsafe { GetLogicalDrives() };
        let mut out = Vec::new();
        for i in 0..26u32 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let letter = (b'A' + i as u8) as char;
            let root = format!("{letter}:\\");
            let path = PathBuf::from(&root);
            if !path.is_dir() {
                continue;
            }
            let (total, free) = disk_space(&path).unwrap_or((0, 0));
            out.push(DriveInfo {
                drive: format!("{letter}:"),
                label: volume_label(&path).unwrap_or_default(),
                root,
                total,
                free,
            });
        }
        out
    }
    #[cfg(not(windows))]
    Vec::new()
}

#[cfg(windows)]
fn volume_label(path: &Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumeInformationW;

    let root: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut label = [0u16; 261];
    let mut serial = 0u32;
    let mut max_component = 0u32;
    let mut flags = 0u32;
    // SAFETY: every buffer is either a live slice or a live out-pointer, and the
    // root path is NUL-terminated.
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(root.as_ptr()),
            Some(&mut label[..]),
            Some(&mut serial),
            Some(&mut max_component),
            Some(&mut flags),
            // The filesystem name is not needed to label a drive.
            None,
        )
    };
    if ok.is_err() {
        return None;
    }
    let text = String::from_utf16_lossy(&label[..label.iter().position(|c| *c == 0).unwrap_or(0)]);
    (!text.is_empty()).then_some(text)
}

/// The drive a path is on, as a player would name it: `C:`.
pub fn drive_of(path: &Path) -> String {
    if let Some(Component::Prefix(prefix)) = path.components().next() {
        return prefix
            .as_os_str()
            .to_string_lossy()
            .trim_end_matches('\\')
            .to_uppercase();
    }
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .chars()
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

/// Drop the `\\?\` prefix `canonicalize` adds on Windows.
///
/// That is how the OS spells a resolved path, not something a player
/// recognises, so it should never reach a label or the library.
pub fn tidy(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(rest) = path.to_str().and_then(|s| s.strip_prefix(r"\\?\UNC\")) {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = path.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
            return PathBuf::from(rest);
        }
    }
    path
}

/// The game's own folder inside whichever library folder holds it.
///
/// For `D:\Games\Hades\bin\Hades.exe` with `D:\Games` as a library folder that
/// is `D:\Games\Hades`. A library folder that is itself a game folder, such as
/// one that holds only app files, has nothing below it to take; that game stays
/// unlisted rather than having the whole folder treated as its install dir.
/// `None` when the game is not inside one of the folders: it was added from
/// elsewhere, so it is not ours to move.
pub fn game_folder(folders: &[String], install_dir: &Path) -> Option<PathBuf> {
    let dir = install_dir.canonicalize().ok()?;
    for f in folders {
        let Ok(root) = PathBuf::from(f).canonicalize() else {
            continue;
        };
        let Ok(rest) = dir.strip_prefix(&root) else {
            continue;
        };
        match rest.components().next() {
            Some(Component::Normal(name)) => return Some(tidy(root.join(name))),
            // Nothing usable below the root. Try the next folder rather than
            // giving up on the whole search.
            _ => continue,
        }
    }
    None
}

/// Total bytes of everything under `dir`, skipping anything unreadable.
pub fn dir_size(dir: &Path) -> u64 {
    fn walk(dir: &Path, acc: &mut u64) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            // `file_type` does not follow links. `metadata` would, so a game
            // folder containing a junction back to its own parent could send
            // this walk round in circles, or count the same files twice.
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                walk(&entry.path(), acc);
            } else if kind.is_file() {
                if let Ok(m) = entry.metadata() {
                    *acc += m.len();
                }
            }
        }
    }
    let mut total = 0;
    walk(dir, &mut total);
    total
}

/// Do two paths point at the same place?
pub fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        // A folder that does not exist yet can only be compared as written.
        _ => a == b,
    }
}

/// Copy a folder tree, calling `progress` with the bytes of each file copied.
///
/// A failure part-way leaves the destination behind; the caller removes it so
/// the original is never disturbed by a half-finished copy.
pub fn copy_tree(from: &Path, to: &Path, progress: &mut dyn FnMut(u64)) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&entry.path(), &target, progress)?;
        } else if kind.is_file() {
            let n = std::fs::copy(entry.path(), &target)?;
            progress(n);
        }
        // Symlinks and anything exotic are skipped rather than followed, so a
        // stray link cannot turn into a duplicate of something enormous.
    }
    Ok(())
}

/// What a finished move leaves behind.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    /// The folder to store on the game, already adjusted for the new location.
    pub install_dir: String,
    /// Set when something still needs the player's attention.
    pub message: Option<String>,
}

/// Move a game between library folders.
///
/// On one drive this is a rename and is instant. Across drives the folder is
/// copied and then the original removed, with `on_progress` called as bytes
/// land. The game's launch settings and playtime are untouched: only where the
/// files are changes.
pub fn move_game(
    install_dir: &Path,
    folders: &[String],
    to: &str,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<Moved, String> {
    if !folders
        .iter()
        .any(|f| same_path(Path::new(f), Path::new(to)))
    {
        return Err(format!("{to} is not one of your library folders."));
    }
    let from = game_folder(folders, install_dir).ok_or_else(|| {
        "This game is outside your library folders, so Orbit does not move it. Move it \
         yourself, then point Orbit at the new place."
            .to_string()
    })?;

    let target_root = PathBuf::from(to);
    std::fs::create_dir_all(&target_root)
        .map_err(|e| format!("Could not use {}: {e}", target_root.display()))?;

    if from.parent().is_some_and(|p| same_path(p, &target_root)) {
        return Err("It is already in that folder.".into());
    }

    let name = from
        .file_name()
        .ok_or_else(|| "That game folder has no name.".to_string())?;
    let dest = target_root.join(name);
    if dest.exists() {
        return Err(format!(
            "{} already exists. Rename or remove it first.",
            dest.display()
        ));
    }

    let total = dir_size(&from);
    // Only worth refusing across drives: a rename needs no extra room.
    if drive_of(&target_root) != drive_of(&from) {
        if let Some((_, free)) = disk_space(&target_root) {
            if free < total {
                return Err(format!(
                    "Not enough space on {}: it needs {} but has {} free.",
                    drive_of(&target_root),
                    crate::format::bytes(total),
                    crate::format::bytes(free)
                ));
            }
        }
    }

    log::info!("moving game from {} to {}", from.display(), dest.display());

    // The part of the stored folder below the game's own folder survives the
    // move, so `...\Hades\bin` stays `...\Hades\bin` on the other drive.
    let new_dir = moved_install_dir(install_dir, &from, &dest);

    // Same drive: a rename, done at once.
    if std::fs::rename(&from, &dest).is_ok() {
        on_progress(total, total);
        return Ok(Moved {
            install_dir: new_dir.to_string_lossy().to_string(),
            message: None,
        });
    }

    let mut copied = 0u64;
    let copy = copy_tree(&from, &dest, &mut |n| {
        copied += n;
        on_progress(copied, total);
    });
    if let Err(e) = copy {
        // Nothing was moved, so the original stays exactly as it was.
        let _ = std::fs::remove_dir_all(&dest);
        return Err(format!("Copying failed, nothing was moved: {e}"));
    }

    // The copy is complete, so the game now lives at the new place whatever
    // happens next. A file in the old folder can still be held open for a
    // moment (antivirus scanning it, a launcher that has not quit: the Windows
    // "file in use" error), so the removal is retried before giving up.
    let mut last: Option<std::io::Error> = None;
    for wait in [0u64, 1, 3, 6] {
        std::thread::sleep(std::time::Duration::from_secs(wait));
        match std::fs::remove_dir_all(&from) {
            Ok(()) => {
                return Ok(Moved {
                    install_dir: new_dir.to_string_lossy().to_string(),
                    message: None,
                })
            }
            // Someone else got there first, which is as good as deleting it.
            Err(_) if !from.exists() => {
                return Ok(Moved {
                    install_dir: new_dir.to_string_lossy().to_string(),
                    message: None,
                })
            }
            Err(e) => last = Some(e),
        }
    }

    // Leaving the library pointing at a copy we were about to stop using would
    // be worse than leaving the old folder for the player to delete.
    Ok(Moved {
        install_dir: new_dir.to_string_lossy().to_string(),
        message: Some(format!(
            "Moved. The old folder {} could not be removed ({}): something still has a file \
             in it open. Delete it yourself once that is closed.",
            from.display(),
            last.map(|e| e.to_string()).unwrap_or_default()
        )),
    })
}

/// The new `install_dir` for a game after its folder moved to `dest`.
///
/// The stored folder may be somewhere inside the game's own folder (the `bin`
/// of an install, say), so the part below the game folder is preserved.
pub fn moved_install_dir(install_dir: &Path, from: &Path, dest: &Path) -> PathBuf {
    // As written first, so this also works for paths that no longer exist, then
    // the resolved forms for when the two spellings differ.
    let rest = install_dir
        .strip_prefix(from)
        .ok()
        .map(Path::to_path_buf)
        .or_else(|| {
            let real = install_dir.canonicalize().ok()?;
            let from = from.canonicalize().ok()?;
            real.strip_prefix(from).ok().map(Path::to_path_buf)
        })
        .unwrap_or_default();
    if rest.as_os_str().is_empty() {
        dest.to_path_buf()
    } else {
        dest.join(rest)
    }
}

/// A drive Orbit can put games on.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub drive: String,
    pub label: String,
    pub root: String,
    pub total: u64,
    pub free: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("orbit-tauri-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn a_game_folder_is_the_first_folder_under_the_library() {
        let root = temp("game-folder");
        let deep = root.join("Hades").join("bin");
        std::fs::create_dir_all(&deep).unwrap();
        let folders = vec![root.to_string_lossy().to_string()];

        let found = game_folder(&folders, &deep).expect("inside the library");
        assert!(same_path(&found, &root.join("Hades")));
    }

    #[test]
    fn a_game_outside_the_library_is_not_ours_to_move() {
        let root = temp("outside");
        let elsewhere = temp("outside-other");
        std::fs::create_dir_all(elsewhere.join("Elsewhere")).unwrap();
        let folders = vec![root.to_string_lossy().to_string()];

        assert!(game_folder(&folders, &elsewhere.join("Elsewhere")).is_none());
    }

    #[test]
    fn a_move_to_an_unknown_folder_is_refused() {
        let root = temp("move-refused");
        let deep = root.join("Game").join("bin");
        std::fs::create_dir_all(&deep).unwrap();
        let folders = vec![root.to_string_lossy().to_string()];

        let err = move_game(&deep, &folders, "Q:\\Games", &mut |_, _| {}).unwrap_err();
        assert!(err.contains("not one of your library folders"), "{err}");
    }

    #[test]
    fn a_move_keeps_the_path_below_the_game_folder() {
        let from = PathBuf::from(r"D:\Games\Hades");
        let dest = PathBuf::from(r"E:\Games\Hades");
        assert_eq!(
            moved_install_dir(Path::new(r"D:\Games\Hades\bin"), &from, &dest),
            PathBuf::from(r"E:\Games\Hades\bin")
        );
        assert_eq!(
            moved_install_dir(&from, &from, &dest),
            PathBuf::from(r"E:\Games\Hades")
        );
    }

    #[test]
    fn a_copy_then_delete_moves_the_files() {
        let root = temp("copy-move");
        let from = root.join("lib").join("Game");
        let other = root.join("lib2").join("Game");
        std::fs::create_dir_all(from.join("data")).unwrap();
        std::fs::write(from.join("data").join("save.dat"), b"progress").unwrap();
        let folders = vec![
            root.join("lib").to_string_lossy().to_string(),
            root.join("lib2").to_string_lossy().to_string(),
        ];

        let mut last = (0u64, 0u64);
        let moved = move_game(
            &from,
            &folders,
            &root.join("lib2").to_string_lossy(),
            &mut |c, t| {
                last = (c, t);
            },
        )
        .expect("move succeeds");

        assert_eq!(last.0, last.1, "progress finished at the total");
        assert!(!from.exists(), "the original is gone");
        assert_eq!(
            std::fs::read(other.join("data").join("save.dat")).unwrap(),
            b"progress"
        );
        assert_eq!(moved.install_dir, other.to_string_lossy());
        assert!(moved.message.is_none());
    }
    #[test]
    fn a_folder_is_only_walked_once() {
        let dir = std::env::temp_dir().join("orbit-size-cache");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.bin"), vec![0u8; 2048]).unwrap();

        let cache = SizeCache::default();
        let path = dir.to_string_lossy().to_string();
        let first = cache.measure(&[path.clone()]);
        assert_eq!(first.get(&path), Some(&2048));
        // Both the exact spelling and the normalized one are looked up fine.
        assert_eq!(cache.get(&path), Some(2048));
        assert_eq!(cache.get(&path.to_uppercase()), Some(2048));

        // A second file appears, but the answer is remembered rather than
        // re-walked, which is the whole point of the cache.
        std::fs::write(dir.join("b.bin"), vec![0u8; 2048]).unwrap();
        let second = cache.measure(&[path.clone()]);
        assert_eq!(second.get(&path), Some(&2048));

        // Clearing makes the next ask see both files.
        cache.clear();
        let third = cache.measure(&[path.clone()]);
        assert_eq!(third.get(&path), Some(&4096));

        // A trailing slash is the same folder as far as Windows cares, so it
        // must be the same key here: two ways of writing one path should not
        // each cost their own walk of the disk.
        assert_eq!(cache.get(&format!("{path}\\")), Some(4096));
        assert_eq!(cache.get(&path.to_uppercase()), Some(4096));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
