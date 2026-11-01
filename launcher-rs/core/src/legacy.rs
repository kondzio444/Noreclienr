//! The old Electron launcher after the move to this one (Windows): after the first-run import the
//! launcher offers once to remove it. Its NSIS uninstaller (electron-builder, "Uninstall Nore
//! Launcher.exe") runs silently; it removes only the program – the game folder
//! (`%APPDATA%/.norelauncher`) and Electron's own settings stay (`deleteAppDataOnUninstall: false`).
//! The uninstaller also deletes the desktop shortcut "Nore Launcher.lnk", which this launcher's
//! installer had taken over, so it is created again for this launcher afterwards.
//!
//! The state lives in `launcher-rs.json` → `legacyElectron: { offered, removed, at, error }`.

use crate::error::{msg, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The file name of electron-builder's uninstaller (productName "Nore Launcher").
pub const UNINSTALLER: &str = "Uninstall Nore Launcher.exe";

/// An installed Electron launcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElectronInstall {
    pub dir: PathBuf,
    pub uninstaller: PathBuf,
    /// arguments for a silent uninstall (from QuietUninstallString, else `/currentuser /S`)
    pub args: Vec<String>,
}

/// The keys and values of `reg query <key> /s` output.
pub fn parse_reg_query(out: &str) -> Vec<(String, HashMap<String, String>)> {
    let mut list: Vec<(String, HashMap<String, String>)> = Vec::new();
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if line.starts_with("HKEY_") {
            list.push((line.trim().to_string(), HashMap::new()));
            continue;
        }
        let Some((_, values)) = list.last_mut() else { continue };
        let t = line.trim_start();
        if t.is_empty() || t.len() == line.len() {
            continue;
        }
        // "    Name    REG_SZ    value" (the name may contain single spaces)
        let parts: Vec<&str> = t.splitn(3, "    ").collect();
        if parts.len() >= 2 && parts[1].starts_with("REG_") {
            values.insert(parts[0].to_string(), parts.get(2).map(|v| v.trim().to_string()).unwrap_or_default());
        }
    }
    list
}

/// Splits `"C:\path with spaces\Uninstall Nore Launcher.exe" /currentuser /S` into the program and its arguments.
pub fn split_command(cmd: &str) -> Option<(PathBuf, Vec<String>)> {
    let cmd = cmd.trim();
    let (exe, rest) = if let Some(r) = cmd.strip_prefix('"') {
        let end = r.find('"')?;
        (&r[..end], &r[end + 1..])
    } else {
        // unquoted: up to ".exe"
        let end = cmd.to_ascii_lowercase().find(".exe")? + 4;
        (&cmd[..end], &cmd[end..])
    };
    Some((PathBuf::from(exe), rest.split_whitespace().map(String::from).collect()))
}

/// The Electron launcher among the uninstall entries: its uninstaller is "Uninstall Nore Launcher.exe"
/// (this launcher's own entry uses `uninstall.exe`).
pub fn find_in_registry(out: &str) -> Option<ElectronInstall> {
    for (_, v) in parse_reg_query(out) {
        let name = v.get("DisplayName").map(String::as_str).unwrap_or("");
        if !name.starts_with("Nore Launcher") {
            continue;
        }
        let quiet = v.get("QuietUninstallString").and_then(|c| split_command(c));
        let plain = v.get("UninstallString").and_then(|c| split_command(c));
        let Some((exe, args)) = quiet.clone().or(plain) else { continue };
        // Windows paths, also when the tests run elsewhere
        let text = exe.to_string_lossy().to_string();
        let (parent, file) = text.rsplit_once(['\\', '/']).unwrap_or(("", text.as_str()));
        if !file.eq_ignore_ascii_case(UNINSTALLER) {
            continue;
        }
        let mut args = if quiet.is_some() { args } else { args.into_iter().filter(|a| a != "/S").collect::<Vec<_>>() };
        if !args.iter().any(|a| a.eq_ignore_ascii_case("/S")) {
            args.push("/S".into());
        }
        let dir = v.get("InstallLocation").filter(|l| !l.is_empty()).map(PathBuf::from).or_else(|| (!parent.is_empty()).then(|| PathBuf::from(parent)))?;
        return Some(ElectronInstall { dir, uninstaller: exe, args });
    }
    None
}

/// The default per-user install of electron-builder (`%LOCALAPPDATA%\Programs\nore-launcher`).
pub fn default_install(local_app_data: &Path) -> Option<ElectronInstall> {
    let dir = local_app_data.join("Programs").join("nore-launcher");
    let uninstaller = dir.join(UNINSTALLER);
    uninstaller.is_file().then(|| ElectronInstall { dir, uninstaller, args: vec!["/currentuser".into(), "/S".into()] })
}

