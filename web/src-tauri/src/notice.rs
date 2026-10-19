//! The short "game started" card.
//!
//! This used to be the overlay window shown in a resting state for five
//! seconds. That is a second WebView2 instance, roughly 50 MB of processes,
//! created every time a game starts and thrown away again. The card itself is
//! two lines of text on a dark rectangle, so it is drawn by a small native
//! window instead: a few hundred kilobytes and no web view at all.

/// Show the card without blocking the caller. It hides itself after four
/// seconds, and it never takes focus or a click from the game underneath.
pub fn show(title: &str) {
    #[cfg(windows)]
    {
        let title = title.to_string();
        let _ = std::thread::Builder::new()
            .name("orbit-ready-notice".to_string())
            .spawn(move || {
                if let Err(error) = win::run(title) {
                    log::warn!("the ready notice was not shown: {error}");
                }
            });
    }
    #[cfg(not(windows))]
    {
        let _ = title;
    }
}

#[cfg(windows)]
mod win {
    use std::cell::RefCell;
    use std::sync::Once;
    use std::time::{Duration, Instant};

    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateFontW, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect, FrameRect, SelectObject,
        SetBkMode, SetTextColor, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_CHARSET, DT_END_ELLIPSIS, DT_LEFT,
        DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, HDC, HGDIOBJ, OUT_DEFAULT_PRECIS, PAINTSTRUCT, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetSystemMetrics, PeekMessageW,
        PostQuitMessage, RegisterClassW, ShowWindow, TranslateMessage, MSG, PM_REMOVE, SM_CXSCREEN, SW_SHOWNOACTIVATE,
        WM_DESTROY, WM_ERASEBKGND, WM_PAINT, WM_QUIT, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT, WS_POPUP,
    };

    // COLORREF is 0x00BBGGRR.
    const PANEL: u32 = 0x0021_1F_1F;
    const EDGE: u32 = 0x0038_3636;
    const TITLE_COLOR: u32 = 0x00F2_F2F2;
    const DETAIL_COLOR: u32 = 0x009C_9C9C;

    const WIDTH: i32 = 440;
    const HEIGHT: i32 = 76;
    const MARGIN_TOP: i32 = 48;
    const LIFETIME: Duration = Duration::from_millis(4200);

    thread_local! {
        static TITLE: RefCell<String> = const { RefCell::new(String::new()) };
    }

    static CLASS: Once = Once::new();

    pub(super) fn run(title: String) -> Result<(), String> {
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

            TITLE.with(|text| *text.borrow_mut() = title);

            let screen = GetSystemMetrics(SM_CXSCREEN);
            let window = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
                w!("OrbitNotice"),
                w!("Orbit"),
                WS_POPUP,
                (screen - WIDTH) / 2,
                MARGIN_TOP,
                WIDTH,
                HEIGHT,
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.to_string())?;

            let _ = ShowWindow(window, SW_SHOWNOACTIVATE);

            // A plain message pump with a deadline. There is no timer to cancel
            // and nothing to tear down if the window is closed early.
            let mut message = MSG::default();
            let deadline = Instant::now() + LIFETIME;
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

    unsafe fn draw(hwnd: HWND, dc: HDC) {
        let mut client = RECT::default();
        let _ = GetClientRect(hwnd, &mut client);

        let panel = CreateSolidBrush(COLORREF(PANEL));
        let _ = FillRect(dc, &client, panel);
        let _ = DeleteObject(HGDIOBJ(panel.0));
        let edge = CreateSolidBrush(COLORREF(EDGE));
        let _ = FrameRect(dc, &client, edge);
        let _ = DeleteObject(HGDIOBJ(edge.0));

        let _ = SetBkMode(dc, TRANSPARENT);
        let title = TITLE.with(|text| text.borrow().clone());
        let mut title: Vec<u16> = title.encode_utf16().collect();
        let mut detail: Vec<u16> = "Orbit Overlay is ready. Press Alt+X to open it.".encode_utf16().collect();

        let bold = CreateFontW(
            -16, 0, 0, 0, 600, 0, 0, 0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            0,
            w!("Segoe UI"),
        );
        let small = CreateFontW(
            -12, 0, 0, 0, 400, 0, 0, 0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            0,
            w!("Segoe UI"),
        );

        let previous = SelectObject(dc, HGDIOBJ(bold.0));
        let _ = SetTextColor(dc, COLORREF(TITLE_COLOR));
        let mut line = RECT { left: 20, top: 10, right: client.right - 20, bottom: 42 };
        DrawTextW(dc, &mut title, &mut line, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

        let _ = SelectObject(dc, HGDIOBJ(small.0));
        let _ = SetTextColor(dc, COLORREF(DETAIL_COLOR));
        let mut line = RECT { left: 20, top: 40, right: client.right - 20, bottom: 64 };
        DrawTextW(dc, &mut detail, &mut line, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

        let _ = SelectObject(dc, previous);
        let _ = DeleteObject(HGDIOBJ(bold.0));
        let _ = DeleteObject(HGDIOBJ(small.0));
    }
}
