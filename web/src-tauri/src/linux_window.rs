//! Linux window behaviour WebKit and the taskbar get wrong on their own.
//!
//! The minimise button is drawn by the compositor. On Wayland `is_minimized`
//! often stays false, and a later `hide()` does not take a minimized window
//! off the taskbar. The state signal is the moment it actually happened, and
//! the taskbar hint has to be cleared before the window is withdrawn.
//!
//! The same visit turns compositing off on the view. The environment variable
//! is set before WebKit starts, and some builds ignore it once the view exists.

use std::sync::atomic::{AtomicBool, Ordering};

use gdk::WindowState;
use glib::Propagation;
use gtk::prelude::*;
use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};

static ARMED: AtomicBool = AtomicBool::new(false);
static PARKED: AtomicBool = AtomicBool::new(false);

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
}

/// A withdraw already happened, so a later poll must not unminimize it again.
pub fn note_parked() {
    PARKED.store(true, Ordering::SeqCst);
}

/// True once this process has already withdrawn the window for the tray.
pub fn is_parked() -> bool {
    PARKED.load(Ordering::SeqCst)
}

/// Hook the real window, and turn the compositor off on this view.
pub fn install(window: &tauri::WebviewWindow) {
    let installed = window.with_webview(|webview| {
        let view = webview.inner();
        // The GTK prelude also has a settings method. Name the web view one.
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
            // A single-page app never navigates. The cache is only a growing
            // snapshot of panels that are already on screen.
            settings.set_enable_page_cache(false);
        }
        let Some(toplevel) = view.toplevel() else {
            log::warn!("minimize-to-tray: the web view has no top-level window");
            return;
        };
        let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() else {
            log::warn!("minimize-to-tray: the top-level window is not a GTK window");
            return;
        };
        let parked = gtk_window.clone();
        gtk_window.connect_window_state_event(move |_win, event| {
            let state = event.new_window_state();
            if ARMED.load(Ordering::SeqCst)
                && state.contains(WindowState::ICONIFIED)
                && !PARKED.swap(true, Ordering::SeqCst)
            {
                // The hint first, then unminimize, then withdraw. Hiding an
                // iconified Wayland window leaves the taskbar entry. Clearing
                // the hint and the iconified state before hide drops it.
                parked.set_skip_taskbar_hint(true);
                parked.deiconify();
                parked.hide();
            }
            Propagation::Proceed
        });
    });
    if let Err(error) = installed {
        log::warn!("minimize-to-tray: could not reach the GTK window: {error}");
    }
}
