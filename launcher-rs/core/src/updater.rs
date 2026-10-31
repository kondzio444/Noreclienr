//! Launcher self-update, as the renderer sees it (`update:*` channels, `update:state` events).
//! The shell provides the implementation: the Tauri app uses the Tauri updater against the Nore API
//! feed (`/api/v2/updates/feed/latest.json`); development builds and the command line tool report
//! `dev` like an unpackaged Electron launcher.
//!
//! States (same as updater.js): idle, dev, checking, latest, available, downloading, verifying,
//! ready, error – with `version`, `next`, `percent`, `notes`, `message`.

use crate::error::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

/// The Nore API feed the Tauri updater reads (302 to the release's `latest.json`).
pub const FEED: &str = "https://noreclient.pl/api/v2/updates/feed/latest.json";

#[async_trait]
pub trait Updater: Send + Sync {
    fn state(&self) -> Value;
    async fn check(&self) -> Result<Value>;
    async fn download(&self) -> Result<Value>;
    /// Installs a downloaded update (restarts the launcher).
    async fn install(&self) -> Result<Value>;
    /// Settings changed (autoUpdate).
    fn configure(&self, _settings: &Value) {}
}

/// No updates in this build (development, command line).
pub struct DevUpdater {
    pub version: String,
}

#[async_trait]
impl Updater for DevUpdater {
    fn state(&self) -> Value {
        json!({ "state": "dev", "version": self.version })
    }
    async fn check(&self) -> Result<Value> {
        Ok(self.state())
    }
    async fn download(&self) -> Result<Value> {
        Ok(self.state())
    }
    async fn install(&self) -> Result<Value> {
        Ok(json!(false))
    }
}

/// Updater errors in plain Polish (friendly() of updater.js).
pub fn friendly(message: &str) -> String {
    let m = message;
    let lower = m.to_lowercase();
    if lower.contains("404") || lower.contains("no published versions") {
        return "Nie ma jeszcze wydania – pojawi się automatycznie po zbudowaniu nowej wersji.".into();
    }
    if ["dns", "connect", "timed out", "timeout", "connection", "network"].iter().any(|k| lower.contains(k)) {
        return "Brak połączenia z serwerem aktualizacji.".into();
    }
    if ["403", "429", "500", "502", "503", "504"].iter().any(|k| m.contains(k)) {
        return "Serwer aktualizacji jest chwilowo niedostępny – spróbuję później.".into();
    }
    m.lines().next().unwrap_or("").chars().take(200).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_errors() {
        assert_eq!(friendly("error sending request: dns error"), "Brak połączenia z serwerem aktualizacji.");
        assert!(friendly("HTTP 404").starts_with("Nie ma jeszcze wydania"));
        assert!(friendly("status 503").starts_with("Serwer aktualizacji"));
        assert_eq!(friendly("Inny błąd\nszczegóły"), "Inny błąd");
    }
}
