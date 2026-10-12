//! Read-only discovery of games already installed by other launchers.
//!
//! This module is only called from the explicit import dialog. It reads Epic
//! `.item` manifests and Windows uninstall/Ubisoft registry records; it never
//! starts a launcher, contacts an account service, or writes launcher data.

use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;

use serde::Serialize;

/// One locally discovered installation, ready for the player to review.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LauncherGame {
    pub launcher: String,
    pub name: String,
    pub install_dir: String,
    /// A manifest-provided candidate only. Orbit does not launch it by default:
    /// some games must go through their launcher for DRM, overlays, or updates.
    pub exe_path: Option<String>,
    /// Unknown for registry/manifest records; scanning entire game folders just
    /// to calculate a size would be slow and surprising during discovery.
    pub size_bytes: u64,
    /// Lutris's slug, when the row came from there. Absent for every other launcher.
    #[serde(default)]
    pub slug: Option<String>,
    /// Lutris's numeric id, for `lutris:rungameid`.
    #[serde(default)]
    pub lutris_id: Option<i64>,
    #[serde(default)]
    pub runner: Option<String>,
    /// The Wine prefix Lutris recorded, if it recorded one.
    #[serde(default)]
    pub wine_prefix: Option<String>,
}

/// Find installations for one launcher on Windows, or return an empty list elsewhere.
///
/// All discovery is local and read-only. Callers decide when to run it; it is
/// deliberately not used during startup unless the player enables that launcher.
/// Find installations for one launcher on this machine.
///
/// `extra` is a folder the player pointed Orbit at when the launcher keeps its
/// files somewhere the defaults do not cover - a Flatpak sandbox, a portable
/// install, a drive the walk does not reach. It belongs to one launcher, so it
/// is only ever handed to that one.
pub fn installed_games(
    only: Option<&str>,
    extra: Option<&str>,
) -> Result<Vec<LauncherGame>, String> {
    let extra = named_folder(extra);

    // The platform scanners are compiled only on Windows, so type the empty
    // non-Windows result explicitly for the sort below.
    let mut games: Vec<LauncherGame> = Vec::new();

    #[cfg(windows)]
    {
        if only.is_none() || only == Some("Epic Games") {
            scan_epic(&mut games);
        }
        if only.is_none() || matches!(only, Some("Ubisoft Connect" | "GOG Galaxy" | "EA app")) {
            scan_windows_registry(&mut games, only);
        }
        if only.is_none() || only == Some("Xbox") {
            scan_xbox(&mut games, extra_for(only, extra, "Xbox"));
        }
    }

    // Heroic and Nile both run on Linux, macOS and Windows, so unlike the
    // scanners above neither scan is behind cfg(windows).
    if only.is_none() || only == Some("Heroic Games Library") {
        scan_heroic(&mut games, extra_for(only, extra, "Heroic Games Library"));
    }
    if only.is_none() || only == Some("Amazon Luna") {
        scan_amazon(&mut games, extra_for(only, extra, "Amazon Luna"));
    }
    // Lutris is a Linux launcher. Its library is a SQLite file plus one YAML
    // file per game, and both are read and never written.
    if only.is_none() || only == Some("Lutris") {
        scan_lutris(&mut games, extra_for(only, extra, "Lutris"));
    }

    if let Some(launcher) = only {
        games.retain(|game| game.launcher == launcher);
    }
    games.sort_by(|a, b| {
        a.launcher
            .cmp(&b.launcher)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    deduplicate_installations(&mut games);
    Ok(games)
}

/// Parse one Epic manifest without touching the filesystem.
#[cfg(any(windows, test))]
fn parse_epic_manifest(text: &str) -> Option<LauncherGame> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value
        .get("bIsIncompleteInstall")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }

    let name = value
        .get("DisplayName")
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .or_else(|| value.get("AppName").and_then(serde_json::Value::as_str))?
        .trim()
        .to_string();
    let install_dir = value
        .get("InstallLocation")
        .and_then(serde_json::Value::as_str)?
        .trim()
        .to_string();
    if name.is_empty() || install_dir.is_empty() {
        return None;
    }

    let app_name = value
        .get("AppName")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if app_name.contains("epicgameslauncher") || app_name.contains("epiconlineservices") {
        return None;
    }

    Some(LauncherGame {
        launcher: "Epic Games".to_string(),
        name,
        install_dir,
        exe_path: value
            .get("LaunchExecutable")
            .and_then(serde_json::Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(str::to_string),
        size_bytes: value
            .get("InstallSize")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        slug: None,
        lutris_id: None,
        runner: None,
        wine_prefix: None,
    })
}

#[cfg(windows)]
fn scan_epic(games: &mut Vec<LauncherGame>) {
    let Some(program_data) = std::env::var_os("ProgramData") else {
        return;
    };
    let manifests = PathBuf::from(program_data)
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
        .join("Manifests");
    let Ok(files) = std::fs::read_dir(manifests) else {
        return;
    };

    for file in files.flatten() {
        let path = file.path();
        if !path.is_file()
            || !path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("item"))
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(mut game) = parse_epic_manifest(&text) else {
            continue;
        };
        let install = Path::new(&game.install_dir);
        if !install.is_dir() {
            continue;
        }
        game.exe_path = game.exe_path.and_then(|exe| {
            let path = Path::new(&exe);
            let candidate = if path.is_absolute() { path.to_path_buf() } else { install.join(path) };
            candidate.is_file().then(|| candidate.to_string_lossy().into_owned())
        });
        games.push(game);
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Debug, Default)]
struct RegistryEntry {
    key: String,
    values: BTreeMap<String, String>,
}

