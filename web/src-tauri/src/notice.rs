//! The card Orbit shows over a game: "your game started", "the replay is saved".
//!
//! It is a plain native window, not a second web view. The game-start notice
//! used to be the overlay window shown in a resting state for five seconds:
//! that is another WebView2 instance, roughly 50 MB of processes, created every
//! time a game starts and thrown away again. A capture that finishes after the
//! overlay was closed has nowhere to show its toast either, and this is what it
//! uses instead.
//!
//! The card is drawn by hand in GDI: the panel colour, a rounded border, the
//! Orbit mark in the accent colour, a title and one quiet line. It never takes
//! focus or a click from the game underneath, and Windows is asked to leave it
//! out of screen captures so a recording does not film its own confirmation.

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

#[derive(Clone, Debug)]
pub struct Card {
    pub title: String,
    /// The one line under the title. Empty means the title stands alone.
    pub detail: String,
    /// A failure stays up for longer, and is tinted like one.
    pub error: bool,
    pub palette: Palette,
}

impl Card {
    pub fn ok(title: &str, detail: &str, palette: Palette) -> Self {
        Self { title: title.to_string(), detail: detail.to_string(), error: false, palette }
    }

    pub fn error(title: &str, detail: &str, palette: Palette) -> Self {
        Self { title: title.to_string(), detail: detail.to_string(), error: true, palette }
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
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Once;
    use std::time::{Duration, Instant};

    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        AlphaBlend, BeginPaint, CreateCompatibleDC, CreateDIBSection, CreateFontW, CreatePen,
        CreateRoundRectRgn, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint,
        GetDC, GetDeviceCaps, ReleaseDC, RoundRect, SelectObject, SetBkMode, SetTextColor,
        SetWindowRgn, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, CLEARTYPE_QUALITY,
        CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX,
        DT_SINGLELINE, DT_VCENTER, HDC, HGDIOBJ, LOGPIXELSY, OUT_DEFAULT_PRECIS, PAINTSTRUCT,
        PS_SOLID, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
        GetSystemMetrics, PeekMessageW, PostQuitMessage, RegisterClassW, SetWindowDisplayAffinity,
        ShowWindow, TranslateMessage, MSG, PM_REMOVE, SM_CXSCREEN, SW_SHOWNOACTIVATE, WM_DESTROY,
        WM_ERASEBKGND, WM_PAINT, WM_QUIT, WDA_EXCLUDEFROMCAPTURE, WNDCLASSW, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
    };

    use super::{Card, Palette};

    /// The Orbit mark, as 128 by 128 anti-aliased coverage. The picture is
    /// white; recolouring it here is what lets the card follow the theme.
    /// It is the same drawing as `src/assets/orbit-mark.svg`, rendered once:
    /// rasterise that file at 128 by 128 on a transparent background and keep
    /// the alpha channel only. Change one, change the other.
    const MARK: &[u8] = include_bytes!("orbit-mark-mask.bin");
    const MARK_SIZE: usize = 128;

    // Sizes at 96 DPI. Everything is multiplied by the display scale.
    const WIDTH: f32 = 392.0;
    const HEIGHT: f32 = 88.0;
    const RADIUS: f32 = 18.0;
    const CHIP: f32 = 44.0;
    const CHIP_RADIUS: f32 = 14.0;
    const MARK_DRAW: f32 = 26.0;
    const MARGIN_TOP: f32 = 48.0;
    const MARGIN: f32 = 18.0;
    const LIFETIME: Duration = Duration::from_millis(4200);
    const ERROR_LIFETIME: Duration = Duration::from_millis(6500);

    thread_local! {
        static CARD: RefCell<Option<Card>> = const { RefCell::new(None) };
    }

    static CLASS: Once = Once::new();
    /// Three cards at most, stacked instead of drawn on top of each other.
    static SLOTS: AtomicU32 = AtomicU32::new(0);

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

    fn display_scale() -> f32 {
        unsafe {
            let screen = GetDC(None);
            if screen == Default::default() {
                return 1.0;
            }
            let dpi = GetDeviceCaps(Some(screen), LOGPIXELSY);
            let _ = ReleaseDC(None, screen);
            if dpi <= 0 { 1.0 } else { (dpi as f32 / 96.0).clamp(1.0, 3.0) }
        }
    }

    /// A copy of the colour with `amount` of `over` mixed into it.
    fn mix(base: u32, over: u32, amount: f32) -> u32 {
        let channel = |shift: u32| {
            let a = ((base >> shift) & 0xff) as f32;
            let b = ((over >> shift) & 0xff) as f32;
            (a + (b - a) * amount).round().clamp(0.0, 255.0) as u32
        };
        (channel(16) << 16) | (channel(8) << 8) | channel(0)
    }

