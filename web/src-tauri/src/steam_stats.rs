//! What the Steam client already knows about a game's achievements.
//!
//! Steam keeps two files per game under `appcache/stats`, and between them they
//! hold the whole list without a key, a login or a network:
//!
//! * `UserGameStatsSchema_<app>.bin` — the definitions. Every achievement the
//!   game has, with its API name, its title, its description and its icons. It
//!   belongs to the game, not to the player, which is why it needs no account.
//! * `UserGameStats_<account>_<app>.bin` — the player's own record, as the
//!   moment each one was unlocked.
//!
//! That makes this the best source Orbit has: it is offline, it works with a
//! private profile, and it is the same data the Steam client shows. The
//! community page is read when there is no schema here, and the Web API only
//! when there is a key.
//!
//! Both files are Valve's binary KeyValues, the format `KeyValues::ReadAsBinary`
//! writes: a run of `[type][key]\0[payload]` records, where type 0 opens a
//! subtree that is closed by a bare type 8. Every scalar is read as text here,
//! because the only thing done with any of them afterwards is compare it or
//! parse it as a number, and one representation keeps that simple.
//!
//! One thing worth knowing: the player's file lists only the achievements that
//! have a recorded time, and it can carry leftovers from a game that this one
//! replaced — Counter-Strike 2's file still holds Counter-Strike: Global
//! Offensive's bits. So the list is always built from the schema and the times
//! are looked up in it, never the other way round. Reading the player's file as
//! the list would make every game look finished.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One value in a binary KeyValues tree.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Object(Vec<(String, Value)>),
    Text(String),
}

impl Value {
    /// The child under `key`, if there is one.
    fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            Value::Text(_) => None,
        }
    }

    /// The children, in the order the file held them.
    fn entries(&self) -> &[(String, Value)] {
        match self {
            Value::Object(entries) => entries,
            Value::Text(_) => &[],
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Value::Text(value) => Some(value),
            Value::Object(_) => None,
        }
    }
}

/// Read a whole binary KeyValues file.
///
/// A file that stops half way through still gives back what was read, because
/// Steam is writing these while it runs and a partial read is worth more than
/// nothing.
pub fn parse(data: &[u8]) -> Value {
    let mut at = 0;
    Value::Object(read_object(data, &mut at))
}

fn read_cstring(data: &[u8], at: &mut usize) -> Option<String> {
    let start = *at;
    while *at < data.len() && data[*at] != 0 {
        *at += 1;
    }
    if *at >= data.len() {
        return None;
    }
    let text = String::from_utf8_lossy(&data[start..*at]).into_owned();
    *at += 1;
    Some(text)
}

fn read_object(data: &[u8], at: &mut usize) -> Vec<(String, Value)> {
    let mut entries: Vec<(String, Value)> = Vec::new();
    loop {
        // Running off the end closes the object rather than failing the parse.
        let Some(&tag) = data.get(*at) else {
            return entries;
        };
        *at += 1;
        if tag == 8 {
            return entries;
        }
        let Some(key) = read_cstring(data, at) else {
            return entries;
        };
        let value = match tag {
            0 => Value::Object(read_object(data, at)),
            1 => match read_cstring(data, at) {
                Some(text) => Value::Text(text),
                None => return entries,
            },
            2 => match scalar::<4>(data, at) {
                Some(bytes) => Value::Text(i32::from_le_bytes(bytes).to_string()),
                None => return entries,
            },
            3 => match scalar::<4>(data, at) {
                Some(bytes) => Value::Text(f32::from_le_bytes(bytes).to_string()),
                None => return entries,
            },
            4 | 6 => match scalar::<4>(data, at) {
                Some(bytes) => Value::Text(u32::from_le_bytes(bytes).to_string()),
                None => return entries,
            },
            7 => match scalar::<8>(data, at) {
                Some(bytes) => Value::Text(u64::from_le_bytes(bytes).to_string()),
                None => return entries,
            },
            // Type 5 is UTF-16. Rare in these files, but a tag that is not
            // handled would end the whole object early and lose everything
            // after it, so it is worth the few lines.
            5 => {
                let mut out = String::new();
                let mut done = false;
                while *at + 1 < data.len() {
                    let unit = u16::from_le_bytes([data[*at], data[*at + 1]]);
                    *at += 2;
                    if unit == 0 {
                        done = true;
                        break;
                    }
                    out.push(char::from_u32(u32::from(unit)).unwrap_or('?'));
                }
                if !done {
                    return entries;
                }
                Value::Text(out)
            }
            // An unknown tag means the offsets no longer mean anything, so
            // what has been read so far is all there is.
            _ => return entries,
        };
        entries.push((key, value));
    }
}

