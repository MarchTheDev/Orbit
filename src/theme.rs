//! Colour palettes and egui styling, built on Tailwind CSS v4 design tokens.
//!
//! Every colour the UI paints comes from a [`Theme`] field, and every [`Theme`]
//! is assembled from the Tailwind palette in [`crate::tailwind`]. Adding a theme
//! means adding one preset and nothing else.

use egui::{Color32, Stroke};

use crate::tailwind::{color, mix, shadow as tw_shadow, with_alpha};
pub use crate::tailwind::{radius, space, type_size};

/// A named palette. Every colour the UI uses comes from one of these fields,
/// so adding a theme means adding a preset and nothing else.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Theme {
    pub name: &'static str,
    pub label: &'static str,
    pub is_dark: bool,

    /// Window chrome and sidebar.
    pub bg: Color32,
    pub surface: Color32,
    pub surface_alt: Color32,
    pub surface_hover: Color32,
    pub sidebar: Color32,
    pub sidebar_hover: Color32,

    /// Primary text.
    pub text: Color32,
    pub text_dim: Color32,
    pub text_faint: Color32,

    /// Interactive accent.
    pub accent: Color32,
    pub accent_hover: Color32,
    pub accent_soft: Color32,
    pub on_accent: Color32,

    /// Status colours and their soft backgrounds.
    pub success: Color32,
    pub warning: Color32,
    pub danger: Color32,
    pub success_soft: Color32,
    pub warning_soft: Color32,
    pub danger_soft: Color32,

    pub border: Color32,
    pub border_strong: Color32,
    pub shadow: Color32,
    pub focus_ring: Color32,
    pub overlay: Color32,
    /// Tint for playing / currently-running rows.
    pub playing_tint: Color32,
}

/// The raw choices for one theme, before derived tokens are computed.
struct Spec {
    is_dark: bool,
    bg: Color32,
    surface: Color32,
    surface_alt: Color32,
    surface_hover: Color32,
    sidebar: Color32,
    sidebar_hover: Color32,
    text: Color32,
    text_dim: Color32,
    text_faint: Color32,
    accent: Color32,
    accent_hover: Color32,
    accent_soft: Color32,
    on_accent: Color32,
    success: Color32,
    warning: Color32,
    danger: Color32,
    border: Color32,
    border_strong: Color32,
    shadow: Color32,
    playing_tint: Color32,
}

/// Fill in the tokens that are always derived from the base palette.
fn themed(name: &'static str, label: &'static str, s: Spec) -> Theme {
    let soft = if s.is_dark { 0.16 } else { 0.12 };
    Theme {
        name,
        label,
        is_dark: s.is_dark,
        bg: s.bg,
        surface: s.surface,
        surface_alt: s.surface_alt,
        surface_hover: s.surface_hover,
        sidebar: s.sidebar,
        sidebar_hover: s.sidebar_hover,
        text: s.text,
        text_dim: s.text_dim,
        text_faint: s.text_faint,
        accent: s.accent,
        accent_hover: s.accent_hover,
        accent_soft: s.accent_soft,
        on_accent: s.on_accent,
        success: s.success,
        warning: s.warning,
        danger: s.danger,
        success_soft: mix(s.surface, s.success, soft),
        warning_soft: mix(s.surface, s.warning, soft),
        danger_soft: mix(s.surface, s.danger, soft),
        border: s.border,
        border_strong: s.border_strong,
        shadow: s.shadow,
        focus_ring: s.accent,
        overlay: Color32::from_black_alpha(if s.is_dark { 170 } else { 110 }),
        playing_tint: s.playing_tint,
    }
}

impl Theme {
    /// The signature Orbit look: Tailwind zinc + indigo, dark-first.
    pub fn orbit_dark() -> Theme {
        let surface = color::ZINC_900.srgb();
        themed(
            "orbit-dark",
            "Orbit Dark",
            Spec {
                is_dark: true,
                bg: color::ZINC_950.srgb(),
                surface,
                surface_alt: color::ZINC_800.srgb(),
                surface_hover: mix(surface, color::ZINC_700.srgb(), 0.6),
                sidebar: color::ZINC_950.srgb(),
                sidebar_hover: color::ZINC_800.srgb(),
                text: color::ZINC_50.srgb(),
                text_dim: color::ZINC_400.srgb(),
                text_faint: color::ZINC_500.srgb(),
                accent: color::INDIGO_500.srgb(),
                accent_hover: color::INDIGO_400.srgb(),
                accent_soft: color::INDIGO_950.srgb(),
                on_accent: color::WHITE,
                success: color::EMERALD_400.srgb(),
                warning: color::AMBER_400.srgb(),
                danger: color::RED_400.srgb(),
                border: color::ZINC_800.srgb(),
                border_strong: color::ZINC_700.srgb(),
                shadow: Color32::from_black_alpha(110),
                playing_tint: mix(surface, color::INDIGO_500.srgb(), 0.14),
            },
        )
    }

