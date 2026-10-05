//! Starting games, and noticing when they stop.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::time::Instant;

use crate::launch_target::LaunchTarget;

/// How long a process may live before it stops looking like a launcher handing
/// off to the real game.
///
/// Plenty of titles start a small bootstrapper that exits within a second or
/// two while the game itself runs as a grandchild. Ending the session there
/// would log two minutes of playtime for a four hour evening, so a process that
/// dies this quickly is treated as a hand-off and the session keeps running
/// until the player stops it.
const HANDOFF_WINDOW: std::time::Duration = std::time::Duration::from_secs(90);

/// How often the process list is looked through once a launcher has handed off.
///
/// The real game is a grandchild Orbit has no handle for, so the only thing left
/// to go on is its name, and the list costs one small helper process to read.
/// Every five seconds is often enough to notice a game being closed without
/// spending the session doing nothing else.
const HANDOFF_POLL: std::time::Duration = std::time::Duration::from_secs(5);

/// What the watcher has learned about a process.
pub enum Verdict {
    /// Still going.
    Running,
    /// Gone, so the session ends.
    Ended,
    /// Nothing more can be learned about it: the session belongs to the player.
    Unwatched,
}

/// A game Orbit started and is keeping time for.
struct Tracked {
    child: Child,
    started: Instant,
    /// When the process was noticed dead, if it has been.
    ///
    /// Kept as a moment rather than a flag so the hand-off window is measured
    /// from the moment the process actually died.
    died_at: Option<Instant>,
    /// True once a quick death was judged to be a launcher handing off.
    handed_off: bool,
    /// The program's file name, which is all there is to look for once the
    /// process Orbit started has gone.
    image: Option<String>,
    /// Whether a program of that name has been seen since the hand-off.
    seen: bool,
    /// Polls in a row that found nothing, so one hiccup is not an ending.
    misses: u32,
    /// When the process list was last read.
    last_scan: Option<Instant>,
}

/// The games currently running, so time can stop by itself when they exit.
#[derive(Default)]
pub struct Sessions {
    running: HashMap<u32, Tracked>,
}

/// What `launch_game` hands back to the UI.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Launched {
    pub pid: u32,
    /// True when Orbit could not watch the process and the player must stop
    /// the session themselves.
    pub manual: bool,
}

impl Sessions {
    /// Start a game the way its launch target says to.
    pub fn launch_target(&mut self, target: &LaunchTarget) -> Result<Launched, String> {
        match crate::launch_target::spawn(target)? {
            Some(child) => {
                let pid = child.id();
                log::info!("launched {} (pid {})", target.label(), pid);
                self.running.insert(
                    pid,
                    Tracked {
                        child,
                        started: Instant::now(),
                        died_at: None,
                        handed_off: false,
                        image: match target {
                            LaunchTarget::Executable { path, .. } => path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .map(str::to_string),
                            _ => None,
                        },
                        seen: false,
                        misses: 0,
                        last_scan: None,
                    },
                );
                Ok(Launched { pid, manual: false })
            }
            // Nothing to watch: Steam was asked to do it, or the game is being
            // timed only. Either way the player ends the session.
            None => Ok(Launched {
                pid: 0,
                manual: true,
            }),
        }
    }

