//! Local Minecraft servers (port of launcher/src/main/servers.js): Vanilla, Paper, Purpur, Folia,
//! Fabric, Quilt, Forge, NeoForge, Velocity and BungeeCord. Install, start / stop with a live
//! console, auto-restart after crashes, scheduled restarts and backups, TPS, player lists,
//! server.properties and making the server reachable (server_net, server_tunnel).

use crate::error::{msg, Result};
use crate::ipc::App;
use crate::js::{assign, now_ms, truthy, ValueExt};
use crate::util::{self, Zip};
use crate::{java, jvm, server_content as sc, server_net, server_props, server_tools as tools, server_tunnel, Env, ProgressFn};
use rand::RngCore;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;

static NOISY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)error|failed|warn").unwrap());

pub const TYPES: [&str; 10] = ["vanilla", "paper", "purpur", "folia", "fabric", "quilt", "forge", "neoforge", "velocity", "bungeecord"];

pub fn is_proxy(t: &str) -> bool {
    t == "velocity" || t == "bungeecord"
}

/// Java major version each Mojang runtime component provides.
pub fn component_major(c: &str) -> Option<u32> {
    Some(match c {
        "jre-legacy" => 8,
        "java-runtime-alpha" => 16,
        "java-runtime-beta" | "java-runtime-gamma" | "java-runtime-gamma-snapshot" => 17,
        "java-runtime-delta" => 21,
        "java-runtime-epsilon" => 25,
        _ => return None,
    })
}

pub fn default_props() -> Value {
    json!({
        "motd": "Serwer Nore", "max-players": 10, "online-mode": false, "gamemode": "survival",
        "difficulty": "normal", "pvp": true, "white-list": false, "view-distance": 10, "simulation-distance": 10, "spawn-protection": 0,
        "allow-flight": false, "hardcore": false, "level-seed": "", "level-name": "world",
    })
}

/// A running server process.
pub struct ServerRt {
    pub gen: u64,
    pub state: String,
    pub players: Vec<String>,
    pub log: VecDeque<Value>,
    pub started: i64,
    pub stopping: bool,
    pub tps: Value,
    pub quiet_until: i64,
    pub net: Value,
    pub next_restart: Option<i64>,
    pub pid: Option<u32>,
    stdin: mpsc::UnboundedSender<String>,
    kill: Option<oneshot::Sender<()>>,
    exited: watch::Receiver<bool>,
    timers: Vec<JoinHandle<()>>,
    sched: Vec<JoinHandle<()>>,
    tunnel: Option<oneshot::Sender<()>>,
    wait_save: Option<oneshot::Sender<()>>,
}

impl ServerRt {
    fn abort_all(&mut self) {
        for t in self.timers.drain(..).chain(self.sched.drain(..)) {
            t.abort();
        }
        if let Some(t) = self.tunnel.take() {
            let _ = t.send(());
        }
    }
}

fn world_name(srv: &Value) -> String {
    sc::world_name(srv)
}

fn ty(srv: &Value) -> String {
    srv.string_or("type", "paper")
}

/// Rejects when something else listens on the server port.
async fn port_free(port: u16) -> Result<()> {
    match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => {
            drop(l);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            Err(msg(format!("Port {port} jest zajęty – zatrzymaj inny serwer albo zmień port w ustawieniach serwera.")))
        }
        Err(e) => Err(e.into()),
    }
}

fn offline_uuid(name: &str) -> String {
    use md5::{Digest, Md5};
    let mut h: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    h[6] = (h[6] & 0x0f) | 0x30;
    h[8] = (h[8] & 0x3f) | 0x80;
    let x = hex::encode(h);
    format!("{}-{}-{}-{}-{}", &x[0..8], &x[8..12], &x[12..16], &x[16..20], &x[20..])
}

fn list_file(which: &str) -> Option<&'static str> {
    Some(match which {
        "whitelist" => "whitelist.json",
        "ops" => "ops.json",
        "bans" => "banned-players.json",
        _ => return None,
    })
}

impl App {
    pub fn server_dir(&self, id: &str) -> PathBuf {
        self.env.paths.root().join("servers").join(id)
    }

    pub fn server_raw(&self, id: &str) -> Option<Value> {
        self.store.read(|d| d["servers"].as_array().and_then(|l| l.iter().find(|s| s.str_of("id") == Some(id)).cloned()))
    }

    fn server_view(&self, s: &Value) -> Value {
        let id = s.string_or("id", "");
        let rt = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
        let r = rt.get(&id);
        let mut v = s.clone();
        let domain = if s["domain"].is_object() {
            let mut d = s["domain"].clone();
            d["hasToken"] = json!(truthy(&d["token"]));
            if let Some(o) = d.as_object_mut() {
                o.remove("token");
            }
            d
        } else {
            Value::Null
        };
        assign(
            &mut v,
            &json!({
                "domain": domain, "dir": self.server_dir(&id).to_string_lossy(), "net": r.map(|r| r.net.clone()).unwrap_or(Value::Null),
                "state": r.map_or("stopped".to_string(), |r| r.state.clone()), "players": r.map(|r| r.players.clone()).unwrap_or_default(),
                "startedAt": r.map(|r| json!(r.started)).unwrap_or(Value::Null), "hasIcon": self.server_dir(&id).join("server-icon.png").exists(), "proxy": is_proxy(&ty(s)),
                "tps": r.map(|r| r.tps.clone()).unwrap_or(Value::Null), "nextRestart": r.and_then(|r| r.next_restart).map(|n| json!(n)).unwrap_or(Value::Null),
            }),
        );
        v
    }

    pub fn servers_list(&self) -> Value {
        let list = self.store.read(|d| d["servers"].as_array().cloned().unwrap_or_default());
        Value::Array(list.iter().map(|s| self.server_view(s)).collect())
    }

    pub fn server_get(&self, id: &str) -> Option<Value> {
        self.server_raw(id).map(|s| self.server_view(&s))
    }

    pub fn server_require(&self, id: &str) -> Result<Value> {
        self.server_get(id).ok_or_else(|| msg("Nie znaleziono serwera."))
    }

