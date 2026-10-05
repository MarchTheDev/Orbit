use egui::{Align, Layout, RichText, Sense};

use crate::format;
use crate::state::App;
use crate::theme::{radius, space, type_size, Theme};
use crate::ui::common;

/// One clickable destination in the sidebar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NavTarget {
    Library,
    Sessions,
    Storage,
    Stats,
    Settings,
}

/// Which page the central panel shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum View {
    #[default]
    Library,
    Sessions,
    Storage,
    Stats,
    Settings,
    /// The add/edit game form. The editor is opened by the shell, so the
    /// sidebar only needs to know it should stay put.
    Editor,
}

pub struct Sidebar {
    pub nav: NavTarget,
    pub collapsed_genres: bool,
    /// Set for one frame when a destination was clicked, so the shell can leave
    /// the editor even though the nav highlight did not change.
    nav_clicked: Option<NavTarget>,
}

/// Line icons drawn with the painter, so navigation never depends on an emoji
/// font being installed. Deliberately simple and geometric, in the spirit of
/// Tailwind/Lucide icon sets.
#[derive(Clone, Copy)]
enum NavIcon {
    Grid,
    Clock,
    Stack,
    Chart,
    Sliders,
}

fn paint_icon(ui: &mut egui::Ui, color: egui::Color32, icon: NavIcon) {
    let (rect, _) = ui.allocate_exact_size(egui::vec2(18.0, 18.0), Sense::hover());
    let c = rect.center();
    let p = ui.painter();
    let s = egui::Stroke::new(1.6_f32, color);
    match icon {
        NavIcon::Grid => {
            let d = 6.5;
            for (dx, dy) in [(-1.0_f32, -1.0_f32), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
                let r = egui::Rect::from_center_size(
                    c + egui::vec2(dx * d * 0.78, dy * d * 0.78),
                    egui::vec2(d, d),
                );
                p.rect_stroke(r, radius::XS, s, egui::StrokeKind::Inside);
            }
        }
        NavIcon::Clock => {
            p.circle_stroke(c, 7.0, s);
            p.line_segment([c, c + egui::vec2(0.0, -4.5)], s);
            p.line_segment([c, c + egui::vec2(3.2, 0.0)], s);
        }
        NavIcon::Stack => {
            let top =
                egui::Rect::from_center_size(c + egui::vec2(0.0, -2.0), egui::vec2(15.0, 9.0));
            p.rect_stroke(top, radius::XS, s, egui::StrokeKind::Inside);
            let bottom =
                egui::Rect::from_center_size(c + egui::vec2(0.0, 4.5), egui::vec2(15.0, 5.0));
            p.rect_stroke(bottom, radius::XS, s, egui::StrokeKind::Inside);
        }
        NavIcon::Chart => {
            let base = c + egui::vec2(0.0, 6.0);
            for (i, h) in [5.0_f32, 9.0, 13.0].iter().enumerate() {
                let x = base.x - 6.0 + i as f32 * 6.0;
                let r = egui::Rect::from_min_max(
                    egui::pos2(x - 1.8, base.y - h),
                    egui::pos2(x + 1.8, base.y),
                );
                p.rect_filled(r, radius::XS, color);
            }
        }
        NavIcon::Sliders => {
            for (i, y) in [-4.0_f32, 4.0].iter().enumerate() {
                let yy = c.y + y;
                p.line_segment([egui::pos2(c.x - 7.0, yy), egui::pos2(c.x + 7.0, yy)], s);
                let knob = if i == 0 { -2.0 } else { 3.0 };
                p.circle_filled(egui::pos2(c.x + knob, yy), 2.6, color);
            }
        }
    }
}

impl Default for Sidebar {
    fn default() -> Self {
        Self {
            nav: NavTarget::Library,
            collapsed_genres: true,
            nav_clicked: None,
        }
    }
}

impl Sidebar {
    pub fn view(&self) -> View {
        match self.nav {
            NavTarget::Library => View::Library,
            NavTarget::Sessions => View::Sessions,
            NavTarget::Storage => View::Storage,
            NavTarget::Stats => View::Stats,
            NavTarget::Settings => View::Settings,
        }
    }

    /// The destination clicked this frame, clearing the marker.
    pub fn take_nav_click(&mut self) -> Option<NavTarget> {
        self.nav_clicked.take()
    }

    /// Read a `Ctrl+1..5` press and move the highlight. Returns the destination
    /// if one was requested, so the shell can act on it in the same frame.
    pub fn nav_from_shortcut(&mut self, ctx: &egui::Context) -> Option<NavTarget> {
        let pressed = ctx.input(|i| {
            i.modifiers.ctrl
                && [
                    egui::Key::Num1,
                    egui::Key::Num2,
                    egui::Key::Num3,
                    egui::Key::Num4,
                    egui::Key::Num5,
                ]
                .iter()
                .any(|k| i.key_pressed(*k))
        });
        if !pressed {
            return None;
        }
        let target = ctx.input(|i| {
            [
                egui::Key::Num1,
                egui::Key::Num2,
                egui::Key::Num3,
                egui::Key::Num4,
                egui::Key::Num5,
            ]
            .iter()
            .position(|k| i.key_pressed(*k))
        });
        let target = match target {
            Some(0) => NavTarget::Library,
            Some(1) => NavTarget::Sessions,
            Some(2) => NavTarget::Storage,
            Some(3) => NavTarget::Stats,
            Some(4) => NavTarget::Settings,
            _ => return None,
        };
        self.nav = target;
        self.nav_clicked = Some(target);
        Some(target)
    }

