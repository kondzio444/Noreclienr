//! The Nore Updater splash window (port of runSplash in launcher/src/main/main.js): shown before
//! the launcher, it checks for a new version, downloads it with the progress ring and installs it.
//! After an update it greets the new version. It never blocks the launcher for long: no update, an
//! error or "Pomiń" opens the launcher at once. The page is the shared `updater.html`; its
//! `window.noreUpdater` is built on Tauri events by the script below.

use nore_core::ipc::App;
use nore_core::js::ValueExt;
use nore_core::updater::Updater;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

const BRIDGE: &str = r#"(function () {
  if (window.noreUpdater) return;
  const ev = () => window.__TAURI__ && window.__TAURI__.event;
  window.noreUpdater = {
    onState: (fn) => { const e = ev(); if (e) e.listen('splash:state', (m) => fn(m.payload)); },
    skip: () => { const e = ev(); if (e) e.emit('splash:skip'); },
    retry: () => { const e = ev(); if (e) e.emit('splash:retry'); },
  };
})();"#;

fn post(app: &AppHandle, version: &str, st: &Value) {
    let mut v = json!({ "version": version });
    if let (Some(o), Some(p)) = (v.as_object_mut(), st.as_object()) {
        for (k, x) in p {
            o.insert(k.clone(), x.clone());
        }
    }
    let _ = app.emit_to("splash", "splash:state", v);
}

/// Runs the splash (when it should be shown) and returns when the launcher may open.
pub async fn run(app: AppHandle, core: Arc<App>, updater: Arc<dyn Updater>) {
    let cur = app.package_info().version.to_string();
    let prev = core.store.read(|d| d.str_of("lastVersion").map(String::from));
    let just_updated = prev.as_ref().is_some_and(|p| *p != cur);
    let packaged = !cfg!(debug_assertions);
    let fresh = prev.is_none() && packaged && core.store.read(|d| d.get("firstRun") != Some(&json!(false)));
    let _ = core.store.update(|d| d["lastVersion"] = json!(cur));
    let testing = std::env::var_os("NORE_UPDATER_TEST").is_some();
    if !packaged && !testing && !just_updated {
        return;
    }
    let Ok(win) = WebviewWindowBuilder::new(&app, "splash", WebviewUrl::App("updater.html".into()))
        .title("Nore Updater")
        .inner_size(400.0, 480.0)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .center()
        .background_color(tauri::window::Color(0x29, 0x1c, 0x3d, 0xff))
        .initialization_script(BRIDGE)
        .build()
    else {
        return;
    };
    let done = Arc::new(AtomicBool::new(false));
    let skip = done.clone();
    let id_skip = app.listen("splash:skip", move |_| skip.store(true, Ordering::SeqCst));
    let retry_flag = Arc::new(AtomicBool::new(false));
    let rf = retry_flag.clone();
    let id_retry = app.listen("splash:retry", move |_| rf.store(true, Ordering::SeqCst));
    let closed = done.clone();
    win.on_window_event(move |e| {
        if let tauri::WindowEvent::Destroyed = e {
            closed.store(true, Ordering::SeqCst);
        }
    });

    let started = Instant::now();
    tokio::time::sleep(Duration::from_millis(400)).await;
    let greet = just_updated || fresh;
    if greet {
        post(&app, &cur, &json!({ "state": if just_updated { "updated" } else { "installed" } }));
        tokio::time::sleep(Duration::from_millis(2600)).await;
    }
    post(&app, &cur, &json!({ "state": "checking" }));
    let u = updater.clone();
    tokio::spawn(async move {
        let _ = u.check().await;
    });
    let mut last = Value::Null;
    let mut finish_at: Option<Instant> = None;
    let begun = Instant::now();
    loop {
        if done.load(Ordering::SeqCst) {
            break;
        }
        if finish_at.is_some_and(|t| Instant::now() >= t) {
            break;
        }
        let st = updater.state();
        let state = st.string_or("state", "idle");
        // a stuck window must never keep the launcher closed
        if started.elapsed() > Duration::from_secs(20) && !["downloading", "verifying", "available"].contains(&state.as_str()) {
            break;
        }
        if begun.elapsed() > Duration::from_secs(9) && (state == "checking" || state == "idle") {
            break;
        }
        if retry_flag.swap(false, Ordering::SeqCst) {
            post(&app, &cur, &json!({ "state": "checking" }));
            finish_at = None;
            let u = updater.clone();
            tokio::spawn(async move {
                let _ = u.check().await;
            });
        }
        if st != last {
            last = st.clone();
            post(&app, &cur, &st);
            let later = |ms| Some(Instant::now() + Duration::from_millis(ms));
            match state.as_str() {
                "latest" | "dev" => finish_at = later(1100),
                "error" => finish_at = later(6000),
                "available" if core.store.settings().get("autoUpdate") == Some(&json!(false)) => finish_at = later(2600),
                "ready" => {
                    let next = st.string_or("next", "");
                    let auto = core.store.settings().get("autoUpdate") != Some(&json!(false));
                    if !auto || testing || core.store.read(|d| d.str_of("lastUpdateAttempt") == Some(&next)) {
                        finish_at = later(1500);
                    } else {
                        // one automatic attempt per version, so a broken installer cannot loop the launcher
                        let _ = core.store.update(|d| d["lastUpdateAttempt"] = json!(next));
                        post(&app, &cur, &json!({ "state": "installing", "next": next }));
                        tokio::time::sleep(Duration::from_millis(1400)).await;
                        let _ = updater.install().await;
                        finish_at = later(1500);
                    }
                }
                _ => {}
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    app.unlisten(id_skip);
    app.unlisten(id_retry);
    let w = app.get_webview_window("splash");
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(350)).await;
        if let Some(w) = w {
            let _ = w.destroy();
        }
    });
}
