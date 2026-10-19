//! The card Orbit shows over a game: "your game started", "the replay is saved".
//!
//! It is a plain native window, not a second web view. The game-start notice
//! used to be the overlay window shown in a resting state for five seconds:
//! that is another WebView2 instance, roughly 50 MB of processes, created every
//! time a game starts and thrown away again. A capture that finishes after the
//! overlay was closed has nowhere to show its toast either, and this is what it
//! uses instead.
//!
//! The card is deliberately the panel's own toast, drawn natively: the same 352
//! by 64 shape, the same 16 pixel corners, the same 24 pixel icon column, the
//! same 13 and 11 pixel type. It is painted with GDI+ into a premultiplied bitmap and
//! handed to the compositor with `UpdateLayeredWindow`, so every edge is
//! antialiased, the corners are real transparency rather than a clipped region,
//! and a scaled display redraws the card at its own size instead of stretching
//! a small bitmap. It never takes focus or a click from the game underneath,
//! and Windows is asked to leave it out of screen captures so a recording does
//! not film its own confirmation.

/// The colours of the card. They come from the player's theme, so the notice
/// looks like the rest of Orbit rather than like a separate program.
#[derive(Clone, Copy, Debug)]
pub struct Palette {
    /// 0xRRGGBB, not a COLORREF; the palette is written the same way the
    /// themes file writes it.
    pub panel: u32,
    pub text: u32,
    pub muted: u32,
    pub accent: u32,
}

impl Palette {
    /// Orbit's own Nebula theme, which is what a saved colour means. It is a
    /// constant because the overlay keeps one in a `static`, and a `static`
    /// cannot call a function to make its value.
    pub const NEBULA: Self = Self {
        panel: 0x14_12_2a,
        text: 0xec_eb_ff,
        muted: 0x9a_96_c4,
        accent: 0x8b_5c_f6,
    };
}

impl Default for Palette {
    fn default() -> Self {
        Self::NEBULA
    }
}

/// The small picture in the chip. It mirrors the icon the panel's own toast
/// uses for the same news, so a save that had to be reported natively does not
/// arrive looking like a different program's notification.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Icon {
    /// The Orbit mark, for the game-start notice.
    Mark,
    Camera,
    Record,
    Replay,
    Alert,
}

#[derive(Clone, Debug)]
pub struct Card {
    pub title: String,
    /// The one line under the title. Empty means the title stands alone.
    pub detail: String,
    /// A failure stays up for longer, and is tinted like one.
    pub error: bool,
    pub palette: Palette,
    pub icon: Icon,
}

impl Card {
    pub fn ok(title: &str, detail: &str, palette: Palette) -> Self {
        Self {
            title: title.to_string(),
            detail: detail.to_string(),
            error: false,
            palette,
            icon: Icon::Mark,
        }
    }

    pub fn error(title: &str, detail: &str, palette: Palette) -> Self {
        Self {
            title: title.to_string(),
            detail: detail.to_string(),
            error: true,
            palette,
            icon: Icon::Alert,
        }
    }

    /// The same card with another picture in the chip.
    pub fn with_icon(mut self, icon: Icon) -> Self {
        self.icon = icon;
        self
    }
}