    /// Left rail: brand, navigation, genre filters, library summary.
    pub fn show(&mut self, ctx: &egui::Context, app: &mut App) {
        let theme = app.theme;

        egui::SidePanel::left("sidebar")
            .exact_width(216.0)
            .resizable(false)
            .frame(
                egui::Frame::new()
                    .fill(theme.sidebar)
                    .inner_margin(egui::Margin::symmetric(space::SM as i8, space::LG as i8)),
            )
            .show(ctx, |ui| self.show_contents(ui, app, theme));
    }

    fn show_contents(&mut self, ui: &mut egui::Ui, app: &mut App, theme: Theme) {
        ui.visuals_mut().panel_fill = theme.sidebar;

        self.brand(ui, theme);
        ui.add_space(space::XL);

        common::section_header(&theme, ui, "Browse", None);
        ui.add_space(space::XS);
        self.nav_button(
            ui,
            app,
            theme,
            NavTarget::Library,
            NavIcon::Grid,
            "Library",
            app.stats.total_games,
            "Ctrl+1",
        );
        self.nav_button(
            ui,
            app,
            theme,
            NavTarget::Sessions,
            NavIcon::Clock,
            "Sessions",
            app.stats.sessions,
            "Ctrl+2",
        );
        self.nav_button(
            ui,
            app,
            theme,
            NavTarget::Storage,
            NavIcon::Stack,
            "Storage",
            app.settings.library_folders.len(),
            "Ctrl+3",
        );
        self.nav_button(
            ui,
            app,
            theme,
            NavTarget::Stats,
            NavIcon::Chart,
            "Statistics",
            0,
            "Ctrl+4",
        );

        ui.add_space(space::LG);
        common::section_header(&theme, ui, "Orbit", None);
        ui.add_space(space::XS);
        self.nav_button(
            ui,
            app,
            theme,
            NavTarget::Settings,
            NavIcon::Sliders,
            "Settings",
            0,
            "Ctrl+5",
        );

        ui.add_space(space::XL);
        self.genres(ui, app, theme);

        // Push the summary to the bottom of the rail whatever the content
        // height turns out to be.
        ui.add_space(0.0);
        ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
            self.footer(ui, app, theme);
        });
    }

    /// Orbit wordmark: a small orbital glyph plus the name.
    fn brand(&self, ui: &mut egui::Ui, theme: Theme) {
        ui.horizontal(|ui| {
            ui.add_space(space::SM);
            let (rect, _) = ui.allocate_exact_size(egui::vec2(28.0, 28.0), Sense::hover());
            let p = ui.painter();
            // An orbit ring with a planet riding it, drawn rather than typed so
            // it never depends on an emoji font being installed.
            p.circle_stroke(
                rect.center(),
                11.0,
                egui::Stroke::new(1.5_f32, theme.accent),
            );
            let angle = 0.6_f32;
            let planet = rect.center() + egui::vec2(angle.cos() * 11.0, angle.sin() * 11.0 * 0.55);
            p.circle_filled(planet, 3.5, theme.accent_hover);
            p.circle_filled(rect.center(), 4.5, theme.accent_soft);

            ui.vertical(|ui| {
                ui.label(
                    RichText::new("Orbit")
                        .size(type_size::TITLE)
                        .strong()
                        .color(theme.text),
                );
                ui.label(
                    RichText::new("game launcher")
                        .size(type_size::MICRO)
                        .color(theme.text_faint),
                );
            });
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn nav_button(
        &mut self,
        ui: &mut egui::Ui,
        app: &mut App,
        theme: Theme,
        target: NavTarget,
        icon: NavIcon,
        label: &str,
        count: usize,
        shortcut: &str,
    ) {
        let selected = self.nav == target;
        let fill = if selected {
            theme.accent_soft
        } else {
            egui::Color32::TRANSPARENT
        };
        let fg = if selected { theme.text } else { theme.text_dim };

        let rect = egui::Frame::new()
            .fill(fill)
            .corner_radius(radius::SM)
            .inner_margin(egui::Margin::symmetric(
                space::SM as i8,
                (space::SM + 1.0) as i8,
            ))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add_space(2.0);
                    paint_icon(ui, fg, icon);
                    ui.add_space(2.0);
                    let mut text = RichText::new(label).size(type_size::BODY).color(fg);
                    if selected {
                        text = text.strong();
                    }
                    ui.label(text);
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if count > 0 {
                            ui.label(
                                RichText::new(count.to_string())
                                    .size(type_size::CAPTION)
                                    .color(theme.text_faint),
                            );
                        }
                    });
                });
            })
            .response
            .rect;

        let resp = ui.interact(rect, ui.id().with(target), Sense::click());
        if resp.clicked() {
            // Choosing a destination leaves the editor.
            self.nav = target;
            self.nav_clicked = Some(target);
            // A genre filter only makes sense while browsing the library.
            if target != NavTarget::Library {
                app.genre_filter = None;
            }
        }
        if resp.hovered() && !selected {
            ui.painter()
                .rect_filled(rect, radius::SM, theme.sidebar_hover);
        }
        if selected {
            // A short accent bar on the leading edge, so the current page is
            // obvious even in a long list.
            let bar = egui::Rect::from_min_size(
                rect.min + egui::vec2(0.0, 6.0),
                egui::vec2(3.0, rect.height() - 12.0),
            );
            ui.painter().rect_filled(bar, radius::SM, theme.accent);
        }
        resp.on_hover_text(format!("{label}  \u{b7}  {shortcut}"));
    }

    fn genres(&mut self, ui: &mut egui::Ui, app: &mut App, theme: Theme) {
        if app.genres.is_empty() {
            return;
        }
        ui.horizontal(|ui| {
            ui.add_space(space::SM);
            common::section_header(&theme, ui, "Genres", None);
            let arrow = if self.collapsed_genres {
                "\u{25B8}"
            } else {
                "\u{25BE}"
            };
            let resp = common::icon_button(&theme, ui, arrow, "Show genre filters", 12.0);
            if resp.clicked() {
                self.collapsed_genres = !self.collapsed_genres;
            }
        });

        if self.collapsed_genres {
            return;
        }

        let all_selected = app.genre_filter.is_none();
        if filter_row(ui, &theme, "All genres", all_selected).clicked() {
            app.genre_filter = None;
        }

        let genres = app.genres.clone();
        egui::ScrollArea::vertical()
            .max_height(240.0)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for tag in genres {
                    let selected = app.genre_filter.as_deref() == Some(tag.name.as_str());
                    let resp = filter_row(ui, &theme, &tag.name, selected);
                    resp.clone()
                        .on_hover_text(format!("{} \u{b7} click to filter", tag.count));
                    if resp.clicked() {
                        app.genre_filter = if selected {
                            None
                        } else {
                            Some(tag.name.clone())
                        };
                    }
                }
            });
    }

    fn footer(&self, ui: &mut egui::Ui, app: &App, theme: Theme) {
        egui::Frame::new()
            .fill(theme.surface)
            .stroke(egui::Stroke::new(1.0_f32, theme.border))
            .corner_radius(radius::MD)
            .inner_margin(egui::Margin::same(space::MD as i8))
            .show(ui, |ui| {
                if let Some(active) = app.active.as_ref() {
                    ui.horizontal(|ui| {
                        common::status_dot(&theme, ui, theme.success, "Playing");
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            ui.label(
                                RichText::new(format::elapsed_clock(
                                    std::time::Duration::from_secs(
                                        active.elapsed_secs().max(0) as u64
                                    ),
                                ))
                                .size(type_size::SMALL)
                                .monospace()
                                .strong()
                                .color(theme.success),
                            );
                        });
                    });
                    ui.add(
                        egui::Label::new(
                            RichText::new(&active.game_name)
                                .size(type_size::CAPTION)
                                .color(theme.text_dim),
                        )
                        .truncate(),
                    );
                    ui.add_space(space::SM);
                }

                if app.settings.track_playtime {
                    ui.label(
                        RichText::new(format::duration(app.stats.total_secs))
                            .size(type_size::HEADING)
                            .strong()
                            .color(theme.text),
                    );
                    ui.label(
                        RichText::new("total playtime")
                            .size(type_size::MICRO)
                            .color(theme.text_faint),
                    );
                    ui.add_space(space::SM);
                }
                ui.label(
                    RichText::new(format!("{} games tracked", app.stats.tracked_games))
                        .size(type_size::CAPTION)
                        .color(theme.text_dim),
                );
            });
    }
}

/// A filter row in the sidebar list.
fn filter_row(ui: &mut egui::Ui, theme: &Theme, label: &str, selected: bool) -> egui::Response {
    let fg = if selected {
        theme.accent
    } else {
        theme.text_dim
    };
    let mut text = RichText::new(label).size(type_size::SMALL).color(fg);
    if selected {
        text = text.strong();
    }
    let resp = ui
        .add(egui::Label::new(text).sense(Sense::click()))
        .interact(Sense::click());
    if selected {
        ui.painter()
            .rect_filled(resp.rect, radius::SM, theme.accent_soft);
        ui.painter().rect_filled(
            egui::Rect::from_min_size(resp.rect.min, egui::vec2(3.0, resp.rect.height())),
            radius::SM,
            theme.accent,
        );
    } else if resp.hovered() {
        ui.painter()
            .rect_filled(resp.rect, radius::SM, theme.sidebar_hover);
    }
    resp
}
