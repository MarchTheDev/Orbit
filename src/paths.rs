use std::path::PathBuf;

use directories::ProjectDirs;

/// Filesystem locations Orbit uses for persistent data.
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// Root data directory (e.g. %APPDATA%\Orbit).
    pub data_dir: PathBuf,
    /// SQLite library file.
    pub db_file: PathBuf,
    /// Serialized settings.
    pub config_file: PathBuf,
    /// Directory holding rolling log files.
    pub log_dir: PathBuf,
    /// Cached cover images and other downloaded art.
    pub cache_dir: PathBuf,
}

impl AppPaths {
    /// Resolve platform-appropriate paths, honouring `ORBIT_DATA_DIR` if set.
    ///
    /// The env override exists so you can run a throwaway instance without
    /// touching your real library.
    pub fn discover() -> anyhow::Result<Self> {
        if let Some(custom) = std::env::var_os("ORBIT_DATA_DIR") {
            let data_dir = PathBuf::from(custom);
            return Ok(Self::from_data_dir(data_dir));
        }

        // No qualifier or organisation, so Windows resolves this to
        // %APPDATA%\Orbit rather than a nested Orbit\Orbit\data.
        let dirs = ProjectDirs::from("", "", "Orbit")
            .ok_or_else(|| anyhow::anyhow!("could not determine a data directory for this OS"))?;

        Ok(Self::from_data_dir(dirs.data_dir().to_path_buf()))
    }

    /// Earlier builds nested the data folder and kept settings.json in the
    /// parent. Fold anything found there into the new layout.
    ///
    /// Call after [`AppPaths::ensure_dirs`], since the copy targets must exist.
    pub fn migrate_legacy_layout(&self) {
        let Some(parent) = self.data_dir.parent() else {
            return;
        };
        let legacy_settings = parent.join("settings.json");
        let legacy_nested = parent.join("Orbit").join("data");
        if legacy_settings.is_file() && !self.config_file.exists() {
            tracing::info!(from = %legacy_settings.display(), "migrating legacy settings");
            let _ = std::fs::copy(&legacy_settings, &self.config_file);
        }
        if legacy_nested.is_dir() && legacy_nested != self.data_dir {
            tracing::info!(from = %legacy_nested.display(), "migrating legacy data directory");
            for file in ["orbit.db", "orbit.db-wal", "orbit.db-shm"] {
                let src = legacy_nested.join(file);
                let dst = self.data_dir.join(file);
                if src.is_file() && !dst.exists() {
                    let _ = std::fs::copy(&src, &dst);
                }
            }
        }
    }

    fn from_data_dir(data_dir: PathBuf) -> Self {
        let log_dir = data_dir.join("logs");
        let cache_dir = data_dir.join("cache");
        Self {
            db_file: data_dir.join("orbit.db"),
            config_file: data_dir.join("config.json"),
            log_dir,
            cache_dir,
            data_dir,
        }
    }

    /// Create every directory Orbit expects to exist. Safe to call repeatedly.
    pub fn ensure_dirs(&self) -> anyhow::Result<()> {
        for dir in [&self.data_dir, &self.log_dir, &self.cache_dir] {
            std::fs::create_dir_all(dir)
                .map_err(|e| anyhow::anyhow!("could not create {}: {e}", dir.display()))?;
        }
        Ok(())
    }
}
