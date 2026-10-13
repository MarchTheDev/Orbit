//! Right-click "Open in Orbit" for Linux file managers.
//!
//! Windows keeps its own Explorer verb. Here the same action is written into
//! the places each file manager already looks: a Nautilus or Caja script, a
//! KDE service menu, a Nemo action, Thunar's custom actions, and an Open With
//! entry. Nothing becomes the default program for a file type.

use std::fs;
use std::path::{Path, PathBuf};

const MARKER: &str = "orbit-open-in-orbit";

/// Reconcile the saved preference with this user's file-manager menus.
pub fn set_context_menu(enabled: bool) -> Result<(), String> {
    let home = home_dir()?;
    let exe = std::env::current_exe()
        .map_err(|error| format!("could not find Orbit's executable: {error}"))?;
    apply(&data_home(&home), &config_home(&home), &exe, enabled)
}

fn apply(data: &Path, config: &Path, exe: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        install(data, config, exe)
    } else {
        remove(data, config)
    }
}

fn install(data: &Path, config: &Path, exe: &Path) -> Result<(), String> {
    let script = nautilus_script(exe);
    write_executable(&data.join("nautilus/scripts/Open in Orbit"), &script)?;
    write_executable(&config.join("caja/scripts/Open in Orbit"), &script)?;
    let service = kde_service(exe);
    write_text(&data.join("kio/servicemenus/orbit-open.desktop"), &service)?;
    write_text(&data.join("kservices5/ServiceMenus/orbit-open.desktop"), &service)?;
    write_text(&data.join("nemo/actions/orbit-open.nemo_action"), &nemo_action(exe))?;
    write_text(
        &data.join("file-manager/actions/orbit-open.desktop"),
        &file_manager_action(exe),
    )?;
    write_text(&data.join("applications/orbit-open-file.desktop"), &open_with(exe))?;
    upsert_thunar(&config.join("Thunar/uca.xml"), exe)?;
    Ok(())
}

fn remove(data: &Path, config: &Path) -> Result<(), String> {
    for relative in [
        "nautilus/scripts/Open in Orbit",
        "kio/servicemenus/orbit-open.desktop",
        "kservices5/ServiceMenus/orbit-open.desktop",
        "nemo/actions/orbit-open.nemo_action",
        "file-manager/actions/orbit-open.desktop",
        "applications/orbit-open-file.desktop",
    ] {
        remove_file(&data.join(relative))?;
    }
    remove_file(&config.join("caja/scripts/Open in Orbit"))?;
    strip_thunar(&config.join("Thunar/uca.xml"))
}

fn nautilus_script(exe: &Path) -> String {
    let exe = shell_quote(&exe.to_string_lossy());
    format!(
        "#!/bin/sh\n# {marker}\nexe={exe}\nif [ -n \"$1\" ]; then\n  for path in \"$@\"; do\n    \"$exe\" --open-in-orbit \"$path\"\n  done\n  exit 0\nfi\npaths=\"${{NAUTILUS_SCRIPT_SELECTED_FILE_PATHS:-}}${{CAJA_SCRIPT_SELECTED_FILE_PATHS:-}}\"\nwhile IFS= read -r path; do\n  [ -n \"$path\" ] || continue\n  \"$exe\" --open-in-orbit \"$path\"\ndone <<EOF\n$paths\nEOF\n",
        marker = MARKER,
        exe = exe,
    )
}

fn kde_service(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Service\nMimeType=application/x-executable;application/x-sharedlib;application/vnd.appimage;application/x-shellscript;text/x-shellscript;\nActions=openInOrbit;\nX-KDE-Priority=TopLevel\n\n[Desktop Action openInOrbit]\nName=Open in Orbit\nIcon=orbit\nExec={}\n",
        exec_line(exe)
    )
}

fn nemo_action(exe: &Path) -> String {
    format!(
        "[Nemo Action]\nActive=true\nName=Open in Orbit\nComment={marker}\nExec={exec}\nSelection=s\nExtensions=any;\nQuote=double\nEscapeSpaces=true\n",
        marker = MARKER,
        exec = exec_line(exe),
    )
}

fn file_manager_action(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Action\nName=Open in Orbit\nIcon=orbit\nProfiles=profile-zero;\n\n[X-Action-Profile profile-zero]\nName=Open in Orbit\nMimeTypes=application/x-executable;application/x-sharedlib;application/vnd.appimage;application/x-shellscript;\nExec={}\n",
        exec_line(exe)
    )
}

