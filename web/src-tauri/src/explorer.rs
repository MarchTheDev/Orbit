//! Per-user Windows Explorer integration for opening executables in Orbit.
//!
//! The verb lives only below `HKCU\Software\Classes\exefile\shell\OpenInOrbit`;
//! it neither replaces the `.exe` association nor changes another launcher's keys.

use std::process::{Command, Output};

const MENU_KEY: &str = r"HKCU\Software\Classes\exefile\shell\OpenInOrbit";
const COMMAND_KEY: &str = r"HKCU\Software\Classes\exefile\shell\OpenInOrbit\command";

/// Reconcile the saved preference with the current user's Explorer menu.
pub fn set_context_menu(enabled: bool) -> Result<(), String> {
    if enabled {
        register()
    } else {
        remove()
    }
}

fn register() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("could not find Orbit's executable: {error}"))?;
    let executable = executable.to_string_lossy();
    let icon = format!("\"{executable}\",0");
    let command = format!("\"{executable}\" --open-in-orbit \"%1\"");

    let result = (|| {
        // Create the command first; publishing the parent verb last prevents a
        // half-written entry from appearing if one of the registry writes fails.
        add_value(COMMAND_KEY, None, &command)?;
        add_value(MENU_KEY, Some("Icon"), &icon)?;
        add_value(MENU_KEY, None, "Open in Orbit")
    })();

    if result.is_err() {
        let _ = remove();
    }
    result
}

fn registry_command() -> Command {
    // The shared helper is what keeps the console from flashing while this
    // reconciles the key, and what keeps a bundled build's environment out of it.
    crate::process::command("reg.exe")
}

fn remove() -> Result<(), String> {
    // `reg delete` reports a missing key as an error. Query first so disabling
    // the default-on preference is also harmless on a fresh installation.
    let query = registry_command()
        .arg("query")
        .arg(MENU_KEY)
        .output()
        .map_err(|error| format!("could not query the Explorer menu registry key: {error}"))?;
    if !query.status.success() {
        let message = output_message(&query);
        if message.to_ascii_lowercase().contains("access is denied") {
            return Err(format!("could not read the Explorer menu registry key: {message}"));
        }
        return Ok(());
    }

    let output = registry_command()
        .arg("delete")
        .arg(MENU_KEY)
        .arg("/f")
        .output()
        .map_err(|error| format!("could not remove the Explorer menu entry: {error}"))?;
    check_output(output, "could not remove the Explorer menu entry")
}

fn add_value(key: &str, name: Option<&str>, value: &str) -> Result<(), String> {
    let mut command = registry_command();
    command.arg("add").arg(key);
    if let Some(name) = name {
        command.arg("/v").arg(name);
    } else {
        command.arg("/ve");
    }
    let output = command
        .arg("/t")
        .arg("REG_SZ")
        .arg("/d")
        .arg(value)
        .arg("/f")
        .output()
        .map_err(|error| format!("could not write the Explorer menu registry key: {error}"))?;
    check_output(output, "could not write the Explorer menu registry key")
}

fn check_output(output: Output, context: &str) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    let detail = output_message(&output);
    Err(if detail.is_empty() {
        context.to_string()
    } else {
        format!("{context}: {detail}")
    })
}

fn output_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        stderr
    }
}