/// Parse the plain text returned by `reg query /s`, for unit tests as well as
/// the Windows-only discovery path.
#[cfg(any(windows, test))]
fn parse_registry_entries(output: &str) -> Vec<RegistryEntry> {
    let mut entries = Vec::new();
    let mut current: Option<RegistryEntry> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_ascii_uppercase().starts_with("HKEY_") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(RegistryEntry {
                key: trimmed.to_string(),
                values: BTreeMap::new(),
            });
            continue;
        }
        let Some(entry) = current.as_mut() else { continue };
        for kind in ["REG_EXPAND_SZ", "REG_MULTI_SZ", "REG_SZ", "REG_DWORD"] {
            if let Some((name, value)) = trimmed.split_once(kind) {
                let name = name.trim();
                if !name.is_empty() {
                    entry.values.insert(name.to_ascii_lowercase(), value.trim().to_string());
                }
                break;
            }
        }
    }
    if let Some(entry) = current {
        entries.push(entry);
    }
    entries
}

#[cfg(windows)]
fn query_registry(key: &str) -> Vec<RegistryEntry> {
    crate::process::command("reg.exe")
        .args(["query", key, "/s"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| parse_registry_entries(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(windows)]
fn scan_windows_registry(games: &mut Vec<LauncherGame>, only: Option<&str>) {
    let wants_ubisoft = only.is_none() || only == Some("Ubisoft Connect");
    let wants_uninstall = only.is_none() || matches!(only, Some("Ubisoft Connect" | "GOG Galaxy" | "EA app"));
    let uninstall_keys = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    let mut uninstall = Vec::new();
    if wants_uninstall {
        for key in uninstall_keys {
            uninstall.extend(query_registry(key));
        }
    }

    let mut ubisoft_installs = Vec::new();
    if wants_ubisoft {
        for key in [
            r"HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs",
            r"HKLM\SOFTWARE\Ubisoft\Launcher\Installs",
            r"HKCU\SOFTWARE\Ubisoft\Launcher\Installs",
        ] {
            ubisoft_installs.extend(query_registry(key));
        }
    }

    for install in ubisoft_installs {
        let Some(path) = install
            .values
            .get("installdir")
            .or_else(|| install.values.get("installlocation"))
            .map(|path| PathBuf::from(path.trim_matches('"')))
        else {
            continue;
        };
        if !path.is_dir() {
            continue;
        }
        let known = uninstall.iter().find(|entry| {
            registry_install_path(entry)
                .is_some_and(|candidate| same_path(&candidate, &path))
        });
        let name = known
            .and_then(|entry| entry.values.get("displayname"))
            .filter(|name| !name.trim().is_empty())
            .map(|name| name.trim().to_string())
            .or_else(|| path.file_name().map(|name| name.to_string_lossy().to_string()))
            .unwrap_or_else(|| format!("Ubisoft game {}", install.key.rsplit('\\').next().unwrap_or("")));
        games.push(LauncherGame {
            launcher: "Ubisoft Connect".to_string(),
            name,
            install_dir: path.to_string_lossy().into_owned(),
            exe_path: None,
            size_bytes: 0,
            slug: None,
            lutris_id: None,
            runner: None,
            wine_prefix: None,
        });
    }

    for entry in uninstall {
        let Some(name) = entry.values.get("displayname").filter(|name| !name.trim().is_empty()) else {
            continue;
        };
        let publisher = entry.values.get("publisher").map(String::as_str).unwrap_or("");
        let key = entry.key.to_ascii_lowercase();
        let publisher = publisher.to_ascii_lowercase();
        let launcher = if publisher.contains("gog") || key.contains("gog") {
            Some("GOG Galaxy")
        } else if publisher.contains("ubisoft") || key.contains("ubisoft") {
            Some("Ubisoft Connect")
        } else if publisher.contains("electronic arts") || publisher == "ea" || key.contains("ea desktop") {
            Some("EA app")
        } else {
            None
        };
        let Some(launcher) = launcher else { continue };
        let Some(path) = registry_install_path(&entry) else { continue };
        if !path.is_dir() {
            continue;
        }
        // The app itself is not a game to add.
        if name.to_ascii_lowercase().contains("ea app") || name.to_ascii_lowercase().contains("gog galaxy") {
            continue;
        }
        games.push(LauncherGame {
            launcher: launcher.to_string(),
            name: name.trim().to_string(),
            install_dir: path.to_string_lossy().into_owned(),
            exe_path: None,
            size_bytes: 0,
            slug: None,
            lutris_id: None,
            runner: None,
            wine_prefix: None,
        });
    }
}

#[cfg(windows)]
fn registry_install_path(entry: &RegistryEntry) -> Option<PathBuf> {
    entry
        .values
        .get("installlocation")
        .or_else(|| entry.values.get("installdir"))
        .map(|path| PathBuf::from(path.trim_matches('"')))
        .filter(|path| !path.as_os_str().is_empty())
}

/// Two install folders are the same game even when the separators differ.
///
/// Not Windows-only: a Lutris scan on Linux uses it too, and the comparison
/// itself does not touch the registry.
fn same_path(left: &Path, right: &Path) -> bool {
    normalize_path(left) == normalize_path(right)
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn deduplicate_installations(games: &mut Vec<LauncherGame>) {
    let mut seen = std::collections::HashSet::new();
    games.retain(|game| {
        let key = normalize_path(Path::new(&game.install_dir));
        !key.is_empty() && seen.insert(key)
    });
}

/* ---------- Xbox and PC Game Pass ---------- */

/// What the Xbox app calls a game in its `MicrosoftGame.config`.
///
/// The title is an attribute on `<ShellVisuals>` in some packages and an
/// element in others, so both are looked at.
fn xbox_display_name(xml: &str) -> Option<String> {
    xml_attr(xml, "DefaultDisplayName").or_else(|| xml_text(xml, "DefaultDisplayName"))
}

/// The value of `attr="..."`, wherever it appears in a fragment of XML.
fn xml_attr(xml: &str, attr: &str) -> Option<String> {
    let key = format!("{attr}=\"");
    let rest = xml.split(&key).nth(1)?;
    let value = rest.split('"').next()?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The text inside the first `<tag>...</tag>`.
fn xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let rest = xml.split(&open).nth(1)?;
    let value = rest.split('<').next()?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The `Name` on `<Executable>`, which is the program and not the package.
fn xbox_executable(xml: &str) -> Option<String> {
    let rest = xml.split("<Executable ").nth(1)?;
    let tag = rest.split(['/', '>']).next()?;
    xml_attr(tag, "Name")
}

/// The program the config names, but only while it stays inside the folder.
///
/// A name that climbs out with `..` is not a program Orbit should offer to
/// start, whatever the file said.
#[cfg(any(windows, test))]
fn xbox_exe(content: &Path, relative: &str) -> Option<String> {
    if relative.is_empty() || relative.contains("..") {
        return None;
    }
    let path = content.join(relative.replace('/', "\\"));
    path.is_file().then(|| path.to_string_lossy().to_string())
}

/// The folder the player named, but only for the launcher it belongs to.
///
/// A Heroic config folder is not an `XboxGames` folder, so a scan of everything
/// at once must not hand the same path to every scanner.
fn extra_for<'a>(only: Option<&str>, extra: Option<&'a str>, name: &str) -> Option<&'a str> {
    extra.filter(|_| only == Some(name))
}

/// The places to look, with the folder the player named searched first.
///
/// It is added to the defaults rather than replacing them, so pointing Orbit at
/// a second install cannot make the first one disappear.
/// A folder the player actually named, or nothing.
///
/// Blank is "not set" rather than "here": an empty `PathBuf` would mean the
/// current directory, which is never what an empty text box was asking for.
fn named_folder<'a>(extra: Option<&'a str>) -> Option<&'a str> {
    extra.map(str::trim).filter(|path| !path.is_empty())
}

fn with_extra(extra: Option<&str>, mut roots: Vec<PathBuf>) -> Vec<PathBuf> {
    if let Some(path) = named_folder(extra) {
        roots.insert(0, PathBuf::from(path));
    }
    roots
}

/// The games the Xbox app installed, as `<drive>:\XboxGames\<title>\Content`.
///
/// The app lets the player choose a drive and then writes a folder it names
/// after the game, with a `MicrosoftGame.config` inside saying what it is and
/// what starts it. That is the readable part of a PC Game Pass install: the
/// packages themselves live under `WindowsApps`, which is locked to the system
/// and cannot be listed, so anything there is simply not seen.
///
/// A folder the player named is searched as well, for the mounts the drive walk
/// does not reach.
#[cfg(windows)]
fn scan_xbox(games: &mut Vec<LauncherGame>, extra: Option<&str>) {
    let mut found: Vec<LauncherGame> = Vec::new();
    if let Some(path) = extra {
        found.append(&mut xbox_games_in(Path::new(path)));
    }
    for drive in crate::storage::list_drives() {
        let root = Path::new(&drive.root).join("XboxGames");
        found.append(&mut xbox_games_in(&root));
    }
    // A named folder can be one the drive walk already reached.
    games.extend(dedupe_by_install(found));
}

/// One `XboxGames` folder, read out.
///
/// Kept apart from the walk over the drives so that reading a single install
/// can be checked on its own. The drive walk is Windows-only, and left on its
/// own it would never be compiled anywhere the tests run.
#[cfg(any(windows, test))]
fn xbox_games_in(root: &Path) -> Vec<LauncherGame> {
    let mut games: Vec<LauncherGame> = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return games;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().to_string();
        // Saves sit alongside the games and are not one.
        if folder.eq_ignore_ascii_case("GameSave") {
            continue;
        }
        let content = path.join("Content");
        let xml = std::fs::read_to_string(content.join("MicrosoftGame.config"))
            .unwrap_or_default();
        let exe = xbox_exe(&content, &xbox_executable(&xml).unwrap_or_default());
        games.push(LauncherGame {
            launcher: "Xbox".to_string(),
            // The folder name is what the player sees in Explorer, so it is the
            // honest fallback when the config does not say.
            name: xbox_display_name(&xml).unwrap_or(folder),
            install_dir: path.to_string_lossy().to_string(),
            exe_path: exe,
            size_bytes: 0,
            slug: None,
            lutris_id: None,
            runner: None,
            wine_prefix: None,
        });
    }
    games
}

