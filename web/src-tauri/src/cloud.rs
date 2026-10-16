//! Send the copies Orbit already made to a cloud, through rclone.
//!
//! The copy that stays on this machine does not need rclone, and nothing is
//! installed on the system to make it. rclone lives in Orbit's own folder,
//! talks to a remote named `orbit`, and only moves the backup tree that is
//! already there. A remote the player set up themselves is used as it is, and
//! is never deleted from their rclone.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::process;
use crate::saves;

const FETCH_CAP: u64 = 80 * 1024 * 1024;
const AUTH_WAIT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub ready: bool,
    pub version: String,
    /// True when the copy in Orbit's folder is the one that will run, rather
    /// than rclone that was already on this PC.
    pub placed: bool,
    /// The folder Orbit keeps its own rclone in. Empty until that folder is known.
    pub folder: String,
    /// True only when Orbit's own copy is older than the current release.
    pub update: bool,
    /// The current release, when it was looked up. Empty if that check did not answer.
    pub latest: String,
}

/// One game whose copies should be sent, rather than the whole tree.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudGame {
    pub id: String,
    pub title: String,
    pub publisher: Option<String>,
}

pub async fn status(data_dir: &Path) -> CloudStatus {
    let folder = data_dir.join("tools");
    let own = folder.join(binary_name());
    let folder = folder.display().to_string();
    let mut found = if own.is_file() {
        CloudStatus {
            ready: true,
            version: version_of(&own).unwrap_or_default(),
            placed: true,
            folder,
            update: false,
            latest: String::new(),
        }
    } else {
        match which(binary_name()) {
            Some(path) => CloudStatus {
                ready: true,
                version: version_of(&path).unwrap_or_default(),
                placed: false,
                folder,
                update: false,
                latest: String::new(),
            },
            None => CloudStatus {
                ready: false,
                version: String::new(),
                placed: false,
                folder,
                update: false,
                latest: String::new(),
            },
        }
    };
    // Only Orbit's own copy can be replaced. A rclone already on this PC is left alone,
    // and the button stays hidden unless the current release is actually newer.
    if found.placed {
        if let Some(latest) = latest_release().await {
            found.update = version_newer(&latest, &found.version);
            found.latest = latest;
        }
    }
    found
}

/// Download the official rclone build into Orbit's folder. Not a system install.
///
/// `replace` fetches a new copy even when Orbit already has one, which is how
/// an update works. A rclone that was already on this PC is left where it is.
pub async fn fetch(data_dir: &Path, replace: bool) -> Result<String, String> {
    let dest = data_dir.join("tools").join(binary_name());
    if dest.is_file() && !replace {
        return Ok(format!(
            "rclone is ready ({})",
            version_of(&dest).unwrap_or_else(|| "installed".into())
        ));
    }
    let name = archive_name()?;
    let url = format!("https://downloads.rclone.org/{name}");
    let tools = data_dir.join("tools");
    fs::create_dir_all(&tools).map_err(|e| format!("Could not create Orbit's tools folder: {e}"))?;
    let archive = tools.join(name);
    download(&url, &archive).await?;
    let unpacked = tools.join("rclone-unpacked");
    let _ = fs::remove_dir_all(&unpacked);
    if let Err(reason) = unpack(&archive, &unpacked) {
        let _ = fs::remove_file(&archive);
        return Err(reason);
    }
    let found = find_binary(&unpacked).ok_or_else(|| "The rclone download did not contain rclone.".to_string())?;
    let dest = tools.join(binary_name());
    let _ = fs::remove_file(&dest);
    fs::rename(&found, &dest)
        .or_else(|_| fs::copy(&found, &dest).map(|_| ()))
        .map_err(|e| format!("Could not keep rclone: {e}"))?;
    set_mode(&dest, 0o755);
    let _ = fs::remove_dir_all(&unpacked);
    let _ = fs::remove_file(&archive);
    Ok(format!(
        "rclone is ready ({})",
        version_of(&dest).unwrap_or_else(|| "downloaded".into())
    ))
}

/// Sign in to a cloud, or save a server, as `remote_name` in Orbit's config.
///
/// A failed check removes that remote again. It does not touch a remote the
/// player already had in rclone. `orbit-next` is a second sign-in used only to
/// copy the backups across, and it does not replace `orbit`.
pub fn connect(
    data_dir: &Path,
    provider: &str,
    host: &str,
    user: &str,
    password: &str,
    url: &str,
    remote_name: &str,
    folder: &str,
    code: &str,
    mailbox: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    let bin = binary(data_dir).ok_or_else(|| "Get rclone in Settings, under Backups, first.".to_string())?;
    let config = config_path(data_dir)?;
    let provider = provider.trim();
    let remote_name = orbit_name(remote_name)?;
    let folder = clean_folder(folder)?;
    if matches!(provider, "drive" | "dropbox" | "onedrive" | "box") {
        prepare_oauth_port(&config, tell)?;
    }
    let label = match provider {
        "drive" | "dropbox" | "box" => oauth(&bin, &config, provider, remote_name, open, tell)?,
        "onedrive" => oauth_onedrive(&bin, &config, remote_name, open, tell)?,
        "mega" | "protondrive" => account_login(&bin, &config, provider, remote_name, user, password, code, mailbox)?,
        "webdav" | "ftp" | "sftp" | "smb" => server(&bin, &config, provider, remote_name, host, user, password, url)?,
        other => return Err(format!("Orbit does not know how to connect {other}.")),
    };
    // The browser login is done. Say so before the folder is created, which
    // is the slow part, so the cloud can appear while that finishes.
    tell("signed-in");
    set_mode(&config, 0o600);
    if let Err(reason) = mkdir(&bin, Some(&config), remote_name, &folder) {
        let _ = delete_named(&bin, &config, remote_name);
        return Err(reason);
    }
    Ok(label)
}

