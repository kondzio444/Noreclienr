//! Settings, accounts and instances (port of launcher/src/main/store.js).
//!
//! The file has exactly the JSON schema of the Electron launcher; it is kept as a JSON value so
//! fields this version does not know (added by newer launchers or other modules) are never lost.
//! On the first start the Electron launcher's data is imported (see [`import_electron`]).

use crate::error::Result;
use crate::js::{number, truthy};
use crate::oscrypt;
use crate::paths::Paths;
use crate::secrets::{gcm_open, write_private, Secrets};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Discord application of Nore Client – Rich Presence is always on.
pub const DISCORD_APP_ID: &str = "1559570563339526175";

pub fn defaults() -> Value {
    json!({
        "firstRun": true,
        "accounts": [],
        "selectedAccount": null,
        "instances": [],
        "selectedInstance": null,
        "friends": [],
        "friendsRemoved": [],
        "settings": {
            "memoryMb": 0,
            "jvmMode": "auto",
            "javaPath": "",
            "jvmArgs": "",
            "width": 1280,
            "height": 720,
            "fullscreen": false,
            "afterLaunch": "hide",
            "lightWhilePlaying": true,
            "concurrency": 16,
            "showSnapshots": false,
            "msClientId": "",
            "discordRpc": true,
            "autoUpdate": true,
            "autoRepair": true,
            "updateChannel": "all",
            "notifyContentUpdates": true,
            "discordAppId": DISCORD_APP_ID,
            "hubPresence": true,
            "animations": true,
            "motion": "full",
            "eventFx": 100,
            "accent": "#ff8a1f",
            "bgScene": "minimal",
            "bgParticles": "embers",
            "bgMotion": "kenburns",
            "bgDensity": 1,
            "bgDim": 55,
            "bgBlur": 0,
            "bgSpeed": 1,
            "bgCustom": "",
            "pageTransition": "slide",
            "accentPreset": "nore"
        }
    })
}

/// eventFx is 25–100 % (events cannot be switched off).
pub fn clamp_event_fx(v: &Value) -> Value {
    let n = number(v);
    let n = if n == 0.0 || n.is_nan() { 100.0 } else { n };
    let n = n.clamp(25.0, 100.0);
    if n.fract() == 0.0 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// Defaults + the saved file + the one-time migrations of store.js load().
pub fn normalize(raw: Value) -> Value {
    let mut data = defaults();
    let Value::Object(raw) = raw else { return data };
    let base_settings = data["settings"].clone();
    let obj = data.as_object_mut().expect("defaults are an object");
    for (k, v) in raw.iter() {
        if k != "settings" {
            obj.insert(k.clone(), v.clone());
        }
    }
    let mut settings = base_settings.as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(s)) = raw.get("settings") {
        for (k, v) in s {
            settings.insert(k.clone(), v.clone());
        }
    }
    let s = &mut settings;
    if !s.get("discordAppId").is_some_and(truthy) {
        s.insert("discordAppId".into(), json!(DISCORD_APP_ID));
    }
    s.insert("discordRpc".into(), json!(true));
    if !s.get("violetMigrated").is_some_and(truthy) {
        if s.get("accentPreset") == Some(&json!("orange")) {
            s.insert("accentPreset".into(), json!("nore"));
        }
        s.insert("violetMigrated".into(), json!(true));
    }
    if !s.get("albumMigrated").is_some_and(truthy) {
        if s.get("bgScene") == Some(&json!("photo")) {
            s.insert("bgScene".into(), json!("minimal"));
        }
        if s.get("pageTransition") == Some(&json!("rise")) {
            s.insert("pageTransition".into(), json!("slide"));
        }
        s.insert("albumMigrated".into(), json!(true));
    }
    if !s.get("memoryMigrated").is_some_and(truthy) {
        if s.get("memoryMb").map(number) == Some(4096.0) {
            s.insert("memoryMb".into(), json!(0));
        }
        s.insert("memoryMigrated".into(), json!(true));
    }
    let fx = clamp_event_fx(s.get("eventFx").unwrap_or(&Value::Null));
    s.insert("eventFx".into(), fx);
    obj.insert("settings".into(), Value::Object(settings));
    data
}

/// The settings file in memory; every change is written at once (atomically, mode 600).
pub struct Store {
    file: PathBuf,
    data: Mutex<Value>,
}

impl Store {
    /// Loads the file (defaults when it is missing or broken).
    pub fn open(file: impl Into<PathBuf>) -> Self {
        let file = file.into();
        let raw = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .unwrap_or(Value::Null);
        Self { file, data: Mutex::new(normalize(raw)) }
    }