/// Every config folder Heroic or Legendary could be using, most likely first.
///
/// Heroic is installed as a package, an AppImage, or a Flatpak, and the Flatpak
/// sandbox redirects the config folder somewhere else entirely. Rather than work
/// out which install is the live one, every candidate is read and the folders
/// that do not exist are skipped.
fn config_roots(app: &str) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        // Heroic's own config follows the Windows convention; Legendary, which
        // Heroic drives for Epic games, keeps its config under the profile
        // because that is what it does on every platform.
        if let Some(appdata) = std::env::var_os("APPDATA") {
            roots.push(PathBuf::from(appdata).join(app));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            roots.push(PathBuf::from(profile).join(".config").join(app));
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            roots.push(PathBuf::from(xdg).join(app));
        }
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            roots.push(home.join(".config").join(app));
            #[cfg(target_os = "macos")]
            roots.push(home.join("Library").join("Application Support").join(app));
            roots.push(
                home.join(".var")
                    .join("app")
                    .join("com.heroicgameslauncher.hgl")
                    .join("config")
                    .join(app),
            );
        }
    }

    roots
}

/// Read one of Heroic's records and add every game whose folder is really there.
///
/// Both shapes Heroic writes are accepted: `sideload_apps/library.json` is a
/// list of games, while `gog_store/installed.json` and Legendary's
/// `installed.json` are maps keyed by app name. A record with no `install_path`,
/// or one pointing at a folder that is gone, is skipped rather than guessed at,
/// so a Heroic release whose layout has moved finds nothing rather than
/// inventing games.
fn push_heroic_records(path: &Path, games: &mut Vec<LauncherGame>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let records: Vec<&serde_json::Value> = match &json {
        serde_json::Value::Array(items) => items.iter().collect(),
        serde_json::Value::Object(map) => map.values().collect(),
        _ => return,
    };

    for record in records {
        let Some(install_path) = record.get("install_path").and_then(|value| value.as_str()) else {
            continue;
        };
        let install = Path::new(install_path);
        if !install.is_dir() {
            continue;
        }
        let name = record
            .get("title")
            .and_then(|value| value.as_str())
            .or_else(|| record.get("app_name").and_then(|value| value.as_str()))
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                install
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| install_path.to_string())
            });
        games.push(LauncherGame {
            launcher: "Heroic Games Library".to_string(),
            name,
            install_dir: install_path.to_string(),
            exe_path: None,
            size_bytes: 0,
            slug: None,
            lutris_id: None,
            runner: None,
            wine_prefix: None,
        });
    }
}

