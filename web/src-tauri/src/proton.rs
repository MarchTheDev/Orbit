//! Proton builds: the ones already on this machine, and the ones Orbit fetches.
//!
//! Wine alone runs most Windows games, and the ones it does not run are usually
//! the ones a particular Proton build was patched for. Proton is Valve's Wine
//! plus a pile of game-specific fixes, and a machine that already plays games on
//! Linux usually has several builds of it lying around: the ones shipping with
//! Steam, the ones the player dropped into `compatibilitytools.d`, and the ones
//! other launchers fetched.
//!
//! Orbit reads all of those, and can fetch a GE build itself. Nothing is
//! installed system-wide and nothing is upgraded behind the player's back: a
//! build is a folder, chosen per game, and deleting the folder is uninstalling
//! it.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

/// A Proton build Orbit can hand a game.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtonBuild {
    /// The folder, which is also the value stored on the game.
    pub id: String,
    /// What the settings page calls it.
    pub name: String,
    pub path: String,
    /// Where it came from: Orbit, Steam, a Steam tool, Faugus, or Lutris.
    pub source: String,
    /// The version its own `version` file states, when there is one.
    pub version: String,
    /// True for a build Orbit downloaded, so the page can say who removes it.
    pub orbit: bool,
}

/// The folder Orbit keeps the Proton builds it fetched in.
pub fn orbit_dir(app: &AppHandle) -> PathBuf {
    crate::storage::root(app).join("runners").join("proton")
}

/// The prefix a Proton game uses when it does not name one.
///
/// One bottle per game, which is what Steam does and what Faugus does, and for
/// the same reason: a bottle holds a registry, the game's installed
/// redistributables and its own copy of `drive_c`, and two games in one bottle
/// overwrite each other's until one of them stops starting. The price is a few
/// hundred megabytes a game, which is why the folder is under the game records
/// rather than beside them and why a game that wants to share can still name a
/// prefix itself.
///
/// The name is the program's, so it reads as something, plus a short hash of
/// its whole path, so that two games both called `game.exe` get their own and
/// the same game keeps its own launch after launch.
pub fn default_prefix(app: &AppHandle, program: &Path) -> PathBuf {
    let stem = program
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("game");
    let named: String = stem
        .chars()
        .take(40)
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let named = named.trim();
    let folder = format!(
        "{}-{}",
        if named.is_empty() { "game" } else { named },
        short_hash(&program.to_string_lossy())
    );
    crate::storage::root(app).join("prefixes").join(folder)
}

/// FNV-1a, which is small enough to write out and is the same on every run:
/// a prefix that moved between launches would be a second, empty bottle.
fn short_hash(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", hash as u32)
}

/// A folder that holds a Proton build: the `proton` script is what runs it.
fn is_proton(dir: &Path) -> bool {
    dir.join("proton").is_file()
}

/// The home folder, without pulling in a dependency for it.
fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Every Steam root this machine is likely to have.
///
/// Steam's own folder has moved twice and the Flatpak keeps its own copy, so
/// the list is tried in order and the ones that are not there cost nothing.
fn steam_roots() -> Vec<PathBuf> {
    let Some(home) = home() else { return Vec::new() };
    [
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".local/share/Steam"),
        home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
        home.join("snap/steam/common/.local/share/Steam"),
    ]
    .into_iter()
    .filter(|dir| dir.is_dir())
    .collect()
}

/// The library folders a Steam install knows about, itself included.
///
/// `libraryfolders.vdf` is a text file of quoted pairs, so the paths are read
/// out of it directly rather than through a parser for a format this needs two
/// words from.
fn steam_libraries(steam: &Path) -> Vec<PathBuf> {
    let mut roots = vec![steam.to_path_buf()];
    for file in [
        steam.join("steamapps/libraryfolders.vdf"),
        steam.join("config/libraryfolders.vdf"),
    ] {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        for line in text.lines() {
            let quoted: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
            if quoted.len() < 2 || !quoted[0].eq_ignore_ascii_case("path") {
                continue;
            }
            let path = PathBuf::from(quoted[1]);
            if path.is_dir() {
                roots.push(path);
            }
        }
    }
    roots
}

