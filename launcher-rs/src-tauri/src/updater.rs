//! Launcher self-update through the Tauri updater, reading the Nore API feed
//! (`/api/v2/updates/feed/latest.json`). The state machine and its JSON are those of the Electron
//! updater (updater.js), so the renderer's update banner works unchanged.
//!
//! Signatures are mandatory in the Tauri updater: the public minisign key is compiled in –
//! [`DEFAULT_PUBKEY`] (committed, it is public), or `NORE_UPDATER_PUBKEY` at build time when set
//! (CI: `vars.NORE_UPDATER_PUBKEY`). The private key stays a CI secret. Debug builds report `dev`
//! (`NORE_UPDATER_TEST=1` turns the updater on there).

use async_trait::async_trait;
use nore_core::error::{msg, Result};
use nore_core::updater::{friendly, Updater, FEED};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The public key of the Nore updater signing key (minisign key id D2FD2480DABA1D85).
pub const DEFAULT_PUBKEY: &str =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQyRkQyNDgwREFCQTFEODUKUldTRkhicmFnQ1Q5MGh1ODR4UFBSU29aREQySUxqVmZVcTNLMXhGZDVHMk1UdU4wN2pOSDhZWFMK";

/// The key this build checks updates with, or None (debug builds without NORE_UPDATER_TEST).
fn pubkey() -> Option<&'static str> {
    if cfg!(debug_assertions) && std::env::var_os("NORE_UPDATER_TEST").is_none() {
        return None;
    }
    Some(option_env!("NORE_UPDATER_PUBKEY").map(str::trim).filter(|k| !k.is_empty()).unwrap_or(DEFAULT_PUBKEY))
}

pub struct TauriUpdater {
    app: AppHandle,
    pubkey: Option<&'static str>,
    state: Mutex<Value>,
    update: tokio::sync::Mutex<Option<Update>>,
    bytes: tokio::sync::Mutex<Option<Vec<u8>>>,
    auto: AtomicBool,
}

impl TauriUpdater {
    pub fn new(app: AppHandle, auto: bool) -> Arc<Self> {
        let pubkey = pubkey();
        let version = app.package_info().version.to_string();
        let state = if pubkey.is_some() { "idle" } else { "dev" };
        Arc::new(Self {
            app,
            pubkey,
            state: Mutex::new(json!({ "state": state, "version": version })),
            update: tokio::sync::Mutex::new(None),
            bytes: tokio::sync::Mutex::new(None),
            auto: AtomicBool::new(auto),
        })
    }

    fn set(&self, patch: Value) -> Value {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let (Some(t), Some(p)) = (s.as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                t.insert(k.clone(), v.clone());
            }
        }
        let out = s.clone();
        drop(s);
        let _ = self.app.emit("update:state", out.clone());
        out
    }

    /// First check 8 s after start, then every 3 hours (builds with a key only).
    pub fn schedule(self: &Arc<Self>) {
        if self.pubkey.is_none() {
            return;
        }
        let me = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(8)).await;
            loop {
                let _ = me.check().await;
                tokio::time::sleep(Duration::from_secs(3 * 3600)).await;
            }
        });
    }
}

#[async_trait]
impl Updater for TauriUpdater {
    fn state(&self) -> Value {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    async fn check(&self) -> Result<Value> {
        let Some(key) = self.pubkey else { return Ok(self.state()) };
        self.set(json!({ "state": "checking" }));
        let found = async {
            let url = FEED.parse().map_err(nore_core::error::wrap)?;
            let updater =
                self.app.updater_builder().pubkey(key).endpoints(vec![url]).map_err(nore_core::error::wrap)?.build().map_err(nore_core::error::wrap)?;
            updater.check().await.map_err(nore_core::error::wrap)
        }
        .await;
        match found {
            Ok(Some(u)) => {
                let notes: String = u.body.clone().unwrap_or_default().chars().take(600).collect();
                let next = u.version.clone();
                *self.update.lock().await = Some(u);
                *self.bytes.lock().await = None;
                let auto = self.auto.load(Ordering::SeqCst);
                let st =
                    self.set(json!({ "state": if auto { "downloading" } else { "available" }, "next": next, "percent": 0, "notes": notes, "message": null }));
                if auto {
                    self.download().await?;
                    return Ok(self.state());
                }
                Ok(st)
            }
            Ok(None) => Ok(self.set(json!({ "state": "latest", "checkedAt": nore_core::js::now_ms(), "message": null }))),
            Err(e) => Ok(self.set(json!({ "state": "error", "message": friendly(&e.to_string()) }))),
        }
    }

    async fn download(&self) -> Result<Value> {
        let guard = self.update.lock().await;
        let Some(u) = guard.as_ref() else { return Ok(self.state()) };
        if self.bytes.lock().await.is_some() {
            return Ok(self.state());
        }
        self.set(json!({ "state": "downloading", "percent": 0, "next": u.version }));
        let mut got: u64 = 0;
        let mut last = 0;
        let result = u
            .download(
                |n, total| {
                    got += n as u64;
                    if let Some(t) = total.filter(|t| *t > 0) {
                        let pct = (got * 100 / t) as u32;
                        if pct != last {
                            last = pct;
                            self.set(json!({ "state": "downloading", "percent": pct, "bytes": got, "size": t }));
                        }
                    }
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => {
                *self.bytes.lock().await = Some(bytes);
                Ok(self.set(json!({ "state": "ready", "next": u.version })))
            }
            Err(e) => {
                let st = self.set(json!({ "state": "error", "message": friendly(&e.to_string()) }));
                Err(msg(st["message"].as_str().unwrap_or_default()))
            }
        }
    }

    async fn install(&self) -> Result<Value> {
        if self.state()["state"] != "ready" {
            return Ok(json!(false));
        }
        let guard = self.update.lock().await;
        let bytes = self.bytes.lock().await;
        if let (Some(u), Some(b)) = (guard.as_ref(), bytes.as_ref()) {
            u.install(b).map_err(|e| msg(friendly(&e.to_string())))?;
            self.app.restart();
        }
        Ok(json!(true))
    }

    fn configure(&self, settings: &Value) {
        self.auto.store(settings.get("autoUpdate") != Some(&json!(false)), Ordering::SeqCst);
    }
}
