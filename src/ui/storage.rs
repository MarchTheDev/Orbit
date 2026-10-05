use egui::{Align, Layout, RichText};

use crate::state::App;
use crate::storage;
use crate::theme::{radius, space, type_size, Theme};
use crate::ui::common;

/// State that belongs to this page rather than to the app.
#[derive(Default)]
pub struct StorageView {
    /// Game whose move destination picker is open, so only one is at a time.
    moving: Option<i64>,
    /// Which library folder the picker is aimed at.
    target: String,
    /// What the page is working out right now, e.g. a missing folder.
    notice: Option<String>,
}

/// The game the player asked to open, if any.
pub fn show(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    view: &mut StorageView,
    needs_repaint: &mut bool,
) -> Option<i64> {
    let mut action = None;

    heading(ui, app, theme, needs_repaint);
    ui.add_space(space::SM);

    if app.settings.library_folders.is_empty() {
        first_run(ui, app, theme, view);
        return action;
    }

    // A snapshot, so each card can take `&mut app` while drawing.
    let folders = app.storage.folders.clone();
    let busy = app.move_job.as_ref().map(|j| j.game_id);
    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for (i, folder) in folders.iter().enumerate() {
                if i > 0 {
                    ui.add_space(space::MD);
                }
                folder_card(
                    ui,
                    app,
                    theme,
                    folder,
                    view,
                    &mut action,
                    busy,
                    needs_repaint,
                );
            }

            if !app.storage.elsewhere.is_empty() {
                ui.add_space(space::MD);
                elsewhere_card(ui, app, theme, &mut action);
            }

            ui.add_space(space::MD);
            common::card(&theme, ui, |ui| {
                common::section_header(&theme, ui, "Add a folder", None);
                ui.add_space(space::XS);
                ui.label(
                    RichText::new("One folder per drive. Orbit creates it if it is not there yet.")
                        .size(type_size::CAPTION)
                        .color(theme.text_faint),
                );
                ui.add_space(space::MD);
                folder_input(ui, app, theme, view);
            });
        });

    if let Some(msg) = view.notice.take() {
        ui.add_space(space::SM);
        common::card(&theme, ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("\u{2716}").color(theme.danger).size(13.0));
                ui.label(RichText::new(msg).size(type_size::SMALL).color(theme.text));
            });
        });
    }
    action
}

/// Page title with the overall figure and a manual refresh.
fn heading(ui: &mut egui::Ui, app: &mut App, theme: Theme, needs_repaint: &mut bool) {
    let games = app.storage.game_count();
    let bytes = crate::format::bytes(app.storage.total_bytes());
    common::page_header(
        &theme,
        ui,
        "Storage",
        Some(&format!("{games} games \u{b7} {bytes} in folders")),
        |ui| {
            if common::secondary_button(&theme, ui, "Rescan")
                .on_hover_text("Re-read folder sizes and free space")
                .clicked()
            {
                app.refresh_storage();
                *needs_repaint = true;
            }
        },
    );
}

/// Shown until at least one folder exists, since nothing else has meaning yet.
fn first_run(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut StorageView) {
    common::card(&theme, ui, |ui| {
        ui.label(
            RichText::new("Tell Orbit where your games live")
                .size(type_size::TITLE)
                .strong()
                .color(theme.text),
        );
        ui.add_space(space::SM);
        ui.label(
            RichText::new(
                "Add a folder for each drive you keep games on, usually one per drive. Orbit \
                 then reports what each game takes and can move games between those folders. \
                 Games you add from elsewhere stay listed but are never touched.",
            )
            .size(type_size::BODY)
            .color(theme.text_dim),
        );
        ui.add_space(space::LG);
        folder_input(ui, app, theme, view);
    });
}

