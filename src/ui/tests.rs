//! Headless checks on the pages a player actually spends time in.
//!
//! egui can lay a frame out without a window, so these catch the panics and
//! layout mistakes that only otherwise turn up when someone opens the app: a
//! widget built outside its frame, a borrow held across a closure, a view that
//! asks for a repaint forever.

use std::path::{Path, PathBuf};

use crate::config::{LibraryView, Settings};
use crate::models::Game;
use crate::paths::AppPaths;
use crate::state::App;
use crate::theme::Theme;
use crate::ui::{library, storage};

fn temp(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("orbit-ui-test-{name}"));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// One folder with a game in it, a second folder with a game in it, and a game
/// that lives somewhere Orbit does not manage.
fn library_on_disk(root: &Path) -> (Vec<PathBuf>, Vec<(String, PathBuf)>) {
    let lib_a = root.join("libA");
    let lib_b = root.join("libB");
    let hades = lib_a.join("Hades").join("bin");
    let celeste = lib_b.join("Celeste");
    let stray = root.join("Downloads").join("Stardew");
    for dir in [&hades, &celeste, &stray] {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("game.bin"), vec![0u8; 64]).unwrap();
    }
    (
        vec![lib_a, lib_b],
        vec![
            ("Hades".to_string(), hades),
            ("Celeste".to_string(), celeste),
            ("Stardew".to_string(), stray),
        ],
    )
}

fn build_app(
    root: &Path,
    folders: &[PathBuf],
    games: &[(String, PathBuf)],
    view: LibraryView,
) -> App {
    let data = root.join("data");
    std::fs::create_dir_all(&data).unwrap();
    let paths = AppPaths {
        db_file: data.join("orbit.db"),
        config_file: data.join("config.json"),
        log_dir: data.join("logs"),
        cache_dir: data.join("cache"),
        data_dir: data,
    };

    let lib = crate::db::Library::open(&paths.db_file).unwrap();
    for (name, dir) in games {
        let mut g = Game::new(name.clone());
        g.install_dir = Some(dir.clone());
        lib.insert_game(&g).unwrap();
    }

    let mut settings = Settings {
        library_folders: folders
            .iter()
            .map(|f| f.to_string_lossy().into_owned())
            .collect(),
        library_view: view,
        ..Default::default()
    };
    if let Some(first) = settings.library_folders.first().cloned() {
        settings.set_default_folder(&first);
    }

    App::new(lib, settings, paths)
}

/// Lay out one frame around `body` with no window attached.
fn frame(app: &mut App, mut body: impl FnMut(&mut egui::Ui, &mut App)) {
    let ctx = egui::Context::default();
    let _ = ctx.run(egui::RawInput::default(), |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| body(ui, app));
    });
}

#[test]
fn the_storage_page_lays_out_with_games_in_several_folders() {
    let root = temp("storage-page");
    let (folders, games) = library_on_disk(&root);
    let mut app = build_app(&root, &folders, &games, LibraryView::Catalog);
    let mut view = storage::StorageView::default();

    frame(&mut app, |ui, app| {
        storage::show(ui, app, Theme::orbit_dark(), &mut view, &mut false);
    });

    assert_eq!(app.storage.folders.len(), 2);
    assert_eq!(app.storage.folders[0].games.len(), 1);
    assert_eq!(app.storage.folders[0].games[0].game.name, "Hades");
    assert_eq!(app.storage.folders[1].games[0].game.name, "Celeste");
    assert_eq!(app.storage.elsewhere.len(), 1);
    assert_eq!(app.storage.elsewhere[0].game.name, "Stardew");
    assert!(app.storage.folders[0].is_default);

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_storage_page_lays_out_before_any_folder_is_set() {
    let root = temp("storage-empty");
    let mut app = build_app(&root, &[], &[], LibraryView::Catalog);
    let mut view = storage::StorageView::default();

    frame(&mut app, |ui, app| {
        storage::show(ui, app, Theme::terminal(), &mut view, &mut false);
    });

    assert!(app.storage.folders.is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_storage_page_survives_a_folder_that_is_not_there() {
    let root = temp("storage-missing");
    let (folders, games) = library_on_disk(&root);
    let mut app = build_app(&root, &folders, &games, LibraryView::Catalog);
    // A folder on a drive that is not plugged in right now.
    app.settings.library_folders.push("Q:\\Games".to_string());
    app.refresh_storage();
    let mut view = storage::StorageView::default();

    frame(&mut app, |ui, app| {
        storage::show(ui, app, Theme::void(), &mut view, &mut false);
    });

    let missing = app
        .storage
        .folders
        .iter()
        .find(|f| f.path.to_string_lossy().starts_with("Q:"))
        .expect("the missing folder is still listed");
    assert!(!missing.exists, "and reported as not there");
    assert_eq!(
        app.storage.folders[0].games.len(),
        1,
        "the real ones still read"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn both_library_views_lay_out_the_same_library() {
    let root = temp("library-views");
    let (folders, games) = library_on_disk(&root);

    for view in [LibraryView::Catalog, LibraryView::List] {
        for theme in Theme::all() {
            let mut app = build_app(&root, &folders, &games, view);
            let mut needs_repaint = false;

            frame(&mut app, |ui, app| {
                library::grid(ui, app, *theme, &mut needs_repaint);
            });
            assert!(
                !needs_repaint,
                "{} / {} asked to redraw for no reason",
                view.label(),
                theme.name
            );

            let mut app = build_app(&root, &folders, &games, view);
            let mut needs_repaint = false;
            frame(&mut app, |ui, app| {
                library::list(ui, app, *theme, &mut needs_repaint);
            });
            assert!(
                !needs_repaint,
                "{} / {} asked to redraw for no reason",
                view.label(),
                theme.name
            );
        }
    }

    let _ = std::fs::remove_dir_all(root);
}

/// A second frame with nothing changed should not queue another repaint, or the
/// app would sit there burning a frame forever.
#[test]
fn a_settled_page_stops_asking_for_repaint() {
    let root = temp("settled");
    let (folders, games) = library_on_disk(&root);
    let mut app = build_app(&root, &folders, &games, LibraryView::List);
    let mut view = storage::StorageView::default();

    let ctx = egui::Context::default();
    for frame_no in 0..3 {
        let mut needs_repaint = false;
        let _ = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                storage::show(ui, &mut app, Theme::nebula(), &mut view, &mut needs_repaint);
            });
        });
        if frame_no == 0 {
            // The first frame measures, so it is allowed to ask for another.
            continue;
        }
        assert!(
            !needs_repaint,
            "frame {frame_no} of a settled storage page asked to redraw"
        );
    }

    let _ = std::fs::remove_dir_all(root);
}
