use egui::{Align, Layout, RichText};

use crate::format;
use crate::models::Game;
use crate::state::App;
use crate::theme::{radius, space, type_size, Theme};
use crate::ui::common;
use crate::ui::images;
use crate::ui::library;

/// What the detail view wants the shell to do once the frame finishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Close the detail view and return to the grid.
    Close,
    /// Open the editor for a game id.
    Edit(i64),
    /// The library changed, so drop caches and repaint.
    LibraryChanged,
}

/// Collected during a frame and consumed by the shell at the start of the next.
static ACTION: std::sync::Mutex<Option<Action>> = std::sync::Mutex::new(None);

/// Raise an intent for the shell.
pub fn request(action: Action) {
    if let Ok(mut slot) = ACTION.lock() {
        // A "changed" signal never masks a navigation request.
        if *slot != Some(Action::LibraryChanged) {
            *slot = Some(action);
        }
    }
}

/// Take the pending intent, if any.
pub fn take_action() -> Option<Action> {
    ACTION.lock().ok().and_then(|mut slot| slot.take())
}

/// Everything shown for one game: art, metadata, notes, and the session log.
pub struct DetailView {
    pub game_id: i64,
    pub notes: String,
    notes_dirty: bool,
    /// The manual log-entry form.
    log_open: bool,
    log_hours: f64,
    log_minutes: i64,
    log_note: String,
    log_category: String,
    log_date: chrono::NaiveDate,
    /// The session currently being edited inline, if any.
    editing_session: Option<i64>,
    edit_hours: f64,
    edit_minutes: i64,
    edit_note: String,
    edit_category: String,
    confirm_delete: bool,
    busy: bool,
}

impl DetailView {
    pub fn new(game_id: i64) -> Self {
        Self {
            game_id,
            notes: String::new(),
            notes_dirty: false,
            log_open: false,
            log_hours: 0.0,
            log_minutes: 0,
            log_note: String::new(),
            log_category: "Main story".into(),
            log_date: crate::state::today(),
            editing_session: None,
            edit_hours: 0.0,
            edit_minutes: 0,
            edit_note: String::new(),
            edit_category: "Main story".into(),
            confirm_delete: false,
            busy: false,
        }
    }

    /// Drop the "looking things up" state once a result has landed.
    pub fn clear_busy(&mut self) {
        self.busy = false;
    }
}

pub fn show(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut DetailView) {
    let Some((game, summary)) = app
        .games
        .iter()
        .find(|(g, _)| g.id == view.game_id)
        .cloned()
    else {
        common::empty_state(
            &theme,
            ui,
            "\u{1F5D1}",
            "That game is gone",
            "It was removed from the library while this page was open.",
            None,
        );
        request(Action::Close);
        return;
    };

    // Load notes into the buffer the first time we see this game.
    if !view.notes_dirty && view.notes != game.notes {
        view.notes = game.notes.clone();
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            header(ui, app, theme, view, &game);
            ui.add_space(space::LG);

            egui::Grid::new("detail_grid")
                .num_columns(2)
                .spacing([space::XL, space::LG])
                .show(ui, |ui| {
                    cover_column(ui, app, theme, &game);
                    right_column(ui, app, theme, view, &game, summary);
                });
            ui.add_space(space::XL);
        });
}

