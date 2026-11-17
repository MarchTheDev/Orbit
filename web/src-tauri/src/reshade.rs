//! ReShade, as one switch on a game.
//!
//! ReShade is a post-processing injector: a `dxgi.dll` (or `d3d9.dll`, or one
//! of the others) dropped beside a game's executable, which the game loads in
//! place of the system one and which then draws on every frame. Everything
//! about it is that one file - installing it is copying a DLL, uninstalling it
//! is taking that DLL away, and turning it off is renaming it.
//!
//! Orbit therefore offers it as a switch rather than as a manager. The player
//! either has a game with ReShade on it or one without, and both are one press.
//! What complicated the old version was the middle: a "managed" state, an
//! adoption step, a graphics API to choose, a DLL to browse for and a preset to
//! pair with it, all before anything happened. All of that is now what Orbit
//! decides for itself:
//!
//! * The DLL comes from ReShade's own release, fetched once and kept in Orbit's
//!   data folder so a second game costs no download. A file the player picked
//!   still works, and is remembered.
//! * The proxy name is guessed from the executable's own imports: a game that
//!   imports `dxgi.dll` gets `dxgi.dll`. The import table is the only honest
//!   answer to which API a game uses.
//! * Whatever was at that name first is kept, byte for byte, as
//!   `<name>.orbit-original` - so a game that shipped its own proxy gets its
//!   own proxy back, and removing ReShade really is removing it.
//!
//! Nothing here reaches into a game while it is running, and nothing is written
//! outside the install folder the game already lives in.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

/// The ReShade release Orbit installs when nobody has said otherwise.
///
/// Named rather than "latest" on purpose: a build Orbit has not been tested
/// against is not something to put into somebody's game folders unasked, and a
/// release that is fetched by name can be checked against a known digest.
pub const RESHADE_VERSION: &str = "6.8.0";

/// Where the download comes from, which is ReShade's own site.
fn setup_url() -> String {
    format!("https://reshade.me/downloads/ReShade_Setup_{RESHADE_VERSION}.exe")
}

/// The proxy names ReShade can use, in the order they are guessed.
///
/// This is ReShade's own list. The first four are Direct3D; `opengl32` is for
/// OpenGL games and `d3d8`/`ddraw` for the ones older than that.
pub const PROXIES: [&str; 7] = ["dxgi", "d3d11", "d3d9", "d3d12", "opengl32", "d3d8", "ddraw"];

/// How Orbit is getting on with ReShade for one game.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReshadeState {
    /// The folder the DLL is written into, when the game has one Orbit can see.
    pub folder: Option<String>,
    /// `on`, `off` (the loader is there but renamed), or `missing`.
    pub state: String,
    /// The proxy name in use, such as `dxgi`.
    pub proxy: Option<String>,
    /// The DLL actually present, for the page to name.
    pub file: Option<String>,
    /// True when Orbit put the file there itself, or adopted it on request.
    pub managed: bool,
    /// True when the game had something at that name and Orbit kept it.
    pub backup: bool,
    /// Whether a ReShade preset is in the folder.
    pub preset: bool,
    /// Whether this machine can do any of it at all.
    pub supported: bool,
    /// Why the switch cannot be used right now, when it cannot.
    pub reason: Option<String>,
}

