//! Tailwind CSS v4 design tokens, expressed for egui.
//!
//! Tailwind v4 ships its default palette in OKLCH. egui paints 8-bit sRGB, so
//! the palette is kept in OKLCH and converted at runtime. Values are copied
//! from `tailwindcss/packages/tailwindcss/theme.css`, so themes match Tailwind
//! exactly and light/dark pairs stay perceptually balanced.
//!
//! This module owns three things:
//!   * `color`   the raw Tailwind v4 palette, in OKLCH
//!   * `space`, `radius`, `type_size`, `shadow`   the non-colour scales
//!   * small colour utilities (`mix`, `with_alpha`) used to derive states

use egui::Color32;

/// A colour in Tailwind's OKLCH space. `l` is 0..1, `c` is chroma, `h` is
/// degrees.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Oklch {
    pub l: f32,
    pub c: f32,
    pub h: f32,
}

impl Oklch {
    pub const fn new(l: f32, c: f32, h: f32) -> Self {
        Self { l, c, h }
    }

    /// Convert to a paintable sRGB colour.
    pub fn srgb(self) -> Color32 {
        oklch_to_srgb(self.l, self.c, self.h)
    }
}

/// OKLCH -> sRGB. Uses Bjorn Ottosson's Oklab matrices and the sRGB transfer
/// function; the inverse of what Tailwind uses to author the palette.
pub fn oklch_to_srgb(l: f32, c: f32, h: f32) -> Color32 {
    let h = h.to_radians();
    let a = c * h.cos();
    let b = c * h.sin();

    let l_ = l + 0.396_337_78 * a + 0.215_803_76 * b;
    let m_ = l - 0.105_561_35 * a - 0.063_854_17 * b;
    let s_ = l - 0.089_484_18 * a - 1.291_485_5 * b;

    let l3 = l_ * l_ * l_;
    let m3 = m_ * m_ * m_;
    let s3 = s_ * s_ * s_;

    let r = 4.076_741_7 * l3 - 3.307_711_6 * m3 + 0.230_969_93 * s3;
    let g = -1.268_438 * l3 + 2.609_757_4 * m3 - 0.341_319_4 * s3;
    let b = -0.004_196_086_3 * l3 - 0.703_418_6 * m3 + 1.707_614_7 * s3;

    Color32::from_rgb(encode_srgb(r), encode_srgb(g), encode_srgb(b))
}

