use egui::{Align, Layout, RichText};

use crate::config::LibraryView;
use crate::format;
use crate::models::{Game, PlaytimeSummary};
use crate::state::{App, PlayOutcome};
use crate::theme::{radius, space, type_size, Theme};
use crate::ui::common;
use crate::ui::images;

/// Search, sort, and view controls above the library.
pub fn top_bar(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let title = match app.genre_filter.as_deref() {
        Some(g) => g.to_string(),
        None => "Library".to_string(),
    };
    let shown = app.visible_games().len();
    let subtitle = match app.genre_filter.as_deref() {
        Some(g) => format!("{shown} in {g}"),
        None if shown == app.games.len() => {
            format!("{} games", app.games.len())
        }
        None => format!("{shown} of {} games", app.games.len()),
    };

    common::page_header(&theme, ui, &title, Some(&subtitle), |ui| {
        // `right_to_left` fills from the right edge leftward, so the first
        // widget added stays furthest right and the primary action goes first.
        if common::primary_button(&theme, ui, "+  Add game").clicked() {
            request_open_editor();
        }
        view_toggle(ui, app, theme);
        sort_selector(ui, app, theme);
        search_field(ui, app, theme);
    });

    // A filter that is hiding results should be obvious and easy to undo.
    if app.genre_filter.is_some() || !app.search_query.is_empty() {
        ui.horizontal(|ui| {
            ui.add_space(space::XL);
            let mut bits = Vec::new();
            if !app.search_query.is_empty() {
                bits.push(format!("search \u{201C}{}\u{201D}", app.search_query));
            }
            if let Some(g) = app.genre_filter.as_deref() {
                bits.push(format!("genre {g}"));
            }
            ui.label(
                RichText::new(format!("Filtered by {}", bits.join("  \u{b7}  ")))
                    .size(type_size::CAPTION)
                    .color(theme.text_faint),
            );
            if common::accent_button(&theme, ui, "Clear filters").clicked() {
                app.search_query.clear();
                app.genre_filter = None;
            }
        });
        ui.add_space(space::SM);
    }
}

fn search_field(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let mut text = app.search_query.clone();
    common::search_field(&theme, ui, &mut text, "Search library\u{2026}", 200.0);
    if text != app.search_query {
        app.search_query = text;
    }
}

/// Switch between poster tiles and the compact list.
fn view_toggle(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let picked = common::segmented(
        &theme,
        ui,
        "view",
        &[
            (LibraryView::Catalog, LibraryView::Catalog.label()),
            (LibraryView::List, LibraryView::List.label()),
        ],
        app.settings.library_view,
    );
    if let Some(next) = picked {
        if next != app.settings.library_view {
            app.settings.library_view = next;
            app.mark_settings_dirty();
        }
    }
}

fn sort_selector(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    egui::ComboBox::from_id_salt("orbit_sort")
        .selected_text(
            RichText::new(app.sort.label())
                .size(type_size::SMALL)
                .color(theme.text),
        )
        .width(148.0)
        .show_ui(ui, |ui| {
            for option in crate::models::LibrarySort::ALL {
                ui.selectable_value(
                    &mut app.sort,
                    option,
                    RichText::new(option.label())
                        .size(type_size::SMALL)
                        .color(theme.text),
                );
            }
        });
}

/// Draw the library in whichever view is configured. `needs_repaint` is set
/// when an action changes state.
pub fn grid(ui: &mut egui::Ui, app: &mut App, theme: Theme, needs_repaint: &mut bool) {
    match app.settings.library_view {
        LibraryView::Catalog => catalog(ui, app, theme, needs_repaint),
        LibraryView::List => list(ui, app, theme, needs_repaint),
    }
}

/// Poster tiles.
fn catalog(ui: &mut egui::Ui, app: &mut App, theme: Theme, needs_repaint: &mut bool) {
    let tile = app.settings.grid_tile_size.clamp(110.0, 260.0) as f32;
    // Draw from a snapshot so `app` stays freely borrowable inside the
    // closures below.
    let games: Vec<(Game, PlaytimeSummary)> = app.visible_games().into_iter().cloned().collect();

    if games.is_empty() {
        empty_state(ui, app, theme);
        return;
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.add_space(space::SM);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(space::MD, space::MD);
                for (game, summary) in &games {
                    let id = game.id;
                    ui.allocate_ui(egui::vec2(tile + 8.0, tile * 1.62 + 8.0), |ui| {
                        tile_ui(ui, app, theme, id, game, summary, tile, needs_repaint);
                    });
                }
            });
        });
}

