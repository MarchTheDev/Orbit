//! Linux window behaviour the taskbar gets wrong on its own.
//!
//! The minimise button is often drawn by the compositor. On Wayland
//! `is_minimized` stays false, and a later `hide()` does not take a minimized
//! window off the taskbar. The titlebar button is the click we can see, and
//! the state signal is the fallback for the desktops that do report it. The
//! taskbar hint has to be cleared before the window is withdrawn.
//!
//! A state event during startup is not a click. Parking the window then makes
//! the next open come back minimized, and only the tray's Show — which
//! unminimizes — feels immediate.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use gdk::WindowState;
use glib::{ControlFlow, Propagation};
use gtk::prelude::*;
use webkit2gtk::{SettingsExt, WebViewExt};

static ARMED: AtomicBool = AtomicBool::new(false);
static PARKED: AtomicBool = AtomicBool::new(false);
static SHOWN: AtomicBool = AtomicBool::new(false);
static STATE_HOOKED: AtomicBool = AtomicBool::new(false);
static BUTTON_HOOKED: AtomicBool = AtomicBool::new(false);
static REALIZE_HOOKED: AtomicBool = AtomicBool::new(false);
static SEARCHING: AtomicBool = AtomicBool::new(false);

/// Whether minimise should leave the taskbar. Updated when settings change.
pub fn set_armed(on: bool) {
    ARMED.store(on, Ordering::SeqCst);
    if !on {
        PARKED.store(false, Ordering::SeqCst);
    }
}

/// The window was brought back. The next minimise is a new one.
pub fn note_revealed() {
    PARKED.store(false, Ordering::SeqCst);
    SHOWN.store(true, Ordering::SeqCst);
}

/// The window has been put on screen at least once. Startup state is not a click.
pub fn note_shown() {
    SHOWN.store(true, Ordering::SeqCst);
}

/// A withdraw already happened, so a later poll must not unminimize it again.
pub fn note_parked() {
    PARKED.store(true, Ordering::SeqCst);
}

/// True once this process has already withdrawn the window for the tray.
pub fn is_parked() -> bool {
    PARKED.load(Ordering::SeqCst)
}

/// True once both the state signal and the titlebar button are hooked.
pub fn ready() -> bool {
    STATE_HOOKED.load(Ordering::SeqCst) && BUTTON_HOOKED.load(Ordering::SeqCst)
}

/// Hook the real window. Safe to call again until the button has been found.
pub fn install(window: &tauri::WebviewWindow) {
    if ready() {
        return;
    }
    let _ = window.with_webview(|webview| {
        let view = webview.inner();
        // A single-page app never navigates. The cache is only a growing
        // snapshot of panels that are already on screen. Compositing stays on:
        // turning it off is what made the animations disappear.
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_page_cache(false);
        }
        if let Some(gtk_window) = gtk_window_of(&view) {
            arm(&gtk_window);
            schedule_button_search(gtk_window);
            return;
        }
        if REALIZE_HOOKED.swap(true, Ordering::SeqCst) {
            return;
        }
        let view = view.clone();
        view.connect_realize(move |view| {
            if let Some(gtk_window) = gtk_window_of(view) {
                arm(&gtk_window);
                schedule_button_search(gtk_window);
            }
        });
    });
}

fn gtk_window_of(view: &webkit2gtk::WebView) -> Option<gtk::Window> {
    view.toplevel()?.downcast::<gtk::Window>().ok()
}

fn arm(window: &gtk::Window) {
    if STATE_HOOKED.swap(true, Ordering::SeqCst) {
        hook_button(window);
        return;
    }
    let parked = window.clone();
    window.connect_window_state_event(move |_win, event| {
        let state = event.new_window_state();
        if state.contains(WindowState::ICONIFIED) {
            park(&parked);
        }
        Propagation::Proceed
    });
    hook_button(window);
}

/// The titlebar is not always built at the first visit. Look again for a few
/// seconds, on the GTK thread, and then stop.
fn schedule_button_search(window: gtk::Window) {
    if BUTTON_HOOKED.load(Ordering::SeqCst) || SEARCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    let tries = Rc::new(Cell::new(0u8));
    glib::timeout_add_local(Duration::from_millis(250), move || {
        let n = tries.get();
        tries.set(n.saturating_add(1));
        hook_button(&window);
        if BUTTON_HOOKED.load(Ordering::SeqCst) || n > 40 {
            ControlFlow::Break
        } else {
            ControlFlow::Continue
        }
    });
}

fn hook_button(window: &gtk::Window) {
    if BUTTON_HOOKED.load(Ordering::SeqCst) {
        return;
    }
    let Some(button) = find_minimize(window) else {
        return;
    };
    let parked = window.clone();
    // The header bar's own handler iconifies. This one runs as well and takes
    // the window off the taskbar, which the iconify on Wayland never reports.
    button.connect_clicked(move |_| park(&parked));
    BUTTON_HOOKED.store(true, Ordering::SeqCst);
}

fn find_minimize(window: &gtk::Window) -> Option<gtk::Button> {
    let found = std::cell::RefCell::new(None);
    if let Some(titlebar) = window.titlebar() {
        walk(&titlebar, &found);
    }
    if found.borrow().is_none() {
        walk(window.upcast_ref(), &found);
    }
    found.into_inner()
}

fn walk(widget: &gtk::Widget, found: &std::cell::RefCell<Option<gtk::Button>>) {
    if found.borrow().is_some() {
        return;
    }
    if let Ok(image) = widget.clone().downcast::<gtk::Image>() {
        let icon = image.icon_name().map(|name| name.to_string()).unwrap_or_default();
        // The icon name is not translated. The tooltip is, so it is only a hint.
        if icon.contains("window-minimize") {
            if let Some(button) = button_above(&image) {
                *found.borrow_mut() = Some(button);
                return;
            }
        }
    }
    if let Ok(button) = widget.clone().downcast::<gtk::Button>() {
        let tip = button
            .tooltip_text()
            .map(|text| text.to_lowercase())
            .unwrap_or_default();
        if tip.contains("minimize") || tip.contains("minimise") {
            *found.borrow_mut() = Some(button);
            return;
        }
    }
    if let Ok(container) = widget.clone().downcast::<gtk::Container>() {
        container.foreach(|child| walk(child, found));
    }
}

fn button_above(widget: &gtk::Widget) -> Option<gtk::Button> {
    let mut current = widget.parent();
    while let Some(widget) = current {
        if let Ok(button) = widget.clone().downcast::<gtk::Button>() {
            return Some(button);
        }
        current = widget.parent();
    }
    None
}

fn park(window: &gtk::Window) {
    if !SHOWN.load(Ordering::SeqCst) || !ARMED.load(Ordering::SeqCst) {
        return;
    }
    if PARKED.swap(true, Ordering::SeqCst) {
        return;
    }
    // The hint first, then unminimize, then withdraw. Hiding an iconified
    // Wayland window leaves the taskbar entry.
    window.set_skip_taskbar_hint(true);
    window.deiconify();
    window.hide();
}
