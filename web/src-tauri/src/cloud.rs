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
}

pub fn status(data_dir: &Path) -> CloudStatus {
    let own = data_dir.join("tools").join(binary_name());
    if own.is_file() {
        return CloudStatus {
            ready: true,
            version: version_of(&own).unwrap_or_default(),
            placed: true,
        };
    }
    match which(binary_name()) {
        Some(path) => CloudStatus {
            ready: true,
            version: version_of(&path).unwrap_or_default(),
            placed: false,
        },
        None => CloudStatus {
            ready: false,
            version: String::new(),
            placed: false,
        },
    }
}

/// Download the official rclone build into Orbit's folder. Not a system install.
pub async fn fetch(data_dir: &Path) -> Result<String, String> {
    if let Some(path) = binary(data_dir) {
        return Ok(format!(
            "rclone is ready ({})",
            version_of(&path).unwrap_or_else(|| "installed".into())
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

/// Sign in to a cloud, or save a server, as the remote named `orbit`.
///
/// A failed check removes that remote again. It does not touch a remote the
/// player already had in rclone.
pub fn connect(
    data_dir: &Path,
    provider: &str,
    host: &str,
    user: &str,
    password: &str,
    url: &str,
) -> Result<String, String> {
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
    let config = config_path(data_dir)?;
    let provider = provider.trim();
    let label = match provider {
        "drive" | "dropbox" | "box" => oauth(&bin, &config, provider)?,
        "onedrive" => oauth_onedrive(&bin, &config)?,
        "webdav" | "ftp" | "sftp" | "smb" => server(&bin, &config, provider, host, user, password, url)?,
        other => return Err(format!("Orbit does not know how to connect {other}.")),
    };
    set_mode(&config, 0o600);
    if let Err(reason) = mkdir(&bin, Some(&config), "orbit") {
        let _ = delete_remote(&bin, &config);
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
pub fn attach(data_dir: &Path, remote: &str) -> Result<(), String> {
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
    let remote = remote.trim().trim_end_matches(':');
    if remote.is_empty() {
        return Err("Choose a remote first.".into());
    }
    mkdir(&bin, None, remote)
}

/// Forget Orbit's remote. A remote rclone already had is left alone: this only
/// deletes `orbit` from Orbit's own config.
pub fn forget(data_dir: &Path) -> Result<(), String> {
    let Some(bin) = binary(data_dir) else {
        return Ok(());
    };
    let config = config_path(data_dir)?;
    if !config.is_file() {
        return Ok(());
    }
    delete_remote(&bin, &config)
}

pub fn copy(data_dir: &Path, backup_root: Option<&str>, remote: &str, own: bool, up: bool) -> Result<String, String> {
    let bin = binary(data_dir).ok_or_else(|| "Open Cloud on the Saves page and get rclone first.".to_string())?;
    let remote = remote.trim().trim_end_matches(':');
    if remote.is_empty() {
        return Err("Connect a cloud first.".into());
    }
    let source = saves::root_of(data_dir, backup_root);
    if up && !source.is_dir() {
        return Err("There are no copies to send yet. Back up a game first.".into());
    }
    if !up {
        fs::create_dir_all(&source).map_err(|e| format!("Could not create the copies folder: {e}"))?;
    }
    let config = if own {
        None
    } else {
        let path = config_path(data_dir)?;
        if !path.is_file() {
            return Err("Connect a cloud first.".into());
        }
        Some(path)
    };
    let cloud = format!("{remote}:Orbit");
    let (from, to) = if up {
        (source.to_string_lossy().into_owned(), cloud)
    } else {
        (format!("{cloud}/"), source.to_string_lossy().into_owned())
    };
    let output = rclone(&bin, config.as_deref())
        .args(["copy", "--update", "--retries", "2", "--low-level-retries", "3", "--"])
        .arg(&from)
        .arg(&to)
        .output()
        .map_err(|e| format!("Could not start rclone: {e}"))?;
    if output.status.success() {
        return Ok(if up {
            format!("Sent the copies to {remote}.")
        } else {
            format!("Brought the copies down into {}.", source.display())
        });
    }
    Err(public_error(&output.stderr, "rclone did not finish."))
}

fn oauth(bin: &Path, config: &Path, provider: &str) -> Result<String, String> {
    let token = authorize(bin, provider)?;
    let _ = delete_remote(bin, config);
    let output = rclone(bin, Some(config))
        .args(["config", "create", "orbit", provider, "token"])
        .arg(&token)
        .output()
        .map_err(|e| format!("Could not save that cloud: {e}"))?;
    if !output.status.success() {
        return Err(public_error(&output.stderr, "rclone could not save that sign-in."));
    }
    Ok(label_of(provider).into())
}

fn oauth_onedrive(bin: &Path, config: &Path) -> Result<String, String> {
    let token = authorize(bin, "onedrive")?;
    let _ = delete_remote(bin, config);
    let output = rclone(bin, Some(config))
        .args(["config", "create", "orbit", "onedrive", "drive_type", "personal", "token"])
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
    let _ = delete_remote(bin, config);
    let mut cmd = rclone(bin, Some(config));
    cmd.args(["config", "create", "orbit", provider]);
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

fn authorize(bin: &Path, provider: &str) -> Result<String, String> {
    let mut child = rclone(bin, None)
        .args(["authorize", provider, "--auth-no-open-browser"])
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
                match open_url(&url) {
                    Ok(()) => {
                        opened.store(true, Ordering::SeqCst);
                    }
                    Err(_) => {
                        let _ = child.kill();
                        for reader in readers {
                            let _ = reader.join();
                        }
                        return Err(format!("Orbit could not open the sign-in page. Open it yourself: {url}"));
                    }
                }
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
        return Err("The sign-in was cancelled.".into());
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
            if let Some(url) = first_url(&line) {
                *link.lock().unwrap_or_else(|e| e.into_inner()) = Some(url);
            }
        }
        let mut buf = text.lock().unwrap_or_else(|e| e.into_inner());
        buf.push_str(&line);
        buf.push('\n');
    }
}

fn first_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|word| word.starts_with("http://") || word.starts_with("https://"))
        .map(|word| word.trim_matches(|c: char| matches!(c, '"' | '\'' | ',' | '>' | ')')).to_string())
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let spawned = process::command("explorer").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let spawned = process::command("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = process::command("xdg-open").arg(url).spawn();
    spawned.map(|_| ()).map_err(|e| e.to_string())
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

fn mkdir(bin: &Path, config: Option<&Path>, remote: &str) -> Result<(), String> {
    let output = rclone(bin, config)
        .args(["mkdir", &format!("{remote}:Orbit")])
        .output()
        .map_err(|e| format!("Could not reach that cloud: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(public_error(&output.stderr, "rclone could not reach that cloud."))
}

fn delete_remote(bin: &Path, config: &Path) -> Result<(), String> {
    if !config.is_file() {
        return Ok(());
    }
    let output = rclone(bin, Some(config))
        .args(["config", "delete", "orbit"])
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
    use super::{allowed_archive, token_from};

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
