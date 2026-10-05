use egui::{Align, Color32, FontId, RichText, Sense, Stroke};

use crate::format;
use crate::state::PlayOutcome;
use crate::tailwind::{shadow as tw_shadow, with_alpha};
use crate::theme::{radius, space, type_size, Theme};

/// A dismissible banner pinned under the top bar.
pub struct Toast {
    pub text: String,
    pub kind: ToastKind,
    pub ttl: std::time::Instant,
}

pub enum ToastKind {
    Info,
    Success,
    Error,
}

impl ToastKind {
    fn colors(&self, theme: &Theme) -> (Color32, Color32) {
        match self {
            ToastKind::Info => (theme.accent, theme.accent_soft),
            ToastKind::Success => (theme.success, theme.success_soft),
            ToastKind::Error => (theme.danger, theme.danger_soft),
        }
    }

    fn icon(&self) -> &'static str {
        match self {
            ToastKind::Info => "\u{2139}",    // info
            ToastKind::Success => "\u{2714}", // check
            ToastKind::Error => "\u{2716}",   // cross
        }
    }
}

pub const TOAST_TTL: std::time::Duration = std::time::Duration::from_secs(5);

/// Full-bleed page header: title on the left, controls on the right.
///
/// Pinned to the top of the central panel so the page never scrolls its own
/// title out of view.
pub fn page_header(
    theme: &Theme,
    ui: &mut egui::Ui,
    title: &str,
    subtitle: Option<&str>,
    trailing: impl FnOnce(&mut egui::Ui),
) -> egui::Response {
    let inner = egui::Frame::new()
        .fill(theme.bg)
        .inner_margin(egui::Margin::symmetric(space::XL as i8, space::MD as i8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.vertical(|ui| {
                    ui.label(
                        RichText::new(title)
                            .size(type_size::HEADING)
                            .strong()
                            .color(theme.text),
                    );
                    if let Some(sub) = subtitle {
                        ui.label(
                            RichText::new(sub)
                                .size(type_size::CAPTION)
                                .color(theme.text_faint),
                        );
                    }
                });
                ui.with_layout(egui::Layout::right_to_left(Align::Center), trailing);
            });
        });
    ui.painter().hline(
        inner.response.rect.x_range(),
        inner.response.rect.max.y,
        Stroke::new(1.0_f32, theme.border),
    );
    inner.response
}

/// Rounded surface panel. The single container primitive for the whole UI, so
/// every panel has the same radius, padding, and border weight.
pub fn card<R>(
    theme: &Theme,
    ui: &mut egui::Ui,
    add_contents: impl FnOnce(&mut egui::Ui) -> R,
) -> egui::InnerResponse<R> {
    egui::Frame::new()
        .fill(theme.surface)
        .stroke(Stroke::new(1.0_f32, theme.border))
        .shadow(tw_shadow::egui(tw_shadow::SM, theme.shadow))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::same(space::LG as i8))
        .show(ui, add_contents)
}

/// A card that the user can click, with a hover lift and a selected accent.
pub fn clickable_card<R>(
    theme: &Theme,
    ui: &mut egui::Ui,
    selected: bool,
    add_contents: impl FnOnce(&mut egui::Ui) -> R,
) -> (egui::InnerResponse<R>, egui::Response) {
    let fill = if selected {
        theme.selected_fill()
    } else {
        theme.surface
    };
    let stroke = if selected {
        Stroke::new(1.5_f32, theme.accent)
    } else {
        Stroke::new(1.0_f32, theme.border)
    };
    let inner = egui::Frame::new()
        .fill(fill)
        .stroke(stroke)
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::same(space::LG as i8))
        .show(ui, add_contents);
    // A fresh id per card, so several of them in a list do not share one
    // interaction and all light up together.
    let id = ui.next_auto_id();
    let response = ui.interact(inner.response.rect, id, Sense::click());
    if response.hovered() && !selected {
        ui.painter().rect_stroke(
            inner.response.rect,
            radius::MD,
            Stroke::new(1.0_f32, theme.accent),
            egui::StrokeKind::Inside,
        );
    }
    (inner, response)
}