/// Find the games Heroic Games Launcher has installed.
///
/// Heroic is a front end rather than a store, so it keeps one record per source:
/// apps added by hand, GOG installs, and Epic installs through Legendary.
fn scan_heroic(games: &mut Vec<LauncherGame>, extra: Option<&str>) {
    let mut found: Vec<LauncherGame> = Vec::new();
    for root in with_extra(extra, config_roots("heroic")) {
        push_heroic_records(&root.join("sideload_apps").join("library.json"), &mut found);
        push_heroic_records(&root.join("gog_store").join("installed.json"), &mut found);
    }
    // Epic games are installed by Legendary, which writes its own record beside
    // its config rather than inside Heroic's folder.
    for root in config_roots("legendary") {
        push_heroic_records(&root.join("installed.json"), &mut found);
    }

    games.extend(dedupe_by_install(found));
}

/// Drop repeats, going by where a game is installed rather than its name.
///
/// The same game can appear in more than one record - an Epic install is in
/// Legendary's list and can also show up in Heroic's - and the install folder
/// is the one thing both records agree on.
fn dedupe_by_install(found: Vec<LauncherGame>) -> Vec<LauncherGame> {
    let mut unique: Vec<LauncherGame> = Vec::new();
    for game in found {
        if unique.iter().any(|seen| seen.install_dir == game.install_dir) {
            continue;
        }
        unique.push(game);
    }
    unique
}

/// The titles Nile cached, indexed by product id.
///
/// `library.json` is the list of entitlements Nile fetched during its last sync,
/// and each entry wraps the product it describes.
fn nile_titles(library: &Path) -> BTreeMap<String, String> {
    let Ok(text) = std::fs::read_to_string(library) else {
        return BTreeMap::new();
    };
    let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else {
        return BTreeMap::new();
    };
    list.iter()
        .filter_map(|entry| {
            let product = entry.get("product")?;
            let id = product.get("id").and_then(|value| value.as_str())?;
            let title = product.get("title").and_then(|value| value.as_str()).unwrap_or("");
            (!id.is_empty()).then(|| (id.to_string(), title.trim().to_string()))
        })
        .collect()
}

/// Add every Amazon install Nile recorded whose folder is really there.
///
/// `installed.json` is a list of what is installed and where, and carries no
/// title, so the cached entitlements are joined onto it by product id. Nile's
/// own launcher falls back to the id when the entitlement has no title, and so
/// does this, so an install is never dropped over a missing name.
fn push_amazon_records(library: &Path, installed: &Path, games: &mut Vec<LauncherGame>) {
    let titles = nile_titles(library);
    let Ok(text) = std::fs::read_to_string(installed) else {
        return;
    };
    let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else {
        return;
    };

    for entry in &list {
        let Some(id) = entry.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(path) = entry
            .get("path")
            .and_then(|value| value.as_str())
            .filter(|path| !path.is_empty())
        else {
            continue;
        };
        let install = Path::new(path);
        if !install.is_dir() {
            continue;
        }
        let name = titles
            .get(id)
            .filter(|title| !title.is_empty())
            .cloned()
            .unwrap_or_else(|| id.to_string());
        games.push(LauncherGame {
            launcher: "Amazon Luna".to_string(),
            name,
            install_dir: path.to_string(),
            exe_path: None,
            size_bytes: 0,
            slug: None,
            lutris_id: None,
            runner: None,
            wine_prefix: None,
        });
    }
}

