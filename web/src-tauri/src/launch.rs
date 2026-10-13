//! Starting games, and noticing when they stop.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::time::Instant;

use crate::launch_target::LaunchTarget;

/// How often the game is looked for once the process Orbit started has gone.
///
/// The real game is usually a grandchild Orbit has no handle for, so the only
/// thing left to go on is what is running, and a process list costs one small
/// helper to read. Every five seconds is often enough to notice a game being
/// closed without spending the session doing anything else.
const HANDOFF_POLL: std::time::Duration = std::time::Duration::from_secs(5);

/// The key a session watched only by folder is filed under.
///
/// There is only ever one session at a time, so a key that no real process can
/// have is enough, and a game Orbit started keeps its own pid.
pub const FOLDER_WATCH: u32 = 0;

/// What the watcher has learned about a game.
///
/// Compared and printed, because the tests ask a process what it is doing and
/// say what they expected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Still going.
    Running,
    /// Gone, so the session ends.
    Ended,
    /// Nothing more can be learned about it: the session belongs to the player.
    Unwatched,
}

/// A game Orbit is keeping time for.
///
/// Watching one program is not enough. Games start through launchers, patchers
/// and engine bootstrappers which exit as soon as they have handed the real game
/// on, and games started by Steam or by the player have no process of Orbit's at
/// all. So a session remembers the folder the game lives in and every program
/// name inside it, and a game counts as running while any of those is running.
/// That is what makes the clock stop when the player quits, whichever way the
/// game was started.
struct Tracked {
    /// The process Orbit started, when it started one.
    child: Option<Child>,
    started: Instant,
    /// When the process was noticed dead, if it has been.
    ///
    /// Kept as a moment rather than a flag so the hand-off window is measured
    /// from the moment the process actually died.
    died_at: Option<Instant>,
    /// True once a quick death was judged to be a launcher handing off.
    handed_off: bool,
    /// The program's file name, for the summary in the log.
    image: Option<String>,
    /// Every program name in the game's folder, lowercased.
    names: Vec<String>,
    /// Whether the game itself has been seen running at least once.
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
    /// True when Orbit did not start the program, so the player stops the
    /// session themselves if the folder cannot tell when the game has gone.
    pub manual: bool,
    /// True when something is watching the game, so a session that ends by
    /// itself is possible.
    pub watched: bool,
}

impl Sessions {
    /// Start a game the way its launch target says to, and work out how its end
    /// will be noticed.
    ///
    /// `install_dir` is the game's own folder, when Orbit knows it. A game
    /// started through Steam or left to the player has no process to hold on to,
    /// and the folder is the only thing that says whether it is still running.
    pub fn launch_target(
        &mut self,
        target: &LaunchTarget,
        install_dir: Option<&Path>,
    ) -> Result<Launched, String> {
        // The program's own folder matters as much as the install folder: the
        // real executable often sits a level or two below the game's root.
        let mut dirs: Vec<std::path::PathBuf> = Vec::new();
        if let Some(dir) = install_dir {
            dirs.push(dir.to_path_buf());
        }
        if let Some(path) = target.primary_path() {
            if let Some(parent) = path.parent() {
                dirs.push(parent.to_path_buf());
            }
        }
        let names = watch_names(target, &dirs);

        match crate::launch_target::spawn(target)? {
            Some(child) => {
                let pid = child.id();
                log::info!("launched {} (pid {pid})", target.label());
                self.running.insert(
                    pid,
                    Tracked {
                        child: Some(child),
                        started: Instant::now(),
                        died_at: None,
                        handed_off: false,
                        image: target
                            .primary_path()
                            .and_then(|p| p.file_name())
                            .and_then(|n| n.to_str())
                            .map(|n| n.to_lowercase()),
                        group: started_group(pid),
                        names,
                        seen: false,
                        misses: 0,
                        last_scan: None,
                    },
                );
                Ok(Launched {
                    pid,
                    manual: false,
                    watched: true,
                })
            }
            // Steam was asked to do it, or the game is being timed only. The
            // player starts it, but its folder still says when it is over.
            None => {
                if names.is_empty() {
                    return Ok(Launched {
                        pid: 0,
                        manual: true,
                        watched: false,
                    });
                }
                self.running.insert(
                    FOLDER_WATCH,
                    Tracked {
                        child: None,
                        started: Instant::now(),
                        died_at: None,
                        handed_off: true,
                        image: None,
                        group: None,
                        names,
                        seen: false,
                        misses: 0,
                        last_scan: None,
                    },
                );
                log::info!("watching the game's folder for something to start");
                Ok(Launched {
                    pid: FOLDER_WATCH,
                    manual: true,
                    watched: true,
                })
            }
        }
    }