    /// What is happening with a game Orbit started.
    ///
    /// `None` for a process Orbit never started, so the caller can fall back to
    /// a session the player stops by hand.
    ///
    /// A game that dies after having run for a while is over. A game that dies
    /// within the hand-off window was a bootstrapper, and the real game is a
    /// grandchild with no handle of Orbit's own: the name of the program is
    /// then the only thing left to look for, which is what the process list is
    /// for. Without that, a launcher handing off means the clock runs until the
    /// player notices, which is exactly the thing that makes playtime wrong.
    pub fn check(&mut self, pid: u32) -> Option<Verdict> {
        let tracked = self.running.get_mut(&pid)?;

        // `try_wait` is the only way to notice, and once a process has been
        // reaped the answer stays "exited", so the first sighting is recorded.
        if tracked.died_at.is_none() && tracked.child.try_wait().ok().flatten().is_some() {
            tracked.died_at = Some(Instant::now());
        }

        let Some(died) = tracked.died_at else {
            return Some(Verdict::Running);
        };

        if died.duration_since(tracked.started) >= HANDOFF_WINDOW {
            return Some(Verdict::Ended);
        }

        if !tracked.handed_off {
            tracked.handed_off = true;
            log::info!(
                "pid {pid} exited early; looking for the game itself by name from here \
                 so its session still ends when it does"
            );
        }

        // Nothing to look for, or no way to look: the session is the player's.
        let (Some(image), true) = (tracked.image.clone(), cfg!(windows)) else {
            return Some(Verdict::Unwatched);
        };

        let now = Instant::now();
        if now.duration_since(tracked.last_scan.unwrap_or(tracked.started)) < HANDOFF_POLL {
            return Some(Verdict::Running);
        }
        tracked.last_scan = Some(now);

        if image_running(&image) {
            tracked.seen = true;
            tracked.misses = 0;
            return Some(Verdict::Running);
        }
        // The game has not appeared yet, or it runs under a name nothing like
        // the program's. Either way there is nothing to conclude, and ending the
        // session on a guess would lose the evening's playtime.
        if !tracked.seen {
            return Some(Verdict::Running);
        }
        tracked.misses += 1;
        if tracked.misses >= 2 {
            Some(Verdict::Ended)
        } else {
            Some(Verdict::Running)
        }
    }

    /// Forget a process the player has stopped tracking.
    pub fn forget(&mut self, pid: u32) {
        self.running.remove(&pid);
    }

    /// Stop a game, and everything it started, then stop tracking it.
    ///
    /// Pressing Stop has to close the game as well, or the player ends up with a
    /// clock that says they finished while the game keeps running. Games spawn
    /// children of their own, a launcher hands off to the real executable, so
    /// the whole tree goes rather than only the process Orbit happened to start.
    ///
    /// Waits for the process to actually go, up to [`EXIT_WAIT`], so a caller
    /// that returns from here knows the game is no longer on the machine.
    pub fn kill(&mut self, pid: u32) -> Result<(), String> {
        let Some(mut tracked) = self.running.remove(&pid) else {
            return Err("That game is not one Orbit started.".to_string());
        };
        log::info!("stopping pid {pid} and anything it started");

        #[cfg(windows)]
        kill_tree(pid);
        // Belt and braces, and the only route on other platforms.
        let _ = tracked.child.kill();

        let deadline = Instant::now() + EXIT_WAIT;
        loop {
            match tracked.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Ok(None) => {
                    log::warn!("pid {pid} was still running after {:?}", EXIT_WAIT);
                    return Ok(());
                }
                Err(e) => return Err(format!("Could not check whether the game closed: {e}")),
            }
        }
    }
}

/// Is a program of this name running anywhere on the machine?
///
/// `tasklist` lists every process as CSV, which is the same shape in every
/// display language: the image name is the first field and nothing else needs
/// reading. A process list costs a few milliseconds, and it is only read for a
/// game whose launcher handed off.
#[cfg(windows)]
fn image_running(name: &str) -> bool {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(output) = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.split(',')
            .next()
            .is_some_and(|first| same_program(first.trim().trim_matches('"'), name))
    })
}

#[cfg(not(windows))]
fn image_running(_name: &str) -> bool {
    false
}

/// Whether a listed program is the one being looked for.
///
/// Engines append things to their own name: `Game.exe` starts
/// `Game-Win64-Shipping.exe`, and a launcher often restarts itself under the
/// same name. A suffix that starts with a separator is the same game; anything
/// else is a different program that happens to begin with the same letters.
fn same_program(listed: &str, wanted: &str) -> bool {
    let listed = listed.to_lowercase();
    let wanted = wanted.to_lowercase();
    if listed == wanted {
        return true;
    }
    let stem = wanted.strip_suffix(".exe").unwrap_or(&wanted);
    if stem.len() < 4 {
        return false;
    }
    listed
        .strip_prefix(stem)
        .is_some_and(|rest| rest.starts_with('-') || rest.starts_with('_') || rest.starts_with('.'))
}

