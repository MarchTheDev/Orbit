//! What is playing in another app, so the overlay can pause it.
//!
//! Windows asks the system media controls. That is the same list the volume
//! keys use, so a browser video and a music app both show up. Linux asks
//! playerctl when it is installed. The volume slider is the app mixer, because
//! the media controls do not set an app's volume.

use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub app: String,
    pub playing: bool,
    pub art: String,
    pub volume_id: String,
    pub volume: u8,
    pub muted: bool,
}

pub fn now() -> Vec<NowPlaying> {
    let mut items = platform_now();
    let apps = crate::audio::list().unwrap_or_default();
    for item in &mut items {
        let (id, volume, muted) = match_volume(&item.app, &apps);
        item.volume_id = id;
        item.volume = volume;
        item.muted = muted;
    }
    items
}

pub fn control(id: &str, action: &str) -> Result<(), String> {
    platform_control(id, action)
}

pub(crate) fn pretty_source(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return "Playing".to_string();
    }
    let lower = raw.to_ascii_lowercase();
    if lower.contains("chrome") {
        return "Chrome".to_string();
    }
    if lower.contains("msedge") || lower.contains("edge") {
        return "Edge".to_string();
    }
    if lower.contains("firefox") {
        return "Firefox".to_string();
    }
    if lower.contains("spotify") {
        return "Spotify".to_string();
    }
    if lower.contains("vlc") {
        return "VLC".to_string();
    }
    let main = raw.split('!').next().unwrap_or(raw);
    let tail = main.rsplit(['\\', '/']).next().unwrap_or(main);
    let name = tail.split('_').next().unwrap_or(tail);
    let name = name.rsplit('.').next().unwrap_or(name).trim();
    if name.is_empty() { "Playing".to_string() } else { name.to_string() }
}

pub(crate) fn match_volume(app: &str, apps: &[crate::audio::AppAudio]) -> (String, u8, bool) {
    let needle = app.trim().to_ascii_lowercase();
    if needle.is_empty() || needle == "playing" {
        return (String::new(), 100, false);
    }
    for item in apps {
        if item.device {
            continue;
        }
        let name = item.name.to_ascii_lowercase();
        if name.contains(&needle) || needle.contains(&name) {
            return (item.id.clone(), item.volume, item.muted);
        }
    }
    (String::new(), 100, false)
}

pub(crate) fn parse_playerctl(text: &str) -> Vec<NowPlaying> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut parts = line.split('\t');
        let app = parts.next().unwrap_or("").trim();
        let status = parts.next().unwrap_or("").trim();
        let title = parts.next().unwrap_or("").trim();
        let artist = parts.next().unwrap_or("").trim();
        let art = parts.next().unwrap_or("").trim();
        if title.is_empty() && artist.is_empty() {
            continue;
        }
        out.push(NowPlaying {
            id: if app.is_empty() { title.to_string() } else { app.to_string() },
            title: if title.is_empty() { artist.to_string() } else { title.to_string() },
            artist: artist.to_string(),
            app: if app.is_empty() { "Playing".to_string() } else { app.to_string() },
            playing: status.eq_ignore_ascii_case("Playing"),
            art: art.to_string(),
            volume_id: String::new(),
            volume: 100,
            muted: false,
        });
    }
    out
}

fn platform_now() -> Vec<NowPlaying> {
    #[cfg(windows)]
    {
        return windows_now();
    }
    #[cfg(target_os = "linux")]
    {
        return linux_now();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Vec::new()
    }
}

