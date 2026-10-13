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
use glib::prelude::ObjectType;
use glib::{ControlFlow, Propagation};
use gtk::prelude::*;

// GTK 3 sets the Wayland app id from the program name at the moment the
// toplevel is created (`gdk_wayland_window_create_xdg_toplevel`). This is the
// call that changes it afterwards. KWin listens for that change and looks the
// new id up as a desktop file. The symbol has been in GDK since 3.24.22.
#[link(name = "gdk-3")]
extern "C" {
    fn gdk_wayland_window_set_application_id(
        window: *mut libc::c_void,
        application_id: *const libc::c_char,
    );
}
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
static PAGE_ENDED: AtomicBool = AtomicBool::new(false);

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

/// The window is going away. Titlebar hooks must not touch it again.
pub fn closing() -> bool {
    PAGE_ENDED.load(Ordering::SeqCst)
}

/// Kill the page process before the view is destroyed.
///
/// WebKitGTK's page process aborts inside its own exit handlers — Mesa freeing
/// EGL — when the view is destroyed the ordinary way. The desktop reports that
/// abort as a crash on close. This call is an instant kill, so that teardown
/// never runs. Safe to call again.
pub fn end_page(window: &tauri::WebviewWindow) {
    if PAGE_ENDED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = window.with_webview(|webview| {
        webview.inner().terminate_web_process();
    });
}

/// Hook the real window. Safe to call again until the button has been found.
pub fn install(window: &tauri::WebviewWindow) {
    if closing() || ready() {
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

/// The orange and white W is the icon theme entry named `wayland`. KWin draws
/// it when the window's Wayland app id matches no desktop file. The page icon
/// never reaches that corner: WebKit stores a favicon and does not paint the
/// decoration. Painting the GTK window is only the X11 half.
fn hook_icon(view: &webkit2gtk::WebView) {
    publish_session_icon();
    if let Some(window) = gtk_window_of(view) {
        apply_orbit_icon(&window);
        if !ICON_NOTIFY_HOOKED.swap(true, Ordering::SeqCst) {
            window.connect_notify_local(Some("icon"), |window, _| {
                if closing() || APPLYING_ICON.load(Ordering::SeqCst) {
                    return;
                }
                apply_orbit_icon(window);
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
    if closing() || APPLYING_ICON.swap(true, Ordering::SeqCst) {
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
    // X11 uses the file above. Wayland ignores it and uses the app id.
    publish_wayland_app_id(window);
    APPLYING_ICON.store(false, Ordering::SeqCst);
}

fn publish_wayland_app_id(window: &gtk::Window) {
    if !window.display().backend().is_wayland() {
        return;
    }
    let Some(gdk_window) = window.window() else {
        return;
    };
    let Ok(id) = std::ffi::CString::new("com.orbit.launcher") else {
        return;
    };
    unsafe {
        gdk_wayland_window_set_application_id(gdk_window.as_ptr() as *mut libc::c_void, id.as_ptr());
    }
}

/// Set the name KWin will look up, then make sure that lookup has a file.
///
/// Call this before GTK is initialised. `gtk_init` only fills the program
/// name when it is still empty, so a later call is too late for the first
/// window.
pub fn prepare() {
    glib::set_prgname(Some("com.orbit.launcher"));
    publish_session_icon();
}

/// Drop a desktop entry the compositor can match to the application id.
///
/// KWin reads the Wayland app id and looks for `{id}.desktop` under the
/// applications directories. It then passes `Icon=` to `QIcon::fromTheme`.
/// An absolute path is not a theme name, so it does not draw. A missing file
/// draws the theme icon `wayland`, which is the orange W.
pub fn publish_session_icon() {
    for data in data_homes() {
        publish_one(&data);
    }
}

fn publish_one(data: &std::path::Path) {
    install_theme_icons(data);
    let apps = data.join("applications");
    if std::fs::create_dir_all(&apps).is_err() {
        return;
    }
    let desktop = apps.join("com.orbit.launcher.desktop");
    if write_if_changed(&desktop, session_desktop_entry().as_bytes()) {
        let _ = std::process::Command::new("update-desktop-database")
            .arg(&apps)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

fn install_theme_icons(data: &std::path::Path) {
    let theme = data.join("icons/hicolor");
    let sizes: [(&str, &[u8]); 3] = [
        ("32x32", include_bytes!("../icons/32x32.png")),
        ("64x64", include_bytes!("../icons/64x64.png")),
        ("128x128", include_bytes!("../icons/128x128.png")),
    ];
    let mut wrote = false;
    for (size, bytes) in sizes {
        let dir = theme.join(size).join("apps");
        if std::fs::create_dir_all(&dir).is_err() {
            continue;
        }
        // Same picture under both names. The desktop file asks for the app id.
        // A package menu entry asks for `orbit`.
        wrote |= write_if_changed(&dir.join("com.orbit.launcher.png"), bytes);
        wrote |= write_if_changed(&dir.join("orbit.png"), bytes);
    }
    if !wrote {
        return;
    }
    // A cache that was built before this file existed hides it. Rebuild, and
    // if that tool is not installed, drop the cache so the lookup scans.
    let cache = theme.join("icon-theme.cache");
    let updated = std::process::Command::new("gtk-update-icon-cache")
        .args(["-f", "-t"])
        .arg(&theme)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !updated {
        let _ = std::fs::remove_file(cache);
    }
}

/// Directories a compositor actually searches. An AppImage can point
/// `XDG_DATA_HOME` at its mount; the desktop, which is a different process,
/// still looks in the login user's `~/.local/share`. Write both when they differ.
fn data_homes() -> Vec<PathBuf> {
    let mut homes = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        if !home.is_empty() {
            homes.push(PathBuf::from(home).join(".local/share"));
        }
    }
    if let Some(dir) = std::env::var_os("XDG_DATA_HOME") {
        if !dir.is_empty() {
            let path = PathBuf::from(dir);
            if !homes.contains(&path) {
                homes.push(path);
            }
        }
    }
    homes
}

fn data_home() -> Option<PathBuf> {
    data_homes().into_iter().next()
}

fn session_desktop_entry() -> String {
    // Icon= is a theme name. KWin passes it to QIcon::fromTheme and ignores a path.
    "\
[Desktop Entry]
Type=Application
Name=Orbit
Comment=A library for the games on your PC
Exec=orbit
Icon=com.orbit.launcher
NoDisplay=true
StartupWMClass=com.orbit.launcher
"
    .to_string()
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
        if closing() {
            return ControlFlow::Break;
        }
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

#[cfg(test)]
mod tests {
    use super::session_desktop_entry;

    #[test]
    fn the_titlebar_icon_is_a_theme_name() {
        let text = session_desktop_entry();
        assert!(text.contains("Icon=com.orbit.launcher\n"), "{text}");
        assert!(!text.contains("Icon=/"), "{text}");
    }
}