/// Remotes rclone already has, from its own config, not Orbit's.
pub fn remotes(data_dir: &Path) -> Result<Vec<String>, String> {
    let bin = binary(data_dir).ok_or_else(|| "Get rclone in Settings, under Backups, first.".to_string())?;
    let output = rclone(&bin, None)
        .arg("listremotes")
        .output()
        .map_err(|e| format!("Could not ask rclone what is connected: {e}"))?;
    if !output.status.success() {
        return Err(public_error(&output.stderr, "rclone could not read its own remotes."));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().trim_end_matches(':').to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

/// Check a remote the player already has. Their remote is not deleted if the
/// check fails, and Orbit's config is not used.
pub fn attach(data_dir: &Path, remote: &str, folder: &str) -> Result<(), String> {
    let bin = binary(data_dir).ok_or_else(|| "Get rclone in Settings, under Backups, first.".to_string())?;
    let remote = checked_remote(remote)?;
    let folder = clean_folder(folder)?;
    mkdir(&bin, None, remote, &folder)
}

/// Forget one Orbit remote. A name that is not Orbit's is left alone.
pub fn forget_one(data_dir: &Path, remote: &str) -> Result<(), String> {
    let remote = orbit_name(remote)?;
    let Some(bin) = binary(data_dir) else {
        return Ok(());
    };
    let config = config_path(data_dir)?;
    if !config.is_file() {
        return Ok(());
    }
    delete_named(&bin, &config, remote)
}

/// Forget Orbit's remote. A remote rclone already had is left alone: this only
/// deletes `orbit` and a waiting `orbit-next` from Orbit's own config.
pub fn forget(data_dir: &Path) -> Result<(), String> {
    let Some(bin) = binary(data_dir) else {
        return Ok(());
    };
    let config = config_path(data_dir)?;
    if !config.is_file() {
        return Ok(());
    }
    delete_named(&bin, &config, "orbit")?;
    let _ = delete_named(&bin, &config, "orbit-next");
    Ok(())
}

pub fn copy(
    data_dir: &Path,
    backup_root: Option<&str>,
    remote: &str,
    own: bool,
    up: bool,
    folder: Option<&str>,
    only: Option<&[CloudGame]>,
) -> Result<String, String> {
    let bin = binary(data_dir).ok_or_else(|| "Get rclone in Settings, under Backups, first.".to_string())?;
    let remote = checked_remote(remote)?;
    let folder = clean_folder(folder.unwrap_or("Orbit"))?;
    let source = saves::root_of(data_dir, backup_root);
    if up && !source.is_dir() {
        return Err("There are no copies to send yet. Back up a game first.".into());
    }
    if !up {
        fs::create_dir_all(&source).map_err(|e| format!("Could not create the copies folder: {e}"))?;
    }
    let config = config_for(data_dir, own)?;
    if up {
        if let Some(games) = only {
            return copy_games(&bin, config.as_deref(), data_dir, backup_root, remote, &folder, games);
        }
    }
    let cloud = format!("{remote}:{folder}");
    let (from, to) = if up {
        (source.to_string_lossy().into_owned(), cloud)
    } else {
        (format!("{cloud}/"), source.to_string_lossy().into_owned())
    };
    run_copy(&bin, config.as_deref(), &from, &to)?;
    Ok(if up {
        format!("Sent the copies to {remote}.")
    } else {
        format!("Brought the copies down into {}.", source.display())
    })
}

/// Move the copies from one path to another on the same cloud.
///
/// An empty source is not an error: the next backup uses the new path.
pub fn move_folder(data_dir: &Path, remote: &str, own: bool, from: &str, to: &str) -> Result<String, String> {
    let remote = checked_remote(remote)?;
    let from = clean_folder(from)?;
    let to = clean_folder(to)?;
    if from == to {
        return Ok("The copies are already there.".into());
    }
    if to.starts_with(&format!("{from}/")) || from.starts_with(&format!("{to}/")) {
        return Err("Choose a path that is not inside the current one.".into());
    }
    let bin = binary(data_dir).ok_or_else(|| "Get rclone in Settings, under Backups, first.".to_string())?;
    let config = config_for(data_dir, own)?;
    let output = rclone(&bin, config.as_deref())
        .args(["moveto"])
        .arg(format!("{remote}:{from}"))
        .arg(format!("{remote}:{to}"))
        .output()
        .map_err(|e| format!("Could not start rclone: {e}"))?;
    if output.status.success() {
        return Ok(format!("Moved the copies to {to}."));
    }
    let detail = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if detail.contains("not found")
        || detail.contains("doesn't exist")
        || detail.contains("does not exist")
        || detail.contains("directory not found")
    {
        let _ = mkdir(&bin, config.as_deref(), remote, &to);
        return Ok(format!("The next copies will go to {to}."));
    }
    Err(public_error(&output.stderr, "The folder could not be moved."))
}

/// Copy the cloud folder from one remote onto another.
///
/// The two remotes can live in different rclone configs. A temporary config is
/// used only for that copy, then removed. Neither remote is deleted.
pub fn transfer(
    data_dir: &Path,
    from_remote: &str,
    from_own: bool,
    to_remote: &str,
    to_own: bool,
    folder: Option<&str>,
) -> Result<String, String> {
    let from_remote = checked_remote(from_remote)?.to_string();
    let to_remote = checked_remote(to_remote)?.to_string();
    if from_remote == to_remote && from_own == to_own {
        return Err("That is already this cloud.".into());
    }
    let folder = clean_folder(folder.unwrap_or("Orbit"))?;
    let bin = binary(data_dir).ok_or_else(|| "Get rclone in Settings, under Backups, first.".to_string())?;
    let from_config = config_for(data_dir, from_own)?;
    let to_config = config_for(data_dir, to_own)?;
    let mut cleanup = None;
    let (config, from_name, to_name) = if from_own == to_own {
        (from_config, from_remote.clone(), to_remote.clone())
    } else {
        let from_text = show_remote(&bin, from_config.as_deref(), &from_remote)?;
        let to_text = show_remote(&bin, to_config.as_deref(), &to_remote)?;
        let to_name = if from_remote == to_remote {
            unused_name(&from_text, &format!("{to_remote}-copy"))
        } else {
            to_remote.clone()
        };
        let to_text = if to_name == to_remote {
            to_text
        } else {
            retitle(&to_text, &to_remote, &to_name)
        };
        let path = data_dir.join("tools").join("rclone-transfer.conf");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not prepare the copy: {e}"))?;
        }
        fs::write(&path, format!("{from_text}\n{to_text}\n")).map_err(|e| format!("Could not prepare the copy: {e}"))?;
        set_mode(&path, 0o600);
        cleanup = Some(path.clone());
        (Some(path), from_remote, to_name)
    };
    let result = run_copy(
        &bin,
        config.as_deref(),
        &format!("{from_name}:{folder}"),
        &format!("{to_name}:{folder}"),
    )
    .map(|_| "Copied the copies to the other cloud.".to_string());
    if let Some(path) = cleanup {
        let _ = fs::remove_file(path);
    }
    result
}

/// Make the waiting second sign-in the one Orbit uses, and drop the old one.
pub fn adopt(data_dir: &Path) -> Result<String, String> {
    let config = config_path(data_dir)?;
    if !config.is_file() {
        return Err("There is no other cloud waiting.".into());
    }
    let text = fs::read_to_string(&config).map_err(|e| format!("Could not read the cloud sign-in: {e}"))?;
    if !has_section(&text, "orbit-next") {
        return Err("There is no other cloud waiting.".into());
    }
    let text = rename_remote_text(&text, "orbit-next", "orbit");
    fs::write(&config, &text).map_err(|e| format!("Could not switch clouds: {e}"))?;
    set_mode(&config, 0o600);
    let kind = kind_in_section(&text, "orbit").unwrap_or_default();
    Ok(label_of(&kind).to_string())
}

/// Drop a second sign-in that was only used to copy across. The current one stays.
pub fn drop_next(data_dir: &Path) -> Result<(), String> {
    let Some(bin) = binary(data_dir) else {
        return Ok(());
    };
    let config = config_path(data_dir)?;
    if !config.is_file() {
        return Ok(());
    }
    delete_named(&bin, &config, "orbit-next")
}

/// The service's own web page, when it has one. A server has none.
pub fn page(data_dir: &Path, remote: &str, own: bool, provider: &str) -> Option<String> {
    let kind = kind_of_label(provider).or_else(|| remote_kind(data_dir, remote, own));
    match kind.as_deref() {
        Some("drive") => Some("https://drive.google.com/".into()),
        Some("onedrive") => Some("https://onedrive.live.com/".into()),
        Some("dropbox") => Some("https://www.dropbox.com/home".into()),
        Some("box") => Some("https://app.box.com/".into()),
        Some("mega") => Some("https://mega.nz/fm".into()),
        Some("protondrive") => Some("https://drive.proton.me/".into()),
        _ => None,
    }
}

/// A second sign-in that is waiting to be used, or nothing.
pub fn pending(data_dir: &Path) -> Option<String> {
    let config = config_path(data_dir).ok()?;
    let text = fs::read_to_string(config).ok()?;
    if !has_section(&text, "orbit-next") {
        return None;
    }
    Some(label_of(&kind_in_section(&text, "orbit-next").unwrap_or_default()).to_string())
}

fn oauth(
    bin: &Path,
    config: &Path,
    provider: &str,
    remote_name: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    let token = authorize(bin, config, provider, open, tell)?;
    let _ = delete_named(bin, config, remote_name);
    let output = rclone(bin, Some(config))
        .args(["config", "create", remote_name, provider, "token"])
        .arg(&token)
        .output()
        .map_err(|e| format!("Could not save that cloud: {e}"))?;
    if !output.status.success() {
        return Err(public_error(&output.stderr, "rclone could not save that sign-in."));
    }
    Ok(label_of(provider).into())
}

fn oauth_onedrive(
    bin: &Path,
    config: &Path,
    remote_name: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    let token = authorize(bin, config, "onedrive", open, tell)?;
    let _ = delete_named(bin, config, remote_name);
    let output = rclone(bin, Some(config))
        .args(["config", "create", remote_name, "onedrive", "drive_type", "personal", "token"])
        .arg(&token)
        .output()
        .map_err(|e| format!("Could not save that cloud: {e}"))?;
    if !output.status.success() {
        return Err(public_error(
            &output.stderr,
            "rclone could not save that OneDrive. A work account can be a remote rclone already has.",
        ));
    }
    Ok("OneDrive".into())
}

fn server(
    bin: &Path,
    config: &Path,
    provider: &str,
    remote_name: &str,
    host: &str,
    user: &str,
    password: &str,
    url: &str,
) -> Result<String, String> {
    let host = host.trim();
    let url = url.trim();
    if provider == "webdav" && url.is_empty() {
        return Err("A WebDAV address is needed.".into());
    }
    if provider != "webdav" && host.is_empty() {
        return Err("A server address is needed.".into());
    }
    let obscured = if password.is_empty() {
        String::new()
    } else {
        obscure(bin, password)?
    };
    let _ = delete_named(bin, config, remote_name);
    let mut cmd = rclone(bin, Some(config));
    cmd.args(["config", "create", remote_name, provider]);
    if provider == "webdav" {
        cmd.args(["url", url, "vendor", "other"]);
    } else {
        cmd.args(["host", host]);
    }
    if !user.trim().is_empty() {
        cmd.args(["user", user.trim()]);
    }
    if !obscured.is_empty() {
        cmd.args(["pass", &obscured]);
    }
    let output = cmd.output().map_err(|e| format!("Could not save that server: {e}"))?;
    if !output.status.success() {
        return Err(public_error(&output.stderr, "rclone could not save that server."));
    }
    Ok(label_of(provider).into())
}

/// MEGA and Proton Drive sign in with the account itself, not a browser page.
fn account_login(
    bin: &Path,
    config: &Path,
    provider: &str,
    remote_name: &str,
    user: &str,
    password: &str,
    code: &str,
    mailbox: &str,
) -> Result<String, String> {
    let user = user.trim();
    let code = code.trim();
    let mailbox = mailbox.trim();
    if user.is_empty() {
        return Err("An email address is needed.".into());
    }
    if password.is_empty() {
        return Err("A password is needed.".into());
    }
    let _ = delete_named(bin, config, remote_name);
    let mut cmd = rclone(bin, Some(config));
    // A closed input must not sit on a question. `--obscure` hides the
    // password itself, so a password that looks like an already-hidden one
    // is not stored twice and then rejected.
    cmd.arg("--auto-confirm");
    cmd.args(["config", "create", remote_name, provider]);
    if provider == "protondrive" {
        cmd.args(["username", user, "password", password]);
        if !mailbox.is_empty() {
            cmd.args(["mailbox_password", mailbox]);
        }
    } else {
        cmd.args(["user", user, "pass", password]);
    }
    if !code.is_empty() {
        cmd.args(["2fa", code]);
    }
    cmd.arg("--obscure");
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not save that account: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_thread = std::thread::spawn(move || read_pipe(stdout));
    let err_thread = std::thread::spawn(move || read_pipe(stderr));
    let started = Instant::now();
    let status = loop {
        if started.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            let _ = out_thread.join();
            let _ = err_thread.join();
            return Err("That account did not answer. Check the email, password, and code.".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => {
                let _ = child.kill();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(format!("rclone stopped while saving that account: {e}"));
            }
        }
    };
    let mut detail = err_thread.join().unwrap_or_default();
    if detail.is_empty() {
        detail = out_thread.join().unwrap_or_default();
    } else {
        let _ = out_thread.join();
    }
    if !status.success() {
        let mut shown = String::from_utf8_lossy(&detail).to_string();
        for secret in [password, mailbox, code] {
            if secret.len() >= 4 {
                shown = shown.replace(secret, "••••");
            }
        }
        return Err(public_error(shown.as_bytes(), "That account could not be saved."));
    }
    Ok(label_of(provider).into())
}

fn read_pipe(pipe: Option<impl Read>) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(mut pipe) = pipe {
        let _ = pipe.read_to_end(&mut buf);
    }
    buf
}