/// Uppercase micro-label that opens a group of fields.
pub fn section_header(theme: &Theme, ui: &mut egui::Ui, title: &str, trailing: Option<&str>) {
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(title.to_uppercase())
                .size(type_size::MICRO)
                .strong()
                .color(theme.text_faint),
        );
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            if let Some(t) = trailing {
                ui.label(
                    RichText::new(t)
                        .size(type_size::MICRO)
                        .color(theme.text_faint),
                );
            }
        });
    });
    ui.add_space(space::XS);
}

/// Same as `section_header` but with a rule filling the rest of the line.
pub fn section_rule(theme: &Theme, ui: &mut egui::Ui, title: &str) {
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(title.to_uppercase())
                .size(type_size::MICRO)
                .strong()
                .color(theme.text_faint),
        );
        let (rect, _) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), 0.0), Sense::hover());
        ui.painter().hline(
            rect.x_range(),
            rect.center().y,
            Stroke::new(1.0_f32, theme.border),
        );
    });
    ui.add_space(space::SM);
}

/// Label/value row for the detail pane.
pub fn stat_row(theme: &Theme, ui: &mut egui::Ui, label: &str, value: &str) {
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(label)
                .color(theme.text_dim)
                .size(type_size::SMALL),
        );
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            ui.label(RichText::new(value).size(type_size::BODY).color(theme.text));
        });
    });
}

/// A one-line cell clipped to `width`, so table rows line up in columns.
pub fn cell(
    ui: &mut egui::Ui,
    text: &str,
    width: f32,
    size: f32,
    color: Color32,
) -> egui::Response {
    ui.add_sized(
        [width, size + 8.0],
        egui::Label::new(RichText::new(text).size(size).color(color)).truncate(),
    )
}

/// A right-aligned numeric cell, for columns like playtime and size.
pub fn cell_right(ui: &mut egui::Ui, text: &str, width: f32, size: f32, color: Color32) {
    ui.allocate_ui_with_layout(
        egui::vec2(width, size + 8.0),
        egui::Layout::right_to_left(Align::Center),
        |ui| {
            ui.label(RichText::new(text).size(size).color(color));
        },
    );
}

/// Small rounded pill, used for platforms, categories, and statuses.
pub fn pill(_theme: &Theme, ui: &mut egui::Ui, text: &str, fill: Color32, fg: Color32) {
    let galley = ui.painter().layout_no_wrap(
        text.to_string(),
        FontId::proportional(type_size::MICRO + 0.5),
        fg,
    );
    let size = galley.size() + egui::vec2(12.0, 6.0);
    let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
    if ui.is_rect_visible(rect) {
        ui.painter().rect_filled(rect, radius::PILL, fill);
        ui.painter().rect_stroke(
            rect,
            radius::PILL,
            Stroke::new(1.0_f32, with_alpha(fg, 0.3)),
            egui::StrokeKind::Inside,
        );
        ui.painter()
            .galley(rect.center() - galley.size() / 2.0, galley, fg);
    }
    let _ = response;
}

/// A dot plus label, for statuses that read as live rather than as metadata.
pub fn status_dot(theme: &Theme, ui: &mut egui::Ui, color: Color32, label: &str) {
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(egui::vec2(8.0, 8.0), Sense::hover());
        ui.painter().circle_filled(rect.center(), 3.0, color);
        ui.label(
            RichText::new(label)
                .size(type_size::CAPTION)
                .color(theme.text_dim),
        );
    });
}

