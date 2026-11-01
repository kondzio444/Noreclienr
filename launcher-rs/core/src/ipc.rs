//! The IPC surface of the Electron main process (launcher/src/main/main.js), channel by channel.
//!
//! [`App::invoke`] takes the channel name and the arguments exactly as the renderer passes them to
//! `window.nore.*` (see launcher/src/preload.js) and answers with the same JSON. Events go out
//! through [`Emitter`] with the Electron channel names (`progress`, `log`, `game:state`, …).
//! Channels that phase 1 does not cover answer with [`Error::Pending`] ("Funkcja w przygotowaniu w
//! wersji Rust"); [`CHANNELS`] lists every channel with its status (checked against preload.js and
//! PORTING.md by the tests).

use crate::auth::{self, Auth};
use crate::chat::{self, Chat};
use crate::error::{msg, Error, Result};
use crate::hub::{self, Hub, Player};
use crate::instances::{self, Instances, NoreMods};
use crate::js::{assign, now_ms, truthy, ValueExt};
use crate::launch::{self, GameHandle, LaunchSpec};
use crate::notices::Notices;
use crate::paths::Paths;
use crate::secrets::Secrets;
use crate::store::{self, Store};
use crate::updater::Updater;
use crate::versions::{self, InstallRequest, Installed};
use crate::{friends, gameopts, java, jvm, loaders, modrinth, official, Env, JavaProvider, ProgressFn};
use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tokio_util::sync::CancellationToken;

/// Status of a channel in the Rust launcher.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Implemented in Rust like in Electron.
    Ported,
    /// Answers a neutral value (empty list, `true`) until its feature is ported – the UI keeps working.
    Stub,
    /// Answers "Funkcja w przygotowaniu w wersji Rust".
    Pending,
}

/// Every channel of launcher/src/preload.js (+ `net:check` of main.js) and its status.
pub const CHANNELS: &[(&str, Status)] = {
    use Status::*;
    &[
        ("app:info", Ported),
        ("state:get", Ported),
        ("settings:set", Ported),
        ("onboarding:done", Ported),
        ("dialog:java", Ported),
        ("shell:open", Ported),
        ("shell:folder", Ported),
        ("window:minimize", Ported),
        ("window:maximize", Ported),
        ("window:close", Ported),
        ("auth:status", Ported),
        ("auth:logout", Ported),
        ("accounts:offline", Ported),
        ("accounts:msStart", Ported),
        ("accounts:msPoll", Ported),
        ("accounts:msCancel", Ported),
        ("accounts:select", Ported),
        ("accounts:remove", Ported),
        ("versions:list", Ported),
        ("versions:fabricLoaders", Ported),
        ("versions:installed", Ported),
        ("versions:delete", Ported),
        ("storage:info", Ported),
        ("instances:create", Ported),
        ("instances:update", Ported),
        ("instances:remove", Ported),
        ("instances:select", Ported),
        ("instances:folder", Ported),
        ("instances:worlds", Ported),
        ("instances:worldsInfo", Ported),
        ("instances:screenshots", Ported),
        ("instances:deleteWorld", Ported),
        ("instances:backupWorld", Ported),
        ("instances:deleteScreenshot", Ported),
        ("instances:size", Ported),
        ("instances:media", Ported),
        ("instances:setMedia", Ported),
        ("instances:stats", Ported),
        ("instances:duplicate", Ported),
        ("instances:optionsProfile", Ported),
        ("instances:memoryInfo", Ported),
        ("official:info", Ported),
        ("official:status", Ported),
        ("official:pick", Ported),
        ("game:launch", Ported),
        ("game:prepare", Ported),
        ("game:kill", Ported),
        ("servers:list", Stub),
        ("servers:create", Pending),
        ("servers:update", Pending),
        ("servers:remove", Pending),
        ("servers:start", Pending),
        ("servers:stop", Pending),
        ("servers:command", Pending),
        ("servers:logs", Pending),
        ("servers:folder", Pending),
        ("servers:restart", Pending),
        ("servers:stats", Pending),
        ("servers:properties", Pending),
        ("servers:players", Pending),
        ("servers:playerList", Pending),
        ("servers:backup", Pending),
        ("servers:backups", Pending),
        ("servers:restoreBackup", Pending),
        ("servers:deleteBackup", Pending),
        ("servers:resetWorld", Pending),
        ("servers:reinstall", Pending),
        ("servers:setIcon", Pending),
        ("servers:icon", Pending),
        ("servers:contentKinds", Pending),
        ("servers:contentSearch", Pending),
        ("servers:contentInstall", Pending),
        ("servers:contentList", Pending),
        ("servers:contentToggle", Pending),
        ("servers:contentRemove", Pending),
        ("servers:contentAddFiles", Pending),
        ("servers:contentUpdates", Pending),
        ("servers:contentApplyUpdates", Pending),
        ("servers:contentAddPaths", Pending),
        ("servers:modpackVersions", Pending),
        ("servers:modpackUpdate", Pending),
        ("servers:modpackApply", Pending),
        ("servers:loaderVersions", Pending),
        ("servers:diagnose", Pending),
        ("servers:firewall", Pending),
        ("servers:dnsCheck", Pending),
        ("servers:tunnelLink", Pending),
        ("servers:tunnelUnlink", Pending),
        ("servers:tunnel", Pending),
        ("servers:netInfo", Pending),
        ("servers:checkReachable", Pending),
        ("servers:upnp", Pending),
        ("servers:applyDomain", Pending),
        ("servers:noreDomain", Pending),
        ("servers:dnsRecords", Pending),
        ("servers:contentSources", Pending),
        ("servers:blocked", Pending),
        ("servers:resolveBlocked", Pending),
        ("servers:propertiesForm", Pending),
        ("servers:saveProperties", Pending),
        ("servers:complete", Pending),
        ("servers:jvmPreview", Pending),
        ("servers:motdPreview", Pending),
        ("mods:list", Pending),
        ("mods:identify", Pending),
        ("mods:toggle", Pending),
        ("mods:bulk", Pending),
        ("mods:pin", Pending),
        ("mods:saveProfile", Pending),
        ("mods:applyProfile", Pending),
        ("mods:deleteProfile", Pending),
        ("mods:modlist", Pending),
        ("mods:saveModlist", Pending),
        ("mods:exportPack", Pending),
        ("mods:changelog", Pending),
        ("mods:configs", Pending),
        ("mods:readConfig", Pending),
        ("mods:saveConfig", Pending),
        ("content:search", Pending),
        ("content:project", Pending),
        ("content:details", Pending),
        ("content:identify", Pending),
        ("content:categories", Pending),
        ("content:install", Pending),
        ("content:installed", Pending),
        ("content:toggle", Pending),
        ("content:updates", Pending),
        ("content:applyUpdates", Pending),
        ("content:delete", Pending),
        ("content:updatesState", Stub),
        ("content:checkAll", Pending),
        ("chat:identity", Ported),
        ("chat:contacts", Ported),
        ("chat:add", Ported),
        ("chat:remove", Ported),
        ("chat:sign", Ported),
        ("chat:verify", Ported),
        ("chat:seen", Ported),
        ("chat:requests", Ported),
        ("chat:addRequest", Ported),
        ("chat:decline", Ported),
        ("chat:history", Ported),
        ("chat:put", Ported),
        ("chat:read", Ported),
        ("chat:clear", Ported),
        ("chat:attention", Ported),
        ("chat:presence", Stub),
        ("curseforge:status", Pending),
        ("curseforge:setKey", Pending),
        ("modpacks:install", Pending),
        ("modpacks:import", Pending),
        ("modpacks:checkUpdate", Pending),
        ("modpacks:update", Pending),
        ("modpacks:versions", Pending),
        ("modpacks:importInstance", Pending),
        ("modpacks:blocked", Pending),
        ("modpacks:resolveBlocked", Pending),
        ("perf:preview", Pending),
        ("perf:apply", Pending),
        ("perf:remove", Pending),
        ("perf:decline", Pending),
        ("loaders:versions", Ported),
        ("bg:custom", Ported),
        ("bg:pick", Ported),
        ("doctor:check", Pending),
        ("doctor:fix", Pending),
        ("friends:list", Ported),
        ("friends:add", Ported),
        ("friends:remove", Ported),
        ("gallery:list", Pending),
        ("gallery:full", Pending),
        ("gallery:copy", Pending),
        ("gallery:reveal", Pending),
        ("gallery:open", Pending),
        ("gallery:delete", Pending),
        ("notices:get", Ported),
        ("update:state", Ported),
        ("update:check", Ported),
        ("update:download", Ported),
        ("update:install", Ported),
        ("net:check", Ported),
    ]
};