/// Show the card without blocking the caller. It hides itself after a few
/// seconds and never takes focus or a click from the game underneath.
pub fn show(card: Card) {
    #[cfg(windows)]
    {
        let _ = std::thread::Builder::new()
            .name("orbit-notice".to_string())
            .spawn(move || {
                if let Err(error) = win::run(card) {
                    log::warn!("the Orbit card was not shown: {error}");
                }
            });
    }
    #[cfg(not(windows))]
    {
        let _ = card;
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Once;
    use std::time::{Duration, Instant};

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, EndPaint, GetDC,
        ReleaseDC, SelectObject, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION,
        DIB_RGB_COLORS, HGDIOBJ, PAINTSTRUCT,
    };
    use windows::Win32::Graphics::GdiPlus::{
        CompositingQualityHighQuality, FillModeAlternate, GdiplusStartup, GdiplusStartupInput,
        GdiplusStartupOutput, GdipAddPathArc, GdipClosePathFigure, GdipCreateBitmapFromScan0,
        GdipCreateFont, GdipCreateFontFamilyFromName, GdipCreatePath, GdipCreatePen1,
        GdipCreateSolidFill, GdipCreateStringFormat, GdipDeleteBrush, GdipDeleteFont,
        GdipDeleteFontFamily, GdipDeleteGraphics, GdipDeletePath, GdipDeletePen,
        GdipDeleteStringFormat, GdipDisposeImage, GdipDrawArc, GdipDrawEllipse, GdipDrawImageRectI,
        GdipDrawLine, GdipDrawPath, GdipDrawString, GdipFillEllipse, GdipFillPath, GdipFillPolygon,
        GdipGetImageGraphicsContext, GdipSetCompositingQuality, GdipSetPixelOffsetMode,
        GdipSetSmoothingMode, GdipSetStringFormatAlign, GdipSetStringFormatLineAlign,
        GdipSetStringFormatTrimming, GdipSetTextRenderingHint, GpBitmap, GpBrush, GpFont,
        GpFontFamily, GpGraphics, GpImage, GpPath, GpPen, GpSolidFill, GpStringFormat,
        PixelOffsetModeHighQuality, PointF, RectF, SmoothingModeAntiAlias, StringAlignmentCenter,
        StringAlignmentNear, StringTrimmingEllipsisCharacter, TextRenderingHintAntiAliasGridFit,
        UnitPixel,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetSystemMetrics,
        PeekMessageW, PostQuitMessage, RegisterClassW, SetWindowDisplayAffinity, ShowWindow,
        TranslateMessage, UpdateLayeredWindow, MSG, PM_REMOVE, SM_CXSCREEN, SW_SHOWNOACTIVATE,
        ULW_ALPHA, WDA_EXCLUDEFROMCAPTURE, WM_DESTROY, WM_ERASEBKGND, WM_PAINT, WM_QUIT,
        WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT, WS_POPUP,
    };

    use super::{Card, Icon, Palette};

    /// The Orbit mark, as 256 by 256 anti-aliased coverage. The picture is
    /// white; recolouring it here is what lets the card follow the theme.
    /// It is the same drawing as `src/assets/orbit-mark.svg`, rendered once:
    /// rasterise that file at 512 by 512 on a transparent background, crop to
    /// the drawing's own bounds, keep the alpha channel only and sample it down
    /// to 256. Crop first, because the SVG's box has a ring of empty space
    /// around the mark and at card size every pixel of that space is a pixel
    /// the mark does not get. Change one, change the other.
    const MARK: &[u8] = include_bytes!("orbit-mark-mask.bin");
    const MARK_SIZE: usize = 256;

    // The panel toast's own measurements, at 96 DPI. Everything is multiplied
    // by the display scale, and the card is drawn at that size, not stretched.
    const WIDTH: f32 = 352.0;
    const HEIGHT: f32 = 64.0;
    const RADIUS: f32 = 16.0;
    const PAD: f32 = 14.0;
    /// The space the picture takes before the text starts. There is no chip
    /// behind it any more, but the text still aligns to a fixed column.
    const ICON_BOX: f32 = 24.0;
    const GAP: f32 = 10.0;
    const MARK_DRAW: f32 = 22.0;
    const ICON_DRAW: f32 = 18.0;
    const TITLE_SIZE: f32 = 13.0;
    const DETAIL_SIZE: f32 = 11.0;
    const MARGIN_TOP: f32 = 48.0;
    const LIFETIME: Duration = Duration::from_millis(3600);
    const ERROR_LIFETIME: Duration = Duration::from_millis(6500);
    /// `PixelFormat32bppPARGB`. The `windows` crate does not generate the
    /// `PixelFormat` constants, and this is the one GDI+ needs so that the
    /// antialiased edges it paints already carry their own alpha.
    const PREMULTIPLIED_ARGB: i32 = 0x000E_200B;

    static CLASS: Once = Once::new();
    /// Three cards at most, stacked instead of drawn on top of each other.
    static SLOTS: AtomicU32 = AtomicU32::new(0);
    static GDIPLUS: Once = Once::new();
    static GDIPLUS_OK: AtomicBool = AtomicBool::new(false);

    /// Holds a stack slot for as long as the card lives, so a slot is given
    /// back even if drawing fails.
    struct Slot(u32);

    impl Slot {
        fn take() -> Option<Self> {
            loop {
                let bits = SLOTS.load(Ordering::SeqCst);
                let free = (0..3u32).find(|index| bits & (1u32 << index) == 0)?;
                if SLOTS.compare_exchange(bits, bits | (1 << free), Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                    return Some(Self(free));
                }
            }
        }
    }

    impl Drop for Slot {
        fn drop(&mut self) {
            SLOTS.fetch_and(!(1 << self.0), Ordering::SeqCst);
        }
    }

    fn scaled(value: f32, scale: f32) -> i32 {
        (value * scale).round() as i32
    }

    /// GDI+ is process wide and has to start once, on whichever thread draws
    /// the first card. It is never shut down: the process exits with it.
    fn gdiplus() -> bool {
        GDIPLUS.call_once(|| unsafe {
            let input = GdiplusStartupInput { GdiplusVersion: 1, ..Default::default() };
            let mut token = 0usize;
            let mut output = GdiplusStartupOutput::default();
            GDIPLUS_OK.store(GdiplusStartup(&mut token, &input, &mut output).0 == 0, Ordering::SeqCst);
        });
        GDIPLUS_OK.load(Ordering::SeqCst)
    }

    /// GDI+ takes colours as 0xAARRGGBB.
    fn argb(alpha: u8, rgb: u32) -> u32 {
        ((alpha as u32) << 24) | (rgb & 0x00ff_ffff)
    }

    /// The scale of the monitor the card is opening on. `GetDpiForWindow` is
    /// the only reading that accounts for a window that has just been created
    /// on a secondary display.
    fn window_scale(window: HWND) -> f32 {
        let dpi = unsafe { GetDpiForWindow(window) };
        if dpi == 0 { 1.0 } else { (dpi as f32 / 96.0).clamp(1.0, 3.0) }
    }

    pub(super) fn run(card: Card) -> Result<(), String> {
        if !gdiplus() {
            return Err("GDI+ did not start, so the card could not be drawn.".to_string());
        }
        // Kept until the window is gone, so the slot is not handed out twice.
        let slot = Slot::take();

        unsafe {
            let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
            let instance = HINSTANCE(module.0);
            CLASS.call_once(|| {
                let class = WNDCLASSW {
                    hInstance: instance,
                    lpfnWndProc: Some(wndproc),
                    lpszClassName: w!("OrbitNotice"),
                    ..Default::default()
                };
                let _ = RegisterClassW(&class);
            });

            // The window is created first and sized second: the only way to
            // know the scale of the monitor it lands on is to ask the window.
            let window = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
                w!("OrbitNotice"),
                w!("Orbit"),
                WS_POPUP,
                0,
                0,
                scaled(WIDTH, 1.0),
                scaled(HEIGHT, 1.0),
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.to_string())?;

            let scale = window_scale(window);
            let width = scaled(WIDTH, scale).max(64);
            let height = scaled(HEIGHT, scale).max(24);
            let screen = GetSystemMetrics(SM_CXSCREEN);
            let stack = slot.as_ref().map_or(0, |held| held.0 as i32) * (height + scaled(8.0, scale));
            let left = (screen - width) / 2;
            let top = scaled(MARGIN_TOP, scale) + stack;
            // Ten pixels lower than it will sit, so it can rise into place.
            let rise = scaled(10.0, scale);

            let screen_dc = GetDC(None);
            let memory = CreateCompatibleDC(Some(screen_dc));
            let mut header = BITMAPINFOHEADER::default();
            header.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            header.biWidth = width;
            header.biHeight = -height;
            header.biPlanes = 1;
            header.biBitCount = 32;
            header.biCompression = BI_RGB.0;
            let info = BITMAPINFO { bmiHeader: header, ..Default::default() };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let dib = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0)
                .map_err(|error| error.to_string())?;
            if bits.is_null() {
                let _ = DeleteObject(HGDIOBJ(dib.0));
                let _ = DeleteDC(memory);
                let _ = ReleaseDC(None, screen_dc);
                let _ = DestroyWindow(window);
                return Err("the card had no drawing surface".to_string());
            }
            let previous = SelectObject(memory, HGDIOBJ(dib.0));
            std::ptr::write_bytes(bits as *mut u8, 0, (width * height * 4) as usize);
            paint(bits, width, height, scale, &card);

            // A confirmation card has no business appearing inside a recording.
            let _ = SetWindowDisplayAffinity(window, WDA_EXCLUDEFROMCAPTURE);

            let lifetime = if card.error { ERROR_LIFETIME } else { LIFETIME };
            let size = SIZE { cx: width, cy: height };
            let origin = POINT { x: 0, y: 0 };
            let mut point = POINT { x: left, y: top - rise };
            let mut blend = BLENDFUNCTION {
                BlendOp: 0,
                BlendFlags: 0,
                SourceConstantAlpha: 0,
                AlphaFormat: 1,
            };
            let layered = |point: &POINT, alpha: u8, blend: &mut BLENDFUNCTION| {
                blend.SourceConstantAlpha = alpha;
                UpdateLayeredWindow(
                    window,
                    Some(screen_dc),
                    Some(point as *const POINT),
                    Some(&size as *const SIZE),
                    Some(memory),
                    Some(&origin as *const POINT),
                    COLORREF(0),
                    Some(blend as *const BLENDFUNCTION),
                    ULW_ALPHA,
                )
            };
            let _ = layered(&point, 0, &mut blend);
            let _ = ShowWindow(window, SW_SHOWNOACTIVATE);

            // A plain message pump with a deadline. There is no timer to cancel
            // and nothing to tear down if the window is closed early.
            const ENTER: f32 = 0.16;
            const LEAVE: f32 = 0.22;
            let mut message = MSG::default();
            let opened = Instant::now();
            let deadline = opened + lifetime;
            let mut alpha = 0u8;
            let mut offset = rise;
            'pump: loop {
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    if message.message == WM_QUIT {
                        break 'pump;
                    }
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                let remaining = deadline.saturating_duration_since(Instant::now()).as_secs_f32();
                // Rise and fade in quickly, fade out at the end. The exit is
                // what makes a card that is replaced feel replaced rather than
                // redrawn in place.
                let entering = (opened.elapsed().as_secs_f32() / ENTER).min(1.0);
                let leaving = (remaining / LEAVE).min(1.0);
                let eased = 1.0 - (1.0 - entering).powi(3);
                let next = (eased.min(leaving) * 255.0).round() as u8;
                let next_offset = ((1.0 - eased) * rise as f32).round() as i32;
                if next != alpha || next_offset != offset {
                    alpha = next;
                    offset = next_offset;
                    point.y = top - offset;
                    let _ = layered(&point, alpha, &mut blend);
                }
                if remaining <= 0.0 {
                    break;
                }
                std::thread::sleep(Duration::from_millis(16));
            }

            let _ = SelectObject(memory, previous);
            let _ = DeleteObject(HGDIOBJ(dib.0));
            let _ = DeleteDC(memory);
            let _ = ReleaseDC(None, screen_dc);
            let _ = DestroyWindow(window);
        }
        Ok(())
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_PAINT => {
                // The card is composited from its bitmap, not painted into a
                // window DC, but the message still has to be answered.
                let mut paint = PAINTSTRUCT::default();
                let _ = BeginPaint(hwnd, &mut paint);
                let _ = EndPaint(hwnd, &paint);
                LRESULT(0)
            }
            WM_ERASEBKGND => LRESULT(1),
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    // ---------------------------------------------------------------- drawing

    unsafe fn round_path(left: f32, top: f32, right: f32, bottom: f32, radius: f32) -> *mut GpPath {
        let mut path: *mut GpPath = std::ptr::null_mut();
        if GdipCreatePath(FillModeAlternate, &mut path).0 != 0 {
            return std::ptr::null_mut();
        }
        let r = radius.max(0.0).min((right - left) / 2.0).min((bottom - top) / 2.0);
        let d = r * 2.0;
        let _ = GdipAddPathArc(path, left, top, d, d, 180.0, 90.0);
        let _ = GdipAddPathArc(path, right - d, top, d, d, 270.0, 90.0);
        let _ = GdipAddPathArc(path, right - d, bottom - d, d, d, 0.0, 90.0);
        let _ = GdipAddPathArc(path, left, bottom - d, d, d, 90.0, 90.0);
        let _ = GdipClosePathFigure(path);
        path
    }

    unsafe fn fill_round(g: *mut GpGraphics, left: f32, top: f32, right: f32, bottom: f32, radius: f32, color: u32) {
        let path = round_path(left, top, right, bottom, radius);
        if path.is_null() {
            return;
        }
        let brush = solid(color);
        if !brush.is_null() {
            let _ = GdipFillPath(g, brush as *mut GpBrush, path);
            let _ = GdipDeleteBrush(brush as *mut GpBrush);
        }
        let _ = GdipDeletePath(path);
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn stroke_round(
        g: *mut GpGraphics,
        left: f32,
        top: f32,
        right: f32,
        bottom: f32,
        radius: f32,
        width: f32,
        color: u32,
    ) {
        let path = round_path(left, top, right, bottom, radius);
        if path.is_null() {
            return;
        }
        let stroke = pen(color, width);
        if !stroke.is_null() {
            let _ = GdipDrawPath(g, stroke, path);
            let _ = GdipDeletePen(stroke);
        }
        let _ = GdipDeletePath(path);
    }

    unsafe fn pen(color: u32, width: f32) -> *mut GpPen {
        let mut handle: *mut GpPen = std::ptr::null_mut();
        if GdipCreatePen1(color, width, UnitPixel, &mut handle).0 == 0 { handle } else { std::ptr::null_mut() }
    }

    unsafe fn solid(color: u32) -> *mut GpSolidFill {
        let mut handle: *mut GpSolidFill = std::ptr::null_mut();
        if GdipCreateSolidFill(color, &mut handle).0 == 0 { handle } else { std::ptr::null_mut() }
    }

    fn family(name: PCWSTR) -> *mut GpFontFamily {
        unsafe {
            let mut handle: *mut GpFontFamily = std::ptr::null_mut();
            if GdipCreateFontFamilyFromName(name, std::ptr::null_mut(), &mut handle).0 == 0 {
                handle
            } else {
                std::ptr::null_mut()
            }
        }
    }

    unsafe fn font(family: *mut GpFontFamily, size: f32) -> *mut GpFont {
        if family.is_null() {
            return std::ptr::null_mut();
        }
        let mut handle: *mut GpFont = std::ptr::null_mut();
        // FontStyleRegular is 0; GDI+ picks the face's own weight.
        if GdipCreateFont(family, size.max(1.0), 0, UnitPixel, &mut handle).0 == 0 {
            handle
        } else {
            std::ptr::null_mut()
        }
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn line(
        g: *mut GpGraphics,
        font: *mut GpFont,
        format: *mut GpStringFormat,
        color: u32,
        value: &str,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
    ) {
        if font.is_null() || format.is_null() || value.is_empty() || width <= 1.0 {
            return;
        }
        let brush = solid(color);
        if brush.is_null() {
            return;
        }
        let wide: Vec<u16> = value.encode_utf16().collect();
        let rect = RectF { X: left, Y: top, Width: width, Height: height.max(1.0) };
        let _ = GdipDrawString(
            g,
            PCWSTR(wide.as_ptr()),
            wide.len() as i32,
            font,
            &rect,
            format,
            brush as *const GpBrush,
        );
        let _ = GdipDeleteBrush(brush as *mut GpBrush);
    }

    /// The mark, tinted with the accent, blended at the size it is drawn.
    ///
    /// The 256 pixel coverage is averaged down to the target size here rather
    /// than handed to a scaler: area averaging is what keeps the thin orbit
    /// lines smooth at 20 pixels, and the small alpha lift keeps them from
    /// dissolving into the chip.
    unsafe fn draw_mark(g: *mut GpGraphics, left: f32, top: f32, size: i32, accent: u32) {
        let n = size.max(8) as u32;
        if MARK.len() < MARK_SIZE * MARK_SIZE {
            return;
        }
        let source = MARK_SIZE as u32;
        let mut pixels = vec![0u8; (n * n * 4) as usize];
        let red = (accent >> 16) & 0xff;
        let green = (accent >> 8) & 0xff;
        let blue = accent & 0xff;
        for dy in 0..n {
            let y0 = dy * source / n;
            let y1 = (((dy + 1) * source) / n).max(y0 + 1).min(source);
            for dx in 0..n {
                let x0 = dx * source / n;
                let x1 = (((dx + 1) * source) / n).max(x0 + 1).min(source);
                let mut sum = 0u32;
                let mut count = 0u32;
                for y in y0..y1 {
                    for x in x0..x1 {
                        sum += MARK[(y * source + x) as usize] as u32;
                        count += 1;
                    }
                }
                let mut alpha = if count == 0 { 0 } else { sum / count };
                if n <= 48 {
                    // At card size one orbit line is thinner than a pixel, and
                    // area sampling alone leaves it half transparent.
                    alpha = (255.0 * (alpha as f32 / 255.0).powf(0.85)).round() as u32;
                }
                let out = ((dy * n + dx) * 4) as usize;
                // Premultiplied BGRA, which is what PARGB expects.
                pixels[out] = ((blue * alpha) / 255) as u8;
                pixels[out + 1] = ((green * alpha) / 255) as u8;
                pixels[out + 2] = ((red * alpha) / 255) as u8;
                pixels[out + 3] = alpha as u8;
            }
        }
        let mut bitmap: *mut GpBitmap = std::ptr::null_mut();
        if GdipCreateBitmapFromScan0(size, size, size * 4, PREMULTIPLIED_ARGB, Some(pixels.as_ptr()), &mut bitmap).0 != 0 {
            return;
        }
        let _ = GdipDrawImageRectI(g, bitmap as *mut GpImage, left.round() as i32, top.round() as i32, size, size);
        let _ = GdipDisposeImage(bitmap as *mut GpImage);
    }

    /// The toast icons, drawn as shapes so they stay sharp at any scale.
    unsafe fn draw_icon(g: *mut GpGraphics, icon: Icon, cx: f32, cy: f32, size: f32, accent: u32) {
        let half = size / 2.0;
        let x = cx - half;
        let y = cy - half;
        let width = (size * 0.09).max(1.0);
        let color = argb(255, accent);
        match icon {
            Icon::Camera => {
                stroke_round(
                    g,
                    x + size * 0.03,
                    y + size * 0.26,
                    x + size * 0.97,
                    y + size * 0.92,
                    size * 0.18,
                    width,
                    color,
                );
                // The viewfinder bump sits on top of the body.
                fill_round(
                    g,
                    x + size * 0.28,
                    y + size * 0.08,
                    x + size * 0.72,
                    y + size * 0.28,
                    size * 0.06,
                    color,
                );
                let lens = size * 0.22;
                let stroke = pen(color, width);
                if !stroke.is_null() {
                    let _ = GdipDrawEllipse(g, stroke, cx - lens, cy + size * 0.09 - lens, lens * 2.0, lens * 2.0);
                    let _ = GdipDeletePen(stroke);
                }
            }
            Icon::Record => {
                let brush = solid(color);
                if !brush.is_null() {
                    let r = size * 0.28;
                    let _ = GdipFillEllipse(g, brush as *mut GpBrush, cx - r, cy - r, r * 2.0, r * 2.0);
                    let _ = GdipDeleteBrush(brush as *mut GpBrush);
                }
            }
            Icon::Replay => {
                let stroke = pen(color, width);
                if !stroke.is_null() {
                    let r = size * 0.78;
                    let _ = GdipDrawArc(g, stroke, cx - r / 2.0, cy - r / 2.0, r, r, 300.0, 280.0);
                    let _ = GdipDeletePen(stroke);
                }
                let brush = solid(color);
                if !brush.is_null() {
                    let points = [
                        PointF { X: cx + size * 0.02, Y: cy - size * 0.52 },
                        PointF { X: cx + size * 0.44, Y: cy - size * 0.34 },
                        PointF { X: cx + size * 0.08, Y: cy - size * 0.12 },
                    ];
                    let _ = GdipFillPolygon(g, brush as *mut GpBrush, points.as_ptr(), 3, FillModeAlternate);
                    let _ = GdipDeleteBrush(brush as *mut GpBrush);
                }
            }
            Icon::Alert => {
                let stroke = pen(color, width);
                if !stroke.is_null() {
                    let r = size * 0.40;
                    let _ = GdipDrawEllipse(g, stroke, cx - r, cy - r, r * 2.0, r * 2.0);
                    let _ = GdipDrawLine(g, stroke, cx, cy - size * 0.18, cx, cy + size * 0.06);
                    let _ = GdipDeletePen(stroke);
                }
                let brush = solid(color);
                if !brush.is_null() {
                    let dot = size * 0.055;
                    let _ = GdipFillEllipse(g, brush as *mut GpBrush, cx - dot, cy + size * 0.16 - dot, dot * 2.0, dot * 2.0);
                    let _ = GdipDeleteBrush(brush as *mut GpBrush);
                }
            }
            Icon::Mark => {}
        }
    }

    /// Paint the whole card into the premultiplied bitmap at `width` by
    /// `height` physical pixels.
    unsafe fn paint(bits: *mut c_void, width: i32, height: i32, scale: f32, card: &Card) {
        let mut image: *mut GpBitmap = std::ptr::null_mut();
        if GdipCreateBitmapFromScan0(width, height, width * 4, PREMULTIPLIED_ARGB, Some(bits as *const u8), &mut image).0 != 0 {
            return;
        }
        let mut g: *mut GpGraphics = std::ptr::null_mut();
        if GdipGetImageGraphicsContext(image as *mut GpImage, &mut g).0 != 0 {
            let _ = GdipDisposeImage(image as *mut GpImage);
            return;
        }
        let _ = GdipSetSmoothingMode(g, SmoothingModeAntiAlias);
        let _ = GdipSetTextRenderingHint(g, TextRenderingHintAntiAliasGridFit);
        let _ = GdipSetCompositingQuality(g, CompositingQualityHighQuality);
        let _ = GdipSetPixelOffsetMode(g, PixelOffsetModeHighQuality);

        let Palette { panel, text, muted, accent } = card.palette;
        // A failure is a rose accent, whatever the theme's own accent is.
        let accent = if card.error { 0xfb_71_85 } else { accent };
        let w = width as f32;
        let h = height as f32;
        let radius = RADIUS * scale;

        // The card itself: the panel at 94%, exactly like `.orbit-toast-card`,
        // with the same 9% hairline border.
        fill_round(g, 0.0, 0.0, w, h, radius, argb(240, panel));
        stroke_round(g, 0.5, 0.5, w - 0.5, h - 0.5, radius - 0.5, 1.0, argb(23, text));

        // The picture has no square behind it: the accent colour is the mark.
        // A tinted chip under a tinted glyph was two shapes saying one thing,
        // and at this size the chip won.
        let pad = PAD * scale;
        let box = ICON_BOX * scale;
        let box_left = pad;
        let box_top = (h - box) / 2.0;
        if card.icon == Icon::Mark {
            let mark = scaled(MARK_DRAW, scale);
            draw_mark(g, box_left + (box - mark as f32) / 2.0, box_top + (box - mark as f32) / 2.0, mark, accent);
        } else {
            draw_icon(g, card.icon, box_left + box / 2.0, box_top + box / 2.0, ICON_DRAW * scale, accent);
        }

        let text_left = box_left + box + GAP * scale;
        let text_width = (w - pad - text_left).max(1.0);
        let semibold = {
            let handle = family(w!("Segoe UI Semibold"));
            if handle.is_null() { family(w!("Segoe UI")) } else { handle }
        };
        let regular = family(w!("Segoe UI"));
        let title_font = font(semibold, TITLE_SIZE * scale);
        let detail_font = font(regular, DETAIL_SIZE * scale);
        let mut format: *mut GpStringFormat = std::ptr::null_mut();
        if GdipCreateStringFormat(0, 0, &mut format).0 != 0 || format.is_null() {
            format = std::ptr::null_mut();
        } else {
            let _ = GdipSetStringFormatTrimming(format, StringTrimmingEllipsisCharacter);
            let _ = GdipSetStringFormatLineAlign(format, StringAlignmentCenter);
            let _ = GdipSetStringFormatAlign(format, StringAlignmentNear);
        }

        let title_line = TITLE_SIZE * scale * 1.45;
        let detail_line = DETAIL_SIZE * scale * 1.45;
        let between = 0.5 * scale;
        if card.detail.is_empty() {
            line(g, title_font, format, argb(255, text), &card.title, text_left, 0.0, text_width, h);
        } else {
            let block = title_line + between + detail_line;
            let top = (h - block) / 2.0;
            line(g, title_font, format, argb(255, text), &card.title, text_left, top, text_width, title_line);
            line(
                g,
                detail_font,
                format,
                argb(255, muted),
                &card.detail,
                text_left,
                top + title_line + between,
                text_width,
                detail_line,
            );
        }

        if !format.is_null() {
            let _ = GdipDeleteStringFormat(format);
        }
        let _ = GdipDeleteFont(title_font);
        let _ = GdipDeleteFont(detail_font);
        if !semibold.is_null() {
            let _ = GdipDeleteFontFamily(semibold);
        }
        if !regular.is_null() {
            let _ = GdipDeleteFontFamily(regular);
        }
        let _ = GdipDeleteGraphics(g);
        let _ = GdipDisposeImage(image as *mut GpImage);
    }
}
