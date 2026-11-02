//! After the move from the Electron launcher (Windows): the old launcher is offered for removal
//! once, a few seconds after the launcher window opened (see `nore_core::legacy`). The game
//! folder, worlds and settings stay; the desktop shortcut is pointed at this launcher again.

use nore_core::ipc::App;
use nore_core::legacy;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub fn offer(handle: AppHandle, core: Arc<App>) {
    if !cfg!(windows) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let Ok(Some(found)) = tokio::task::spawn_blocking(legacy::detect).await else { return };
        if !legacy::should_offer(&core.store.get(), true) {
            return;
        }
        let _ = core.store.update(|d| {
            d["legacyElectron"] = json!({ "offered": true, "at": nore_core::js::now_ms(), "imported": core.imported.is_some() });
        });
        let mut dialog = handle
            .dialog()
            .message(
                "Nowy Nore Launcher przejął Twoje konta, instancje i ustawienia.\n\n\
                 Stara wersja launchera jest nadal zainstalowana. Czy usunąć ją teraz? \
                 Folder gry, światy i zrzuty ekranu zostaną na miejscu.",
            )
            .title("Usunąć starą wersję launchera?")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom("Usuń starą wersję".into(), "Zostaw".into()));
        if let Some(w) = handle.get_webview_window("main") {
            dialog = dialog.parent(&w);
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        dialog.show(move |yes| {
            let _ = tx.send(yes);
        });
        if !rx.await.unwrap_or(false) {
            return;
        }
        let exe = std::env::current_exe().ok();
        let result = tokio::task::spawn_blocking(move || {
            let r = legacy::uninstall(&found, Duration::from_secs(90));
            // the old uninstaller deletes "Nore Launcher.lnk" on the desktop – it belongs to this launcher now
            if let Some(exe) = exe {
                legacy::ensure_desktop_shortcut(&exe);
            }
            r
        })
        .await
        .unwrap_or_else(|e| Err(nore_core::error::msg(e.to_string())));
        let ok = result.is_ok();
        let _ = core.store.update(|d| {
            d["legacyElectron"]["removed"] = json!(ok);
            d["legacyElectron"]["error"] = result.as_ref().err().map_or(serde_json::Value::Null, |e| json!(e.to_string()));
        });
        let text = match &result {
            Ok(()) => "Stara wersja launchera została usunięta. Twoje gry i ustawienia są na miejscu.".to_string(),
            Err(e) => format!("Nie udało się usunąć starej wersji: {e}"),
        };
        handle.dialog().message(text).title("Nore Launcher").kind(if ok { MessageDialogKind::Info } else { MessageDialogKind::Warning }).show(|_| {});
    });
}