pub fn status_of(channel: &str) -> Option<Status> {
    CHANNELS.iter().find(|(c, _)| *c == channel).map(|(_, s)| *s)
}

/// Events to the renderer (`window.nore.on(channel, fn)`).
pub trait Emitter: Send + Sync {
    fn emit(&self, channel: &str, payload: Value);
}

/// What the shell around the backend can do (window, dialogs, the system's browser / file manager).
#[async_trait]
pub trait Shell: Send + Sync {
    fn open_url(&self, url: &str) -> Result<()>;
    fn open_path(&self, path: &Path) -> Result<()>;
    /// A file picker (directory = false) – None when cancelled.
    async fn pick_file(&self, title: &str, filter_name: &str, extensions: &[&str]) -> Option<PathBuf>;
    /// minimize | maximize | close | hide | show | focus | flash
    fn window(&self, action: &str);
    fn is_focused(&self) -> bool {
        true
    }
    fn quit(&self);
}

/// A shell without a window (tests, `nore-cli`).
pub struct HeadlessShell;

#[async_trait]
impl Shell for HeadlessShell {
    fn open_url(&self, url: &str) -> Result<()> {
        println!("[otwórz] {url}");
        Ok(())
    }
    fn open_path(&self, path: &Path) -> Result<()> {
        println!("[folder] {}", path.display());
        Ok(())
    }
    async fn pick_file(&self, _: &str, _: &str, _: &[&str]) -> Option<PathBuf> {
        None
    }
    fn window(&self, _: &str) {}
    fn quit(&self) {}
}

/// Microsoft application id: environment / build (`NORE_MS_CLIENT_ID`), never stored in git.
fn built_in_ms_client_id() -> Option<String> {
    std::env::var("NORE_MS_CLIENT_ID").ok().filter(|s| !s.is_empty()).or_else(|| option_env!("NORE_MS_CLIENT_ID").map(String::from).filter(|s| !s.is_empty()))
}

static GUID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap());
static VISIBLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Backend library|Setting user|LWJGL").unwrap());
static LOADER_STAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(Instalowanie|Pobieranie) (Fabric|Quilt|Forge|NeoForge)").unwrap());

/// The "Nore Pack": performance + QoL mods for modded instances (any Fabric version).
pub const NORE_PACK: [&str; 9] = ["fabric-api", "sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "modmenu", "zoomify", "appleskin"];
const IMAGE_TYPES: [(&str, &str); 5] = [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")];

fn image_type(p: &Path) -> &'static str {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    IMAGE_TYPES.iter().find(|(e, _)| *e == ext).map_or("image/png", |(_, t)| t)
}

struct Game {
    handle: GameHandle,
    instance_id: String,
    visible: bool,
    killed: bool,
}

/// How the app is set up by its shell.
pub struct Config {
    pub paths: Paths,
    pub version: String,
    pub emitter: Arc<dyn Emitter>,
    pub shell: Arc<dyn Shell>,
    pub updater: Arc<dyn Updater>,
    /// where bundled resources live (Nore Client jars under `nore/mods`)
    pub resource_dir: Option<PathBuf>,
    /// keep secrets in memory only (tests)
    pub ephemeral_secrets: bool,
}

/// The backend: state shared by every channel.
pub struct App {
    pub env: Env,
    pub store: Store,
    pub secrets: Secrets,
    pub mods: NoreMods,
    pub version: String,
    emitter: Arc<dyn Emitter>,
    shell: Arc<dyn Shell>,
    updater: Arc<dyn Updater>,
    auth: Auth,
    chat: Chat,
    hub: Hub,
    notices: Notices,
    official: official::Status,
    busy: AtomicBool,
    game: Mutex<Option<Game>>,
    hub_player: Mutex<Option<Player>>,
    ms_logins: Mutex<HashMap<String, CancellationToken>>,
    refreshing: tokio::sync::Mutex<()>,
    /// what the first start imported from the Electron launcher
    pub imported: Option<store::ImportReport>,
}

/// Clears the busy flag and the progress bar however the operation ends.
struct BusyGuard<'a>(&'a App, &'static str);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::SeqCst);
        self.0.emit(self.1, Value::Null);
    }
}

fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}

fn arg_str(args: &[Value], i: usize) -> String {
    match args.get(i) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Only the last path component (the renderer passes names of worlds and screenshots).
fn base_name(s: &str) -> Result<String> {
    Path::new(s).file_name().map(|n| n.to_string_lossy().to_string()).filter(|n| n != ".." && n != ".").ok_or_else(|| msg("Niedozwolona ścieżka."))
}

fn public_account(a: &Value) -> Value {
    json!({ "id": a.get("id"), "type": a.get("type"), "name": a.get("name"), "uuid": a.get("uuid"), "skin": a.get("skin").cloned().unwrap_or(Value::Null) })
}

/// Natural order like `localeCompare(…, { numeric: true })` for version folder names.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    static PART: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+|\D+").unwrap());
    let pa: Vec<&str> = PART.find_iter(a).map(|m| m.as_str()).collect();
    let pb: Vec<&str> = PART.find_iter(b).map(|m| m.as_str()).collect();
    for (x, y) in pa.iter().zip(pb.iter()) {
        let o = match (x.parse::<u128>(), y.parse::<u128>()) {
            (Ok(m), Ok(n)) => m.cmp(&n),
            _ => x.to_lowercase().cmp(&y.to_lowercase()),
        };
        if o != std::cmp::Ordering::Equal {
            return o;
        }
    }
    pa.len().cmp(&pb.len())
}

impl App {
    /// Opens the data folder: imports the Electron launcher's data on the first start, creates the
    /// default Nore Client instance and makes sure Nore Client instances list Nore MC.
    pub fn new(cfg: Config) -> Result<Arc<Self>> {
        std::fs::create_dir_all(cfg.paths.root())?;
        let secrets = if cfg.ephemeral_secrets { Secrets::in_memory() } else { Secrets::open(&cfg.paths.key_file())? };
        let imported = store::import_electron(&cfg.paths, &secrets).unwrap_or_else(|e| {
            log::warn!("Import z launchera Electron nie powiódł się: {e}");
            None
        });
        let store = Store::open(cfg.paths.config_file());
        let net = crate::net::Net::new()?;
        let mods = NoreMods::load(&NoreMods::default_dirs(cfg.resource_dir.as_deref()));
        let app = Arc::new(Self {
            auth: Auth::new(net.clone()),
            hub: Hub::new(net.client().clone(), &cfg.version),
            env: Env::new(cfg.paths, net),
            store,
            secrets,
            mods,
            version: cfg.version,
            emitter: cfg.emitter,
            shell: cfg.shell,
            updater: cfg.updater,
            chat: Chat::default(),
            notices: Notices::default(),
            official: official::Status::default(),
            busy: AtomicBool::new(false),
            game: Mutex::new(None),
            hub_player: Mutex::new(None),
            ms_logins: Mutex::new(HashMap::new()),
            refreshing: tokio::sync::Mutex::new(()),
            imported,
        });
        app.instances().ensure_default()?;
        Ok(app)
    }

