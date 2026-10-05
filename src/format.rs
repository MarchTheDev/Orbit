use std::time::Duration;

/// Human-readable duration, e.g. `27h 15m`.
pub fn duration(secs: i64) -> String {
    let neg = secs < 0;
    let s = secs.abs();
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let out = match (h, m) {
        (0, 0) => format!("{s}s"),
        (0, m) => format!("{m}m"),
        (h, 0) => format!("{h}h"),
        (h, m) => format!("{h}h {m}m"),
    };
    if neg {
        format!("-{out}")
    } else {
        out
    }
}

/// Compact form for grid tiles, e.g. `27h` or `45m`.
pub fn duration_short(secs: i64) -> String {
    let h = secs / 3600;
    if h > 0 {
        format!("{h}h")
    } else {
        format!("{}m", (secs % 3600) / 60)
    }
}

/// `12.5h` style, for HLTB values which are decimal hours.
pub fn hours(h: f64) -> String {
    if h <= 0.0 {
        return "—".into();
    }
    if (h - h.round()).abs() < 0.05 {
        format!("{}h", h.round() as i64)
    } else {
        format!("{h:.1}h")
    }
}

/// Live timer shown while a session runs, always `HH:MM:SS`.
pub fn elapsed_clock(elapsed: Duration) -> String {
    let total = elapsed.as_secs();
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        (total % 3600) / 60,
        total % 60
    )
}

/// Progress through an HLTB estimate, clamped to 0..=1.
pub fn hltb_progress(played_secs: i64, estimate_hours: f64) -> f32 {
    if estimate_hours <= 0.0 {
        return 0.0;
    }
    let estimate_secs = estimate_hours * 3600.0;
    ((played_secs as f64) / estimate_secs).clamp(0.0, 1.0) as f32
}

/// Bytes for a readable size, used on the settings screen.
pub fn bytes(n: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    format!("{v:.1} {}", UNITS[i])
}