    /// Tailwind zinc + violet, warmer for late-night sessions.
    pub fn nebula() -> Theme {
        let surface = mix(color::ZINC_900.srgb(), color::VIOLET_950.srgb(), 0.40);
        let surface_alt = mix(color::ZINC_800.srgb(), color::VIOLET_900.srgb(), 0.35);
        themed(
            "nebula",
            "Nebula",
            Spec {
                is_dark: true,
                bg: mix(color::ZINC_950.srgb(), color::VIOLET_950.srgb(), 0.45),
                surface,
                surface_alt,
                surface_hover: mix(surface_alt, color::VIOLET_900.srgb(), 0.5),
                sidebar: mix(color::ZINC_950.srgb(), color::VIOLET_950.srgb(), 0.45),
                sidebar_hover: surface_alt,
                text: color::ZINC_50.srgb(),
                text_dim: color::ZINC_400.srgb(),
                text_faint: color::ZINC_500.srgb(),
                accent: color::VIOLET_500.srgb(),
                accent_hover: color::VIOLET_400.srgb(),
                accent_soft: color::VIOLET_950.srgb(),
                on_accent: color::WHITE,
                success: color::EMERALD_400.srgb(),
                warning: color::AMBER_400.srgb(),
                danger: color::ROSE_400.srgb(),
                border: mix(color::ZINC_800.srgb(), color::VIOLET_900.srgb(), 0.5),
                border_strong: mix(color::ZINC_700.srgb(), color::VIOLET_900.srgb(), 0.5),
                shadow: Color32::from_black_alpha(120),
                playing_tint: mix(surface, color::VIOLET_500.srgb(), 0.16),
            },
        )
    }

    /// Tailwind neutral + emerald. Easy on the eyes in a bright room.
    pub fn terminal() -> Theme {
        let surface = mix(color::NEUTRAL_900.srgb(), color::GREEN_950.srgb(), 0.30);
        let surface_alt = mix(color::NEUTRAL_800.srgb(), color::GREEN_900.srgb(), 0.25);
        themed(
            "terminal",
            "Terminal",
            Spec {
                is_dark: true,
                bg: mix(color::NEUTRAL_950.srgb(), color::GREEN_950.srgb(), 0.35),
                surface,
                surface_alt,
                surface_hover: mix(surface_alt, color::GREEN_900.srgb(), 0.5),
                sidebar: mix(color::NEUTRAL_950.srgb(), color::GREEN_950.srgb(), 0.35),
                sidebar_hover: surface_alt,
                text: color::NEUTRAL_50.srgb(),
                text_dim: color::NEUTRAL_400.srgb(),
                text_faint: color::NEUTRAL_500.srgb(),
                accent: color::EMERALD_500.srgb(),
                accent_hover: color::EMERALD_400.srgb(),
                accent_soft: color::EMERALD_950.srgb(),
                on_accent: color::NEUTRAL_950.srgb(),
                success: color::EMERALD_400.srgb(),
                warning: color::AMBER_400.srgb(),
                danger: color::RED_400.srgb(),
                border: mix(color::NEUTRAL_800.srgb(), color::GREEN_900.srgb(), 0.4),
                border_strong: mix(color::NEUTRAL_700.srgb(), color::GREEN_900.srgb(), 0.4),
                shadow: Color32::from_black_alpha(100),
                playing_tint: mix(surface, color::EMERALD_500.srgb(), 0.16),
            },
        )
    }