fn empty_state(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    if app.games.is_empty() {
        common::empty_state(
            &theme,
            ui,
            "\u{1F6F8}",
            "Your library is empty",
            "Add a game to track its playtime, notes, and how long it takes to finish.",
            Some("+  Add your first game"),
        );
    } else {
        common::empty_state(
            &theme,
            ui,
            "\u{1F50D}",
            "Nothing matches those filters",
            "Try a different search, or clear the filters to see your whole library.",
            None,
        );
        ui.vertical_centered(|ui| {
            if common::secondary_button(&theme, ui, "Clear search and filters").clicked() {
                app.search_query.clear();
                app.genre_filter = None;
            }
        });
    }
}

#[allow(clippy::too_many_arguments)]
fn tile_ui(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    id: i64,
    game: &Game,
    summary: &PlaytimeSummary,
    tile: f32,
    needs_repaint: &mut bool,
) {
    let playing = app.active.as_ref().is_some_and(|a| a.game_id == id);

    let cover_size = egui::vec2(tile, tile * 1.30);
    let (cover_rect, cover_resp) = ui.allocate_exact_size(cover_size, egui::Sense::click());

    // Cover art when a path is set and the file still exists.
    let mut drew_cover = false;
    if app.settings.show_cover_art {
        if let Some(path) = game.cover_path.as_ref().filter(|p| p.exists()) {
            if let Some(tex) = images::cover_texture(ui.ctx(), path) {
                // Paint into the rect we already reserved so the layout does
                // not advance twice.
                images::paint_into(ui, tex, cover_rect);
                ui.painter().rect_stroke(
                    cover_rect,
                    radius::MD,
                    egui::Stroke::new(1.0_f32, theme.border),
                    egui::StrokeKind::Inside,
                );
                drew_cover = true;
            }
        }
    }

    if !drew_cover {
        // Placeholder: initials on a subtle plate.
        let p = ui.painter();
        p.rect_filled(cover_rect, radius::MD, theme.surface_alt);
        let initials = initials_of(&game.name);
        let galley = p.layout_no_wrap(
            initials,
            egui::FontId::proportional(tile * 0.26),
            theme.text_faint,
        );
        p.galley(
            cover_rect.center() - galley.size() / 2.0,
            galley,
            theme.text_faint,
        );
        ui.painter().rect_stroke(
            cover_rect,
            radius::MD,
            egui::Stroke::new(1.0_f32, theme.border),
            egui::StrokeKind::Inside,
        );
    }

    if playing {
        ui.painter().rect_stroke(
            cover_rect,
            radius::MD,
            egui::Stroke::new(2.5_f32, theme.accent),
            egui::StrokeKind::Middle,
        );
    }

    // Hover: a scrim with a hint, so it is obvious the tile opens something.
    if cover_resp.hovered() && !playing {
        ui.painter()
            .rect_filled(cover_rect, radius::MD, theme.scrim());
        let hint = common::label_chip(&theme, ui, "Open details");
        ui.painter()
            .galley(cover_rect.center() - hint.size() / 2.0, hint, theme.text);
    }

    if cover_resp.clicked() {
        request_open_game(id);
    }
    if cover_resp.double_clicked() {
        let outcome = app.start_play(id, default_category(), true);
        set_toast(app, outcome);
        *needs_repaint = true;
    }
    cover_resp.on_hover_text(format!(
        "{}\n\nClick for details \u{b7} Double-click to play",
        game.launch.label()
    ));

    // Name and a play control that is always visible, so starting a game never
    // depends on remembering a keyboard shortcut.
    let played = App::effective_playtime(game, summary);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(space::SM, 0.0);
        ui.add(
            egui::Label::new(
                RichText::new(game.name.clone())
                    .size(type_size::BODY)
                    .strong()
                    .color(theme.text),
            )
            .truncate(),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if playing {
                if common::icon_button(&theme, ui, "\u{25A0}", "Stop the session", 11.0).clicked() {
                    let outcome = app.stop_play();
                    set_toast(app, outcome);
                    *needs_repaint = true;
                }
            } else if common::icon_button(&theme, ui, "\u{25B6}", "Play", 11.0).clicked() {
                let outcome = app.start_play(id, default_category(), true);
                set_toast(app, outcome);
                *needs_repaint = true;
            }
        });
    });

    // Playtime, plus the completion estimate when there is one.
    let (played_text, played_color) = if played > 0 {
        (format::duration_short(played), theme.text_dim)
    } else {
        ("not played".to_string(), theme.text_faint)
    };
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(played_text)
                .size(type_size::CAPTION)
                .color(played_color),
        );
        if let Some(h) = game.hltb.filter(|h| h.main > 0.0) {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(
                    RichText::new(format!("of {}", format::hours(h.main)))
                        .size(type_size::MICRO)
                        .color(theme.text_faint),
                );
            });
        }
    });

    if game.hltb.is_some_and(|h| h.main > 0.0) {
        ui.add_space(2.0);
        common::progress_bar(&theme, ui, played, game.hltb.map(|h| h.main).unwrap_or(0.0));
    }
}