    /// A store that is never written (tests).
    pub fn memory(data: Value) -> Self {
        Self { file: PathBuf::new(), data: Mutex::new(normalize(data)) }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Value> {
        self.data.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads without copying the whole store.
    pub fn read<R>(&self, f: impl FnOnce(&Value) -> R) -> R {
        f(&self.lock())
    }

    /// A copy of the whole store.
    pub fn get(&self) -> Value {
        self.lock().clone()
    }

    pub fn settings(&self) -> Value {
        self.read(|d| d["settings"].clone())
    }

    /// Changes the data and saves it.
    pub fn update<R>(&self, f: impl FnOnce(&mut Value) -> R) -> Result<R> {
        let mut d = self.lock();
        let r = f(&mut d);
        if !self.file.as_os_str().is_empty() {
            save(&self.file, &d)?;
        }
        Ok(r)
    }
}

fn save(file: &Path, data: &Value) -> Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    // tokens inside are encrypted, but the file is still private to the user
    write_private(&tmp, serde_json::to_string_pretty(data)?.as_bytes())?;
    std::fs::rename(&tmp, file)?;
    Ok(())
}

/// What the first start brought over from the Electron launcher.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub accounts: usize,
    pub sessions_kept: usize,
    pub sessions_lost: usize,
    pub instances: usize,
    pub identity: &'static str,
}

/// Opens an Electron-sealed secret box: `{ gcm }` (AES key in userData/session.key) or `{ enc }`
/// (safeStorage).
pub fn electron_unseal(sealed: &Value, user_data: Option<&Path>) -> Option<Value> {
    let ud = user_data?;
    if let Some(g) = sealed.get("gcm").and_then(Value::as_str) {
        let key: [u8; 32] = std::fs::read(ud.join("session.key")).ok()?.try_into().ok()?;
        let plain = gcm_open(&key, &B64.decode(g).ok()?)?;
        return serde_json::from_slice(&plain).ok();
    }
    if let Some(e) = sealed.get("enc").and_then(Value::as_str) {
        let plain = oscrypt::decrypt(&B64.decode(e).ok()?, ud)?;
        return serde_json::from_slice(&plain).ok();
    }
    None
}

/// First start of the Rust launcher: copies the Electron launcher's settings, accounts, instances
/// and chat identity into `launcher-rs.json`, re-sealing secrets with this launcher's key.
/// Does nothing when the Rust settings exist already or there is no Electron data.
pub fn import_electron(paths: &Paths, secrets: &Secrets) -> Result<Option<ImportReport>> {
    if paths.config_file().exists() {
        return Ok(None);
    }
    let Ok(text) = std::fs::read_to_string(paths.electron_config_file()) else { return Ok(None) };
    let Ok(mut raw) = serde_json::from_str::<Value>(&text) else { return Ok(None) };
    let user_data = paths.electron_user_data();
    let report = convert_electron(&mut raw, secrets, user_data.as_deref());
    let data = normalize(raw);
    save(&paths.config_file(), &data)?;
    log::info!("Zaimportowano dane launchera Electron: {report:?}");
    Ok(Some(report))
}