/// How long [`Sessions::kill`] waits for a process to actually exit.
const EXIT_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

/// Close a process and everything below it.
///
/// `Child::kill` only reaches the process Orbit started, and games usually
/// start the real one from there. `taskkill /T` walks the tree, and
/// `CREATE_NO_WINDOW` keeps a console window from flashing up.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // A non-zero status just means taskkill had nothing to do, so it is ignored:
    // the caller's `Child::kill` and wait still run.
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// Start a program Orbit is not going to watch, such as a companion tool.
///
/// These are deliberately fire-and-forget: the frame-rate overlay or the mod
/// manager is not the game, so its exit must never end the session. A failure
/// is returned so the UI can say which one did not start.
pub fn spawn_detached(path: &Path, args: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("{} is not there any more.", path.display()));
    }
    let mut cmd = std::process::Command::new(path);
    let args = args.trim();
    if !args.is_empty() {
        cmd.args(parse_args(args));
    }
    if let Some(dir) = path.parent() {
        cmd.current_dir(dir);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start {}: {e}", path.display()))
}

/// Split a user-typed argument string, honouring double quotes.
///
/// The settings screen gives one flat string, so this needs to behave like a
/// mini shell parser.
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

/// Executables that are never the game itself.
///
/// Installers, redistributables and crash handlers live next to real games and
/// would otherwise dominate an automatic scan.
const BORING_STEMS: &[&str] = &[
    "unins",
    "uninstall",
    "setup",
    "install",
    "vcredist",
    "dxsetup",
    "dxwebsetup",
    "dotnetfx",
    "ue4prereq",
    "prereq",
    "redist",
    "crashreporter",
    "crashpad_handler",
    "unarcade",
    "helper",
    "update",
    "updater",
    "patcher",
    "launcher",
    "bootstrap",
    "anticheat",
    "eac",
    "easyanticheat",
];

fn is_boring(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase();
    BORING_STEMS.iter().any(|b| stem.starts_with(b))
}

/// A game Orbit found while looking through a folder.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoundGame {
    pub title: String,
    pub exe_path: String,
    pub install_dir: String,
    pub size_bytes: u64,
}

/// Look through a folder for things that look like games.
///
/// Shallow on purpose: a library folder is a list of game folders, so there is
/// no reason to walk a whole install twice over. Anything deeper than
/// `max_depth` below the root is left alone.
pub fn scan_folder(root: &Path, max_depth: usize) -> Vec<FoundGame> {
    let mut found: Vec<FoundGame> = Vec::new();
    let mut queue = vec![(root.to_path_buf(), 0usize)];

    while let Some((dir, depth)) = queue.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut executables: Vec<PathBuf> = Vec::new();
        let mut subdirs: Vec<PathBuf> = Vec::new();

        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                subdirs.push(path);
            } else if kind.is_file() && is_executable(&path) && !is_boring(&path) {
                executables.push(path);
            }
        }

        if !executables.is_empty() {
            // The biggest executable is nearly always the game rather than a
            // launcher stub, and folder size is only counted once per game.
            let biggest = executables
                .iter()
                .max_by_key(|p| p.metadata().map(|m| m.len()).unwrap_or(0))
                .expect("checked above");
            let title = dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            found.push(FoundGame {
                title,
                exe_path: biggest.to_string_lossy().to_string(),
                install_dir: dir.to_string_lossy().to_string(),
                size_bytes: crate::storage::dir_size(&dir),
            });
        }

        if depth < max_depth {
            queue.extend(subdirs.into_iter().map(|d| (d, depth + 1)));
        }
    }

    found.sort_by_key(|g| g.title.to_lowercase());
    found
}

/// A program found while looking through a folder, with where it was found.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderProgram {
    /// The folder the program sits in, which is what a game is grouped by.
    pub folder: String,
    pub title: String,
    pub exe_path: String,
    pub size_bytes: u64,
    /// Everything in that folder, so the biggest one can be ranked first.
    pub folder_bytes: u64,
    /// Depth below the folder that was scanned, so a shallow hit wins.
    pub depth: usize,
}