/// A console program without a console window (Windows).
fn quiet(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// Finds the Electron launcher on this computer (Windows only; elsewhere the new launcher replaced it in place).
pub fn detect() -> Option<ElectronInstall> {
    if !cfg!(windows) {
        return None;
    }
    let reg = quiet("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall", "/s"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    find_in_registry(&reg).filter(|e| e.uninstaller.is_file()).or_else(|| std::env::var_os("LOCALAPPDATA").and_then(|l| default_install(Path::new(&l))))
}

/// Whether to ask now: an Electron install exists and the question was not asked before.
pub fn should_offer(state: &Value, found: bool) -> bool {
    found && state.pointer("/legacyElectron/offered") != Some(&json!(true))
}

/// Runs the uninstaller silently and waits until the program folder is gone (at most `wait`).
/// The game folder is never touched.
pub fn uninstall(e: &ElectronInstall, wait: std::time::Duration) -> Result<()> {
    let status = std::process::Command::new(&e.uninstaller)
        .args(&e.args)
        .current_dir(std::env::temp_dir())
        .status()
        .map_err(|err| msg(format!("Nie udało się uruchomić deinstalatora starego launchera: {err}")))?;
    if !status.success() {
        return Err(msg(format!("Deinstalator starego launchera zakończył się kodem {}.", status.code().unwrap_or(-1))));
    }
    // the NSIS uninstaller copies itself to %TEMP% and continues there
    let exe = e.dir.join("Nore Launcher.exe");
    let until = std::time::Instant::now() + wait;
    while exe.exists() && std::time::Instant::now() < until {
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    if exe.exists() {
        return Err(msg("Stary launcher nie został jeszcze usunięty – spróbuj z Ustawień systemu (Aplikacje)."));
    }
    Ok(())
}

/// Creates the desktop shortcut "Nore Launcher.lnk" for `exe` when it is missing (Windows).
pub fn ensure_desktop_shortcut(exe: &Path) {
    if !cfg!(windows) {
        return;
    }
    let script = "$d=[Environment]::GetFolderPath('Desktop'); $l=Join-Path $d 'Nore Launcher.lnk'; \
                  if (-not (Test-Path -LiteralPath $l)) { $s=(New-Object -ComObject WScript.Shell).CreateShortcut($l); \
                  $s.TargetPath=$env:NORE_EXE; $s.WorkingDirectory=(Split-Path -Parent $env:NORE_EXE); $s.Save() }";
    let _ = quiet("powershell").args(["-NoProfile", "-NonInteractive", "-Command", script]).env("NORE_EXE", exe).status();
}

#[cfg(test)]
mod tests {
    use super::*;

    const REG: &str = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nore Launcher\r\n    DisplayName    REG_SZ    Nore Launcher\r\n    UninstallString    REG_SZ    \"C:\\Users\\Gracz\\AppData\\Local\\Nore Launcher\\uninstall.exe\"\r\n\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\8f2a1e3c-0000-5000-8000-000000000000\r\n    DisplayName    REG_SZ    Nore Launcher 1.4.1432\r\n    DisplayVersion    REG_SZ    1.4.1432\r\n    InstallLocation    REG_SZ    C:\\Users\\Gracz\\AppData\\Local\\Programs\\nore-launcher\r\n    UninstallString    REG_SZ    \"C:\\Users\\Gracz\\AppData\\Local\\Programs\\nore-launcher\\Uninstall Nore Launcher.exe\" /currentuser\r\n    QuietUninstallString    REG_SZ    \"C:\\Users\\Gracz\\AppData\\Local\\Programs\\nore-launcher\\Uninstall Nore Launcher.exe\" /currentuser /S\r\n\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Other\r\n    DisplayName    REG_SZ    Inna gra\r\n";

    #[test]
    fn finds_the_electron_uninstaller_not_our_own() {
        let e = find_in_registry(REG).unwrap();
        assert_eq!(e.uninstaller, PathBuf::from(r"C:\Users\Gracz\AppData\Local\Programs\nore-launcher\Uninstall Nore Launcher.exe"));
        assert_eq!(e.args, vec!["/currentuser", "/S"]);
        assert_eq!(e.dir, PathBuf::from(r"C:\Users\Gracz\AppData\Local\Programs\nore-launcher"));
        // only our own (Tauri) entry: nothing to remove
        let own = REG.split("\r\n\r\n").next().unwrap();
        assert!(own.contains("uninstall.exe"));
        assert!(find_in_registry(own).is_none());
        assert_eq!(parse_reg_query(REG).len(), 3);
    }

    #[test]
    fn uninstall_string_without_quiet_variant_gets_silent_flag() {
        let reg = "HKEY_CURRENT_USER\\X\\{abc}\n    DisplayName    REG_SZ    Nore Launcher\n    UninstallString    REG_SZ    \"D:\\Gry\\Nore\\Uninstall Nore Launcher.exe\" /currentuser\n";
        let e = find_in_registry(reg).unwrap();
        assert_eq!(e.args, vec!["/currentuser", "/S"]);
        assert_eq!(e.dir, PathBuf::from(r"D:\Gry\Nore"));
        assert_eq!(split_command(r"C:\a b\Uninstall Nore Launcher.exe /S").unwrap().1, vec!["/S"]);
    }

    #[test]
    fn default_install_and_offer_once() {
        let dir = tempfile::tempdir().unwrap();
        assert!(default_install(dir.path()).is_none());
        let p = dir.path().join("Programs").join("nore-launcher");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join(UNINSTALLER), b"x").unwrap();
        assert_eq!(default_install(dir.path()).unwrap().args, vec!["/currentuser", "/S"]);
        assert!(should_offer(&json!({}), true));
        assert!(!should_offer(&json!({}), false));
        assert!(!should_offer(&json!({ "legacyElectron": { "offered": true } }), true));
    }
}