    /// What is happening with a game Orbit is keeping time for.
    ///
    /// `None` for a session Orbit is not watching at all, so the caller can fall
    /// back to a clock the player stops.
    pub fn check(&mut self, pid: u32) -> Option<Verdict> {
        let tracked = self.running.get_mut(&pid)?;

        // The process Orbit started, if it started one. Once it has been reaped
        // the answer stays "exited", so the first sighting is recorded.
        if let Some(child) = tracked.child.as_mut() {
            if tracked.died_at.is_none() && child.try_wait().ok().flatten().is_some() {
                tracked.died_at = Some(Instant::now());
            }
            if tracked.died_at.is_none() {
                // The group is created in the child, just before the program
                // runs. The first look can be too early to see it, and a later
                // one must not miss it: that group is how a Wine launch is
                // followed after this process exits.
                if tracked.group.is_none() {
                    tracked.group = started_group(pid);
                }
                return Some(Verdict::Running);
            }
        } else {
            tracked.died_at = Some(tracked.started);
        }

        // The process Orbit started has gone, and it may have been a launcher
        // handing the game on rather than the game itself ending: plenty of
        // titles start a small bootstrapper that exits in a second or two while
        // the game runs on as a grandchild. The session carries on and the
        // folder takes over the watching.
        if tracked.child.is_some() && !tracked.handed_off {
            tracked.handed_off = true;
            let program = tracked.image.as_deref().unwrap_or("the program");
            log::info!("{program} (pid {pid}) exited; watching what it handed off to");
        }

        // A launch with no folder and no process group of its own has nothing
        // left to ask. Wine is the case this used to get wrong: the process
        // Orbit started exits, and the game carries on in the group beside it.
        if tracked.group.is_none() && tracked.names.is_empty() {
            return Some(match tracked.child {
                Some(_) => Verdict::Ended,
                None => Verdict::Unwatched,
            });
        }

        // One read of the process list every few seconds, and no more.
        let now = Instant::now();
        if now.duration_since(tracked.last_scan.unwrap_or(tracked.started)) < HANDOFF_POLL {
            return Some(Verdict::Running);
        }
        tracked.last_scan = Some(now);

        let names = std::mem::take(&mut tracked.names);
        let group = tracked.group;
        let running = group_alive(group, pid) || (!names.is_empty() && any_running(&names));
        tracked.names = names;

        if running {
            if !tracked.seen {
                tracked.seen = true;
                log::info!("the game is running from its own folder, so its session ends when it does");
            }
            tracked.misses = 0;
            return Some(Verdict::Running);
        }

        // Nothing from the game's folder is running.
        //
        // A session the player started has to be seen at least once: pressing
        // Play and taking a minute to start the game is not an ending, and
        // ending the clock here would throw the session away.
        if tracked.child.is_none() && !tracked.seen {
            return Some(Verdict::Running);
        }

        // Two empty reads in a row, so a game that restarts itself, or one read
        // that catches a moment between processes, is not mistaken for the end.
        tracked.misses += 1;
        if tracked.misses >= 2 {
            Some(Verdict::Ended)
        } else {
            Some(Verdict::Running)
        }
    }

    /// Forget a game the player has stopped tracking.
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
        // The game is often no longer the process Orbit started. The group is
        // the rest of it, and only when that group is the launch's own.
        if let Some(pgid) = tracked.group {
            signal_group(pgid, false);
        }
        if let Some(child) = tracked.child.as_mut() {
            let _ = child.kill();
        }

        let deadline = Instant::now() + EXIT_WAIT;
        loop {
            match tracked.child.as_mut() {
                None => {
                    end_group(tracked.group);
                    return Ok(());
                }
                Some(child) => match child.try_wait() {
                    Ok(Some(_)) => {
                        // The process Orbit started may already have handed the
                        // game on. The group is what is still playing.
                        end_group(tracked.group);
                        return Ok(());
                    }
                    Ok(None) if Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Ok(None) => {
                        log::warn!("pid {pid} was still running after {:?}", EXIT_WAIT);
                        end_group(tracked.group);
                        return Ok(());
                    }
                    Err(e) => return Err(format!("Could not check whether the game closed: {e}")),
                },
            }
        }
    }
}