/// Find the games Lutris has marked installed.
///
/// The library is `pga.db`. The program and the Wine prefix, when Lutris
/// recorded them, live in a YAML file next to that database or in the config
/// folder. Both are read and never written. A row with no folder, no prefix
/// and no program is skipped: an import needs somewhere to point at.
fn scan_lutris(games: &mut Vec<LauncherGame>, extra: Option<&str>) {
    let mut found = Vec::new();
    for root in with_extra(extra, lutris_roots()) {
        if !root.is_dir() {
            continue;
        }
        if let Some(db) = find_pga(&root) {
            match read_pga(&db, &root) {
                Ok(rows) => found.extend(rows),
                Err(error) => log::warn!("could not read {}: {error}", db.display()),
            }
        }
        // A config folder can hold the YAML without the database beside it.
        // Those files are also how a prefix is filled in when the row only
        // knew a slug.
        enrich_lutris_yaml(&root, &mut found);
    }
    let mut seen = std::collections::BTreeSet::new();
    found.retain(|game| {
        let key = game
            .slug
            .clone()
            .filter(|slug| !slug.is_empty())
            .unwrap_or_else(|| normalize_path(Path::new(&game.install_dir)));
        seen.insert(key)
    });
    games.extend(found);
}

fn lutris_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let Some(home) = std::env::var_os("HOME") else {
        return roots;
    };
    let home = PathBuf::from(home);
    for rel in [
        ".local/share/lutris",
        ".config/lutris",
        ".var/app/net.lutris.Lutris/data/lutris",
        ".var/app/net.lutris.Lutris/config/lutris",
    ] {
        roots.push(home.join(rel));
    }
    roots
}

fn find_pga(root: &Path) -> Option<PathBuf> {
    let direct = root.join("pga.db");
    if direct.is_file() {
        return Some(direct);
    }
    // A player may point at the parent of the data folder, or at `games/`.
    let nested = root.join("lutris").join("pga.db");
    if nested.is_file() {
        return Some(nested);
    }
    None
}

fn read_pga(db: &Path, root: &Path) -> Result<Vec<LauncherGame>, String> {
    let conn = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not open {}: {e}", db.display()))?;
    // Older libraries omit a column. The short query still names a game.
    let full = "SELECT id, name, slug, runner, executable, directory, configpath \
                FROM games WHERE installed = 1";
    let short = "SELECT id, name, slug, runner, executable, directory, NULL \
                 FROM games WHERE installed = 1";
    // Preparing the long query and the short one in one match keeps the
    // connection borrowed in both arms, which does not compile. A probe that
    // is dropped first is the way to pick.
    let sql = if conn.prepare("SELECT configpath FROM games LIMIT 0").is_ok() {
        full
    } else {
        short
    };
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Could not read {}: {e}", db.display()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut games = Vec::new();
    for row in rows {
        let (id, name, slug, runner, executable, directory, configpath) =
            row.map_err(|e| e.to_string())?;
        let name = name.unwrap_or_default().trim().to_string();
        if name.is_empty() {
            continue;
        }
        let yaml = configpath.as_deref().and_then(|name| lutris_yaml(root, name));
        let bits = yaml.as_deref().map(read_game_yaml).unwrap_or_default();
        let exe = first_nonempty([
            bits.exe.as_deref(),
            executable.as_deref(),
        ]);
        let prefix = bits.prefix.clone();
        let install = first_nonempty([
            directory.as_deref(),
            prefix.as_deref(),
            exe.as_deref().and_then(|path| Path::new(path).parent().and_then(|p| p.to_str())),
        ]);
        let Some(install) = install else {
            continue;
        };
        if !Path::new(&install).exists() {
            continue;
        }
        games.push(LauncherGame {
            launcher: "Lutris".to_string(),
            name,
            install_dir: install,
            exe_path: exe.filter(|path| !path.is_empty()),
            size_bytes: 0,
            slug: slug.filter(|slug| !slug.trim().is_empty()),
            lutris_id: id,
            runner: runner.filter(|runner| !runner.trim().is_empty()),
            wine_prefix: prefix.filter(|prefix| !prefix.trim().is_empty()),
        });
    }
    Ok(games)
}

fn lutris_yaml(root: &Path, configpath: &str) -> Option<PathBuf> {
    let name = Path::new(configpath).file_name()?.to_owned();
    for dir in yaml_dirs(root) {
        let candidate = dir.join(&name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn yaml_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.join("games"), root.join("lutris").join("games")];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".config/lutris/games"));
        dirs.push(home.join(".var/app/net.lutris.Lutris/config/lutris/games"));
    }
    dirs
}