/// The conversion itself (pure apart from reading Electron's key files) – see [`import_electron`].
pub fn convert_electron(raw: &mut Value, secrets: &Secrets, user_data: Option<&Path>) -> ImportReport {
    let mut report = ImportReport { identity: "none", ..Default::default() };
    if let Some(list) = raw.get_mut("accounts").and_then(Value::as_array_mut) {
        report.accounts = list.len();
        for acc in list.iter_mut() {
            let Some(obj) = acc.as_object_mut() else { continue };
            let Some(sealed) = obj.remove("secret") else { continue };
            match electron_unseal(&sealed, user_data) {
                Some(secret) if secret.get("refreshToken").is_some() || secret.get("accessToken").is_some() => {
                    obj.insert("secret".into(), secrets.seal(&secret));
                    report.sessions_kept += 1;
                }
                // unreadable here: the account stays, the player logs in again when playing premium
                _ => report.sessions_lost += 1,
            }
        }
    }
    report.instances = raw.get("instances").and_then(Value::as_array).map_or(0, Vec::len);
    if let Some(id) = raw.pointer_mut("/chat/identity").and_then(Value::as_object_mut) {
        let priv_pem = id.get("priv").and_then(Value::as_str).and_then(|p| match p.strip_prefix("enc:") {
            None => Some(p.to_string()),
            Some(b) => {
                let bytes = B64.decode(b).ok()?;
                String::from_utf8(oscrypt::decrypt(&bytes, user_data?)?).ok()
            }
        });
        match priv_pem {
            Some(pem) if pem.contains("PRIVATE KEY") => {
                id.insert("priv".into(), json!(secrets.seal_str(&pem)));
                report.identity = "kept";
            }
            _ => {
                // the Nore ID cannot be moved: a new one is created on first use
                let mut keep = Map::new();
                if let Some(c) = id.get("created") {
                    keep.insert("lostAt".into(), c.clone());
                }
                *id = keep;
                report.identity = "lost";
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_migrations_follow_store_js() {
        let d = normalize(json!({
            "firstRun": false,
            "instances": [{ "id": "a" }],
            "custom": { "kept": true },
            "settings": { "memoryMb": 4096, "accentPreset": "orange", "bgScene": "photo", "eventFx": 5, "discordAppId": "", "discordRpc": false }
        }));
        let s = &d["settings"];
        assert_eq!(d["firstRun"], json!(false));
        assert_eq!(d["custom"]["kept"], json!(true));
        assert_eq!(s["memoryMb"], json!(0));
        assert_eq!(s["accentPreset"], json!("nore"));
        assert_eq!(s["bgScene"], json!("minimal"));
        assert_eq!(s["eventFx"], json!(25));
        assert_eq!(s["discordAppId"], json!(DISCORD_APP_ID));
        assert_eq!(s["discordRpc"], json!(true));
        assert_eq!(s["width"], json!(1280));
        // migrations run once: a later choice of 4096 MB stays
        let again = normalize(json!({ "settings": { "memoryMb": 4096, "memoryMigrated": true } }));
        assert_eq!(again["settings"]["memoryMb"], json!(4096));
        assert_eq!(normalize(Value::Null)["firstRun"], json!(true));
    }

    #[test]
    fn store_saves_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("launcher-rs.json");
        let s = Store::open(&f);
        s.update(|d| d["selectedInstance"] = json!("x")).unwrap();
        let back = Store::open(&f);
        assert_eq!(back.read(|d| d["selectedInstance"].clone()), json!("x"));
        assert!(!dir.path().join("launcher-rs.json.tmp").exists());
    }

    #[test]
    fn import_moves_sessions_and_identity() {
        let ud = tempfile::tempdir().unwrap();
        let key = hex::decode("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f").unwrap();
        std::fs::write(ud.path().join("session.key"), key).unwrap();
        let secrets = Secrets::in_memory();
        let mut raw = json!({
            "firstRun": false,
            "accounts": [
                { "id": "ms-1", "type": "microsoft", "name": "Steve", "secret": { "gcm": crate::testdata::ELECTRON_GCM_BOX } },
                { "id": "ms-2", "type": "microsoft", "name": "Alex", "secret": { "enc": "djExYnJva2Vu" } },
                { "id": "offline-x", "type": "offline", "name": "Gracz" }
            ],
            "instances": [{ "id": "nore-client-abc123" }],
            "chat": { "identity": { "pub": crate::testdata::ID_PUB, "priv": crate::testdata::ID_PRIV, "created": 1 } }
        });
        let r = convert_electron(&mut raw, &secrets, Some(ud.path()));
        assert_eq!((r.accounts, r.sessions_kept, r.sessions_lost, r.instances, r.identity), (3, 1, 1, 1, "kept"));
        let s = secrets.unseal(&raw["accounts"][0]["secret"]);
        assert_eq!(s["refreshToken"], json!("r"));
        assert!(raw["accounts"][1].get("secret").is_none());
        let p = raw["chat"]["identity"]["priv"].as_str().unwrap();
        assert!(p.starts_with("gcm:"));
        assert_eq!(secrets.unseal_str(p).unwrap(), crate::testdata::ID_PRIV);
        assert_eq!(raw["chat"]["identity"]["pub"], json!(crate::testdata::ID_PUB));
    }

    #[test]
    fn import_runs_once() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path());
        std::fs::write(paths.electron_config_file(), r#"{"firstRun":false,"instances":[{"id":"a"}]}"#).unwrap();
        let secrets = Secrets::in_memory();
        assert!(import_electron(&paths, &secrets).unwrap().is_some());
        assert!(import_electron(&paths, &secrets).unwrap().is_none());
        let s = Store::open(paths.config_file());
        assert_eq!(s.read(|d| d["firstRun"].clone()), json!(false));
        assert_eq!(s.read(|d| d["instances"][0]["id"].clone()), json!("a"));
    }
}