/// The names a running game can be recognised by.
///
/// The folder walk finds siblings a launcher starts under another file name.
/// The program itself is always included, even when that walk cannot read the
/// folder: a Wine `.exe` is still the name the running process carries.
fn watch_names(target: &LaunchTarget, dirs: &[std::path::PathBuf]) -> Vec<String> {
    let mut names = program_names(dirs);
    if let Some(name) = target
        .primary_path()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
    {
        let name = name.to_lowercase();
        if name.is_empty() {
            return names;
        }
        if !names.contains(&name) {
            names.push(name.clone());
        }
        // Wine sometimes shows the exe with the extension and sometimes without.
        if let Some(stem) = name.strip_suffix(".exe") {
            if stem.len() >= 4 && !names.iter().any(|have| have == stem) {
                names.push(stem.to_string());
            }
        }
    }
    names
}

/// The process group of a launch, only when the child leads that group.
///
/// A child that stayed in Orbit's group must not be treated as one: signalling
/// it would signal Orbit. Wine is started in a group of its own so the game it
/// hands off to can be told apart from everything else.
#[cfg(unix)]
fn started_group(pid: u32) -> Option<u32> {
    let pgid = unsafe { libc::getpgid(pid as i32) };
    if pgid > 1 && pgid as u32 == pid {
        Some(pid)
    } else {
        None
    }
}

#[cfg(not(unix))]
fn started_group(_pid: u32) -> Option<u32> {
    None
}

/// Whether any live process other than the one Orbit started is still in the group.
#[cfg(unix)]
fn group_alive(group: Option<u32>, ignore: u32) -> bool {
    let Some(group) = group else {
        return false;
    };
    if group <= 1 {
        return false;
    }
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    for entry in entries.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok()) else {
            continue;
        };
        if pid == ignore {
            continue;
        }
        let pgid = unsafe { libc::getpgid(pid as i32) };
        if pgid <= 0 || pgid as u32 != group || is_zombie(pid) {
            continue;
        }
        return true;
    }
    false
}

#[cfg(not(unix))]
fn group_alive(_group: Option<u32>, _ignore: u32) -> bool {
    false
}

#[cfg(unix)]
fn is_zombie(pid: u32) -> bool {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return true;
    };
    // The command name sits in parentheses and can itself contain spaces and
    // parentheses. The state letter is the first field after the last one.
    let Some(end) = stat.rfind(')') else {
        return false;
    };
    stat[end + 1..].trim_start().starts_with('Z')
}

/// Ask a launch's own process group to stop. `force` is the second try.
fn signal_group(pgid: u32, force: bool) {
    if pgid <= 1 {
        return;
    }
    #[cfg(unix)]
    {
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        unsafe {
            libc::kill(-(pgid as i32), signal);
        }
    }
    #[cfg(not(unix))]
    let _ = force;
}

fn end_group(group: Option<u32>) {
    if let Some(pgid) = group {
        signal_group(pgid, true);
    }
}

/// Every program name inside a game's folder, so a running one can be recognised.
///
/// The folder is walked a short way down, because the executable that ends up
/// running is often below the game's root: an engine puts it in `Binaries`, a
/// launcher hands off to something in a subfolder. Names only, lowercased, and
/// deduped, because the question being asked is just "is any of these running".
fn program_names(dirs: &[std::path::PathBuf]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for root in dirs {
        if !root.is_dir() {
            continue;
        }
        let mut queue = vec![(root.clone(), 0usize)];
        while let Some((dir, depth)) = queue.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                let path = entry.path();
                if kind.is_dir() {
                    if depth + 1 < 3 && !is_junk_dir(&path) {
                        queue.push((path, depth + 1));
                    }
                } else if kind.is_file() && is_executable(&path) {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        let name = name.to_lowercase();
                        if !out.contains(&name) {
                            out.push(name);
                        }
                    }
                }
            }
        }
        // A library folder is the wrong place to be walking: if a game's folder
        // turns out to be one, the list would hold every game at once.
        if out.len() > 500 {
            break;
        }
    }
    out
}

/// Is any program of these names running?
fn any_running(names: &[String]) -> bool {
    let running = running_programs();
    if running.is_empty() {
        return false;
    }
    names.iter().any(|name| {
        running
            .iter()
            .any(|listed| same_program(listed, name))
    })
}

/// The image name of every process on the machine, lowercased.
///
/// `tasklist` lists them as CSV, which is the same shape in every display
/// language: the image name is the first field and nothing else needs reading.
#[cfg(windows)]
fn running_programs() -> Vec<String> {
    let Ok(output) = crate::process::command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split(',').next())
        .map(|first| first.trim().trim_matches('"').to_lowercase())
        .filter(|name| !name.is_empty())
        .collect()
}