    /// Background work after the window is up: Nore MC in servers.dat, announcements polling.
    pub fn start_background(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            for i in me.instances().list().into_iter().filter(|i| i.truthy_of("noreClient")) {
                let _ = official::ensure_servers_dat(Path::new(&i.string_or("gameDir", ""))).await;
            }
        });
        let emitter = self.emitter.clone();
        let updater = self.updater.clone();
        self.notices.start(
            self.env.net.client().clone(),
            self.version.clone(),
            Arc::new(move |s| emitter.emit("notices:state", s)),
            Arc::new(move || {
                let u = updater.clone();
                tokio::spawn(async move {
                    let _ = u.check().await;
                });
            }),
        );
    }

    pub fn instances(&self) -> Instances<'_> {
        Instances { store: &self.store, paths: &self.env.paths, mods: &self.mods }
    }

    fn emit(&self, channel: &str, payload: Value) {
        self.emitter.emit(channel, payload);
    }

    fn log(&self, line: impl Into<String>, stream: &str) {
        self.emit("log", json!({ "line": line.into(), "stream": stream }));
    }

    fn progress_fn(&self, channel: &'static str) -> ProgressFn {
        let e = self.emitter.clone();
        Arc::new(move |p| e.emit(channel, p))
    }

    /// "1.4.5 · Build 1432" for CI builds (patch ≥ 1000), else the plain version.
    pub fn display_version(&self) -> String {
        let patch: u64 = self.version.split('.').nth(2).and_then(|p| p.parse().ok()).unwrap_or(0);
        if patch >= 1000 {
            let release = self.version.split('.').take(2).collect::<Vec<_>>().join(".");
            format!("{release} · Build {patch}")
        } else {
            self.version.clone()
        }
    }

    fn running_id(&self) -> Option<String> {
        self.game.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|g| g.instance_id.clone())
    }

    fn game_dirs(&self) -> Vec<PathBuf> {
        self.instances().list().iter().map(|i| PathBuf::from(i.string_or("gameDir", ""))).collect()
    }

    /// Answers one channel of `window.nore.*`.
    pub async fn invoke(self: &Arc<Self>, channel: &str, args: Vec<Value>) -> Result<Value> {
        let a = &args;
        let inst = || self.instances();
        Ok(match channel {
            // ------------------------------------------------------------ app & window
            "app:info" => {
                let (total, _) = jvm::system_memory_mb();
                let platform = if cfg!(windows) {
                    "win32"
                } else if cfg!(target_os = "macos") {
                    "darwin"
                } else {
                    "linux"
                };
                json!({ "version": self.display_version(), "rawVersion": self.version, "platform": platform, "root": self.env.paths.root().to_string_lossy(), "totalMemMb": total, "shell": "rust" })
            }
            "state:get" => self.state(),
            "settings:set" => self.set_settings(&arg(a, 0))?,
            "onboarding:done" => {
                self.store.update(|d| d["firstRun"] = json!(false))?;
                json!(true)
            }
            "dialog:java" => match self.shell.pick_file("Wybierz plik Javy", "Java", &[]).await {
                None => Value::Null,
                Some(p) => json!({ "path": p.to_string_lossy(), "major": java::probe_java(&p).await }),
            },
            "shell:open" => {
                let url = arg_str(a, 0);
                if url.starts_with("https://") {
                    self.shell.open_url(&url)?;
                    json!(true)
                } else {
                    json!(false)
                }
            }
            "shell:folder" => {
                self.shell.open_path(Path::new(&arg_str(a, 0)))?;
                json!("")
            }
            "window:minimize" | "window:maximize" | "window:close" => {
                self.shell.window(&channel[7..]);
                Value::Null
            }

            // ------------------------------------------------------------ accounts
            "auth:status" => self.auth_status().await,
            "auth:logout" => {
                self.store.update(|d| {
                    d["accounts"] = json!([]);
                    d["selectedAccount"] = Value::Null;
                })?;
                json!(true)
            }
            "accounts:offline" => {
                let acc = auth::create_offline(&arg_str(a, 0))?;
                let id = acc["id"].clone();
                self.store.update(|d| {
                    let list = d["accounts"].as_array_mut().map(std::mem::take).unwrap_or_default();
                    let mut list: Vec<Value> = list.into_iter().filter(|x| x.get("id") != Some(&id)).collect();
                    list.push(json!({ "id": id, "type": "offline", "name": acc["name"], "uuid": acc["uuid"] }));
                    d["accounts"] = Value::Array(list);
                    d["selectedAccount"] = id.clone();
                })?;
                public_account(&acc)
            }
            "accounts:msStart" => {
                let cid = self.ms_client_id().await;
                let device = self.auth.start_device_code(cid.as_deref()).await?;
                let code = device.string_or("device_code", "");
                self.ms_logins.lock().unwrap_or_else(|e| e.into_inner()).insert(code.clone(), CancellationToken::new());
                json!({ "deviceCode": code, "userCode": device["user_code"], "uri": device["verification_uri"], "expiresIn": device["expires_in"], "interval": device["interval"] })
            }
            "accounts:msPoll" => self.ms_poll(&arg_str(a, 0), arg(a, 2).as_u64().unwrap_or(900), arg(a, 3).as_u64().unwrap_or(5)).await?,
            "accounts:msCancel" => {
                if let Some(t) = self.ms_logins.lock().unwrap_or_else(|e| e.into_inner()).get(&arg_str(a, 0)) {
                    t.cancel();
                }
                Value::Null
            }
            "accounts:select" => {
                let id = arg_str(a, 0);
                if !self.store.read(|d| d["accounts"].as_array().is_some_and(|l| l.iter().any(|x| x.str_of("id") == Some(&id)))) {
                    return Err(msg("Nie ma takiego konta"));
                }
                self.store.update(|d| d["selectedAccount"] = json!(id))?;
                json!(true)
            }
            "accounts:remove" => {
                let id = arg_str(a, 0);
                self.store.update(|d| {
                    if let Some(l) = d["accounts"].as_array_mut() {
                        l.retain(|x| x.str_of("id") != Some(&id));
                    }
                    if d.str_of("selectedAccount") == Some(&id) {
                        d["selectedAccount"] = d["accounts"].get(0).and_then(|x| x.get("id")).cloned().unwrap_or(Value::Null);
                    }
                })?;
                json!(true)
            }

            // ------------------------------------------------------------ versions
            "versions:list" => {
                let snapshots = arg(a, 0).truthy_of("snapshots");
                let m = self.env.manifest(false).await?;
                let fabric: std::collections::HashSet<String> = self.env.fabric_game_versions().await.unwrap_or_default().into_iter().collect();
                let list: Vec<Value> = m["versions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|v| v.str_of("type") == Some("release") || (snapshots && v.str_of("type") == Some("snapshot")))
                    .map(|v| json!({ "id": v["id"], "type": v["type"], "releaseTime": v["releaseTime"], "fabric": fabric.contains(v.str_of("id").unwrap_or_default()) }))
                    .collect();
                json!({ "latest": m["latest"], "versions": list })
            }
            "versions:fabricLoaders" => json!(loaders::versions(&self.env, "fabric", &arg_str(a, 0)).await?),
            "loaders:versions" => json!(loaders::versions(&self.env, &arg_str(a, 0), &arg_str(a, 1)).await?),
            "versions:installed" => self.installed_versions().await,
            "versions:delete" => {
                let dir = self.env.paths.versions().join(base_name(&arg_str(a, 0))?);
                let _ = tokio::fs::remove_dir_all(dir).await;
                json!(true)
            }
            "storage:info" => {
                let p = &self.env.paths;
                json!({
                    "libraries": instances::dir_size(&p.libraries()).await,
                    "assets": instances::dir_size(&p.assets()).await,
                    "runtime": instances::dir_size(&p.runtime()).await,
                    "versions": instances::dir_size(&p.versions()).await,
                    "instances": instances::dir_size(&p.instances()).await,
                })
            }

            // ------------------------------------------------------------ instances
            "instances:create" => {
                let i = inst().create(&arg(a, 0))?;
                if i.truthy_of("noreClient") {
                    let _ = official::ensure_servers_dat(Path::new(&i.string_or("gameDir", ""))).await;
                }
                i
            }
            "instances:update" => inst().update(&arg_str(a, 0), &arg(a, 1))?,
            "instances:remove" => {
                inst().remove(&arg_str(a, 0), truthy(&arg(a, 1))).await?;
                Value::Null
            }
            "instances:select" => {
                let id = arg(a, 0);
                self.store.update(|d| d["selectedInstance"] = id)?;
                json!(true)
            }
            "instances:folder" => {
                let Some(i) = inst().get(&arg_str(a, 0)) else { return Ok(Value::Null) };
                let sub = arg_str(a, 1);
                let mut dir = PathBuf::from(i.string_or("gameDir", ""));
                if !sub.is_empty() {
                    dir.push(base_name(&sub)?);
                }
                tokio::fs::create_dir_all(&dir).await?;
                self.shell.open_path(&dir)?;
                json!("")
            }
            "instances:worlds" => json!(inst().worlds(&arg_str(a, 0)).await),
            "instances:worldsInfo" => json!(inst().worlds_info(&arg_str(a, 0)).await),
            "instances:screenshots" => json!(inst().screenshots(&arg_str(a, 0), 24).await),
            "instances:deleteWorld" => {
                let i = inst().require(&arg_str(a, 0))?;
                let _ = tokio::fs::remove_dir_all(Path::new(&i.string_or("gameDir", "")).join("saves").join(base_name(&arg_str(a, 1))?)).await;
                json!(true)
            }
            "instances:backupWorld" => {
                let i = inst().require(&arg_str(a, 0))?;
                let world = base_name(&arg_str(a, 1))?;
                let game_dir = PathBuf::from(i.string_or("gameDir", ""));
                let out_dir = game_dir.join("backups");
                tokio::fs::create_dir_all(&out_dir).await?;
                let stamp = chrono::Utc::now().format("%Y-%m-%d-%H-%M-%S");
                let file = out_dir.join(format!("{world}-{stamp}.zip"));
                instances::zip_dir(&game_dir.join("saves").join(&world), &world, &file).await?;
                json!(file.to_string_lossy())
            }
            "instances:deleteScreenshot" => {
                let i = inst().require(&arg_str(a, 0))?;
                let _ = tokio::fs::remove_file(Path::new(&i.string_or("gameDir", "")).join("screenshots").join(base_name(&arg_str(a, 1))?)).await;
                json!(true)
            }
            "instances:size" => {
                let i = inst().require(&arg_str(a, 0))?;
                json!(instances::dir_size(Path::new(&i.string_or("gameDir", ""))).await)
            }
            "instances:media" => {
                let mut out = serde_json::Map::new();
                for i in inst().list() {
                    let dir = PathBuf::from(i.string_or("gameDir", ""));
                    let (icon, banner) = (media_data(&dir, "icon").await, media_data(&dir, "banner").await);
                    if icon.is_some() || banner.is_some() {
                        out.insert(i.string_or("id", ""), json!({ "icon": icon, "banner": banner }));
                    }
                }
                Value::Object(out)
            }
            "instances:setMedia" => self.set_media(&arg_str(a, 0), &arg_str(a, 1), truthy(&arg(a, 2))).await?,
            "instances:stats" => {
                let mut out = serde_json::Map::new();
                for i in inst().list() {
                    let d = PathBuf::from(i.string_or("gameDir", ""));
                    let id = i.string_or("id", "");
                    out.insert(
                        id.clone(),
                        json!({
                            "mods": count(&d.join("mods"), |f| f.ends_with(".jar")).await,
                            "resourcepacks": count(&d.join("resourcepacks"), |f| f.ends_with(".zip") || !f.contains('.')).await,
                            "shaders": count(&d.join("shaderpacks"), |f| f.ends_with(".zip")).await,
                            "worlds": inst().worlds(&id).await.len(),
                            "screenshots": count(&d.join("screenshots"), |f| f.ends_with(".png")).await,
                        }),
                    );
                }
                Value::Object(out)
            }
            "instances:duplicate" => {
                let i = inst().require(&arg_str(a, 0))?;
                let copy = inst().create(&json!({ "name": format!("{} (kopia)", i.string_or("name", "")), "mcVersion": i["mcVersion"], "loader": i["loader"], "modpack": i["modpack"], "perfPack": i["perfPack"], "color": i["color"] }))?;
                instances::copy_dir(Path::new(&i.string_or("gameDir", "")), Path::new(&copy.string_or("gameDir", ""))).await?;
                let mut patch = serde_json::Map::new();
                for k in ["packInstalled", "loaderVersion", "memoryMb", "jvmArgs", "noreClient", "perfMods", "pack", "iconUrl", "bannerUrl", "notes"] {
                    if let Some(v) = i.get(k) {
                        patch.insert(k.into(), v.clone());
                    }
                }
                inst().update(&copy.string_or("id", ""), &Value::Object(patch))?
            }
            "instances:optionsProfile" => {
                let id = arg_str(a, 0);
                let i = inst().require(&id)?;
                let profile = Some(arg_str(a, 1)).filter(|p| gameopts::profile(p).is_some());
                inst().update(&id, &json!({ "optionsProfile": profile, "optionsProfileApplied": null }))?;
                if let Some(p) = profile {
                    if self.running_id().as_deref() != Some(&id) {
                        gameopts::apply_to_instance(Path::new(&i.string_or("gameDir", "")), &i.string_or("mcVersion", ""), &p).await?;
                        inst().update(&id, &json!({ "optionsProfileApplied": p }))?;
                    }
                }
                inst().get(&id).unwrap_or(Value::Null)
            }
            "instances:memoryInfo" => {
                let i = inst().get(&arg_str(a, 0));
                let s = self.store.settings();
                let (total, _) = jvm::system_memory_mb();
                let (mods, shaders) = match &i {
                    Some(i) => jvm::count_mods(Path::new(&i.string_or("gameDir", ""))).await,
                    None => (0, false),
                };
                let loader = i.as_ref().map(|i| i.string_or("loader", "vanilla")).unwrap_or_else(|| "vanilla".into());
                let plan = jvm::memory_plan(&jvm::Opts {
                    instance_mb: i.as_ref().map_or(0.0, |i| i.num_of("memoryMb")).max(0.0) as u64,
                    settings_mb: s.num_of("memoryMb").max(0.0) as u64,
                    mods,
                    shaders,
                    loader: loader.clone(),
                    total_mb: total,
                    ..Default::default()
                });
                let mut out = json!(plan);
                assign(
                    &mut out,
                    &json!({ "autoMb": jvm::auto_memory_mb(mods, &loader, total, shaders), "mods": mods, "totalMb": total, "maxMb": jvm::max_game_mb(total) }),
                );
                out
            }

            // ------------------------------------------------------------ Nore MC
            "official:info" => official::info(),
            "official:status" => self.official.get(self.env.net.client(), truthy(&arg(a, 0))).await,
            "official:pick" => {
                let sel = self.store.read(|d| d.str_of("selectedInstance").map(String::from));
                official::pick_instance(&inst().list(), sel.as_deref())
            }

            // ------------------------------------------------------------ game
            "game:prepare" => {
                let id = arg_str(a, 0);
                self.take_busy()?;
                let _guard = BusyGuard(self, "progress");
                let i = inst().require(&id)?;
                let settings = self.store.settings();
                self.prepare_game(&i, &settings, self.progress_fn("progress")).await?;
                json!(true)
            }
            "game:launch" => self.launch(&arg_str(a, 0), &arg(a, 1)).await?,
            "game:kill" => {
                if let Some(g) = self.game.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                    g.killed = true;
                    g.handle.kill();
                }
                Value::Null
            }

            // ------------------------------------------------------------ chat & friends
            "chat:identity" => self.chat.public_identity(&self.store, &self.secrets)?,
            "chat:contacts" => chat::contacts(&self.store),
            "chat:add" => {
                let me = self.chat.identity(&self.store, &self.secrets)?;
                let name = arg_str(a, 1);
                chat::add_contact(&self.store, &me.hex, &arg_str(a, 0), Some(name.as_str()))?
            }
            "chat:remove" => chat::remove_contact(&self.store, &arg_str(a, 0))?,
            "chat:sign" => json!(self.chat.sign(&self.store, &self.secrets, &arg_str(a, 0))?),
            "chat:verify" => json!(chat::verify(&arg_str(a, 0), &arg_str(a, 1), &arg_str(a, 2), &arg_str(a, 3))),
            "chat:seen" => {
                let name = arg_str(a, 2);
                chat::seen(&self.store, &arg_str(a, 0), &arg_str(a, 1), Some(name.as_str()))?
            }
            "chat:requests" => chat::requests(&self.store),
            "chat:addRequest" => {
                let (name, text) = (arg_str(a, 2), arg_str(a, 3));
                chat::add_request(&self.store, &arg_str(a, 0), &arg_str(a, 1), Some(name.as_str()), Some(text.as_str()))?
            }
            "chat:decline" => chat::decline_request(&self.store, &arg_str(a, 0), truthy(&arg(a, 1)))?,
            "chat:history" => chat::history(&self.store, &arg_str(a, 0)),
            "chat:put" => chat::put_message(&self.store, &arg_str(a, 0), &arg(a, 1))?,
            "chat:read" => chat::mark_read(&self.store, &arg_str(a, 0))?,
            "chat:clear" => chat::clear_history(&self.store, &arg_str(a, 0))?,
            "chat:attention" => {
                if !self.shell.is_focused() {
                    self.shell.window("flash");
                }
                json!(true)
            }
            "chat:presence" => json!(true),
            "friends:list" => json!(friends::list(&self.store, &self.game_dirs()).await?),
            "friends:add" => friends::add(&self.store, &self.game_dirs(), &arg_str(a, 0)).await?,
            "friends:remove" => friends::remove(&self.store, &self.game_dirs(), &arg_str(a, 0)).await?,

            // ------------------------------------------------------------ notices, updates, look
            "notices:get" => self.notices.get(),
            "update:state" => self.updater.state(),
            "update:check" => self.updater.check().await?,
            "update:download" => self.updater.download().await?,
            "update:install" => {
                if self.running_id().is_some() {
                    return Err(msg("Zamknij grę przed instalacją aktualizacji."));
                }
                self.updater.install().await?
            }
            "bg:custom" => self.custom_background().await,
            "bg:pick" => self.pick_background().await?,
            "net:check" => json!(self.env.net.get_json::<Value>("https://api.modrinth.com/").await.is_ok()),

            // ------------------------------------------------------------ not ported yet
            "servers:list" => json!([]),
            "content:updatesState" => json!({}),
            other => {
                return Err(match status_of(other) {
                    Some(_) => Error::Pending(other.to_string()),
                    None => msg(format!("Nieznany kanał: {other}")),
                })
            }
        })
    }

    fn state(&self) -> Value {
        let running = self.running_id();
        let mut s = self.store.read(|d| {
            json!({
                "firstRun": d["firstRun"],
                "settings": d["settings"],
                "accounts": d["accounts"].as_array().map(|l| l.iter().map(public_account).collect::<Vec<_>>()).unwrap_or_default(),
                "selectedAccount": d["selectedAccount"],
                "selectedInstance": d["selectedInstance"],
            })
        });
        assign(&mut s, &json!({ "instances": self.instances().list(), "running": running, "noreVersions": self.mods.versions(), "servers": [] }));
        s
    }

    fn set_settings(&self, patch: &Value) -> Result<Value> {
        let mut patch = patch.clone();
        if !patch.is_object() {
            return Ok(self.store.settings());
        }
        if let Some(fx) = patch.get("eventFx").cloned() {
            patch["eventFx"] = store::clamp_event_fx(&fx);
        }
        self.store.update(|d| assign(&mut d["settings"], &patch))?;
        let settings = self.store.settings();
        if patch.get("autoUpdate").is_some() {
            self.updater.configure(&settings);
        }
        if patch.get("hubPresence").is_some() {
            self.refresh_hub();
        }
        Ok(settings)
    }

    fn take_busy(&self) -> Result<()> {
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err(msg("Trwa już przygotowywanie gry."));
        }
        Ok(())
    }

    // ---------------------------------------------------------------- accounts

    /// Azure application id: built in, set in the settings, or served by the Nore API (remembered).
    async fn ms_client_id(&self) -> Option<String> {
        if let Some(id) = built_in_ms_client_id() {
            return Some(id);
        }
        if let Some(id) = self.store.read(|d| d.pointer("/settings/msClientId").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from)) {
            return Some(id);
        }
        let fetched = async {
            let res = self.env.net.send_with_retry(|c| c.get("https://noreclient.pl/api/v1/launcher/config"), 2).await.ok()?;
            let j: Value = res.json().await.ok()?;
            j.str_of("microsoftClientId").filter(|id| GUID.is_match(id)).map(String::from)
        }
        .await;
        if let Some(id) = fetched {
            if self.store.read(|d| d.str_of("msClientIdRemote") != Some(&id)) {
                let _ = self.store.update(|d| d["msClientIdRemote"] = json!(id));
            }
            return Some(id);
        }
        self.store.read(|d| d.str_of("msClientIdRemote").map(String::from))
    }

    async fn ms_poll(&self, device_code: &str, expires_in: u64, interval: u64) -> Result<Value> {
        let cancel = self
            .ms_logins
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(device_code)
            .cloned()
            .ok_or_else(|| msg("Sesja logowania wygasła – zacznij od nowa"))?;
        let result = async {
            let cid = self.ms_client_id().await.ok_or_else(|| msg("Nie udało się pobrać identyfikatora aplikacji Microsoft – sprawdź połączenie z internetem i spróbuj ponownie."))?;
            let token = self.auth.poll_device_code(&cid, device_code, expires_in, interval, &cancel).await?;
            let mc = self.auth.minecraft_from_ms(token.str_of("access_token").unwrap_or_default()).await?;
            let acc = json!({ "id": format!("ms-{}", mc.string_or("uuid", "")), "type": "microsoft", "name": mc["name"], "uuid": mc["uuid"], "skin": mc["skin"], "verifiedAt": now_ms() });
            // the refresh token only works with the application id it was issued to – keep that id with it
            let secret = self.secrets.seal(&json!({ "accessToken": mc["accessToken"], "refreshToken": token["refresh_token"], "expiresAt": mc["expiresAt"], "cid": cid }));
            let id = acc["id"].clone();
            self.store.update(|d| {
                let list = d["accounts"].as_array_mut().map(std::mem::take).unwrap_or_default();
                let mut list: Vec<Value> = list.into_iter().filter(|x| x.get("id") != Some(&id)).collect();
                let mut saved = acc.clone();
                saved["secret"] = secret;
                list.push(saved);
                d["accounts"] = Value::Array(list);
                d["selectedAccount"] = id.clone();
            })?;
            Ok(public_account(&acc))
        }
        .await;
        self.ms_logins.lock().unwrap_or_else(|e| e.into_inner()).remove(device_code);
        result
    }

    fn selected_account(&self) -> Option<Value> {
        self.store.read(|d| {
            let sel = d.get("selectedAccount").cloned();
            d["accounts"].as_array().and_then(|l| l.iter().find(|a| sel.is_some() && a.get("id") == sel.as_ref()).cloned())
        })
    }

    /// A launch-ready account (refreshing Microsoft tokens when needed). One refresh at a time:
    /// the start-up check and "Graj" must not both spend the rotating refresh token.
    pub async fn ready_account(&self, force: bool) -> Result<Value> {
        let acc = self.selected_account().ok_or_else(|| msg("Wybierz albo dodaj konto, zanim uruchomisz grę."))?;
        if acc.str_of("type") != Some("microsoft") {
            let mut a = acc;
            a["accessToken"] = json!("0");
            return Ok(a);
        }
        let fresh_enough = |s: &Value| s.str_of("accessToken").is_some_and(|t| !t.is_empty()) && s.i64_of("expiresAt") - now_ms() >= 10 * 60 * 1000;
        let secret = self.secrets.unseal(acc.get("secret").unwrap_or(&Value::Null));
        if secret.get("refreshToken").is_none() && secret.get("accessToken").is_none() {
            return Err(Error::Auth("Sesja premium wygasła – zaloguj się ponownie.".into()));
        }
        if !force && fresh_enough(&secret) {
            let mut a = acc;
            a["accessToken"] = secret["accessToken"].clone();
            return Ok(a);
        }
        let started = now_ms();
        let _one = self.refreshing.lock().await;
        // another caller may have refreshed while this one waited
        let acc = self.selected_account().ok_or_else(|| msg("Wybierz albo dodaj konto, zanim uruchomisz grę."))?;
        let secret = self.secrets.unseal(acc.get("secret").unwrap_or(&Value::Null));
        let refreshed_meanwhile = acc.i64_of("verifiedAt") >= started;
        if fresh_enough(&secret) && (!force || refreshed_meanwhile) {
            let mut a = acc;
            a["accessToken"] = secret["accessToken"].clone();
            return Ok(a);
        }
        self.refresh_session(&acc, &secret).await
    }

    async fn refresh_session(&self, acc: &Value, secret: &Value) -> Result<Value> {
        self.emit("progress", json!({ "stage": "Odświeżanie sesji Microsoft" }));
        let id = acc["id"].clone();
        let save = |patch: Value, extra: Value| {
            self.store.update(|s| {
                if let Some(a) = s["accounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| x.get("id") == Some(&id))) {
                    let mut sec = self.secrets.unseal(a.get("secret").unwrap_or(&Value::Null));
                    assign(&mut sec, &patch);
                    a["secret"] = self.secrets.seal(&sec);
                    assign(a, &extra);
                }
            })
        };
        let cid = match secret.str_of("cid").filter(|c| !c.is_empty()) {
            Some(c) => Some(c.to_string()),
            None => self.ms_client_id().await,
        };
        let refresh = secret.string_or("refreshToken", "");
        // the Microsoft refresh token rotates: store the new one before anything else can fail
        let (ms_access, ms_refresh) = self.auth.refresh_ms_token(&refresh, cid.as_deref()).await?;
        save(json!({ "refreshToken": ms_refresh, "cid": cid }), json!({}))?;
        let mc = self.auth.minecraft_from_ms(&ms_access).await?;
        save(
            json!({ "accessToken": mc["accessToken"], "expiresAt": mc["expiresAt"] }),
            json!({ "name": mc["name"], "skin": mc["skin"], "verifiedAt": now_ms() }),
        )?;
        let mut out = acc.clone();
        assign(&mut out, &json!({ "accessToken": mc["accessToken"], "name": mc["name"], "skin": mc["skin"] }));
        out.as_object_mut().map(|o| o.remove("secret"));
        Ok(out)
    }

    /// Start-up check of the selected premium session; never blocks non-premium play.
    async fn auth_status(&self) -> Value {
        let Some(acc) = self.selected_account() else { return json!({ "loggedIn": false }) };
        if acc.str_of("type") != Some("microsoft") {
            return json!({ "loggedIn": true, "account": public_account(&acc) });
        }
        let check = async {
            let ready = self.ready_account(false).await?;
            if !self.auth.check_profile(ready.str_of("accessToken").unwrap_or_default()).await? {
                let fresh = self.ready_account(true).await?;
                if !self.auth.check_profile(fresh.str_of("accessToken").unwrap_or_default()).await? {
                    return Err(Error::Auth("Sesja premium wygasła – zaloguj się ponownie.".into()));
                }
            }
            let id = acc["id"].clone();
            self.store.update(|s| {
                if let Some(a) = s["accounts"].as_array_mut().and_then(|l| l.iter_mut().find(|x| x.get("id") == Some(&id))) {
                    a["verifiedAt"] = json!(now_ms());
                }
            })?;
            Ok::<(), Error>(())
        };
        match check.await {
            Ok(()) => json!({ "loggedIn": true, "account": public_account(&acc) }),
            Err(e) => {
                let text = e.to_string();
                let network = !e.is_auth()
                    && (e.is_network() || Regex::new(r"(?i)fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|Brak połączenia").unwrap().is_match(&text));
                json!({ "loggedIn": true, "offline": network, "expired": !network, "error": text, "account": public_account(&acc) })
            }
        }
    }

    // ---------------------------------------------------------------- versions & media

    async fn installed_versions(&self) -> Value {
        let mut out = Vec::new();
        let list = self.instances().list();
        if let Ok(mut rd) = tokio::fs::read_dir(self.env.paths.versions()).await {
            while let Ok(Some(e)) = rd.next_entry().await {
                if !e.file_type().await.is_ok_and(|t| t.is_dir()) {
                    continue;
                }
                let name = e.file_name().to_string_lossy().to_string();
                let used: Vec<String> = list
                    .iter()
                    .filter(|i| {
                        let mc = i.string_or("mcVersion", "");
                        !mc.is_empty() && (name == mc || name.ends_with(&format!("-{mc}")))
                    })
                    .map(|i| i.string_or("name", ""))
                    .collect();
                out.push(json!({ "id": name, "size": instances::dir_size(&e.path()).await, "fabric": name.starts_with("fabric-loader-"), "usedBy": used }));
            }
        }
        out.sort_by(|a, b| natural_cmp(a.str_of("id").unwrap_or_default(), b.str_of("id").unwrap_or_default()));
        json!(out)
    }

    async fn set_media(&self, id: &str, kind: &str, clear: bool) -> Result<Value> {
        let Some(i) = self.instances().get(id) else { return Ok(Value::Null) };
        if kind != "icon" && kind != "banner" {
            return Ok(Value::Null);
        }
        let dir = PathBuf::from(i.string_or("gameDir", "")).join(".nore");
        let old = media_file(&dir, kind).await;
        if clear {
            if let Some(o) = old {
                let _ = tokio::fs::remove_file(o).await;
            }
            return Ok(Value::Null);
        }
        let title = if kind == "icon" { "Ikona instancji" } else { "Tło instancji" };
        let Some(src) = self.shell.pick_file(title, "Obrazy", &["png", "jpg", "jpeg", "gif", "webp"]).await else {
            // cancelled: undefined in Electron
            return Ok(Value::Null);
        };
        if tokio::fs::metadata(&src).await?.len() > 15 * 1024 * 1024 {
            return Err(msg("Obrazek jest za duży (maks. 15 MB)."));
        }
        if let Some(o) = old {
            let _ = tokio::fs::remove_file(o).await;
        }
        tokio::fs::create_dir_all(&dir).await?;
        let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
        tokio::fs::copy(&src, dir.join(format!("{kind}.{ext}"))).await?;
        Ok(json!(media_data(&PathBuf::from(i.string_or("gameDir", "")), kind).await))
    }

    async fn custom_background(&self) -> Value {
        let name = self.store.read(|d| d.pointer("/settings/bgCustom").and_then(Value::as_str).map(String::from)).unwrap_or_default();
        if name.is_empty() || base_name(&name).ok().as_deref() != Some(name.as_str()) {
            return Value::Null;
        }
        let file = self.env.paths.root().join(&name);
        match tokio::fs::read(&file).await {
            Ok(b) => json!(format!("data:{};base64,{}", image_type(&file), B64.encode(b))),
            Err(_) => Value::Null,
        }
    }

    async fn pick_background(&self) -> Result<Value> {
        let Some(src) = self.shell.pick_file("Wybierz tło", "Obrazy", &["png", "jpg", "jpeg", "gif", "webp"]).await else { return Ok(Value::Null) };
        if tokio::fs::metadata(&src).await?.len() > 25 * 1024 * 1024 {
            return Err(msg("Obrazek jest za duży (maks. 25 MB)."));
        }
        let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
        for (e, _) in IMAGE_TYPES {
            let _ = tokio::fs::remove_file(self.env.paths.root().join(format!("custom-background.{e}"))).await;
        }
        let name = format!("custom-background.{ext}");
        tokio::fs::copy(&src, self.env.paths.root().join(&name)).await?;
        self.store.update(|d| {
            d["settings"]["bgCustom"] = json!(name);
            d["settings"]["bgScene"] = json!("custom");
        })?;
        Ok(self.custom_background().await)
    }

    // ---------------------------------------------------------------- game

    /// Downloads everything an instance needs (game, loader, Java, Nore Client) without launching.
    pub async fn prepare_game(&self, inst: &Value, settings: &Value, progress: ProgressFn) -> Result<(Installed, PathBuf, u32)> {
        let id = inst.string_or("id", "");
        let mc = inst.string_or("mcVersion", "");
        let loader = inst.string_or("loader", "vanilla");
        progress(json!({ "stage": format!("Minecraft {mc}"), "step": "game" }));
        let java_path = settings.string_or("javaPath", "");
        let env = self.env.clone();
        let jp = progress.clone();
        let java_for: JavaProvider = Arc::new(move |component: String| {
            let (env, jp, java_path) = (env.clone(), jp.clone(), java_path.clone());
            Box::pin(async move {
                if !java_path.is_empty() {
                    return Ok(PathBuf::from(java_path));
                }
                let p: ProgressFn = Arc::new(move |mut v| {
                    v["step"] = json!("java");
                    jp(v)
                });
                java::ensure_runtime(&env, &component, &p).await
            })
        });
        let p2 = progress.clone();
        let install_progress: ProgressFn = Arc::new(move |mut v: Value| {
            let loader_step = v.str_of("stage").is_some_and(|s| LOADER_STAGE.is_match(s));
            v["step"] = json!(if loader_step { "loader" } else { "game" });
            p2(v)
        });
        let lv = inst.str_of("loaderVersion").filter(|v| !v.is_empty()).map(String::from);
        let concurrency = settings.num_of("concurrency").clamp(1.0, 64.0) as usize;
        let installed = versions::install_version(
            &self.env,
            InstallRequest { mc_version: &mc, loader: &loader, loader_version: lv.as_deref() },
            concurrency,
            install_progress,
            Some(java_for),
        )
        .await?;
        if loader != "vanilla" && lv.is_none() {
            if let Some(v) = &installed.loader_version {
                self.instances().update(&id, &json!({ "loaderVersion": v }))?;
            }
        }
        let game_dir = PathBuf::from(inst.string_or("gameDir", ""));
        let mods_dir = game_dir.join("mods");
        if inst.truthy_of("noreClient") {
            progress(json!({ "stage": "Instalowanie Nore Client", "step": "nore" }));
            self.prepare_nore(&mc, &mods_dir, &progress).await?;
        }
        if inst.truthy_of("perfPack") && loader == "fabric" && !inst.truthy_of("packInstalled") {
            let pack: Vec<&str> = NORE_PACK.iter().copied().filter(|s| !(inst.truthy_of("noreClient") && *s == "zoomify")).collect();
            for (i, slug) in pack.iter().enumerate() {
                progress(json!({ "stage": "Pakiet Nore", "current": slug, "done": i, "total": pack.len(), "step": "nore" }));
                if let Err(e) = modrinth::install_mod(&self.env, slug, &mc, "fabric", &mods_dir, &mut Default::default()).await {
                    self.log(format!("[Launcher] Pakiet Nore: {slug} niedostępny dla {mc} ({e})"), "out");
                }
            }
            self.instances().update(&id, &json!({ "packInstalled": true }))?;
        }
        // the Java this Minecraft version needs: the player's own one when it fits, otherwise Mojang's
        let need = jvm::required_java(&mc, Some(&installed.version));
        let component = installed.version.pointer("/javaVersion/component").and_then(Value::as_str).map(String::from);
        progress(json!({ "stage": format!("Java {need}"), "step": "java" }));
        let jp = progress.clone();
        let java_progress: ProgressFn = Arc::new(move |mut v| {
            v["step"] = json!("java");
            jp(v)
        });
        let picked = java::pick(&self.env, &settings.string_or("javaPath", ""), need, component.as_deref(), &loader, &java_progress).await?;
        if let Some(n) = picked.note {
            self.log(format!("[Launcher] {n}"), "out");
        }
        Ok((installed, picked.bin, picked.major))
    }

    async fn prepare_nore(&self, mc: &str, mods_dir: &Path, progress: &ProgressFn) -> Result<()> {
        tokio::fs::create_dir_all(mods_dir).await?;
        match self.mods.jar_for(mc) {
            Some(jar) => {
                tokio::fs::copy(jar, mods_dir.join("noreclient.jar")).await?;
            }
            None => self.log(format!("[Launcher] Brak Nore Client dla Minecraft {mc} – pomijam."), "err"),
        }
        let mut has_api = false;
        if let Ok(mut rd) = tokio::fs::read_dir(mods_dir).await {
            while let Ok(Some(e)) = rd.next_entry().await {
                let n = e.file_name().to_string_lossy().to_string();
                has_api |= n.starts_with("fabric-api-") && n.ends_with(".jar");
            }
        }
        if !has_api {
            progress(json!({ "stage": "Pobieranie Fabric API" }));
            if let Err(e) = modrinth::install_mod(&self.env, modrinth::FABRIC_API_ID, mc, "fabric", mods_dir, &mut Default::default()).await {
                // Nore Client does not need Fabric API; a brand-new Minecraft version may not have it yet
                self.log(format!("[Launcher] Fabric API niedostępne dla {mc} ({e}) – gram bez niego."), "out");
            }
        }
        Ok(())
    }

    async fn launch(self: &Arc<Self>, instance_id: &str, opts: &Value) -> Result<Value> {
        self.take_busy()?;
        let _guard = BusyGuard(self, "progress");
        if self.running_id().is_some() {
            return Err(msg("Gra jest już uruchomiona."));
        }
        let progress = self.progress_fn("progress");
        let mut inst = self.instances().require(instance_id)?;
        if let Some(j) = opts.str_of("joinServer").filter(|j| !j.is_empty()) {
            inst["joinServer"] = json!(j);
        }
        let join = inst["joinServer"].clone();
        let game_dir = PathBuf::from(inst.string_or("gameDir", ""));
        if inst.truthy_of("noreClient") {
            let _ = official::ensure_servers_dat(&game_dir).await;
        }
        let account = self.ready_account(false).await?;
        let base = self.store.settings();
        let mut settings = base.clone();
        let jvm_args: Vec<String> = [base.string_or("jvmArgs", ""), inst.string_or("jvmArgs", "")].into_iter().filter(|s| !s.is_empty()).collect();
        settings["jvmArgs"] = json!(jvm_args.join(" "));

        let (installed, java_bin, java_major) = self.prepare_game(&inst, &settings, progress.clone()).await?;
        inst = self.instances().require(instance_id)?;
        inst["joinServer"] = join;

        // graphics profile chosen in the instance settings (options.txt), written once
        if let Some(p) = inst.str_of("optionsProfile").filter(|p| !p.is_empty()).map(String::from) {
            if inst.str_of("optionsProfileApplied") != Some(&p) {
                let _ = gameopts::apply_to_instance(&game_dir, &inst.string_or("mcVersion", ""), &p).await;
                self.instances().update(instance_id, &json!({ "optionsProfileApplied": p }))?;
            }
        }
        friends::sync(&self.store, &self.game_dirs()).await;

        progress(json!({ "stage": "Uruchamianie gry" }));
        tokio::fs::create_dir_all(&game_dir).await?;
        let natives_dir = self.env.paths.version_dir(&installed.launch_id).join("natives");
        versions::extract_natives(&installed.libs.natives, &natives_dir).await?;
        let mods = jvm::count_mods(&game_dir).await;
        let cmd = launch::build_command(&LaunchSpec {
            instance: &inst,
            account: &account,
            settings: &settings,
            installed: &installed,
            java_bin,
            java_major,
            assets_dir: self.env.paths.assets(),
            libraries_dir: self.env.paths.libraries(),
            natives_dir,
            launcher_version: &self.version,
            mods,
            ram_mb: jvm::system_memory_mb(),
        });
        self.log(launch::summary_line(&cmd.tuned, java_major), "out");
        if let Some(n) = &cmd.tuned.note {
            self.log(format!("[Launcher] {n}"), "out");
        }

        let started = now_ms();
        let id = instance_id.to_string();
        let after = settings.string_or("afterLaunch", "hide");
        let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
        let me = Arc::downgrade(self);
        let log_tail = tail.clone();
        let log_id = id.clone();
        let on_log: launch::LogFn = Arc::new(move |line: String, stream: &'static str| {
            let Some(app) = me.upgrade() else { return };
            let visible_now = VISIBLE.is_match(&line);
            app.emit("log", json!({ "line": line, "stream": stream }));
            {
                let mut t = log_tail.lock().unwrap_or_else(|e| e.into_inner());
                t.push_back(line);
                if t.len() > 4000 {
                    t.drain(..1000);
                }
            }
            if visible_now {
                let first = {
                    let mut g = app.game.lock().unwrap_or_else(|e| e.into_inner());
                    match g.as_mut() {
                        Some(g) if !g.visible => {
                            g.visible = true;
                            true
                        }
                        _ => false,
                    }
                };
                if first {
                    app.emit("game:state", json!({ "running": log_id, "phase": "running" }));
                    match after.as_str() {
                        "hide" => app.shell.window("hide"),
                        "minimize" => app.shell.window("minimize"),
                        "close" => app.shell.quit(),
                        _ => {}
                    }
                }
            }
        });
        let me = Arc::downgrade(self);
        let exit_id = id.clone();
        let on_exit: launch::ExitFn = Box::new(move |code: i32| {
            let Some(app) = me.upgrade() else { return };
            let killed = app.game.lock().unwrap_or_else(|e| e.into_inner()).take().is_some_and(|g| g.killed);
            let played = now_ms() - started;
            let total = app.instances().get(&exit_id).map_or(0, |i| i.i64_of("playTime")) + played;
            let _ = app.instances().update(&exit_id, &json!({ "playTime": total }));
            app.hub.game_stopped();
            *app.hub_player.lock().unwrap_or_else(|e| e.into_inner()) = None;
            app.emit("game:state", json!({ "running": null, "code": if killed { 0 } else { code } }));
            app.shell.window("show");
            app.shell.window("focus");
            if !killed && code != 0 {
                let lines = tail.lock().map(|t| t.len()).unwrap_or(0);
                app.log(
                    format!("[Naprawa] Gra zakończyła się kodem {code} ({lines} linii logu). Automatyczna naprawa – w przygotowaniu w wersji Rust."),
                    "out",
                );
            }
        });
        let handle = launch::spawn(&cmd, on_log, on_exit)?;
        *self.game.lock().unwrap_or_else(|e| e.into_inner()) = Some(Game { handle, instance_id: id.clone(), visible: false, killed: false });
        // Nore Hub: other Nore players see this one (in the background, never delays the game)
        if inst.truthy_of("noreClient") {
            *self.hub_player.lock().unwrap_or_else(|e| e.into_inner()) = Player::from_account(&account);
            self.refresh_hub();
        }
        self.instances().update(&id, &json!({ "lastPlayed": now_ms() }))?;
        self.emit("game:state", json!({ "running": id, "phase": "starting" }));
        Ok(json!(true))
    }

    /// Settings → "Pokazuj innym graczom Nore, że grasz w Nore" changed, or a Nore Client game started.
    fn refresh_hub(&self) {
        let enabled = self.store.read(|d| d.pointer("/settings/hubPresence") != Some(&json!(false)));
        let player = self.hub_player.lock().unwrap_or_else(|e| e.into_inner()).clone();
        match (enabled, player) {
            (true, Some(p)) if !self.hub.is_running() => {
                let Ok(me) = self.chat.identity(&self.store, &self.secrets) else { return };
                let cos = self
                    .store
                    .read(|d| d.get("hubCosmetics").cloned())
                    .filter(|c| hub::cosmetics_error(c).is_none())
                    .unwrap_or_else(|| json!({ "v": 1, "slots": {} }));
                let e = self.emitter.clone();
                self.hub.game_started(me, p, cos, Arc::new(move |line| e.emit("log", json!({ "line": format!("[Nore Hub] {line}"), "stream": "out" }))));
            }
            (false, _) => self.hub.game_stopped(),
            _ => {}
        }
    }

    /// Stops the game when the launcher quits.
    pub fn shutdown(&self) {
        if let Some(g) = self.game.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            g.handle.kill();
        }
        self.hub.game_stopped();
    }
}