fn header(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut DetailView, game: &Game) {
    let playing = app.active.as_ref().is_some_and(|a| a.game_id == game.id);
    let label = if playing {
        "Stop session".to_string()
    } else if game.launch.is_configured() {
        "\u{25B6}  Play".to_string()
    } else {
        "\u{25B6}  Start timer".to_string()
    };

    // `right_to_left` places the first widget at the right edge, so the primary
    // action is added first and the back arrow ends up nearest the title.
    let mut close = false;
    let mut confirm_delete = false;
    let mut edit = false;
    let mut toggle_play = false;

    common::page_header(&theme, ui, &game.name, Some(&subtitle_of(game)), |ui| {
        let clicked = if playing {
            common::danger_button(&theme, ui, &label).clicked()
        } else {
            common::primary_button(&theme, ui, &label).clicked()
        };
        if clicked {
            toggle_play = true;
        }
        if common::secondary_button(&theme, ui, "Edit").clicked() {
            edit = true;
        }
        if common::icon_button(&theme, ui, "\u{2715}", "Delete this game", 13.0)
            .on_hover_text("Remove this game and all its sessions")
            .clicked()
        {
            confirm_delete = true;
        }
        if common::icon_button(&theme, ui, "\u{2190}", "Back to the library", 16.0)
            .on_hover_text("Back to the library  \u{b7}  Esc")
            .clicked()
        {
            close = true;
        }
    });

    if close {
        request(Action::Close);
    }
    if edit {
        request(Action::Edit(game.id));
    }
    if confirm_delete {
        view.confirm_delete = true;
    }
    if toggle_play {
        let outcome = if playing {
            app.stop_play()
        } else {
            let launch = game.launch.is_configured();
            app.start_play(game.id, "Main story", launch)
        };
        library::set_toast(app, outcome);
    }

    if view.confirm_delete {
        ui.horizontal(|ui| {
            ui.add_space(space::XL);
            ui.allocate_ui(egui::vec2(ui.available_width() - space::XL, 0.0), |ui| {
                egui::Frame::new()
                    .fill(theme.danger_soft)
                    .stroke(egui::Stroke::new(1.0_f32, theme.danger))
                    .corner_radius(radius::MD)
                    .inner_margin(egui::Margin::symmetric(space::LG as i8, space::MD as i8))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.label(
                                RichText::new("Delete this game and every logged session?")
                                    .size(type_size::BODY)
                                    .color(theme.text),
                            );
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                if common::danger_button(&theme, ui, "Delete")
                                    .on_hover_text("This cannot be undone")
                                    .clicked()
                                    && app.delete_game(game.id)
                                {
                                    view.confirm_delete = false;
                                    request(Action::Close);
                                }
                                if common::secondary_button(&theme, ui, "Cancel").clicked() {
                                    view.confirm_delete = false;
                                }
                            });
                        });
                    });
            });
        });
        ui.add_space(space::SM);
    }
}

/// `by Developer Â· 2024-03-01`, skipping anything the game does not have.
fn subtitle_of(game: &Game) -> String {
    let mut parts = Vec::new();
    if !game.developer.is_empty() {
        parts.push(format!("by {}", game.developer));
    }
    if let Some(d) = game.release_date.as_ref().filter(|d| !d.is_empty()) {
        parts.push(d.clone());
    }
    if parts.is_empty() {
        game.launch.label()
    } else {
        parts.join("  \u{b7}  ")
    }
}

fn cover_column(ui: &mut egui::Ui, app: &mut App, theme: Theme, game: &Game) {
    ui.vertical(|ui| {
        let width = 230.0;
        let height = width * 1.4;

        let drawn = game
            .cover_path
            .as_ref()
            .filter(|p| p.exists())
            .and_then(|path| images::cover_texture(ui.ctx(), path));

        let (rect, _) = ui.allocate_exact_size(egui::vec2(width, height), egui::Sense::hover());
        if let Some(tex) = drawn {
            images::paint_into(ui, tex, rect);
            ui.painter().rect_stroke(
                rect,
                radius::MD,
                egui::Stroke::new(1.0_f32, theme.border),
                egui::StrokeKind::Inside,
            );
        } else {
            ui.painter().rect_filled(rect, radius::MD, theme.surface);
            ui.painter().rect_stroke(
                rect,
                radius::MD,
                egui::Stroke::new(1.0_f32, theme.border),
                egui::StrokeKind::Inside,
            );
            let p = ui.painter();
            let galley = p.layout_no_wrap(
                "No cover".to_string(),
                egui::FontId::proportional(type_size::BODY),
                theme.text_faint,
            );
            p.galley(
                rect.center() - galley.size() / 2.0,
                galley,
                theme.text_faint,
            );
        }

        ui.add_space(space::SM);
        if common::secondary_button(&theme, ui, "Choose image\u{2026}").clicked() {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"])
                .pick_file()
            {
                if let Some(g) = app.game_by_id(game.id) {
                    let mut g = g.clone();
                    g.cover_path = Some(path);
                    app.update_game(&g);
                    request(Action::LibraryChanged);
                }
            }
        }

        if !game.platforms.is_empty() {
            ui.add_space(space::MD);
            ui.horizontal_wrapped(|ui| {
                for p in &game.platforms {
                    common::pill(&theme, ui, p, theme.surface_alt, theme.text_dim);
                }
            });
        }
        if !game.genres.is_empty() {
            ui.add_space(space::XS);
            ui.horizontal_wrapped(|ui| {
                for g in &game.genres {
                    common::pill(&theme, ui, g, theme.accent_soft, theme.accent);
                }
            });
        }
    });
}