/// One game per row: cover thumbnail, name, developer, playtime, last played.
///
/// Denser than the catalog, and it has room for the columns that only matter
/// when you are checking a library rather than browsing it.
pub fn list(ui: &mut egui::Ui, app: &mut App, theme: Theme, needs_repaint: &mut bool) {
    let games: Vec<(Game, PlaytimeSummary)> = app.visible_games().into_iter().cloned().collect();
    if games.is_empty() {
        empty_state(ui, app, theme);
        return;
    }

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.add_space(space::SM);
            list_header(ui, theme);
            ui.add_space(space::XS);
            for (game, summary) in &games {
                let id = game.id;
                ui.push_id(id, |ui| {
                    if list_row(ui, app, theme, game, summary) {
                        *needs_repaint = true;
                    }
                });
                ui.add_space(space::XS);
            }
        });
}

/// Column labels, aligned with `list_row`.
fn list_header(ui: &mut egui::Ui, theme: Theme) {
    egui::Frame::new()
        .fill(theme.surface)
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::symmetric(space::SM as i8, space::SM as i8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.allocate_space(egui::vec2(44.0, 0.0)); // thumbnail
                ui.add_space(space::SM);
                common::cell(ui, "Game", 190.0, type_size::MICRO, theme.text_faint);
                ui.add_space(space::MD);
                common::cell(ui, "Developer", 150.0, type_size::MICRO, theme.text_faint);
                ui.add_space(space::MD);
                common::cell_right(ui, "Played", 90.0, type_size::MICRO, theme.text_faint);
                ui.add_space(space::SM);
                common::cell_right(ui, "Estimate", 80.0, type_size::MICRO, theme.text_faint);
                ui.add_space(space::SM);
                common::cell_right(ui, "Last played", 110.0, type_size::MICRO, theme.text_faint);
                ui.allocate_space(egui::vec2(96.0, 0.0)); // play button
            });
        });
}