fn open_with(exe: &Path) -> String {
    let quoted = desktop_quote(&exe.to_string_lossy());
    format!(
        "[Desktop Entry]\nType=Application\nName=Open in Orbit\nComment=Add this program to the Orbit library\nTryExec={quoted}\nExec={}\nIcon=orbit\nTerminal=false\nNoDisplay=true\nMimeType=application/x-executable;application/x-sharedlib;application/vnd.appimage;application/x-shellscript;\n",
        exec_line(exe)
    )
}

fn exec_line(exe: &Path) -> String {
    format!("{} --open-in-orbit %f", desktop_quote(&exe.to_string_lossy()))
}

fn upsert_thunar(path: &Path, exe: &Path) -> Result<(), String> {
    let block = thunar_block(exe);
    if !path.exists() {
        return write_text(
            path,
            &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<actions>\n{block}</actions>\n"),
        );
    }
    let current = fs::read_to_string(path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let without = strip_action_block(&current);
    let next = match without.rfind("</actions>") {
        Some(at) => format!("{}{block}{}", &without[..at], &without[at..]),
        None => format!("{without}\n{block}"),
    };
    write_text(path, &next)
}

fn strip_thunar(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let current = fs::read_to_string(path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let next = strip_action_block(&current);
    if next.contains("<action>") {
        write_text(path, &next)
    } else if current.contains(MARKER) {
        remove_file(path)
    } else {
        Ok(())
    }
}

fn thunar_block(exe: &Path) -> String {
    let command = xml_escape(&format!("{} --open-in-orbit %f", shell_quote(&exe.to_string_lossy())));
    format!(
        "<action>\n\t<icon>orbit</icon>\n\t<name>Open in Orbit</name>\n\t<unique-id>1700000001-1</unique-id>\n\t<command>{command}</command>\n\t<description>{marker}</description>\n\t<patterns>*</patterns>\n\t<other-files/>\n</action>\n",
        command = command,
        marker = MARKER,
    )
}

fn strip_action_block(xml: &str) -> String {
    let mut out = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<action>") {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let Some(end) = after.find("</action>") else {
            out.push_str(after);
            return out;
        };
        let close = end + "</action>".len();
        let block = &after[..close];
        rest = &after[close..];
        if !block.contains(MARKER) {
            out.push_str(block);
        }
    }
    out.push_str(rest);
    out
}

fn write_text(path: &Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    fs::write(path, body).map_err(|error| format!("could not write {}: {error}", path.display()))
}

fn write_executable(path: &Path, body: &str) -> Result<(), String> {
    write_text(path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|error| format!("could not mark {} executable: {error}", path.display()))?;
    }
    Ok(())
}

fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {}: {error}", path.display())),
    }
}

fn desktop_quote(path: &str) -> String {
    if path.contains([' ', '\t', '"', '\\']) {
        format!("\"{}\"", path.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        path.to_string()
    }
}

fn shell_quote(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "could not find the home directory for the file-manager menu".into())
}

fn data_home(home: &Path) -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"))
}

fn config_home(home: &Path) -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_menu_points_at_this_install_and_can_be_taken_away() {
        let root = std::env::temp_dir().join(format!("orbit-menu-{}", std::process::id()));
        let data = root.join("share");
        let config = root.join("config");
        let exe = PathBuf::from("/opt/Orbit App/orbit");
        apply(&data, &config, &exe, true).unwrap();
        let script = fs::read_to_string(data.join("nautilus/scripts/Open in Orbit")).unwrap();
        assert!(script.contains("/opt/Orbit App/orbit"), "{script}");
        assert!(script.contains("--open-in-orbit"));
        let kde = fs::read_to_string(data.join("kio/servicemenus/orbit-open.desktop")).unwrap();
        assert!(kde.contains("Name=Open in Orbit"));
        assert!(kde.contains("\"/opt/Orbit App/orbit\""));
        let thunar = fs::read_to_string(config.join("Thunar/uca.xml")).unwrap();
        assert!(thunar.contains(MARKER));
        apply(&data, &config, &exe, false).unwrap();
        assert!(!data.join("nautilus/scripts/Open in Orbit").exists());
        assert!(!config.join("Thunar/uca.xml").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
