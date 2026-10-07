//! Starting other programs without taking over the screen.
//!
//! Orbit is a windowed app, so on Windows every console program it runs -
//! `reg`, `tasklist`, `taskkill` - would otherwise be given a console window
//! of its own for as long as it runs. Reading a launcher's registry keys runs
//! one of those per key, which looked like a window flickering open and shut
//! the whole time Orbit was searching. `CREATE_NO_WINDOW` is what stops it, and
//! it is the sort of thing that is easy to miss at a new call site, so every
//! child process Orbit starts is built here.
//!
//! The same helper deals with the other way a child process can go wrong: a
//! Linux build that is really an AppImage carries its bundle's environment, and
//! a system program started with it can load the bundle's libraries instead of
//! the system's.

use std::process::Command;

/// Start building a command for `program`, the way Orbit starts all of them.
///
/// Takes anything `Command::new` takes, so a path held as a `PathBuf` - a
/// downloaded installer, say - goes through here as easily as a name.
pub fn command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    hide_console(&mut command);
    leave_the_bundle(&mut command);
    command
}

/// Keep a console child off the screen. Windows is the only place a windowed
/// app is given a console to begin with.
#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

/// Drop the AppImage's half of the environment before starting anything.
///
/// Only when running from inside one: `APPIMAGE` is set by the runtime and
/// nothing else sets it, so its absence is the answer for a `.deb`, a package
/// from a distribution, or a plain binary. Orbit's own libraries are already
/// loaded by the time a child is started, so none of these are needed any more
/// and each of them is a way for `xdg-open` to fail or to open the wrong thing.
#[cfg(all(unix, not(target_os = "macos")))]
fn leave_the_bundle(command: &mut Command) {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }
    for name in [
        "APPDIR",
        "APPIMAGE",
        "APPIMAGELAUNCHER_DISABLE",
        "ARGUMENTS",
        "GDK_PIXBUF_MODULE_FILE",
        "GIO_MODULE_DIR",
        "GSETTINGS_SCHEMA_DIR",
        "GST_PLUGIN_PATH",
        "GST_PLUGIN_SYSTEM_PATH",
        "GST_PLUGIN_SCANNER",
        "GTK_DATA_PREFIX",
        "GTK_EXE_PREFIX",
        "GTK_IM_MODULE_FILE",
        "GTK_PATH",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "OPENSSL_CONF",
        "PERLLIB",
        "PYTHONHOME",
        "PYTHONPATH",
        "QT_PLUGIN_PATH",
        "XDG_DATA_DIRS",
    ] {
        command.env_remove(name);
    }
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
fn leave_the_bundle(_command: &mut Command) {}