/// The builds inside one folder, each of which is a directory holding `proton`.
fn builds_in(root: &Path, source: &str) -> Vec<ProtonBuild> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && is_proton(&path) {
            found.push(build(path, source));
        }
    }
    found
}

fn build(path: PathBuf, source: &str) -> ProtonBuild {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Proton")
        .to_string();
    // The `version` file is what Steam reads. GE builds have one too, and it
    // says `GE-Proton10-10`, which is the name the player already knows.
    let version = std::fs::read_to_string(path.join("version"))
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_default();
    ProtonBuild {
        id: path.to_string_lossy().to_string(),
        name,
        path: path.to_string_lossy().to_string(),
        source: source.to_string(),
        version,
        orbit: source == "Orbit",
    }
}

/// Every Proton build on this machine, best first.
///
/// Orbit's own come first because they are the ones it can update or remove,
/// then Steam's, then the ones other launchers fetched. Within a group the
/// newest name sorts first, which puts GE-Proton10 above GE-Proton9.
pub fn installed(app: &AppHandle) -> Vec<ProtonBuild> {
    let mut found = builds_in(&orbit_dir(app), "Orbit");
    for steam in steam_roots() {
        for library in steam_libraries(&steam) {
            let apps = library.join("steamapps");
            // Proton ships as a tool inside `common`, and anything the player
            // added sits next door in `compatibilitytools.d`.
            found.extend(builds_in(&apps.join("common"), "Steam"));
            found.extend(builds_in(&apps.join("compatibilitytools.d"), "Steam"));
        }
    }
    if let Some(home) = home() {
        found.extend(builds_in(
            &home.join(".local/share/faugus-launcher/compatibilitytools"),
            "Faugus",
        ));
        found.extend(builds_in(&home.join(".local/share/lutris/runners"), "Lutris"));
    }
    // Two Steam roots can point at the same folder, and a build listed twice is
    // a dropdown with two identical rows.
    let mut seen = std::collections::HashSet::new();
    found.retain(|item| seen.insert(item.path.clone()));
    found.sort_by(|a, b| {
        rank(&a.source)
            .cmp(&rank(&b.source))
            .then_with(|| b.name.to_lowercase().cmp(&a.name.to_lowercase()))
    });
    found
}

fn rank(source: &str) -> u8 {
    match source {
        "Orbit" => 0,
        "Steam" => 1,
        _ => 2,
    }
}

/// One downloadable GE release.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeRelease {
    pub tag: String,
    pub url: String,
    /// Bytes, as GitHub states them. Zero when it does not say.
    pub size: u64,
    /// The date GitHub gives it, written as a day.
    pub published: String,
    /// True when a build of that name is already installed.
    pub installed: bool,
}

/// The last few Proton-GE releases.
///
/// GitHub answers with the newest first. The page shows the newest twelve: the
/// list is a way to pick a build, not an archive, and a build older than a year
/// is not what anybody is looking for when a game will not start.
pub async fn ge_releases(app: &AppHandle) -> Result<Vec<GeRelease>, String> {
    let client = client(30)?;
    let response = client
        .get("https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases?per_page=30")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub for the Proton-GE list ({e})"))?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub answered {} for the Proton-GE list",
            response.status()
        ));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("The Proton-GE list was not readable ({e})"))?;
    let here = installed(app);
    let mut releases = Vec::new();
    for item in body.as_array().cloned().unwrap_or_default() {
        let tag = item.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
        if !tag.starts_with("GE-Proton") {
            continue;
        }
        let Some(asset) = item
            .get("assets")
            .and_then(|v| v.as_array())
            .and_then(|assets| {
                assets.iter().find(|asset| {
                    let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    name.ends_with(".tar.gz") || name.ends_with(".tar.xz")
                })
            })
        else {
            continue;
        };
        let url = asset
            .get("browser_download_url")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !allowed_url(url) {
            continue;
        }
        releases.push(GeRelease {
            tag: tag.to_string(),
            url: url.to_string(),
            size: asset.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
            published: item
                .get("published_at")
                .and_then(|v| v.as_str())
                .map(|at| at.chars().take(10).collect())
                .unwrap_or_default(),
            installed: here.iter().any(|build| build.name == tag),
        });
    }
    releases.truncate(12);
    Ok(releases)
}