/// The next `N` bytes, as an array, if they are there.
fn scalar<const N: usize>(data: &[u8], at: &mut usize) -> Option<[u8; N]> {
    let bytes: [u8; N] = data.get(*at..*at + N)?.try_into().ok()?;
    *at += N;
    Some(bytes)
}

/// One achievement as the client's own schema describes it.
#[derive(Debug, Clone, PartialEq)]
pub struct Local {
    /// Steam's API name, which is the identity the community page uses too.
    pub id: String,
    pub name: String,
    pub description: String,
    /// The icon file name, not a URL yet.
    pub icon: String,
    /// Seconds since the epoch, or 0 when it is still locked.
    pub unlocked_at: u64,
}

/// What one Steam install had to say about one game.
pub struct Found {
    pub rows: Vec<Local>,
    /// Whether the client said who is signed in.
    ///
    /// Without that there is no unlock state to read at all, and reporting
    /// everything as locked would be a lie told with confidence. The caller
    /// falls back to another source instead.
    pub knows_account: bool,
}

/// `appcache/stats`, where both files live.
fn stats_dir(steam: &Path) -> PathBuf {
    steam.join("appcache").join("stats")
}

/// Read a game's achievements out of the first Steam install that has them.
///
/// `extra` is where the player says Steam is, looked at before anywhere else,
/// exactly as the library scan does it.
pub fn read_any(app_id: u64, extra: &[String]) -> Option<Found> {
    for root in crate::steam::steam_roots(extra) {
        if let Some(found) = read(&root, app_id) {
            return Some(found);
        }
    }
    None
}

/// Read one game's achievements out of one Steam install, if it has a schema.
pub fn read(steam: &Path, app_id: u64) -> Option<Found> {
    let schema = std::fs::read(stats_dir(steam).join(format!("UserGameStatsSchema_{app_id}.bin"))).ok()?;
    let schema = parse(&schema);
    let stats = schema.get(&app_id.to_string())?.get("stats")?;

    let account = account_id(steam);
    let times = match account {
        Some(account) => unlock_times(steam, account, app_id),
        None => HashMap::new(),
    };

    // The groups and the bits inside them are numbered, and the file does not
    // promise they are in order, so they are put in order before anything is
    // made of them.
    let mut groups: Vec<&(String, Value)> = stats.entries().iter().collect();
    groups.sort_by_key(|(id, _)| id.parse::<u32>().unwrap_or(u32::MAX));

    let mut rows: Vec<Local> = Vec::new();
    for (group_id, group) in groups {
        let Some(bits) = group.get("bits") else {
            continue;
        };
        let mut bits: Vec<&(String, Value)> = bits.entries().iter().collect();
        bits.sort_by_key(|(id, _)| id.parse::<u32>().unwrap_or(u32::MAX));
        for (bit_id, bit) in bits {
            let Some(id) = bit.get("name").and_then(Value::text) else {
                continue;
            };
            if id.is_empty() {
                continue;
            }
            let display = bit.get("display");
            let localised = |field: &str| {
                display
                    .and_then(|d| d.get(field))
                    .and_then(|n| n.get("english"))
                    .and_then(Value::text)
                    .unwrap_or_default()
                    .to_string()
            };
            // An achievement with no title of its own is still an achievement,
            // and its API name is the only thing there is to call it.
            let title = localised("name");
            let name = if title.is_empty() { id.to_string() } else { title };
            rows.push(Local {
                name,
                id: id.to_string(),
                description: localised("desc"),
                icon: display
                    .and_then(|d| d.get("icon"))
                    .and_then(Value::text)
                    .unwrap_or_default()
                    .to_string(),
                unlocked_at: times
                    .get(&format!("{group_id}:{bit_id}"))
                    .copied()
                    .unwrap_or(0),
            });
        }
    }

    (!rows.is_empty()).then_some(Found {
        rows,
        knows_account: account.is_some(),
    })
}