async fn count(dir: &Path, f: impl Fn(&str) -> bool) -> usize {
    let mut n = 0;
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            if f(&e.file_name().to_string_lossy().to_lowercase()) {
                n += 1;
            }
        }
    }
    n
}

async fn media_file(dir: &Path, kind: &str) -> Option<PathBuf> {
    for (ext, _) in IMAGE_TYPES {
        let f = dir.join(format!("{kind}.{ext}"));
        if crate::net::exists(&f).await {
            return Some(f);
        }
    }
    None
}

async fn media_data(game_dir: &Path, kind: &str) -> Option<String> {
    let f = media_file(&game_dir.join(".nore"), kind).await?;
    let b = tokio::fs::read(&f).await.ok()?;
    Some(format!("data:{};base64,{}", image_type(&f), B64.encode(b)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::DevUpdater;

    struct Collect(Mutex<Vec<(String, Value)>>);
    impl Emitter for Collect {
        fn emit(&self, channel: &str, payload: Value) {
            self.0.lock().unwrap().push((channel.into(), payload));
        }
    }

    fn app(dir: &Path) -> Arc<App> {
        App::new(Config {
            paths: Paths::new(dir),
            version: "1.4.5".into(),
            emitter: Arc::new(Collect(Mutex::new(vec![]))),
            shell: Arc::new(HeadlessShell),
            updater: Arc::new(DevUpdater { version: "1.4.5".into() }),
            resource_dir: None,
            ephemeral_secrets: true,
        })
        .unwrap()
    }

    /// Channels of launcher/src/preload.js: `invoke('x')` and `ipcRenderer.send('x')`.
    fn preload_channels() -> Vec<String> {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../launcher/src/preload.js")).expect("launcher/src/preload.js");
        let re = Regex::new(r#"(?:invoke|ipcRenderer\.send)\('([a-zA-Z]+:[a-zA-Z]+)'\)"#).unwrap();
        let mut v: Vec<String> = re.captures_iter(&text).map(|c| c[1].to_string()).collect();
        v.dedup();
        v
    }

    #[test]
    fn every_preload_channel_is_mapped() {
        let list = preload_channels();
        assert!(list.len() > 150, "found {} channels", list.len());
        for ch in &list {
            assert!(status_of(ch).is_some(), "{ch} from preload.js is missing in ipc::CHANNELS");
        }
        for (ch, _) in CHANNELS {
            assert!(list.contains(&ch.to_string()) || *ch == "net:check", "{ch} is not in preload.js any more");
        }
    }

    #[test]
    fn porting_checklist_matches_the_table() {
        let doc = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../PORTING.md")).expect("launcher-rs/PORTING.md");
        for (ch, st) in CHANNELS {
            let mark = match st {
                Status::Ported => "[x]",
                Status::Stub => "[~]",
                Status::Pending => "[ ]",
            };
            assert!(doc.contains(&format!("- {mark} `{ch}`")), "PORTING.md: expected `- {mark} `{ch}``");
        }
    }

    #[tokio::test]
    async fn pending_channels_answer_in_polish_and_ported_ones_do_not() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(dir.path());
        let e = app.invoke("servers:start", vec![json!("x")]).await.unwrap_err();
        assert_eq!(e.to_string(), "Funkcja w przygotowaniu w wersji Rust (servers:start).");
        assert!(app.invoke("nope:nope", vec![]).await.unwrap_err().to_string().starts_with("Nieznany kanał"));
        assert_eq!(app.invoke("servers:list", vec![]).await.unwrap(), json!([]));
        // ported channels never answer "pending", whatever the arguments
        for (ch, st) in CHANNELS {
            if *st == Status::Pending
                || ch.starts_with("versions:")
                || ch.starts_with("loaders:")
                || ch.starts_with("game:")
                || *ch == "net:check"
                || *ch == "official:status"
                || ch.starts_with("accounts:ms")
            {
                continue;
            }
            if let Err(Error::Pending(_)) = app.invoke(ch, vec![]).await {
                panic!("{ch} is marked ported but answers pending");
            }
        }
    }

    #[tokio::test]
    async fn first_start_state_offline_account_and_instances() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(dir.path());
        let st = app.invoke("state:get", vec![]).await.unwrap();
        assert_eq!(st["firstRun"], true);
        assert_eq!(st["instances"][0]["name"], "Nore Client");
        assert_eq!(st["running"], Value::Null);
        // no account: launching asks for one, nothing forces a Microsoft login
        let s = app.invoke("auth:status", vec![]).await.unwrap();
        assert_eq!(s, json!({ "loggedIn": false }));
        let acc = app.invoke("accounts:offline", vec![json!("Gracz_PL")]).await.unwrap();
        assert_eq!(acc["type"], "offline");
        assert!(app.invoke("accounts:offline", vec![json!("x")]).await.is_err());
        let s = app.invoke("auth:status", vec![]).await.unwrap();
        assert_eq!(s["account"]["name"], "Gracz_PL");
        assert_eq!(app.ready_account(false).await.unwrap()["accessToken"], "0");
        let set = app.invoke("settings:set", vec![json!({ "eventFx": 3, "accent": "#123456" })]).await.unwrap();
        assert_eq!((set["eventFx"].clone(), set["accent"].clone()), (json!(25), json!("#123456")));
        let inst = app.invoke("instances:create", vec![json!({ "name": "Test", "mcVersion": "1.21.1", "loader": "fabric" })]).await.unwrap();
        let id = inst["id"].as_str().unwrap();
        let mem = app.invoke("instances:memoryInfo", vec![json!(id)]).await.unwrap();
        assert_eq!(mem["auto"], true);
        assert!(mem["xmx"].as_u64().unwrap() >= 1024);
        let p = app.invoke("instances:optionsProfile", vec![json!(id), json!("performance")]).await.unwrap();
        assert_eq!(p["optionsProfileApplied"], "performance");
        assert!(std::fs::read_to_string(Path::new(inst["gameDir"].as_str().unwrap()).join("options.txt")).unwrap().contains("renderDistance:8"));
        assert!(app.invoke("instances:deleteWorld", vec![json!(id), json!("../../etc")]).await.is_ok());
        let me = app.invoke("chat:identity", vec![]).await.unwrap();
        assert_eq!(me["name"], "Gracz_PL");
        let sig = app.invoke("chat:sign", vec![json!("abc")]).await.unwrap();
        assert_eq!(app.invoke("chat:verify", vec![me["hex"].clone(), me["pub"].clone(), json!("abc"), sig]).await.unwrap(), true);
        assert_eq!(app.invoke("official:info", vec![]).await.unwrap()["address"], "mc.noreclient.pl");
        assert!(app.invoke("game:launch", vec![json!("missing")]).await.is_err());
        // the busy flag is released after a failure
        assert!(app.invoke("game:prepare", vec![json!("missing")]).await.unwrap_err().to_string().contains("Nie znaleziono"));
    }

    #[test]
    fn version_names_sort_naturally() {
        let mut v = vec!["1.21.10", "1.21.1", "1.9", "fabric-loader-0.16.5-1.21.1"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["1.9", "1.21.1", "1.21.10", "fabric-loader-0.16.5-1.21.1"]);
    }
}
