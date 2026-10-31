//! Nore Launcher – the Tauri shell around nore-core.
//!
//! The window shows the existing renderer (launcher/src/renderer, unchanged); `compat/nore-tauri.js`
//! is injected before it loads and builds `window.nore` on top of the single `nore_ipc` command,
//! which forwards every Electron IPC channel to `nore_core::ipc::App`. Core events go back to the
//! page as Tauri events with the Electron channel names.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod updater;

use async_trait::async_trait;
use nore_core::error::{msg, Result};
use nore_core::ipc::{App, Config, Emitter, Shell};
use nore_core::paths::Paths;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, UserAttentionType, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const COMPAT: &str = include_str!("../../compat/nore-tauri.js");

struct Events(AppHandle);

impl Emitter for Events {
    fn emit(&self, channel: &str, payload: Value) {
        let _ = tauri::Emitter::emit(&self.0, channel, payload);
    }
}

struct Desktop(AppHandle);

impl Desktop {
    fn main(&self) -> Option<tauri::WebviewWindow> {
        self.0.get_webview_window("main")
    }
}

#[async_trait]
impl Shell for Desktop {
    fn open_url(&self, url: &str) -> Result<()> {
        self.0.opener().open_url(url, None::<&str>).map_err(|e| msg(format!("Nie udało się otworzyć strony: {e}")))
    }

    fn open_path(&self, path: &Path) -> Result<()> {
        self.0.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| msg(format!("Nie udało się otworzyć folderu: {e}")))
    }

    async fn pick_file(&self, title: &str, filter_name: &str, extensions: &[&str]) -> Option<PathBuf> {
        let mut dialog = self.0.dialog().file().set_title(title);
        if let Some(w) = self.main() {
            dialog = dialog.set_parent(&w);
        }
        if !extensions.is_empty() {
            dialog = dialog.add_filter(filter_name, extensions);
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        dialog.pick_file(move |f| {
            let _ = tx.send(f.and_then(|f| f.into_path().ok()));
        });
        rx.await.ok().flatten()
    }

    fn window(&self, action: &str) {
        let Some(w) = self.main() else { return };
        let _ = match action {
            "minimize" => w.minimize(),
            "maximize" => {
                if w.is_maximized().unwrap_or(false) {
                    w.unmaximize()
                } else {
                    w.maximize()
                }
            }
            "close" => w.close(),
            "hide" => w.hide(),
            "show" => w.show().and_then(|_| w.unminimize()),
            "focus" => w.set_focus(),
            "flash" => w.request_user_attention(Some(UserAttentionType::Informational)),
            _ => Ok(()),
        };
    }

    fn is_focused(&self) -> bool {
        self.main().and_then(|w| w.is_focused().ok()).unwrap_or(true)
    }

    fn quit(&self) {
        self.0.exit(0);
    }
}

/// Every `window.nore.*` call of the renderer.
#[tauri::command]
async fn nore_ipc(app: tauri::State<'_, Arc<App>>, channel: String, args: Vec<Value>) -> std::result::Result<Value, String> {
    let app = app.inner().clone();
    app.invoke(&channel, args).await.map_err(|e| e.to_string())
}

/// Only the launcher's own pages are shown; https links open in the system browser.
fn allow_navigation(handle: &AppHandle, url: &tauri::Url) -> bool {
    let own = matches!(url.scheme(), "tauri" | "asset")
        || url.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions) && url.host_str() == Some("localhost"));
    if !own && url.scheme() == "https" {
        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
    }
    own
}

fn main() {
    // one tokio runtime for Tauri and nore-core (which spawns its own background tasks)
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().thread_name("nore").build().expect("tokio runtime");
    tauri::async_runtime::set(runtime.handle().clone());
    let _enter = runtime.enter();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![nore_ipc])
        .setup(|tauri_app| {
            let handle = tauri_app.handle().clone();
            let version = tauri_app.package_info().version.to_string();
            let paths = Paths::from_env();
            let auto = !std::fs::read_to_string(paths.config_file()).ok().is_some_and(|t| t.contains("\"autoUpdate\": false"));
            let updater = updater::TauriUpdater::new(handle.clone(), auto);
            let core = App::new(Config {
                paths,
                version,
                emitter: Arc::new(Events(handle.clone())),
                shell: Arc::new(Desktop(handle.clone())),
                updater: updater.clone(),
                resource_dir: tauri_app.path().resource_dir().ok(),
                ephemeral_secrets: false,
            })
            .map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
            tauri_app.manage(core.clone());

            let nav = handle.clone();
            let window = WebviewWindowBuilder::new(tauri_app, "main", WebviewUrl::App("index.html".into()))
                .title("Nore Launcher")
                .inner_size(1220.0, 760.0)
                .min_inner_size(980.0, 640.0)
                .decorations(false)
                .background_color(tauri::window::Color(0x29, 0x1c, 0x3d, 0xff))
                .initialization_script(COMPAT)
                .on_navigation(move |url| allow_navigation(&nav, url))
                .build()?;
            let events = handle.clone();
            let shown = window.clone();
            window.on_window_event(move |e| {
                if let WindowEvent::Resized(_) = e {
                    let maximized = shown.is_maximized().unwrap_or(false);
                    let _ = tauri::Emitter::emit(&events, "window:state", json!({ "maximized": maximized }));
                }
            });
            core.start_background();
            updater.schedule();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Nore Launcher")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(core) = handle.try_state::<Arc<App>>() {
                    core.shutdown();
                }
            }
        });
}
