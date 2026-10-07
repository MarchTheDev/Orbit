//! Achievements, read from the game's own Steam Community page.
//!
//! The list is public: every game with achievements has a page at
//! `steamcommunity.com/stats/<app>/achievements`, which is HTML and needs no
//! key, no login and no SDK. That is the same page a player would read, so it
//! is the same list, and it even carries the share of players who have each one,
//! which is more interesting than the achievement alone.
//!
//! Whether an achievement is ticked is the player's own mark by default, kept
//! in the library, and nothing is ever reported back to Steam. Orbit will only
//! claim to know what somebody unlocked when Steam itself says so: with an API
//! key and the player's own id, [`unlocks`] asks for the real record and gets
//! it with the moment each one happened. Without a key there is nothing to ask,
//! so the ticks stay manual rather than guessed.

use serde::{Deserialize, Serialize};

/// One achievement, as the game's page describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    /// Steam's own API name, which is stable even when the title is not.
    pub id: String,
    pub name: String,
    pub description: String,
    /// The icon on Steam's CDN, or empty when the page had none.
    pub icon: String,
    /// The share of players who have it, as a percentage.
    pub percent: f64,
    /// Whether the player has it. Read back as it was saved; a fresh list is
    /// all locked, which is the honest default: Orbit does not know.
    #[serde(default)]
    pub unlocked: bool,
    /// When it was unlocked, as seconds since the epoch. Zero means "not
    /// unlocked", or "unlocked, but nobody said when" for a tick done by hand.
    #[serde(default)]
    pub unlocked_at: u64,
}

/// Every achievement for an app, in the order the page lists them.
pub async fn fetch(app_id: u64) -> Result<Vec<Achievement>, String> {
    let url = format!("https://steamcommunity.com/stats/{app_id}/achievements");
    let client = crate::metadata::client()?;
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not reach the Steam Community page: {e}"))?
        .error_for_status()
        .map_err(|_| {
            format!("Steam has no achievements page for app {app_id}. Most games without achievements have none.")
        })?
        .text()
        .await
        .map_err(|e| format!("Could not read the achievements page: {e}"))?;

    let rows = parse(&html, app_id);
    if rows.is_empty() {
        log::info!("no achievements found on the page for app {app_id}");
    }
    Ok(rows)
}

/// Pull the achievements out of the page.
///
/// The page is generated rather than an API, so this looks for the few things
/// that are structural rather than decorative: each row has the icon, then the
/// share of players, then the name and description. Anchoring on the icon URL is
/// what makes it reliable, because those URLs carry the app id and the
/// achievement's own API name, which is exactly the identity worth keeping.
fn parse(html: &str, app_id: u64) -> Vec<Achievement> {
    let mut out: Vec<Achievement> = Vec::new();
    let marker = format!("community_assets/images/apps/{app_id}/");
    // Work through the page one row at a time. The icon is the anchor: the URL
    // carries both the app id and the achievement's own name.
    let icons: Vec<usize> = memchr_all(html, &marker);
    for (n, at) in icons.iter().enumerate() {
        let tail = &html[*at..];
        let icon_end = tail.find(['"', '\'', ' ']).unwrap_or(tail.len());
        let icon_path = &tail[..icon_end];
        // Everything belonging to this row is between its icon and the next one.
        let row_end = icons.get(n + 1).map(|next| next - at).unwrap_or(tail.len());
        let row = &tail[icon_end..row_end];

        let id = icon_path
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .trim_end_matches(".jpg")
            .to_string();
        let name = tag_text(row, "h3").unwrap_or_default();
        if name.is_empty() || id.is_empty() || out.iter().any(|a| a.id == id) {
            continue;
        }
        out.push(Achievement {
            id,
            name: unescape(&name),
            description: unescape(&tag_text(row, "h5").unwrap_or_default()),
            icon: format!("https://shared.fastly.steamstatic.com/{icon_path}"),
            percent: first_percent(row),
            unlocked: false,
            unlocked_at: 0,
        });
    }
    out
}

/// Every place a marker appears, in order. Plain string matching, because the
/// only thing being read here is a URL that either appears or does not.
fn memchr_all(haystack: &str, needle: &str) -> Vec<usize> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = haystack[from..].find(needle) {
        let absolute = from + at;
        out.push(absolute);
        from = absolute + needle.len();
    }
    out
}

/// The text inside the first `<tag ...>...</tag>` in a piece of HTML.
fn tag_text(html: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = html.find(&open)?;
    let after_open = html[start..].find('>')? + start + 1;
    let end = html[after_open..].find(&format!("</{tag}>"))? + after_open;
    Some(html[after_open..end].trim().to_string())
}

/// The first percentage on a line, such as `74.1%`.
fn first_percent(text: &str) -> f64 {
    let bytes: Vec<char> = text.chars().collect();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_digit() {
            let start = index;
            while index < bytes.len() && (bytes[index].is_ascii_digit() || bytes[index] == '.') {
                index += 1;
            }
            if index < bytes.len() && bytes[index] == '%' {
                let number: String = bytes[start..index].iter().collect();
                return number.parse().unwrap_or(0.0);
            }
        }
        index += 1;
    }
    0.0
}