/// Draw one row. Returns true when the library changed.
fn list_row(
    ui: &mut egui::Ui,
    app: &mut App,
    theme: Theme,
    game: &Game,
    summary: &PlaytimeSummary,
) -> bool {
    let mut changed = false;
    let playing = app.active.as_ref().is_some_and(|a| a.game_id == game.id);

    let inner = egui::Frame::new()
        .fill(if playing {
            theme.playing_tint
        } else {
            theme.surface
        })
        .stroke(egui::Stroke::new(1.0_f32, theme.border))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::symmetric(space::SM as i8, space::SM as i8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                let thumb = egui::vec2(36.0, 44.0);
                let (thumb_rect, thumb_resp) = ui.allocate_exact_size(thumb, egui::Sense::click());

                let mut drew = false;
                if app.settings.show_cover_art {
                    if let Some(path) = game.cover_path.as_ref().filter(|p| p.exists()) {
                        if let Some(tex) = images::cover_texture(ui.ctx(), path) {
                            images::paint_into(ui, tex, thumb_rect);
                            drew = true;
                        }
                    }
                }
                if !drew {
                    ui.painter()
                        .rect_filled(thumb_rect, radius::MD, theme.surface_alt);
                    let galley = ui.painter().layout_no_wrap(
                        initials_of(&game.name),
                        egui::FontId::proportional(13.0),
                        theme.text_faint,
                    );
                    ui.painter().galley(
                        thumb_rect.center() - galley.size() / 2.0,
                        galley,
                        theme.text_faint,
                    );
                }
                if playing {
                    ui.painter().rect_stroke(
                        thumb_rect,
                        radius::MD,
                        egui::Stroke::new(2.0_f32, theme.accent),
                        egui::StrokeKind::Middle,
                    );
                }

                ui.add_space(space::SM);
                ui.vertical(|ui| {
                    let name = ui.add(
                        egui::Label::new(
                            RichText::new(game.name.clone())
                                .size(type_size::BODY)
                                .strong()
                                .color(theme.text),
                        )
                        .truncate()
                        .sense(egui::Sense::click()),
                    );
                    if name.clicked() {
                        request_open_game(game.id);
                    }
                    name.on_hover_text(format!("{}\n\nClick for details", game.launch.label()));
                    let sub = game
                        .developer
                        .is_empty()
                        .then(|| game.platforms.join(" \u{b7} "))
                        .filter(|s| !s.is_empty());
                    if let Some(sub) = sub {
                        ui.label(
                            RichText::new(sub)
                                .size(type_size::MICRO)
                                .color(theme.text_faint),
                        );
                    }
                });
                ui.add_space(space::MD);
                let dev = if game.developer.is_empty() {
                    "\u{2014}".to_string()
                } else {
                    game.developer.clone()
                };
                common::cell(ui, &dev, 150.0, type_size::SMALL, theme.text_dim);
                ui.add_space(space::MD);

                let played = App::effective_playtime(game, summary);
                let time = if played > 0 {
                    format::duration_short(played)
                } else {
                    "\u{2014}".into()
                };
                common::cell_right(ui, &time, 90.0, type_size::SMALL, theme.text);
                ui.add_space(space::SM);
                let hltb = game
                    .hltb
                    .filter(|h| h.primary() > 0.0)
                    .map(|h| format::hours(h.primary()))
                    .unwrap_or_else(|| "\u{2014}".into());
                common::cell_right(ui, &hltb, 80.0, type_size::SMALL, theme.text_faint);
                ui.add_space(space::SM);
                let last = match summary.last_play {
                    Some(ts) => crate::state::when(ts),
                    None => "\u{2014}".into(),
                };
                common::cell_right(ui, &last, 110.0, type_size::SMALL, theme.text_dim);
                ui.allocate_space(egui::vec2(96.0, 0.0));

                if playing {
                    if common::danger_button(&theme, ui, "Stop").clicked() {
                        let outcome = app.stop_play();
                        set_toast(app, outcome);
                        changed = true;
                    }
                } else if common::secondary_button(&theme, ui, "Play").clicked() {
                    let outcome = app.start_play(game.id, default_category(), true);
                    set_toast(app, outcome);
                    changed = true;
                }

                if thumb_resp.clicked() {
                    request_open_game(game.id);
                }
                thumb_resp.on_hover_text(format!("{}\n\nClick for details", game.launch.label()));
            });
        });
    // A hairline accent ring on hover, so a row reads as clickable.
    if !playing && ui.rect_contains_pointer(inner.response.rect) {
        ui.painter().rect_stroke(
            inner.response.rect,
            radius::MD,
            egui::Stroke::new(1.0_f32, theme.focus_ring),
            egui::StrokeKind::Inside,
        );
    }
    changed
}

/// Sessions page: every log entry across all games, newest first.
pub fn sessions_page(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let sessions = app.lib.list_sessions(None).unwrap_or_default();

    common::section_header(
        &theme,
        ui,
        "All sessions",
        Some(&format!("{} entries", sessions.len())),
    );
    ui.add_space(space::SM);

    if sessions.is_empty() {
        common::empty_state(
            &theme,
            ui,
            "\u{23F1}",
            "No sessions yet",
            "Every time you play, the session and its duration are logged here.",
            None,
        );
        return;
    }

    let names: std::collections::HashMap<i64, String> = app
        .games
        .iter()
        .map(|(g, _)| (g.id, g.name.clone()))
        .collect();

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for s in &sessions {
                let name = names.get(&s.game_id).cloned().unwrap_or_default();
                common::card(&theme, ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(&name)
                                    .size(type_size::BODY)
                                    .strong()
                                    .color(theme.text),
                            );
                            ui.label(
                                RichText::new(crate::state::when(s.started_at))
                                    .size(type_size::CAPTION)
                                    .color(theme.text_faint),
                            );
                        });
                        common::pill(
                            &theme,
                            ui,
                            if s.category.is_empty() {
                                "Uncategorised"
                            } else {
                                &s.category
                            },
                            theme.surface_alt,
                            theme.text_dim,
                        );
                        if s.manual {
                            ui.label(
                                RichText::new("manual")
                                    .size(type_size::MICRO)
                                    .color(theme.text_faint),
                            );
                        }
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            ui.label(
                                RichText::new(format::duration(s.duration_secs))
                                    .size(type_size::TITLE)
                                    .strong()
                                    .monospace()
                                    .color(theme.text),
                            );
                        });
                    });
                });
                ui.add_space(space::SM);
            }
        });
}