fn right_column(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    view: &mut DetailView,
    game: &Game,
    summary: crate::models::PlaytimeSummary,
) {
    let played = App::effective_playtime(game, &summary);
    // --- playtime summary ---------------------------------------------
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, "Playtime", None);
        ui.add_space(space::MD);

        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing = egui::vec2(space::XL, 0.0);
            big_number(ui, theme, &format::duration(played), "played");
            big_number(ui, theme, &summary.session_count.to_string(), "sessions");
            big_number(
                ui,
                theme,
                &summary
                    .last_play
                    .map(crate::state::when)
                    .unwrap_or_else(|| "never".into()),
                "last played",
            );
        });

        if let Some(h) = game.hltb.as_ref().filter(|h| h.main > 0.0) {
            ui.add_space(space::MD);
            common::progress_bar(&theme, ui, played, h.main);
            ui.add_space(space::SM);
            ui.label(
                RichText::new(format!(
                    "{} of {} main story  \u{b7}  {} remaining",
                    format::duration(played),
                    format::hours(h.main),
                    format::duration(((h.main * 3600.0) as i64 - played).max(0))
                ))
                .size(type_size::SMALL)
                .color(theme.text_dim),
            );
        }

        if summary.session_count > 0 {
            ui.add_space(space::MD);
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(space::XL, 0.0);
                common::stat_row(
                    &theme,
                    ui,
                    "longest session",
                    &format::duration(summary.longest_secs),
                );
                common::stat_row(
                    &theme,
                    ui,
                    "average session",
                    &format::duration(played / summary.session_count as i64),
                );
                common::stat_row(
                    &theme,
                    ui,
                    "first played",
                    &summary
                        .first_play
                        .map(crate::state::when)
                        .unwrap_or_else(|| "unknown".into()),
                );
            });
        }

        ui.add_space(space::MD);
        ui.horizontal(|ui| {
            let has_override = game.manual_playtime_secs > 0;
            if has_override {
                common::pill(
                    &theme,
                    ui,
                    "manual total",
                    theme.warning_soft,
                    theme.warning,
                );
            }
            if has_override && common::accent_button(&theme, ui, "Use tracked time").clicked() {
                app.set_manual_total(game.id, 0);
            }
            if common::secondary_button(&theme, ui, "Set total time\u{2026}")
                .on_hover_text("Override the tracked total with a value you enter")
                .clicked()
            {
                view.log_open = !view.log_open;
            }
        });
    });

    ui.add_space(space::MD);

    // --- description ---------------------------------------------------
    if !game.description.is_empty() {
        common::card(&theme, ui, |ui| {
            ui.set_width(ui.available_width());
            common::section_header(&theme, ui, "About", None);
            ui.add_space(space::SM);
            ui.add(
                egui::Label::new(
                    RichText::new(&game.description)
                        .size(type_size::BODY)
                        .color(theme.text_dim),
                )
                .wrap(),
            );
        });
        ui.add_space(space::MD);
    }

    // --- notes ---------------------------------------------------------
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        ui.horizontal(|ui| {
            common::section_header(&theme, ui, "Notes", None);
            if view.notes_dirty {
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if common::primary_button(&theme, ui, "Save notes").clicked()
                        && app.save_notes(game.id, &view.notes)
                    {
                        view.notes_dirty = false;
                    }
                });
            }
        });
        ui.add_space(space::SM);
        let resp = ui.add(
            egui::TextEdit::multiline(&mut view.notes)
                .desired_rows(4)
                .desired_width(ui.available_width())
                .hint_text("Anything you want to remember about this game\u{2026}")
                .text_color(theme.text),
        );
        if resp.changed() {
            view.notes_dirty = true;
        }
        if view.notes_dirty {
            ui.add_space(space::SM);
            common::status_dot(&theme, ui, theme.warning, "unsaved changes");
        }
    });

    ui.add_space(space::MD);

    // --- HLTB ----------------------------------------------------------
    hltb_panel(ui, app, theme, view, game);

    ui.add_space(space::MD);

    // --- session log ---------------------------------------------------
    session_log(ui, app, theme, view, game);
}