/// Playtime bar with an HLTB marker, showing how far along you are.
pub fn progress_bar(theme: &Theme, ui: &mut egui::Ui, played_secs: i64, estimate_h: f64) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 8.0), Sense::hover());
    let p = format::hltb_progress(played_secs, estimate_h);
    ui.painter()
        .rect_filled(rect, radius::PILL, theme.surface_alt);

    if p > 0.0 {
        let filled =
            egui::Rect::from_min_size(rect.min, egui::vec2(rect.width() * p, rect.height()));
        let color = if p >= 1.0 {
            theme.warning
        } else {
            theme.accent
        };
        ui.painter().rect_filled(filled, radius::PILL, color);
    }
}

/// A thin horizontal meter for storage usage. Colour shifts as it fills.
pub fn meter(theme: &Theme, ui: &mut egui::Ui, fraction: f32) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 8.0), Sense::hover());
    ui.painter()
        .rect_filled(rect, radius::PILL, theme.surface_alt);
    let f = fraction.clamp(0.0, 1.0);
    if f > 0.0 {
        let color = if f > 0.9 {
            theme.danger
        } else if f > 0.75 {
            theme.warning
        } else {
            theme.accent
        };
        let filled =
            egui::Rect::from_min_size(rect.min, egui::vec2(rect.width() * f, rect.height()));
        ui.painter().rect_filled(filled, radius::PILL, color);
    }
}

/// Five-point star rating, click to set.
pub fn star_rating(theme: &Theme, ui: &mut egui::Ui, rating: &mut i32, editable: bool) {
    ui.horizontal(|ui| {
        for i in 1..=5 {
            let filled = *rating >= i;
            let color = if filled {
                theme.warning
            } else {
                theme.text_faint
            };
            let text = if filled { "\u{2605}" } else { "\u{2606}" };
            let resp = ui
                .add(
                    egui::Label::new(RichText::new(text).size(16.0).color(color))
                        .sense(Sense::click()),
                )
                .on_hover_text("Click to rate \u{b7} Right-click to clear");
            if editable && resp.clicked() {
                *rating = if *rating == i { 0 } else { i };
            }
            if editable && resp.clicked_by(egui::PointerButton::Secondary) {
                *rating = -1;
            }
        }
        if *rating < 0 {
            ui.label(
                RichText::new("unrated")
                    .size(type_size::MICRO)
                    .color(theme.text_faint),
            );
        }
    });
}

/// Live session indicator with a stop button. The caller supplies the strip
/// (usually the top bar), so this only draws the row's contents.
pub fn active_session_bar(theme: &Theme, ui: &mut egui::Ui, app: &mut crate::state::App) {
    // Copy out the fields we need so the closure does not hold a borrow of
    // `app` while it also needs `&mut app` to stop the session.
    let Some((elapsed, name, category)) = app
        .active
        .as_ref()
        .map(|a| (a.elapsed_secs(), a.game_name.clone(), a.category.clone()))
    else {
        return;
    };

    ui.horizontal(|ui| {
        let (dot, _) = ui.allocate_exact_size(egui::vec2(8.0, 8.0), Sense::hover());
        ui.painter().circle_filled(dot.center(), 4.0, theme.success);
        ui.label(
            RichText::new("Playing")
                .color(theme.text_dim)
                .size(type_size::SMALL),
        );
        ui.label(RichText::new(&name).strong().size(type_size::BODY));
        ui.label(
            RichText::new(format::elapsed_clock(std::time::Duration::from_secs(
                elapsed.max(0) as u64,
            )))
            .color(theme.accent)
            .strong()
            .monospace()
            .size(type_size::TITLE),
        );
        if !category.is_empty() {
            pill(theme, ui, &category, theme.accent_soft, theme.accent);
        }
        ui.with_layout(egui::Layout::right_to_left(Align::Center), |ui| {
            let stop = danger_button(theme, ui, "Stop session");
            if stop.clicked() {
                let outcome = app.stop_play();
                app.last_outcome = Some(outcome);
            }
        });
    });
}