    pub fn server_running(&self, id: &str) -> bool {
        self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).contains_key(id)
    }

    pub fn servers_running_count(&self) -> usize {
        self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub fn server_create(&self, o: &Value) -> Result<Value> {
        static NON: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
        let t = o.string_or("type", "paper");
        if !TYPES.contains(&t.as_str()) {
            return Err(msg(format!("Nieznany silnik {t}")));
        }
        let name = o.str_of("name").filter(|s| !s.is_empty()).map(String::from);
        let lower = name.clone().unwrap_or_else(|| "serwer".into()).to_lowercase();
        let slug: String = NON.replace_all(&lower, "-").trim_matches('-').chars().take(24).collect();
        let mut r = [0u8; 3];
        rand::thread_rng().fill_bytes(&mut r);
        let id = format!("{slug}-{}", hex::encode(r));
        let mc = o.string_or("mcVersion", "");
        let srv = json!({
            "id": id, "name": name.unwrap_or_else(|| format!("Serwer {mc}")), "mcVersion": mc, "type": t, "memoryMb": o.get("memoryMb").cloned().unwrap_or(json!(2048)),
            "port": o.get("port").cloned().unwrap_or(json!(25565)), "eula": o.truthy_of("eula"), "props": default_props(),
            "created": now_ms(), "installed": false, "autoRestart": true, "backupOnStart": false, "backupKeep": 10, "upnp": true, "domain": null, "jvmArgs": "",
            "loaderVersion": "", "tunnel": null, "disableClientMods": true, "jvmProfile": "aikar", "schedule": { "restartAt": "", "backupEveryH": 0, "warnMinutes": 5 },
            "modPins": [], "modProfiles": [],
        });
        self.store.update(|d| {
            if !d["servers"].is_array() {
                d["servers"] = json!([]);
            }
            if let Some(l) = d["servers"].as_array_mut() {
                l.push(srv.clone());
            }
        })?;
        std::fs::create_dir_all(self.server_dir(&id))?;
        self.server_require(&id)
    }

    pub fn encrypt_token(&self, t: &str) -> Value {
        if t.is_empty() {
            return Value::Null;
        }
        json!(format!("rs:{}", self.secrets.seal_str(t)))
    }

    pub fn decrypt_token(&self, v: &Value) -> Option<String> {
        let s = v.as_str().filter(|s| !s.is_empty())?;
        if let Some(r) = s.strip_prefix("rs:") {
            return self.secrets.unseal_str(r).ok();
        }
        if let Some(e) = s.strip_prefix("enc:") {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD.decode(e).ok()?;
            return String::from_utf8(crate::oscrypt::decrypt(&bytes, &self.env.paths.electron_user_data()?)?).ok();
        }
        Some(s.to_string())
    }

    pub fn server_update(self: &Arc<Self>, id: &str, patch: &Value) -> Result<Value> {
        let mut patch = patch.as_object().cloned().unwrap_or_default();
        let enc = patch.get("domain").filter(|d| d.is_object()).map(|d| {
            if d.get("token").is_some() {
                Some(self.encrypt_token(d.str_of("token").unwrap_or("")))
            } else {
                None
            }
        });
        let has_schedule = patch.contains_key("schedule");
        self.store.update(|d| {
            let Some(s) = d["servers"].as_array_mut().and_then(|l| l.iter_mut().find(|s| s.str_of("id") == Some(id))) else { return };
            if let Some(p) = patch.remove("props") {
                if !s["props"].is_object() {
                    s["props"] = json!({});
                }
                assign(&mut s["props"], &p);
            }
            if let Some(sch) = patch.get("schedule").cloned() {
                let mut cur = s.get("schedule").cloned().filter(Value::is_object).unwrap_or(json!({}));
                assign(&mut cur, &sch);
                patch.insert("schedule".into(), tools::normalize_schedule(&cur));
            }
            if patch.get("jvmProfile").is_some_and(|p| truthy(p) && !jvm::SERVER_PROFILES.contains(&p.as_str().unwrap_or(""))) {
                patch.remove("jvmProfile");
            }
            if let Some(dom) = patch.remove("domain").filter(|d| d.is_object()) {
                let token = match &enc {
                    Some(Some(t)) => t.clone(),
                    _ => s.pointer("/domain/token").cloned().unwrap_or(Value::Null),
                };
                let mut nd = dom.clone();
                nd["token"] = token;
                s["domain"] = nd;
            }
            let lv_given = patch.contains_key("loaderVersion");
            if patch.get("mcVersion").is_some_and(|m| truthy(m) && Some(m) != s.get("mcVersion")) {
                s["installed"] = json!(false);
                if !lv_given {
                    s["loaderVersion"] = json!("");
                }
            }
            if patch.get("type").is_some_and(|m| truthy(m) && Some(m) != s.get("type")) {
                s["installed"] = json!(false);
                if !lv_given {
                    s["loaderVersion"] = json!("");
                }
            }
            if lv_given && patch.get("loaderVersion") != s.get("loaderVersion") {
                s["installed"] = json!(false);
            }
            for (k, v) in patch {
                s[k.as_str()] = v;
            }
            s["id"] = json!(id);
        })?;
        if has_schedule && self.server_running(id) {
            self.server_schedule(id);
        }
        self.server_require(id)
    }

    pub async fn server_remove(&self, id: &str) -> Result<Value> {
        if self.server_running(id) {
            return Err(msg("Najpierw zatrzymaj serwer."));
        }
        self.store.update(|d| {
            if let Some(l) = d["servers"].as_array_mut() {
                l.retain(|s| s.str_of("id") != Some(id));
            }
        })?;
        let _ = tokio::fs::remove_dir_all(self.server_dir(id)).await;
        Ok(Value::Null)
    }

    async fn server_java(&self, srv: &Value, progress: &ProgressFn) -> Result<PathBuf> {
        let component = srv.str_of("javaComponent").filter(|s| !s.is_empty()).unwrap_or("java-runtime-delta").to_string();
        let mut bin = self.store.settings().str_of("javaPath").filter(|s| !s.is_empty()).map(String::from);
        if let Some(b) = &bin {
            let need = component_major(&component);
            let have = java::probe_java(Path::new(&b.replace("javaw.exe", "java.exe"))).await;
            if need.is_none() || have.is_none_or(|h| h < need.unwrap_or(0)) {
                bin = None;
            }
        }
        let bin = match bin {
            Some(b) => PathBuf::from(b),
            None => java::ensure_runtime(&self.env, &component, progress).await?,
        };
        Ok(if cfg!(windows) { PathBuf::from(bin.to_string_lossy().replace("javaw.exe", "java.exe")) } else { bin })
    }

    /// Loader versions for the version picker: `[{ version, stable }]` newest first.
    pub async fn server_loader_versions(&self, t: &str, mc: &str) -> Result<Value> {
        let env = &self.env;
        Ok(match t {
            "fabric" | "quilt" => json!(crate::loaders::versions(env, t, mc).await.unwrap_or_default()),
            "neoforge" => {
                let mut l = neoforge_versions(env, mc).await?;
                l.reverse();
                Value::Array(
                    l.into_iter()
                        .map(|v| json!({ "stable": !v.to_lowercase().contains("beta") && !v.to_lowercase().contains("alpha"), "version": v }))
                        .collect(),
                )
            }
            "forge" => {
                let meta: Value = env.net.get_json("https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json").await.unwrap_or(json!({}));
                let promos: Value =
                    env.net.get_json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json").await.unwrap_or(json!({}));
                let rec = promos.pointer(&format!("/promos/{mc}-recommended")).and_then(Value::as_str).map(String::from);
                let list: Vec<String> = meta[mc].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
                Value::Array(
                    list.iter()
                        .rev()
                        .map(|v| json!({ "version": v.get(mc.len() + 1..).unwrap_or(""), "stable": rec.as_ref().is_some_and(|r| v.ends_with(&format!("-{r}"))) }))
                        .collect(),
                )
            }
            _ => json!([]),
        })
    }

    async fn install_proxy(self: &Arc<Self>, id: &str, srv: &Value, progress: &ProgressFn) -> Result<Value> {
        let jar = self.server_dir(id).join("server.jar");
        self.server_update(id, &json!({ "javaComponent": "java-runtime-delta" }))?;
        let _ = tokio::fs::remove_file(&jar).await;
        if ty(srv) == "velocity" {
            let (version, url, size) = velocity_build(&self.env, srv.str_of("loaderVersion").filter(|s| !s.is_empty())).await?;
            progress(json!({ "stage": format!("Pobieranie Velocity {version}") }));
            self.env.net.download(&url, &jar, None, size, &|_| {}).await?;
            let major: u32 = version.split('.').next().and_then(|v| v.parse().ok()).unwrap_or(3);
            self.server_update(
                id,
                &json!({ "installedLoader": version, "javaComponent": if major >= 4 { "java-runtime-epsilon" } else { "java-runtime-delta" } }),
            )?;
        } else {
            progress(json!({ "stage": "Pobieranie BungeeCord" }));
            self.env
                .net
                .download("https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar", &jar, None, None, &|_| {})
                .await?;
            self.server_update(id, &json!({ "installedLoader": "najnowszy" }))?;
        }
        self.server_update(id, &json!({ "installed": true, "launch": { "mode": "jar", "jar": "server.jar" } }))
    }

    /// Downloads / installs the server jar (servers:reinstall, first start).
    pub async fn server_install(self: &Arc<Self>, id: &str, progress: ProgressFn) -> Result<Value> {
        let srv = self.server_raw(id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
        if is_proxy(&ty(&srv)) {
            return self.install_proxy(id, &srv, &progress).await;
        }
        let base = self.server_dir(id);
        tokio::fs::create_dir_all(&base).await?;
        let jar = base.join("server.jar");
        let mc = srv.string_or("mcVersion", "");
        let manifest = self.env.manifest(false).await?;
        let entry = manifest["versions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|v| v.str_of("id") == Some(&mc))
            .cloned()
            .ok_or_else(|| msg(format!("Nieznana wersja {mc}")))?;
        let vjson: Value = self.env.net.get_json(entry.str_of("url").unwrap_or("")).await?;
        let server_dl = vjson.pointer("/downloads/server").cloned();
        let component = vjson.pointer("/javaVersion/component").and_then(Value::as_str).unwrap_or("jre-legacy").to_string();
        self.server_update(id, &json!({ "javaComponent": component }))?;
        let srv = self.server_raw(id).unwrap_or(srv);
        let t = ty(&srv);
        progress(json!({ "stage": format!("Pobieranie serwera {t} {mc}") }));
        let mut launch = json!({ "mode": "jar", "jar": "server.jar" });
        let lv = srv.string_or("loaderVersion", "");
        let env = &self.env;
        match t.as_str() {
            "paper" | "folia" => {
                let name = if t == "paper" { "Paper" } else { "Folia" };
                let builds: Vec<Value> = env
                    .net
                    .get_json(&format!("https://fill.papermc.io/v3/projects/{t}/versions/{}/builds", urlencoding::encode(&mc)))
                    .await
                    .map_err(|_| msg(format!("{name} nie wspiera wersji {mc}")))?;
                let b =
                    builds.iter().find(|b| b.str_of("channel") == Some("STABLE")).or(builds.first()).ok_or_else(|| msg(format!("Brak buildów dla {mc}")))?;
                let f = &b["downloads"]["server:default"];
                let _ = tokio::fs::remove_file(&jar).await;
                env.net.download(f.str_of("url").unwrap_or(""), &jar, None, f["size"].as_u64(), &|_| {}).await?;
            }
            "purpur" => {
                env.net
                    .get_json::<Value>(&format!("https://api.purpurmc.org/v2/purpur/{}", urlencoding::encode(&mc)))
                    .await
                    .map_err(|_| msg(format!("Purpur nie wspiera wersji {mc}")))?;
                let _ = tokio::fs::remove_file(&jar).await;
                env.net
                    .download(&format!("https://api.purpurmc.org/v2/purpur/{}/latest/download", urlencoding::encode(&mc)), &jar, None, None, &|_| {})
                    .await?;
            }
            "fabric" => {
                let loaders = crate::loaders::versions(env, "fabric", &mc).await.unwrap_or_default();
                let l = loaders
                    .iter()
                    .find(|l| !lv.is_empty() && l.version == lv)
                    .or_else(|| loaders.iter().find(|l| l.stable))
                    .or(loaders.first())
                    .cloned()
                    .ok_or_else(|| msg(format!("Fabric nie wspiera wersji {mc}")))?;
                let installers: Vec<Value> = env.net.get_json("https://meta.fabricmc.net/v2/versions/installer").await?;
                let inst = installers.iter().find(|i| i.truthy_of("stable")).or(installers.first()).ok_or_else(|| msg("Brak instalatora Fabric"))?;
                let _ = tokio::fs::remove_file(&jar).await;
                env.net
                    .download(
                        &format!("https://meta.fabricmc.net/v2/versions/loader/{mc}/{}/{}/server/jar", l.version, inst.string_or("version", "")),
                        &jar,
                        None,
                        None,
                        &|_| {},
                    )
                    .await?;
                self.server_update(id, &json!({ "installedLoader": l.version }))?;
            }
            "quilt" => {
                let loaders = crate::loaders::versions(env, "quilt", &mc).await.unwrap_or_default();
                let l = loaders
                    .iter()
                    .find(|l| !lv.is_empty() && l.version == lv)
                    .or_else(|| loaders.iter().find(|l| l.stable))
                    .or(loaders.first())
                    .cloned()
                    .ok_or_else(|| msg(format!("Quilt nie wspiera wersji {mc}")))?;
                let xml = env.net.get_text("https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml").await?;
                static REL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<release>([^<]+)</release>").unwrap());
                static LAT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<latest>([^<]+)</latest>").unwrap());
                let iv = REL.captures(&xml).or_else(|| LAT.captures(&xml)).map(|c| c[1].to_string()).ok_or_else(|| msg("Nie znaleziono instalatora Quilt"))?;
                let installer = base.join("quilt-installer.jar");
                env.net
                    .download(
                        &format!("https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/{iv}/quilt-installer-{iv}.jar"),
                        &installer,
                        None,
                        None,
                        &|_| {},
                    )
                    .await?;
                let bin = self.server_java(&srv, &progress).await?;
                progress(json!({ "stage": format!("Instalowanie Quilt {}", l.version) }));
                run_installer(&bin, "quilt-installer.jar", &base, &progress, &["install", "server", &mc, &l.version, "--download-server", "--install-dir=."])
                    .await?;
                let _ = tokio::fs::remove_file(&installer).await;
                if !base.join("quilt-server-launch.jar").exists() {
                    return Err(msg("Instalator Quilt nie utworzył pliku startowego"));
                }
                launch = json!({ "mode": "jar", "jar": "quilt-server-launch.jar" });
                self.server_update(id, &json!({ "installedLoader": l.version }))?;
            }
            "neoforge" | "forge" => {
                let (url, loader_path, full) = if t == "neoforge" {
                    let mut matching = neoforge_versions(env, &mc).await?;
                    let full = if !lv.is_empty() && matching.contains(&lv) {
                        lv.clone()
                    } else {
                        matching
                            .iter()
                            .rfind(|v| !v.to_lowercase().contains("beta") && !v.to_lowercase().contains("alpha"))
                            .cloned()
                            .or_else(|| matching.pop())
                            .ok_or_else(|| msg(format!("NeoForge nie wspiera wersji {mc}")))?
                    };
                    (
                        format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{full}/neoforge-{full}-installer.jar"),
                        format!("net/neoforged/neoforge/{full}"),
                        full,
                    )
                } else {
                    let promos: Value = env.net.get_json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json").await?;
                    let forge = if !lv.is_empty() {
                        Some(lv.clone())
                    } else {
                        promos
                            .pointer(&format!("/promos/{mc}-recommended"))
                            .or(promos.pointer(&format!("/promos/{mc}-latest")))
                            .and_then(Value::as_str)
                            .map(String::from)
                    };
                    let forge = forge.ok_or_else(|| msg(format!("Forge nie wspiera wersji {mc}")))?;
                    let full = format!("{mc}-{forge}");
                    (
                        format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{full}/forge-{full}-installer.jar"),
                        format!("net/minecraftforge/forge/{full}"),
                        full,
                    )
                };
                let installer = base.join("installer.jar");
                env.net.download(&url, &installer, None, None, &|_| {}).await?;
                let bin = self.server_java(&srv, &progress).await?;
                progress(json!({ "stage": format!("Instalowanie {} {full}", if t == "forge" { "Forge" } else { "NeoForge" }) }));
                run_installer(&bin, "installer.jar", &base, &progress, &["--installServer"]).await?;
                self.server_update(id, &json!({ "installedLoader": full }))?;
                let _ = tokio::fs::remove_file(&installer).await;
                let _ = tokio::fs::remove_file(base.join("installer.jar.log")).await;
                let args_file = base.join("libraries").join(&loader_path).join(if cfg!(windows) { "win_args.txt" } else { "unix_args.txt" });
                if args_file.exists() {
                    let rel = args_file.strip_prefix(&base).map(|r| r.to_string_lossy().to_string()).unwrap_or_default();
                    launch = json!({ "mode": "args", "argsFile": rel });
                } else {
                    static F: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(neo)?forge-.*\.jar$").unwrap());
                    let cand = util::read_dir_names(&base)
                        .into_iter()
                        .find(|f| F.is_match(f) && !f.contains("installer"))
                        .ok_or_else(|| msg("Nie znaleziono pliku startowego Forge"))?;
                    launch = json!({ "mode": "jar", "jar": cand });
                }
            }
            _ => {
                let s = server_dl.filter(|s| s.is_object()).ok_or_else(|| msg(format!("Wersja {mc} nie ma oficjalnego serwera")))?;
                env.net.download(s.str_of("url").unwrap_or(""), &jar, s.str_of("sha1"), s["size"].as_u64(), &|_| {}).await?;
            }
        }
        self.server_update(id, &json!({ "installed": true, "launch": launch }))
    }

    /// File values with the launcher's own settings on top – what the server will use.
    pub fn server_read_properties(&self, id: &str) -> Map<String, Value> {
        let mut out = std::fs::read_to_string(self.server_dir(id).join("server.properties")).map(|t| server_props::parse(&t)).unwrap_or_default();
        if let Some(s) = self.server_raw(id) {
            for (k, v) in s["props"].as_object().into_iter().flatten() {
                out.insert(k.clone(), json!(crate::config_edit::js_string(v)));
            }
        }
        out
    }

    pub fn server_properties_form(&self, id: &str) -> Value {
        let values = self.server_read_properties(id);
        json!({ "values": values, "schema": server_props::schema(), "groups": server_props::groups(), "warnings": server_props::warnings(&values) })
    }

    pub fn server_save_properties(self: &Arc<Self>, id: &str, changes: &Value) -> Result<Value> {
        static KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z0-9.\-_]+$").unwrap());
        let (mut props, mut errors) = (Map::new(), Vec::new());
        for (k, v) in changes.as_object().into_iter().flatten() {
            if !KEY.is_match(k) {
                continue;
            }
            let (val, err) = server_props::validate(k, v);
            if let Some(e) = err {
                errors.push(json!(e));
            }
            if let Some(v) = val {
                props.insert(k.clone(), v);
            }
        }
        let server = self.server_update(id, &json!({ "props": props }))?;
        Ok(json!({ "server": server, "errors": errors, "warnings": server_props::warnings(&self.server_read_properties(id)) }))
    }

    fn write_properties(&self, srv: &Value) -> Result<()> {
        let id = srv.string_or("id", "");
        let file = self.server_dir(&id).join("server.properties");
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        let mut props = srv["props"].as_object().cloned().unwrap_or_default();
        props.insert("server-port".into(), srv["port"].clone());
        props.insert("query.port".into(), srv["port"].clone());
        std::fs::write(file, server_props::serialize(&text, &props))?;
        Ok(())
    }

    fn write_proxy_port(&self, srv: &Value) -> bool {
        let base = self.server_dir(srv.str_of("id").unwrap_or(""));
        let port = srv["port"].as_u64().unwrap_or(25565);
        if ty(srv) == "velocity" {
            let f = base.join("velocity.toml");
            let Ok(t) = std::fs::read_to_string(&f) else { return false };
            static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^(\s*bind\s*=\s*)"[^"]*""#).unwrap());
            let n = R.replace(&t, format!("${{1}}\"0.0.0.0:{port}\"").as_str()).to_string();
            if n != t {
                let _ = std::fs::write(&f, n);
            }
            return true;
        }
        let f = base.join("config.yml");
        let Ok(t) = std::fs::read_to_string(&f) else { return false };
        static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^(\s*host:\s*)\S+").unwrap());
        let n = R.replace(&t, format!("${{1}}0.0.0.0:{port}").as_str()).to_string();
        if n != t {
            let _ = std::fs::write(&f, n);
        }
        true
    }

    pub(crate) fn server_log(&self, id: &str, line: &str, stream: &str) {
        if let Some(rt) = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
            rt.log.push_back(json!({ "line": line, "stream": stream }));
            if rt.log.len() > 3000 {
                rt.log.drain(..1000);
            }
        }
        self.emit("server:log", json!({ "id": id, "line": line, "stream": stream }));
    }

    fn rt_is(&self, id: &str, gen: u64) -> bool {
        self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get(id).is_some_and(|r| r.gen == gen)
    }

    fn rt_state(&self, id: &str) -> Option<String> {
        self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get(id).map(|r| r.state.clone())
    }

    /// Domain → current public IP with the server's provider.
    pub async fn server_apply_domain(&self, srv: &Value, ip: Option<String>) -> Result<Value> {
        let d = &srv["domain"];
        let provider = d.str_of("provider").unwrap_or("");
        if provider.is_empty() || provider == "none" {
            return Err(msg("Najpierw ustaw domenę."));
        }
        if provider == "nore" {
            return self.apply_nore_domain(srv, ip).await;
        }
        let ip = match ip {
            Some(i) => i,
            None => server_net::public_ip(&self.env).await?,
        };
        let port = srv["port"].as_u64().unwrap_or(25565) as u16;
        if provider == "manual" {
            let name = d.string_or("name", "");
            return Ok(json!({ "host": name, "ip": ip, "records": server_net::manual_records(&name, Some(&ip), port) }));
        }
        let secret = self
            .decrypt_token(&d["token"])
            .ok_or_else(|| msg(if provider == "noip" || provider == "dynu" { "Brak hasła do konta." } else { "Brak tokenu API." }))?;
        let host = server_net::update_domain(&self.env, d, &secret, &ip, port).await?;
        let id = srv.string_or("id", "");
        let _ = self.store.update(|x| {
            if let Some(s) = x["servers"].as_array_mut().and_then(|l| l.iter_mut().find(|s| s.str_of("id") == Some(&id))) {
                if s["domain"].is_object() {
                    s["domain"]["lastIp"] = json!(ip);
                }
            }
        });
        Ok(json!({ "host": host, "ip": ip, "records": server_net::manual_records(&host, Some(&ip), port) }))
    }

    fn add_timer(&self, id: &str, gen: u64, h: JoinHandle<()>) {
        match self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
            Some(rt) if rt.gen == gen => rt.timers.push(h),
            _ => h.abort(),
        }
    }

    fn set_net(&self, id: &str, gen: u64, key: &str, v: Value) {
        if let Some(rt) = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
            if rt.gen == gen {
                if !rt.net.is_object() {
                    rt.net = json!({});
                }
                rt.net[key] = v;
            }
        }
    }

    /// Port forwarding, domain and tunnel for a running server (failures only warn).
    async fn prepare_network(self: &Arc<Self>, srv: Value, gen: u64) {
        let id = srv.string_or("id", "");
        let port = srv["port"].as_u64().unwrap_or(25565) as u16;
        if srv.truthy_of("upnp") {
            let desc = format!("Nore {}", srv.string_or("name", ""));
            match server_net::upnp_open(port, &desc).await {
                Ok(r) => {
                    self.set_net(&id, gen, "forward", r.clone());
                    let method = if r.str_of("method") == Some("natpmp") { "NAT-PMP" } else { "UPnP" };
                    let ext = r.str_of("external").map(|e| format!(" (IP routera {e})")).unwrap_or_default();
                    self.server_log(
                        &id,
                        &format!("[Launcher] {method}: otwarto port {port} na routerze {} → {}{ext}", r.string_or("router", ""), r.string_or("client", "")),
                        "cmd",
                    );
                    if r.truthy_of("cgnat") {
                        self.server_log(&id, &format!("[Launcher] Uwaga: router ma niepubliczny adres {} (CGNAT) – znajomi z internetu nie połączą się przez IP. Włącz tunel playit.gg w zakładce „Sieć i domena”.", r.string_or("external", "")), "err");
                    }
                    let every = if r.str_of("method") == Some("natpmp") { (r["lifetime"].as_u64().unwrap_or(7200) / 2).max(60) } else { 1800 };
                    let me = self.clone();
                    let (id2, desc2) = (id.clone(), desc.clone());
                    let h = tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(std::time::Duration::from_secs(every)).await;
                            if !me.rt_is(&id2, gen) {
                                return;
                            }
                            if let Ok(r) = server_net::upnp_open(port, &desc2).await {
                                me.set_net(&id2, gen, "forward", r);
                            }
                        }
                    });
                    self.add_timer(&id, gen, h);
                }
                Err(e) => {
                    self.set_net(&id, gen, "forwardError", json!(e.to_string()));
                    self.server_log(&id, &format!("[Launcher] {e}"), "err");
                }
            }
        }
        // Windows firewall: the inbound rule for the server port is added on its own the first time
        // (one administrator prompt); after a refusal it is not asked again – the button stays
        if cfg!(windows) && srv.get("firewallAsked") != Some(&json!(true)) && server_net::firewall_status(port).await["rule"] != json!(true) {
            let _ = self.server_update(&id, &json!({ "firewallAsked": true }));
            match server_net::firewall_allow(port).await {
                Ok(_) => self.server_log(&id, &format!("[Launcher] Zapora Windows: dodano regułę dla portu {port}."), "cmd"),
                Err(e) => {
                    self.server_log(&id, &format!("[Launcher] Zapora Windows: {e} – kliknij „Zezwól w zaporze Windows” w zakładce „Sieć i domena”."), "err")
                }
            }
        }
        let d = &srv["domain"];
        let tunnel_on = srv.pointer("/tunnel/enabled") == Some(&json!(true));
        let nore = d.str_of("provider") == Some("nore") && d.str_of("name").is_some_and(|n| !n.is_empty());
        // a Nore domain on a tunnelled server points at the tunnel – set once the tunnel is up
        let nore_tunnel = nore && tunnel_on;
        let auto = d.str_of("provider").is_some_and(|p| !p.is_empty() && p != "manual" && p != "none")
            && if d.str_of("provider") == Some("nore") { nore && d.get("auto") != Some(&json!(false)) } else { d.truthy_of("auto") };
        if auto && !nore_tunnel {
            let me = self.clone();
            let id2 = id.clone();
            let h = tokio::spawn(async move {
                let mut last: Option<String> = None;
                let mut last_at = 0i64;
                let mut first = true;
                loop {
                    if !me.rt_is(&id2, gen) {
                        return;
                    }
                    let r = async {
                        let ip = server_net::public_ip(&me.env).await?;
                        // a Nore domain also needs a refresh at least once a day, or it expires after 60 days
                        let stale = nore && now_ms() - last_at > 24 * 3600 * 1000;
                        if !first && Some(&ip) == last.as_ref() && !stale {
                            return Ok(None);
                        }
                        let s = me.server_raw(&id2).unwrap_or(json!({}));
                        let r = me.server_apply_domain(&s, Some(ip.clone())).await?;
                        Ok::<_, crate::Error>(Some((r, ip)))
                    }
                    .await;
                    match r {
                        Ok(Some((r, ip))) => {
                            let changed = !first && Some(&ip) != last.as_ref();
                            if first || changed {
                                let shown = r.str_of("ip").map(String::from).unwrap_or(ip.clone());
                                me.server_log(
                                    &id2,
                                    &format!("[Launcher] Domena {} → {shown}{}", r.string_or("host", ""), if changed { " (zmiana IP)" } else { "" }),
                                    "cmd",
                                );
                            }
                            last = Some(ip);
                            last_at = now_ms();
                        }
                        Ok(None) => {}
                        Err(e) if first => me.server_log(&id2, &format!("[Launcher] Domena: {e}"), "err"),
                        Err(_) => {}
                    }
                    first = false;
                    tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                }
            });
            self.add_timer(&id, gen, h);
        }
        if tunnel_on {
            match self.start_tunnel(&srv, gen).await {
                Err(e) => self.server_log(&id, &format!("[Launcher] Tunel playit.gg: {e}"), "err"),
                Ok(()) if nore_tunnel && d.get("auto") != Some(&json!(false)) && self.rt_is(&id, gen) => {
                    match self.server_apply_domain(&self.server_raw(&id).unwrap_or(srv.clone()), None).await {
                        Ok(r) => self.server_log(&id, &format!("[Launcher] Domena {} → tunel {}", r.string_or("host", ""), r.string_or("ip", "")), "cmd"),
                        Err(e) => self.server_log(&id, &format!("[Launcher] Domena: {e}"), "err"),
                    }
                }
                Ok(()) => {}
            }
        }
    }

    async fn start_tunnel(self: &Arc<Self>, srv: &Value, gen: u64) -> Result<()> {
        let id = srv.string_or("id", "");
        let secret = self
            .decrypt_token(&self.store.read(|d| d.pointer("/playit/secret").cloned().unwrap_or(Value::Null)))
            .ok_or_else(|| msg("połącz konto playit.gg w zakładce „Sieć i domena”"))?;
        let mut t = srv["tunnel"].clone();
        if !truthy(&t["id"]) {
            let name: String = format!("nore-{id}").chars().take(40).collect();
            let (tid, addr) = server_tunnel::ensure_tunnel(&self.env, &secret, &name).await?;
            t["id"] = json!(tid);
            t["address"] = json!(addr);
            self.server_update(&id, &json!({ "tunnel": t }))?;
        }
        let port = srv["port"].as_u64().unwrap_or(25565) as u16;
        let mut child = server_tunnel::run(&self.env, &secret, t.str_of("id").unwrap_or(""), port).await?;
        let (tx, rx) = oneshot::channel::<()>();
        for s in [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let me = self.clone();
            let id2 = id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let l = server_tunnel::clean(&l);
                    if !l.is_empty() && NOISY.is_match(&l) {
                        me.server_log(&id2, &format!("[playit] {l}"), "err");
                    }
                }
            });
        }
        let me = self.clone();
        let id2 = id.clone();
        tokio::spawn(async move {
            let code = tokio::select! {
                s = child.wait() => s.ok().and_then(|s| s.code()).unwrap_or(-1),
                _ = rx => { let _ = child.kill().await; return; }
            };
            let stopping = me.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get(&id2).is_some_and(|r| r.gen == gen && r.stopping);
            if me.rt_is(&id2, gen) && !stopping {
                me.server_log(&id2, &format!("[Launcher] Tunel playit.gg zakończył się (kod {code})"), "err");
            }
        });
        match self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&id) {
            Some(rt) if rt.gen == gen => rt.tunnel = Some(tx),
            _ => {
                let _ = tx.send(());
            }
        }
        self.set_net(&id, gen, "tunnel", t["address"].clone());
        self.server_log(&id, &format!("[Launcher] Tunel playit.gg: znajomi łączą się przez {}", t.string_or("address", "")), "cmd");
        Ok(())
    }

    pub fn server_jvm_args(&self, srv: &Value) -> Vec<String> {
        let (_, free) = jvm::system_memory_mb();
        jvm::server_jvm_args(
            srv.str_of("jvmProfile").filter(|s| !s.is_empty()).unwrap_or("aikar"),
            srv["memoryMb"].as_f64().unwrap_or(2048.0).round().max(0.0) as u64,
            srv.str_of("javaComponent").and_then(component_major).unwrap_or(21),
            is_proxy(&ty(srv)),
            free,
            srv.str_of("jvmArgs").unwrap_or(""),
        )
    }

    /// Starts the server (installs it first when needed).
    pub fn server_start<'a>(self: &'a Arc<Self>, id: &'a str, progress: ProgressFn) -> futures::future::BoxFuture<'a, Result<Value>> {
        Box::pin(async move {
            if self.server_running(id) {
                return Err(msg("Serwer już działa."));
            }
            let mut srv = self.server_raw(id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
            let t = ty(&srv);
            if !srv.truthy_of("eula") && !is_proxy(&t) {
                return Err(msg("Musisz zaakceptować EULA Minecraft, aby uruchomić serwer."));
            }
            let port = srv["port"].as_u64().unwrap_or(25565) as u16;
            let others: Vec<(String, String)> =
                self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).iter().map(|(k, r)| (k.clone(), r.state.clone())).collect();
            for (other, state) in others {
                if let Some(o) = self.server_raw(&other) {
                    if o["port"].as_u64() == Some(port as u64) {
                        return Err(msg(format!(
                            "Serwer „{}” już używa portu {port}{}.",
                            o.string_or("name", ""),
                            if state == "stopping" { " (właśnie się zatrzymuje)" } else { "" }
                        )));
                    }
                }
            }
            port_free(port).await?;
            if !srv.truthy_of("installed") {
                self.server_install(id, progress.clone()).await?;
                srv = self.server_raw(id).unwrap_or(srv);
            }
            let bin = self.server_java(&srv, &progress).await?;
            let dir = self.server_dir(id);
            if is_proxy(&t) {
                if !self.write_proxy_port(&srv) && port != (if t == "velocity" { 25565 } else { 25577 }) {
                    self.server_log(
                        id,
                        &format!("[Launcher] Pierwszy start: proxy utworzy swój plik konfiguracji – port {port} ustawię przy następnym starcie."),
                        "err",
                    );
                }
            } else {
                std::fs::write(dir.join("eula.txt"), "# Zaakceptowano w Nore Launcher (https://aka.ms/MinecraftEULA)\neula=true\n")?;
                self.write_properties(&srv)?;
            }
            let view = self.server_view(&srv);
            if srv.get("disableClientMods") != Some(&json!(false)) && sc::mod_loaders(&t).is_some() {
                for f in sc::disable_client_only(&view).await {
                    self.server_log(id, &format!("[Launcher] Wyłączono mod tylko dla klienta (wysypałby serwer): {f}"), "err");
                }
            }
            if srv.truthy_of("backupOnStart") && !is_proxy(&t) && dir.join(world_name(&srv)).exists() {
                progress(json!({ "stage": "Kopia zapasowa świata" }));
                self.server_backup(id, "auto").await?;
            }
            let launch = srv.get("launch").cloned().filter(Value::is_object).unwrap_or(json!({ "mode": "jar", "jar": "server.jar" }));
            let mut args = self.server_jvm_args(&srv);
            if launch.str_of("mode") == Some("args") {
                args.push(format!("@{}", launch.string_or("argsFile", "")));
            } else {
                args.push("-jar".into());
                args.push(launch.string_or("jar", "server.jar"));
            }
            if !is_proxy(&t) {
                args.push("nogui".into());
            }
            progress(json!({ "stage": "Uruchamianie serwera" }));
            let mut c = tokio::process::Command::new(&bin);
            c.args(&args).current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
            #[cfg(windows)]
            c.creation_flags(0x0800_0000);
            let mut child = c.spawn().map_err(|e| msg(format!("Nie udało się uruchomić Javy: {e}")))?;
            let gen = self.server_gen.fetch_add(1, Ordering::SeqCst) + 1;
            let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
            if let Some(mut stdin) = child.stdin.take() {
                tokio::spawn(async move {
                    while let Some(l) = stdin_rx.recv().await {
                        if stdin.write_all(l.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                            break;
                        }
                    }
                });
            }
            let (kill_tx, kill_rx) = oneshot::channel::<()>();
            let (exit_tx, exit_rx) = watch::channel(false);
            let rt = ServerRt {
                gen,
                state: "starting".into(),
                players: vec![],
                log: VecDeque::new(),
                started: now_ms(),
                stopping: false,
                tps: Value::Null,
                quiet_until: 0,
                net: Value::Null,
                next_restart: None,
                pid: child.id(),
                stdin: stdin_tx,
                kill: Some(kill_tx),
                exited: exit_rx,
                timers: vec![],
                sched: vec![],
                tunnel: None,
                wait_save: None,
            };
            self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), rt);
            self.emit("server:state", json!({ "id": id, "state": "starting" }));
            {
                let me = self.clone();
                let s2 = srv.clone();
                let id2 = id.to_string();
                tokio::spawn(async move {
                    me.prepare_network(s2, gen).await;
                    if let Some(st) = me.rt_state(&id2) {
                        me.emit("server:state", json!({ "id": id2, "state": st }));
                    }
                });
            }
            self.server_schedule(id);
            let mut readers = Vec::new();
            for (s, name) in [
                (child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), "out"),
                (child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), "err"),
            ] {
                let Some(s) = s else { continue };
                let me = self.clone();
                let id2 = id.to_string();
                readers.push(tokio::spawn(async move {
                    let mut r = BufReader::new(s);
                    let mut buf = Vec::new();
                    loop {
                        buf.clear();
                        match r.read_until(b'\n', &mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {
                                let line = String::from_utf8_lossy(&buf).trim_end_matches(['\n', '\r']).to_string();
                                me.server_line(&id2, gen, &line, name);
                            }
                        }
                    }
                }));
            }
            let me = self.clone();
            let id2 = id.to_string();
            tokio::spawn(async move {
                let status = tokio::select! {
                    s = child.wait() => s,
                    Ok(()) = kill_rx => { let _ = child.kill().await; child.wait().await }
                };
                for r in readers {
                    let _ = r.await;
                }
                let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
                me.server_exited(&id2, gen, code).await;
                let _ = exit_tx.send(true);
            });
            Ok(json!(true))
        })
    }

    fn server_line(self: &Arc<Self>, id: &str, gen: u64, raw: &str, stream: &str) {
        static ANSI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*m").unwrap());
        static SAVED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)Saved the game|Saved the world").unwrap());
        let line = ANSI.replace_all(raw, "").to_string();
        let tps = tools::parse_tps(&line);
        let quiet = {
            let mut g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
            let Some(rt) = g.get_mut(id).filter(|r| r.gen == gen) else { return };
            if let Some(t) = &tps {
                let mut v = t.clone();
                v["at"] = json!(now_ms());
                rt.tps = v;
            }
            rt.quiet_until > now_ms()
        };
        if let Some(t) = &tps {
            let mut ev = json!({ "id": id });
            assign(&mut ev, t);
            ev["at"] = json!(now_ms());
            self.emit("server:tps", ev);
        }
        if quiet && (tps.is_some() || tools::is_tps_noise(&line)) {
            return;
        }
        self.server_log(id, &line, stream);
        let mut became_running = false;
        let mut players_changed = None;
        let mut save = None;
        {
            let mut g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
            let Some(rt) = g.get_mut(id).filter(|r| r.gen == gen) else { return };
            if rt.state == "starting" && tools::is_ready_line(&line) {
                rt.state = "running".into();
                became_running = true;
            }
            if let Some(ev) = tools::player_event(&line) {
                if let Some(j) = ev.str_of("join") {
                    if !rt.players.iter().any(|p| p == j) {
                        rt.players.push(j.into());
                    }
                }
                if let Some(l) = ev.str_of("leave") {
                    rt.players.retain(|p| p != l);
                }
                players_changed = Some((rt.state.clone(), rt.players.clone()));
            }
            if rt.wait_save.is_some() && SAVED.is_match(&line) {
                save = rt.wait_save.take();
            }
        }
        if became_running {
            self.emit("server:state", json!({ "id": id, "state": "running" }));
            self.start_tps_poll(id, gen);
            if let Some(s) = self.server_raw(id) {
                if is_proxy(&ty(&s)) {
                    self.write_proxy_port(&s);
                }
            }
        }
        if let Some((state, players)) = players_changed {
            self.emit("server:state", json!({ "id": id, "state": state, "players": players }));
        }
        if let Some(s) = save {
            let _ = s.send(());
        }
    }

    async fn server_exited(self: &Arc<Self>, id: &str, gen: u64, code: i32) {
        let rt = {
            let mut g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
            if g.get(id).is_some_and(|r| r.gen == gen) {
                g.remove(id)
            } else {
                None
            }
        };
        let Some(mut rt) = rt else { return };
        rt.abort_all();
        self.emit("server:state", json!({ "id": id, "state": "stopped", "code": code }));
        let s = self.server_raw(id);
        if let Some(s) = &s {
            if s.truthy_of("upnp") {
                let port = s["port"].as_u64().unwrap_or(25565) as u16;
                tokio::spawn(async move {
                    let _ = server_net::upnp_close(port).await;
                });
            }
        }
        // auto-restart after a crash (max 3 times in 10 minutes)
        if !rt.stopping && code != 0 && s.as_ref().is_some_and(|s| s.truthy_of("autoRestart")) {
            let now = now_ms();
            let n = {
                let mut r = self.server_restarts.lock().unwrap_or_else(|e| e.into_inner());
                let recent = r.entry(id.to_string()).or_default();
                recent.retain(|t| now - t < 600_000);
                if recent.len() < 3 {
                    recent.push(now);
                    Some(recent.len())
                } else {
                    None
                }
            };
            match n {
                Some(n) => {
                    self.emit(
                        "server:log",
                        json!({ "id": id, "line": format!("[Launcher] Serwer padł (kod {code}) – restart za 5 s ({n}/3)"), "stream": "err" }),
                    );
                    let me = self.clone();
                    let id2 = id.to_string();
                    tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        if !me.server_running(&id2) {
                            if let Err(e) = me.server_start(&id2, crate::no_progress()).await {
                                me.emit("server:log", json!({ "id": id2, "line": format!("[Launcher] {e}"), "stream": "err" }));
                            }
                        }
                    });
                }
                None => self.emit(
                    "server:log",
                    json!({ "id": id, "line": "[Launcher] Serwer padł 3 razy w 10 minut – automatyczny restart wstrzymany", "stream": "err" }),
                ),
            }
        }
    }

    fn start_tps_poll(self: &Arc<Self>, id: &str, gen: u64) {
        let Some(cmd) = self.server_raw(id).and_then(|s| tools::tps_command(&ty(&s))) else { return };
        let me = self.clone();
        let id2 = id.to_string();
        let h = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            loop {
                {
                    let mut g = me.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
                    let Some(rt) = g.get_mut(&id2).filter(|r| r.gen == gen) else { return };
                    if rt.state == "running" {
                        rt.quiet_until = now_ms() + 3000;
                        let _ = rt.stdin.send(format!("{cmd}\n"));
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(20)).await;
            }
        });
        self.add_timer(id, gen, h);
    }

    /// Scheduled daily restart (with in-game warnings) and periodic backups while the server runs.
    pub fn server_schedule(self: &Arc<Self>, id: &str) {
        let Some(s) = self.server_raw(id) else { return };
        let gen = {
            let mut g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
            let Some(rt) = g.get_mut(id) else { return };
            for t in rt.sched.drain(..) {
                t.abort();
            }
            rt.next_restart = None;
            rt.gen
        };
        let sch = tools::normalize_schedule(s.get("schedule").unwrap_or(&json!({})));
        let proxy = is_proxy(&ty(&s));
        let mut handles = Vec::new();
        if let Some(delay) = tools::ms_until(now_ms(), sch.str_of("restartAt").unwrap_or("")) {
            if let Some(rt) = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
                rt.next_restart = Some(now_ms() + delay);
            }
            for (before, text) in tools::restart_warnings(sch["warnMinutes"].as_i64().unwrap_or(5)) {
                if delay > before {
                    let me = self.clone();
                    let id2 = id.to_string();
                    handles.push(tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis((delay - before) as u64)).await;
                        if me.rt_is(&id2, gen) && me.rt_state(&id2).as_deref() == Some("running") {
                            let _ = me.server_command(&id2, &if proxy { format!("alert {text}") } else { format!("say {text}") });
                        }
                    }));
                }
            }
            let me = self.clone();
            let id2 = id.to_string();
            handles.push(tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay as u64)).await;
                if !me.rt_is(&id2, gen) {
                    return;
                }
                me.server_log(&id2, "[Launcher] Zaplanowany restart serwera", "cmd");
                let me2 = me.clone();
                tokio::spawn(async move {
                    if let Err(e) = me2.server_restart(&id2).await {
                        me2.server_log(&id2, &format!("[Launcher] Restart: {e}"), "err");
                    }
                });
            }));
        }
        let every = sch["backupEveryH"].as_u64().unwrap_or(0);
        if every > 0 && !proxy {
            let me = self.clone();
            let id2 = id.to_string();
            handles.push(tokio::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(every * 3600)).await;
                    if !me.rt_is(&id2, gen) {
                        return;
                    }
                    if me.rt_state(&id2).as_deref() != Some("running") {
                        continue;
                    }
                    match me.server_backup(&id2, "auto").await {
                        Ok(f) => me.server_log(&id2, &format!("[Launcher] Automatyczna kopia zapasowa: {}", f.as_str().unwrap_or("")), "cmd"),
                        Err(e) => me.server_log(&id2, &format!("[Launcher] Kopia zapasowa: {e}"), "err"),
                    }
                }
            }));
        }
        match self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
            Some(rt) if rt.gen == gen => rt.sched.extend(handles),
            _ => handles.iter().for_each(JoinHandle::abort),
        }
    }

    pub fn server_complete(&self, id: &str, text: &str, history: &Value) -> Value {
        let t = self.server_raw(id).map(|s| ty(&s)).unwrap_or_else(|| "paper".into());
        let players = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get(id).map(|r| r.players.clone()).unwrap_or_default();
        let h: Vec<String> =
            history.as_array().map(|a| a.iter().rev().take(50).rev().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
        json!(tools::complete(text, &t, &players, &h))
    }

    pub fn server_command(&self, id: &str, cmd: &str) -> Result<Value> {
        {
            let g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
            let rt = g.get(id).ok_or_else(|| msg("Serwer nie działa."))?;
            let _ = rt.stdin.send(format!("{}\n", cmd.strip_prefix('/').unwrap_or(cmd)));
        }
        self.server_log(id, &format!("> {cmd}"), "cmd");
        Ok(Value::Null)
    }

    pub fn server_stop(self: &Arc<Self>, id: &str) -> bool {
        let proxy = self.server_raw(id).is_some_and(|s| is_proxy(&ty(&s)));
        let gen = {
            let mut g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
            let Some(rt) = g.get_mut(id) else { return false };
            rt.state = "stopping".into();
            rt.stopping = true;
            let _ = rt.stdin.send(if proxy { "end\n".into() } else { "stop\n".into() });
            rt.gen
        };
        self.emit("server:state", json!({ "id": id, "state": "stopping" }));
        let me = self.clone();
        let id2 = id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            if let Some(rt) = me.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&id2) {
                if rt.gen == gen {
                    if let Some(k) = rt.kill.take() {
                        let _ = k.send(());
                    }
                }
            }
        });
        true
    }

    pub async fn server_restart(self: &Arc<Self>, id: &str) -> Result<Value> {
        let rx = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get(id).map(|r| r.exited.clone());
        let Some(mut rx) = rx else { return self.server_start(id, crate::no_progress()).await };
        self.server_stop(id);
        while !*rx.borrow() {
            if rx.changed().await.is_err() {
                break;
            }
        }
        self.server_start(id, crate::no_progress()).await
    }

    pub fn server_logs(&self, id: &str) -> Value {
        let g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
        let l: Vec<Value> = g.get(id).map(|r| r.log.iter().rev().take(1500).rev().cloned().collect()).unwrap_or_default();
        json!(l)
    }

    pub fn servers_stop_all(self: &Arc<Self>) {
        let ids: Vec<String> = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).keys().cloned().collect();
        for id in ids {
            self.server_stop(&id);
        }
    }

    /// Stops every server and waits until all saved and exited (or the timeout).
    pub async fn servers_stop_all_and_wait(self: &Arc<Self>, timeout: std::time::Duration) {
        let rxs: Vec<(String, watch::Receiver<bool>)> =
            self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).iter().map(|(k, r)| (k.clone(), r.exited.clone())).collect();
        if rxs.is_empty() {
            return;
        }
        self.servers_stop_all();
        let wait = futures::future::join_all(rxs.iter().map(|(_, rx)| {
            let mut rx = rx.clone();
            async move {
                while !*rx.borrow() {
                    if rx.changed().await.is_err() {
                        break;
                    }
                }
            }
        }));
        let _ = tokio::time::timeout(timeout, wait).await;
        let mut g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
        for rt in g.values_mut() {
            if let Some(k) = rt.kill.take() {
                let _ = k.send(());
            }
        }
    }

    /// RAM used by the server process (MB) and uptime.
    pub fn server_stats(&self, id: &str) -> Value {
        let g = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner());
        let Some(rt) = g.get(id) else { return Value::Null };
        let mem = rt.pid.and_then(|pid| {
            let mut s = sysinfo::System::new();
            let p = sysinfo::Pid::from_u32(pid);
            s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[p]), true);
            s.process(p).map(|pr| (pr.memory() as f64 / 1048576.0).round() as u64)
        });
        json!({ "memMb": mem, "uptime": now_ms() - rt.started, "players": rt.players.len(), "tps": rt.tps, "nextRestart": rt.next_restart })
    }

    fn read_list(&self, id: &str, which: &str) -> Value {
        list_file(which)
            .and_then(|f| std::fs::read_to_string(self.server_dir(id).join(f)).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .filter(Value::is_array)
            .unwrap_or(json!([]))
    }

    pub fn server_players(&self, id: &str) -> Value {
        let online = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get(id).map(|r| r.players.clone()).unwrap_or_default();
        json!({ "whitelist": self.read_list(id, "whitelist"), "ops": self.read_list(id, "ops"), "bans": self.read_list(id, "bans"), "online": online })
    }

    /// Adds or removes a player from a list: live commands while running, JSON files otherwise.
    pub async fn server_player_list(&self, id: &str, which: &str, action: &str, name: &str) -> Result<Value> {
        static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\w{3,16}$").unwrap());
        if !NAME.is_match(name) {
            return Err(msg("Nieprawidłowa nazwa gracza"));
        }
        let file = list_file(which).ok_or_else(|| msg("Nieznana lista"))?;
        let srv = self.server_raw(id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
        if self.server_running(id) {
            let add = action == "add";
            let cmd = match which {
                "whitelist" => format!("whitelist {} {name}", if add { "add" } else { "remove" }),
                "ops" => format!("{} {name}", if add { "op" } else { "deop" }),
                _ => format!("{} {name}", if add { "ban" } else { "pardon" }),
            };
            self.server_command(id, &cmd)?;
            return Ok(json!(true));
        }
        let mut list: Vec<Value> = self
            .read_list(id, which)
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|e| e.str_of("name").map(str::to_lowercase) != Some(name.to_lowercase()))
            .collect();
        if action == "add" {
            let uuid = if !srv.pointer("/props/online-mode").is_some_and(truthy) {
                offline_uuid(name)
            } else {
                let j: Value = self
                    .env
                    .net
                    .get_json(&format!("https://api.mojang.com/users/profiles/minecraft/{}", urlencoding::encode(name)))
                    .await
                    .map_err(|_| msg(format!("Nie ma konta premium o nazwie {name}")))?;
                let h = j.string_or("id", "");
                if h.len() == 32 {
                    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
                } else {
                    h
                }
            };
            let mut e = json!({ "uuid": uuid, "name": name });
            if which == "ops" {
                assign(&mut e, &json!({ "level": 4, "bypassesPlayerLimit": false }));
            }
            if which == "bans" {
                let created = format!("{} +0000", util::iso_now().replace('T', " ").chars().take(19).collect::<String>());
                assign(&mut e, &json!({ "created": created, "source": "Nore Launcher", "expires": "forever", "reason": "Zbanowany" }));
            }
            list.push(e);
        }
        std::fs::write(self.server_dir(id).join(file), crate::config_edit::pretty(&json!(list), "  "))?;
        Ok(json!(true))
    }

    fn backup_dir(&self, id: &str) -> PathBuf {
        self.server_dir(id).join("backups")
    }

    pub async fn server_backup(&self, id: &str, label: &str) -> Result<Value> {
        let srv = self.server_raw(id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
        let base = self.server_dir(id);
        let world = world_name(&srv);
        let folders: Vec<String> =
            [world.clone(), format!("{world}_nether"), format!("{world}_the_end")].into_iter().filter(|f| base.join(f).exists()).collect();
        if folders.is_empty() {
            return Err(msg("Świat jeszcze nie istnieje – uruchom serwer choć raz."));
        }
        let running = self.server_running(id);
        if running {
            self.server_command(id, "save-off")?;
            let (tx, rx) = oneshot::channel();
            if let Some(rt) = self.servers_rt.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
                rt.wait_save = Some(tx);
            }
            self.server_command(id, "save-all flush")?;
            let _ = tokio::time::timeout(std::time::Duration::from_secs(8), rx).await;
        }
        let r = async {
            tokio::fs::create_dir_all(self.backup_dir(id)).await?;
            let file = self.backup_dir(id).join(format!("{label}-{}.zip", util::stamp_dash(19)));
            let (b, f2, fo) = (base.clone(), file.clone(), folders.clone());
            util::blocking(move || util::zip_folders(&b, &fo, &f2, |n| n.ends_with("session.lock"))).await?;
            let keep = srv["backupKeep"].as_u64().filter(|k| *k > 0).unwrap_or(10) as usize;
            for old in self.server_list_backups(id).as_array().into_iter().flatten().skip(keep) {
                let _ = tokio::fs::remove_file(self.backup_dir(id).join(old.str_of("file").unwrap_or(""))).await;
            }
            Ok(json!(file.file_name().map(|n| n.to_string_lossy().to_string())))
        }
        .await;
        if running && self.server_running(id) {
            let _ = self.server_command(id, "save-on");
        }
        r
    }

    pub fn server_list_backups(&self, id: &str) -> Value {
        let dir = self.backup_dir(id);
        let mut out: Vec<Value> = util::read_dir_names(&dir)
            .into_iter()
            .filter(|f| f.ends_with(".zip"))
            .filter_map(|f| {
                let m = std::fs::metadata(dir.join(&f)).ok()?;
                Some(json!({ "file": f, "size": m.len(), "created": util::mtime_ms(&m), "auto": f.starts_with("auto-") }))
            })
            .collect();
        out.sort_by(|a, b| b.num_of("created").partial_cmp(&a.num_of("created")).unwrap_or(std::cmp::Ordering::Equal));
        json!(out)
    }

    pub async fn server_restore_backup(&self, id: &str, file: &str) -> Result<Value> {
        if self.server_running(id) {
            return Err(msg("Zatrzymaj serwer przed przywróceniem kopii."));
        }
        let srv = self.server_raw(id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
        let base = self.server_dir(id);
        let zip_path = self.backup_dir(id).join(util::basename(file));
        let world = world_name(&srv);
        util::blocking(move || {
            let mut zip = Zip::open(&zip_path)?;
            let names = zip.names();
            if names.iter().any(|n| util::inside(&base, n).is_none()) {
                return Err(msg("Nieprawidłowa kopia zapasowa"));
            }
            for f in [world.clone(), format!("{world}_nether"), format!("{world}_the_end")] {
                let _ = std::fs::remove_dir_all(base.join(f));
            }
            for n in names {
                let Some(dest) = util::inside(&base, &n) else { continue };
                let Some(data) = zip.read(&n) else { continue };
                if let Some(d) = dest.parent() {
                    std::fs::create_dir_all(d)?;
                }
                std::fs::write(dest, data)?;
            }
            Ok(())
        })
        .await?;
        Ok(json!(true))
    }

    pub async fn server_delete_backup(&self, id: &str, file: &str) -> Value {
        let _ = tokio::fs::remove_file(self.backup_dir(id).join(util::basename(file))).await;
        Value::Null
    }

    pub async fn server_reset_world(self: &Arc<Self>, id: &str, seed: &Value) -> Result<Value> {
        if self.server_running(id) {
            return Err(msg("Zatrzymaj serwer."));
        }
        let srv = self.server_raw(id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
        let world = world_name(&srv);
        for f in [world.clone(), format!("{world}_nether"), format!("{world}_the_end")] {
            let _ = tokio::fs::remove_dir_all(self.server_dir(id).join(f)).await;
        }
        if !seed.is_null() {
            self.server_update(id, &json!({ "props": { "level-seed": seed } }))?;
        }
        Ok(Value::Null)
    }
}

/// NeoForge versions for a Minecraft version.
async fn neoforge_versions(env: &Env, mc: &str) -> Result<Vec<String>> {
    let all: Value = env.net.get_json("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge").await?;
    let p: Vec<&str> = mc.split('.').collect();
    let prefix = if p.first() == Some(&"1") {
        format!("{}.{}.", p.get(1).unwrap_or(&"0"), p.get(2).unwrap_or(&"0"))
    } else {
        format!("{}.{}.{}.", p[0], p.get(1).unwrap_or(&"0"), p.get(2).unwrap_or(&"0"))
    };
    Ok(all["versions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|v| v.starts_with(&prefix) && !v.to_lowercase().contains("snapshot"))
        .map(String::from)
        .collect())
}

/// Velocity version to install: (version, url, size).
async fn velocity_build(env: &Env, wanted: Option<&str>) -> Result<(String, String, Option<u64>)> {
    let proj: Value = env.net.get_json("https://fill.papermc.io/v3/projects/velocity").await?;
    let all: Vec<String> = proj["versions"]
        .as_object()
        .into_iter()
        .flatten()
        .flat_map(|(_, v)| v.as_array().cloned().unwrap_or_default())
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    let order: Vec<String> = match wanted {
        Some(w) => vec![w.to_string()],
        None => {
            let snap = |v: &String| v.to_uppercase().contains("SNAPSHOT");
            all.iter().filter(|v| !snap(v)).chain(all.iter().filter(|v| snap(v))).cloned().collect()
        }
    };
    for v in order.iter().take(6) {
        let builds: Vec<Value> =
            env.net.get_json(&format!("https://fill.papermc.io/v3/projects/velocity/versions/{}/builds", urlencoding::encode(v))).await.unwrap_or_default();
        let b = builds.iter().find(|x| x.str_of("channel") == Some("STABLE")).or(builds.first());
        if let Some(f) = b.and_then(|b| b.pointer("/downloads/server:default")).filter(|f| f.is_object()) {
            return Ok((v.clone(), f.string_or("url", ""), f["size"].as_u64()));
        }
    }
    Err(msg("Nie udało się znaleźć wersji Velocity do pobrania."))
}

async fn run_installer(bin: &Path, installer: &str, cwd: &Path, progress: &ProgressFn, args: &[&str]) -> Result<()> {
    let mut c = tokio::process::Command::new(bin);
    c.arg("-jar").arg(installer).args(args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    let mut child = c.spawn()?;
    let last = Arc::new(std::sync::Mutex::new(String::new()));
    let mut readers = Vec::new();
    for s in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let (last, progress) = (last.clone(), progress.clone());
        readers.push(tokio::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let l = l.trim().to_string();
                if l.is_empty() {
                    continue;
                }
                *last.lock().unwrap_or_else(|e| e.into_inner()) = l.clone();
                progress(json!({ "stage": format!("Instalator: {}", l.chars().take(90).collect::<String>()) }));
            }
        }));
    }
    let status = child.wait().await?;
    for r in readers {
        let _ = r.await;
    }
    if !status.success() {
        return Err(msg(format!("Instalator zakończył się błędem: {}", last.lock().unwrap_or_else(|e| e.into_inner()))));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_uuids_match_minecraft() {
        // the same algorithm as auth.rs / servers.js (UUID v3 of "OfflinePlayer:<name>")
        assert_eq!(offline_uuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f");
        assert_eq!(component_major("java-runtime-delta"), Some(21));
        assert!(is_proxy("velocity") && !is_proxy("paper"));
    }
}