// ---- view intents -------------------------------------------------------
// Child views cannot mutate the shell's fields, so they record what the user
// asked for here and the shell acts on it at the start of the next frame.

/// Queue "open the add/edit game form" (0 means a new game).
pub fn request_open_editor() {
    OPEN_EDITOR.store(true, std::sync::atomic::Ordering::Relaxed);
}

pub fn take_open_editor() -> Option<()> {
    OPEN_EDITOR
        .swap(false, std::sync::atomic::Ordering::Relaxed)
        .then_some(())
}

/// Queue "open this game's detail view".
pub fn request_open_game(game_id: i64) {
    let _ = OPEN_GAME_ID.compare_exchange(
        NO_GAME,
        game_id,
        std::sync::atomic::Ordering::Relaxed,
        std::sync::atomic::Ordering::Relaxed,
    );
}

pub fn take_open_game() -> Option<i64> {
    let prev = OPEN_GAME_ID.swap(NO_GAME, std::sync::atomic::Ordering::Relaxed);
    (prev != NO_GAME).then_some(prev)
}

static OPEN_EDITOR: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static OPEN_GAME_ID: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(-1);
const NO_GAME: i64 = -1;

/// Statistics page: totals, recent activity, HLTB comparison.
pub fn stats_page(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.add_space(space::SM);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(space::MD, space::MD);
                common::stat_tile(
                    &theme,
                    ui,
                    "Games in library",
                    &app.stats.total_games.to_string(),
                );
                common::stat_tile(
                    &theme,
                    ui,
                    "Games played",
                    &app.stats.tracked_games.to_string(),
                );
                common::stat_tile(
                    &theme,
                    ui,
                    "Total playtime",
                    &format::duration(app.stats.total_secs),
                );
                common::stat_tile(
                    &theme,
                    ui,
                    "Sessions logged",
                    &app.stats.sessions.to_string(),
                );
                common::stat_tile(
                    &theme,
                    ui,
                    "Last 7 days",
                    &app.stats.games_played_last_7_days.to_string(),
                );
                common::stat_tile(
                    &theme,
                    ui,
                    "Last 30 days",
                    &app.stats.games_played_last_30_days.to_string(),
                );
            });

            ui.add_space(space::XL);
            common::section_rule(&theme, ui, "Most played");
            most_played(ui, app, theme);

            ui.add_space(space::XL);
            common::section_rule(&theme, ui, "Longest sessions");
            longest_sessions(ui, app, theme);

            ui.add_space(space::XL);
            common::section_rule(&theme, ui, "Completion estimates");
            hltb_comparison(ui, app, theme);
        });
}

fn most_played(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let mut rows: Vec<(String, i64)> = app
        .games
        .iter()
        .map(|(g, s)| (g.name.clone(), App::effective_playtime(g, s)))
        .filter(|(_, t)| *t > 0)
        .collect();
    rows.sort_by_key(|(_, t)| std::cmp::Reverse(*t));
    rows.truncate(10);

    if rows.is_empty() {
        ui.label(
            RichText::new("Nothing tracked yet. Start a game to fill this in.")
                .size(type_size::SMALL)
                .color(theme.text_faint),
        );
        return;
    }
    let max = rows[0].1.max(1);
    for (name, secs) in rows {
        ui.horizontal(|ui| {
            ui.add(
                egui::Label::new(RichText::new(name).size(type_size::SMALL).color(theme.text))
                    .truncate(),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(
                    RichText::new(format::duration(secs))
                        .size(type_size::SMALL)
                        .strong()
                        .color(theme.text_dim),
                );
            });
        });
        ui.add_space(2.0);
        let (rect, _) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), 6.0), egui::Sense::hover());
        ui.painter()
            .rect_filled(rect, radius::PILL, theme.surface_alt);
        let frac = secs as f32 / max as f32;
        ui.painter().rect_filled(
            egui::Rect::from_min_size(rect.min, egui::vec2(rect.width() * frac, rect.height())),
            radius::PILL,
            theme.accent,
        );
        ui.add_space(space::SM);
    }
}