/// One library folder: drive usage, what is installed there, and a move picker
/// per game.
#[allow(clippy::too_many_arguments)]
fn folder_card(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    folder: &storage::LibraryFolder,
    view: &mut StorageView,
    action: &mut Option<i64>,
    busy: Option<i64>,
    needs_repaint: &mut bool,
) {
    common::card(&theme, ui, |ui| {
        folder_header(ui, app, theme, folder, needs_repaint);

        if folder.games.is_empty() {
            ui.add_space(space::MD);
            ui.label(
                RichText::new(
                    "Nothing installed here yet. Add a game and point it at this folder.",
                )
                .size(type_size::SMALL)
                .color(theme.text_faint),
            );
            return;
        }

        ui.add_space(space::MD);
        for game in &folder.games {
            ui.push_id(game.game.id, |ui| {
                game_row(
                    ui,
                    app,
                    theme,
                    game,
                    folder,
                    view,
                    action,
                    busy,
                    needs_repaint,
                );
                ui.add_space(space::XS);
            });
        }
    });
}

fn folder_header(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    folder: &storage::LibraryFolder,
    needs_repaint: &mut bool,
) {
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(&folder.drive)
                .size(type_size::TITLE)
                .strong()
                .color(theme.text),
        );
        common::cell(
            ui,
            &folder.path.display().to_string(),
            260.0,
            type_size::CAPTION,
            theme.text_faint,
        )
        .on_hover_text(folder.path.display().to_string());
        if folder.is_default {
            common::pill(&theme, ui, "default", theme.accent_soft, theme.accent);
        }
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if common::icon_button(&theme, ui, "\u{2715}", "Stop managing this folder", 12.0)
                .on_hover_text(format!(
                    "Games in {} stay in your library but are no longer moved.",
                    folder.path.display()
                ))
                .clicked()
            {
                app.remove_library_folder(&folder.path.to_string_lossy());
                *needs_repaint = true;
            }
            ui.label(
                RichText::new(format!(
                    "{} in {} games",
                    crate::format::bytes(folder.games_bytes),
                    folder.games.len()
                ))
                .size(type_size::SMALL)
                .color(theme.text),
            );
            ui.label(
                RichText::new(free_of(folder))
                    .size(type_size::CAPTION)
                    .color(theme.text_faint),
            );
        });
    });

    if !folder.exists {
        ui.add_space(space::SM);
        common::pill(
            &theme,
            ui,
            "\u{26A0} folder not on this machine",
            theme.warning_soft,
            theme.warning,
        );
    }

    // A used-space bar reads faster than the numbers alone.
    if folder.total > 0 {
        ui.add_space(space::SM);
        let p = ((folder.total - folder.free) as f64 / folder.total as f64) as f32;
        common::meter(&theme, ui, p);
    }
}

/// `12.4 GB free of 200 GB`, or nothing when the drive is unknown.
fn free_of(folder: &storage::LibraryFolder) -> String {
    if folder.total == 0 {
        return String::new();
    }
    format!(
        "{} free of {}",
        crate::format::bytes(folder.free),
        crate::format::bytes(folder.total)
    )
}