/// The handful of entities Steam's page actually uses.
fn unescape(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

/// One achievement the player actually has, with the moment it happened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unlock {
    /// Steam's own API name, which is what the community page calls `id`.
    pub id: String,
    /// Seconds since the epoch. Zero when Steam did not say.
    pub at: u64,
}

/// The part of `GetPlayerAchievements` that Orbit reads, and no more.
///
/// Everything is defaulted because a refused request comes back as a 200 with
/// `success: false` and none of the rest, and that shape has to parse rather
/// than fail before its message can be read.
#[derive(Debug, Deserialize)]
struct PlayerStats {
    playerstats: PlayerStatsBody,
}

#[derive(Debug, Deserialize)]
struct PlayerStatsBody {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    achievements: Vec<ApiAchievement>,
}

#[derive(Debug, Deserialize)]
struct ApiAchievement {
    #[serde(default)]
    apiname: String,
    /// A flag, not a bool: Steam sends `1` and `0`.
    #[serde(default)]
    achieved: u8,
    #[serde(default)]
    unlocktime: u64,
}

/// The part of `ResolveVanityURL` that Orbit reads.
#[derive(Debug, Deserialize)]
struct Vanity {
    response: VanityBody,
}

#[derive(Debug, Deserialize)]
struct VanityBody {
    #[serde(default)]
    success: u8,
    #[serde(default)]
    steamid: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

/// What this player has unlocked in this game, straight from Steam.
///
/// This is the only source that knows a real answer instead of a guess, which
/// is why it needs a key: the record belongs to the account, and Steam will
/// only read it out to something the account vouched for. A private profile
/// answers `success: false`, and so does a key that belongs to somebody else,
/// so the message is passed up rather than swallowed.
pub async fn unlocks(app_id: u64, steam_id: &str, api_key: &str) -> Result<Vec<Unlock>, String> {
    let client = crate::metadata::client()?;
    let app = app_id.to_string();
    let response = client
        .get("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/")
        .query(&[
            ("key", api_key),
            ("steamid", steam_id),
            ("appid", &app),
            ("format", "json"),
            ("l", "english"),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach the Steam API: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Steam turned that key down. Check it in Settings.".to_string());
    }
    if !status.is_success() {
        return Err(format!("Steam answered {status}."));
    }

    let body: PlayerStats = response
        .json()
        .await
        .map_err(|_| "Steam's answer was not the shape its API promises.".to_string())?;
    if !body.playerstats.success {
        // The usual reason is a private profile, which says so in its own words.
        return Err(body
            .playerstats
            .error
            .unwrap_or_else(|| "Steam would not read this profile out.".to_string()));
    }

    Ok(body
        .playerstats
        .achievements
        .into_iter()
        .filter(|row| row.achieved != 0 && !row.apiname.is_empty())
        .map(|row| Unlock {
            id: row.apiname,
            at: row.unlocktime,
        })
        .collect())
}

/// Turn whatever the player typed into the 17-digit id Steam's API wants.
///
/// The id is accepted as it is, because that is the cheapest thing to get
/// right, but most people have a profile URL instead and no idea which number
/// is theirs. Both forms are taken; only a custom name needs asking Steam, and
/// that is the one call this makes.
pub async fn resolve_steam_id(who: &str, api_key: &str) -> Result<String, String> {
    if let Some(id) = steam_id_of(who) {
        return Ok(id);
    }
    let Some(name) = vanity_name(who) else {
        return Err("That does not look like a Steam id or a Steam profile link.".to_string());
    };

    let client = crate::metadata::client()?;
    let response = client
        .get("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/")
        .query(&[("key", api_key), ("vanityurl", name.as_str())])
        .send()
        .await
        .map_err(|e| format!("Could not reach the Steam API: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Steam turned that key down. Check it in Settings.".to_string());
    }

    let body: Vanity = response
        .json()
        .await
        .map_err(|_| "Steam's answer was not the shape its API promises.".to_string())?;
    if body.response.success != 1 {
        return Err(body.response.message.unwrap_or_else(|| {
            "Steam has no account under that name. The profile link works too.".to_string()
        }));
    }
    body.response
        .steamid
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "Steam recognised the name but gave no id back.".to_string())
}

/// A SteamID64 in the text, when there is one.
///
/// Every personal account's id is 17 digits and begins `7656119`, so the prefix
/// is what tells a real id apart from a custom name that happens to be digits.
/// It is read out of a URL as well as out of bare text, which saves a round
/// trip for the common case of somebody pasting their whole profile link.
fn steam_id_of(who: &str) -> Option<String> {
    let cleaned = who.trim().trim_end_matches('/');
    let candidates = [
        Some(cleaned),
        after_segment(cleaned, "profiles")
            .or_else(|| after_segment(cleaned, "id"))
            // Only up to the next slash, so a link that goes on to another page
            // ("/profiles/<id>/edit") still gives up its id.
            .map(|tail| tail.split('/').next().unwrap_or_default()),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.len() == 17
            && candidate.starts_with("7656119")
            && candidate.bytes().all(|b| b.is_ascii_digit())
        {
            return Some(candidate.to_string());
        }
    }
    None
}

/// The custom name in a profile link, when the link carries one.
///
/// `/id/<name>` is the custom form and `/profiles/<id>` the numeric one; a bare
/// word is taken as a name, because that is what somebody who types one means.
fn vanity_name(who: &str) -> Option<String> {
    let cleaned = who.trim().trim_end_matches('/');
    if cleaned.contains("://") || cleaned.contains("steamcommunity.com") {
        // A link only counts if it actually names somebody; the bare domain is
        // not a name just because it is not empty.
        let tail = after_segment(cleaned, "id").or_else(|| after_segment(cleaned, "profiles"))?;
        let name = tail.split('/').next().unwrap_or_default();
        return (!name.is_empty()).then(|| name.to_string());
    }
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

/// The text after the last `/<segment>/` in a path, if there is one.
fn after_segment(path: &str, segment: &str) -> Option<&str> {
    let needle = format!("/{segment}/");
    path.rfind(&needle).map(|at| &path[at + needle.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A page cut down to the shape of the real one: two achievements with the
    /// icon, name, description and share of players each.
    const PAGE: &str = r#"
    <div class="achieveRow">
      <div class="achieveImgHolder">
        <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/620/WAKE_UP.jpg">
      </div>
      <div class="achieveTxt">
        <h3>Wake Up Call</h3>
        <h5>Survive the manual override &amp; escape</h5>
      </div>
      <div class="achievePercent">74.1%</div>
    </div>
    <div class="achieveRow">
      <div class="achieveImgHolder">
        <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/620/YOU_MONSTER.jpg">
      </div>
      <div class="achieveTxt">
        <h3>You Monster</h3>
        <h5>Reunite with GLaDOS</h5>
      </div>
      <div class="achievePercent">64.7%</div>
    </div>
    "#;

    #[test]
    fn both_achievements_come_out_with_their_numbers() {
        let rows = parse(PAGE, 620);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "WAKE_UP");
        assert_eq!(rows[0].name, "Wake Up Call");
        assert_eq!(rows[0].description, "Survive the manual override & escape");
        assert_eq!(rows[0].percent, 74.1);
        assert!(rows[0].icon.ends_with("WAKE_UP.jpg"));
        assert!(!rows[0].unlocked);
        assert_eq!(rows[1].id, "YOU_MONSTER");
        assert_eq!(rows[1].percent, 64.7);
    }

    #[test]
    fn achievements_for_another_app_are_not_mistaken_for_these() {
        // The marker carries the app id, so a page that also shows art for
        // another game cannot leak rows into this one.
        let other = PAGE.replace("apps/620/", "apps/730/");
        assert!(parse(&other, 620).is_empty());
    }

    #[test]
    fn a_percentage_is_read_without_its_neighbours() {
        assert_eq!(first_percent("<span>12.5%</span>"), 12.5);
        assert_eq!(first_percent("no numbers here"), 0.0);
        assert_eq!(first_percent("12 not a percent"), 0.0);
    }

    #[test]
    fn a_page_with_no_rows_is_empty_rather_than_a_panic() {
        assert!(parse("", 620).is_empty());
        assert!(parse("<html><body>Sign in</body></html>", 620).is_empty());
    }

    #[test]
    fn an_id_is_read_whether_it_is_typed_or_pasted_as_a_link() {
        assert_eq!(
            steam_id_of("76561198012345678"),
            Some("76561198012345678".to_string())
        );
        assert_eq!(
            steam_id_of("  76561198012345678  "),
            Some("76561198012345678".to_string())
        );
        assert_eq!(
            steam_id_of("https://steamcommunity.com/profiles/76561198012345678"),
            Some("76561198012345678".to_string())
        );
        assert_eq!(
            steam_id_of("https://steamcommunity.com/profiles/76561198012345678/"),
            Some("76561198012345678".to_string())
        );
        assert_eq!(
            steam_id_of("https://steamcommunity.com/profiles/76561198012345678/edit"),
            Some("76561198012345678".to_string()),
            "a trailing page must not hide the id"
        );
    }

    #[test]
    fn a_custom_name_is_never_mistaken_for_an_id() {
        // Right length is not enough: Steam ids all begin 7656119.
        assert_eq!(steam_id_of("12345678901234567"), None);
        assert_eq!(steam_id_of("gabelogannewell"), None);
        assert_eq!(steam_id_of(""), None);
        assert_eq!(
            steam_id_of("https://steamcommunity.com/id/gabelogannewell"),
            None
        );
    }

    #[test]
    fn a_custom_name_is_found_in_a_link_or_on_its_own() {
        assert_eq!(
            vanity_name("https://steamcommunity.com/id/gabelogannewell"),
            Some("gabelogannewell".to_string())
        );
        assert_eq!(
            vanity_name("https://steamcommunity.com/id/gabelogannewell/"),
            Some("gabelogannewell".to_string())
        );
        assert_eq!(vanity_name("gabelogannewell"), Some("gabelogannewell".to_string()));
        assert_eq!(vanity_name("   "), None);
        assert_eq!(vanity_name("https://steamcommunity.com/"), None);
    }
}