/// Solid accent button. Use for the single primary action on a screen.
pub fn primary_button(theme: &Theme, ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(
            RichText::new(label)
                .size(type_size::BODY)
                .strong()
                .color(theme.on_accent),
        )
        .fill(theme.accent)
        .stroke(Stroke::NONE)
        .corner_radius(radius::MD)
        .min_size(egui::vec2(0.0, 36.0)),
    )
}

/// Outlined button for secondary actions.
pub fn secondary_button(theme: &Theme, ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(RichText::new(label).size(type_size::BODY).color(theme.text))
            .fill(theme.surface_alt)
            .stroke(Stroke::new(1.0_f32, theme.border))
            .corner_radius(radius::MD)
            .min_size(egui::vec2(0.0, 36.0)),
    )
}

/// Accent-outlined button, for actions that matter but are not primary.
pub fn accent_button(theme: &Theme, ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(
            RichText::new(label)
                .size(type_size::BODY)
                .color(theme.accent),
        )
        .fill(Color32::TRANSPARENT)
        .stroke(Stroke::new(1.0_f32, theme.accent))
        .corner_radius(radius::MD)
        .min_size(egui::vec2(0.0, 36.0)),
    )
}

/// Destructive action, filled softly so it never competes with a primary button.
pub fn danger_button(theme: &Theme, ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(
            RichText::new(label)
                .size(type_size::BODY)
                .color(theme.danger),
        )
        .fill(theme.danger_soft)
        .stroke(Stroke::new(1.0_f32, with_alpha(theme.danger, 0.5)))
        .corner_radius(radius::MD)
        .min_size(egui::vec2(0.0, 36.0)),
    )
}

/// Square icon-only button with a tooltip.
pub fn icon_button(
    theme: &Theme,
    ui: &mut egui::Ui,
    icon: &str,
    tip: &str,
    size: f32,
) -> egui::Response {
    ui.add(
        egui::Button::new(RichText::new(icon).size(size).color(theme.text_dim))
            .fill(Color32::TRANSPARENT)
            .stroke(Stroke::NONE)
            .corner_radius(radius::SM)
            .min_size(egui::vec2(size + 14.0, size + 14.0)),
    )
    .on_hover_text(tip)
}

/// A pill-shaped segmented control. Returns the option the user picked.
///
/// Drawn by hand rather than with `ComboBox` so the selected segment reads as a
/// single object, which is what makes a switch feel like a switch.
pub fn segmented<T: Copy + PartialEq>(
    theme: &Theme,
    ui: &mut egui::Ui,
    id: &str,
    options: &[(T, &str)],
    current: T,
) -> Option<T> {
    let selected = options.iter().position(|(v, _)| *v == current);
    let mut chosen = None;

    ui.push_id(id, |ui| {
        egui::Frame::new()
            .fill(theme.surface_alt)
            .corner_radius(radius::MD)
            .inner_margin(egui::Margin::same(2))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(2.0, 2.0);
                    for (i, (value, label)) in options.iter().enumerate() {
                        let text = *label;
                        let width = ui
                            .painter()
                            .layout_no_wrap(
                                text.to_string(),
                                FontId::proportional(type_size::SMALL),
                                theme.text,
                            )
                            .size()
                            .x
                            + space::LG * 2.0;
                        let (rect, resp) =
                            ui.allocate_exact_size(egui::vec2(width, 30.0), Sense::click());
                        let is_on = selected == Some(i);
                        if is_on {
                            ui.painter()
                                .rect_filled(rect, radius::SM, theme.accent_soft);
                        } else if resp.hovered() {
                            ui.painter()
                                .rect_filled(rect, radius::SM, theme.surface_hover);
                        }
                        let color = if is_on { theme.accent } else { theme.text_dim };
                        let galley = ui.painter().layout_no_wrap(
                            text.to_string(),
                            FontId::proportional(type_size::SMALL),
                            color,
                        );
                        let text_pos = rect.center() - galley.size() / 2.0;
                        ui.painter().galley(text_pos, galley, color);
                        resp.clone().on_hover_text(format!("Switch to {label}"));
                        if resp.clicked() {
                            chosen = Some(*value);
                        }
                    }
                });
            });
    });
    chosen
}

