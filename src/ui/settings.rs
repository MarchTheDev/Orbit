use egui::{Align, Layout, RichText};

use crate::config::LibraryView;
use crate::format;
use crate::paths::AppPaths;
use crate::state::App;
use crate::theme::{radius, space, type_size, Theme};
use crate::ui::common;

/// Settings page: appearance, tracking, integrations, and data locations.
pub fn show(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    common::page_header(&theme, ui, "Settings", None, |ui| {
        if common::secondary_button(&theme, ui, "Reset appearance")
            .on_hover_text("Restore theme, scale, and layout to their defaults. Folders and credentials are left alone.")
            .clicked()
        {
            let defaults = crate::config::Settings::default();
            app.settings.theme = defaults.theme;
            app.settings.ui_scale = defaults.ui_scale;
            app.settings.grid_tile_size = defaults.grid_tile_size;
            app.settings.show_cover_art = defaults.show_cover_art;
            app.settings.show_platform_badges = defaults.show_platform_badges;
            app.settings.library_view = defaults.library_view;
            app.mark_settings_dirty();
        }
    });
    ui.add_space(space::SM);

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.set_max_width(860.0);
            appearance(ui, app, theme);
            ui.add_space(space::MD);
            library_section(ui, app, theme);
            ui.add_space(space::MD);
            tracking(ui, app, theme);
            ui.add_space(space::MD);
            integrations(ui, app, theme);
            ui.add_space(space::MD);
            data_section(ui, app, theme);
            ui.add_space(space::XL);
        });
}

fn appearance(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    section(ui, theme, "Appearance", |ui| {
        // Swatch grid: click to apply. Each swatch is drawn with the preset's
        // own colours so the choice is visible before you click it.
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(space::SM, space::SM);
            let presets = crate::theme::Theme::all();
            let current = app.settings.theme.clone();
            for preset in presets.iter() {
                if swatch(ui, preset, &current) {
                    app.set_theme(preset.name);
                }
            }
        });

        ui.add_space(space::MD);
        common::slider_row(
            &theme,
            ui,
            "Interface scale",
            0.7..=1.8,
            &mut app.settings.ui_scale,
        );
        common::setting_row(&theme, ui, "Current scale", None, |ui| {
            ui.label(
                RichText::new(format!("{:.0}%", app.settings.ui_scale * 100.0))
                    .size(type_size::BODY)
                    .color(theme.text_dim),
            );
        });

        ui.add_space(space::SM);
        common::setting_row(&theme, ui, "Grid tile size", None, |ui| {
            ui.add(egui::Slider::new(&mut app.settings.grid_tile_size, 110.0..=260.0).text(""));
        });
        common::toggle_row(
            &theme,
            ui,
            "Cover art",
            Some("Show art in the catalog when a game has one"),
            &mut app.settings.show_cover_art,
        );
        common::toggle_row(
            &theme,
            ui,
            "Platform badges",
            Some("List platforms under each game in the list view"),
            &mut app.settings.show_platform_badges,
        );

        ui.add_space(space::SM);
        common::setting_row(&theme, ui, "Library layout", None, |ui| {
            let mut view = app.settings.library_view;
            let picked = common::segmented(
                &theme,
                ui,
                "settings_library_view",
                &[
                    (LibraryView::Catalog, LibraryView::Catalog.label()),
                    (LibraryView::List, LibraryView::List.label()),
                ],
                app.settings.library_view,
            );
            if let Some(next) = picked {
                view = next;
            }
            // `view` only differs from the stored value when something was
            // picked, which is enough to know a write is due.
            if view != app.settings.library_view {
                app.settings.library_view = view;
                app.mark_settings_dirty();
            }
        });
    });
}

