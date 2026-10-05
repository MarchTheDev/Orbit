// Orbit - a modern game launcher and playtime tracker.
//
// Module map:
//   paths      filesystem locations for data, logs, and cache
//   config     user settings, persisted as JSON
//   error      one error enum shared by every layer
//   models     plain data types (Game, PlaySession, LaunchTarget, ...)
//   db         SQLite storage and all SQL
//   launch     starting executables, Steam, and emulators
//   hltb       HowLongToBeat completion-time lookups
//   igdb       IGDB metadata via the Twitch OAuth flow
//   state      application logic that does not draw anything
//   storage    library folders, drives, and moving games between them
//   format     duration and number formatting
//   theme      colour palettes and egui styling
//   ui         all egui views, split per screen

mod config;
mod db;
mod error;
mod format;
mod hltb;
mod igdb;
mod launch;
mod models;
mod paths;
mod state;
mod storage;
mod tailwind;
mod theme;
mod ui;

use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;
use ui::net;

fn main() -> anyhow::Result<()> {
    let paths = paths::AppPaths::discover()?;
    paths.ensure_dirs()?;
    paths.migrate_legacy_layout();

    let mut settings = config::Settings::load(&paths);
    settings.apply_env_overrides();

    init_logging(&paths, &settings);

    tracing::info!("Orbit starting; data dir = {}", paths.data_dir.display());
    tracing::info!(
        theme = %settings.theme,
        igdb_configured = settings.igdb_ready(),
        hltb_enabled = settings.hltb_enabled,
        "configuration loaded"
    );

    let library = db::Library::open(&paths.db_file)?;
    let mut app = state::App::new(library, settings, paths.clone());
    app.recover_open_session();

    // Background result channels for the metadata services.
    let (hltb_tx, hltb_rx) = net::jobs::hltb_channel();
    let (igdb_tx, igdb_rx) = net::jobs::igdb_channel();
    let (igdb_fetch_tx, igdb_fetch_rx) = net::jobs::igdb_fetch_channel();
    net::init(hltb_tx, igdb_tx, igdb_fetch_tx);

    let inbox = net::Inbox {
        hltb: hltb_rx,
        igdb: igdb_rx,
        igdb_fetch: igdb_fetch_rx,
    };

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([900.0, 600.0])
            .with_title("Orbit")
            .with_app_id("dev.orbit.launcher")
            .with_drag_and_drop(true),
        ..Default::default()
    };

    eframe::run_native(
        "Orbit",
        native_options,
        Box::new(move |_cc| Ok(Box::new(ui::shell::OrbitApp::new(app, inbox)))),
    )
    .map_err(|e| anyhow::anyhow!("window could not be created: {e}"))
}

/// Write logs to a daily-rotated file plus stdout.
///
/// `RUST_LOG` or `ORBIT_LOG` override the level, which is handy for debugging
/// a failed lookup without rebuilding.
fn init_logging(paths: &paths::AppPaths, settings: &config::Settings) {
    let level = std::env::var("ORBIT_LOG")
        .or_else(|_| std::env::var("RUST_LOG"))
        .ok()
        .and_then(|s| s.parse::<EnvFilter>().ok())
        .unwrap_or_else(|| EnvFilter::new(config::default_log_level(settings)));

    let appender = tracing_appender::rolling::daily(&paths.log_dir, "orbit.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);

    tracing_subscriber::registry()
        .with(level)
        .with(tracing_subscriber::fmt::layer().with_writer(writer))
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(std::io::stdout)
                .with_target(false),
        )
        .init();

    // Keep the non-blocking writer's buffer alive for the process lifetime.
    Box::leak(Box::new(guard));
}