    /// Pure black with a Tailwind lime accent, for OLED displays.
    pub fn void() -> Theme {
        let surface = color::NEUTRAL_950.srgb();
        themed(
            "void",
            "Void",
            Spec {
                is_dark: true,
                bg: color::BLACK,
                surface,
                surface_alt: color::NEUTRAL_800.srgb(),
                surface_hover: color::NEUTRAL_700.srgb(),
                sidebar: color::BLACK,
                sidebar_hover: color::NEUTRAL_800.srgb(),
                text: color::NEUTRAL_50.srgb(),
                text_dim: color::NEUTRAL_400.srgb(),
                text_faint: color::NEUTRAL_500.srgb(),
                accent: color::LIME_400.srgb(),
                accent_hover: color::LIME_300.srgb(),
                accent_soft: mix(surface, color::LIME_500.srgb(), 0.18),
                on_accent: color::BLACK,
                success: color::EMERALD_400.srgb(),
                warning: color::AMBER_400.srgb(),
                danger: color::RED_400.srgb(),
                border: color::NEUTRAL_800.srgb(),
                border_strong: color::NEUTRAL_700.srgb(),
                shadow: Color32::from_black_alpha(170),
                playing_tint: mix(surface, color::LIME_400.srgb(), 0.14),
            },
        )
    }

    /// Light, cool, Tailwind zinc + indigo.
    pub fn daylight() -> Theme {
        themed(
            "daylight",
            "Daylight",
            Spec {
                is_dark: false,
                bg: color::ZINC_100.srgb(),
                surface: color::WHITE,
                surface_alt: color::ZINC_200.srgb(),
                surface_hover: color::ZINC_200.srgb(),
                sidebar: color::ZINC_50.srgb(),
                sidebar_hover: color::ZINC_200.srgb(),
                text: color::ZINC_900.srgb(),
                text_dim: color::ZINC_600.srgb(),
                text_faint: color::ZINC_400.srgb(),
                accent: color::INDIGO_600.srgb(),
                accent_hover: color::INDIGO_700.srgb(),
                accent_soft: color::INDIGO_100.srgb(),
                on_accent: color::WHITE,
                success: color::GREEN_600.srgb(),
                warning: color::AMBER_600.srgb(),
                danger: color::RED_600.srgb(),
                border: color::ZINC_200.srgb(),
                border_strong: color::ZINC_300.srgb(),
                shadow: Color32::from_black_alpha(24),
                playing_tint: color::INDIGO_50.srgb(),
            },
        )
    }

    /// Light, warm, Tailwind stone + orange.
    pub fn solar() -> Theme {
        themed(
            "solar",
            "Solar",
            Spec {
                is_dark: false,
                bg: color::STONE_100.srgb(),
                surface: color::WHITE,
                surface_alt: color::STONE_200.srgb(),
                surface_hover: color::STONE_200.srgb(),
                sidebar: color::STONE_50.srgb(),
                sidebar_hover: color::STONE_200.srgb(),
                text: color::STONE_900.srgb(),
                text_dim: color::STONE_600.srgb(),
                text_faint: color::STONE_400.srgb(),
                accent: color::ORANGE_600.srgb(),
                accent_hover: color::ORANGE_700.srgb(),
                accent_soft: color::ORANGE_100.srgb(),
                on_accent: color::WHITE,
                success: color::GREEN_600.srgb(),
                warning: color::AMBER_700.srgb(),
                danger: color::RED_600.srgb(),
                border: color::STONE_200.srgb(),
                border_strong: color::STONE_300.srgb(),
                shadow: Color32::from_black_alpha(22),
                playing_tint: color::ORANGE_50.srgb(),
            },
        )
    }