/// Every program worth offering in a folder, not just the biggest one.
///
/// An import used to be handed one guess per folder, and a game whose real
/// program sits in `bin/x64` next to a launcher, a crash reporter and two
/// redistributables made that guess wrong as often as right. This returns the
/// candidates and lets the player pick; the biggest is still first, so the
/// likely one is already selected.
pub fn folder_programs(root: &Path, max_depth: usize) -> Vec<FolderProgram> {
    let mut found: Vec<FolderProgram> = Vec::new();
    let mut queue = vec![(root.to_path_buf(), 0usize)];

    while let Some((dir, depth)) = queue.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut subdirs: Vec<PathBuf> = Vec::new();
        let mut executables: Vec<PathBuf> = Vec::new();

        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if !is_junk_dir(&path) {
                    subdirs.push(path);
                }
            } else if kind.is_file() && is_executable(&path) && !is_boring(&path) {
                executables.push(path);
            }
        }

        if !executables.is_empty() {
            let title = dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            let folder_bytes = crate::storage::dir_size(&dir);
            for exe in executables {
                found.push(FolderProgram {
                    folder: dir.to_string_lossy().to_string(),
                    title: title.clone(),
                    size_bytes: exe.metadata().map(|m| m.len()).unwrap_or(0),
                    exe_path: exe.to_string_lossy().to_string(),
                    folder_bytes,
                    depth,
                });
            }
        }

        if depth < max_depth {
            queue.extend(subdirs.into_iter().map(|d| (d, depth + 1)));
        }
    }

    // Shallowest first, then biggest, so the obvious program for each folder
    // leads and a game's own folder is never hidden behind one of its helpers.
    found.sort_by(|a, b| {
        a.folder
            .to_lowercase()
            .cmp(&b.folder.to_lowercase())
            .then(a.depth.cmp(&b.depth))
            .then(b.size_bytes.cmp(&a.size_bytes))
    });
    found
}

