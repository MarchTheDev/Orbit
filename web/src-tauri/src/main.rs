// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK keeps a compositor texture for every blurred panel, and that
    // set grows for as long as the window is open. Tabs and hovers then stall
    // and the fans stay up. Turning the compositor off, when the player has not
    // already chosen otherwise, has to happen before WebKit is created, which
    // is what `run` does.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        // The view repeats this once it exists. Some WebKit builds read the
        // policy from the view and ignore the variable, which is why both are set.
    }
    orbit_lib::run();
}