/// A search box with a leading glyph and a clear button.
pub fn search_field(theme: &Theme, ui: &mut egui::Ui, text: &mut String, hint: &str, width: f32) {
    let mut edit_id = None;
    let inner = egui::Frame::new()
        .fill(theme.surface_alt)
        .stroke(Stroke::new(1.0_f32, theme.border))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::symmetric(space::SM as i8, 2))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing = egui::vec2(space::SM, 0.0);
                ui.label(
                    RichText::new("\u{1F50D}")
                        .size(12.0)
                        .color(theme.text_faint),
                );
                let resp = ui.add(
                    egui::TextEdit::singleline(text)
                        .hint_text(hint)
                        .desired_width(width)
                        .text_color(theme.text)
                        .frame(false),
                );
                edit_id = Some(resp.id);
                if !text.is_empty()
                    && icon_button(theme, ui, "\u{2715}", "Clear search", 11.0).clicked()
                {
                    text.clear();
                }
                // `Ctrl+F` puts the caret in the search box, because looking
                // something up is what people actually come here to do.
                if ui.input(|i| i.modifiers.ctrl && i.key_pressed(egui::Key::F)) {
                    ui.memory_mut(|m| m.request_focus(resp.id));
                }
            });
        });
    // Tailwind-style focus ring while the field has focus.
    if edit_id.is_some_and(|id| ui.memory(|m| m.has_focus(id))) {
        ui.painter().rect_stroke(
            inner.response.rect,
            radius::MD,
            Stroke::new(1.5_f32, theme.focus_ring),
            egui::StrokeKind::Inside,
        );
    }
}

/// The empty state for a page that has nothing to show yet.
///
/// Always says what to do next, so a blank screen is never a dead end.
pub fn empty_state(
    theme: &Theme,
    ui: &mut egui::Ui,
    glyph: &str,
    title: &str,
    body: &str,
    action: Option<&str>,
) {
    ui.vertical_centered(|ui| {
        ui.add_space(space::XXL);
        ui.label(RichText::new(glyph).size(40.0).color(theme.text_faint));
        ui.add_space(space::MD);
        ui.label(
            RichText::new(title)
                .size(type_size::TITLE)
                .strong()
                .color(theme.text),
        );
        ui.add_space(space::XS);
        ui.label(
            RichText::new(body)
                .size(type_size::BODY)
                .color(theme.text_dim),
        );
        if let Some(action) = action {
            ui.add_space(space::LG);
            if primary_button(theme, ui, action).clicked() {
                crate::ui::library::request_open_editor();
            }
        }
    });
}

/// A single headline number with a label above it, used across Statistics.
pub fn stat_tile(theme: &Theme, ui: &mut egui::Ui, label: &str, value: &str) {
    card(theme, ui, |ui| {
        ui.set_min_width(160.0);
        ui.label(
            RichText::new(label.to_uppercase())
                .size(type_size::MICRO)
                .color(theme.text_faint),
        );
        ui.add_space(space::XS);
        ui.label(
            RichText::new(value)
                .size(type_size::HERO)
                .strong()
                .color(theme.text),
        );
    });
}

/// A settings row: the label and its explanation on the left, the control on
/// the right. Every option in Settings uses this, so the page scans the same way
/// as a list of choices rather than a wall of mixed widgets.
pub fn setting_row(
    theme: &Theme,
    ui: &mut egui::Ui,
    label: &str,
    hint: Option<&str>,
    add_control: impl FnOnce(&mut egui::Ui),
) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(space::LG, space::SM);
        ui.vertical(|ui| {
            ui.label(RichText::new(label).size(type_size::BODY).color(theme.text));
            if let Some(h) = hint {
                ui.label(
                    RichText::new(h)
                        .size(type_size::CAPTION)
                        .color(theme.text_faint),
                );
            }
        });
        ui.with_layout(egui::Layout::right_to_left(Align::Center), add_control);
    });
}