/// One installed game with its size and the move control.
#[allow(clippy::too_many_arguments)]
fn game_row(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    stored: &storage::StoredGame,
    folder: &storage::LibraryFolder,
    view: &mut StorageView,
    action: &mut Option<i64>,
    busy: Option<i64>,
    needs_repaint: &mut bool,
) {
    let id = stored.game.id;
    let playing = app.active.as_ref().is_some_and(|a| a.game_id == id);
    let moving_here = busy == Some(id);

    if moving_here {
        let (copied, total) = app
            .move_job
            .as_ref()
            .map(|j| (j.copied, j.total))
            .unwrap_or((0, 0));
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(format!("Moving {}", stored.game.name))
                    .size(type_size::BODY)
                    .strong()
                    .color(theme.text),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(
                    RichText::new(format!(
                        "{} / {}",
                        crate::format::bytes(copied),
                        crate::format::bytes(total)
                    ))
                    .size(type_size::CAPTION)
                    .monospace()
                    .color(theme.text_dim),
                );
            });
        });
        ui.add_space(space::XS);
        common::meter(&theme, ui, app.move_progress());
        ui.add_space(space::SM);
        return;
    }

    ui.horizontal(|ui| {
        if playing {
            let (dot, _) = ui.allocate_exact_size(egui::vec2(8.0, 8.0), egui::Sense::hover());
            ui.painter().circle_filled(dot.center(), 3.5, theme.success);
            ui.add_space(2.0);
        }
        let name = common::cell(ui, &stored.game.name, 240.0, type_size::BODY, theme.text);
        if name.clicked() {
            *action = Some(id);
        }
        name.clone()
            .on_hover_text(format!("Open {} for details", stored.game.name));
        // The folder Orbit would actually move. `game_folder` resolves paths, which on
        // Windows means a `\\?\` prefix, so show the name and keep the full path
        // for the tooltip.
        let folder_name = stored
            .folder
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| stored.folder.display().to_string());
        common::cell(
            ui,
            &folder_name,
            240.0,
            type_size::CAPTION,
            theme.text_faint,
        )
        .on_hover_text(stored.folder.display().to_string());

        let played = App::effective_playtime(&stored.game, &stored.summary);
        common::cell_right(
            ui,
            &if played > 0 {
                crate::format::duration_short(played)
            } else {
                "\u{2014}".to_string()
            },
            80.0,
            type_size::CAPTION,
            theme.text_faint,
        );
        common::cell_right(
            ui,
            &crate::format::bytes(stored.bytes),
            90.0,
            type_size::SMALL,
            theme.text_dim,
        );

        if common::secondary_button(&theme, ui, "Move\u{2026}")
            .on_hover_text("Move this game to another library folder")
            .clicked()
        {
            view.moving = if view.moving == Some(id) {
                None
            } else {
                Some(id)
            };
            if view.moving == Some(id) {
                // Default the picker to a folder this game is not in.
                view.target = app
                    .settings
                    .library_folders
                    .iter()
                    .find(|f| !storage::same_path(std::path::Path::new(f), &folder.path))
                    .cloned()
                    .unwrap_or_default();
            }
            *needs_repaint = true;
        }
    });

    if view.moving == Some(id) {
        move_picker(ui, app, theme, stored, view, needs_repaint);
    }
}

/// Destination chooser for one game.
fn move_picker(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    stored: &storage::StoredGame,
    view: &mut StorageView,
    needs_repaint: &mut bool,
) {
    egui::Frame::new()
        .fill(theme.surface_alt)
        .stroke(egui::Stroke::new(1.0_f32, theme.border))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::symmetric(space::MD as i8, space::MD as i8))
        .show(ui, |ui| {
            let current = std::path::Path::new(&view.target);
            let free = storage::disk_space(current).map(|(_, f)| f);
            let enough = free.is_some_and(|f| f >= stored.bytes);

            ui.horizontal(|ui| {
                ui.label(
                    RichText::new("Move to")
                        .size(type_size::SMALL)
                        .strong()
                        .color(theme.text),
                );
                let label = if view.target.is_empty() {
                    "Choose a folder\u{2026}".to_string()
                } else {
                    view.target.clone()
                };
                egui::ComboBox::from_id_salt(("move_dest", stored.game.id))
                    .selected_text(
                        RichText::new(label)
                            .size(type_size::SMALL)
                            .color(theme.text),
                    )
                    .width(320.0)
                    .show_ui(ui, |ui| {
                        for f in &app.settings.library_folders {
                            ui.selectable_value(
                                &mut view.target,
                                f.clone(),
                                RichText::new(f).size(type_size::SMALL).color(theme.text),
                            );
                        }
                    });

                if let Some(free) = free {
                    // Checked as the picker changes so the warning is not a
                    // surprise after a long copy.
                    ui.label(
                        RichText::new(format!("{} free", crate::format::bytes(free)))
                            .size(type_size::CAPTION)
                            .color(if enough {
                                theme.text_faint
                            } else {
                                theme.danger
                            }),
                    );
                    if !enough {
                        ui.label(
                            RichText::new("not enough space")
                                .size(type_size::CAPTION)
                                .strong()
                                .color(theme.danger),
                        );
                    }
                }
            });

            let reason = if view.target.is_empty() {
                Some("Pick a destination folder first.".to_string())
            } else {
                app.can_move_game(&stored.game, &view.target).err()
            };

            ui.horizontal(|ui| {
                ui.add_space(space::LG);
                if let Some(why) = reason.as_ref() {
                    ui.label(
                        RichText::new(format!("\u{26A0} {why}"))
                            .size(type_size::CAPTION)
                            .color(theme.danger),
                    );
                }
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if common::secondary_button(&theme, ui, "Cancel")
                        .on_hover_text("Close without moving anything")
                        .clicked()
                    {
                        view.moving = None;
                        *needs_repaint = true;
                    }
                    let go = ui.add_enabled(
                        reason.is_none(),
                        egui::Button::new(
                            RichText::new(format!("Move {}", crate::format::bytes(stored.bytes)))
                                .size(type_size::BODY)
                                .strong()
                                .color(theme.on_accent),
                        )
                        .fill(theme.accent)
                        .stroke(egui::Stroke::NONE)
                        .corner_radius(radius::SM)
                        .min_size(egui::vec2(140.0, 34.0)),
                    );
                    if reason.is_none() && go.clicked() {
                        match app.start_move(stored.game.id, &view.target) {
                            Ok(()) => {
                                view.moving = None;
                                *needs_repaint = true;
                            }
                            Err(e) => view.notice = Some(e),
                        }
                    }
                });
            });
        });
}