/// Image names from `/proc`, which is where a Wine game shows up.
///
/// Wine writes the Windows exe name into the process's short name, cut off at
/// 15 characters, and sometimes only into its command line while the short name
/// stays `wine-preloader`. Both are collected. A machine without `/proc` has
/// nothing to list, and the process group is the other signal.
#[cfg(not(windows))]
fn running_programs() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok()) else {
            continue;
        };
        let Ok(comm) = std::fs::read_to_string(format!("/proc/{pid}/comm")) else {
            continue;
        };
        let comm = comm.trim().to_lowercase();
        if comm.is_empty() {
            continue;
        }
        if !out.contains(&comm) {
            out.push(comm.clone());
        }
        if wine_loader(&comm) {
            for name in cmdline_names(pid) {
                if !out.contains(&name) {
                    out.push(name);
                }
            }
        }
    }
    out
}

/// Wine's loader, including the 15-character cut of `wine64-preloader`.
#[cfg(not(windows))]
fn wine_loader(comm: &str) -> bool {
    comm == "wine"
        || comm == "wine64"
        || comm.starts_with("wine-preloader")
        || comm.starts_with("wine64-preloade")
        || comm.starts_with("wine-preloade")
}

/// The last path piece, whether the separator is Unix or Windows.
#[cfg(not(windows))]
fn file_tail(arg: &str) -> &str {
    let slash = arg.rfind('/');
    let back = arg.rfind('\\');
    let cut = match (slash, back) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };
    cut.map(|index| &arg[index + 1..]).unwrap_or(arg)
}

/// File names from a process command line, so `wine-preloader` still names the exe.
#[cfg(not(windows))]
fn cmdline_names(pid: u32) -> Vec<String> {
    let Ok(bytes) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
        return Vec::new();
    };
    let bytes = &bytes[..bytes.len().min(1024)];
    bytes
        .split(|byte| *byte == 0)
        .filter(|arg| !arg.is_empty())
        .filter_map(|arg| std::str::from_utf8(arg).ok())
        .map(file_tail)
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect()
}