fn big_number(ui: &mut egui::Ui, theme: Theme, value: &str, label: &str) {
    ui.vertical(|ui| {
        ui.label(
            RichText::new(value)
                .size(type_size::HEADING)
                .strong()
                .color(theme.text),
        );
        ui.label(
            RichText::new(label.to_uppercase())
                .size(type_size::MICRO)
                .color(theme.text_faint),
        );
    });
}

fn hltb_panel(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut DetailView, game: &Game) {
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, "How long to beat", None);
        ui.add_space(space::MD);

        match game.hltb.as_ref() {
            Some(h) => {
                egui::Grid::new("hltb_grid")
                    .num_columns(2)
                    .spacing([space::XL, space::XS])
                    .show(ui, |ui| {
                        hltb_row(ui, theme, "Main story", h.main);
                        hltb_row(ui, theme, "Main + side", h.main_plus);
                        hltb_row(ui, theme, "Completionist", h.completionist);
                        hltb_row(ui, theme, "Speedrun", h.speedrun);
                        ui.end_row();
                        if h.rating > 0 {
                            ui.label(
                                RichText::new("HLTB score")
                                    .size(type_size::SMALL)
                                    .color(theme.text_dim),
                            );
                            ui.label(
                                RichText::new(format!("{}/100", h.rating))
                                    .size(type_size::SMALL)
                                    .color(theme.text),
                            );
                            ui.end_row();
                        }
                    });

                ui.add_space(space::MD);
                ui.horizontal(|ui| {
                    if h.hltb_id != 0
                        && common::secondary_button(&theme, ui, "Open on HowLongToBeat").clicked()
                    {
                        let _ = opener::open(h.page_url());
                    }
                    if !view.busy && common::accent_button(&theme, ui, "Refresh").clicked() {
                        view.busy = true;
                        crate::ui::net::jobs::spawn_hltb_lookup(app, game.id, &game.name);
                    }
                });
            }
            None => {
                ui.label(
                    RichText::new("No completion estimate yet.")
                        .size(type_size::SMALL)
                        .color(theme.text_dim),
                );
                ui.add_space(space::MD);
                if app.settings.hltb_enabled {
                    if !view.busy
                        && common::primary_button(&theme, ui, "Look up on HowLongToBeat").clicked()
                    {
                        view.busy = true;
                        crate::ui::net::jobs::spawn_hltb_lookup(app, game.id, &game.name);
                    }
                } else {
                    ui.label(
                        RichText::new("Disabled in Settings.")
                            .size(type_size::CAPTION)
                            .color(theme.text_faint),
                    );
                }
            }
        }
    });
}

fn hltb_row(ui: &mut egui::Ui, theme: Theme, label: &str, value: f64) {
    ui.label(
        RichText::new(label)
            .size(type_size::SMALL)
            .color(theme.text_dim),
    );
    ui.label(
        RichText::new(format::hours(value))
            .size(type_size::SMALL)
            .strong()
            .color(theme.text),
    );
    ui.end_row();
}

fn session_log(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut DetailView, game: &Game) {
    let sessions = app.sessions_for(game.id);

    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());

        ui.horizontal(|ui| {
            common::section_header(
                &theme,
                ui,
                "Time log",
                Some(&format!("{} entries", sessions.len())),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if common::primary_button(
                    &theme,
                    ui,
                    if view.log_open {
                        "Close"
                    } else {
                        "+  Add entry"
                    },
                )
                .on_hover_text("Record time you played outside Orbit")
                .clicked()
                {
                    view.log_open = !view.log_open;
                }
            });
        });

        // Category totals.
        if !sessions.is_empty() {
            ui.horizontal_wrapped(|ui| {
                for (cat, secs) in crate::state::totals_by_category(&sessions).iter().take(6) {
                    ui.label(
                        RichText::new(format!("{cat}  {}", format::duration(*secs)))
                            .size(type_size::CAPTION)
                            .color(theme.text_dim),
                    );
                }
            });
            ui.add_space(space::MD);
        }

        if view.log_open {
            manual_entry_form(ui, app, theme, view, game);
            ui.add_space(space::MD);
        }

        if sessions.is_empty() {
            ui.label(
                RichText::new(
                    "No entries yet. Play the game to log time automatically, or add an entry by hand.",
                )
                .size(type_size::SMALL)
                .color(theme.text_faint),
            );
            return;
        }

        for s in &sessions {
            if view.editing_session == Some(s.id) {
                edit_row(ui, app, theme, view, s.clone());
            } else {
                log_row(ui, app, theme, view, game, s);
            }
            ui.add_space(space::XS);
        }
    });
}