    /// COLORREF is 0x00BBGGRR, the opposite of how a theme writes its colours.
    fn colorref(rgb: u32) -> COLORREF {
        let red = (rgb >> 16) & 0xff;
        let green = (rgb >> 8) & 0xff;
        let blue = rgb & 0xff;
        COLORREF(red | (green << 8) | (blue << 16))
    }

    pub(super) fn run(card: Card) -> Result<(), String> {
        let scale = display_scale();
        let width = scaled(WIDTH, scale);
        let height = scaled(HEIGHT, scale);
        let radius = scaled(RADIUS, scale);
        let margin = scaled(MARGIN_TOP, scale);
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

            CARD.with(|slot| *slot.borrow_mut() = Some(card));

            let screen = GetSystemMetrics(SM_CXSCREEN);
            let stack = slot.as_ref().map_or(0, |held| held.0 as i32) * (height + scaled(8.0, scale));
            let window = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
                w!("OrbitNotice"),
                w!("Orbit"),
                WS_POPUP,
                (screen - width) / 2,
                margin + stack,
                width,
                height,
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.to_string())?;

            // A rounded window, not a rounded painting inside a square one: the
            // corners have to let the game through.
            let region = CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);
            let _ = SetWindowRgn(window, Some(region), true);
            // A confirmation card has no business appearing inside a recording.
            let _ = SetWindowDisplayAffinity(window, WDA_EXCLUDEFROMCAPTURE);

            let _ = ShowWindow(window, SW_SHOWNOACTIVATE);

            let lifetime = CARD.with(|slot| {
                slot.borrow().as_ref().map_or(LIFETIME, |card| if card.error { ERROR_LIFETIME } else { LIFETIME })
            });

            // A plain message pump with a deadline. There is no timer to cancel
            // and nothing to tear down if the window is closed early.
            let mut message = MSG::default();
            let deadline = Instant::now() + lifetime;
            'pump: loop {
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    if message.message == WM_QUIT {
                        break 'pump;
                    }
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(24));
            }
            let _ = DestroyWindow(window);
        }
        Ok(())
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_PAINT => {
                let mut paint = PAINTSTRUCT::default();
                let dc = BeginPaint(hwnd, &mut paint);
                draw(hwnd, dc);
                let _ = EndPaint(hwnd, &paint);
                LRESULT(0)
            }
            // Everything is painted in one pass, so there is nothing to erase.
            WM_ERASEBKGND => LRESULT(1),
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    /// A filled rounded rectangle. The pen matches the brush so the outline is
    /// not a second colour.
    unsafe fn round_fill(dc: HDC, left: i32, top: i32, right: i32, bottom: i32, radius: i32, rgb: u32) {
        let brush = CreateSolidBrush(colorref(rgb));
        let pen = CreatePen(PS_SOLID, 1, colorref(rgb));
        let old_brush = SelectObject(dc, HGDIOBJ(brush.0));
        let old_pen = SelectObject(dc, HGDIOBJ(pen.0));
        let _ = RoundRect(dc, left, top, right, bottom, radius * 2, radius * 2);
        let _ = SelectObject(dc, old_pen);
        let _ = SelectObject(dc, old_brush);
        let _ = DeleteObject(HGDIOBJ(brush.0));
        let _ = DeleteObject(HGDIOBJ(pen.0));
    }

    /// The mark, tinted with the accent and blended onto the card through an
    /// alpha bitmap so its curves stay smooth.
    ///
    /// The bitmap is built at the size it is drawn: a 128 pixel mask scaled
    /// down by the blitter would lose the thin orbit lines.
    unsafe fn draw_mark(dc: HDC, left: i32, top: i32, size: i32, accent: u32) {
        const SOURCE: u32 = MARK_SIZE as u32;
        let size = size.max(8) as u32;
        let memory = CreateCompatibleDC(Some(dc));
        if memory == Default::default() {
            return;
        }
        let mut header = BITMAPINFOHEADER::default();
        header.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        header.biWidth = size as i32;
        header.biHeight = -(size as i32);
        header.biPlanes = 1;
        header.biBitCount = 32;
        // The header field is a plain u32; BI_RGB is the wrapped constant.
        header.biCompression = BI_RGB.0;
        let info = BITMAPINFO { bmiHeader: header, ..Default::default() };

        let mut bits: *mut c_void = std::ptr::null_mut();
        let Ok(bitmap) = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0) else {
            let _ = DeleteDC(memory);
            return;
        };
        if bits.is_null() || MARK.len() < (SOURCE * SOURCE) as usize {
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory);
            return;
        }

        // Premultiplied BGRA, which is what AC_SRC_ALPHA expects.
        let red = (accent >> 16) & 0xff;
        let green = (accent >> 8) & 0xff;
        let blue = accent & 0xff;
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, (size * size * 4) as usize);
        for dy in 0..size {
            let y0 = dy as u64 * SOURCE as u64 / size as u64;
            let y1 = (((dy + 1) as u64 * SOURCE as u64) / size as u64).max(y0 + 1).min(SOURCE as u64);
            for dx in 0..size {
                let x0 = dx as u64 * SOURCE as u64 / size as u64;
                let x1 = (((dx + 1) as u64 * SOURCE as u64) / size as u64).max(x0 + 1).min(SOURCE as u64);
                let mut sum = 0u32;
                let mut count = 0u32;
                for y in y0..y1 {
                    for x in x0..x1 {
                        sum += MARK[(y * SOURCE as u64 + x) as usize] as u32;
                        count += 1;
                    }
                }
                let alpha = if count == 0 { 0 } else { sum / count };
                let out = ((dy * size + dx) * 4) as usize;
                pixels[out] = ((blue * alpha) / 255) as u8;
                pixels[out + 1] = ((green * alpha) / 255) as u8;
                pixels[out + 2] = ((red * alpha) / 255) as u8;
                pixels[out + 3] = alpha as u8;
            }
        }

        let old = SelectObject(memory, HGDIOBJ(bitmap.0));
        // AC_SRC_OVER = 0, AC_SRC_ALPHA = 1.
        let blend = BLENDFUNCTION { BlendOp: 0, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: 1 };
        let _ = AlphaBlend(dc, left, top, size as i32, size as i32, memory, 0, 0, size as i32, size as i32, blend);
        let _ = SelectObject(memory, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
    }

    unsafe fn draw(hwnd: HWND, dc: HDC) {
        let mut client = RECT::default();
        let _ = GetClientRect(hwnd, &mut client);
        let Some(card) = CARD.with(|slot| slot.borrow().clone()) else { return };

        let scale = (client.right as f32 / WIDTH).clamp(1.0, 3.0);
        let width = client.right;
        let height = client.bottom;
        let radius = scaled(RADIUS, scale);
        let Palette { panel, text, muted, accent } = card.palette;
        // A failure is a rose accent, whatever the theme's own accent is.
        let accent = if card.error { 0xfb_71_85 } else { accent };
        let edge = mix(panel, text, 0.10);
        let chip = mix(panel, accent, 0.14);
        let chip_edge = mix(panel, accent, 0.30);

        // The ring of the rounded rectangle, then the panel just inside it.
        round_fill(dc, 0, 0, width, height, radius, edge);
        round_fill(dc, 1, 1, width - 1, height - 1, radius - 1, panel);

        let margin = scaled(MARGIN, scale);
        let chip_size = scaled(CHIP, scale);
        let chip_top = (height - chip_size) / 2;
        // The outer shape is the border; the inset shape is the chip itself.
        round_fill(dc, margin, chip_top, margin + chip_size, chip_top + chip_size, scaled(CHIP_RADIUS, scale), chip_edge);
        let inset = scaled(1.0, scale);
        round_fill(
            dc,
            margin + inset,
            chip_top + inset,
            margin + chip_size - inset,
            chip_top + chip_size - inset,
            scaled(CHIP_RADIUS, scale) - inset,
            chip,
        );
        let mark_size = scaled(MARK_DRAW, scale);
        draw_mark(
            dc,
            margin + (chip_size - mark_size) / 2,
            chip_top + (chip_size - mark_size) / 2,
            mark_size,
            accent,
        );

        let text_left = margin + chip_size + scaled(16.0, scale);
        let text_right = width - margin;
        let _ = SetBkMode(dc, TRANSPARENT);

        let title_font = CreateFontW(
            -scaled(15.0, scale), 0, 0, 0, 600, 0, 0, 0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            0,
            w!("Segoe UI"),
        );
        let detail_font = CreateFontW(
            -scaled(12.0, scale), 0, 0, 0, 400, 0, 0, 0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            0,
            w!("Segoe UI"),
        );

        let title_top = if card.detail.is_empty() {
            (height - scaled(22.0, scale)) / 2
        } else {
            height / 2 - scaled(21.0, scale)
        };
        let mut title: Vec<u16> = card.title.encode_utf16().collect();
        let previous = SelectObject(dc, HGDIOBJ(title_font.0));
        let _ = SetTextColor(dc, colorref(text));
        let mut line = RECT {
            left: text_left,
            top: title_top,
            right: text_right,
            bottom: title_top + scaled(22.0, scale),
        };
        DrawTextW(dc, &mut title, &mut line, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

        if !card.detail.is_empty() {
            let mut detail: Vec<u16> = card.detail.encode_utf16().collect();
            let _ = SelectObject(dc, HGDIOBJ(detail_font.0));
            let _ = SetTextColor(dc, colorref(muted));
            let mut line = RECT {
                left: text_left,
                top: height / 2 + scaled(1.0, scale),
                bottom: height / 2 + scaled(23.0, scale),
                right: text_right,
            };
            DrawTextW(dc, &mut detail, &mut line, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
        }

        let _ = SelectObject(dc, previous);
        let _ = DeleteObject(HGDIOBJ(title_font.0));
        let _ = DeleteObject(HGDIOBJ(detail_font.0));
    }
}