/// Games installed outside every library folder.
fn elsewhere_card(ui: &mut egui::Ui, app: &mut App, theme: Theme, action: &mut Option<i64>) {
    common::card(&theme, ui, |ui| {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(
                    RichText::new("Outside your library folders")
                        .size(type_size::TITLE)
                        .strong()
                        .color(theme.text),
                );
                ui.label(
                    RichText::new(
                        "Listed for reference only. Orbit never moves or deletes a game in a \
                         folder it does not manage.",
                    )
                    .size(type_size::CAPTION)
                    .color(theme.text_faint),
                );
            });
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(
                    RichText::new(format!(
                        "{} in {} games",
                        crate::format::bytes(app.storage.elsewhere_bytes),
                        app.storage.elsewhere.len()
                    ))
                    .size(type_size::SMALL)
                    .color(theme.text),
                );
            });
        });
        ui.add_space(space::MD);

        for stored in &app.storage.elsewhere {
            let id = stored.game.id;
            ui.horizontal(|ui| {
                let name = common::cell(ui, &stored.game.name, 240.0, type_size::BODY, theme.text);
                if name.clicked() {
                    *action = Some(id);
                }
                let path = stored
                    .game
                    .install_dir
                    .as_ref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| "no folder set".into());
                common::cell(ui, &path, 340.0, type_size::CAPTION, theme.text_faint)
                    .on_hover_text(path);
                common::cell_right(
                    ui,
                    &crate::format::bytes(stored.bytes),
                    100.0,
                    type_size::SMALL,
                    theme.text_dim,
                );
            });
            ui.add_space(space::XS);
        }
    });
}

/// Text box and button for a new library folder.
///
/// The text lives on `App`, so the Settings page can add folders too.
fn folder_input(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut StorageView) {
    ui.horizontal(|ui| {
        let resp = ui.add(
            egui::TextEdit::singleline(&mut app.folder_input)
                .hint_text(r"C:\Games")
                .desired_width(380.0)
                .text_color(theme.text),
        );
        // Hover text is set before the response is consumed below.
        resp.clone()
            .on_hover_text("An absolute path to a folder you keep games in, one per drive");
        let enter = resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        let add = common::primary_button(&theme, ui, "Add folder")
            .on_hover_text("Orbit creates the folder if it is not there yet");
        if add.clicked() || enter {
            if let Err(why) = app.add_typed_folder() {
                view.notice = Some(why);
            }
        }
    });
}