impl ReshadeState {
    /// A switch that cannot be used, and why - which is what the page shows
    /// instead of an error to dismiss.
    pub fn blocked(reason: impl Into<String>) -> Self {
        Self {
            folder: None,
            state: "missing".into(),
            proxy: None,
            file: None,
            managed: false,
            backup: false,
            preset: false,
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

/// The folder a game's ReShade files belong in.
///
/// The executable's own folder is the answer, because that is where the game
/// looks for `dxgi.dll`: a game installed through a launcher puts its program
/// in `…/Game/Binaries/Win64`, not at the top of the install directory, and a
/// DLL at the top would never be loaded.
fn game_folder(install_dir: Option<&str>, exe_path: Option<&str>, launch_path: Option<&str>) -> Option<PathBuf> {
    for candidate in [exe_path, launch_path] {
        if let Some(path) = candidate.map(Path::new) {
            if path.is_file() {
                if let Some(parent) = path.parent() {
                    if parent.is_dir() {
                        return Some(parent.to_path_buf());
                    }
                }
            }
        }
    }
    install_dir
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

/// The DLLs a Windows executable imports, read from its own import table.
///
/// This is the whole of the graphics-API guess: a game that imports `dxgi.dll`
/// is a DirectX 10/11/12 game and wants ReShade's `dxgi.dll`; one that imports
/// `d3d9.dll` wants `d3d9.dll`; an OpenGL game imports `opengl32.dll`. The
/// import table is read rather than the file being searched with a substring
/// match, because a game can contain any byte sequence anywhere.
fn imported_dlls(exe: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(exe) else { return Vec::new() };
    let Some(imports) = pe_imports(&bytes) else { return Vec::new() };
    imports
        .into_iter()
        .filter_map(|name| {
            let lower = name.to_ascii_lowercase();
            lower.ends_with(".dll").then_some(lower)
        })
        .collect()
}

/// A small, bounds-checked PE reader for the import directory.
///
/// It reads exactly what it needs and returns nothing at all on any shape it
/// does not recognise: a file that is not a PE, a table that points outside
/// the file, or a name that is not terminated. Nothing here unwraps.
fn pe_imports(bytes: &[u8]) -> Option<Vec<String>> {
    let u16_at = |at: usize| -> Option<u16> { Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?)) };
    let u32_at = |at: usize| -> Option<u32> { Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?)) };

    if u16_at(0)? != 0x5a4d {
        return None;
    }
    let pe = u32_at(0x3c)? as usize;
    if bytes.get(pe..pe + 4)? != b"PE\0\0" {
        return None;
    }
    let coff = pe + 4;
    let sections = u16_at(coff + 2)? as usize;
    let optional_size = u16_at(coff + 16)? as usize;
    let optional = coff + 20;
    let magic = u16_at(optional)?;
    // PE32 has a 32-bit image base and PE32+ a 64-bit one; the data directory
    // is at a different offset in each, and the import directory is the second
    // entry in it.
    let (directory_at, image_base_size) = match magic {
        0x10b => (optional + 96, 4usize),
        0x20b => (optional + 112, 8usize),
        _ => return None,
    };
    // The optional header has to reach as far as the directory the magic says,
    // or the number read there is inside some other field.
    if optional_size < image_base_size + 16 {
        return None;
    }
    let import_rva = u32_at(directory_at + 8)?;
    if import_rva == 0 {
        return None;
    }
    let section_table = optional + optional_size;

    // An RVA becomes an offset by finding the section it falls inside.
    let rva_to_offset = |rva: u32| -> Option<usize> {
        for index in 0..sections {
            let at = section_table + index * 40;
            let virtual_size = u32_at(at + 8)?;
            let virtual_address = u32_at(at + 12)?;
            let raw_size = u32_at(at + 16)?;
            let raw_pointer = u32_at(at + 20)?;
            let span = virtual_size.max(raw_size);
            if rva >= virtual_address && rva < virtual_address.saturating_add(span) {
                let inside = rva - virtual_address;
                if inside >= raw_size {
                    // Zero-filled tail of the section: nothing to read there.
                    return None;
                }
                return Some(raw_pointer as usize + inside as usize);
            }
        }
        None
    };

    let mut names = Vec::new();
    for descriptor in 0..64u32 {
        let at = rva_to_offset(import_rva + descriptor * 20)?;
        let name_rva = u32_at(at + 12)?;
        if name_rva == 0 {
            break;
        }
        let Some(name_at) = rva_to_offset(name_rva) else { break };
        let mut end = name_at;
        while end < bytes.len() && bytes[end] != 0 && end - name_at < 128 {
            end += 1;
        }
        if end >= bytes.len() || end == name_at {
            break;
        }
        if let Ok(name) = std::str::from_utf8(&bytes[name_at..end]) {
            names.push(name.to_string());
        }
    }
    Some(names)
}