/// Fetch one Proton-GE release into Orbit's own runners folder.
///
/// The download is a tarball of roughly half a gigabyte, so it is streamed to
/// disk rather than held in memory, and what is happening is said in the same
/// line the Wine fetch uses: the launch status the library already shows.
pub async fn install_ge(app: &AppHandle, tag: String, url: String) -> Result<String, String> {
    if !tag.starts_with("GE-Proton") || tag.contains('/') || tag.contains("..") {
        return Err("That is not a Proton-GE release Orbit will install.".into());
    }
    if !allowed_url(&url) {
        return Err("That download is not from GitHub, so Orbit will not run it.".into());
    }
    let root = orbit_dir(app);
    let dest = root.join(&tag);
    if is_proton(&dest) {
        say(app, &format!("{tag} is already installed."));
        return Ok(dest.to_string_lossy().to_string());
    }
    std::fs::create_dir_all(&root).map_err(|e| format!("Could not create the Proton folder ({e})"))?;
    let archive = root.join(format!("{tag}.download"));
    if archive.exists() {
        let _ = std::fs::remove_file(&archive);
    }
    say(app, &format!("Downloading {tag}. It is about half a gigabyte."));
    download(app, &tag, &url, &archive).await.inspect_err(|_| {
        let _ = std::fs::remove_file(&archive);
    })?;
    say(app, &format!("Unpacking {tag}."));
    progress(app, &tag, "extract", 0, 0);
    if let Err(reason) = extract(&archive, &root) {
        let _ = std::fs::remove_file(&archive);
        let _ = std::fs::remove_dir_all(&dest);
        return Err(reason);
    }
    let _ = std::fs::remove_file(&archive);
    if !is_proton(&dest) {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(format!("The {tag} download did not contain a Proton build."));
    }
    make_runnable(&dest);
    say(app, &format!("{tag} is ready."));
    progress(app, &tag, "done", 0, 0);
    Ok(dest.to_string_lossy().to_string())
}

/// Take an Orbit-fetched build back out.
pub fn remove_build(app: &AppHandle, path: &str) -> Result<(), String> {
    let root = orbit_dir(app);
    let target = std::path::PathBuf::from(path);
    // Only Orbit's own folder is Orbit's to empty. A Steam build is not.
    if !target.is_dir() || !same_folder(&target, &root) {
        return Err("That build was not installed by Orbit.".into());
    }
    std::fs::remove_dir_all(&target).map_err(|e| format!("Could not remove it: {e}"))
}

fn same_folder(target: &Path, root: &Path) -> bool {
    match (target.canonicalize(), root.canonicalize()) {
        (Ok(target), Ok(root)) => target.parent() == Some(root.as_path()),
        _ => false,
    }
}

fn client(seconds: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(seconds))
        .build()
        .map_err(|e| e.to_string())
}

/// Only GitHub, because that is where the list came from and a redirect back
/// out of it would be a download from somewhere nobody chose.
fn allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or("");
    let host = host.split('@').next_back().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    host == "github.com"
        || host.ends_with(".github.com")
        || host.ends_with(".githubusercontent.com")
}

async fn download(app: &AppHandle, tag: &str, url: &str, dest: &Path) -> Result<(), String> {
    let client = client(1800)?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("The download did not start ({e})"))?;
    if !response.status().is_success() {
        return Err(format!("The download failed ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    if total > 3 * 1024 * 1024 * 1024 {
        return Err("That download was larger than a Proton build should be.".into());
    }
    let mut file = std::fs::File::create(dest).map_err(|e| format!("Could not write the download ({e})"))?;
    use std::io::Write;
    let mut written = 0u64;
    let mut told = 0u64;
    progress(app, tag, "download", 0, total);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("The download stopped ({e})"))?
    {
        written += chunk.len() as u64;
        if written > 3 * 1024 * 1024 * 1024 {
            return Err("That download was larger than a Proton build should be.".into());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("Could not write the download ({e})"))?;
        // A bar can only redraw so fast anyway; two megabytes is the grain at
        // which one can actually be seen moving.
        if written.saturating_sub(told) >= 2 * 1024 * 1024 {
            told = written;
            progress(app, tag, "download", written, total);
        }
    }
    progress(app, tag, "download", written, if total > 0 { total } else { written });
    Ok(())
}