/// A plain `YYYY-MM-DD` field with day-stepping buttons.
///
/// egui has no calendar widget, and hand-typing a date is the clearest way to
/// back-date a session, so we parse the text with chrono and keep the steppers
/// for the common "yesterday" case.
fn date_field(ui: &mut egui::Ui, theme: Theme, date: &mut chrono::NaiveDate) {
    let mut text = date.format("%Y-%m-%d").to_string();
    let resp = ui.add(
        egui::TextEdit::singleline(&mut text)
            .desired_width(110.0)
            .text_color(theme.text),
    );
    if resp.changed() {
        if let Ok(parsed) = chrono::NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d") {
            *date = parsed;
        }
    }
    if ui
        .small_button("\u{2039}")
        .on_hover_text("One day earlier")
        .clicked()
    {
        *date -= chrono::Duration::days(1);
    }
    if ui
        .small_button("\u{203A}")
        .on_hover_text("One day later")
        .clicked()
    {
        *date += chrono::Duration::days(1);
    }
}

/// Form for "17h completed, DLC 2h" style manual entries.
fn manual_entry_form(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    view: &mut DetailView,
    game: &Game,
) {
    egui::Frame::new()
        .fill(theme.surface_alt)
        .stroke(egui::Stroke::new(1.0_f32, theme.border))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::same(space::LG as i8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(
                RichText::new("Add a time entry")
                    .size(type_size::BODY)
                    .strong()
                    .color(theme.text),
            );
            ui.add_space(space::MD);

            common::setting_row(&theme, ui, "Date", None, |ui| {
                date_field(ui, theme, &mut view.log_date);
            });
            common::setting_row(&theme, ui, "Hours", None, |ui| {
                ui.add(
                    egui::DragValue::new(&mut view.log_hours)
                        .speed(0.25)
                        .range(0.0..=9999.0)
                        .suffix(" h"),
                );
            });
            common::setting_row(&theme, ui, "Minutes", None, |ui| {
                ui.add(
                    egui::DragValue::new(&mut view.log_minutes)
                        .speed(0.5)
                        .range(0..=1439)
                        .suffix(" m"),
                );
            });
            common::setting_row(&theme, ui, "Category", None, |ui| {
                egui::ComboBox::from_id_salt("log_category")
                    .selected_text(view.log_category.clone())
                    .show_ui(ui, |ui| {
                        for c in crate::state::default_categories() {
                            ui.selectable_value(
                                &mut view.log_category,
                                c.to_string(),
                                RichText::new(c).size(type_size::SMALL),
                            );
                        }
                    });
            });

            ui.add(
                egui::TextEdit::singleline(&mut view.log_note)
                    .hint_text("Note, e.g. \"finished the campaign\"")
                    .desired_width(ui.available_width())
                    .text_color(theme.text),
            );

            ui.add_space(space::MD);
            ui.horizontal(|ui| {
                let hours = view.log_hours;
                let minutes = view.log_minutes;
                let can_save = hours > 0.0 || minutes > 0;
                let save = if can_save {
                    common::primary_button(&theme, ui, "Save entry")
                } else {
                    egui::Frame::new()
                        .fill(theme.surface_alt)
                        .stroke(egui::Stroke::new(1.0_f32, theme.border))
                        .corner_radius(radius::SM)
                        .inner_margin(egui::Margin::symmetric(space::LG as i8, space::SM as i8))
                        .show(ui, |ui| {
                            ui.label(
                                RichText::new("Save entry")
                                    .size(type_size::BODY)
                                    .strong()
                                    .color(theme.text_faint),
                            );
                        })
                        .response
                        .on_disabled_hover_text("Enter some hours or minutes first")
                };
                if save.clicked() && can_save {
                    let entry = LogEntry {
                        game_id: game.id,
                        date: view.log_date,
                        hours,
                        minutes,
                        note: view.log_note.clone(),
                        category: view.log_category.clone(),
                    };
                    if app.add_manual_entry(entry) {
                        view.log_hours = 0.0;
                        view.log_minutes = 0;
                        view.log_note.clear();
                        view.log_open = false;
                        request(Action::LibraryChanged);
                    }
                }
                if common::secondary_button(&theme, ui, "Cancel").clicked() {
                    view.log_open = false;
                }
            });
        });
}