/// Which proxy name this executable should use, best first.
///
/// The import table decides when it can; when it cannot (a launcher, a
/// packed executable, no Windows program at all) the order ReShade itself
/// suggests is used instead, with `dxgi` - by far the most common - first.
fn guess_proxies(exe: Option<&Path>) -> Vec<&'static str> {
    let imports = exe.map(imported_dlls).unwrap_or_default();
    let mut ranked: Vec<&'static str> = Vec::new();
    let mut take = |proxy: &'static str| {
        if !ranked.contains(&proxy) {
            ranked.push(proxy);
        }
    };
    if imports.iter().any(|name| name == "dxgi.dll") {
        take("dxgi");
    }
    if imports.iter().any(|name| name == "d3d11.dll") {
        take("d3d11");
        take("dxgi");
    }
    if imports.iter().any(|name| name == "d3d12.dll") {
        take("d3d12");
        take("dxgi");
    }
    if imports.iter().any(|name| name == "d3d9.dll") {
        take("d3d9");
    }
    if imports.iter().any(|name| name == "d3d8.dll") {
        take("d3d8");
    }
    if imports.iter().any(|name| name == "ddraw.dll") {
        take("ddraw");
    }
    if imports.iter().any(|name| name == "opengl32.dll") {
        take("opengl32");
    }
    for proxy in PROXIES {
        take(proxy);
    }
    ranked
}

/// Orbit's own folder for ReShade: the setup program, kept there once fetched.
///
/// Downloaded once, from ReShade's own site, and kept beside Orbit's other
/// runners so a second game costs nothing. It is the setup tool itself rather
/// than a DLL Orbit has prised out of it, because the tool is the thing ReShade
/// documents as scriptable - and because its archive format is ReShade's
/// business, not Orbit's.
fn orbit_dir(app: &AppHandle) -> PathBuf {
    crate::storage::root(app).join("runners").join("reshade")
}

/// The setup program's name, with the version Orbit fetched.
fn setup_file() -> String {
    format!("ReShade_Setup_{RESHADE_VERSION}.exe")
}

/// Whether an executable is 64-bit, from its own header.
///
/// ReShade's setup tool picks the architecture itself, so this is not used to
/// choose a file - it is here because it is the one fact about a game's
/// executable Orbit can answer without the game running, and the tests read it.
#[cfg_attr(not(test), allow(dead_code))]
fn is_64(exe: &Path) -> bool {
    let Ok(bytes) = std::fs::read(exe) else { return true };
    let at = |offset: usize| -> Option<u16> { Some(u16::from_le_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?)) };
    let Some(0x5a4d) = at(0) else { return true };
    let Some(optional) = optional_header_at(&bytes) else { return true };
    // 0x20b is PE32+, which is what a 64-bit program is.
    matches!(at(optional), Some(0x20b))
}

/// Where the optional header begins: past the DOS stub, the `PE\0\0` signature
/// and the 20-byte COFF header.
fn optional_header_at(bytes: &[u8]) -> Option<usize> {
    let pe = u32::from_le_bytes(bytes.get(0x3c..0x40)?.try_into().ok()?) as usize;
    (bytes.get(pe..pe + 4)? == b"PE\0\0").then_some(pe + 4 + 20)
}

/// The setup program, when it has already been downloaded.
fn cached_setup(app: &AppHandle) -> Option<PathBuf> {
    let path = orbit_dir(app).join(setup_file());
    (path.is_file() && path.metadata().map(|meta| meta.len() > 1_000_000).unwrap_or(false)).then_some(path)
}

/// Fetch ReShade's setup program into Orbit's own folder.
///
/// It is never run from here: `install_into` runs it with ReShade's own
/// headless switches, pointed at the game. This function only makes sure there
/// is a copy to run.
pub async fn fetch(app: &AppHandle, log: impl Fn(&str)) -> Result<PathBuf, String> {
    if let Some(path) = cached_setup(app) {
        return Ok(path);
    }
    let dir = orbit_dir(app);
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not make {}: {error}", dir.display()))?;
    let url = setup_url();
    log(&format!("Downloading ReShade {RESHADE_VERSION}…"));

    let client = reqwest::Client::builder()
        .user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("ReShade could not be downloaded: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("ReShade's download answered {}.", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("ReShade was not downloaded whole: {error}"))?;
    if bytes.len() < 1_000_000 {
        return Err("ReShade's download was too small to be the setup program.".into());
    }
    let path = dir.join(setup_file());
    std::fs::write(&path, &bytes).map_err(|error| format!("Could not keep ReShade's setup program: {error}"))?;
    log("ReShade is ready.");
    Ok(path)
}

/// Run ReShade's setup tool against one game, without its window.
///
/// This is the one place the tool is executed, and it is executed the way
/// ReShade documents: `--headless` for no window, `--api` for the proxy to
/// write, and the game's own executable as the target. `--state modify` asks it
/// to change an install that is already there rather than start again, which is
/// what "turn it back on with a newer ReShade" is.
fn install_into(setup: &Path, exe: &Path, api: &str, fresh: bool) -> Result<(), String> {
    let mut command = std::process::Command::new(setup);
    command
        .arg("--headless")
        .arg("--api")
        .arg(api)
        .arg("--state")
        .arg(if fresh { "finished" } else { "modify" })
        .arg(exe)
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window behind somebody's game.
        command.creation_flags(0x0800_0000);
    }
    let status = command
        .status()
        .map_err(|error| format!("ReShade's setup program did not start: {error}"))?;
    if !status.success() {
        return Err(format!("ReShade's setup program stopped with {status}."));
    }
    Ok(())
}