fn longest_sessions(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let mut sessions: Vec<_> = app.lib.list_sessions(None).unwrap_or_default();
    sessions.retain(|s| s.duration_secs > 0);
    sessions.sort_by_key(|s| std::cmp::Reverse(s.duration_secs));
    sessions.truncate(10);

    let names: std::collections::HashMap<i64, String> = app
        .games
        .iter()
        .map(|(g, _)| (g.id, g.name.clone()))
        .collect();

    if sessions.is_empty() {
        ui.label(
            RichText::new("No sessions yet.")
                .size(type_size::SMALL)
                .color(theme.text_faint),
        );
        return;
    }
    for s in sessions {
        let name = names
            .get(&s.game_id)
            .cloned()
            .unwrap_or_else(|| "\u{2014}".into());
        common::card(&theme, ui, |ui| {
            ui.horizontal(|ui| {
                ui.add(
                    egui::Label::new(RichText::new(name).size(type_size::BODY).color(theme.text))
                        .truncate(),
                );
                ui.label(
                    RichText::new(crate::state::when(s.started_at))
                        .size(type_size::CAPTION)
                        .color(theme.text_faint),
                );
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(
                        RichText::new(format::duration(s.duration_secs))
                            .size(type_size::TITLE)
                            .strong()
                            .monospace()
                            .color(theme.accent),
                    );
                });
            });
        });
        ui.add_space(space::SM);
    }
}

fn hltb_comparison(ui: &mut egui::Ui, app: &mut App, theme: Theme) {
    let mut rows: Vec<(String, f64, i64)> = app
        .games
        .iter()
        .filter_map(|(g, s)| {
            let h = g.hltb?;
            let estimate = h.primary();
            if estimate <= 0.0 {
                return None;
            }
            Some((g.name.clone(), estimate, App::effective_playtime(g, s)))
        })
        .collect();
    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    rows.truncate(12);

    if rows.is_empty() {
        ui.label(
            RichText::new(
                "No HowLongToBeat data yet. Open a game and use Look up to fetch its estimate.",
            )
            .size(type_size::SMALL)
            .color(theme.text_faint),
        );
        return;
    }

    for (name, estimate, played) in rows {
        ui.horizontal(|ui| {
            ui.add(
                egui::Label::new(RichText::new(name).size(type_size::SMALL).color(theme.text))
                    .truncate(),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.label(
                    RichText::new(format::duration(played))
                        .size(type_size::SMALL)
                        .color(theme.text_dim),
                );
                ui.label(
                    RichText::new(format!("of {}", format::hours(estimate)))
                        .size(type_size::CAPTION)
                        .color(theme.text_faint),
                );
            });
        });
        ui.add_space(2.0);
        common::progress_bar(&theme, ui, played, estimate);
        ui.add_space(space::MD);
    }
}

/// First letters of the first two words, for cover placeholders.
fn initials_of(name: &str) -> String {
    let words: Vec<&str> = name
        .split_whitespace()
        .filter(|w| !matches!(*w, "the" | "a" | "an" | "of"))
        .take(2)
        .collect();
    match words.len() {
        0 => name.chars().take(2).collect::<String>().to_uppercase(),
        1 => words[0].chars().take(2).collect::<String>().to_uppercase(),
        _ => words
            .iter()
            .filter_map(|w| w.chars().next())
            .collect::<String>()
            .to_uppercase(),
    }
}

fn default_category() -> &'static str {
    "Main story"
}

/// Queue an outcome for the toast layer.
pub fn set_toast(app: &mut App, outcome: PlayOutcome) {
    app.last_outcome = Some(outcome);
}

/// Take a play outcome queued for the toast layer.
pub fn take_outcome(app: &mut App) -> Option<PlayOutcome> {
    app.last_outcome.take()
}
