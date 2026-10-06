//! Getting a newer Orbit onto the machine.
//!
//! Orbit cannot replace itself: that needs the releases to be signed with a key
//! the project does not have, and a self-updater that cannot check a signature
//! is a worse idea than no self-updater. So the update is the program the
//! project already publishes: the installer is fetched into a temporary folder
//! and handed to the system, exactly as if it had been downloaded by hand.
//!
//! Nothing here decides whether there *is* a newer version. That is one request
//! to GitHub's public releases API, made from the front end through
//! `http_request`, and it is only ever an offer: the download happens because
//! somebody pressed the button.

use std::path::{Path, PathBuf};

/// Where a downloaded installer waits.
fn updates_dir() -> PathBuf {
    std::env::temp_dir().join("orbit-updates")
}

/// Keep a file name a file name.
///
/// The name comes from a release on the internet, so it is treated as a claim
/// rather than a fact: anything that is not plainly a file name is replaced, and
/// the result can only ever be a file inside the directory above.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(['.', ' ']).to_string();
    if cleaned.is_empty() {
        "orbit-update".to_string()
    } else {
        cleaned
    }
}

/// Fetch a release file into a temporary folder, and answer where it landed.
///
/// The bytes are written as they arrive rather than held whole, because an
/// installer is tens of megabytes and there is no reason to keep two copies of
/// it in memory.
#[tauri::command]
pub async fn download_update(url: String, file_name: String) -> Result<String, String> {
    let dir = updates_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    let path = dir.join(safe_name(&file_name));

    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "Orbit/",
            env!("CARGO_PKG_VERSION"),
            " (game library tracker)"
        ))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let reply = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("the download failed: {e}"))?;
    if !reply.status().is_success() {
        return Err(format!("the download answered {}", reply.status()));
    }
    let bytes = reply
        .bytes()
        .await
        .map_err(|e| format!("the download stopped part way: {e}"))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

/// Hand a downloaded installer to the system.
///
/// Windows runs the setup exe, which is the program a player would have run
/// after downloading it themselves. Everywhere else the file goes to the
/// desktop's own opener, which for a `.deb` is the software installer.
#[tauri::command]
pub fn run_update(path: String) -> Result<(), String> {
    let file = Path::new(&path);
    if !file.is_file() {
        return Err("that download is not there any more".to_string());
    }

    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new(file).spawn();

    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(file).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(file).spawn();

    spawned
        .map(|_| ())
        .map_err(|e| format!("could not start the installer: {e}"))
}

/// Forget a downloaded installer, once it has been run or refused.
///
/// Only ever inside Orbit's own temporary folder: this command takes a path, and
/// a command that deletes whatever path it is given is not one to leave lying
/// around.
#[tauri::command]
pub fn forget_update(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if file.parent() != Some(updates_dir().as_path()) {
        return Ok(());
    }
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(()),
        // Already gone is the answer this was after anyway.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