fn backup_name(file_name: &str) -> String {
    format!("{file_name}.orbit-original")
}

fn disabled_name(file_name: &str) -> String {
    format!("{file_name}.orbit-off")
}

/// Read the state of one game's ReShade, without changing anything.
pub fn status(folder: Option<&Path>, exe: Option<&Path>) -> ReshadeState {
    let supported = cfg!(any(windows, target_os = "linux"));
    let Some(folder) = folder else {
        return ReshadeState {
            folder: None,
            state: "missing".into(),
            proxy: None,
            file: None,
            managed: false,
            backup: false,
            preset: false,
            supported,
            reason: Some("This game has no install folder or program for Orbit to look in.".into()),
        };
    };
    let ranked = guess_proxies(exe);
    let proxy = ranked
        .iter()
        .copied()
        .find(|proxy| {
            let file = format!("{proxy}.dll");
            folder.join(&file).is_file() || folder.join(disabled_name(&file)).is_file()
        })
        .or_else(|| ranked.first().copied());
    let proxy = proxy.map(str::to_string);
    let file = proxy.as_ref().map(|proxy| format!("{proxy}.dll"));
    let on = file.as_ref().is_some_and(|file| folder.join(file).is_file());
    let off = file.as_ref().is_some_and(|file| folder.join(disabled_name(file)).is_file());
    let backup = file.as_ref().is_some_and(|file| folder.join(backup_name(file)).is_file());
    let managed = file
        .as_ref()
        .is_some_and(|file| folder.join(format!("{file}.orbit-managed")).is_file());
    let preset = folder.join("ReShade.ini").is_file() || folder.join("Orbit-ReShade-Preset.ini").is_file();
    ReshadeState {
        folder: Some(folder.to_string_lossy().into_owned()),
        state: if on { "on" } else if off { "off" } else { "missing" }.into(),
        proxy,
        file: file.filter(|_| on || off),
        managed,
        backup,
        preset,
        supported,
        reason: None,
    }
}