/// The moment each achievement was unlocked, keyed `group:bit`.
fn unlock_times(steam: &Path, account: u64, app_id: u64) -> HashMap<String, u64> {
    let mut times = HashMap::new();
    let path = stats_dir(steam).join(format!("UserGameStats_{account}_{app_id}.bin"));
    let Ok(bytes) = std::fs::read(path) else {
        return times;
    };
    let user = parse(&bytes);
    for (group_id, group) in user.get("cache").map(|v| v.entries()).unwrap_or(&[]) {
        for (bit_id, at) in group.get("AchievementTimes").map(|v| v.entries()).unwrap_or(&[]) {
            let seconds = at.text().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            if seconds > 0 {
                times.insert(format!("{group_id}:{bit_id}"), seconds);
            }
        }
    }
    times
}

/// The account number Steam puts in its stats file names.
///
/// `config/loginusers.vdf` says who has signed in here and which of them the
/// client used last. The file names want the 32-bit account number, which is
/// the 64-bit id with Steam's constant prefix taken off.
pub fn account_id(steam: &Path) -> Option<u64> {
    account_id_of(&signed_in(steam)?)
}

/// The 64-bit id of whoever the client used last, as a string.
///
/// This is the same answer the Web API wants, read out of the same file, which
/// is why nobody has to type their id into Settings.
pub fn signed_in(steam: &Path) -> Option<String> {
    let text = std::fs::read_to_string(steam.join("config").join("loginusers.vdf")).ok()?;
    let users = login_users(&text);
    users
        .iter()
        .find(|(_, recent)| *recent)
        .or_else(|| users.first())
        .map(|(id, _)| id.clone())
}

/// The signed-in player across every Steam install that can be found.
pub fn active_id64(extra: &[String]) -> Option<String> {
    for root in crate::steam::steam_roots(extra) {
        if let Some(id) = signed_in(&root) {
            return Some(id);
        }
    }
    None
}

/// The 64-bit id every personal account starts with.
const ID64_BASE: u64 = 76_561_197_960_265_728;

fn account_id_of(id64: &str) -> Option<u64> {
    id64.parse::<u64>().ok()?.checked_sub(ID64_BASE)
}

/// Every signed-in account in `loginusers.vdf`, with whether the client called
/// it the most recent one.
fn login_users(text: &str) -> Vec<(String, bool)> {
    let tokens = quoted(text);
    let mut out = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        if !is_steam_id64(token) {
            continue;
        }
        // Everything up to the next id belongs to this account.
        let end = tokens[index + 1..]
            .iter()
            .position(|next| is_steam_id64(next))
            .map(|at| index + 1 + at)
            .unwrap_or(tokens.len());
        let block = &tokens[index + 1..end];
        let recent = block
            .iter()
            .position(|name| name == "MostRecent")
            .and_then(|at| block.get(at + 1))
            .map(|value| value == "1")
            .unwrap_or(false);
        out.push((token.clone(), recent));
    }
    out
}

fn is_steam_id64(token: &str) -> bool {
    token.len() == 17 && token.starts_with("7656119") && token.bytes().all(|b| b.is_ascii_digit())
}

/// Every quoted string in a text VDF file, in order.
fn quoted(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut at = 0;
    while at < chars.len() {
        if chars[at] == '/' && chars.get(at + 1) == Some(&'/') {
            while at < chars.len() && chars[at] != '\n' {
                at += 1;
            }
            continue;
        }
        if chars[at] != '"' {
            at += 1;
            continue;
        }
        at += 1;
        let mut word = String::new();
        while at < chars.len() && chars[at] != '"' {
            if chars[at] == '\\' && at + 1 < chars.len() {
                word.push(chars[at + 1]);
                at += 2;
            } else {
                word.push(chars[at]);
                at += 1;
            }
        }
        at += 1;
        out.push(word);
    }
    out
}

/// The community's share of players for each achievement, keyed by API name.
///
/// Public, and needs no key: the local schema says what the achievements are
/// but not how rare they are, and rarity is the interesting half. A failure
/// leaves the numbers unset rather than failing the read, because being offline
/// is the normal case for this whole path.
pub async fn global_percentages(app_id: u64) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    let Ok(client) = crate::metadata::client() else {
        return out;
    };
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={app_id}"
    );
    let Ok(response) = client.get(&url).send().await else {
        return out;
    };
    let Ok(payload) = response.json::<serde_json::Value>().await else {
        return out;
    };
    let Some(items) = payload
        .get("achievementpercentages")
        .and_then(|p| p.get("achievements"))
        .and_then(|a| a.as_array())
    else {
        return out;
    };
    for entry in items {
        let Some(name) = entry.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        // Valve sends the rate as a number or as a string, depending on the app.
        if let Some(percent) = entry
            .get("percent")
            .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        {
            out.insert(name.to_string(), percent);
        }
    }
    out
}