fn platform_control(id: &str, action: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_control(id, action);
    }
    #[cfg(target_os = "linux")]
    {
        return linux_control(id, action);
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (id, action);
        Err("Nothing is playing.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn linux_now() -> Vec<NowPlaying> {
    let from_playerctl = playerctl_now();
    if !from_playerctl.is_empty() {
        return from_playerctl;
    }
    busctl_now()
}

#[cfg(target_os = "linux")]
fn playerctl_now() -> Vec<NowPlaying> {
    let output = crate::process::command("playerctl")
        .args([
            "--all-players",
            "metadata",
            "--format",
            "{{playerName}}\t{{status}}\t{{title}}\t{{artist}}\t{{mpris:artUrl}}",
        ])
        .output();
    let Ok(output) = output else { return Vec::new() };
    if output.stdout.is_empty() {
        return Vec::new();
    }
    parse_playerctl(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "linux")]
fn linux_control(id: &str, action: &str) -> Result<(), String> {
    if id.starts_with("org.mpris.") {
        return busctl_control(id, action);
    }
    let verb = match action {
        "next" => "next",
        "previous" => "previous",
        _ => "play-pause",
    };
    let mut command = crate::process::command("playerctl");
    if !id.is_empty() {
        command.args(["-p", id]);
    }
    if command.arg(verb).output().ok().is_some_and(|output| output.status.success()) {
        return Ok(());
    }
    for item in busctl_now() {
        if item.id.ends_with(&format!(".{id}")) || item.app.eq_ignore_ascii_case(id) {
            return busctl_control(&item.id, action);
        }
    }
    Err("Nothing is playing.".to_string())
}

#[cfg(target_os = "linux")]
fn busctl_now() -> Vec<NowPlaying> {
    let names = busctl_json(&[
        "--user",
        "--json=short",
        "call",
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "ListNames",
    ]);
    let Some(names) = names.as_ref().and_then(|value| value.get("data")).and_then(|value| value.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for name in names {
        let Some(name) = name.as_str() else { continue };
        if !name.starts_with("org.mpris.MediaPlayer2.") {
            continue;
        }
        if let Some(item) = busctl_player(name) {
            out.push(item);
        }
        if out.len() >= 8 {
            break;
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn busctl_player(name: &str) -> Option<NowPlaying> {
    let status = busctl_json(&["--user", "--json=short", "get-property", name, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "PlaybackStatus"]);
    let meta = busctl_json(&["--user", "--json=short", "get-property", name, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", "Metadata"]);
    let playing = status.as_ref().and_then(|value| value.get("data")).and_then(|value| value.as_str()).unwrap_or("").eq_ignore_ascii_case("Playing");
    let fields = meta.as_ref().and_then(|value| value.get("data")).and_then(|value| value.as_array());
    let title = mpris_text(fields, "xesam:title");
    let artist = mpris_text(fields, "xesam:artist");
    if title.is_empty() && artist.is_empty() {
        return None;
    }
    let art = mpris_text(fields, "mpris:artUrl");
    let app = name.trim_start_matches("org.mpris.MediaPlayer2.");
    let app = app.split('.').next().unwrap_or(app);
    let app = if app.is_empty() { "Playing" } else { app };
    Some(NowPlaying {
        id: name.to_string(),
        title: if title.is_empty() { artist.clone() } else { title },
        artist,
        app: pretty_source(app),
        playing,
        art,
        volume_id: String::new(),
        volume: 100,
        muted: false,
    })
}

#[cfg(target_os = "linux")]
fn mpris_text(fields: Option<&Vec<serde_json::Value>>, key: &str) -> String {
    let Some(fields) = fields else { return String::new() };
    for field in fields {
        let Some(pair) = field.as_array() else { continue };
        if pair.first().and_then(|item| item.as_str()) != Some(key) {
            continue;
        }
        let data = pair.get(1).and_then(|item| item.get("data"));
        if let Some(text) = data.and_then(|item| item.as_str()) {
            return text.trim().to_string();
        }
        if let Some(first) = data.and_then(|item| item.as_array()).and_then(|items| items.first()).and_then(|item| item.as_str()) {
            return first.trim().to_string();
        }
    }
    String::new()
}

#[cfg(target_os = "linux")]
fn busctl_control(id: &str, action: &str) -> Result<(), String> {
    let method = match action {
        "next" => "Next",
        "previous" => "Previous",
        _ => "PlayPause",
    };
    let output = crate::process::command("busctl")
        .args(["--user", "call", id, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", method])
        .output()
        .map_err(|_| "Nothing is playing.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Nothing is playing.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn busctl_json(args: &[&str]) -> Option<serde_json::Value> {
    let output = crate::process::command("busctl").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

#[cfg(windows)]
fn windows_now() -> Vec<NowPlaying> {
    // join() has to run on a thread that initialized WinRT itself. The command
    // pool is not that thread, and waiting there can stall the panel.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(windows_now_here());
    });
    rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_default()
}

#[cfg(windows)]
fn windows_now_here() -> Vec<NowPlaying> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    winrt_ready();
    let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().and_then(|op| op.join()) else {
        return Vec::new();
    };
    let Ok(sessions) = manager.GetSessions() else { return Vec::new() };
    let count = sessions.Size().unwrap_or(0).min(8);
    let mut out = Vec::new();
    for index in 0..count {
        let Ok(session) = sessions.GetAt(index) else { continue };
        if let Some(item) = read_session(&session) {
            out.push(item);
        }
    }
    out
}

#[cfg(windows)]
fn windows_control(id: &str, action: &str) -> Result<(), String> {
    let id = id.to_string();
    let action = action.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(windows_control_here(&id, &action));
    });
    rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or(Err("Nothing is playing.".to_string()))
}

#[cfg(windows)]
fn windows_control_here(id: &str, action: &str) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    winrt_ready();
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .and_then(|op| op.join())
        .map_err(|error| format!("Nothing is playing. {error}"))?;
    let sessions = manager.GetSessions().map_err(|error| error.to_string())?;
    let count = sessions.Size().unwrap_or(0).min(8);
    for index in 0..count {
        let session = sessions.GetAt(index).map_err(|error| error.to_string())?;
        let raw = session.SourceAppUserModelId().ok().map(text).unwrap_or_default();
        if !id.is_empty() && raw != id && pretty_source(&raw) != id {
            continue;
        }
        let op = match action {
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            _ => session.TryTogglePlayPauseAsync(),
        }
        .map_err(|error| error.to_string())?;
        op.join().map_err(|error| error.to_string())?;
        return Ok(());
    }
    Err("Nothing is playing.".to_string())
}

#[cfg(windows)]
fn winrt_ready() {
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
}

#[cfg(windows)]
fn read_session(session: &windows::Media::Control::GlobalSystemMediaTransportControlsSession) -> Option<NowPlaying> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

    let raw = session.SourceAppUserModelId().ok().map(text).unwrap_or_default();
    let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let title = props.Title().ok().map(text).unwrap_or_default();
    let artist = props.Artist().ok().map(text).unwrap_or_default();
    if title.is_empty() && artist.is_empty() {
        return None;
    }
    let playing = session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);
    let app = pretty_source(&raw);
    let key = format!("{raw}|{title}");
    Some(NowPlaying {
        id: if raw.is_empty() { title.clone() } else { raw },
        title: if title.is_empty() { artist.clone() } else { title },
        artist,
        app,
        playing,
        art: art_for(&props, &key),
        volume_id: String::new(),
        volume: 100,
        muted: false,
    })
}

#[cfg(windows)]
fn art_for(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties, key: &str) -> String {
    if let Some(hit) = cached_art(key) {
        return hit;
    }
    let Some(art) = read_thumb(props) else { return String::new() };
    store_art(key, art.clone());
    art
}

#[cfg(windows)]
fn read_thumb(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
    use windows::Storage::Streams::DataReader;

    let reference = props.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if !(32..1_500_000).contains(&size) {
        let _ = stream.Close();
        return None;
    }
    let input = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
    if loaded == 0 {
        let _ = stream.Close();
        return None;
    }
    let mut bytes = vec![0u8; loaded as usize];
    if reader.ReadBytes(&mut bytes).is_err() {
        let _ = stream.Close();
        return None;
    }
    let mime = stream.ContentType().ok().map(text).filter(|item| !item.is_empty()).unwrap_or_else(|| "image/jpeg".to_string());
    let _ = stream.Close();
    Some(format!("data:{mime};base64,{}", b64(&bytes)))
}

#[cfg(windows)]
fn text(value: windows::core::HSTRING) -> String {
    value.to_string_lossy().trim().to_string()
}

#[cfg(windows)]
fn cached_art(key: &str) -> Option<String> {
    ART.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).iter().find(|(saved, _)| saved == key).map(|(_, art)| art.clone())
}

#[cfg(windows)]
fn store_art(key: &str, art: String) {
    let mut cache = ART.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.retain(|(saved, _)| saved != key);
    cache.push((key.to_string(), art));
    if cache.len() > 6 {
        cache.remove(0);
    }
}

#[cfg(windows)]
static ART: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

pub(crate) fn b64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let n = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8) | bytes[index + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        index += 3;
    }
    if index < bytes.len() {
        let left = bytes.len() - index;
        let n = if left == 1 {
            (bytes[index] as u32) << 16
        } else {
            ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8)
        };
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if left == 2 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
            out.push('=');
        } else {
            out.push('=');
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_browser_name_is_short_enough_to_match_the_mixer() {
        assert_eq!(pretty_source("Google.Chrome_8wekyb3d8bbwe!App"), "Chrome");
        assert_eq!(pretty_source("MSEdge"), "Edge");
        assert_eq!(pretty_source(""), "Playing");
    }

    #[test]
    fn playerctl_lines_become_sessions() {
        let items = parse_playerctl("spotify\tPlaying\tNight\tOrbit\thttp://cover\n\nbrowser\tPaused\tA video\tChannel\t\n");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Night");
        assert!(items[0].playing);
        assert!(!items[1].playing);
        assert_eq!(items[1].art, "");
    }

    #[test]
    fn a_known_string_encodes() {
        assert_eq!(b64(b"Man"), "TWFu");
        assert_eq!(b64(b"Ma"), "TWE=");
    }
}
