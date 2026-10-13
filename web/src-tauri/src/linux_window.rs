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
use std::path::PathBuf;
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
static ICON_HOOKED: AtomicBool = AtomicBool::new(false);
static ICON_NOTIFY_HOOKED: AtomicBool = AtomicBool::new(false);
static APPLYING_ICON: AtomicBool = AtomicBool::new(false);

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
        hook_icon(&view);
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
            hook_icon(view);
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

/// The orange and white W is the desktop's placeholder. Wayland has no
/// per-window icon, so the compositor looks the mark up by the application id
/// (`com.orbit.launcher`, set in the config) against a desktop entry of that
/// name. Painting the GTK window is only the X11 half, and the page load can
/// write the placeholder back, so that half is put back whenever the icon changes.
fn hook_icon(view: &webkit2gtk::WebView) {
    publish_session_icon();
    if let Some(window) = gtk_window_of(view) {
        apply_orbit_icon(&window);
        if !ICON_NOTIFY_HOOKED.swap(true, Ordering::SeqCst) {
            window.connect_notify_local(Some("icon"), |window, _| {
                if !APPLYING_ICON.load(Ordering::SeqCst) {
                    apply_orbit_icon(window);
                }
            });
        }
    }
    if ICON_HOOKED.swap(true, Ordering::SeqCst) {
        return;
    }
    view.connect_load_changed(|view, _event| {
        if let Some(window) = gtk_window_of(view) {
            apply_orbit_icon(&window);
        }
    });
}

fn apply_orbit_icon(window: &gtk::Window) {
    if APPLYING_ICON.swap(true, Ordering::SeqCst) {
        return;
    }
    publish_session_icon();
    let Some(path) = orbit_icon_file() else {
        APPLYING_ICON.store(false, Ordering::SeqCst);
        return;
    };
    // The name is what a panel looks up once the desktop entry exists. The
    // file is what an X11 titlebar draws when that lookup misses.
    if let Some(theme) = gtk::IconTheme::default() {
        let _ = theme.rescan_if_needed();
    }
    window.set_icon_name(Some("com.orbit.launcher"));
    gtk::Window::set_default_icon_name("com.orbit.launcher");
    if let Err(error) = window.set_icon_from_file(&path) {
        log::warn!("could not set the window icon: {error}");
    }
    let _ = gtk::Window::set_default_icon_from_file(&path);
    APPLYING_ICON.store(false, Ordering::SeqCst);
}

/// Drop a desktop entry the compositor can match to the application id.
///
/// An installed package already has one. A binary, an AppImage, or a dev run
/// does not, and that is the case that keeps the orange W. User data dirs are
/// searched before the system ones, so this entry wins when both exist.
pub fn publish_session_icon() {
    let Some(data) = data_home() else {
        return;
    };
    let icon_dir = data.join("icons/hicolor/128x128/apps");
    let apps = data.join("applications");
    if std::fs::create_dir_all(&icon_dir).is_err() || std::fs::create_dir_all(&apps).is_err() {
        return;
    }
    let bytes: &[u8] = include_bytes!("../icons/128x128.png");
    let icon = icon_dir.join("com.orbit.launcher.png");
    let _ = write_if_changed(&icon, bytes);
    // The menu entry can name the icon either way. Both files have to exist.
    let _ = write_if_changed(&icon_dir.join("orbit.png"), bytes);
    let desktop = apps.join("com.orbit.launcher.desktop");
    // The icon name needs a theme scan. A path does not, so a desktop that
    // has not indexed the new file still draws Orbit instead of the orange W.
    if write_if_changed(&desktop, session_desktop_entry(&icon).as_bytes()) {
        for cmd in ["update-desktop-database", "kbuildsycoca6", "kbuildsycoca5"] {
            let mut command = std::process::Command::new(cmd);
            if cmd == "update-desktop-database" {
                command.arg(&apps);
            }
            let _ = command
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }
}

fn data_home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("XDG_DATA_HOME") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/share"))
}

fn session_desktop_entry(icon: &std::path::Path) -> String {
    format!(
        "\
[Desktop Entry]
Type=Application
Name=Orbit
Comment=A library for the games on your PC
Exec=orbit
Icon={}
NoDisplay=true
StartupWMClass=com.orbit.launcher
",
        icon.display()
    )
}

fn write_if_changed(path: &std::path::Path, bytes: &[u8]) -> bool {
    if std::fs::read(path).ok().as_deref() == Some(bytes) {
        return false;
    }
    std::fs::write(path, bytes).is_ok()
}

fn orbit_icon_file() -> Option<PathBuf> {
    let path = data_home()?.join("icons/hicolor/128x128/apps/com.orbit.launcher.png");
    if path.is_file() {
        return Some(path);
    }
    publish_session_icon();
    path.is_file().then_some(path)
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
        apply_orbit_icon(&window);
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
            if let Some(button) = button_above(image.upcast_ref()) {
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