/// A settings row whose control is a checkbox, aligned to the trailing edge.
pub fn toggle_row(
    theme: &Theme,
    ui: &mut egui::Ui,
    label: &str,
    hint: Option<&str>,
    on: &mut bool,
) -> egui::Response {
    let mut response = None;
    setting_row(theme, ui, label, hint, |ui| {
        response = Some(ui.checkbox(&mut *on, ""));
    });
    response.expect("toggle_row always draws its checkbox")
}

/// A slider plus its live value, right-aligned.
pub fn slider_row(
    theme: &Theme,
    ui: &mut egui::Ui,
    label: &str,
    range: std::ops::RangeInclusive<f64>,
    value: &mut f64,
) {
    setting_row(theme, ui, label, None, |ui| {
        ui.add(egui::Slider::new(value, range).text(""));
    });
}

/// Lay out a label for a caller to paint at an exact position, used for hover
/// hints drawn over cover art.
pub fn label_chip(theme: &Theme, ui: &egui::Ui, text: &str) -> std::sync::Arc<egui::Galley> {
    ui.painter().layout_no_wrap(
        text.to_string(),
        FontId::proportional(type_size::SMALL),
        theme.text,
    )
}

/// A small monospace hint showing a keyboard shortcut.
pub fn key_hint(theme: &Theme, ui: &mut egui::Ui, keys: &str) {
    let galley = ui.painter().layout_no_wrap(
        keys.to_string(),
        FontId::monospace(type_size::MICRO),
        theme.text_faint,
    );
    let size = galley.size() + egui::vec2(10.0, 4.0);
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    ui.painter()
        .rect_filled(rect, radius::SM, theme.surface_alt);
    ui.painter()
        .galley(rect.min + egui::vec2(5.0, 2.0), galley, theme.text_dim);
}

/// Draw and age out toasts. Slides in from the top-right, over the header.
pub fn show_toast(theme: &Theme, ctx: &egui::Context, toast: &mut Option<Toast>) {
    let Some(t) = toast.as_ref() else {
        return;
    };
    if std::time::Instant::now() > t.ttl {
        *toast = None;
        return;
    }
    let (fg, bg) = t.kind.colors(theme);

    let area = egui::Area::new(egui::Id::new("toast_area"))
        .anchor(egui::Align2::RIGHT_TOP, egui::vec2(-space::LG, space::LG))
        .order(egui::Order::Tooltip);
    area.show(ctx, |ui| {
        egui::Frame::new()
            .fill(bg)
            .stroke(Stroke::new(1.0_f32, with_alpha(fg, 0.45)))
            .shadow(tw_shadow::egui(tw_shadow::LG, theme.shadow))
            .corner_radius(radius::MD)
            .inner_margin(egui::Margin::symmetric(space::LG as i8, space::MD as i8))
            .show(ui, |ui| {
                ui.set_max_width(420.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new(t.kind.icon()).size(type_size::BODY).color(fg));
                    ui.label(
                        RichText::new(&t.text)
                            .color(theme.text)
                            .size(type_size::SMALL),
                    );
                });
            });
    });
}

/// Convert a `PlayOutcome` into a styled toast.
pub fn outcome_toast(outcome: PlayOutcome) -> Toast {
    let text = outcome.message();
    let kind = match outcome {
        PlayOutcome::Started { .. }
        | PlayOutcome::Stopped { .. }
        | PlayOutcome::AutoStopped { .. } => ToastKind::Success,
        PlayOutcome::NotConfigured(_) | PlayOutcome::Failed(_) => ToastKind::Info,
    };
    Toast {
        text,
        kind,
        ttl: std::time::Instant::now() + TOAST_TTL,
    }
}