/// A manual time entry the user typed in.
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub game_id: i64,
    pub date: chrono::NaiveDate,
    pub hours: f64,
    pub minutes: i64,
    pub note: String,
    pub category: String,
}

fn log_row(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    view: &mut DetailView,
    game: &Game,
    s: &crate::models::PlaySession,
) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(
                RichText::new(crate::state::when(s.started_at))
                    .size(type_size::SMALL)
                    .color(theme.text),
            );
            ui.horizontal(|ui| {
                common::pill(
                    &theme,
                    ui,
                    if s.category.is_empty() {
                        "Uncategorised"
                    } else {
                        &s.category
                    },
                    theme.accent_soft,
                    theme.accent,
                );
                if s.manual {
                    ui.label(
                        RichText::new("added by hand")
                            .size(type_size::MICRO)
                            .color(theme.text_faint),
                    );
                }
                if let Some(by) = s.ended_by.as_deref() {
                    if by != "manual" {
                        ui.label(
                            RichText::new(by)
                                .size(type_size::MICRO)
                                .color(theme.text_faint),
                        );
                    }
                }
            });
        });

        if !s.note.is_empty() {
            ui.label(
                RichText::new(&s.note)
                    .size(type_size::SMALL)
                    .color(theme.text_dim),
            );
        }

        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if common::icon_button(&theme, ui, "\u{2715}", "Delete this entry", 12.0).clicked() {
                app.delete_session(s.id);
            }
            if common::icon_button(&theme, ui, "\u{270E}", "Edit this entry", 12.0).clicked() {
                view.editing_session = Some(s.id);
                view.edit_hours = (s.duration_secs / 3600) as f64;
                view.edit_minutes = (s.duration_secs % 3600) / 60;
                view.edit_note = s.note.clone();
                view.edit_category = if s.category.is_empty() {
                    "Main story".into()
                } else {
                    s.category.clone()
                };
            }
            ui.label(
                RichText::new(format::duration(s.duration_secs))
                    .size(type_size::TITLE)
                    .strong()
                    .monospace()
                    .color(theme.accent),
            );
        });
    });
    let _ = game;
}

fn edit_row(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    view: &mut DetailView,
    s: crate::models::PlaySession,
) {
    egui::Frame::new()
        .fill(theme.surface_alt)
        .stroke(egui::Stroke::new(1.0_f32, theme.border))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::same(space::MD as i8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(crate::state::when(s.started_at))
                        .size(type_size::CAPTION)
                        .color(theme.text_dim),
                );
                ui.add(
                    egui::DragValue::new(&mut view.edit_hours)
                        .speed(0.25)
                        .range(0.0..=9999.0)
                        .suffix(" h"),
                );
                ui.add(
                    egui::DragValue::new(&mut view.edit_minutes)
                        .speed(0.5)
                        .range(0..=1439)
                        .suffix(" m"),
                );
            });

            ui.horizontal(|ui| {
                egui::ComboBox::from_id_salt(format!("edit_cat_{}", s.id))
                    .selected_text(view.edit_category.clone())
                    .show_ui(ui, |ui| {
                        for c in crate::state::default_categories() {
                            ui.selectable_value(
                                &mut view.edit_category,
                                c.to_string(),
                                RichText::new(c).size(type_size::SMALL),
                            );
                        }
                    });
                ui.add(
                    egui::TextEdit::singleline(&mut view.edit_note)
                        .hint_text("Note")
                        .desired_width(ui.available_width())
                        .text_color(theme.text),
                );
            });

            ui.add_space(space::SM);
            ui.horizontal(|ui| {
                if common::primary_button(&theme, ui, "Save").clicked() {
                    let mut updated = s.clone();
                    updated.duration_secs =
                        (view.edit_hours * 3600.0).round() as i64 + view.edit_minutes * 60;
                    updated.note = view.edit_note.clone();
                    updated.category = view.edit_category.clone();
                    if app.edit_session(updated) {
                        view.editing_session = None;
                    }
                }
                if common::secondary_button(&theme, ui, "Cancel").clicked() {
                    view.editing_session = None;
                }
            });
        });
}
