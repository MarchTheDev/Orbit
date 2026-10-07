//! Number formatting the native side needs.
//!
//! Durations and HLTB values are formatted in the UI, which already has the
//! numbers in hand. Only sizes are rendered here, because a move that is about
//! to fill a drive has to explain itself in words before it starts.

/// Bytes for a readable size, used for folder sizes and drive figures.
pub fn bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    format!("{v:.1} {}", UNITS[i])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_scale_to_a_readable_unit() {
        assert_eq!(bytes(512), "512.0 B");
        assert_eq!(bytes(2048), "2.0 KB");
        assert_eq!(bytes(3 * 1024 * 1024 * 1024), "3.0 GB");
        assert_eq!(bytes(2 * 1024 * 1024 * 1024 * 1024), "2.0 TB");
    }
}