/// Library folders and the default destination for new installs.
fn library_section(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    section(ui, theme, "Library folders", |ui| {
        ui.label(
            RichText::new(
                "Orbit keeps games in these folders, usually one per drive. It reports what each \
                 game takes and can move games between them. A game installed anywhere else is \
                 still tracked, but Orbit never moves or deletes it.",
            )
            .size(type_size::SMALL)
            .color(theme.text_faint),
        );
        ui.add_space(space::MD);

        if app.settings.library_folders.is_empty() {
            common::empty_state(
                &theme,
                ui,
                "\u{1F5C2}",
                "No folders yet",
                "Add one below, or use the Storage page, and Orbit can start reporting sizes.",
                None,
            );
        }

        for folder in app.settings.library_folders.clone() {
            let is_default = crate::storage::same_path(
                std::path::Path::new(&folder),
                std::path::Path::new(app.settings.default_library_folder().unwrap_or_default()),
            );
            let missing = !std::path::Path::new(&folder).is_dir();
            ui.horizontal(|ui| {
                if is_default {
                    common::pill(&theme, ui, "default", theme.accent_soft, theme.accent);
                }
                common::cell(ui, &folder, 400.0, type_size::BODY, theme.text);
                if missing {
                    common::pill(&theme, ui, "missing", theme.warning_soft, theme.warning);
                }
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if common::icon_button(
                        &theme,
                        ui,
                        "\u{2715}",
                        "Stop managing this folder",
                        12.0,
                    )
                    .on_hover_text("Stop managing this folder. Games there stay in your library.")
                    .clicked()
                    {
                        app.remove_library_folder(&folder);
                    }
                    if !is_default && common::secondary_button(&theme, ui, "Make default").clicked()
                    {
                        app.set_default_folder(&folder);
                    }
                });
            });
            ui.add_space(space::XS);
        }

        ui.add_space(space::SM);
        ui.horizontal(|ui| {
            let resp = ui.add(
                egui::TextEdit::singleline(&mut app.folder_input)
                    .hint_text(r"C:\Games")
                    .desired_width(360.0)
                    .text_color(theme.text),
            );
            resp.clone().on_hover_text(
                "An absolute path to a folder you keep games in, one per drive if you can",
            );
            let entered = resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
            let add = common::primary_button(&theme, ui, "Add folder")
                .on_hover_text("Orbit creates the folder if it is not there yet");
            if add.clicked() || entered {
                if let Err(why) = app.add_typed_folder() {
                    app.last_error = Some(why);
                }
            }
        });
    });
}

fn tracking(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    section(ui, theme, "Playtime tracking", |ui| {
        common::toggle_row(
            &theme,
            ui,
            "Track playtime",
            Some("Time sessions and launch games"),
            &mut app.settings.track_playtime,
        );
        common::toggle_row(
            &theme,
            ui,
            "Recover open sessions",
            Some("Reopen sessions left running if Orbit crashes"),
            &mut app.settings.warn_on_unclean_exit,
        );
        common::toggle_row(
            &theme,
            ui,
            "Confirm before deleting",
            Some("Ask before removing a game from the library"),
            &mut app.settings.confirm_before_delete,
        );
        common::toggle_row(
            &theme,
            ui,
            "Start the timer on first play",
            Some("Begin a session as soon as you launch a game"),
            &mut app.settings.autostart_tracker,
        );

        ui.add_space(space::SM);
        common::setting_row(
            &theme,
            ui,
            "Session limit",
            Some("Warn when a session runs this long. 0 disables the warning."),
            |ui| {
                ui.add(
                    egui::DragValue::new(&mut app.settings.session_limit_hours)
                        .speed(0.25)
                        .range(0.0..=24.0)
                        .suffix(" h"),
                );
            },
        );
    });
}

fn integrations(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    section(ui, theme, "Integrations", |ui| {
        common::toggle_row(
            &theme,
            ui,
            "HowLongToBeat completion times",
            Some("Fetch main-story estimates when you add a game"),
            &mut app.settings.hltb_enabled,
        );
        ui.label(
            RichText::new(
                "HowLongToBeat has no public API, so lookups use their website's endpoints. If one fails, everything else keeps working and you can still type times in by hand.",
            )
            .size(type_size::CAPTION)
            .color(theme.text_faint),
        );

        ui.add_space(space::MD);
        common::section_rule(&theme, ui, "IGDB metadata");
        common::toggle_row(
            &theme,
            ui,
            "Enable IGDB",
            Some("Search for games and pull box art and metadata"),
            &mut app.settings.igdb_enabled,
        );
        ui.label(
            RichText::new(
                "IGDB is owned by Twitch and requires a free Twitch application. Create one at dev.twitch.tv/console, set Client Type to Confidential, then paste the values below.",
            )
            .size(type_size::CAPTION)
            .color(theme.text_faint),
        );

        ui.add_space(space::SM);
        common::setting_row(&theme, ui, "Client ID", None, |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut app.settings.twitch_client_id)
                    .desired_width(240.0)
                    .text_color(theme.text)
                    .hint_text("paste your client id"),
            );
        });
        common::setting_row(&theme, ui, "Client secret", None, |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut app.settings.twitch_client_secret)
                    .desired_width(240.0)
                    .password(true)
                    .text_color(theme.text)
                    .hint_text("paste your client secret"),
            );
        });

        ui.horizontal(|ui| {
            if common::secondary_button(&theme, ui, "Test credentials").clicked() {
                app.refresh_igdb();
                if app.igdb.is_some() {
                    app.last_error =
                        Some("Credentials saved. Search from the Add game screen.".into());
                }
            }
            if app.settings.igdb_ready() {
                common::status_dot(&theme, ui, theme.success, "Credentials present");
            } else {
                common::status_dot(
                    &theme,
                    ui,
                    theme.warning,
                    "Not configured \u{b7} metadata features stay off",
                );
            }
        });
    });
}

