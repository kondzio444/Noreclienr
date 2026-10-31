//! nore-core – the backend of Nore Launcher, ported from the Electron main process
//! (launcher/src/main/*.js) to async Rust. It has no UI: the Tauri shell (src-tauri) and the
//! `nore-cli` tool drive it through [`ipc::App`], which answers the same channels as the Electron
//! IPC handlers, so the existing renderer runs unchanged on top of it.

pub mod auth;
pub mod chat;
pub mod config_edit;
pub mod curseforge;
pub mod doctor;
pub mod error;
pub mod friends;
pub mod gameopts;
pub mod hangar;
pub mod hub;
pub mod importers;
pub mod instances;
pub mod ipc;
pub mod java;
pub mod js;
pub mod jvm;
pub mod launch;
pub mod loaders;
pub mod mod_manager;
pub mod mod_meta;
pub mod modpacks;
pub mod modrinth;
pub mod nbt;
pub mod net;
pub mod notices;
pub mod official;
pub mod oscrypt;
pub mod paths;
pub mod perf;
pub mod secrets;
pub mod server_cf;
pub mod server_content;
pub mod server_net;
pub mod server_props;
pub mod server_tools;
pub mod server_tunnel;
pub mod store;
pub mod updater;
pub mod util;
pub mod versions;

#[cfg(test)]
pub(crate) mod testdata;
#[cfg(test)]
pub(crate) mod testutil;

pub use error::{Error, Result};

use futures::future::BoxFuture;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

/// Progress reports for the UI (`{ stage, current, done, total, … }` like the Electron launcher).
pub type ProgressFn = Arc<dyn Fn(Value) + Send + Sync>;

/// Gives a Java binary for a Mojang runtime component (used by the Forge / NeoForge installers).
pub type JavaProvider = Arc<dyn Fn(String) -> BoxFuture<'static, Result<PathBuf>> + Send + Sync>;

/// A progress callback that drops everything.
pub fn no_progress() -> ProgressFn {
    Arc::new(|_| {})
}

/// Folders + HTTP client: what every installer needs.
#[derive(Clone, Debug)]
pub struct Env {
    pub paths: paths::Paths,
    pub net: net::Net,
    manifest: Arc<tokio::sync::Mutex<Option<Value>>>,
}

impl Env {
    pub fn new(paths: paths::Paths, net: net::Net) -> Self {
        Self { paths, net, manifest: Arc::default() }
    }
}