    /// Every built-in theme, built once and cached.
    pub fn all() -> &'static [Theme] {
        use std::sync::OnceLock;
        static CACHE: OnceLock<Vec<Theme>> = OnceLock::new();
        CACHE.get_or_init(|| {
            vec![
                Self::orbit_dark(),
                Self::nebula(),
                Self::terminal(),
                Self::void(),
                Self::daylight(),
                Self::solar(),
            ]
        })
    }

    pub fn by_name(name: &str) -> Self {
        Self::all()
            .iter()
            .find(|t| t.name == name)
            .copied()
            .unwrap_or_else(Self::orbit_dark)
    }

    /// Fill used behind a tile or row that has been selected.
    pub fn selected_fill(&self) -> Color32 {
        if self.is_dark {
            self.surface_alt
        } else {
            self.accent_soft
        }
    }

    /// Scrim painted over cover art on hover, so white overlay art stays
    /// readable on any palette.
    pub fn scrim(&self) -> Color32 {
        if self.is_dark {
            Color32::from_black_alpha(150)
        } else {
            Color32::from_black_alpha(120)
        }
    }

    /// Push this palette into egui's global visuals and widget styling.
    pub fn apply(&self, ctx: &egui::Context) {
        let mut style = ctx.style().as_ref().clone();
        let mut visuals = if self.is_dark {
            egui::Visuals::dark()
        } else {
            egui::Visuals::light()
        };

        visuals.panel_fill = self.bg;
        visuals.window_fill = self.surface;
        visuals.extreme_bg_color = self.bg;
        visuals.faint_bg_color = self.surface_alt;
        visuals.override_text_color = Some(self.text);
        visuals.window_stroke = Stroke::new(1.0_f32, self.border);
        visuals.selection.bg_fill = with_alpha(self.accent, 0.32);
        visuals.selection.stroke = Stroke::new(1.0_f32, self.accent);
        visuals.hyperlink_color = self.accent;
        visuals.warn_fg_color = self.warning;
        visuals.error_fg_color = self.danger;
        visuals.window_shadow = tw_shadow::egui(tw_shadow::XL, self.shadow);
        visuals.popup_shadow = tw_shadow::egui(tw_shadow::LG, self.shadow);
        visuals.window_corner_radius = egui::CornerRadius::same(radius::LG as u8);
        visuals.menu_corner_radius = egui::CornerRadius::same(radius::MD as u8);

        style.visuals = visuals;

        let cr = egui::CornerRadius::same(radius::MD as u8);
        let w = &mut style.visuals.widgets;

        w.noninteractive.bg_fill = self.surface;
        w.noninteractive.weak_bg_fill = self.surface;
        w.noninteractive.bg_stroke = Stroke::new(1.0_f32, self.border);
        w.noninteractive.fg_stroke = Stroke::new(1.0_f32, self.text_dim);
        w.noninteractive.corner_radius = egui::CornerRadius::same(radius::SM as u8);

        w.inactive.bg_fill = self.surface_alt;
        w.inactive.weak_bg_fill = self.surface_alt;
        w.inactive.bg_stroke = Stroke::new(1.0_f32, self.border);
        w.inactive.fg_stroke = Stroke::new(1.0_f32, self.text);
        w.inactive.corner_radius = cr;

        w.hovered.bg_fill = self.surface_hover;
        w.hovered.weak_bg_fill = self.surface_hover;
        w.hovered.bg_stroke = Stroke::new(1.0_f32, self.focus_ring);
        w.hovered.fg_stroke = Stroke::new(1.0_f32, self.text);
        w.hovered.corner_radius = cr;

        w.active.bg_fill = self.accent_soft;
        w.active.weak_bg_fill = self.accent_soft;
        w.active.bg_stroke = Stroke::new(1.0_f32, self.accent);
        w.active.fg_stroke = Stroke::new(1.0_f32, self.text);
        w.active.corner_radius = cr;

        w.open.bg_fill = self.surface_alt;
        w.open.weak_bg_fill = self.surface_alt;
        w.open.bg_stroke = Stroke::new(1.0_f32, self.focus_ring);
        w.open.fg_stroke = Stroke::new(1.0_f32, self.text);
        w.open.corner_radius = cr;

        style.spacing.item_spacing = egui::vec2(space::SM, space::SM);
        style.spacing.button_padding = egui::vec2(space::MD, 6.0);
        style.spacing.window_margin = egui::Margin::same(space::MD as i8);
        style.spacing.scroll.bar_width = 10.0;
        style.spacing.scroll.floating = true;
        style.spacing.interact_size.y = 32.0;

        ctx.set_style(style);
    }

    /// Outlined button for a secondary action.
    pub fn subtle_button(&self, ui: &mut egui::Ui, label: impl Into<String>) -> egui::Response {
        ui.add(
            egui::Button::new(
                egui::RichText::new(label.into())
                    .color(self.accent)
                    .size(type_size::SMALL),
            )
            .fill(Color32::TRANSPARENT)
            .stroke(Stroke::new(1.0_f32, self.accent))
            .corner_radius(radius::SM)
            .min_size(egui::vec2(0.0, 34.0)),
        )
    }
}