/// Put ReShade into the folder, or take it out again.
///
/// `on` installs under the proxy name the executable actually imports - through
/// ReShade's own headless setup, or from a DLL the player picked - keeping
/// whatever was there first as `<name>.orbit-original`. `off` takes it away
/// again and puts the original back, so the game starts exactly as it did
/// before ReShade was ever asked about.
pub async fn set(
    folder: &Path,
    exe: Option<&Path>,
    on: bool,
    dll_source: Option<&Path>,
    app: Option<&AppHandle>,
) -> Result<ReshadeState, String> {
    if !folder.is_dir() {
        return Err("The game's folder is not there any more.".into());
    }
    let ranked = guess_proxies(exe);
    let current = status(Some(folder), exe);

    if !on {
        let mut turned_off = false;
        for proxy in &ranked {
            let file = format!("{proxy}.dll");
            let active = folder.join(&file);
            let original = folder.join(backup_name(&file));
            if active.is_file() {
                // A file that is ours goes aside; one that fell back to an
                // original is simply taken away, because the original is what
                // the game should be loading.
                let ours = current.state == "on" && current.file.as_deref() == Some(file.as_str())
                    || folder.join(format!("{file}.orbit-managed")).is_file();
                if ours {
                    std::fs::rename(&active, folder.join(disabled_name(&file)))
                        .map_err(|error| format!("Could not turn ReShade off: {error}"))?;
                } else {
                    std::fs::remove_file(&active)
                        .map_err(|error| format!("Could not take {} away: {error}", active.display()))?;
                }
            }
            if original.is_file() {
                std::fs::copy(&original, &active)
                    .map_err(|error| format!("Could not put the original {file} back: {error}"))?;
            }
            let _ = std::fs::remove_file(folder.join(format!("{file}.orbit-managed")));
            let _ = std::fs::remove_file(folder.join(disabled_name(&file)));
            if folder.join(&file).is_file() || folder.join(backup_name(&file)).is_file() {
                turned_off = true;
                break;
            }
        }
        // The configuration is only meaningful with the DLL there, and a game
        // that already had one of its own gets its own back.
        let ini = folder.join("ReShade.ini");
        let ini_original = folder.join("ReShade.ini.orbit-original");
        if ini.is_file() && std::fs::read_to_string(&ini).is_ok_and(|text| text.contains("Orbit")) {
            let _ = std::fs::rename(&ini, folder.join("ReShade.ini.orbit-off"));
            if ini_original.is_file() {
                let _ = std::fs::copy(&ini_original, &ini);
            }
        }
        let preset = folder.join("Orbit-ReShade-Preset.ini");
        if preset.is_file() {
            let _ = std::fs::rename(&preset, folder.join("Orbit-ReShade-Preset.ini.orbit-off"));
        }
        if !turned_off && !ranked.iter().any(|proxy| folder.join(backup_name(&format!("{proxy}.dll"))).is_file()) {
            return Err("ReShade was not installed in this folder, so there was nothing to take away.".into());
        }
        return Ok(status(Some(folder), exe));
    }

    // The game's own program is what ReShade is pointed at: the proxy name and
    // the architecture are both read from it, and without one there is nothing
    // to install into.
    let exe = exe.ok_or_else(|| {
        "Orbit needs the game's program before it can put ReShade in. Point it at the .exe first.".to_string()
    })?;

    // Keep whatever is at the proxy name before anything is written there. It
    // is copied rather than moved, so a game that shipped its own proxy keeps
    // working until ReShade's own file lands on top of it.
    let proxy = ranked.first().copied().unwrap_or("dxgi");
    let file = format!("{proxy}.dll");
    let active = folder.join(&file);
    let original = folder.join(backup_name(&file));
    if active.is_file() && !original.is_file() && !folder.join(format!("{file}.orbit-managed")).is_file() {
        std::fs::copy(&active, &original)
            .map_err(|error| format!("Could not keep the original {file}: {error}"))?;
    }

    match dll_source.filter(|path| path.is_file()) {
        // The player brought a DLL. It is already on disk, so the only work is
        // putting it where the game looks.
        Some(source) => {
            std::fs::copy(source, &active)
                .map_err(|error| format!("Could not write {file} into the game's folder: {error}"))?;
        }
        // Otherwise ReShade's own setup tool writes it, with the switches
        // ReShade documents for exactly this. `--api` is the proxy name, so the
        // tool and Orbit's guess have to agree - which is why the guess is made
        // first, from the executable's own imports.
        None => {
            let app = app.ok_or_else(|| "Orbit cannot fetch ReShade without its own data folder.".to_string())?;
            let setup = fetch(app, |_| {}).await?;
            let fresh = !active.is_file();
            // Blocking on a child process is not something to do on the async
            // reactor: the setup tool can take a second or two, and everything
            // else on that thread waits with it.
            {
                let setup = setup.clone();
                let exe = exe.to_path_buf();
                let proxy = proxy.to_string();
                tauri::async_runtime::spawn_blocking(move || install_into(&setup, &exe, &proxy, fresh))
                    .await
                    .map_err(|error| format!("ReShade's setup could not be waited on: {error}"))??;
            }
            if !active.is_file() {
                return Err(format!(
                    "ReShade's setup finished, but {file} is not in the game's folder. Running the game once may be what ReShade needs before it can see it."
                ));
            }
        }
    }
    let _ = std::fs::remove_file(folder.join(disabled_name(&file)));
    std::fs::write(folder.join(format!("{file}.orbit-managed")), b"orbit\n")
        .map_err(|error| format!("ReShade was written but Orbit could not note it: {error}"))?;

    // ReShade reads its settings from here, so the overlay is reachable with
    // Home. A file the game already had is kept rather than replaced.
    let ini = folder.join("ReShade.ini");
    let ini_original = folder.join("ReShade.ini.orbit-original");
    if ini.is_file() && !ini_original.is_file() {
        let _ = std::fs::copy(&ini, &ini_original);
    }
    if !ini.is_file() {
        let _ = std::fs::write(&ini, "[GENERAL]\nEffectSearchPaths=.\\reshade-shaders\\Shaders\\**\nTextureSearchPaths=.\\reshade-shaders\\Textures\\**\n");
    }
    Ok(status(Some(folder), Some(exe)))
}

