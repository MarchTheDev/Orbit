//! Per-app volume, the same list the system mixer shows.
//!
//! Windows reads the render sessions on the default device. Linux asks pactl,
//! then wpctl. The id is checked before it is passed to a command, so a name
//! from the list cannot become an argument.

use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppAudio {
    pub id: String,
    pub name: String,
    /// 0 to 100. */
    pub volume: u8,
    pub muted: bool,
    /// The output itself, rather than one program. It is listed first. */
    pub device: bool,
    /// The program file, so a browser video can find its mixer row when the
    /// session is named after the page instead of the browser.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub exe: String,
    /// A session that is actually playing, not a silent helper process.
    #[serde(default, skip_serializing_if = "is_false")]
    pub live: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub fn list() -> Result<Vec<AppAudio>, String> {
    #[cfg(windows)]
    {
        return windows_list();
    }
    #[cfg(target_os = "linux")]
    {
        return linux_list();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Err("App volumes are not available on this system.".to_string())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    /// `output` or `input`.
    pub kind: String,
    pub current: bool,
}

pub fn devices() -> Result<Vec<AudioDevice>, String> {
    #[cfg(windows)]
    {
        return unsafe { windows_devices() };
    }
    #[cfg(target_os = "linux")]
    {
        return linux_devices();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Err("Audio devices are not available on this system.".to_string())
    }
}

pub fn use_device(id: &str, kind: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("Choose a device.".to_string());
    }
    #[cfg(windows)]
    {
        let _ = kind;
        return unsafe { windows_use_device(id) };
    }
    #[cfg(target_os = "linux")]
    {
        return linux_use_device(id, kind);
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (id, kind);
        Err("Audio devices are not available on this system.".to_string())
    }
}

/// Set the volume of the app whose name matches, so the player does not have to open the mixer.
pub fn set_named(name: &str, volume: u8, muted: bool) -> Result<(), String> {
    let apps = list()?;
    let Some(hit) = volume_hit(name, "", &apps) else {
        return Err("That app is not playing sound.".to_string());
    };
    set(&hit.id, volume, muted)
}

/// The mixer row for a song or a browser video.
///
/// A YouTube tab is often listed under the page title, while the media controls
/// say Chrome. The program file is what joins those two. A live session wins
/// over a silent helper that happens to share the name.
pub(crate) fn volume_hit<'a>(app: &str, title: &str, apps: &'a [AppAudio]) -> Option<&'a AppAudio> {
    let title_fold = fold(title);
    let mut best: Option<(i32, &AppAudio)> = None;
    for item in apps {
        if item.device {
            continue;
        }
        let mut score = 0;
        let name = fold(&item.name);
        if title_fold.len() >= 6 && name.len() >= 6 && (name.contains(&title_fold) || title_fold.contains(&name)) {
            score += 4;
        }
        if names_match(app, item) {
            score += 2;
        }
        if score == 0 && (fold(app) == "playing" || fold(app).is_empty()) && is_browser(item) {
            if name.contains("youtube") || title_fold.contains("youtube") {
                score += 3;
            } else if item.live {
                score += 2;
            }
        }
        if item.live {
            score += 1;
        }
        if score > 1 && best.as_ref().map(|(current, _)| score > *current).unwrap_or(true) {
            best = Some((score, item));
        }
    }
    best.map(|(_, item)| item)
}

fn names_match(needle: &str, app: &AppAudio) -> bool {
    let needle = fold(needle);
    if needle.len() < 3 {
        return false;
    }
    let name = fold(&app.name);
    let exe = fold(&app.exe);
    let named = name.len() >= 3 && (name.contains(&needle) || needle.contains(&name));
    let filed = exe.len() >= 3 && (exe.contains(&needle) || needle.contains(&exe));
    named || filed || browser_file(&needle).iter().any(|alias| exe.contains(alias) || name.contains(alias))
}

fn browser_file(folded: &str) -> &'static [&'static str] {
    if folded.contains("chrome") || folded.contains("chromium") {
        return &["chrome"];
    }
    if folded.contains("edge") {
        return &["msedge", "edge"];
    }
    if folded.contains("firefox") {
        return &["firefox"];
    }
    if folded.contains("brave") {
        return &["brave"];
    }
    if folded.contains("opera") {
        return &["opera"];
    }
    if folded.contains("vivaldi") {
        return &["vivaldi"];
    }
    &[]
}