/// Linear-light channel -> 8-bit sRGB.
fn encode_srgb(x: f32) -> u8 {
    let x = x.clamp(0.0, 1.0);
    let s = if x <= 0.003_130_8 {
        12.92 * x
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

/// Rebuild a colour with a new alpha (0..1).
pub fn with_alpha(color: Color32, a: f32) -> Color32 {
    let a = (a.clamp(0.0, 1.0) * 255.0).round() as u8;
    Color32::from_rgba_unmultiplied(color.r(), color.g(), color.b(), a)
}

/// Blend two colours. `t` is the weight of `b` (0 -> all `a`, 1 -> all `b`).
pub fn mix(a: Color32, b: Color32, t: f32) -> Color32 {
    let t = t.clamp(0.0, 1.0);
    let lerp = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round() as u8;
    Color32::from_rgb(lerp(a.r(), b.r()), lerp(a.g(), b.g()), lerp(a.b(), b.b()))
}

/// The Tailwind v4 default palette, in OKLCH.
///
/// Kept complete (not just the shades currently in use) so themes can reach for
/// any Tailwind colour without editing this module.
#[allow(dead_code)]
pub mod color {
    use super::Oklch;
    use egui::Color32;

    macro_rules! palette {
        ($($name:ident = ($l:expr, $c:expr, $h:expr);)*) => {
            $(pub const $name: Oklch = Oklch::new($l, $c, $h);)*
        };
    }

    palette! {
        // zinc
        ZINC_50 = (0.985, 0.0, 0.0);
        ZINC_100 = (0.967, 0.001, 286.375);
        ZINC_200 = (0.92, 0.004, 286.32);
        ZINC_300 = (0.871, 0.006, 286.286);
        ZINC_400 = (0.705, 0.015, 286.067);
        ZINC_500 = (0.552, 0.016, 285.938);
        ZINC_600 = (0.442, 0.017, 285.786);
        ZINC_700 = (0.37, 0.013, 285.805);
        ZINC_800 = (0.274, 0.006, 286.033);
        ZINC_900 = (0.21, 0.006, 285.885);
        ZINC_950 = (0.141, 0.005, 285.823);

        // neutral
        NEUTRAL_50 = (0.985, 0.0, 0.0);
        NEUTRAL_100 = (0.97, 0.0, 0.0);
        NEUTRAL_200 = (0.922, 0.0, 0.0);
        NEUTRAL_300 = (0.87, 0.0, 0.0);
        NEUTRAL_400 = (0.708, 0.0, 0.0);
        NEUTRAL_500 = (0.556, 0.0, 0.0);
        NEUTRAL_600 = (0.439, 0.0, 0.0);
        NEUTRAL_700 = (0.371, 0.0, 0.0);
        NEUTRAL_800 = (0.269, 0.0, 0.0);
        NEUTRAL_900 = (0.205, 0.0, 0.0);
        NEUTRAL_950 = (0.145, 0.0, 0.0);

        // stone
        STONE_50 = (0.985, 0.001, 106.423);
        STONE_100 = (0.97, 0.001, 106.424);
        STONE_200 = (0.923, 0.003, 48.717);
        STONE_300 = (0.869, 0.005, 56.366);
        STONE_400 = (0.709, 0.01, 56.259);
        STONE_500 = (0.553, 0.013, 58.071);
        STONE_600 = (0.444, 0.011, 73.639);
        STONE_700 = (0.374, 0.01, 67.558);
        STONE_800 = (0.268, 0.007, 34.298);
        STONE_900 = (0.216, 0.006, 56.043);
        STONE_950 = (0.147, 0.004, 49.25);

        // indigo
        INDIGO_50 = (0.962, 0.018, 272.314);
        INDIGO_100 = (0.93, 0.034, 272.788);
        INDIGO_200 = (0.87, 0.065, 274.039);
        INDIGO_300 = (0.785, 0.115, 274.713);
        INDIGO_400 = (0.673, 0.182, 276.935);
        INDIGO_500 = (0.585, 0.233, 277.117);
        INDIGO_600 = (0.511, 0.262, 276.966);
        INDIGO_700 = (0.457, 0.24, 277.023);
        INDIGO_800 = (0.398, 0.195, 277.366);
        INDIGO_900 = (0.359, 0.144, 278.697);
        INDIGO_950 = (0.257, 0.09, 281.288);

        // violet
        VIOLET_300 = (0.811, 0.111, 293.571);
        VIOLET_400 = (0.702, 0.183, 293.541);
        VIOLET_500 = (0.606, 0.25, 292.717);
        VIOLET_600 = (0.541, 0.281, 293.009);
        VIOLET_900 = (0.38, 0.189, 293.745);
        VIOLET_950 = (0.283, 0.141, 291.089);

        // fuchsia
        FUCHSIA_400 = (0.74, 0.238, 322.16);
        FUCHSIA_500 = (0.667, 0.295, 322.15);
        FUCHSIA_600 = (0.591, 0.293, 322.896);

        // emerald
        EMERALD_300 = (0.845, 0.143, 164.978);
        EMERALD_400 = (0.765, 0.177, 163.223);
        EMERALD_500 = (0.696, 0.17, 162.48);
        EMERALD_600 = (0.596, 0.145, 163.225);
        EMERALD_900 = (0.378, 0.077, 168.94);
        EMERALD_950 = (0.262, 0.051, 172.552);

        // green
        GREEN_400 = (0.792, 0.209, 151.711);
        GREEN_500 = (0.723, 0.219, 149.579);
        GREEN_600 = (0.627, 0.194, 149.214);
        GREEN_900 = (0.393, 0.095, 152.535);
        GREEN_950 = (0.266, 0.065, 152.934);

        // sky
        SKY_300 = (0.828, 0.111, 230.318);
        SKY_400 = (0.746, 0.16, 232.661);
        SKY_500 = (0.685, 0.169, 237.323);
        SKY_600 = (0.588, 0.158, 241.966);

        // blue
        BLUE_400 = (0.707, 0.165, 254.624);
        BLUE_500 = (0.623, 0.214, 259.815);
        BLUE_600 = (0.546, 0.245, 262.881);
        BLUE_700 = (0.488, 0.243, 264.376);

        // amber
        AMBER_300 = (0.879, 0.169, 91.605);
        AMBER_400 = (0.828, 0.189, 84.429);
        AMBER_500 = (0.769, 0.188, 70.08);
        AMBER_600 = (0.666, 0.179, 58.318);
        AMBER_700 = (0.555, 0.163, 48.998);

        // orange
        ORANGE_50 = (0.98, 0.016, 73.684);
        ORANGE_100 = (0.954, 0.038, 75.164);
        ORANGE_400 = (0.75, 0.183, 55.934);
        ORANGE_500 = (0.705, 0.213, 47.604);
        ORANGE_600 = (0.646, 0.222, 41.116);
        ORANGE_700 = (0.553, 0.195, 38.402);

        // lime
        LIME_300 = (0.897, 0.196, 126.665);
        LIME_400 = (0.841, 0.238, 128.85);
        LIME_500 = (0.768, 0.233, 130.85);

        // red
        RED_300 = (0.808, 0.114, 19.571);
        RED_400 = (0.704, 0.191, 22.216);
        RED_500 = (0.637, 0.237, 25.331);
        RED_600 = (0.577, 0.245, 27.325);
        RED_700 = (0.505, 0.213, 27.518);

        // rose
        ROSE_400 = (0.712, 0.194, 13.428);
        ROSE_500 = (0.645, 0.246, 16.439);
    }

    /// Tailwind black / white.
    pub const BLACK: Color32 = Color32::from_rgb(0, 0, 0);
    pub const WHITE: Color32 = Color32::from_rgb(255, 255, 255);
}

/// Tailwind's spacing scale. Tailwind's base unit is 0.25rem (4px at a 16px
/// root), so every step is a multiple of 4.
pub mod space {
    pub const XS: f32 = 4.0;
    pub const SM: f32 = 8.0;
    pub const MD: f32 = 12.0;
    pub const LG: f32 = 16.0;
    pub const XL: f32 = 24.0;
    pub const XXL: f32 = 32.0;
}

/// Tailwind's radius scale, in pixels (xs -> 2px ... 4xl -> 32px).
#[allow(dead_code)]
pub mod radius {
    pub const XS: f32 = 4.0;
    pub const SM: f32 = 6.0;
    pub const MD: f32 = 8.0;
    pub const LG: f32 = 12.0;
    pub const XL: f32 = 16.0;
    pub const XXL: f32 = 24.0;
    pub const PILL: f32 = 999.0;
}

/// Tailwind's type scale, in pixels (16px root).
pub mod type_size {
    pub const MICRO: f32 = 11.0;
    pub const CAPTION: f32 = 12.0;
    pub const SMALL: f32 = 13.0;
    pub const BODY: f32 = 14.0;
    pub const TITLE: f32 = 16.0;
    pub const HEADING: f32 = 20.0;
    pub const HERO: f32 = 24.0;
}

/// Tailwind's shadow scale, as `(x, y, blur, spread)` before colour.
#[allow(dead_code)]
pub mod shadow {
    pub type Preset = (f32, f32, f32, f32);
    pub const XS: Preset = (0.0, 1.0, 2.0, 0.0);
    pub const SM: Preset = (0.0, 1.0, 3.0, 0.0);
    pub const MD: Preset = (0.0, 4.0, 6.0, -1.0);
    pub const LG: Preset = (0.0, 10.0, 15.0, -3.0);
    pub const XL: Preset = (0.0, 20.0, 25.0, -5.0);
    pub const XXL: Preset = (0.0, 25.0, 50.0, -12.0);

    /// Build an egui shadow. Tailwind uses negative spread, which egui cannot
    /// express (spread is unsigned), so it is folded into the blur.
    pub fn egui(preset: Preset, color: egui::Color32) -> egui::epaint::Shadow {
        let (x, y, blur, spread) = preset;
        let blur = (blur - spread.min(0.0)).round().clamp(0.0, 255.0) as u8;
        let spread = spread.max(0.0).round().clamp(0.0, 255.0) as u8;
        egui::epaint::Shadow {
            offset: [x.round() as i8, y.round() as i8],
            blur,
            spread,
            color,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oklch_endpoints_map_to_black_and_white() {
        assert_eq!(oklch_to_srgb(0.0, 0.0, 0.0), Color32::from_rgb(0, 0, 0));
        assert_eq!(
            oklch_to_srgb(1.0, 0.0, 0.0),
            Color32::from_rgb(255, 255, 255)
        );
    }

    #[test]
    fn zinc_950_matches_tailwind() {
        // Tailwind v4 zinc-950 is oklch(14.1% 0.005 285.823) ~ #09090b.
        let c = color::ZINC_950.srgb();
        let close = |a: u8, b: u8| (a as i16 - b as i16).abs() <= 3;
        assert!(
            close(c.r(), 0x09) && close(c.g(), 0x09) && close(c.b(), 0x0b),
            "zinc-950 converted to {c:?}"
        );
    }
}
