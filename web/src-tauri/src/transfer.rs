//! A copy of Orbit the player can keep.
//!
//! Settings always go in the file. Journal and sessions go in only when asked,
//! and they come back only when asked. The library of games is not in the file:
//! a row is matched to a game already here, by id and then by title, and a row
//! for a game that is not here is left out.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};

use crate::db::{self, Db};

const KIND: &str = "orbit-copy";
const VERSION: i64 = 1;
const MAX_COPY_BYTES: u64 = 20 * 1024 * 1024;
const MAX_MUSIC_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPreview {
    pub version: i64,
    pub exported_at: String,
    pub has_settings: bool,
    pub playthroughs: i64,
    pub logs: i64,
    pub sessions: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
    pub playthroughs: i64,
    pub logs: i64,
    pub sessions: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdate {
    pub game_id: String,
    pub notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub settings_applied: bool,
    pub settings: Option<Value>,
    pub playthroughs_added: i64,
    pub logs_added: i64,
    pub sessions_added: i64,
    pub notes_filled: i64,
    pub skipped: i64,
    pub unmatched: Vec<String>,
    pub unmatched_count: i64,
    /// Current-playthrough notes that changed, so the open editor can catch up.
    pub notes_updated: Vec<NoteUpdate>,
}

pub fn preview(path: &str) -> Result<CopyPreview, String> {
    let value = read_copy(path)?;
    Ok(summarise(&value))
}

pub fn export_file(db: &Db, path: &str, settings: Value, journal: bool, sessions: bool) -> Result<ExportInfo, String> {
    let settings = if settings.is_object() { settings } else { json!({}) };
    let mut body = json!({
        "kind": KIND,
        "version": VERSION,
        "exportedAt": db::iso8601(db::now()),
        "settings": settings,
    });
    let mut info = ExportInfo { playthroughs: 0, logs: 0, sessions: 0 };
    if journal {
        let (playthroughs, logs) = export_journal(db)?;
        info.playthroughs = playthroughs.len() as i64;
        info.logs = logs.len() as i64;
        body["journal"] = json!({ "playthroughs": playthroughs, "logs": logs });
    }
    if sessions {
        let rows = export_sessions(db)?;
        info.sessions = rows.len() as i64;
        body["sessions"] = Value::Array(rows);
    }
    write_copy(path, &body)?;
    Ok(info)
}

pub fn import_file(db: &Db, path: &str, journal: bool, sessions: bool) -> Result<CopyResult, String> {
    let value = read_copy(path)?;
    let mut result = CopyResult {
        settings_applied: false,
        settings: value.get("settings").cloned().filter(|v| v.is_object()),
        playthroughs_added: 0,
        logs_added: 0,
        sessions_added: 0,
        notes_filled: 0,
        skipped: 0,
        unmatched: Vec::new(),
        unmatched_count: 0,
        notes_updated: Vec::new(),
    };
    let mut unmatched = BTreeSet::new();
    if journal {
        import_journal(db, value.get("journal"), &mut result, &mut unmatched)?;
    }
    if sessions {
        import_sessions(db, value.get("sessions"), &mut result, &mut unmatched)?;
    }
    result.unmatched_count = unmatched.len() as i64;
    result.unmatched = unmatched.into_iter().take(12).collect();
    Ok(result)
}

/// Keep a picked music file inside Orbit's own folder, so moving the original
/// does not silence the app.
pub fn remember_music(root: &Path, source: &str) -> Result<String, String> {
    let src = Path::new(source.trim());
    if !src.is_file() {
        return Err("That music file is not there.".into());
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    const OK: &[&str] = &["mp3", "ogg", "oga", "wav", "flac", "m4a", "aac", "opus"];
    if !OK.contains(&ext.as_str()) {
        return Err("Choose an audio file, such as ogg, wav, flac, or mp3.".into());
    }
    let len = fs::metadata(src).map_err(|e| format!("Could not read that file: {e}"))?.len();
    if len > MAX_MUSIC_BYTES {
        return Err("That file is too large. Choose a music file under 512 MB.".into());
    }
    let dir = root.join("music");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not keep that music: {e}"))?;
    let raw_name = src.file_name().and_then(|n| n.to_str()).unwrap_or("music");
    let safe = sanitize_name(raw_name);
    let dest = dir.join(safe);
    if same_file(src, &dest) {
        return Ok(dest.to_string_lossy().into_owned());
    }
    fs::copy(src, &dest).map_err(|e| format!("Could not keep that music: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

fn summarise(value: &Value) -> CopyPreview {
    let journal = value.get("journal");
    let playthroughs = journal
        .and_then(|j| j.get("playthroughs"))
        .and_then(|v| v.as_array())
        .map(|v| v.len() as i64)
        .unwrap_or(0);
    let logs = journal
        .and_then(|j| j.get("logs"))
        .and_then(|v| v.as_array())
        .map(|v| v.len() as i64)
        .unwrap_or(0);
    let sessions = value
        .get("sessions")
        .and_then(|v| v.as_array())
        .map(|v| v.len() as i64)
        .unwrap_or(0);
    CopyPreview {
        version: value.get("version").and_then(|v| v.as_i64()).unwrap_or(VERSION),
        exported_at: value.get("exportedAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        has_settings: value.get("settings").is_some_and(|v| v.is_object()),
        playthroughs,
        logs,
        sessions,
    }
}

fn read_copy(path: &str) -> Result<Value, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Choose an Orbit copy.".into());
    }
    let meta = fs::metadata(path).map_err(|_| "That file is not there.".to_string())?;
    if !meta.is_file() {
        return Err("That is not a file.".into());
    }
    if meta.len() > MAX_COPY_BYTES {
        return Err("That file is too large to be an Orbit copy.".into());
    }
    let text = fs::read_to_string(path).map_err(|e| format!("Could not read that file: {e}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|_| "That file is not an Orbit copy.".to_string())?;
    match value.get("kind").and_then(|v| v.as_str()) {
        Some(KIND) => Ok(value),
        _ => Err("That file is not an Orbit copy.".into()),
    }
}

fn write_copy(path: &str, body: &Value) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Choose where to save the copy.".into());
    }
    let dest = Path::new(path);
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not save that copy: {e}"))?;
        }
    }
    let mut text = serde_json::to_string_pretty(body).map_err(|e| format!("Could not save that copy: {e}"))?;
    text.push('\n');
    fs::write(dest, text).map_err(|e| format!("Could not save that copy: {e}"))
}

fn export_journal(db: &Db) -> Result<(Vec<Value>, Vec<Value>), String> {
    let conn = db.lock()?;
    let playthroughs = {
        let mut stmt = conn
            .prepare(
                "SELECT p.game_id, COALESCE(g.title, ''), p.name, p.notes, p.current
                   FROM playthroughs p
                   LEFT JOIN games g ON g.id = p.game_id
                  ORDER BY g.title COLLATE NOCASE, p.position, p.name COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "gameId": r.get::<_, String>(0)?,
                    "gameTitle": r.get::<_, String>(1)?,
                    "name": r.get::<_, String>(2)?,
                    "notes": r.get::<_, String>(3)?,
                    "current": r.get::<_, i64>(4)? != 0,
                }))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let logs = {
        let mut stmt = conn
            .prepare(
                "SELECT l.game_id, COALESCE(g.title, ''), COALESCE(p.name, ''),
                        l.at, l.secs, l.note, l.details
                   FROM game_logs l
                   LEFT JOIN games g ON g.id = l.game_id
                   LEFT JOIN playthroughs p ON p.id = l.playthrough_id
                  ORDER BY l.at, l.id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(json!({
                    "gameId": r.get::<_, String>(0)?,
                    "gameTitle": r.get::<_, String>(1)?,
                    "playthrough": r.get::<_, String>(2)?,
                    "at": r.get::<_, i64>(3)?,
                    "secs": r.get::<_, i64>(4)?,
                    "note": r.get::<_, String>(5)?,
                    "details": r.get::<_, String>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    Ok((playthroughs, logs))
}

fn export_sessions(db: &Db) -> Result<Vec<Value>, String> {
    let conn = db.lock()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.game_id, COALESCE(g.title, ''), COALESCE(p.name, ''),
                    s.started_at, s.duration_secs, s.category, s.note, s.manual
               FROM sessions s
               LEFT JOIN games g ON g.id = s.game_id
               LEFT JOIN playthroughs p ON p.id = s.playthrough_id
              WHERE s.ended_at IS NOT NULL
              ORDER BY s.started_at, s.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "gameId": r.get::<_, String>(0)?,
                "gameTitle": r.get::<_, String>(1)?,
                "playthrough": r.get::<_, String>(2)?,
                "startedAt": r.get::<_, i64>(3)?,
                "durationSecs": r.get::<_, i64>(4)?,
                "category": r.get::<_, String>(5)?,
                "note": r.get::<_, String>(6)?,
                "manual": r.get::<_, i64>(7)? != 0,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn import_journal(
    db: &Db,
    journal: Option<&Value>,
    result: &mut CopyResult,
    unmatched: &mut BTreeSet<String>,
) -> Result<(), String> {
    let Some(journal) = journal else {
        return Ok(());
    };
    let conn = db.lock()?;
    let games = load_games(&conn)?;
    let playthroughs = journal.get("playthroughs").and_then(|v| v.as_array());
    if let Some(rows) = playthroughs {
        for row in rows {
            let game_id = text(row, "gameId");
            let title = text(row, "gameTitle");
            let Some(local) = match_game(&games, &game_id, &title) else {
                remember_unmatched(unmatched, &title, &game_id);
                result.skipped += 1;
                continue;
            };
            let name = text(row, "name");
            let name = if name.trim().is_empty() { "Main".to_string() } else { name };
            let notes = text(row, "notes");
            match find_playthrough(&conn, &local, &name)? {
                Some((id, local_notes, current)) => {
                    if local_notes.trim().is_empty() && !notes.trim().is_empty() {
                        conn.execute(
                            "UPDATE playthroughs SET notes = ?1 WHERE id = ?2",
                            params![notes, id],
                        )
                        .map_err(|e| format!("Could not bring those notes in: {e}"))?;
                        result.notes_filled += 1;
                        if current {
                            conn.execute(
                                "UPDATE games SET notes = ?1 WHERE id = ?2",
                                params![notes, local],
                            )
                            .map_err(|e| format!("Could not bring those notes in: {e}"))?;
                            result.notes_updated.push(NoteUpdate { game_id: local, notes });
                        }
                    }
                }
                None => {
                    let id = fresh_id();
                    let position: i64 = conn
                        .query_row(
                            "SELECT COALESCE(MAX(position), -1) + 1 FROM playthroughs WHERE game_id = ?1",
                            params![local],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    let has_current: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM playthroughs WHERE game_id = ?1 AND current = 1",
                            params![local],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    let current = if has_current == 0 { 1 } else { 0 };
                    conn.execute(
                        "INSERT INTO playthroughs (id, game_id, name, notes, position, created_at, current)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![id, local, name, notes, position, db::now(), current],
                    )
                    .map_err(|e| format!("Could not bring that playthrough in: {e}"))?;
                    result.playthroughs_added += 1;
                    if current == 1 {
                        conn.execute("UPDATE games SET notes = ?1 WHERE id = ?2", params![notes, local])
                            .map_err(|e| e.to_string())?;
                        result.notes_updated.push(NoteUpdate { game_id: local, notes });
                    }
                }
            }
        }
    }
    let logs = journal.get("logs").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for row in logs {
        let game_id = text(&row, "gameId");
        let title = text(&row, "gameTitle");
        let Some(local) = match_game(&games, &game_id, &title) else {
            remember_unmatched(unmatched, &title, &game_id);
            result.skipped += 1;
            continue;
        };
        let name = {
            let raw = text(&row, "playthrough");
            if raw.trim().is_empty() { "Main".to_string() } else { raw }
        };
        let playthrough_id = ensure_named(&conn, &local, &name)?;
        let at = row.get("at").and_then(|v| v.as_i64()).unwrap_or(0);
        let secs = row.get("secs").and_then(|v| v.as_i64()).unwrap_or(0).max(0);
        let note = text(&row, "note");
        let details = text(&row, "details");
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM game_logs
                  WHERE game_id = ?1 AND at = ?2 AND secs = ?3 AND note = ?4
                    AND COALESCE(playthrough_id, '') = ?5",
                params![local, at, secs, note, playthrough_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            result.skipped += 1;
            continue;
        }
        conn.execute(
            "INSERT INTO game_logs (game_id, at, secs, note, details, created_at, position, playthrough_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                     (SELECT COALESCE(MIN(position), 0) - 1 FROM game_logs WHERE game_id = ?1), ?7)",
            params![local, at, secs, note, details, db::now(), playthrough_id],
        )
        .map_err(|e| format!("Could not bring that journal entry in: {e}"))?;
        result.logs_added += 1;
    }
    Ok(())
}

fn import_sessions(
    db: &Db,
    sessions: Option<&Value>,
    result: &mut CopyResult,
    unmatched: &mut BTreeSet<String>,
) -> Result<(), String> {
    let Some(rows) = sessions.and_then(|v| v.as_array()) else {
        return Ok(());
    };
    let conn = db.lock()?;
    let games = load_games(&conn)?;
    for row in rows {
        let game_id = text(row, "gameId");
        let title = text(row, "gameTitle");
        let Some(local) = match_game(&games, &game_id, &title) else {
            remember_unmatched(unmatched, &title, &game_id);
            result.skipped += 1;
            continue;
        };
        let started = row.get("startedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let duration = row.get("durationSecs").and_then(|v| v.as_i64()).unwrap_or(0);
        if duration <= 0 {
            result.skipped += 1;
            continue;
        }
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions
                  WHERE game_id = ?1 AND started_at = ?2 AND duration_secs = ?3",
                params![local, started, duration],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            result.skipped += 1;
            continue;
        }
        let name = text(row, "playthrough");
        let playthrough_id = if name.trim().is_empty() {
            conn.query_row(
                "SELECT id FROM playthroughs WHERE game_id = ?1 AND current = 1 LIMIT 1",
                params![local],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        } else {
            Some(ensure_named(&conn, &local, &name)?)
        };
        let category = {
            let raw = text(row, "category");
            if raw.trim().is_empty() { "Main story".to_string() } else { raw }
        };
        let note = text(row, "note");
        let manual = row.get("manual").and_then(|v| v.as_bool()).unwrap_or(false);
        let ended_by = if manual { "manual" } else { "imported" };
        conn.execute(
            "INSERT INTO sessions
                 (game_id, started_at, ended_at, duration_secs, category, note, manual, ended_by, playthrough_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                local,
                started,
                started + duration,
                duration,
                category,
                note,
                i64::from(manual),
                ended_by,
                playthrough_id,
            ],
        )
        .map_err(|e| format!("Could not bring that session in: {e}"))?;
        result.sessions_added += 1;
    }
    Ok(())
}

fn load_games(conn: &rusqlite::Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title FROM games ORDER BY created_at ASC, title COLLATE NOCASE ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn match_game(games: &[(String, String)], id: &str, title: &str) -> Option<String> {
    let id = id.trim();
    if !id.is_empty() {
        if let Some((game_id, _)) = games.iter().find(|(game_id, _)| game_id == id) {
            return Some(game_id.clone());
        }
    }
    let wanted = title.trim().to_lowercase();
    if wanted.is_empty() {
        return None;
    }
    games
        .iter()
        .find(|(_, name)| name.trim().to_lowercase() == wanted)
        .map(|(game_id, _)| game_id.clone())
}

fn find_playthrough(conn: &rusqlite::Connection, game_id: &str, name: &str) -> Result<Option<(String, String, bool)>, String> {
    let wanted = name.trim().to_lowercase();
    let mut stmt = conn
        .prepare("SELECT id, name, notes, current FROM playthroughs WHERE game_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![game_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)? != 0,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, existing, notes, current) = row.map_err(|e| e.to_string())?;
        if existing.trim().to_lowercase() == wanted {
            return Ok(Some((id, notes, current)));
        }
    }
    Ok(None)
}

fn ensure_named(conn: &rusqlite::Connection, game_id: &str, name: &str) -> Result<String, String> {
    if let Some((id, _, _)) = find_playthrough(conn, game_id, name)? {
        return Ok(id);
    }
    let id = fresh_id();
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playthroughs WHERE game_id = ?1",
            params![game_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let has_current: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playthroughs WHERE game_id = ?1 AND current = 1",
            params![game_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO playthroughs (id, game_id, name, notes, position, created_at, current)
         VALUES (?1, ?2, ?3, '', ?4, ?5, ?6)",
        params![id, game_id, name, position, db::now(), i64::from(has_current == 0)],
    )
    .map_err(|e| format!("Could not bring that playthrough in: {e}"))?;
    Ok(id)
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn remember_unmatched(unmatched: &mut BTreeSet<String>, title: &str, id: &str) {
    let title = title.trim();
    if !title.is_empty() {
        unmatched.insert(title.to_string());
        return;
    }
    let id = id.trim();
    if !id.is_empty() {
        unmatched.insert(id.to_string());
    }
}

fn fresh_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    format!("pt-{}-{}", db::now(), N.fetch_add(1, Ordering::Relaxed))
}

fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| if ch.is_control() || ch == '/' || ch == '\\' { '_' } else { ch })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.');
    if cleaned.is_empty() { "music".to_string() } else { cleaned.to_string() }
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::match_game;

    #[test]
    fn a_copy_matches_id_before_title() {
        let games = vec![
            ("a".to_string(), "Hades".to_string()),
            ("b".to_string(), "Hades".to_string()),
        ];
        assert_eq!(match_game(&games, "b", "Celeste").as_deref(), Some("b"));
        assert_eq!(match_game(&games, "missing", "hades").as_deref(), Some("a"));
        assert_eq!(match_game(&games, "missing", "Celeste"), None);
        assert_eq!(match_game(&games, "  ", "  "), None);
    }
}
