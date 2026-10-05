//! Library folders, drives, and moving games between them.
//!
//! A library folder is somewhere games are installed, one folder per drive if
//! you like. Orbit owns the games that sit directly inside one of them and
//! reports what each takes, so a full drive is explained rather than guessed
//! at. A game added from somewhere else is listed but never moved or deleted:
//! Orbit did not put it there.

use std::path::{Component, Path, PathBuf};

use crate::error::{Error, Result};
use crate::models::{Game, PlaytimeSummary};

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
    // Orb currently ships Windows-only; other platforms report no drive figures
    // rather than guessing through a shell command.
    None
}

/// The drive a path is on, as a player would name it: `C:`, or the mount point
/// on systems that have drives instead.
pub fn drive_of(path: &Path) -> String {
    if let Some(Component::Prefix(prefix)) = path.components().next() {
        return prefix
            .as_os_str()
            .to_string_lossy()
            .trim_end_matches('\\')
            .to_uppercase();
    }
    let full = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
    mounts
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        // /proc/mounts escapes a space in a path as \040.
        .map(|m| m.replace("\\040", " "))
        .filter(|m| full.starts_with(m))
        .max_by_key(|m| m.len())
        .unwrap_or_else(|| "/".into())
}

/// Drop the `\\?\` prefix `canonicalize` adds on Windows.
///
/// That is how the OS spells a resolved path, not something a player
/// recognises, so it should never reach a label or the database.
fn tidy(path: PathBuf) -> PathBuf {
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
            match entry.metadata() {
                Ok(m) if m.is_dir() => walk(&entry.path(), acc),
                Ok(m) => *acc += m.len(),
                Err(_) => {}
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

/// A game as the storage page sees it.
#[derive(Clone)]
pub struct StoredGame {
    pub game: Game,
    pub summary: PlaytimeSummary,
    /// The game folder, which is what gets moved.
    pub folder: PathBuf,
    /// What that folder takes on disk.
    pub bytes: u64,
}

/// One library folder and what is installed in it.
#[derive(Clone)]
pub struct LibraryFolder {
    pub path: PathBuf,
    pub drive: String,
    pub is_default: bool,
    pub exists: bool,
    pub total: u64,
    pub free: u64,
    pub games_bytes: u64,
    pub games: Vec<StoredGame>,
}

/// Everything the storage page needs in one pass.
pub struct StorageOverview {
    pub folders: Vec<LibraryFolder>,
    /// Games installed outside every library folder.
    pub elsewhere: Vec<StoredGame>,
    /// Bytes those other games take.
    pub elsewhere_bytes: u64,
}

impl StorageOverview {
    /// Every game shown, across folders and elsewhere.
    pub fn game_count(&self) -> usize {
        self.folders.iter().map(|f| f.games.len()).sum::<usize>() + self.elsewhere.len()
    }

    /// Bytes in managed folders plus those elsewhere.
    pub fn total_bytes(&self) -> u64 {
        self.folders.iter().map(|f| f.games_bytes).sum::<u64>() + self.elsewhere_bytes
    }
}

/// Group the library by folder. `folders` is ordered, and the first one is the
/// default new installs go to.
pub fn overview(
    folders: &[String],
    default_folder: Option<&str>,
    games: &[(Game, PlaytimeSummary)],
) -> StorageOverview {
    // `game_folder` matches against resolved paths, so grouping has to as well,
    // otherwise a folder spelled with different casing or through a junction would
    // quietly land every game in the first entry.
    let roots: Vec<Option<PathBuf>> = folders
        .iter()
        .map(|f| std::fs::canonicalize(f).ok().map(tidy))
        .collect();

    let mut out: Vec<LibraryFolder> = folders
        .iter()
        .map(|f| {
            let path = PathBuf::from(f);
            let (total, free) = disk_space(&path).unwrap_or((0, 0));
            LibraryFolder {
                drive: drive_of(&path),
                is_default: default_folder.is_some_and(|d| same_path(Path::new(d), &path)),
                exists: path.is_dir(),
                path,
                total,
                free,
                games_bytes: 0,
                games: Vec::new(),
            }
        })
        .collect();

    let mut elsewhere = Vec::new();
    for (game, summary) in games {
        let folder = game
            .install_dir
            .as_deref()
            .and_then(|d| game_folder(folders, d));
        match folder {
            Some(dir) => {
                let idx = roots
                    .iter()
                    .position(|r| r.as_ref().is_some_and(|root| dir.starts_with(root)));
                match idx.and_then(|i| out.get_mut(i)) {
                    Some(slot) => {
                        let item = stored(game.clone(), summary.clone(), dir);
                        slot.games_bytes += item.bytes;
                        slot.games.push(item);
                    }
                    None => elsewhere.push(stored(
                        game.clone(),
                        summary.clone(),
                        game.install_dir.clone().unwrap_or_default(),
                    )),
                }
            }
            // No folder at all: still worth showing, just not ours to move.
            None => elsewhere.push(stored(
                game.clone(),
                summary.clone(),
                game.install_dir.clone().unwrap_or_default(),
            )),
        }
    }

    for f in &mut out {
        f.games.sort_by_key(|g| std::cmp::Reverse(g.bytes));
    }
    elsewhere.sort_by_key(|g| std::cmp::Reverse(g.bytes));

    let elsewhere_bytes = elsewhere.iter().map(|g| g.bytes).sum();
    StorageOverview {
        folders: out,
        elsewhere,
        elsewhere_bytes,
    }
}

fn stored(game: Game, summary: PlaytimeSummary, folder: PathBuf) -> StoredGame {
    let bytes = if folder.as_os_str().is_empty() {
        0
    } else {
        dir_size(&folder)
    };
    StoredGame {
        game,
        summary,
        folder,
        bytes,
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

/// Where a game would land when moved to `to`.
fn destination(from: &Path, to: &Path) -> Result<PathBuf> {
    let name = from
        .file_name()
        .ok_or_else(|| Error::Launch("That game folder has no name.".into()))?;
    Ok(to.join(name))
}

/// What a finished move leaves behind: the folder to store on the game, and a
/// note when something needs the player's attention.
#[derive(Debug, Clone)]
pub struct Moved {
    pub install_dir: PathBuf,
    pub message: Option<String>,
}

/// A move that finished with the old folder gone.
fn moved_cleanly(install_dir: PathBuf) -> Moved {
    Moved {
        install_dir,
        message: None,
    }
}

/// Move a game between library folders.
///
/// On one drive this is a rename and is instant. Across drives the folder is
/// copied and then the original removed, with `on_progress` called as bytes
/// land. The game's launch settings and playtime are untouched: only where the
/// files are changes.
pub fn move_game(
    game: &Game,
    folders: &[String],
    to: &str,
    on_progress: &mut dyn FnMut(u64),
) -> Result<Moved> {
    let install_dir = game.install_dir.as_deref().ok_or_else(|| {
        Error::NotFound("This game has no folder, so there is nothing to move.".into())
    })?;
    if !folders
        .iter()
        .any(|f| same_path(Path::new(f), Path::new(to)))
    {
        return Err(Error::NotFound(format!(
            "{to} is not one of your library folders."
        )));
    }
    let from = game_folder(folders, install_dir).ok_or_else(|| {
        Error::NotFound("This game is outside your library folders, so Orbit does not move it. Move it yourself, then point the editor at the new place.".into())
    })?;

    let target_root = PathBuf::from(to);
    std::fs::create_dir_all(&target_root)
        .map_err(|e| Error::Launch(format!("Could not use {}: {e}", target_root.display())))?;

    if from.parent().is_some_and(|p| same_path(p, &target_root)) {
        return Err(Error::Launch("It is already in that folder.".into()));
    }

    let dest = destination(&from, &target_root)?;
    if dest.exists() {
        return Err(Error::Launch(format!(
            "{} already exists. Rename or remove it first.",
            dest.display()
        )));
    }

    let total = dir_size(&from);
    // Only worth refusing across drives: a rename needs no extra room.
    if drive_of(&target_root) != drive_of(&from) {
        if let Some((_, free)) = disk_space(&target_root) {
            if free < total {
                return Err(Error::Launch(format!(
                    "Not enough space: {} needs {}, and {} has {} free.",
                    game.name,
                    crate::format::bytes(total),
                    drive_of(&target_root),
                    crate::format::bytes(free)
                )));
            }
        }
    }

    tracing::info!(
        game = %game.name,
        from = %from.display(),
        to = %dest.display(),
        "moving game between library folders"
    );

    // The part of the stored folder below the game's own folder survives the
    // move, so `...\Hades\bin` stays `...\Hades\bin` on the other drive.
    let new_dir = moved_install_dir(install_dir, &from, &dest);

    // Same drive: a rename, done at once.
    if std::fs::rename(&from, &dest).is_ok() {
        on_progress(total);
        return Ok(moved_cleanly(new_dir));
    }

    let mut copied = 0u64;
    let copy = copy_tree(&from, &dest, &mut |n| {
        copied += n;
        on_progress(n);
    });
    if let Err(e) = copy {
        // Nothing was moved, so the original stays exactly as it was.
        let _ = std::fs::remove_dir_all(&dest);
        return Err(Error::Launch(format!(
            "Copying failed, nothing was moved: {e}"
        )));
    }

    // The copy is complete, so the game now lives at the new place whatever
    // happens next. A file in the old folder can still be held open for a
    // moment (antivirus scanning it, a launcher that has not quit: the Windows
    // "file in use" error), so the removal is retried before giving up.
    let mut last: Option<std::io::Error> = None;
    for wait in [0u64, 1, 3, 6] {
        std::thread::sleep(std::time::Duration::from_secs(wait));
        match std::fs::remove_dir_all(&from) {
            Ok(()) => return Ok(moved_cleanly(new_dir)),
            // Someone else got there first, which is as good as deleting it.
            Err(_) if !from.exists() => return Ok(moved_cleanly(new_dir)),
            Err(e) => last = Some(e),
        }
    }

    // Leaving the library pointing at a copy we were about to stop using would
    // be worse than leaving the old folder for the player to delete.
    Ok(Moved {
        install_dir: new_dir,
        message: Some(format!(
            "Moved. The old folder {} could not be removed ({}): something still has a file in it open. Delete it yourself once that is closed.",
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("orbit-test-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn a_game_folder_is_the_first_folder_under_the_library() {
        let root = temp("game-folder");
        let deep = root.join("Hades").join("bin");
        std::fs::create_dir_all(&deep).unwrap();
        let folders = vec![root.to_string_lossy().into_owned()];

        let found = game_folder(&folders, &deep).unwrap();
        assert_eq!(found, root.join("Hades"));
        assert!(
            !found.to_string_lossy().starts_with(r"\\?\"),
            "a path shown to the player has no verbatim prefix: {found:?}"
        );

        // The library folder itself is never a game's folder.
        assert!(game_folder(&folders, &root).is_none());
        assert!(game_folder(&folders, &std::env::temp_dir()).is_none());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_drive_has_a_size() {
        let (total, free) = disk_space(&std::env::temp_dir()).expect("temp dir has a drive");
        assert!(total > 0);
        assert!(free <= total);
    }

    #[test]
    fn a_missing_folder_reports_the_drive_it_would_be_created_on() {
        let missing = std::env::temp_dir()
            .join("orbit-not-made-yet")
            .join("deeper");
        let (total, free) = disk_space(&missing).expect("walks up to an existing parent");
        assert!(total > 0 && free <= total);
    }

    #[test]
    fn dir_size_adds_up_the_tree() {
        let root = temp("dir-size");
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::write(root.join("a").join("one.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(root.join("two.bin"), vec![0u8; 50]).unwrap();
        assert_eq!(dir_size(&root), 150);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_move_keeps_the_folder_below_the_game_root() {
        let from = PathBuf::from(r"D:\Games\Hades");
        let dest = PathBuf::from(r"E:\Library\Hades");
        assert_eq!(
            moved_install_dir(Path::new(r"D:\Games\Hades\bin"), &from, &dest),
            PathBuf::from(r"E:\Library\Hades\bin")
        );
        // Nothing below the root means the folder itself is the new location.
        assert_eq!(
            moved_install_dir(Path::new(r"D:\Games\Hades"), &from, &dest),
            PathBuf::from(r"E:\Library\Hades")
        );
    }

    #[test]
    fn moving_a_game_relocates_its_files() {
        let root = temp("move");
        let from_root = root.join("Library");
        let to_root = root.join("Other");
        let install = from_root.join("Hades").join("bin");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::write(install.join("Hades.exe"), vec![7u8; 32]).unwrap();

        let folders = vec![
            from_root.to_string_lossy().into_owned(),
            to_root.to_string_lossy().into_owned(),
        ];
        let mut game = Game::new("Hades");
        game.install_dir = Some(install.clone());

        let mut copied = 0;
        let moved = move_game(&game, &folders, &to_root.to_string_lossy(), &mut |n| {
            copied += n
        })
        .expect("move succeeds");

        assert!(
            moved.message.is_none(),
            "nothing left behind: {:?}",
            moved.message
        );
        assert!(!from_root.join("Hades").exists(), "old folder is gone");
        assert!(to_root.join("Hades").join("bin").join("Hades.exe").exists());

        // The stored folder keeps its place inside the game, so a launch path
        // that pointed into the install still points at the executable.
        assert_eq!(moved.install_dir, to_root.join("Hades").join("bin"));
        assert!(copied > 0);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_move_refuses_a_folder_that_is_not_ours() {
        let root = temp("move-guard");
        let install = root.join("Elsewhere").join("Game");
        std::fs::create_dir_all(&install).unwrap();
        let library = root.join("Library");
        std::fs::create_dir_all(&library).unwrap();

        let folders = vec![library.to_string_lossy().into_owned()];
        let mut game = Game::new("Game");
        game.install_dir = Some(install);

        let err = move_game(
            &game,
            &folders,
            &root.join("Other").to_string_lossy(),
            &mut |_| {},
        )
        .expect_err("refuses a destination that is not a library folder");
        assert!(err.to_string().contains("not one of your library folders"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn overview_groups_games_by_folder() {
        let root = temp("overview");
        let here = root.join("Library").join("One");
        let there = root.join("Library").join("Two");
        let elsewhere = root.join("Documents").join("Three");
        for d in [&here, &there, &elsewhere] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::write(d.join("f.bin"), vec![0u8; 10]).unwrap();
        }

        let folders = vec![root.join("Library").to_string_lossy().into_owned()];
        let mut games = Vec::new();
        for (name, dir) in [("One", &here), ("Two", &there), ("Three", &elsewhere)] {
            let mut g = Game::new(name);
            g.install_dir = Some(dir.clone());
            games.push((g, PlaytimeSummary::default()));
        }

        let ov = overview(&folders, Some(&folders[0]), &games);
        assert_eq!(ov.folders.len(), 1);
        assert_eq!(ov.folders[0].games.len(), 2, "only managed games");
        assert_eq!(ov.folders[0].games_bytes, 20);
        assert_eq!(ov.elsewhere.len(), 1);
        assert_eq!(ov.game_count(), 3);
        assert_eq!(ov.total_bytes(), 30);

        let _ = std::fs::remove_dir_all(root);
    }

    /// Two folders whose spelling differs only by case must not end up with
    /// every game filed under the first of them.
    /// Two sibling folders must not file every game under the first of them,
    /// even when one of them is spelled differently to how the disk reports it.
    #[test]
    fn overview_sorts_a_game_under_the_folder_that_actually_holds_it() {
        let root = temp("overview-order");
        let one = root.join("Library").join("One");
        let two = root.join("Library").join("Two");
        for d in [&one, &two] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::write(d.join("f.bin"), vec![0u8; 10]).unwrap();
        }
        let lib = root.join("Library");

        let folders = vec![
            lib.to_string_lossy().into_owned(),
            lib.to_string_lossy().to_uppercase(),
        ];
        let mut games = Vec::new();
        for (name, dir) in [("One", &one), ("Two", &two)] {
            let mut g = Game::new(name);
            g.install_dir = Some(dir.clone());
            games.push((g, PlaytimeSummary::default()));
        }

        let ov = overview(&folders, Some(&folders[0]), &games);
        assert_eq!(ov.elsewhere.len(), 0, "both are inside a library folder");
        assert_eq!(ov.folders[0].games.len(), 2);
        assert_eq!(ov.folders[0].games_bytes, 20);

        let _ = std::fs::remove_dir_all(root);
    }

    /// A folder that matches without leaving anything below it must not end the
    /// search, or every later folder is ignored and its games look like
    /// outsiders.
    #[test]
    fn a_folder_with_nothing_under_it_does_not_hide_the_rest() {
        let root = temp("skip-root");
        let lib = root.join("Library");
        let game_dir = lib.join("Game");
        let install = game_dir.join("bin");
        std::fs::create_dir_all(&install).unwrap();
        let loose = root.join("Loose");
        std::fs::create_dir_all(&loose).unwrap();

        let folders = vec![
            loose.to_string_lossy().into_owned(),
            install.to_string_lossy().into_owned(),
            lib.to_string_lossy().to_uppercase(),
        ];

        let found = game_folder(&folders, &install).expect("the folder after it gets a look-in");
        assert!(
            same_path(&found, &game_dir),
            "got {found:?} want {game_dir:?}"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_move_needs_a_destination() {
        let root = temp("move-empty-dest");
        let install = root.join("Library").join("Game");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::write(install.join("f.bin"), vec![0u8; 4]).unwrap();

        let folders = vec![root.join("Library").to_string_lossy().into_owned()];
        let mut game = Game::new("Game");
        game.install_dir = Some(install);

        let err =
            move_game(&game, &folders, "", &mut |_| {}).expect_err("refuses an empty destination");
        assert!(err.to_string().contains("not one of your library folders"));

        let _ = std::fs::remove_dir_all(root);
    }

    /// Moving a game to the folder it already sits in would either rename a
    /// directory onto itself or copy it over itself.
    #[test]
    fn a_move_refuses_the_folder_the_game_is_already_in() {
        let root = temp("move-same-folder");
        let install = root.join("Library").join("Game");
        std::fs::create_dir_all(&install).unwrap();
        std::fs::write(install.join("f.bin"), vec![0u8; 4]).unwrap();

        let folders = vec![root.join("Library").to_string_lossy().into_owned()];
        let mut game = Game::new("Game");
        game.install_dir = Some(install);

        let err = move_game(&game, &folders, &folders[0], &mut |_| {})
            .expect_err("refuses the folder it is already in");
        assert!(
            err.to_string().contains("already in that folder"),
            "got: {err}"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    /// The whole path a player walks: pick folders, add games, read them back,
    /// and see the split between managed and not ours. A move then has to put
    /// the game under the other folder with its install dir to match.
    #[test]
    fn a_game_survives_the_trip_from_disk_to_the_storage_page_and_back() {
        let root = temp("end-to-end");
        let lib_a = root.join("libA");
        let lib_b = root.join("libB");
        let hades = lib_a.join("Hades").join("bin");
        let celeste = lib_b.join("Celeste");
        let stray = root.join("Downloads").join("Stardew");
        for d in [&hades, &celeste, &stray] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::write(d.join("game.bin"), vec![0u8; 100]).unwrap();
        }
        let folders = vec![
            lib_a.to_string_lossy().into_owned(),
            lib_b.to_string_lossy().into_owned(),
        ];

        let lib = crate::db::Library::open_in_memory().unwrap();
        for (name, dir) in [
            ("Hades", hades.clone()),
            ("Celeste", celeste.clone()),
            ("Stardew", stray.clone()),
        ] {
            let mut g = Game::new(name);
            g.install_dir = Some(dir);
            lib.insert_game(&g).unwrap();
        }

        let games = lib.list_games().unwrap();
        assert_eq!(games.len(), 3, "three games read back out of the database");
        assert!(
            games
                .iter()
                .all(|(g, _)| g.id > 0 && g.install_dir.is_some()),
            "ids are assigned and install_dir survived the write"
        );

        let ov = overview(&folders, Some(&folders[0]), &games);
        assert_eq!(ov.folders.len(), 2);
        assert_eq!(ov.folders[0].games.len(), 1);
        assert_eq!(ov.folders[0].games[0].game.name, "Hades");
        assert_eq!(ov.folders[1].games.len(), 1);
        assert_eq!(ov.folders[1].games[0].game.name, "Celeste");
        assert_eq!(ov.elsewhere.len(), 1);
        assert_eq!(ov.elsewhere[0].game.name, "Stardew");
        assert!(ov.folders[0].is_default);
        assert_eq!(ov.total_bytes(), 300);

        // Move Hades to the other folder and read the result back out of the
        // database, the way the storage page does once the worker finishes.
        let hades_game = games
            .iter()
            .find(|(g, _)| g.name == "Hades")
            .map(|(g, _)| g.clone())
            .unwrap();
        let mut progress = 0;
        let moved = move_game(&hades_game, &folders, &folders[1], &mut |n| progress += n)
            .expect("moves to the other folder");
        assert_eq!(progress, 100, "progress is reported for the whole tree");

        let new_dir = moved.install_dir;
        assert!(
            moved.message.is_none(),
            "nothing left over: {:?}",
            moved.message
        );
        assert_eq!(
            new_dir,
            lib_b.join("Hades").join("bin"),
            "the folder below the game root is kept"
        );
        assert!(lib_b.join("Hades").join("bin").join("game.bin").is_file());
        assert!(!hades.exists(), "the old folder is gone");
        assert!(
            stray.exists(),
            "the game outside the library folders is untouched"
        );

        let mut updated = hades_game;
        updated.install_dir = Some(new_dir);
        lib.update_game(&updated).unwrap();
        let after = lib.list_games().unwrap();
        let after_ov = overview(&folders, Some(&folders[0]), &after);
        assert_eq!(after_ov.folders[0].games.len(), 0, "nothing left on libA");
        assert_eq!(after_ov.folders[1].games.len(), 2, "Celeste and Hades");
        assert_eq!(after_ov.elsewhere.len(), 1, "still just Stardew");
        assert_eq!(after_ov.total_bytes(), 300, "no bytes lost or invented");

        let _ = std::fs::remove_dir_all(root);
    }
}