fn is_browser(app: &AppAudio) -> bool {
    let exe = fold(&app.exe);
    let name = fold(&app.name);
    ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "edge"]
        .iter()
        .any(|item| exe.contains(item) || name.contains(item))
}

fn fold(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_alphanumeric()).flat_map(|ch| ch.to_lowercase()).collect()
}

pub fn set(id: &str, volume: u8, muted: bool) -> Result<(), String> {
    let volume = volume.min(100);
    #[cfg(windows)]
    {
        return windows_set(id, volume, muted);
    }
    #[cfg(target_os = "linux")]
    {
        return linux_set(id, volume, muted);
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (id, volume, muted);
        Err("App volumes are not available on this system.".to_string())
    }
}

pub(crate) fn parse_pactl(text: &str) -> Vec<AppAudio> {
    let mut apps = Vec::new();
    for block in text.split("Sink Input #") {
        let mut lines = block.lines();
        let Some(header) = lines.next() else { continue };
        let id = header.trim().chars().take_while(|ch| ch.is_ascii_digit()).collect::<String>();
        if id.is_empty() {
            continue;
        }
        let mut name = String::new();
        let mut binary = String::new();
        let mut volume = 100u8;
        let mut muted = false;
        for line in lines {
            let line = line.trim();
            if let Some(value) = line.strip_prefix("Mute:") {
                muted = value.trim().eq_ignore_ascii_case("yes");
            } else if line.starts_with("Volume:") {
                volume = percent_in(line).unwrap_or(100);
            } else if let Some(value) = quoted_prop(line, "application.name") {
                name = value;
            } else if let Some(value) = quoted_prop(line, "application.process.binary") {
                binary = value;
            }
        }
        if name.is_empty() {
            name = binary;
        }
        if name.is_empty() {
            name = format!("App {id}");
        }
        apps.push(AppAudio {
            id,
            name,
            volume,
            muted,
            device: false,
            exe: std::path::Path::new(&binary)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| binary.clone()),
            live: true,
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

pub(crate) fn parse_sink_volume(text: &str) -> Option<u8> {
    percent_in(text)
}

pub(crate) fn parse_wpctl_streams(text: &str) -> Vec<(String, String)> {
    let mut streams = Vec::new();
    let mut in_streams = false;
    for line in text.lines() {
        let trimmed = line.trim().trim_start_matches(['├', '└', '─', '│', '*', ' ']);
        if trimmed.starts_with("Streams:") || line.contains("Streams:") {
            in_streams = true;
            continue;
        }
        if !in_streams {
            continue;
        }
        // The next top-level heading ends the list. A line that is not an id is one.
        let mut chars = trimmed.chars().peekable();
        if !chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
            if !trimmed.is_empty() && !trimmed.starts_with('[') {
                break;
            }
            continue;
        }
        let id: String = chars.by_ref().take_while(|ch| ch.is_ascii_digit()).collect();
        let rest: String = chars.collect();
        let name = rest.trim().trim_start_matches('.').trim();
        let name = name.split('[').next().unwrap_or(name).trim();
        if !id.is_empty() && !name.is_empty() {
            streams.push((id, name.to_string()));
        }
    }
    streams
}

fn percent_in(text: &str) -> Option<u8> {
    let start = text.find('%')?;
    let digits: String = text[..start]
        .chars()
        .rev()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse::<u8>().ok().map(|value| value.min(100))
}

fn quoted_prop(line: &str, key: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(key)?.trim().strip_prefix('=')?.trim();
    let rest = rest.strip_prefix('"').unwrap_or(rest);
    let rest = rest.strip_suffix('"').unwrap_or(rest);
    let cleaned = rest.trim();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn digits(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.chars().all(|ch| ch.is_ascii_digit()) {
        Ok(id)
    } else {
        Err("That app is not in the list any more.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn linux_list() -> Result<Vec<AppAudio>, String> {
    if crate::overlay::which("pactl").is_some() {
        return pactl_list();
    }
    if crate::overlay::which("wpctl").is_some() {
        return wpctl_list();
    }
    Err("App volumes need pactl or wpctl, and neither was found.".to_string())
}

#[cfg(target_os = "linux")]
fn pactl_list() -> Result<Vec<AppAudio>, String> {
    let mut apps = Vec::new();
    if let Some(device) = pactl_device() {
        apps.push(device);
    }
    let output = crate::process::command("pactl")
        .args(["list", "sink-inputs"])
        .output()
        .map_err(|error| format!("Could not read app volumes: {error}"))?;
    if !output.status.success() {
        return Err("Could not read app volumes.".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    apps.extend(parse_pactl(&text));
    Ok(apps)
}

#[cfg(target_os = "linux")]
fn pactl_device() -> Option<AppAudio> {
    let volume = crate::process::command("pactl")
        .args(["get-sink-volume", "@DEFAULT_SINK@"])
        .output()
        .ok()?;
    let mute = crate::process::command("pactl")
        .args(["get-sink-mute", "@DEFAULT_SINK@"])
        .output()
        .ok();
    let text = String::from_utf8_lossy(&volume.stdout);
    Some(AppAudio {
        id: "device".to_string(),
        name: "Speakers".to_string(),
        volume: parse_sink_volume(&text).unwrap_or(100),
        muted: mute
            .as_ref()
            .map(|item| String::from_utf8_lossy(&item.stdout).to_lowercase().contains("yes"))
            .unwrap_or(false),
        device: true,
        exe: String::new(),
        live: false,
    })
}

#[cfg(target_os = "linux")]
fn wpctl_list() -> Result<Vec<AppAudio>, String> {
    let output = crate::process::command("wpctl")
        .arg("status")
        .output()
        .map_err(|error| format!("Could not read app volumes: {error}"))?;
    if !output.status.success() {
        return Err("Could not read app volumes.".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut apps = Vec::new();
    for (id, name) in parse_wpctl_streams(&text) {
        let volume = crate::process::command("wpctl").args(["get-volume", &id]).output().ok();
        let shown = volume
            .as_ref()
            .map(|item| String::from_utf8_lossy(&item.stdout).to_string())
            .unwrap_or_default();
        let muted = shown.to_lowercase().contains("muted");
        let level = shown
            .split_whitespace()
            .find_map(|part| part.parse::<f32>().ok())
            .map(|value| (value * 100.0).round().clamp(0.0, 100.0) as u8)
            .unwrap_or(100);
        apps.push(AppAudio {
            id,
            name,
            volume: level,
            muted,
            device: false,
            exe: String::new(),
            live: true,
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

#[cfg(target_os = "linux")]
fn linux_set(id: &str, volume: u8, muted: bool) -> Result<(), String> {
    if crate::overlay::which("pactl").is_some() {
        return pactl_set(id, volume, muted);
    }
    if crate::overlay::which("wpctl").is_some() {
        return wpctl_set(id, volume, muted);
    }
    Err("App volumes need pactl or wpctl, and neither was found.".to_string())
}

#[cfg(target_os = "linux")]
fn pactl_set(id: &str, volume: u8, muted: bool) -> Result<(), String> {
    let mute = if muted { "1" } else { "0" };
    let percent = format!("{volume}%");
    if id == "device" {
        run_pactl(&["set-sink-volume", "@DEFAULT_SINK@", &percent])?;
        run_pactl(&["set-sink-mute", "@DEFAULT_SINK@", mute])?;
        return Ok(());
    }
    let id = digits(id)?;
    run_pactl(&["set-sink-input-volume", id, &percent])?;
    run_pactl(&["set-sink-input-mute", id, mute])?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn run_pactl(args: &[&str]) -> Result<(), String> {
    let status = crate::process::command("pactl")
        .args(args)
        .status()
        .map_err(|error| format!("Could not change that volume: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not change that volume.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn wpctl_set(id: &str, volume: u8, muted: bool) -> Result<(), String> {
    let id = digits(id)?;
    let level = format!("{:.2}", volume as f32 / 100.0);
    let mute = if muted { "1" } else { "0" };
    let volume_ok = crate::process::command("wpctl")
        .args(["set-volume", id, &level])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let mute_ok = crate::process::command("wpctl")
        .args(["set-mute", id, mute])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if volume_ok && mute_ok {
        Ok(())
    } else {
        Err("Could not change that volume.".to_string())
    }
}

#[cfg(windows)]
fn windows_list() -> Result<Vec<AppAudio>, String> {
    unsafe { windows_list_inner() }
}

#[cfg(windows)]
fn windows_set(id: &str, volume: u8, muted: bool) -> Result<(), String> {
    unsafe { windows_set_inner(id, volume, muted) }
}

#[cfg(windows)]
unsafe fn windows_list_inner() -> Result<Vec<AppAudio>, String> {
    use std::collections::BTreeMap;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl2, IAudioSessionManager2,
        ISimpleAudioVolume, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::core::Interface;

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator =
        windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(com_err)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(com_err)?;
    let mut apps = Vec::new();
    if let Ok(endpoint) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
        let volume = endpoint.GetMasterVolumeLevelScalar().unwrap_or(1.0);
        let muted = endpoint.GetMute().map(|value| value.as_bool()).unwrap_or(false);
        apps.push(AppAudio {
            id: "device".to_string(),
            name: "Speakers".to_string(),
            volume: percent(volume),
            muted,
            device: true,
            exe: String::new(),
            live: false,
        });
    }
    let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(com_err)?;
    let sessions = manager.GetSessionEnumerator().map_err(com_err)?;
    let count = sessions.GetCount().map_err(com_err)?;
    let mut grouped: BTreeMap<u32, AppAudio> = BTreeMap::new();
    for index in 0..count {
        let Ok(control) = sessions.GetSession(index) else { continue };
        let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
        if control2.IsSystemSoundsSession().0 == 0 {
            continue;
        }
        if control2.GetState().ok() == Some(AudioSessionStateExpired) {
            continue;
        }
        let pid = control2.GetProcessId().unwrap_or(0);
        if pid == 0 {
            continue;
        }
        let Ok(volume_ctl) = control.cast::<ISimpleAudioVolume>() else { continue };
        let volume = volume_ctl.GetMasterVolume().unwrap_or(1.0);
        let muted = volume_ctl.GetMute().map(|value| value.as_bool()).unwrap_or(false);
        let display = control2.GetDisplayName().map(pwstr).unwrap_or_default();
        let process = process_name(pid);
        let name = pretty_name(&display, &process);
        let exe = std::path::Path::new(&process)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_default();
        let live = control2.GetState().ok() == Some(AudioSessionStateActive);
        grouped
            .entry(pid)
            .and_modify(|current| {
                current.live = current.live || live;
                if !muted {
                    current.muted = false;
                    current.volume = current.volume.max(percent(volume));
                }
                if current.name.starts_with("App ") && !name.starts_with("App ") {
                    current.name = name.clone();
                }
                if current.exe.is_empty() && !exe.is_empty() {
                    current.exe = exe.clone();
                }
            })
            .or_insert(AppAudio {
                id: format!("win:{pid}"),
                name,
                volume: percent(volume),
                muted,
                device: false,
                exe,
                live,
            });
    }
    let mut rest: Vec<AppAudio> = grouped.into_values().collect();
    rest.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps.extend(rest);
    Ok(apps)
}

#[cfg(windows)]
unsafe fn windows_set_inner(id: &str, volume: u8, muted: bool) -> Result<(), String> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, ISimpleAudioVolume,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::core::Interface;

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator =
        windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(com_err)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(com_err)?;
    let level = volume as f32 / 100.0;
    if id == "device" {
        let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).map_err(com_err)?;
        endpoint
            .SetMasterVolumeLevelScalar(level, std::ptr::null())
            .map_err(com_err)?;
        endpoint.SetMute(muted, std::ptr::null()).map_err(com_err)?;
        return Ok(());
    }
    let pid: u32 = id
        .strip_prefix("win:")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "That app is not in the list any more.".to_string())?;
    let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(com_err)?;
    let sessions = manager.GetSessionEnumerator().map_err(com_err)?;
    let count = sessions.GetCount().map_err(com_err)?;
    let mut found = false;
    for index in 0..count {
        let Ok(control) = sessions.GetSession(index) else { continue };
        let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
        if control2.GetProcessId().unwrap_or(0) != pid {
            continue;
        }
        let Ok(volume_ctl) = control.cast::<ISimpleAudioVolume>() else { continue };
        let _ = volume_ctl.SetMasterVolume(level, std::ptr::null());
        let _ = volume_ctl.SetMute(muted, std::ptr::null());
        found = true;
    }
    if found {
        Ok(())
    } else {
        Err("That app is not playing sound any more.".to_string())
    }
}

#[cfg(windows)]
fn percent(level: f32) -> u8 {
    (level * 100.0).round().clamp(0.0, 100.0) as u8
}

#[cfg(windows)]
fn pretty_name(display: &str, process: &str) -> String {
    let display = display.trim();
    if !display.is_empty()
        && !display.starts_with('@')
        && !display.contains('\\')
        && !display.contains('/')
    {
        return display.to_string();
    }
    let process = process.trim();
    if process.is_empty() {
        return "App".to_string();
    }
    std::path::Path::new(process)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "App".to_string())
}

#[cfg(windows)]
fn process_name(pid: u32) -> String {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::PWSTR;

    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buffer = [0u16; 520];
        let mut len = buffer.len() as u32;
        let read = QueryFullProcessImageNameW(
            handle.clone(),
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        if read.is_err() || len == 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..len as usize])
    }
}

#[cfg(windows)]
fn pwstr(ptr: windows::core::PWSTR) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let text = unsafe { ptr.to_string() }.unwrap_or_default();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(ptr.0 as *const _)) };
    text
}

#[cfg(windows)]
fn com_err(error: windows::core::Error) -> String {
    let text = error.to_string();
    let text = text.trim();
    if text.is_empty() {
        "App volumes could not be read.".to_string()
    } else {
        format!("App volumes could not be read. {text}")
    }
}

pub(crate) fn parse_pactl_blocks(text: &str, header: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for block in text.split(header).skip(1) {
        let mut name = String::new();
        let mut description = String::new();
        for line in block.lines() {
            let line = line.trim();
            if let Some(value) = line.strip_prefix("Name:") {
                name = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("Description:") {
                description = value.trim().to_string();
            }
        }
        if name.is_empty() || name.ends_with(".monitor") {
            continue;
        }
        let label = if description.is_empty() { name.clone() } else { description };
        out.push((name, label));
    }
    out
}

#[cfg(target_os = "linux")]
fn linux_devices() -> Result<Vec<AudioDevice>, String> {
    let mut devices = Vec::new();
    if let Some(list) = pactl_kind("sinks", "output") {
        devices.extend(list);
    }
    if let Some(list) = pactl_kind("sources", "input") {
        devices.extend(list);
    }
    if devices.is_empty() {
        devices.extend(wpctl_devices());
    }
    if devices.is_empty() {
        return Err("No audio devices were found.".to_string());
    }
    Ok(devices)
}

#[cfg(target_os = "linux")]
fn pactl_kind(which: &str, kind: &str) -> Option<Vec<AudioDevice>> {
    let output = crate::process::command("pactl").args(["list", which]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let header = if which == "sources" { "Source #" } else { "Sink #" };
    let default_name = crate::process::command("pactl")
        .args([if which == "sources" { "get-default-source" } else { "get-default-sink" }])
        .output()
        .ok()
        .filter(|item| item.status.success())
        .map(|item| String::from_utf8_lossy(&item.stdout).trim().to_string())
        .unwrap_or_default();
    let devices = parse_pactl_blocks(&text, header)
        .into_iter()
        .map(|(id, name)| AudioDevice {
            current: id == default_name,
            id,
            name,
            kind: kind.to_string(),
        })
        .collect::<Vec<_>>();
    if devices.is_empty() { None } else { Some(devices) }
}

#[cfg(target_os = "linux")]
fn wpctl_devices() -> Vec<AudioDevice> {
    let Ok(output) = crate::process::command("wpctl").arg("status").output() else { return Vec::new() };
    if !output.status.success() {
        return Vec::new();
    }
    parse_wpctl_devices(&String::from_utf8_lossy(&output.stdout))
}

pub(crate) fn parse_wpctl_devices(text: &str) -> Vec<AudioDevice> {
    let mut out = Vec::new();
    let mut kind = "";
    for line in text.lines() {
        let trimmed = line.trim().trim_start_matches(['├', '└', '─', '│', ' ']);
        if trimmed.starts_with("Sinks:") {
            kind = "output";
            continue;
        }
        if trimmed.starts_with("Sources:") {
            kind = "input";
            continue;
        }
        if trimmed.ends_with(':') && !trimmed.contains('.') {
            kind = "";
            continue;
        }
        if kind.is_empty() {
            continue;
        }
        let current = trimmed.starts_with('*');
        let trimmed = trimmed.trim_start_matches(['*', ' ']);
        let mut chars = trimmed.chars().peekable();
        if !chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
            continue;
        }
        let id: String = chars.by_ref().take_while(|ch| ch.is_ascii_digit()).collect();
        let name = chars.collect::<String>().trim().trim_start_matches('.').trim().to_string();
        if id.is_empty() || name.is_empty() || name.ends_with(".monitor") {
            continue;
        }
        out.push(AudioDevice { id, name, kind: kind.to_string(), current });
    }
    out
}

#[cfg(target_os = "linux")]
fn linux_use_device(id: &str, kind: &str) -> Result<(), String> {
    if !id.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '@' | ':' | '/' | '+')) {
        return Err("That device is not in the list any more.".to_string());
    }
    let verb = if kind == "input" { "set-default-source" } else { "set-default-sink" };
    let pactl = crate::process::command("pactl").args([verb, id]).status();
    if pactl.map(|status| status.success()).unwrap_or(false) {
        return Ok(());
    }
    let wp = crate::process::command("wpctl").args(["set-default", id]).status();
    if wp.map(|status| status.success()).unwrap_or(false) {
        Ok(())
    } else {
        Err("Could not switch to that device.".to_string())
    }
}

#[cfg(windows)]
unsafe fn windows_devices() -> Result<Vec<AudioDevice>, String> {
    use windows::Win32::Media::Audio::{
        eCapture, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator =
        windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(com_err)?;
    let mut devices = Vec::new();
    devices.extend(endpoint_list(&enumerator, eRender, "output")?);
    devices.extend(endpoint_list(&enumerator, eCapture, "input")?);
    if devices.is_empty() {
        return Err("No audio devices were found.".to_string());
    }
    Ok(devices)
}

#[cfg(windows)]
unsafe fn endpoint_list(
    enumerator: &windows::Win32::Media::Audio::IMMDeviceEnumerator,
    flow: windows::Win32::Media::Audio::EDataFlow,
    kind: &str,
) -> Result<Vec<AudioDevice>, String> {
    use windows::Win32::Media::Audio::{eConsole, DEVICE_STATE_ACTIVE};

    let current = enumerator
        .GetDefaultAudioEndpoint(flow, eConsole)
        .ok()
        .and_then(|device| device.GetId().ok())
        .map(pwstr)
        .unwrap_or_default();
    let collection = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE).map_err(com_err)?;
    let count = collection.GetCount().map_err(com_err)?;
    let mut devices = Vec::new();
    for index in 0..count {
        let Ok(device) = collection.Item(index) else { continue };
        let Ok(id_ptr) = device.GetId() else { continue };
        let id = pwstr(id_ptr);
        if id.is_empty() {
            continue;
        }
        let name = friendly_name(&device).unwrap_or_else(|| id.clone());
        devices.push(AudioDevice {
            current: id == current,
            id,
            name,
            kind: kind.to_string(),
        });
    }
    Ok(devices)
}

#[cfg(windows)]
unsafe fn friendly_name(device: &windows::Win32::Media::Audio::IMMDevice) -> Option<String> {
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::STGM_READ;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::core::GUID;

    let store: IPropertyStore = device.OpenPropertyStore(STGM_READ).ok()?;
    let key = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };
    let value = store.GetValue(&key).ok()?;
    let text = PropVariantToStringAlloc(&value).ok()?;
    let name = pwstr(text);
    if name.trim().is_empty() { None } else { Some(name) }
}

#[cfg(windows)]
unsafe fn windows_use_device(id: &str) -> Result<(), String> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::core::{Interface, IUnknown, PCWSTR, GUID, HRESULT};

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    let name = PCWSTR(wide.as_ptr());
    let client = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
    let policy: IUnknown = CoCreateInstance(&client, None, CLSCTX_ALL).map_err(|_| "Could not switch to that device.".to_string())?;
    let iid = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    let mut raw = std::ptr::null_mut();
    let vtable = *(policy.as_raw() as *const *const IUnknownVtbl);
    let hr = ((*vtable).query)(policy.as_raw(), &iid, &mut raw);
    if hr.is_err() || raw.is_null() {
        return Err("Could not switch to that device.".to_string());
    }
    let slots = *(raw as *const *const usize);
    let set_default: unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, i32) -> HRESULT =
        std::mem::transmute(*slots.add(13));
    let mut failed = false;
    for role in [0, 1, 2] {
        if (set_default)(raw, name, role).is_err() {
            failed = true;
        }
    }
    let release: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32 = std::mem::transmute(*slots.add(2));
    release(raw);
    if failed {
        Err("Could not switch to that device.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct IUnknownVtbl {
    query: unsafe extern "system" fn(*mut core::ffi::c_void, *const windows::core::GUID, *mut *mut core::ffi::c_void) -> windows::core::HRESULT,
    add_ref: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32,
    release: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_youtube_tab_matches_the_browser_that_is_playing_it() {
        let apps = vec![
            AppAudio {
                id: "win:9".to_string(),
                name: "Chrome".to_string(),
                volume: 100,
                muted: false,
                device: false,
                exe: "chrome".to_string(),
                live: false,
            },
            AppAudio {
                id: "win:4".to_string(),
                name: "Never Gonna Give You Up - YouTube".to_string(),
                volume: 35,
                muted: false,
                device: false,
                exe: "chrome".to_string(),
                live: true,
            },
        ];
        let hit = volume_hit("Chrome", "Never Gonna Give You Up", &apps).expect("browser");
        assert_eq!(hit.id, "win:4");
        assert_eq!(hit.volume, 35);
        assert!(volume_hit("Playing", "Never Gonna Give You Up - YouTube", &apps).is_some());
        assert!(volume_hit("Speakers", "", &apps).is_none());
    }

    #[test]
    fn pactl_blocks_become_one_row_per_app() {
        let text = "\
Sink Input #67
\tMute: no
\tVolume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB
\tProperties:
\t\tapplication.name = \"Firefox\"
\t\tapplication.process.binary = \"firefox\"
Sink Input #12
\tMute: yes
\tVolume: front-left: 65536 / 100% / 0.00 dB
\tProperties:
\t\tapplication.process.binary = \"game.exe\"
";
        let apps = parse_pactl(text);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "Firefox");
        assert_eq!(apps[0].id, "67");
        assert_eq!(apps[0].volume, 50);
        assert!(!apps[0].muted);
        assert_eq!(apps[1].name, "game.exe");
        assert!(apps[1].muted);
    }

    #[test]
    fn wpctl_streams_keep_the_id_and_the_name() {
        let text = "\
Audio
 ├─ Streams:
 │      42. Firefox
 │  *   7. Game [Stream]
Settings
";
        let streams = parse_wpctl_streams(text);
        assert_eq!(streams, vec![("42".to_string(), "Firefox".to_string()), ("7".to_string(), "Game".to_string())]);
    }

    #[test]
    fn a_volume_line_without_a_percent_is_left_alone() {
        assert_eq!(parse_sink_volume("Volume: front-left: 0"), None);
        assert_eq!(parse_sink_volume("Volume: front-left: 1 /  7%"), Some(7));
    }

    #[test]
    fn pactl_names_the_speakers_and_skips_monitors() {
        let sinks = "Sink #1\n\tName: alsa_output.speakers\n\tDescription: Speakers\n";
        let sources = "Source #2\n\tName: alsa_input.mic\n\tDescription: USB mic\nSource #3\n\tName: alsa_output.speakers.monitor\n\tDescription: Monitor\n";
        assert_eq!(parse_pactl_blocks(sinks, "Sink #"), vec![("alsa_output.speakers".to_string(), "Speakers".to_string())]);
        assert_eq!(parse_pactl_blocks(sources, "Source #"), vec![("alsa_input.mic".to_string(), "USB mic".to_string())]);
    }
}