/// Fill a prefix or a program from YAML when the database row did not have it.
fn enrich_lutris_yaml(root: &Path, games: &mut Vec<LauncherGame>) {
    for dir in yaml_dirs(root) {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("yml")
                && path.extension().and_then(|ext| ext.to_str()) != Some("yaml")
            {
                continue;
            }
            let bits = read_game_yaml(&path);
            let stem = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("")
                .to_string();
            let slug = slug_from_configpath(&stem);
            if let Some(game) = games.iter_mut().find(|game| {
                game.launcher == "Lutris"
                    && game
                        .slug
                        .as_deref()
                        .is_some_and(|known| stem.starts_with(known) || known == slug)
            }) {
                if game.wine_prefix.is_none() {
                    game.wine_prefix = bits.prefix.clone();
                }
                if game.exe_path.is_none() {
                    game.exe_path = bits.exe.clone();
                }
                continue;
            }
            // No database row. A YAML file on its own is still a game if it
            // names a folder that is there.
            let install = bits
                .prefix
                .clone()
                .or_else(|| bits.exe.as_ref().and_then(|exe| Path::new(exe).parent().map(|p| p.display().to_string())));
            let Some(install) = install.filter(|path| Path::new(path).exists()) else {
                continue;
            };
            if games.iter().any(|game| {
                game.launcher == "Lutris" && same_path(Path::new(&game.install_dir), Path::new(&install))
            }) {
                continue;
            }
            games.push(LauncherGame {
                launcher: "Lutris".to_string(),
                name: slug.replace('-', " "),
                install_dir: install,
                exe_path: bits.exe,
                size_bytes: 0,
                slug: if slug.is_empty() { None } else { Some(slug) },
                lutris_id: None,
                runner: Some("wine".into()),
                wine_prefix: bits.prefix,
            });
        }
    }
}

/// `hades-ii-1710000000` is the slug `hades-ii`, not `hades`.
fn slug_from_configpath(stem: &str) -> String {
    if let Some((slug, stamp)) = stem.rsplit_once('-') {
        if !slug.is_empty() && stamp.chars().all(|ch| ch.is_ascii_digit()) {
            return slug.to_string();
        }
    }
    stem.to_string()
}

fn first_nonempty<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

#[derive(Default)]
struct YamlBits {
    exe: Option<String>,
    prefix: Option<String>,
}

/// The two fields a Lutris game file is opened for. Anything else in the file
/// is the launcher's own business.
fn read_game_yaml(path: &Path) -> YamlBits {
    let Ok(text) = std::fs::read_to_string(path) else {
        return YamlBits::default();
    };
    let mut section = String::new();
    let mut bits = YamlBits::default();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').trim_matches('\'');
        if indent == 0 {
            section = key.to_string();
            continue;
        }
        if value.is_empty() {
            continue;
        }
        if key == "exe" && bits.exe.is_none() {
            bits.exe = Some(value.to_string());
        }
        if key == "prefix" && bits.prefix.is_none() && (section == "game" || section == "wine") {
            bits.prefix = Some(value.to_string());
        }
    }
    bits
}