/// A finished sign-in can leave 127.0.0.1:53682 busy with nobody listening.
/// That is not another sign-in. Stop an Orbit rclone that is still waiting,
/// then wait the port out instead of refusing the next cloud.
fn prepare_oauth_port(config: &Path, tell: &(dyn Fn(&str) + Send + Sync)) -> Result<(), String> {
    // The pid file is cheap. Looking through every process waits, so that
    // only happens once the port is actually busy.
    clear_stale_sign_in(config);
    let started = Instant::now();
    let mut told = false;
    let mut released = false;
    loop {
        match auth_port() {
            AuthPort::Free | AuthPort::Unknown => return Ok(()),
            AuthPort::Blocked => return Ok(()),
            AuthPort::Busy => {
                if !released {
                    release_our_authorize(config);
                    released = true;
                    continue;
                }
                if !listeners_on_auth_port() {
                    if !told {
                        tell("The last sign-in is letting go of the port. Orbit will try again in a moment.");
                        told = true;
                    }
                    if started.elapsed() > Duration::from_secs(120) {
                        return Err("The last sign-in is still letting go of the port. Wait a minute and try the cloud again.".into());
                    }
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
                if started.elapsed() > Duration::from_secs(4) {
                    return Err("The sign-in page is still open from the last attempt. Close that browser tab and try again.".into());
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        }
    }
}

fn release_our_authorize(config: &Path) {
    clear_stale_sign_in(config);
    for pid in rclone_authorize_pids() {
        kill_pid(pid);
    }
    for pid in listening_pids() {
        if process_is_rclone(pid) {
            kill_pid(pid);
        }
    }
}

/// Processes listening on the sign-in port. Empty when the check cannot be made.
fn listening_pids() -> Vec<u32> {
    #[cfg(windows)]
    {
        let script = "Get-NetTCPConnection -LocalPort 53682 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }";
        let Ok(output) = process::command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
        else {
            return Vec::new();
        };
        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .filter(|pid| *pid > 0)
            .collect();
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

fn authorize(
    bin: &Path,
    config: &Path,
    provider: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    // Orbit's own config, so authorize does not read the rclone the player
    // already has in AppData. An empty file is enough: the token is printed,
    // then saved here afterwards.
    if !config.is_file() {
        let _ = fs::write(config, "");
    }
    clear_stale_sign_in(config);
    // A busy port is not another sign-in. prepare_oauth_port already waited
    // it out. Try anyway, and say so only if rclone still cannot take it.
    match auth_port() {
        AuthPort::Blocked => return authorize_when_port_blocked(bin, config, provider, open, tell),
        AuthPort::Busy | AuthPort::Free | AuthPort::Unknown => {}
    }
    authorize_once(bin, config, provider, open, tell).or_else(|err| recover_authorize(bin, config, provider, open, tell, &err))
}

fn recover_authorize(
    bin: &Path,
    config: &Path,
    provider: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
    err: &str,
) -> Result<String, String> {
    if sign_in_port_failed(err) {
        return authorize_when_port_blocked(bin, config, provider, open, tell);
    }
    if !port_still_busy(err) {
        return Err(err.to_string());
    }
    release_our_authorize(config);
    std::thread::sleep(Duration::from_secs(2));
    match auth_port() {
        AuthPort::Blocked => return authorize_when_port_blocked(bin, config, provider, open, tell),
        AuthPort::Busy | AuthPort::Free | AuthPort::Unknown => {}
    }
    authorize_once(bin, config, provider, open, tell).or_else(|again| {
        if sign_in_port_failed(&again) {
            authorize_when_port_blocked(bin, config, provider, open, tell)
        } else if port_still_busy(&again) {
            Err("The last sign-in is still letting go of the port. Wait a minute and try the cloud again.".into())
        } else {
            Err(again)
        }
    })
}

fn port_still_busy(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("address already in use")
        || lower.contains("only one usage of each socket address")
        || lower.contains("sign-in port is already in use")
}

fn authorize_once(
    bin: &Path,
    config: &Path,
    provider: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    // `--auto-confirm` answers rclone's extra questions with their defaults, so
    // a closed input does not look like the player cancelled. rclone logs the
    // redirect address (`http://127.0.0.1:53682/` or `http://localhost:53682/`)
    // before the real page. Opening that address fails the login. The local
    // `/auth` address is also not what the browser should open: it only
    // redirects, and that redirect is requested again after the login, as a
    // second tab that asks for the account once more.
    let mut child = rclone(bin, Some(config))
        .args(["--auto-confirm", "authorize", provider, "--auth-no-open-browser"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start rclone: {e}"))?;
    let pid_file = config.parent().map(|dir| {
        let path = dir.join("sign-in.pid");
        let _ = fs::write(&path, child.id().to_string());
        path
    });
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let text = Arc::new(Mutex::new(String::new()));
    let link = Arc::new(Mutex::new(None));
    let mut readers = Vec::new();
    // stdout and stderr are different types, so each reader is started on its own.
    if let Some(stdout) = stdout {
        readers.push(read_auth(stdout, &text, &link));
    }
    if let Some(stderr) = stderr {
        readers.push(read_auth(stderr, &text, &link));
    }
    let opened = AtomicBool::new(false);
    let signed = AtomicBool::new(false);
    let started = Instant::now();
    let status = loop {
        if let Some(url) = link.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            if !opened.load(Ordering::SeqCst) {
                opened.store(true, Ordering::SeqCst);
                // The page is handed over and rclone is left running. Killing it
                // here is what turned a slow browser into "the sign-in was cancelled".
                open(&login_page(&url));
            }
        }
        if !signed.load(Ordering::SeqCst) {
            let so_far = text.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if so_far.to_ascii_lowercase().contains("got code") {
                signed.store(true, Ordering::SeqCst);
                tell("signed-in");
            }
        }
        if started.elapsed() > AUTH_WAIT {
            let _ = child.kill();
            for reader in readers {
                let _ = reader.join();
            }
            if let Some(path) = &pid_file {
                let _ = fs::remove_file(path);
            }
            return Err("The sign-in was not finished. Try connecting again.".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => {
                let _ = child.kill();
                for reader in readers {
                    let _ = reader.join();
                }
                if let Some(path) = &pid_file {
                    let _ = fs::remove_file(path);
                }
                return Err(format!("rclone stopped while signing in: {e}"));
            }
        }
    };
    for reader in readers {
        let _ = reader.join();
    }
    if let Some(path) = &pid_file {
        let _ = fs::remove_file(path);
    }
    let collected = text.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if !status.success() {
        return Err(sign_in_failure(&collected));
    }
    token_from(&collected).ok_or_else(|| "rclone did not return a sign-in.".into())
}

/// True when Windows is holding rclone's sign-in port, so the window can say
/// why a permission prompt is about to appear.
pub fn auth_port_needs_help() -> bool {
    matches!(auth_port(), AuthPort::Blocked)
}

enum AuthPort {
    Free,
    Busy,
    Blocked,
    Unknown,
}

/// rclone's sign-in page has to answer on 127.0.0.1:53682. The providers
/// registered that address, so another port cannot be used.
fn auth_port() -> AuthPort {
    match std::net::TcpListener::bind(("127.0.0.1", 53682)) {
        Ok(listener) => {
            drop(listener);
            AuthPort::Free
        }
        Err(err) => {
            let raw = err.raw_os_error();
            if err.kind() == std::io::ErrorKind::AddrInUse || raw == Some(10048) {
                AuthPort::Busy
            } else if err.kind() == std::io::ErrorKind::PermissionDenied || raw == Some(10013) || raw == Some(13) {
                AuthPort::Blocked
            } else {
                AuthPort::Unknown
            }
        }
    }
}

fn sign_in_port_failed(detail: &str) -> bool {
    // The redirect notice also names port 53682. That notice is printed on a
    // normal sign-in, so the port number alone must not count as this failure.
    detail.to_ascii_lowercase().contains("failed to start auth webserver")
}

/// The redirect notice is rclone talking to someone who made their own app.
/// Orbit did not, and showing that address is what made a blocked port look
/// like a setting the player had to edit.
fn sign_in_failure(detail: &str) -> String {
    if sign_in_port_failed(detail) {
        return if cfg!(windows) {
            "Windows is holding the port the sign-in page needs. Allow the permission prompt, then try the cloud again.".into()
        } else {
            "The sign-in page could not start because its port is in use. Try again in a moment.".into()
        };
    }
    let cleaned = detail
        .lines()
        .filter(|line| !line.to_ascii_lowercase().contains("redirect url"))
        .collect::<Vec<_>>()
        .join(" ");
    public_error(cleaned.as_bytes(), "The sign-in did not finish.")
}

fn clear_stale_sign_in(config: &Path) {
    let Some(dir) = config.parent() else {
        return;
    };
    let pid_path = dir.join("sign-in.pid");
    let Ok(text) = fs::read_to_string(&pid_path) else {
        return;
    };
    let Ok(pid) = text.trim().parse::<u32>() else {
        return;
    };
    if pid == 0 || pid == std::process::id() {
        let _ = fs::remove_file(&pid_path);
        return;
    }
    if process_is_rclone(pid) {
        kill_pid(pid);
        std::thread::sleep(Duration::from_millis(300));
    }
    let _ = fs::remove_file(&pid_path);
}

#[cfg(windows)]
fn process_is_rclone(pid: u32) -> bool {
    let output = process::command("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output();
    let Ok(output) = output else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).to_ascii_lowercase().contains("rclone")
}

#[cfg(not(windows))]
fn process_is_rclone(pid: u32) -> bool {
    fs::read_to_string(format!("/proc/{pid}/comm"))
        .map(|text| text.to_ascii_lowercase().contains("rclone"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = process::command("taskkill").args(["/PID", &pid.to_string(), "/F"]).output();
}

#[cfg(not(windows))]
fn kill_pid(pid: u32) {
    let _ = process::command("kill").arg(pid.to_string()).output();
}

/// True when something is actually listening, not merely holding the port
/// after a finished sign-in.
fn listeners_on_auth_port() -> bool {
    #[cfg(windows)]
    {
        // netstat's state word is translated. Listen is not.
        return !listening_pids().is_empty();
    }
    #[cfg(not(windows))]
    {
        for path in ["/proc/net/tcp", "/proc/net/tcp6"] {
            let Ok(text) = fs::read_to_string(path) else { continue };
            for line in text.lines().skip(1) {
                let parts: Vec<_> = line.split_whitespace().collect();
                if parts.len() < 4 || parts[3] != "0A" {
                    continue;
                }
                let Some(port) = parts[1].rsplit(':').next() else { continue };
                if u16::from_str_radix(port, 16) == Ok(53682) {
                    return true;
                }
            }
        }
        false
    }
}

/// rclone authorize started by Orbit, including one the elevated script left
/// running. That script does not write the pid file.
fn rclone_authorize_pids() -> Vec<u32> {
    #[cfg(windows)]
    {
        let script = "Get-CimInstance Win32_Process -Filter \"Name = 'rclone.exe'\" | ForEach-Object { if ($_.CommandLine -match 'authorize' -and $_.CommandLine -match 'auth-no-open-browser') { $_.ProcessId } }";
        let Ok(output) = process::command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
        else {
            return Vec::new();
        };
        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect();
    }
    #[cfg(not(windows))]
    {
        let mut pids = Vec::new();
        let Ok(dir) = fs::read_dir("/proc") else {
            return pids;
        };
        for entry in dir.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok()) else {
                continue;
            };
            let Ok(cmd) = fs::read(format!("/proc/{pid}/cmdline")) else {
                continue;
            };
            let text = String::from_utf8_lossy(&cmd);
            if text.contains("rclone") && text.contains("authorize") && text.contains("auth-no-open-browser") {
                pids.push(pid);
            }
        }
        pids
    }
}

fn authorize_when_port_blocked(
    bin: &Path,
    config: &Path,
    provider: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    #[cfg(windows)]
    {
        authorize_with_port_freed(bin, config, provider, open, tell)
    }
    #[cfg(not(windows))]
    {
        let _ = (bin, config, provider, open, tell);
        Err("The sign-in page could not start because its port is in use. Try again in a moment.".into())
    }
}

/// Windows often reserves 53682 for Hyper-V, WSL, or Docker, and then refuses
/// the bind even though nothing is listening. rclone cannot use another port:
/// the cloud services registered this one. The documented fix is to move the
/// dynamic range past it and restart the service that reserved it, then bind
/// while that reservation is gone.
#[cfg(windows)]
fn authorize_with_port_freed(
    bin: &Path,
    config: &Path,
    provider: &str,
    open: &(dyn Fn(&str) + Send + Sync),
    tell: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    if !matches!(provider, "drive" | "onedrive" | "dropbox" | "box") {
        return Err("That cloud could not be signed in.".into());
    }
    let Some(dir) = config.parent() else {
        return Err("The sign-in page could not start.".into());
    };
    let script = dir.join("sign-in.ps1");
    let stdout_path = dir.join("sign-in-out.txt");
    let stderr_path = dir.join("sign-in-err.txt");
    let url_path = dir.join("sign-in-url.txt");
    for path in [&stdout_path, &stderr_path, &url_path] {
        let _ = fs::remove_file(path);
    }
    let body = sign_in_script(bin, config, provider, &stdout_path, &stderr_path, &url_path);
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend(body.as_bytes());
    fs::write(&script, bytes).map_err(|e| format!("Could not prepare the sign-in. {e}"))?;

    let opened = AtomicBool::new(false);
    let signed = AtomicBool::new(false);
    let stop = AtomicBool::new(false);
    let result = std::thread::scope(|scope| {
        scope.spawn(|| {
            let started = Instant::now();
            while !stop.load(Ordering::SeqCst) && started.elapsed() < AUTH_WAIT {
                if let Ok(text) = fs::read_to_string(&url_path) {
                    if let Some(url) = auth_url(text.trim()) {
                        if !opened.swap(true, Ordering::SeqCst) {
                            open(&login_page(&url));
                        }
                    }
                }
                if !signed.load(Ordering::SeqCst) {
                    let so_far = fs::read_to_string(&stdout_path).unwrap_or_default()
                        + &fs::read_to_string(&stderr_path).unwrap_or_default();
                    if so_far.to_ascii_lowercase().contains("got code") {
                        signed.store(true, Ordering::SeqCst);
                        tell("signed-in");
                    }
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        });
        let ran = run_elevated(&script);
        stop.store(true, Ordering::SeqCst);
        ran
    })?;
    if !result {
        return Err("The permission prompt was dismissed, so the sign-in port is still blocked.".into());
    }
    let collected = fs::read_to_string(&stdout_path).unwrap_or_default();
    if let Some(token) = token_from(&collected) {
        return Ok(token);
    }
    let detail = fs::read_to_string(&stderr_path).unwrap_or_default();
    Err(sign_in_failure(&detail))
}

#[cfg(windows)]
fn run_elevated(script: &Path) -> Result<bool, String> {
    let path = script.display().to_string().replace('\'', "''");
    let command = format!(
        "Start-Process -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{path}' -Verb RunAs -Wait"
    );
    let output = process::command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .output()
        .map_err(|e| format!("Windows did not show the permission prompt. {e}"))?;
    if output.status.success() {
        return Ok(true);
    }
    let detail = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    if detail.to_ascii_lowercase().contains("cancel") {
        return Ok(false);
    }
    Err("Windows did not free the sign-in port. Allow the permission prompt and try the cloud again.".into())
}

#[cfg(windows)]
fn sign_in_script(bin: &Path, config: &Path, provider: &str, stdout_path: &Path, stderr_path: &Path, url_path: &Path) -> String {
    // Paths are PowerShell single-quoted literals. The process argument string
    // then wraps the config in double quotes, which is what Windows itself reads.
    format!(
        r#"$ErrorActionPreference = 'Continue'
$bin = {bin}
$config = {config}
$urlFile = {url}
$outFile = {stdout}
$errFile = {stderr}
netsh int ipv4 set dynamicport tcp start=53683 num=11853 | Out-Null
try {{ Stop-Service -Name winnat -Force -ErrorAction SilentlyContinue }} catch {{}}
try {{
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo.FileName = $bin
  $p.StartInfo.Arguments = '--config "' + $config.Replace('"','') + '" --auto-confirm authorize {provider} --auth-no-open-browser'
  $p.StartInfo.UseShellExecute = $false
  $p.StartInfo.RedirectStandardOutput = $true
  $p.StartInfo.RedirectStandardError = $true
  $p.StartInfo.CreateNoWindow = $true
  $null = $p.Start()
  $out = New-Object System.Text.StringBuilder
  $err = New-Object System.Text.StringBuilder
  $p.add_OutputDataReceived([System.Diagnostics.DataReceivedEventHandler] {{
    param($sender, $e)
    if ($e.Data) {{ [void]$out.AppendLine($e.Data) }}
  }})
  $p.add_ErrorDataReceived([System.Diagnostics.DataReceivedEventHandler] {{
    param($sender, $e)
    if (-not $e.Data) {{ return }}
    [void]$err.AppendLine($e.Data)
    $found = [regex]::Match($e.Data, 'https?://\S+/auth\?\S*state=\S*')
    if ($found.Success) {{
      $url = $found.Value.TrimEnd('.', ',', [char]34, [char]39)
      Set-Content -LiteralPath $urlFile -Value $url -Encoding ascii
    }}
  }})
  $p.BeginOutputReadLine()
  $p.BeginErrorReadLine()
  Start-Sleep -Seconds 1
  try {{ Start-Service -Name winnat -ErrorAction SilentlyContinue }} catch {{}}
  if (-not $p.WaitForExit(300000)) {{ try {{ $p.Kill() }} catch {{}} }}
  Set-Content -LiteralPath $outFile -Value $out.ToString() -Encoding utf8
  Set-Content -LiteralPath $errFile -Value $err.ToString() -Encoding utf8
  exit 0
}} finally {{
  try {{ Start-Service -Name winnat -ErrorAction SilentlyContinue }} catch {{}}
}}
"#,
        bin = ps_single(&bin.display().to_string()),
        config = ps_single(&config.display().to_string()),
        provider = provider,
        url = ps_single(&url_path.display().to_string()),
        stdout = ps_single(&stdout_path.display().to_string()),
        stderr = ps_single(&stderr_path.display().to_string()),
    )
}

#[cfg(windows)]
fn ps_single(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

fn read_auth(
    stream: impl Read + Send + 'static,
    text: &Arc<Mutex<String>>,
    link: &Arc<Mutex<Option<String>>>,
) -> std::thread::JoinHandle<()> {
    let text = Arc::clone(text);
    let link = Arc::clone(link);
    std::thread::spawn(move || collect_auth(stream, &text, &link))
}

fn collect_auth(stream: impl Read, text: &Mutex<String>, link: &Mutex<Option<String>>) {
    let reader = BufReader::new(stream);
    for line in reader.lines().map_while(Result::ok) {
        if link.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
            if let Some(url) = auth_url(&line) {
                *link.lock().unwrap_or_else(|e| e.into_inner()) = Some(url);
            }
        }
        let mut buf = text.lock().unwrap_or_else(|e| e.into_inner());
        buf.push_str(&line);
        buf.push('\n');
    }
}

/// The page rclone asks the browser to open.
///
/// A notice on the line before that names the redirect address,
/// `http://127.0.0.1:53682/` or `http://localhost:53682/`. Opening that address
/// hits the local page with no code, and rclone treats it as a failed login.
/// The real page is the one with `/auth` and `state=`.
fn auth_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(|word| word.trim_matches(|c: char| matches!(c, '"' | '\'' | ',' | '<' | '>' | '(' | ')' | '`')))
        .find(|word| {
            let lower = word.to_ascii_lowercase();
            (lower.starts_with("http://") || lower.starts_with("https://"))
                && lower.contains("/auth")
                && lower.contains("state=")
        })
        .map(|word| word.trim_end_matches('.').to_string())
}

/// The provider's own login page, not rclone's local redirect.
///
/// Opening `http://127.0.0.1:53682/auth?state=` makes the browser follow a
/// temporary redirect. After the account is accepted, that redirect is
/// requested again and a second tab asks for the login once more.
fn login_page(local: &str) -> String {
    if !is_local_auth(local) {
        return local.to_string();
    }
    for _ in 0..8 {
        if let Some(url) = redirect_of(local) {
            if !is_local_auth(&url) {
                return url;
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    local.to_string()
}

fn is_local_auth(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.contains("127.0.0.1:53682") || lower.contains("localhost:53682") || lower.contains("[::1]:53682"))
        && lower.contains("/auth")
        && lower.contains("state=")
}

fn redirect_of(local: &str) -> Option<String> {
    let path = local
        .split_once("://")
        .and_then(|(_, rest)| rest.find('/').map(|index| &rest[index..]))
        .unwrap_or("/");
    let mut stream = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], 53682)),
        Duration::from_millis(400),
    )
    .ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok()?;
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:53682\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf).ok()?;
    let header = buf.split("\r\n\r\n").next().unwrap_or(&buf);
    location_from(header)
}

fn location_from(header: &str) -> Option<String> {
    for line in header.lines() {
        let Some((name, value)) = line.split_once(':') else { continue };
        if name.eq_ignore_ascii_case("location") {
            let url = value.trim();
            if url.starts_with("http://") || url.starts_with("https://") {
                return Some(url.to_string());
            }
        }
    }
    None
}

fn token_from(stdout: &str) -> Option<String> {
    let start = stdout.find('{')?;
    let end = stdout.rfind('}')?;
    if end < start {
        return None;
    }
    let token = stdout[start..=end].trim().to_string();
    if token.is_empty() { None } else { Some(token) }
}

fn obscure(bin: &Path, password: &str) -> Result<String, String> {
    let output = rclone(bin, None)
        .arg("obscure")
        .arg(password)
        .output()
        .map_err(|_| "Could not save that password.".to_string())?;
    if !output.status.success() {
        return Err("Could not save that password.".into());
    }
    let obscured = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if obscured.is_empty() {
        return Err("Could not save that password.".into());
    }
    Ok(obscured)
}

fn mkdir(bin: &Path, config: Option<&Path>, remote: &str, folder: &str) -> Result<(), String> {
    let output = rclone(bin, config)
        .args(["mkdir", &format!("{remote}:{folder}")])
        .output()
        .map_err(|e| format!("Could not reach that cloud: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(public_error(&output.stderr, "rclone could not reach that cloud."))
}

fn delete_named(bin: &Path, config: &Path, name: &str) -> Result<(), String> {
    if !config.is_file() {
        return Ok(());
    }
    let output = rclone(bin, Some(config))
        .args(["config", "delete", name])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if detail.contains("not found") || detail.contains("doesn't exist") || detail.contains("does not exist") {
        return Ok(());
    }
    Err(public_error(&output.stderr, "Could not forget that cloud."))
}

fn rclone(bin: &Path, config: Option<&Path>) -> std::process::Command {
    let mut cmd = process::command(bin);
    cmd.stdin(Stdio::null());
    if let Some(config) = config {
        cmd.env("RCLONE_CONFIG", config);
    }
    cmd
}

fn config_path(data_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("rclone.conf"))
}

fn binary(data_dir: &Path) -> Option<PathBuf> {
    let own = data_dir.join("tools").join(binary_name());
    if own.is_file() {
        return Some(own);
    }
    which(binary_name())
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

/// The current rclone release, as published next to the download.
async fn latest_release() -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let text = client
        .get("https://downloads.rclone.org/version.txt")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;
    let line = text.lines().next()?.trim();
    if version_parts(line).is_some() { Some(line.to_string()) } else { None }
}

fn version_parts(text: &str) -> Option<(u64, u64, u64)> {
    let start = text.find('v')?;
    let rest = text.get(start + 1..)?;
    let mut nums = rest.split(|c: char| !c.is_ascii_digit());
    let major = nums.next()?.parse::<u64>().ok()?;
    let minor = nums.next()?.parse::<u64>().ok()?;
    let patch = nums.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn version_newer(latest: &str, current: &str) -> bool {
    match (version_parts(latest), version_parts(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

fn version_of(bin: &Path) -> Option<String> {
    let output = process::command(bin).arg("version").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

fn binary_name() -> &'static str {
    if cfg!(windows) { "rclone.exe" } else { "rclone" }
}

fn archive_name() -> Result<&'static str, String> {
    let name = if cfg!(windows) && cfg!(target_arch = "x86_64") {
        "rclone-current-windows-amd64.zip"
    } else if cfg!(windows) && cfg!(target_arch = "aarch64") {
        "rclone-current-windows-arm64.zip"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        "rclone-current-linux-amd64.zip"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        "rclone-current-linux-arm64.zip"
    } else {
        return Err("Cloud saves are not set up for this system.".into());
    };
    if allowed_archive(name) {
        Ok(name)
    } else {
        Err("Cloud saves are not set up for this system.".into())
    }
}

fn allowed_archive(name: &str) -> bool {
    matches!(
        name,
        "rclone-current-windows-amd64.zip"
            | "rclone-current-windows-arm64.zip"
            | "rclone-current-linux-amd64.zip"
            | "rclone-current-linux-arm64.zip"
    )
}

async fn download(url: &str, dest: &Path) -> Result<(), String> {
    let name = url.rsplit('/').next().unwrap_or("");
    if !url.starts_with("https://downloads.rclone.org/rclone-current-") || !allowed_archive(name) {
        return Err("Orbit will not download rclone from anywhere else.".into());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not download rclone: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Could not download rclone ({}).", response.status()));
    }
    if response.content_length().is_some_and(|len| len > FETCH_CAP) {
        return Err("The rclone download was larger than expected.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("The rclone download stopped: {e}"))?;
    if bytes.len() as u64 > FETCH_CAP {
        return Err("The rclone download was larger than expected.".into());
    }
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn unpack(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Could not unpack rclone: {e}"))?;
    let mut unzip = process::command("unzip");
    unzip.args(["-o", "-q"]).arg(archive).arg("-d").arg(dest);
    if ran(&mut unzip) {
        return Ok(());
    }
    let mut python = process::command("python3");
    python
        .args(["-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])"])
        .arg(archive)
        .arg(dest);
    if ran(&mut python) {
        return Ok(());
    }
    let mut tar = process::command("tar");
    tar.args(["-xf"]).arg(archive).arg("-C").arg(dest);
    if ran(&mut tar) {
        return Ok(());
    }
    Err("Could not unpack rclone. unzip, python3, or tar is needed.".into())
}

fn ran(cmd: &mut std::process::Command) -> bool {
    cmd.stdin(Stdio::null())
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn find_binary(root: &Path) -> Option<PathBuf> {
    find_named(root, binary_name(), 0)
}

fn find_named(root: &Path, name: &str, depth: u8) -> Option<PathBuf> {
    if depth > 4 || !root.is_dir() {
        return None;
    }
    let direct = root.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_named(&path, name, depth + 1) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) {}

fn copy_games(
    bin: &Path,
    config: Option<&Path>,
    data_dir: &Path,
    backup_root: Option<&str>,
    remote: &str,
    folder: &str,
    games: &[CloudGame],
) -> Result<String, String> {
    if games.is_empty() {
        return Err("Choose a game first.".into());
    }
    let source = saves::root_of(data_dir, backup_root);
    let mut sent = 0usize;
    let mut missing = Vec::new();
    for game in games {
        let relatives = saves::existing_relatives(
            data_dir,
            backup_root,
            &game.id,
            &game.title,
            game.publisher.as_deref(),
        );
        if relatives.is_empty() {
            missing.push(game.title.clone());
            continue;
        }
        for relative in relatives {
            let Some(relative) = safe_relative(&relative) else {
                continue;
            };
            let local = under(&source, &relative);
            if !local.is_dir() {
                continue;
            }
            run_copy(bin, config, &local.to_string_lossy(), &format!("{remote}:{folder}/{relative}"))?;
            sent += 1;
        }
    }
    if sent == 0 {
        return Err(if missing.len() == 1 {
            format!("Back up {} on this PC first.", missing[0])
        } else {
            "Back up a chosen game on this PC first.".into()
        });
    }
    if missing.is_empty() {
        Ok("Sent the chosen copies.".into())
    } else {
        Ok(format!("Sent the chosen copies. These had no folder yet: {}.", missing.join(", ")))
    }
}

fn run_copy(bin: &Path, config: Option<&Path>, from: &str, to: &str) -> Result<(), String> {
    let output = rclone(bin, config)
        .args(["copy", "--update", "--retries", "2", "--low-level-retries", "3", "--"])
        .arg(from)
        .arg(to)
        .output()
        .map_err(|e| format!("Could not start rclone: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(public_error(&output.stderr, "rclone did not finish."))
    }
}

fn show_remote(bin: &Path, config: Option<&Path>, name: &str) -> Result<String, String> {
    let output = rclone(bin, config)
        .args(["config", "show", name])
        .output()
        .map_err(|e| format!("Could not read that cloud: {e}"))?;
    if !output.status.success() {
        return Err(public_error(&output.stderr, "That cloud is not connected."));
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !text.contains('[') {
        return Err("That cloud is not connected.".into());
    }
    Ok(text)
}

fn config_for(data_dir: &Path, own: bool) -> Result<Option<PathBuf>, String> {
    if own {
        return Ok(None);
    }
    let path = config_path(data_dir)?;
    if !path.is_file() {
        return Err("Connect a cloud first.".into());
    }
    Ok(Some(path))
}

fn orbit_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    let safe = !name.is_empty()
        && name.len() <= 40
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--");
    if safe && (name == "orbit" || name.starts_with("orbit-")) {
        return Ok(name);
    }
    Err("That cloud could not be saved.".into())
}

fn checked_remote(name: &str) -> Result<&str, String> {
    let name = name.trim().trim_end_matches(':');
    if name.is_empty() || name.contains(['/', '\\', ':', '\0']) {
        return Err("That cloud is not connected.".into());
    }
    Ok(name)
}

fn clean_folder(folder: &str) -> Result<String, String> {
    let folder = folder.trim().replace('\\', "/");
    let folder = folder.trim_matches('/');
    if folder.is_empty() {
        return Ok("Orbit".into());
    }
    if folder.contains(':') || folder.contains('\0') {
        return Err("That path cannot be used on the cloud.".into());
    }
    if folder.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err("That path cannot be used on the cloud.".into());
    }
    Ok(folder.to_string())
}

fn safe_relative(relative: &str) -> Option<String> {
    let relative = relative.replace('\\', "/");
    let relative = relative.trim_matches('/');
    if relative.is_empty() || relative.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return None;
    }
    Some(relative.to_string())
}

fn under(root: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .filter(|part| !part.is_empty())
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

struct IniSection {
    name: String,
    lines: Vec<String>,
}

fn parse_ini(text: &str) -> (Vec<String>, Vec<IniSection>) {
    let mut preamble = Vec::new();
    let mut sections = Vec::new();
    let mut current: Option<IniSection> = None;
    for line in text.lines() {
        if let Some(name) = section_header(line) {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some(IniSection { name, lines: vec![line.to_string()] });
        } else if let Some(section) = current.as_mut() {
            section.lines.push(line.to_string());
        } else {
            preamble.push(line.to_string());
        }
    }
    if let Some(section) = current {
        sections.push(section);
    }
    (preamble, sections)
}

fn section_header(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() > 2 {
        let name = trimmed[1..trimmed.len() - 1].trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

fn write_ini(preamble: &[String], sections: &[IniSection]) -> String {
    let mut out = String::new();
    for line in preamble {
        out.push_str(line);
        out.push('\n');
    }
    for section in sections {
        for line in &section.lines {
            out.push_str(line);
            out.push('\n');
        }
        out.push('\n');
    }
    out
}

fn has_section(text: &str, name: &str) -> bool {
    parse_ini(text).1.iter().any(|section| section.name == name)
}

fn rename_remote_text(text: &str, from: &str, to: &str) -> String {
    let (preamble, mut sections) = parse_ini(text);
    sections.retain(|section| section.name != to);
    for section in &mut sections {
        if section.name == from {
            section.name = to.to_string();
            if let Some(header) = section.lines.first_mut() {
                *header = format!("[{to}]");
            }
        }
    }
    write_ini(&preamble, &sections)
}

fn kind_in(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("type") else {
            continue;
        };
        let Some(rest) = rest.trim().strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim();
        if !rest.is_empty() {
            return Some(rest.to_string());
        }
    }
    None
}

fn kind_in_section(text: &str, name: &str) -> Option<String> {
    let section = parse_ini(text).1.into_iter().find(|section| section.name == name)?;
    kind_in(&section.lines.join("\n"))
}

fn retitle(section: &str, from: &str, to: &str) -> String {
    let mut lines = section.lines();
    let header = lines.next().unwrap_or("");
    let header = if header.trim() == format!("[{from}]") {
        format!("[{to}]")
    } else {
        header.to_string()
    };
    let mut out = header;
    out.push('\n');
    for line in lines {
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn unused_name(text: &str, preferred: &str) -> String {
    if has_section(text, preferred) {
        format!("{preferred}-2")
    } else {
        preferred.to_string()
    }
}

fn kind_of_label(provider: &str) -> Option<String> {
    match provider {
        "Google Drive" | "drive" => Some("drive".into()),
        "OneDrive" | "onedrive" => Some("onedrive".into()),
        "Dropbox" | "dropbox" => Some("dropbox".into()),
        "Box" | "box" => Some("box".into()),
        "MEGA" | "mega" => Some("mega".into()),
        "Proton Drive" | "protondrive" => Some("protondrive".into()),
        "WebDAV" | "webdav" => Some("webdav".into()),
        "FTP" | "ftp" => Some("ftp".into()),
        "SFTP" | "sftp" => Some("sftp".into()),
        "SMB" | "smb" => Some("smb".into()),
        _ => None,
    }
}

fn remote_kind(data_dir: &Path, remote: &str, own: bool) -> Option<String> {
    let remote = checked_remote(remote).ok()?;
    let bin = binary(data_dir)?;
    let config = config_for(data_dir, own).ok()?;
    let output = rclone(&bin, config.as_deref()).args(["config", "show", remote]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    kind_in(&String::from_utf8_lossy(&output.stdout))
}

fn label_of(provider: &str) -> &'static str {
    match provider {
        "drive" => "Google Drive",
        "onedrive" => "OneDrive",
        "dropbox" => "Dropbox",
        "box" => "Box",
        "mega" => "MEGA",
        "protondrive" => "Proton Drive",
        "webdav" => "WebDAV",
        "ftp" => "FTP",
        "sftp" => "SFTP",
        "smb" => "SMB",
        _ => "Cloud",
    }
}

/// A short reason for the player. A token or a password must not ride along in it.
fn public_error(bytes: &[u8], fallback: &str) -> String {
    let detail = String::from_utf8_lossy(bytes);
    let detail = strip_secret(detail.trim());
    if detail.is_empty() {
        fallback.into()
    } else {
        let detail: String = detail.chars().take(180).collect();
        format!("{fallback} {detail}")
    }
}

fn strip_secret(text: &str) -> String {
    let Some(start) = text.find('{') else {
        return text.to_string();
    };
    let Some(end) = text.rfind('}') else {
        return text.to_string();
    };
    if end < start {
        return text.to_string();
    }
    format!("{}{}", &text[..start], &text[end + 1..]).split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{allowed_archive, clean_folder, is_local_auth, location_from, orbit_name, page, port_still_busy, rename_remote_text, sign_in_failure, token_from};

    #[test]
    fn a_cloud_path_stays_inside_the_cloud() {
        assert_eq!(clean_folder("").unwrap(), "Orbit");
        assert_eq!(clean_folder(" Games/Saves ").unwrap(), "Games/Saves");
        assert_eq!(clean_folder("Games\\Saves").unwrap(), "Games/Saves");
        assert!(clean_folder("../nope").is_err());
        assert!(clean_folder("C:/Windows").is_err());
        assert!(clean_folder("a/../b").is_err());
    }

    #[test]
    fn another_cloud_takes_the_place_of_this_one() {
        let text = "[orbit]\ntype = drive\n\n[orbit-next]\ntype = dropbox\n";
        let next = rename_remote_text(text, "orbit-next", "orbit");
        assert!(next.contains("[orbit]"));
        assert!(!next.contains("[orbit-next]"));
        assert!(next.contains("type = dropbox"));
        assert!(!next.contains("type = drive"));
    }

    #[test]
    fn a_blocked_port_is_not_described_as_a_redirect_setting() {
        let detail = "2026/10/16 22:31:52 NOTICE: Make sure your Redirect URL is set to \"http://localhost:53682/\" in your custom config.\nError: config failed to refresh token: failed to start auth webserver: listen tcp 127.0.0.1:53682: bind: An attempt was made to access a socket in a way forbidden by its access permissions.";
        let shown = sign_in_failure(detail);
        assert!(!shown.to_ascii_lowercase().contains("redirect url"));
        assert!(!shown.contains("localhost:53682"));
        assert!(shown.contains("port"));
    }

    #[test]
    fn another_cloud_gets_its_own_name() {
        assert_eq!(orbit_name("orbit").unwrap(), "orbit");
        assert_eq!(orbit_name("orbit-abc123").unwrap(), "orbit-abc123");
        assert!(orbit_name("mydrive").is_err());
        assert!(orbit_name("orbit-../x").is_err());
        assert!(orbit_name("orbit-").is_err());
    }

    #[test]
    fn a_server_has_no_web_page() {
        assert_eq!(page(Path::new("."), "orbit", false, "FTP"), None);
        assert_eq!(page(Path::new("."), "orbit", false, "Google Drive").as_deref(), Some("https://drive.google.com/"));
        assert_eq!(page(Path::new("."), "orbit", false, "Box").as_deref(), Some("https://app.box.com/"));
        assert_eq!(page(Path::new("."), "orbit", false, "MEGA").as_deref(), Some("https://mega.nz/fm"));
        assert_eq!(page(Path::new("."), "orbit", false, "Proton Drive").as_deref(), Some("https://drive.proton.me/"));
    }

    #[test]
    fn the_login_page_is_not_the_local_redirect() {
        assert!(is_local_auth("http://127.0.0.1:53682/auth?state=abc"));
        assert!(!is_local_auth("https://accounts.google.com/o/oauth2/auth?state=abc"));
        assert_eq!(
            location_from("HTTP/1.1 307 Temporary Redirect\r\nLocation: https://accounts.google.com/o/oauth2/auth?state=abc\r\n").as_deref(),
            Some("https://accounts.google.com/o/oauth2/auth?state=abc"),
        );
        assert!(location_from("HTTP/1.1 200 OK\r\n").is_none());
    }

    fn a_finished_sign_in_is_not_another_sign_in() {
        assert!(port_still_busy("bind: address already in use"));
        assert!(port_still_busy("Only one usage of each socket address"));
        assert!(!port_still_busy("The sign-in did not finish."));
    }

    #[test]
    fn a_sign_in_is_the_json_rclone_prints() {
        let raw = "NOTICE: waiting\n{\"access_token\":\"abc\",\"token_type\":\"Bearer\"}\n";
        assert_eq!(
            token_from(raw).as_deref(),
            Some("{\"access_token\":\"abc\",\"token_type\":\"Bearer\"}")
        );
        assert!(token_from("no token").is_none());
    }

    #[test]
    fn only_the_official_builds_are_downloaded() {
        assert!(allowed_archive("rclone-current-linux-amd64.zip"));
        assert!(allowed_archive("rclone-current-windows-arm64.zip"));
        assert!(!allowed_archive("rclone-current-osx-amd64.zip"));
        assert!(!allowed_archive("rclone.zip"));
    }
}