fn data_section(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let paths = app.paths.clone();
    section(ui, theme, "Data and diagnostics", |ui| {
        common::setting_row(
            &theme,
            ui,
            "Database",
            Some(&paths.db_file.display().to_string()),
            |ui| {
                if common::secondary_button(&theme, ui, "Open folder").clicked() {
                    if let Err(e) = opener::open(&paths.data_dir) {
                        app.last_error = Some(format!("Could not open the folder: {e}"));
                    }
                }
            },
        );
        common::setting_row(
            &theme,
            ui,
            "Settings file",
            Some(&paths.config_file.display().to_string()),
            |_| {},
        );
        common::setting_row(
            &theme,
            ui,
            "Logs",
            Some(&paths.log_dir.display().to_string()),
            |ui| {
                if common::secondary_button(&theme, ui, "Open logs").clicked() {
                    if let Err(e) = opener::open(&paths.log_dir) {
                        app.last_error = Some(format!("Could not open the log folder: {e}"));
                    }
                }
            },
        );

        ui.add_space(space::SM);
        ui.horizontal(|ui| {
            if common::secondary_button(
                &theme,
                ui,
                &format!("Clear HLTB cache ({})", app.hltb.cached_len()),
            )
            .on_hover_text("Drop cached completion times and fetch them again on demand")
            .clicked()
            {
                app.hltb.clear_cache();
            }
            let verbose = ui.checkbox(&mut app.settings.log_verbose, "Verbose logging");
            if verbose.changed() {
                app.mark_settings_dirty();
            }
        });
        ui.label(
            RichText::new(
                "Logs rotate daily in the logs folder. Set ORBIT_LOG=debug in the environment for more detail.",
            )
            .size(type_size::CAPTION)
            .color(theme.text_faint),
        );

        ui.add_space(space::SM);
        let size = format::bytes(data_dir_size(&paths));
        common::setting_row(
            &theme,
            ui,
            "Library summary",
            Some(&format!(
                "{size}  \u{b7}  {} games  \u{b7}  {} sessions",
                app.stats.total_games, app.stats.sessions
            )),
            |ui| {
                ui.label(
                    RichText::new(total_label(app))
                        .size(type_size::BODY)
                        .strong()
                        .color(theme.accent),
                );
            },
        );
    });
}

/// Draw one theme swatch and report whether the user clicked it.
fn swatch(ui: &mut egui::Ui, preset: &crate::theme::Theme, current: &str) -> bool {
    let selected = preset.name == current;

    let resp = egui::Frame::new()
        .fill(preset.bg)
        .stroke(egui::Stroke::new(
            if selected { 2.0_f32 } else { 1.0_f32 },
            if selected {
                preset.accent
            } else {
                preset.border
            },
        ))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::symmetric(space::MD as i8, space::SM as i8))
        .show(ui, |ui| {
            ui.set_min_width(132.0);
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(preset.label)
                        .size(type_size::SMALL)
                        .strong()
                        .color(preset.text),
                );
                if selected {
                    ui.label(
                        RichText::new("\u{2713}")
                            .size(12.0)
                            .color(preset.accent)
                            .strong(),
                    );
                }
            });
            ui.add_space(space::XS);
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(3.0, 0.0);
                for c in [
                    preset.accent,
                    preset.surface_alt,
                    preset.sidebar,
                    preset.text_dim,
                    preset.warning,
                ] {
                    // A small filled chip previewing the palette.
                    let (rect, _) =
                        ui.allocate_exact_size(egui::vec2(13.0, 13.0), egui::Sense::hover());
                    ui.painter().rect_filled(rect, radius::SM, c);
                }
            });
        })
        .response;

    resp.clone()
        .on_hover_text(format!("Switch to the {} theme", preset.label));
    ui.interact(resp.rect, ui.id().with(preset.name), egui::Sense::click())
        .clicked()
}

/// Card wrapper with a section title, so every Settings group looks the same.
fn section(ui: &mut egui::Ui, theme: Theme, title: &str, contents: impl FnOnce(&mut egui::Ui)) {
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, title, None);
        ui.add_space(space::SM);
        contents(ui);
    });
}

/// Total bytes used by the data directory, for the diagnostics line.
pub fn data_dir_size(paths: &AppPaths) -> u64 {
    fn walk(dir: &std::path::Path, acc: &mut u64) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            match e.metadata() {
                Ok(m) if m.is_dir() => walk(&e.path(), acc),
                Ok(m) => *acc += m.len(),
                Err(_) => {}
            }
        }
    }
    let mut total = 0;
    walk(&paths.data_dir, &mut total);
    total
}

/// Human-readable total playtime, reused by the shell footer.
pub fn total_label(app: &App) -> String {
    format::duration(app.stats.total_secs)
}