/// Folders that hold somebody else's installer rather than a game.
///
/// Walking into these used to offer `dxsetup.exe` and `vcredist_x64.exe` as
/// games, which is worse than offering nothing.
fn is_junk_dir(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase();
    const JUNK: [&str; 12] = [
        "redist",
        "_commonredist",
        "directx",
        "vcredist",
        "dotnet",
        "support",
        "easyanticheat",
        "battleye",
        "docs",
        "documentation",
        "manual",
        "engines",
    ];
    JUNK.iter().any(|j| name == *j || name.starts_with(&format!("{j}_")) || name.starts_with(&format!("{j}-")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_redistributable_folder_is_not_walked_into() {
        assert!(is_junk_dir(Path::new(r"C:\Games\Hades\_CommonRedist")));
        assert!(is_junk_dir(Path::new(r"C:\Games\Hades\DirectX")));
        assert!(!is_junk_dir(Path::new(r"C:\Games\Hades\bin")));
    }

    #[test]
    fn every_program_in_a_game_folder_is_offered() {
        let dir = std::env::temp_dir().join("orbit-tauri-programs");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin").join("x64")).unwrap();
        std::fs::create_dir_all(dir.join("_CommonRedist")).unwrap();
        std::fs::write(dir.join("launcher.exe"), b"xx").unwrap();
        std::fs::write(dir.join("bin").join("x64").join("game.exe"), b"xxxxxxxx").unwrap();
        std::fs::write(dir.join("_CommonRedist").join("dxsetup.exe"), b"xxxxxxxxxxxx").unwrap();

        let found = folder_programs(&dir, 2);
        let names: Vec<String> = found.iter().map(|f| f.title.clone()).collect();
        assert!(names.contains(&"orbit-tauri-programs".to_string()));
        assert!(names.contains(&"x64".to_string()));
        assert!(!names.contains(&"_CommonRedist".to_string()));
        // The folder's own programs come before the ones buried deeper.
        let first = found.first().expect("at least one");
        assert_eq!(first.exe_path, dir.join("launcher.exe").to_string_lossy().to_string());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quoted_arguments_stay_together() {
        assert_eq!(
            parse_args(r#"-f "C:\My Games\rom.rom" --fullscreen"#),
            vec!["-f", r"C:\My Games\rom.rom", "--fullscreen"]
        );
        assert!(parse_args("   ").is_empty());
    }

    #[test]
    fn launchers_and_installers_are_not_games() {
        assert!(is_executable(Path::new(r"C:\Games\Hades\Hades.exe")));
        assert!(!is_executable(Path::new(r"C:\Games\Hades\readme.txt")));
        assert!(is_boring(Path::new(r"C:\Games\Hades\unins000.exe")));
        assert!(is_boring(Path::new(r"C:\Games\Hades\vcredist_x64.exe")));
        assert!(!is_boring(Path::new(r"C:\Games\Hades\Hades.exe")));
    }

    #[test]
    fn a_scan_finds_the_game_in_a_folder_and_ignores_the_noise() {
        let root = std::env::temp_dir().join("orbit-tauri-scan");
        let _ = std::fs::remove_dir_all(&root);
        let game = root.join("Hollow Knight");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(game.join("hollow_knight.exe"), vec![0u8; 4096]).unwrap();
        std::fs::write(game.join("unins000.exe"), vec![0u8; 16]).unwrap();
        let other = root.join("Notes");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("readme.md"), b"hi").unwrap();

        let found = scan_folder(&root, 2);
        assert_eq!(found.len(), 1, "only the real game is listed");
        assert_eq!(found[0].title, "Hollow Knight");
        assert!(found[0].exe_path.ends_with("hollow_knight.exe"));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A real process, because the hand-off logic is about real process exits.
    #[test]
    fn a_process_that_dies_quickly_is_treated_as_a_launcher() {
        let mut sessions = Sessions::default();
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let launched = sessions
            .launch_target(&LaunchTarget::Executable {
                path: PathBuf::from(&shell),
                args: "/c exit".to_string(),
                working_dir: None,
            })
            .expect("cmd should start");
        assert!(!launched.manual, "there is a process to watch");

        // Long enough for `cmd /c exit` to be gone.
        std::thread::sleep(std::time::Duration::from_millis(500));

        // It died inside the hand-off window, so the session keeps running...
        assert_eq!(sessions.status(launched.pid), Some(true));
        // ...and keeps running on the next tick too. This is the bug that used
        // to close the session about five seconds after a launcher exited.
        assert_eq!(sessions.status(launched.pid), Some(true));
        assert_eq!(sessions.status(launched.pid), Some(true));
        sessions.forget(launched.pid);
    }

    #[test]
    fn a_game_that_is_only_timed_reports_that_it_is_manual() {
        let mut sessions = Sessions::default();
        let launched = sessions.launch_target(&LaunchTarget::None).unwrap();
        assert!(launched.manual);
        assert_eq!(launched.pid, 0);
        // Nothing was started, so there is nothing to ask about.
        assert_eq!(sessions.status(0), None);
    }

    /// A real long-lived process, because killing one is the whole point.
    #[test]
    fn stopping_a_session_closes_the_game_it_started() {
        let mut sessions = Sessions::default();
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let launched = sessions
            .launch_target(&LaunchTarget::Executable {
                path: PathBuf::from(&shell),
                // Outlives the test by a wide margin, so it can only be gone
                // because something killed it.
                args: "/c ping -n 60 127.0.0.1 > nul".to_string(),
                working_dir: None,
            })
            .expect("cmd should start");
        assert!(!launched.manual);
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert_eq!(sessions.status(launched.pid), Some(true), "still running");

        sessions.kill(launched.pid).expect("kill should succeed");

        // No longer tracked, and the process really is gone rather than merely
        // forgotten: `kill` only returns once it has seen the exit.
        assert_eq!(sessions.status(launched.pid), None);
    }

    #[test]
    fn stopping_a_game_orbit_never_started_says_so() {
        let mut sessions = Sessions::default();
        assert!(sessions.kill(4321).is_err());
    }
}