/// Find the Amazon Games installs Nile recorded.
///
/// Amazon Luna itself streams its games, so there is nothing of its own on disk
/// to find. What can be on disk is what the Amazon Games client downloaded, and
/// the one readable record of that is Nile's - the unofficial client keeps
/// `library.json` beside `installed.json` in its config folder. The official
/// Amazon Games app keeps no such file, so a player who has never run Nile has
/// nothing here to find, and an empty result is the honest answer rather than a
/// failure.
fn scan_amazon(games: &mut Vec<LauncherGame>, extra: Option<&str>) {
    let mut found: Vec<LauncherGame> = Vec::new();
    for root in with_extra(extra, config_roots("nile")) {
        push_amazon_records(&root.join("library.json"), &root.join("installed.json"), &mut found);
    }
    games.extend(dedupe_by_install(found));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epic_manifest_names_a_game_and_keeps_only_local_fields() {
        let game = parse_epic_manifest(
            r#"{
                "AppName":"CoolGame",
                "DisplayName":"Cool Game",
                "InstallLocation":"C:\\Games\\CoolGame",
                "LaunchExecutable":"Binaries\\Win64\\CoolGame.exe",
                "InstallSize":123456,
                "bIsIncompleteInstall":false
            }"#,
        )
        .unwrap();
        assert_eq!(game.launcher, "Epic Games");
        assert_eq!(game.name, "Cool Game");
        assert_eq!(game.install_dir, r"C:\Games\CoolGame");
        assert_eq!(game.exe_path.as_deref(), Some(r"Binaries\Win64\CoolGame.exe"));
        assert_eq!(game.size_bytes, 123456);
    }

    #[test]
    fn incomplete_epic_installs_are_not_offered() {
        assert!(parse_epic_manifest(
            r#"{"AppName":"Game","DisplayName":"Game","InstallLocation":"C:\\Games\\Game","bIsIncompleteInstall":true}"#
        )
        .is_none());
    }

    #[test]
    fn registry_output_is_grouped_into_read_only_values() {
        let entries = parse_registry_entries(
            "HKEY_LOCAL_MACHINE\\Software\\Uninstall\\Example\r\n    DisplayName    REG_SZ    Example Game\r\n    InstallLocation    REG_SZ    C:\\Games\\Example\r\n",
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].values.get("displayname").map(String::as_str), Some("Example Game"));
        assert_eq!(entries[0].values.get("installlocation").map(String::as_str), Some(r"C:\Games\Example"));
    }

    #[test]
    fn duplicate_installs_are_collapsed_without_rewriting_records() {
        let mut games = vec![
            LauncherGame {
                launcher: "Epic Games".into(),
                name: "A".into(),
                install_dir: r"C:\Games\A".into(),
                exe_path: None,
                size_bytes: 0,
                slug: None,
                lutris_id: None,
                runner: None,
                wine_prefix: None,
            },
            LauncherGame {
                launcher: "GOG Galaxy".into(),
                name: "A duplicate".into(),
                install_dir: r"c:/games/a/".into(),
                exe_path: None,
                size_bytes: 0,
                slug: None,
                lutris_id: None,
                runner: None,
                wine_prefix: None,
            },
        ];
        deduplicate_installations(&mut games);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "A");
    }

    #[test]
    fn an_xbox_config_gives_its_title_and_its_program() {
        let xml = r#"<Game>
          <ExecutableList><Executable Name="Binaries\Hades.exe" Id="Hades"/></ExecutableList>
          <ShellVisuals DefaultDisplayName="Hades II" />
          <StoreId>BQVQTL3PCH05</StoreId>
        </Game>"#;
        assert_eq!(xbox_display_name(xml).as_deref(), Some("Hades II"));
        assert_eq!(xbox_executable(xml).as_deref(), Some("Binaries\\Hades.exe"));
        assert_eq!(xml_text(xml, "StoreId").as_deref(), Some("BQVQTL3PCH05"));
    }

    #[test]
    fn a_title_can_be_an_element_instead_of_an_attribute() {
        let xml = "<ShellVisuals><DefaultDisplayName>Minecraft</DefaultDisplayName></ShellVisuals>";
        assert_eq!(xbox_display_name(xml).as_deref(), Some("Minecraft"));
    }

    #[test]
    fn a_config_that_says_nothing_is_not_invented() {
        assert_eq!(xbox_display_name(""), None);
        assert_eq!(xbox_display_name("<Game></Game>"), None);
        // `<ExecutableList>` is not `<Executable `; the space is what tells them
        // apart, and without it the container would be read as the program.
        assert_eq!(xbox_executable("<ExecutableList></ExecutableList>"), None);
        assert_eq!(xml_text("<StoreId></StoreId>", "StoreId"), None);
        assert_eq!(xml_attr(r#"<a Name=""/>"#, "Name"), None);
    }

    #[test]
    fn a_program_that_climbs_out_of_the_folder_is_not_offered() {
        let dir = temp("xbox-exe");
        let content = dir.join("Content");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(content.join("game.exe"), b"").unwrap();

        assert!(
            xbox_exe(&content, "game.exe").is_some(),
            "the program the config names is offered when it is there"
        );
        assert_eq!(xbox_exe(&content, ""), None);
        assert_eq!(xbox_exe(&content, "missing.exe"), None);
        assert_eq!(xbox_exe(&content, "../../game.exe"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_xbox_folder_is_read_as_a_game_and_its_saves_are_not() {
        let dir = temp("xbox-root");
        let content = dir.join("Hades II").join("Content");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(
            content.join("MicrosoftGame.config"),
            r#"<Game><ShellVisuals DefaultDisplayName="Hades II"/><StoreId>BQVQTL3PCH05</StoreId></Game>"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("GameSave")).unwrap();
        // A folder with no config is still a game: the folder is its name.
        std::fs::create_dir_all(dir.join("Bare Install").join("Content")).unwrap();

        let games = xbox_games_in(&dir);
        let names: Vec<&str> = games.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names.len(), 2, "GameSave is not a game: {names:?}");
        assert!(names.contains(&"Hades II"), "{names:?}");
        assert!(names.contains(&"Bare Install"), "{names:?}");
        assert!(games.iter().all(|g| g.launcher == "Xbox"));
        assert!(games.iter().all(|g| g.size_bytes == 0));
        let hades = games.iter().find(|g| g.name == "Hades II").expect("Hades II");
        assert!(
            hades.install_dir.ends_with("Hades II"),
            "the install is the title folder, not its Content: {}",
            hades.install_dir
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_xbox_folder_is_an_empty_list_rather_than_an_error() {
        let dir = temp("xbox-absent");
        assert!(xbox_games_in(&dir).is_empty());
    }

    #[test]
    fn a_heroic_sideload_list_is_read_from_the_array_shape() {
        let dir = temp("heroic-sideload");
        std::fs::create_dir_all(dir.join("Game")).unwrap();
        std::fs::write(
            dir.join("library.json"),
            format!(
                r#"[{{"app_name":"abc123","title":"Disco Elysium","install_path":"{}"}}]"#,
                dir.join("Game").to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .unwrap();

        let mut games = Vec::new();
        push_heroic_records(&dir.join("library.json"), &mut games);
        assert_eq!(games.len(), 1, "{games:?}");
        assert_eq!(games[0].name, "Disco Elysium", "the title wins over the app name");
        assert_eq!(games[0].launcher, "Heroic Games Library");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_heroic_map_record_is_read_the_same_way() {
        let dir = temp("heroic-map");
        std::fs::create_dir_all(dir.join("Witcher 3")).unwrap();
        std::fs::write(
            dir.join("installed.json"),
            format!(
                r#"{{"1495134320":{{"title":"The Witcher 3","install_path":"{}"}}}}"#,
                dir.join("Witcher 3").to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .unwrap();

        let mut games = Vec::new();
        push_heroic_records(&dir.join("installed.json"), &mut games);
        assert_eq!(games.len(), 1, "{games:?}");
        assert_eq!(games[0].name, "The Witcher 3");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_heroic_record_with_no_folder_on_disk_is_skipped_rather_than_invented() {
        let dir = temp("heroic-absent");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("library.json"),
            r#"[{"app_name":"gone","title":"Uninstalled","install_path":"/nowhere/at/all"},
               {"app_name":"blank","title":"No path"}]"#,
        )
        .unwrap();

        let mut games = Vec::new();
        push_heroic_records(&dir.join("library.json"), &mut games);
        assert!(games.is_empty(), "neither record points at a real folder: {games:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_same_install_in_two_heroic_records_is_one_game() {
        let dir = temp("heroic-dedupe");
        std::fs::create_dir_all(dir.join("Shared")).unwrap();
        let install = dir.join("Shared").to_string_lossy().replace('\\', "\\\\");
        std::fs::write(
            dir.join("a.json"),
            format!(r#"[{{"title":"Once","install_path":"{install}"}}]"#),
        )
        .unwrap();
        std::fs::write(
            dir.join("b.json"),
            format!(r#"{{"x":{{"title":"Again","install_path":"{install}"}}}}"#),
        )
        .unwrap();

        let mut games: Vec<LauncherGame> = Vec::new();
        push_heroic_records(&dir.join("a.json"), &mut games);
        push_heroic_records(&dir.join("b.json"), &mut games);
        let deduped = dedupe_by_install(games);
        assert_eq!(deduped.len(), 1, "{deduped:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_amazon_install_takes_its_name_from_the_cached_entitlement() {
        let dir = temp("nile");
        std::fs::create_dir_all(dir.join("Tomb Raider")).unwrap();
        let install = dir.join("Tomb Raider").to_string_lossy().replace('\\', "\\\\");
        std::fs::write(
            dir.join("library.json"),
            r#"[{"product":{"id":"amzn1.adg.product.1","title":"Tomb Raider I-III Remastered"}}]"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("installed.json"),
            format!(r#"[{{"id":"amzn1.adg.product.1","path":"{install}","version":"1.0"}}]"#),
        )
        .unwrap();

        let mut games = Vec::new();
        push_amazon_records(&dir.join("library.json"), &dir.join("installed.json"), &mut games);
        assert_eq!(games.len(), 1, "{games:?}");
        assert_eq!(games[0].name, "Tomb Raider I-III Remastered");
        assert_eq!(games[0].launcher, "Amazon Luna");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_amazon_install_with_no_cached_title_is_named_by_its_product_id() {
        let dir = temp("nile-untitled");
        std::fs::create_dir_all(dir.join("Game")).unwrap();
        let install = dir.join("Game").to_string_lossy().replace('\\', "\\\\");
        // No library.json at all: the install is still an install.
        std::fs::write(
            dir.join("installed.json"),
            format!(r#"[{{"id":"amzn1.adg.product.9","path":"{install}"}}]"#),
        )
        .unwrap();

        let mut games = Vec::new();
        push_amazon_records(&dir.join("library.json"), &dir.join("installed.json"), &mut games);
        assert_eq!(games.len(), 1, "{games:?}");
        assert_eq!(
            games[0].name, "amzn1.adg.product.9",
            "a missing title must not drop the game"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_amazon_record_whose_folder_is_gone_is_not_an_install() {
        let dir = temp("nile-absent");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("installed.json"),
            r#"[{"id":"a","path":"/nowhere/at/all"},{"id":"b","path":""}]"#,
        )
        .unwrap();

        let mut games = Vec::new();
        push_amazon_records(&dir.join("library.json"), &dir.join("installed.json"), &mut games);
        assert!(games.is_empty(), "neither record points at a real folder: {games:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_named_folder_is_searched_before_the_defaults() {
        let roots = with_extra(Some("/opt/heroic"), vec![PathBuf::from("/home/me/.config/heroic")]);
        assert_eq!(roots.len(), 2, "{roots:?}");
        assert_eq!(
            roots[0],
            PathBuf::from("/opt/heroic"),
            "what the player asked for comes first, so it wins a tie"
        );
    }

    #[test]
    fn a_named_folder_adds_to_the_defaults_rather_than_replacing_them() {
        let default = PathBuf::from("/home/me/.config/nile");
        let roots = with_extra(Some("/srv/nile"), vec![default.clone()]);
        assert!(roots.contains(&default), "{roots:?}");
    }

    #[test]
    fn an_empty_or_blank_folder_is_the_same_as_no_folder() {
        assert_eq!(with_extra(None, vec![PathBuf::from("a")]).len(), 1);
        assert_eq!(with_extra(Some(""), vec![PathBuf::from("a")]).len(), 1);
        assert_eq!(with_extra(Some("   "), vec![PathBuf::from("a")]).len(), 1);
    }

    #[test]
    fn a_named_folder_reaches_only_the_launcher_it_belongs_to() {
        let extra = Some("/opt/heroic");
        assert_eq!(
            extra_for(Some("Heroic Games Library"), extra, "Heroic Games Library"),
            Some("/opt/heroic")
        );
        assert_eq!(
            extra_for(Some("Xbox"), extra, "Heroic Games Library"),
            None,
            "an XboxGames scan must not be pointed at a Heroic folder"
        );
        assert_eq!(
            extra_for(None, extra, "Heroic Games Library"),
            None,
            "scanning everything gives no launcher a folder of its own"
        );
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("orbit-launchers-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        path
    }
}
