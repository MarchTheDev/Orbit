use std::path::Path;
use std::sync::Mutex;
use std::sync::OnceLock;

use egui::{ColorImage, Context, Image, TextureHandle, Vec2};

/// Largest edge we decode a cover to. Real cover art is far smaller than this,
/// so nothing visible is lost, but a stray 8000px image cannot stall the UI.
const MAX_EDGE: u32 = 1024;

/// Cache key for a cover image, including the mtime so edits refresh the art.
fn cache_key(path: &Path) -> String {
    let mtime = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("orbit:cover:{}:{mtime}", path.display())
}

/// Which covers we have already tried and failed to read, so a broken file is
/// not read from disk on every frame.
fn failed() -> &'static Mutex<Vec<String>> {
    static FAILED: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    FAILED.get_or_init(|| Mutex::new(Vec::new()))
}

/// Load a cover image into egui's texture cache.
///
/// Returns `None` when the file cannot be decoded, so callers can fall back to
/// the generated placeholder. egui caches by our path+mtime key, so repeat
/// frames do no decoding work.
pub fn cover_texture(ctx: &Context, path: &Path) -> Option<TextureHandle> {
    let key = cache_key(path);
    if failed().lock().is_ok_and(|f| f.contains(&key)) {
        return None;
    }
    match decode(path) {
        Some(image) => Some(ctx.load_texture(&key, image, egui::TextureOptions::LINEAR)),
        None => {
            if let Ok(mut f) = failed().lock() {
                if !f.contains(&key) {
                    f.push(key);
                    // Keep the list from growing forever in long sessions.
                    if f.len() > 256 {
                        f.remove(0);
                    }
                }
            }
            None
        }
    }
}

/// Decode an image synchronously into an egui colour image, downscaling
/// anything oversized.
pub fn decode(path: &Path) -> Option<ColorImage> {
    let format = image::ImageFormat::from_path(path).ok()?;
    let bytes = std::fs::read(path).ok()?;
    let decoded = match image::load_from_memory_with_format(&bytes, format) {
        Ok(img) => img,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "could not decode cover image"
            );
            return None;
        }
    };

    let rgba = if decoded.width() > MAX_EDGE || decoded.height() > MAX_EDGE {
        decoded.thumbnail(MAX_EDGE, MAX_EDGE).to_rgba8()
    } else {
        decoded.to_rgba8()
    };

    let size = [rgba.width() as usize, rgba.height() as usize];
    if size[0] == 0 || size[1] == 0 {
        return None;
    }
    Some(ColorImage::from_rgba_unmultiplied(size, rgba.as_raw()))
}

/// Scale-to-fit a texture inside a box, preserving aspect ratio.
pub fn fit_cover(box_size: Vec2, tex_size: Vec2) -> Vec2 {
    if tex_size.x <= 0.0 || tex_size.y <= 0.0 {
        return box_size;
    }
    let scale = (box_size.x / tex_size.x).min(box_size.y / tex_size.y);
    if scale >= 1.0 {
        tex_size
    } else {
        tex_size * scale
    }
}

/// A cover image sized for painting, which egui 0.31 wants as a `SizedTexture`.
pub fn sized(tex: &TextureHandle) -> egui::load::SizedTexture {
    egui::load::SizedTexture::from_handle(tex)
}

/// Draw a cover image into an existing rectangle, scaled to fit.
pub fn paint_into(ui: &mut egui::Ui, tex: TextureHandle, rect: egui::Rect) {
    let fitted = fit_cover(rect.size(), tex.size_vec2());
    let target = egui::Rect::from_center_size(rect.center(), fitted);
    Image::from_texture(sized(&tex)).paint_at(ui, target);
}
