//! Where the launcher keeps its data (port of launcher/src/main/paths.js).
//!
//! Game files use the same folder as the Electron launcher (`%APPDATA%/.norelauncher`,
//! `~/Library/Application Support/norelauncher`, `~/.norelauncher`, or `NORE_LAUNCHER_HOME`), so
//! versions, libraries, assets, Java runtimes and instances are shared and never downloaded twice.
//! The Rust launcher keeps its own settings file (`launcher-rs.json`) next to Electron's
//! `launcher.json`: secrets are sealed differently, and both launchers can be installed side by side.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    root: PathBuf,
}

/// Default data directory of the platform.
pub fn default_root() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(windows) {
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Roaming"));
        appdata.join(".norelauncher")
    } else if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("norelauncher")
    } else {
        home.join(".norelauncher")
    }
}

impl Paths {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `NORE_LAUNCHER_HOME` or the platform default.
    pub fn from_env() -> Self {
        match std::env::var_os("NORE_LAUNCHER_HOME") {
            Some(r) if !r.is_empty() => Self::new(r),
            _ => Self::new(default_root()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn versions(&self) -> PathBuf {
        self.root.join("versions")
    }
    pub fn libraries(&self) -> PathBuf {
        self.root.join("libraries")
    }
    pub fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }
    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }
    pub fn instances(&self) -> PathBuf {
        self.root.join("instances")
    }
    pub fn cache(&self) -> PathBuf {
        self.root.join("cache")
    }
    /// Settings, accounts and instances of the Rust launcher.
    pub fn config_file(&self) -> PathBuf {
        self.root.join("launcher-rs.json")
    }
    /// Settings of the Electron launcher (imported on the first start).
    pub fn electron_config_file(&self) -> PathBuf {
        self.root.join("launcher.json")
    }
    /// AES key for secrets when the system key store is not available (file mode 600).
    pub fn key_file(&self) -> PathBuf {
        self.root.join("launcher-rs.key")
    }
    pub fn version_dir(&self, id: &str) -> PathBuf {
        self.versions().join(id)
    }
    pub fn version_json(&self, id: &str) -> PathBuf {
        self.version_dir(id).join(format!("{id}.json"))
    }

    /// Electron's `app.getPath('userData')` of Nore Launcher: holds `session.key` (the AES key of
    /// tokens on machines without a key store) and `Local State` (the key of `safeStorage` on Windows).
    pub fn electron_user_data(&self) -> Option<PathBuf> {
        if let Some(p) = std::env::var_os("NORE_ELECTRON_USERDATA") {
            return Some(PathBuf::from(p));
        }
        dirs::config_dir().map(|d| d.join("Nore Launcher"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_matches_the_electron_launcher() {
        let p = Paths::new("/data");
        assert_eq!(p.versions(), PathBuf::from("/data/versions"));
        assert_eq!(p.version_json("1.21.1"), PathBuf::from("/data/versions/1.21.1/1.21.1.json"));
        assert_eq!(p.electron_config_file(), PathBuf::from("/data/launcher.json"));
        assert!(default_root().to_string_lossy().contains("norelauncher"));
    }
}