/// Where the game's ReShade files live, from the three paths a game carries.
pub fn folder_for(install_dir: Option<&str>, exe_path: Option<&str>, launch_path: Option<&str>) -> Option<PathBuf> {
    game_folder(install_dir, exe_path, launch_path)
}

/// The executable ReShade should be pointed at, for the proxy guess.
pub fn exe_for(exe_path: Option<&str>, launch_path: Option<&str>) -> Option<PathBuf> {
    for candidate in [exe_path, launch_path] {
        if let Some(path) = candidate.map(PathBuf::from) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny, valid PE32+ file with one import: the named DLL.
    ///
    /// The optional header is 0xF0 bytes, as a PE32+ one is, and the single
    /// section is laid over the whole file at RVA 0 - so every RVA in here is
    /// its own file offset, and the reader is walked through real ones.
    fn fake_pe(import: &str) -> Vec<u8> {
        let mut bytes = vec![0u8; 0x400];
        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
        // COFF header: one section, optional header of 0xF0 bytes (PE32+).
        bytes[0x86..0x88].copy_from_slice(&1u16.to_le_bytes());
        bytes[0x94..0x96].copy_from_slice(&0xF0u16.to_le_bytes());
        let optional = 0x98;
        bytes[optional..optional + 2].copy_from_slice(&0x20bu16.to_le_bytes());
        // Data directory 1 (the imports) at optional + 112.
        let directory = optional + 112;
        bytes[directory + 8..directory + 12].copy_from_slice(&0x220u32.to_le_bytes());
        // One section covering the whole file: RVA 0 = file offset 0.
        let section = optional + 0xF0;
        bytes[section + 8..section + 12].copy_from_slice(&0x400u32.to_le_bytes());
        bytes[section + 12..section + 16].copy_from_slice(&0u32.to_le_bytes());
        bytes[section + 16..section + 20].copy_from_slice(&0x400u32.to_le_bytes());
        bytes[section + 20..section + 24].copy_from_slice(&0u32.to_le_bytes());
        // One import descriptor at RVA 0x220, naming the DLL at RVA 0x300 -
        // clear of the descriptor's own 20 bytes.
        bytes[0x220 + 12..0x220 + 16].copy_from_slice(&0x300u32.to_le_bytes());
        let name = import.as_bytes();
        bytes[0x300..0x300 + name.len()].copy_from_slice(name);
        bytes
    }

    #[test]
    fn the_import_table_names_the_graphics_api() {
        let dir = std::env::temp_dir().join("orbit-reshade-test-pe");
        let _ = std::fs::create_dir_all(&dir);
        let exe = dir.join("game.exe");
        std::fs::write(&exe, fake_pe("dxgi.dll")).unwrap();
        assert_eq!(imported_dlls(&exe), vec!["dxgi.dll".to_string()]);
        assert_eq!(guess_proxies(Some(&exe))[0], "dxgi");
        assert!(is_64(&exe));
        std::fs::write(&exe, fake_pe("d3d9.dll")).unwrap();
        assert_eq!(guess_proxies(Some(&exe))[0], "d3d9");
        // Anything that cannot be read falls back to the common order rather
        // than guessing at nothing.
        assert_eq!(guess_proxies(None)[0], "dxgi");
    }

    #[test]
    fn a_file_that_is_not_a_pe_is_not_read_as_one() {
        let dir = std::env::temp_dir().join("orbit-reshade-test-pe");
        let _ = std::fs::create_dir_all(&dir);
        let exe = dir.join("not-a-pe.exe");
        std::fs::write(&exe, b"just some bytes, with dxgi.dll written in them").unwrap();
        assert!(imported_dlls(&exe).is_empty());
        assert_eq!(guess_proxies(Some(&exe))[0], "dxgi");
    }
}