/// Tell the window how far a fetch has got, so the manager can draw a bar
/// rather than ask the player to believe a spinning word.
fn progress(app: &AppHandle, tag: &str, phase: &str, loaded: u64, total: u64) {
    let _ = app.emit(
        "orbit-proton-progress",
        serde_json::json!({ "tag": tag, "phase": phase, "loaded": loaded, "total": total }),
    );
}

/// Unpack with tar, which every desktop has. A `.tar.gz` and a `.tar.xz` are
/// both a flag apart, and tar reads both from the stream it is given.
fn extract(archive: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("Could not create the Proton folder ({e})"))?;
    let output = crate::process::command("tar")
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(dest)
        .output()
        .map_err(|_| "Could not unpack the download (tar is not available).".to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail: String = detail.trim().chars().take(180).collect();
    if detail.is_empty() {
        Err("Could not unpack the Proton download.".into())
    } else {
        Err(format!("Could not unpack the Proton download ({detail})"))
    }
}

/// The `proton` script has to be executable, and so does everything beside it.
fn make_runnable(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_file() {
                let mut perms = meta.permissions();
                perms.set_mode(perms.mode() | 0o755);
                let _ = std::fs::set_permissions(&path, perms);
            } else if path.is_dir() {
                // `files/bin` holds wine itself.
                make_runnable(&path);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = dir;
}

fn say(app: &AppHandle, message: &str) {
    let _ = app.emit(
        "orbit-launch-status",
        serde_json::json!({ "message": message }),
    );
}

/// Whether Proton is the thing that should start this game.
///
/// A build named by the game is what it means. Nothing named means Wine, as it
/// always did: Proton without a chosen build would be a guess about which of
/// the several on this machine to use.
pub fn chosen(build: Option<&str>) -> Option<PathBuf> {
    let build = build.map(str::trim).filter(|value| !value.is_empty())?;
    let path = std::path::PathBuf::from(build);
    if is_proton(&path) {
        Some(path)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_is_a_folder_with_a_proton_script() {
        let dir = std::env::temp_dir().join(format!("orbit-proton-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(chosen(Some(dir.to_str().unwrap())).is_none());
        std::fs::write(dir.join("proton"), "#!/bin/sh\n").unwrap();
        assert_eq!(
            chosen(Some(dir.to_str().unwrap())),
            Some(dir.clone()),
            "a folder with a proton script is a build"
        );
        assert!(chosen(None).is_none(), "nothing named is not a build");
        assert!(chosen(Some("   ")).is_none(), "spaces are not a build");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_prefix_is_named_after_the_program_and_never_shared_by_accident() {
        let a = short_hash("/games/one/game.exe");
        let b = short_hash("/games/two/game.exe");
        assert_ne!(a, b, "two programs with the same name are different games");
        assert_eq!(a, short_hash("/games/one/game.exe"), "the same game keeps its bottle");
    }

    #[test]
    fn only_github_is_downloaded_from() {
        assert!(allowed_url("https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton10-10/GE-Proton10-10.tar.gz"));
        assert!(allowed_url("https://objects.githubusercontent.com/x.tar.gz"));
        assert!(!allowed_url("http://github.com/x.tar.gz"));
        assert!(!allowed_url("https://example.com/x.tar.gz"));
        assert!(!allowed_url("https://github.com.evil.test/x.tar.gz"));
    }

    #[test]
    fn a_steam_library_list_is_read_by_its_path_lines() {
        let dir = std::env::temp_dir().join(format!("orbit-steam-vdf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("steamapps")).unwrap();
        let other = dir.join("second");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(
            dir.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
                dir.display(),
                other.display()
            ),
        )
        .unwrap();
        let roots = steam_libraries(&dir);
        assert!(roots.contains(&dir));
        assert!(roots.contains(&other));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