/// An icon file name from the schema, as the URL the community CDN serves it at.
pub fn icon_url(app_id: u64, file: &str) -> String {
    if file.is_empty() {
        String::new()
    } else {
        format!("https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{app_id}/{file}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One `[tag][key]\0[payload]` record, as `KeyValues::ReadAsBinary` writes it.
    fn rec(tag: u8, key: &str, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![tag];
        out.extend_from_slice(key.as_bytes());
        out.push(0);
        out.extend_from_slice(payload);
        out
    }

    fn text(key: &str, value: &str) -> Vec<u8> {
        let mut payload = value.as_bytes().to_vec();
        payload.push(0);
        rec(1, key, &payload)
    }

    fn u32_rec(key: &str, value: u32) -> Vec<u8> {
        rec(4, key, &value.to_le_bytes())
    }

    /// A subtree: the records, then the bare 8 that closes it.
    fn obj(key: &str, body: &[u8]) -> Vec<u8> {
        let mut payload = body.to_vec();
        payload.push(8);
        rec(0, key, &payload)
    }

    fn close(mut bytes: Vec<u8>) -> Vec<u8> {
        bytes.push(8);
        bytes
    }

    fn one(bit: &str, api: &str, title: &str, description: &str, icon: &str) -> Vec<u8> {
        let display = obj("name", &text("english", title))
            .into_iter()
            .chain(obj("desc", &text("english", description)))
            .chain(text("icon", icon))
            .collect::<Vec<u8>>();
        obj(bit, &text("name", api).into_iter().chain(obj("display", &display)).collect::<Vec<u8>>())
    }

    /// A schema for app 620 with two achievements, the shape the client writes.
    fn schema() -> Vec<u8> {
        let bits = one("0", "WAKE_UP", "Wake Up Call", "Survive the override", "wake.jpg")
            .into_iter()
            .chain(one("1", "YOU_MONSTER", "You Monster", "Reunite with GLaDOS", "monster.jpg"))
            .collect::<Vec<u8>>();
        close(obj("620", &obj("stats", &obj("1", &obj("bits", &bits)))))
    }

    #[test]
    fn the_schema_gives_the_list_in_order() {
        let found = parse(&schema());
        let stats = found.get("620").and_then(|v| v.get("stats")).expect("stats");
        let bits = stats.get("1").and_then(|v| v.get("bits")).expect("bits");
        let names: Vec<&str> = bits
            .entries()
            .iter()
            .filter_map(|(_, v)| v.get("name").and_then(Value::text))
            .collect();
        assert_eq!(names, ["WAKE_UP", "YOU_MONSTER"]);
        let display = bits
            .get("0")
            .and_then(|v| v.get("display"))
            .expect("display");
        assert_eq!(
            display.get("name").and_then(|n| n.get("english")).and_then(Value::text),
            Some("Wake Up Call")
        );
        assert_eq!(
            display.get("icon").and_then(Value::text),
            Some("wake.jpg")
        );
    }

    #[test]
    fn unlock_times_are_read_by_group_and_bit() {
        let cache = obj("AchievementTimes", &u32_rec("0", 1_700_000_000));
        let file = close(obj("cache", &obj("1", &cache)));
        let user = parse(&file);
        let at = user
            .get("cache")
            .and_then(|c| c.get("1"))
            .and_then(|g| g.get("AchievementTimes"))
            .and_then(|t| t.get("0"))
            .and_then(Value::text);
        assert_eq!(at, Some("1700000000"));
    }

    #[test]
    fn every_scalar_type_reads_as_text() {
        let body = text("a", "word")
            .into_iter()
            .chain(rec(2, "b", &(-5i32).to_le_bytes()))
            .chain(rec(4, "c", &7u32.to_le_bytes()))
            .chain(rec(7, "d", &9u64.to_le_bytes()))
            .collect::<Vec<u8>>();
        let tree = parse(&close(body));
        assert_eq!(tree.get("a").and_then(Value::text), Some("word"));
        assert_eq!(tree.get("b").and_then(Value::text), Some("-5"));
        assert_eq!(tree.get("c").and_then(Value::text), Some("7"));
        assert_eq!(tree.get("d").and_then(Value::text), Some("9"));
    }

    #[test]
    fn a_file_cut_short_keeps_what_was_read() {
        // Steam writes these while it runs, so a partial read is normal.
        let whole = schema();
        let found = parse(&whole[..whole.len() - 40]);
        assert!(found.get("620").is_some(), "the start survives a short read");
        assert!(parse(&[]).entries().is_empty());
    }

    #[test]
    fn an_unknown_tag_stops_the_object_rather_than_running_on() {
        let body = text("a", "word").into_iter().chain(vec![99, b'x', 0]).collect::<Vec<u8>>();
        let tree = parse(&body);
        assert_eq!(tree.get("a").and_then(Value::text), Some("word"));
        assert_eq!(tree.entries().len(), 1, "nothing is invented after the bad tag");
    }

    #[test]
    fn the_most_recent_account_wins() {
        let text = r#"
        "users"
        {
            "76561198000000000"
            {
                "AccountName"   "older"
                "PersonaName"   "Older"
                "MostRecent"    "0"
            }
            "76561199140017878"
            {
                "AccountName"   "newer"
                "PersonaName"   "Newer"
                "MostRecent"    "1"
            }
        }
        "#;
        let users = login_users(text);
        assert_eq!(users.len(), 2);
        assert_eq!(users[0], ("76561198000000000".to_string(), false));
        assert_eq!(users[1], ("76561199140017878".to_string(), true));
        let chosen = users
            .iter()
            .find(|(_, recent)| *recent)
            .or_else(|| users.first())
            .map(|(id, _)| id.as_str());
        assert_eq!(chosen, Some("76561199140017878"));
    }

    #[test]
    fn the_signed_in_id_is_the_most_recent_one_as_written() {
        let dir = temp("loginusers");
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::write(
            dir.join("config").join("loginusers.vdf"),
            r#""users"
            {
                "76561198000000000"
                {
                    "PersonaName"   "Older"
                    "MostRecent"    "0"
                }
                "76561199140017878"
                {
                    "PersonaName"   "Newer"
                    "MostRecent"    "1"
                }
            }"#,
        )
        .unwrap();
        assert_eq!(signed_in(&dir).as_deref(), Some("76561199140017878"));
        assert_eq!(account_id(&dir), Some(1_179_752_150));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_install_with_no_one_signed_in_says_so() {
        let dir = temp("nologin");
        assert_eq!(signed_in(&dir), None);
        assert_eq!(account_id(&dir), None);
    }

    #[test]
    fn the_account_number_is_the_id_without_steam_prefix() {
        // The number in the file name is the 64-bit id minus a fixed constant.
        assert_eq!(account_id_of("76561197960265728"), Some(0));
        assert_eq!(account_id_of("76561197960265729"), Some(1));
        assert_eq!(account_id_of("76561199140017878"), Some(1_179_752_150));
        // A number below the base cannot be a personal account.
        assert_eq!(account_id_of("12345"), None);
        assert_eq!(account_id_of("not a number"), None);
    }

    #[test]
    fn comments_and_escapes_do_not_leak_into_the_tokens() {
        let text = "\"users\" // the accounts\n{\n\t\"76561198000000000\"\n\t{\n\t\t\"PersonaName\"\t\t\"a \\\"quoted\\\" name\"\n\t}\n}\n";
        let tokens = quoted(text);
        assert_eq!(
            tokens,
            ["users", "76561198000000000", "PersonaName", "a \"quoted\" name"]
        );
    }

    #[test]
    fn a_global_percentages_answer_is_read_either_way_round() {
        let payload: serde_json::Value = serde_json::from_str(
            r#"{"achievementpercentages":{"achievements":[
                {"name":"WAKE_UP","percent":74.1},
                {"name":"YOU_MONSTER","percent":"64.7"}
            ]}}"#,
        )
        .expect("valid json");
        let items = payload
            .get("achievementpercentages")
            .and_then(|p| p.get("achievements"))
            .and_then(|a| a.as_array())
            .expect("items");
        let mut out = HashMap::new();
        for entry in items {
            if let (Some(name), Some(percent)) = (
                entry.get("name").and_then(|v| v.as_str()),
                entry
                    .get("percent")
                    .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))),
            ) {
                out.insert(name.to_string(), percent);
            }
        }
        assert_eq!(out["WAKE_UP"], 74.1);
        assert_eq!(out["YOU_MONSTER"], 64.7);
    }

    #[test]
    fn an_icon_with_no_file_has_no_url() {
        assert_eq!(icon_url(620, ""), "");
        assert_eq!(
            icon_url(620, "wake.jpg"),
            "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/620/wake.jpg"
        );
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("orbit-stats-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        path
    }
}
