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
    open: &(dyn Fn(&str) + Send + Sync),
) -> Result<String, String> {
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
    let config = config_path(data_dir)?;
    let provider = provider.trim();
    let remote_name = remote_name.trim();
    if remote_name != "orbit" && remote_name != "orbit-next" {
        return Err("That cloud could not be saved.".into());
    }
    let folder = clean_folder(folder)?;
    let label = match provider {
        "drive" | "dropbox" | "box" => oauth(&bin, &config, provider, remote_name, open)?,
        "onedrive" => oauth_onedrive(&bin, &config, remote_name, open)?,
        "webdav" | "ftp" | "sftp" | "smb" => server(&bin, &config, provider, remote_name, host, user, password, url)?,
        other => return Err(format!("Orbit does not know how to connect {other}.")),
    };
    set_mode(&config, 0o600);
    if let Err(reason) = mkdir(&bin, Some(&config), remote_name, &folder) {
        let _ = delete_named(&bin, &config, remote_name);
        return Err(reason);
    }
    Ok(label)
}

/// Remotes rclone already has, from its own config, not Orbit's.
pub fn remotes(data_dir: &Path) -> Result<Vec<String>, String> {
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
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
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
    let remote = checked_remote(remote)?;
    let folder = clean_folder(folder)?;
    mkdir(&bin, None, remote, &folder)
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
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
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
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
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
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
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
) -> Result<String, String> {
    let token = authorize(bin, config, provider, open)?;
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
) -> Result<String, String> {
    let token = authorize(bin, config, "onedrive", open)?;
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

fn authorize(bin: &Path, config: &Path, provider: &str, open: &(dyn Fn(&str) + Send + Sync)) -> Result<String, String> {
    // Orbit's own config, so authorize does not read the rclone the player
    // already has in AppData. An empty file is enough: the token is printed,
    // then saved here afterwards.
    if !config.is_file() {
        let _ = fs::write(config, "");
    }
    // `--auto-confirm` answers rclone's extra questions with their defaults, so
    // a closed input does not look like the player cancelled. rclone logs the
    // redirect address (`http://127.0.0.1:53682/`) before the real page. Opening
    // that address is what fails the login: it is not the sign-in page. Only
    // `.../auth?state=` is opened, which is the page rclone itself would open.
    let mut child = rclone(bin, Some(config))
        .args(["--auto-confirm", "authorize", provider, "--auth-no-open-browser"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start rclone: {e}"))?;
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
    let started = Instant::now();
    let status = loop {
        if let Some(url) = link.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            if !opened.load(Ordering::SeqCst) {
                opened.store(true, Ordering::SeqCst);
                // The page is handed over and rclone is left running. Killing it
                // here is what turned a slow browser into "the sign-in was cancelled".
                open(&url);
            }
        }
        if started.elapsed() > AUTH_WAIT {
            let _ = child.kill();
            for reader in readers {
                let _ = reader.join();
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
                return Err(format!("rclone stopped while signing in: {e}"));
            }
        }
    };
    for reader in readers {
        let _ = reader.join();
    }
    let collected = text.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if !status.success() {
        return Err(public_error(collected.as_bytes(), "The sign-in did not finish."));
    }
    token_from(&collected).ok_or_else(|| "rclone did not return a sign-in.".into())
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

    use super::{allowed_archive, clean_folder, page, rename_remote_text, token_from};

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
    fn a_server_has_no_web_page() {
        assert_eq!(page(Path::new("."), "orbit", false, "FTP"), None);
        assert_eq!(page(Path::new("."), "orbit", false, "Google Drive").as_deref(), Some("https://drive.google.com/"));
        assert_eq!(page(Path::new("."), "orbit", false, "Box").as_deref(), Some("https://app.box.com/"));
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