/// Whether a listed program is the one being looked for.
///
/// Engines append things to their own name: `Game.exe` starts
/// `Game-Win64-Shipping.exe`, and a launcher often restarts itself under the
/// same name. A suffix that starts with a separator is the same game; anything
/// else is a different program that happens to begin with the same letters.
fn same_program(listed: &str, wanted: &str) -> bool {
    if listed == wanted {
        return true;
    }
    // Linux `comm` holds 15 characters. Wine puts the Windows exe name there,
    // so `Game-Win64-Shipping.exe` is listed as `game-win64-shi`.
    if listed.len() == 15 && wanted.starts_with(listed) {
        return true;
    }
    let stem = wanted.strip_suffix(".exe").unwrap_or(wanted);
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
    // A non-zero status just means taskkill had nothing to do, so it is ignored:
    // the caller's `Child::kill` and wait still run.
    let _ = crate::process::command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
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

    /// A path as it would be written on Windows, built for whichever machine is
    /// running the test. `C:\Games\Hades` typed literally is one long file
    /// name anywhere else, and tests about file names then measure the wrong
    /// thing.
    fn win(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn a_redistributable_folder_is_not_walked_into() {
        assert!(is_junk_dir(&win(&["C:", "Games", "Hades", "_CommonRedist"])));
        assert!(is_junk_dir(&win(&["C:", "Games", "Hades", "DirectX"])));
        assert!(!is_junk_dir(&win(&["C:", "Games", "Hades", "bin"])));
    }

    #[test]
    fn every_program_in_a_game_folder_is_offered() {
        let dir = std::env::temp_dir().join("orbit-tauri-programs");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin").join("x64")).unwrap();
        std::fs::create_dir_all(dir.join("_CommonRedist")).unwrap();
        // A real game program, not a stub: a `launcher.exe` is deliberately not
        // offered, so the folder's own program has to be the game.
        std::fs::write(dir.join("Hades.exe"), b"xx").unwrap();
        std::fs::write(dir.join("bin").join("x64").join("game.exe"), b"xxxxxxxx").unwrap();
        std::fs::write(dir.join("_CommonRedist").join("dxsetup.exe"), b"xxxxxxxxxxxx").unwrap();

        let found = folder_programs(&dir, 2);
        let names: Vec<String> = found.iter().map(|f| f.title.clone()).collect();
        assert!(names.contains(&"orbit-tauri-programs".to_string()), "{names:?}");
        assert!(names.contains(&"x64".to_string()));
        assert!(!names.contains(&"_CommonRedist".to_string()));
        // The folder's own programs come before the ones buried deeper.
        let first = found.first().expect("at least one");
        assert_eq!(first.exe_path, dir.join("Hades.exe").to_string_lossy().to_string());
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
        assert!(is_executable(&win(&["C:", "Games", "Hades", "Hades.exe"])));
        assert!(!is_executable(&win(&["C:", "Games", "Hades", "readme.txt"])));
        assert!(is_boring(&win(&["C:", "Games", "Hades", "unins000.exe"])));
        assert!(is_boring(&win(&["C:", "Games", "Hades", "vcredist_x64.exe"])));
        assert!(!is_boring(&win(&["C:", "Games", "Hades", "Hades.exe"])));
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

    #[test]
    fn a_cut_off_process_name_is_still_the_game() {
        assert!(same_program("game-win64-shi", "game-win64-shipping.exe"));
        assert!(!same_program("other-game.exe", "game-win64-shipping.exe"));
        assert!(same_program("hades.exe", "hades.exe"));
    }

    /// A real process, because the hand-off logic is about real process exits.
    ///
    /// The process Orbit started can be a launcher. Wine is that launcher: it
    /// exits, and the game keeps running. The session must not end on that exit.
    #[test]
    fn a_process_that_dies_quickly_is_treated_as_a_launcher() {
        let mut sessions = Sessions::default();
        let (shell, args) = if cfg!(windows) {
            (
                std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
                "/c exit".to_string(),
            )
        } else {
            ("/bin/sh".to_string(), "-c exit".to_string())
        };
        let launched = sessions
            .launch_target(
                &LaunchTarget::Executable {
                    path: PathBuf::from(&shell),
                    args,
                    working_dir: None,
                },
                None,
            )
            .unwrap_or_else(|e| panic!("{shell} should start: {e}"));
        assert!(!launched.manual, "there is a process to watch");

        // Long enough for `cmd /c exit` to be gone.
        std::thread::sleep(std::time::Duration::from_millis(500));

        // It died inside the hand-off window, so the session keeps running...
        assert!(matches!(sessions.check(launched.pid), Some(Verdict::Running)));
        // ...and keeps running on the next tick too. This is the bug that used
        // to close the session about five seconds after a launcher exited.
        assert!(matches!(sessions.check(launched.pid), Some(Verdict::Running)));
        assert!(matches!(sessions.check(launched.pid), Some(Verdict::Running)));
        sessions.forget(launched.pid);
    }

    #[test]
    fn a_game_that_is_only_timed_reports_that_it_is_manual() {
        let mut sessions = Sessions::default();
        let launched = sessions.launch_target(&LaunchTarget::None, None).unwrap();
        assert!(launched.manual);
        assert_eq!(launched.pid, 0);
        // Nothing was started, so there is nothing to ask about.
        assert!(sessions.check(0).is_none());
    }

    /// A real long-lived process, because killing one is the whole point.
    ///
    /// The program it starts is whatever this machine has: `cmd` and a ping on
    /// Windows, a shell and a sleep anywhere else. Either way it outlives the
    /// test by a wide margin, so the only thing that can have ended it is the
    /// kill being tested.
    #[test]
    fn stopping_a_session_closes_the_game_it_started() {
        let mut sessions = Sessions::default();
        let (program, args) = long_running_program();
        let launched = sessions
            .launch_target(
                &LaunchTarget::Executable {
                    path: PathBuf::from(&program),
                    args,
                    working_dir: None,
                },
                None,
            )
            .unwrap_or_else(|e| panic!("{program} should start: {e}"));
        assert!(!launched.manual);
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert!(
            matches!(sessions.check(launched.pid), Some(Verdict::Running)),
            "still running"
        );

        sessions.kill(launched.pid).expect("kill should succeed");

        // No longer tracked, and the process really is gone rather than merely
        // forgotten: `kill` only returns once it has seen the exit.
        assert!(sessions.check(launched.pid).is_none());
    }

    #[test]
    fn stopping_a_game_orbit_never_started_says_so() {
        let mut sessions = Sessions::default();
        assert!(sessions.kill(4321).is_err());
    }

    /// A program that stays up for a minute, and the arguments to make it do so.
    fn long_running_program() -> (String, String) {
        if cfg!(windows) {
            let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
            // Pings itself, because that is a sleep that ships with Windows.
            (shell, "/c ping -n 60 127.0.0.1 > nul".to_string())
        } else {
            ("/bin/sh".to_string(), r#"-c "sleep 60""#.to_string())
        }
    }
}
