//! The phase 2 channels of main.js / ipc-mods.js: content (Modrinth + CurseForge), the mod
//! manager, modpacks, performance mods, crash repair, the gallery and local servers.

use crate::curseforge::{self, Cf};
use crate::error::{msg, Result};
use crate::ipc::{arg, arg_str, App};
use crate::js::{assign, now_ms, truthy, ValueExt};
use crate::modrinth::{self, InstallReq};
use crate::{
    doctor, gallery, hangar, importers, mod_manager as mm, modpacks, perf, server_cf, server_content as sc, server_net, server_props, server_tunnel, util,
    ProgressFn,
};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Folder, owner and storage of a mod manager target (`{ instanceId }` or `{ serverId, kind }`).
struct Target {
    kind: String,
    dir: PathBuf,
    root: PathBuf,
    loader: String,
    server: bool,
    title: String,
    mc: String,
    pins: Vec<Value>,
    profiles: Vec<Value>,
    all_profiles: Vec<Value>,
    id: String,
}

impl App {
    pub(crate) fn cf(&self) -> Cf {
        let k = self.store.read(|d| d.pointer("/settings/curseforgeKey").cloned().unwrap_or(Value::Null));
        Cf::new(self.decrypt_token(&k))
    }

    fn update_channel(&self) -> String {
        self.store.settings().string_or("updateChannel", "all")
    }

    fn target(&self, t: &Value) -> Result<Target> {
        if let Some(iid) = t.str_of("instanceId").filter(|s| !s.is_empty()) {
            let i = self.instances().require(iid)?;
            let root = PathBuf::from(i.string_or("gameDir", ""));
            let profiles = i["modProfiles"].as_array().cloned().unwrap_or_default();
            return Ok(Target {
                kind: "mod".into(),
                dir: root.join("mods"),
                root,
                loader: i.string_or("loader", ""),
                server: false,
                title: i.string_or("name", ""),
                mc: i.string_or("mcVersion", ""),
                pins: i["modPins"].as_array().cloned().unwrap_or_default(),
                all_profiles: profiles.clone(),
                profiles,
                id: iid.into(),
            });
        }
        let sid = t.string_or("serverId", "");
        let s = self.server_get(&sid).ok_or_else(|| msg("Nie znaleziono serwera."))?;
        let kind = if t.str_of("kind") == Some("plugin") { "plugin" } else { "mod" };
        let all = s["modProfiles"].as_array().cloned().unwrap_or_default();
        Ok(Target {
            kind: kind.into(),
            dir: sc::folder_of(&s, kind),
            root: sc::dir_of(&s),
            loader: s.string_or("type", ""),
            server: true,
            title: s.string_or("name", ""),
            mc: s.string_or("mcVersion", ""),
            pins: s["modPins"].as_array().cloned().unwrap_or_default(),
            profiles: all.iter().filter(|p| p.str_of("kind").unwrap_or("mod") == kind).cloned().collect(),
            all_profiles: all,
            id: sid,
        })
    }

    fn target_save(self: &Arc<Self>, tg: &Target, patch: Value) -> Result<()> {
        if tg.server {
            self.server_update(&tg.id, &patch)?;
        } else {
            self.instances().update(&tg.id, &patch)?;
        }
        Ok(())
    }

    async fn target_list(&self, tg: &Target, ids: &Map<String, Value>) -> Value {
        let loader = (!tg.loader.is_empty()).then_some(tg.loader.as_str());
        mm::list(&tg.dir, tg.server, loader, &tg.pins, ids).await
    }

    fn save_profiles(self: &Arc<Self>, tg: &Target, list: &[Value]) -> Result<()> {
        if tg.server {
            let mut all: Vec<Value> = tg.all_profiles.iter().filter(|p| p.str_of("kind").unwrap_or("mod") != tg.kind).cloned().collect();
            all.extend(list.iter().map(|p| {
                let mut p = p.clone();
                p["kind"] = json!(tg.kind);
                p
            }));
            self.target_save(tg, json!({ "modProfiles": all }))
        } else {
            self.target_save(tg, json!({ "modProfiles": list }))
        }
    }

    fn status_fn(&self, project: &str) -> impl Fn(String) + Send + Sync + 'static {
        let e = self.emitter.clone();
        let p = project.to_string();
        move |s: String| e.emit("content:status", json!({ "projectId": p, "status": s }))
    }

    fn server_status_fn(&self, id: &str) -> impl Fn(String) + Send + Sync + 'static {
        let e = self.emitter.clone();
        let id = id.to_string();
        move |s: String| e.emit("server:progress", json!({ "id": id, "stage": s }))
    }

    fn server_progress_fn(&self, id: &str) -> ProgressFn {
        let e = self.emitter.clone();
        let id = id.to_string();
        Arc::new(move |p: Value| {
            let mut v = json!({ "id": id });
            assign(&mut v, &p);
            e.emit("server:progress", v)
        })
    }

    // ---------------------------------------------------------------- content updates (background)

    pub(crate) fn updates_state(&self) -> Value {
        let ids: HashSet<String> = self.instances().list().iter().map(|i| i.string_or("id", "")).collect();
        let cu = self.content_updates.lock().unwrap_or_else(|e| e.into_inner());
        Value::Object(cu.iter().filter(|(k, _)| ids.contains(*k)).map(|(k, v)| (k.clone(), v.clone())).collect())
    }

    fn set_instance_updates(&self, id: &str, v: Value) {
        self.content_updates.lock().unwrap_or_else(|e| e.into_inner()).insert(id.into(), v);
        self.emit("content:updatesState", self.updates_state());
    }

    /// Updates of files a modpack brought are left to the modpack itself; pinned mods never update.
    fn without_pack_files(&self, inst: &Value, kind: &str, ups: Vec<Value>) -> Vec<Value> {
        match modpacks::pack_file_set(inst) {
            None => {
                if inst.str_of("modpack") == Some("pack") {
                    vec![]
                } else {
                    self.without_pinned_mods(inst, kind, ups)
                }
            }
            Some(set) => {
                let folder = modrinth::folder_of(kind).unwrap_or("mods");
                let ups = ups.into_iter().filter(|u| !set.contains(&format!("{folder}/{}", u.str_of("oldFile").unwrap_or("")))).collect();
                self.without_pinned_mods(inst, kind, ups)
            }
        }
    }

    fn without_pinned_mods(&self, inst: &Value, kind: &str, ups: Vec<Value>) -> Vec<Value> {
        let pins = inst["modPins"].as_array().cloned().unwrap_or_default();
        if kind != "mod" || pins.is_empty() {
            return ups;
        }
        let dir = PathBuf::from(inst.string_or("gameDir", "")).join("mods");
        mm::without_pinned(ups, &pins, |f| mm::mod_key(f, crate::mod_meta::read_jar(&dir.join(f)).as_ref()))
    }

    async fn check_instance_updates(&self, inst: &Value) -> Value {
        let channel = self.update_channel();
        let pause = || tokio::time::sleep(std::time::Duration::from_millis(400));
        let mut out = json!({ "pack": null, "mods": 0, "resourcepacks": 0, "shaders": 0, "checked": now_ms() });
        if inst.str_of("modpack") == Some("pack") && truthy(&inst.pointer("/pack/projectId").cloned().unwrap_or(Value::Null)) {
            if let Ok(up) = self.modpacks_ctx().check_update(inst, &channel).await {
                out["pack"] = up;
            }
            pause().await;
        }
        let game = PathBuf::from(inst.string_or("gameDir", ""));
        let loader = inst.string_or("loader", "");
        let mc = inst.string_or("mcVersion", "");
        let cf = self.cf();
        for (kind, key) in [("mod", "mods"), ("resourcepack", "resourcepacks"), ("shader", "shaders")] {
            if kind == "mod" && (loader.is_empty() || loader == "vanilla") {
                continue;
            }
            let dir = game.join(modrinth::folder_of(kind).unwrap_or("mods"));
            if !dir.exists() {
                continue;
            }
            if let Ok(ups) = modrinth::check_updates(&self.env, &dir, kind, &mc, &loader, &channel).await {
                out[key] = json!(self.without_pack_files(inst, kind, ups).len());
            }
            pause().await;
            let pack_set = modpacks::pack_file_set(inst);
            if pack_set.as_ref().is_some_and(|s| !s.is_empty()) || inst.str_of("modpack") != Some("pack") || pack_set.is_some() {
                let folder = modrinth::folder_of(kind).unwrap_or("mods");
                let mut skip: HashSet<String> =
                    modrinth::identify(&self.env, &dir, modrinth::exts_of(kind)).await.unwrap_or_default().keys().cloned().collect();
                for rel in pack_set.iter().flatten() {
                    if let Some(r) = rel.strip_prefix(&format!("{folder}/")) {
                        skip.insert(r.into());
                    }
                }
                if let Ok(cf_ups) = cf.check_updates(&self.env, &dir, kind, &mc, &loader, &modrinth::channel_types(&channel), &skip).await {
                    let n = out[key].as_u64().unwrap_or(0) + self.without_pack_files(inst, kind, cf_ups).len() as u64;
                    out[key] = json!(n);
                }
                pause().await;
            }
        }
        out
    }

    pub(crate) fn recheck_instance(self: &Arc<Self>, id: &str) {
        let Some(inst) = self.instances().get(id) else { return };
        if self.store.settings().get("notifyContentUpdates") == Some(&json!(false)) {
            return;
        }
        let me = self.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            let r = me.check_instance_updates(&inst).await;
            me.set_instance_updates(&id, r);
        });
    }

    pub(crate) async fn check_all_updates(self: &Arc<Self>) -> Value {
        let _one = self.updates_running.lock().await;
        for inst in self.instances().list() {
            let r = self.check_instance_updates(&inst).await;
            self.content_updates.lock().unwrap_or_else(|e| e.into_inner()).insert(inst.string_or("id", ""), r);
        }
        let state = self.updates_state();
        *self.content_updates.lock().unwrap_or_else(|e| e.into_inner()) = state.as_object().cloned().unwrap_or_default();
        self.emit("content:updatesState", state.clone());
        state
    }

    /// First check after `delay`, then every 6 h (when notifications are on); never while playing.
    pub(crate) fn schedule_update_checks(self: &Arc<Self>, delay: std::time::Duration) {
        let me = Arc::downgrade(self);
        let h = tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            loop {
                let Some(app) = me.upgrade() else { return };
                if app.running_id().is_some() {
                    drop(app);
                    tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                    continue;
                }
                if app.store.settings().get("notifyContentUpdates") != Some(&json!(false)) {
                    app.check_all_updates().await;
                } else {
                    app.content_updates.lock().unwrap_or_else(|e| e.into_inner()).clear();
                    app.emit("content:updatesState", json!({}));
                }
                drop(app);
                tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
            }
        });
        if let Some(old) = self.updates_timer.lock().unwrap_or_else(|e| e.into_inner()).replace(h) {
            old.abort();
        }
    }

    pub(crate) fn modpacks_ctx(&self) -> modpacks::Ctx<'_> {
        modpacks::Ctx { env: &self.env, insts: self.instances(), cf: self.cf() }
    }

    /// Installs a modpack as a new instance, then downloads the game + loader.
    async fn install_pack(self: &Arc<Self>, run: impl std::future::Future<Output = Result<Value>>) -> Result<Value> {
        let inst = run.await?;
        let id = inst.string_or("id", "");
        self.store.update(|d| d["selectedInstance"] = json!(id))?;
        let settings = self.store.settings();
        let e = self.emitter.clone();
        let p: ProgressFn = Arc::new(move |mut v| {
            v["phase"] = json!("game");
            e.emit("modpack:progress", v)
        });
        let fresh = self.instances().require(&id)?;
        if let Err(err) = self.prepare_game(&fresh, &settings, p).await {
            self.log(format!("[Launcher] Paczka zainstalowana, ale pobieranie gry nie powiodło się: {err}"), "err");
            return Ok(json!({ "instance": self.instances().get(&id), "warning": err.to_string() }));
        }
        Ok(json!({ "instance": self.instances().get(&id) }))
    }

    fn modpack_progress(&self) -> impl Fn(Value) + Send + Sync + 'static {
        let e = self.emitter.clone();
        move |v: Value| e.emit("modpack:progress", v)
    }

    // ---------------------------------------------------------------- servers helpers

    /// Installs / updates a modpack on a stopped server; the world is backed up first.
    async fn server_modpack<F, Fut>(self: &Arc<Self>, id: &str, run: F) -> Result<Value>
    where
        F: FnOnce(Value) -> Fut,
        Fut: std::future::Future<Output = Result<Value>>,
    {
        let r = async {
            let srv = self.server_require(id)?;
            if srv.str_of("state") != Some("stopped") {
                return Err(msg("Zatrzymaj serwer przed instalacją paczki."));
            }
            let world = srv.pointer("/props/level-name").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("world").to_string();
            if sc::dir_of(&srv).join(&world).exists() {
                self.emit("server:progress", json!({ "id": id, "stage": "Kopia zapasowa świata" }));
                self.server_backup(id, "modpack").await?;
            }
            let r = run(srv).await?;
            let mut patch = Map::new();
            if truthy(&r["mcVersion"]) {
                patch.insert("mcVersion".into(), r["mcVersion"].clone());
            }
            if truthy(&r["type"]) {
                patch.insert("type".into(), r["type"].clone());
            }
            if r.get("loaderVersion").is_some() {
                patch.insert("loaderVersion".into(), r["loaderVersion"].clone());
            }
            if truthy(&r["pack"]) {
                let mut p = json!({ "source": "modrinth" });
                assign(&mut p, &r["pack"]);
                patch.insert("pack".into(), p);
            }
            self.server_update(id, &Value::Object(patch))?;
            Ok(r)
        }
        .await;
        self.emit("server:progress", json!({ "id": id, "done": true }));
        r
    }

    fn is_cf_pack_file(f: &Path) -> bool {
        f.to_string_lossy().to_lowercase().ends_with(".zip") && curseforge::read_manifest(f).is_some()
    }

    async fn add_server_files(self: &Arc<Self>, id: &str, files: Vec<PathBuf>) -> Result<Value> {
        let files: Vec<PathBuf> = files.into_iter().filter(|f| f.is_file()).collect();
        let mut out = json!({ "added": [], "pack": null });
        let cf = self.cf();
        for f in &files {
            let lower = f.to_string_lossy().to_lowercase();
            let status = self.server_status_fn(id);
            if lower.ends_with(".mrpack") {
                let src = json!({ "file": f.to_string_lossy() });
                let env = self.env.clone();
                out["pack"] = self.server_modpack(id, |srv| async move { sc::install_modpack(&env, &srv, &src, &status).await }).await?;
            } else if lower.ends_with(".zip") && Self::is_cf_pack_file(f) {
                let src = json!({ "file": f.to_string_lossy() });
                let (env, cf) = (self.env.clone(), cf.clone());
                out["pack"] = self.server_modpack(id, |srv| async move { server_cf::install_modpack(&env, &cf, &srv, &src, &status).await }).await?;
            } else if lower.ends_with(".zip") && sc::is_server_pack(f) {
                let f2 = f.clone();
                let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                out["pack"] = self
                    .server_modpack(id, |srv| async move {
                        let mut r = sc::install_server_pack(&srv, &f2, &status).await?;
                        r["name"] = json!(name);
                        Ok(r)
                    })
                    .await?;
            }
        }
        let rest: Vec<PathBuf> = files.into_iter().filter(|f| !f.to_string_lossy().to_lowercase().ends_with(".mrpack") && !Self::is_cf_pack_file(f)).collect();
        out["added"] = json!(sc::add_files(&self.server_require(id)?, &rest).await?);
        Ok(out)
    }

    /// Answers a phase 2 channel; None when the channel is not one of them.
    pub(crate) async fn invoke_more(self: &Arc<Self>, channel: &str, a: &[Value]) -> Result<Option<Value>> {
        let env = &self.env;
        Ok(Some(match channel {
            // ------------------------------------------------------------ content
            "content:search" => {
                let o = arg(a, 0);
                if o.str_of("source") == Some("curseforge") {
                    self.cf().search(env, &o).await?
                } else {
                    modrinth::search(env, &o).await?
                }
            }
            "content:details" => {
                let id = arg_str(a, 0);
                if curseforge::is_cf(&id) {
                    self.cf().details(env, &id).await?
                } else {
                    modrinth::details(env, &id).await?
                }
            }
            "content:project" => {
                let id = arg_str(a, 0);
                if curseforge::is_cf(&id) {
                    self.cf().project(env, &id).await?
                } else {
                    modrinth::project(env, &id).await?
                }
            }
            "content:categories" => {
                if arg_str(a, 1) == "curseforge" {
                    self.cf().categories(env, &arg_str(a, 0)).await?
                } else {
                    modrinth::categories(env, &arg_str(a, 0)).await?
                }
            }
            "content:identify" => {
                let o = arg(a, 0);
                let kind = o.string_or("kind", "mod");
                let world = o.str_of("world");
                let Some(inst) = self.instances().get(o.str_of("instanceId").unwrap_or("")) else { return Ok(Some(json!({}))) };
                if kind == "datapack" && world.is_none_or(str::is_empty) {
                    return Ok(Some(json!({})));
                }
                let dir = modrinth::content_dir(Path::new(&inst.string_or("gameDir", "")), &kind, world)?;
                let mr = modrinth::identify(env, &dir, modrinth::exts_of(&kind)).await.unwrap_or_default();
                let skip: HashSet<String> = mr.keys().cloned().collect();
                let mut out = self.cf().identify(env, &dir, modrinth::exts_of(&kind), &skip).await.unwrap_or_default();
                out.extend(mr);
                Value::Object(out)
            }
            "content:install" => {
                let o = arg(a, 0);
                let inst = self.instances().get(o.str_of("instanceId").unwrap_or("")).ok_or_else(|| msg("Wybierz instancję."))?;
                let kind = o.string_or("kind", "mod");
                let loader = inst.str_of("loader").filter(|l| !l.is_empty() && *l != "vanilla").map(String::from);
                if kind == "mod" && loader.is_none() {
                    return Err(msg("Mody wymagają instancji z loaderem (Fabric, Quilt, Forge albo NeoForge)."));
                }
                let pid = crate::config_edit::js_string(&o["projectId"]);
                let req = InstallReq {
                    project_id: pid.clone(),
                    kind: kind.clone(),
                    game_version: inst.str_of("mcVersion").map(String::from),
                    loader,
                    target_dir: modrinth::content_dir(Path::new(&inst.string_or("gameDir", "")), &kind, o.str_of("world"))?,
                    version_id: o.get("versionId").filter(|v| truthy(v)).map(crate::config_edit::js_string),
                };
                let status = self.status_fn(&pid);
                let files = if curseforge::is_cf(&pid) {
                    self.cf().install(env, req, &status, &mut HashSet::new(), &mut Default::default()).await?
                } else {
                    modrinth::install(env, req, &status, &mut HashSet::new(), &mut Default::default()).await?
                };
                json!(files)
            }
            "content:installed" => {
                let o = arg(a, 0);
                let kind = o.string_or("kind", "mod");
                let Some(inst) = self.instances().get(o.str_of("instanceId").unwrap_or("")) else { return Ok(Some(json!([]))) };
                if kind == "datapack" && o.str_of("world").is_none_or(str::is_empty) {
                    return Ok(Some(json!([])));
                }
                modrinth::list_installed(&modrinth::content_dir(Path::new(&inst.string_or("gameDir", "")), &kind, o.str_of("world"))?, modrinth::exts_of(&kind))
                    .await
            }
            "content:updates" => {
                let o = arg(a, 0);
                let inst = self.instances().require(o.str_of("instanceId").unwrap_or(""))?;
                let kind = o.string_or("kind", "mod");
                let dir = modrinth::content_dir(Path::new(&inst.string_or("gameDir", "")), &kind, o.str_of("world"))?;
                let channel = self.update_channel();
                let mut ups =
                    modrinth::check_updates(env, &dir, &kind, inst.str_of("mcVersion").unwrap_or(""), inst.str_of("loader").unwrap_or(""), &channel).await?;
                if kind != "datapack" {
                    let known: HashSet<String> = modrinth::identify(env, &dir, modrinth::exts_of(&kind)).await.unwrap_or_default().keys().cloned().collect();
                    ups.extend(
                        self.cf()
                            .check_updates(
                                env,
                                &dir,
                                &kind,
                                inst.str_of("mcVersion").unwrap_or(""),
                                inst.str_of("loader").unwrap_or(""),
                                &modrinth::channel_types(&channel),
                                &known,
                            )
                            .await
                            .unwrap_or_default(),
                    );
                }
                json!(if o.truthy_of("skipPack") { self.without_pack_files(&inst, &kind, ups) } else { self.without_pinned_mods(&inst, &kind, ups) })
            }
            "content:applyUpdates" => {
                let o = arg(a, 0);
                let id = o.string_or("instanceId", "");
                let inst = self.instances().require(&id)?;
                let game = PathBuf::from(inst.string_or("gameDir", ""));
                let dir = modrinth::content_dir(&game, o.str_of("kind").unwrap_or("mod"), o.str_of("world"))?;
                let ups = o["updates"].as_array().cloned().unwrap_or_default();
                let n = modrinth::apply_updates(env, &dir, &ups, Some(&game)).await?;
                modpacks::remap_pack_files(&self.instances(), &inst, &dir, &ups);
                self.recheck_instance(&id);
                json!(n)
            }
            "content:toggle" => {
                let o = arg(a, 0);
                let inst = self.instances().require(o.str_of("instanceId").unwrap_or(""))?;
                let dir = modrinth::content_dir(Path::new(&inst.string_or("gameDir", "")), o.str_of("kind").unwrap_or("mod"), o.str_of("world"))?;
                let file = util::basename(o.str_of("file").unwrap_or(""));
                let target = match file.strip_suffix(".disabled") {
                    Some(b) => b.to_string(),
                    None => format!("{file}.disabled"),
                };
                tokio::fs::rename(dir.join(&file), dir.join(&target)).await?;
                json!(target)
            }
            "content:delete" => {
                let o = arg(a, 0);
                let inst = self.instances().require(o.str_of("instanceId").unwrap_or(""))?;
                let dir = modrinth::content_dir(Path::new(&inst.string_or("gameDir", "")), o.str_of("kind").unwrap_or("mod"), o.str_of("world"))?;
                let p = dir.join(util::basename(o.str_of("file").unwrap_or("")));
                if p.is_dir() {
                    let _ = tokio::fs::remove_dir_all(&p).await;
                } else {
                    let _ = tokio::fs::remove_file(&p).await;
                }
                json!(true)
            }
            "content:updatesState" => self.updates_state(),
            "content:checkAll" => self.check_all_updates().await,
            "curseforge:status" => json!({ "available": true, "own": self.store.read(|d| d.pointer("/settings/curseforgeKey").is_some_and(truthy)) }),
            "curseforge:setKey" => {
                let k = arg_str(a, 0).trim().to_string();
                if !k.is_empty() {
                    self.cf().test_key(env, &k).await?;
                }
                let sealed = if k.is_empty() { json!("") } else { self.encrypt_token(&k) };
                self.store.update(|d| d["settings"]["curseforgeKey"] = sealed)?;
                json!(true)
            }

            // ------------------------------------------------------------ mod manager
            "mods:list" | "mods:identify" => {
                let tg = self.target(&arg(a, 0))?;
                let ids = if channel == "mods:identify" {
                    let mr = modrinth::identify(env, &tg.dir, &[".jar"]).await.unwrap_or_default();
                    let skip: HashSet<String> = mr.keys().cloned().collect();
                    let mut m = self.cf().identify(env, &tg.dir, &[".jar"], &skip).await.unwrap_or_default();
                    m.extend(mr);
                    m
                } else {
                    Map::new()
                };
                let mut r = self.target_list(&tg, &ids).await;
                assign(&mut r, &json!({ "dir": tg.dir.to_string_lossy(), "profiles": tg.profiles, "kind": tg.kind, "server": tg.server }));
                r
            }
            "mods:toggle" => json!(mm::set_enabled(&self.target(&arg(a, 0))?.dir, &arg_str(a, 1), truthy(&arg(a, 2))).await?),
            "mods:bulk" => {
                let tg = self.target(&arg(a, 0))?;
                let action = arg_str(a, 2);
                if !["enable", "disable", "remove"].contains(&action.as_str()) {
                    return Err(msg("Nieznana akcja"));
                }
                let files: Vec<String> = arg(a, 1).as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
                let backup = (action == "remove").then(|| {
                    tg.root.join(".nore-backup").join(format!("usuniete-{}", util::stamp_dash(19))).join(if tg.kind == "plugin" { "plugins" } else { "mods" })
                });
                json!(mm::bulk(&tg.dir, &files, &action, backup.as_deref()).await)
            }
            "mods:pin" => {
                let tg = self.target(&arg(a, 0))?;
                let pins = mm::toggle_pin(&tg.pins, &arg_str(a, 1), truthy(&arg(a, 2)));
                self.target_save(&tg, json!({ "modPins": pins }))?;
                json!(pins)
            }
            "mods:saveProfile" => {
                let tg = self.target(&arg(a, 0))?;
                let r = self.target_list(&tg, &Map::new()).await;
                let list = mm::upsert_profile(&tg.profiles, mm::make_profile(&arg_str(a, 1), r["mods"].as_array().map(Vec::as_slice).unwrap_or(&[])));
                self.save_profiles(&tg, &list)?;
                json!(list)
            }
            "mods:applyProfile" => {
                let tg = self.target(&arg(a, 0))?;
                let name = arg_str(a, 1);
                let p = tg.profiles.iter().find(|x| x.str_of("name") == Some(&name)).cloned().ok_or_else(|| msg("Nie ma takiego profilu."))?;
                let r = self.target_list(&tg, &Map::new()).await;
                let changed = mm::apply_profile(&tg.dir, r["mods"].as_array().map(Vec::as_slice).unwrap_or(&[]), &p).await;
                if !tg.server {
                    self.target_save(&tg, json!({ "modProfile": name }))?;
                }
                json!({ "changed": changed })
            }
            "mods:deleteProfile" => {
                let tg = self.target(&arg(a, 0))?;
                let name = arg_str(a, 1);
                let list: Vec<Value> = tg.profiles.iter().filter(|p| p.str_of("name") != Some(&name)).cloned().collect();
                self.save_profiles(&tg, &list)?;
                json!(list)
            }
            "mods:modlist" | "mods:saveModlist" => {
                let tg = self.target(&arg(a, 0))?;
                let fmt = if arg_str(a, 1) == "md" { "md" } else { "txt" };
                let r = self.target_list(&tg, &Map::new()).await;
                let text = mm::modlist(r["mods"].as_array().map(Vec::as_slice).unwrap_or(&[]), fmt, &tg.title, &tg.mc, &tg.loader);
                if channel == "mods:modlist" {
                    json!(text)
                } else {
                    let safe = regex::Regex::new(r#"[\\/:*?"<>|]+"#).unwrap().replace_all(&tg.title, "_").to_string();
                    let Some(path) = self
                        .shell
                        .save_file("Zapisz listę modów", &format!("{safe} – mody.{fmt}"), if fmt == "md" { "Markdown" } else { "Tekst" }, &[fmt])
                        .await
                    else {
                        return Ok(Some(Value::Null));
                    };
                    tokio::fs::write(&path, text).await?;
                    json!(path.to_string_lossy())
                }
            }
            "mods:exportPack" => {
                let inst = self.instances().require(&arg_str(a, 0))?;
                let mr = arg_str(a, 1) != "curseforge";
                let o = arg(a, 2);
                let version = o.str_of("version").filter(|s| !s.is_empty()).unwrap_or("1.0.0").to_string();
                let safe = regex::Regex::new(r#"[\\/:*?"<>|]+"#).unwrap().replace_all(&inst.string_or("name", ""), "_").to_string();
                let ext = if mr { "mrpack" } else { "zip" };
                let Some(out) = self
                    .shell
                    .save_file(
                        if mr { "Eksportuj jako paczkę Modrinth" } else { "Eksportuj jako paczkę CurseForge" },
                        &format!("{safe}-{version}.{ext}"),
                        if mr { "Modrinth (.mrpack)" } else { "CurseForge (.zip)" },
                        &[ext],
                    )
                    .await
                else {
                    return Ok(Some(Value::Null));
                };
                let opts = mm::ExportOpts {
                    mrpack: mr,
                    out,
                    version: o.string_or("version", ""),
                    author: o.string_or("author", ""),
                    include_options: o.get("includeOptions") != Some(&json!(false)),
                };
                let e = self.emitter.clone();
                let r = mm::export_pack(env, &self.cf(), &inst, &opts, &move |s: &str| e.emit("mods:status", json!({ "stage": s }))).await;
                self.emit("mods:status", Value::Null);
                r?
            }
            "mods:changelog" => {
                let u = arg(a, 0);
                if !truthy(&u["versionId"]) {
                    return Ok(Some(json!("")));
                }
                match u.str_of("source") {
                    Some("curseforge") => json!(self.cf().changelog(env, &u["projectId"], &u["versionId"]).await),
                    Some("hangar") => json!(""),
                    _ => {
                        let v: Option<Value> = env
                            .net
                            .get_json(&format!("{}/version/{}", modrinth::API, urlencoding::encode(&crate::config_edit::js_string(&u["versionId"]))))
                            .await
                            .ok();
                        json!(v.map(|v| v.str_of("changelog").unwrap_or("").chars().take(20000).collect::<String>()).unwrap_or_default())
                    }
                }
            }
            "mods:configs" => {
                let tg = self.target(&arg(a, 0))?;
                let root = tg.root.clone();
                let server = tg.server;
                util::blocking(move || {
                    if !server {
                        return Ok(json!(mm::config_files(&root, &["config", "defaultconfigs"])));
                    }
                    let mut list = mm::config_files(&root, &["config", "plugins", "defaultconfigs"]);
                    let skip = regex::Regex::new(r"(?i)^(ops|whitelist|banned-players|banned-ips|usercache|version_history|eula)\.").unwrap();
                    let ext = regex::Regex::new(r"(?i)\.(toml|yml|yaml|json|properties)$").unwrap();
                    for n in util::read_dir_names(&root) {
                        if !ext.is_match(&n) || skip.is_match(&n) {
                            continue;
                        }
                        if let Ok(m) = std::fs::metadata(root.join(&n)) {
                            if m.is_file() && m.len() < 2 * 1024 * 1024 {
                                list.insert(0, json!({ "path": n, "size": m.len(), "mtime": util::mtime_ms(&m) }));
                            }
                        }
                    }
                    Ok(json!(list))
                })
                .await?
            }
            "mods:readConfig" => {
                let tg = self.target(&arg(a, 0))?;
                let rel = arg_str(a, 1);
                let text = tokio::fs::read_to_string(mm::inside_root(&tg.root, &rel)?).await?;
                let mut out = json!({ "path": rel, "text": text });
                assign(&mut out, &crate::config_edit::parse(&rel, &text));
                out
            }
            "mods:saveConfig" => {
                let tg = self.target(&arg(a, 0))?;
                let rel = arg_str(a, 1);
                let o = arg(a, 2);
                let file = mm::inside_root(&tg.root, &rel)?;
                let old = tokio::fs::read_to_string(&file).await?;
                let next = match o.get("text").and_then(Value::as_str) {
                    Some(t) => t.to_string(),
                    None => crate::config_edit::apply(&rel, &old, o["changes"].as_object().unwrap_or(&Map::new()))?,
                };
                let orig = PathBuf::from(format!("{}.nore-orig", file.display()));
                if !orig.exists() {
                    let _ = tokio::fs::write(&orig, &old).await;
                }
                tokio::fs::write(&file, &next).await?;
                let mut out = json!({ "path": rel, "text": next });
                assign(&mut out, &crate::config_edit::parse(&rel, &next));
                out
            }

            // ------------------------------------------------------------ modpacks
            "modpacks:install" | "modpacks:import" | "modpacks:importInstance" => {
                let picked = match channel {
                    "modpacks:import" => {
                        match self.shell.pick_file("Importuj modpack", "Modpack (Modrinth .mrpack, CurseForge .zip)", &["mrpack", "zip"]).await {
                            Some(f) => Some(f),
                            None => return Ok(Some(Value::Null)),
                        }
                    }
                    "modpacks:importInstance" => match self.shell.pick_folder("Wybierz folder instancji (Prism, MultiMC, CurseForge, Modrinth App)").await {
                        Some(f) => Some(f),
                        None => return Ok(Some(Value::Null)),
                    },
                    _ => None,
                };
                let found = if channel == "modpacks:importInstance" {
                    let f = importers::detect(picked.as_deref().unwrap_or(Path::new(""))).ok_or_else(|| {
                        msg("Nie rozpoznano instancji. Wybierz folder instancji z Prism Launcher, MultiMC, aplikacji CurseForge albo Modrinth App (ten z plikiem instance.cfg, minecraftinstance.json lub profile.json).")
                    })?;
                    if !truthy(&f["mcVersion"]) {
                        return Err(msg("Instancja nie podaje wersji Minecraft."));
                    }
                    Some(f)
                } else {
                    None
                };
                self.take_busy()?;
                let r = async {
                    let progress = self.modpack_progress();
                    let concurrency = self.store.settings().num_of("concurrency").clamp(1.0, 64.0) as usize;
                    let ctx = self.modpacks_ctx();
                    match channel {
                        "modpacks:install" => {
                            let o = arg(a, 0);
                            let pid = crate::config_edit::js_string(&o["projectId"]);
                            let vid = o.get("versionId").filter(|v| truthy(v)).map(crate::config_edit::js_string);
                            self.install_pack(ctx.install(&pid, vid.as_deref(), &progress, concurrency)).await
                        }
                        "modpacks:import" => self.install_pack(ctx.install_file(picked.as_deref().unwrap_or(Path::new("")), json!({}), &progress, concurrency)).await,
                        _ => {
                            let found = found.unwrap_or_default();
                            self.install_pack(async {
                                let loader = found.string_or("loader", "vanilla");
                                let modpack = match loader.as_str() {
                                    "vanilla" => "vanilla",
                                    "fabric" => "fabric",
                                    _ => "loader",
                                };
                                let inst = self.instances().create(&json!({ "name": found["name"], "mcVersion": found["mcVersion"], "loader": loader, "loaderVersion": found["loaderVersion"], "modpack": modpack, "askPerf": true }))?;
                                let id = inst.string_or("id", "");
                                if let Err(e) = importers::copy_game(&found, Path::new(&inst.string_or("gameDir", "")), &progress).await {
                                    let _ = self.instances().remove(&id, true).await;
                                    return Err(e);
                                }
                                self.instances().update(
                                    &id,
                                    &json!({ "loaderVersion": found["loaderVersion"], "memoryMb": if truthy(&found["memoryMb"]) { found["memoryMb"].clone() } else { json!(0) }, "jvmArgs": found.string_or("jvmArgs", ""),
                                        "imported": { "from": found["type"], "label": found["label"], "date": now_ms() } }),
                                )?;
                                self.log(format!("[Launcher] Zaimportowano instancję {} ({}, {} {loader})", found.string_or("name", ""), found.string_or("label", ""), found.string_or("mcVersion", "")), "out");
                                self.instances().require(&id)
                            })
                            .await
                        }
                    }
                }
                .await;
                self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
                self.emit("modpack:progress", Value::Null);
                r?
            }
            "modpacks:blocked" => {
                self.instances().get(&arg_str(a, 0)).and_then(|i| i.pointer("/pack/blocked").cloned()).filter(Value::is_array).unwrap_or(json!([]))
            }
            "modpacks:resolveBlocked" => self.modpacks_ctx().resolve_blocked(&arg_str(a, 0), &util::download_dirs()).await?,
            "modpacks:checkUpdate" => {
                let id = arg_str(a, 0);
                let inst = self.instances().require(&id)?;
                let up = self.modpacks_ctx().check_update(&inst, &self.update_channel()).await?;
                let mut cur = self
                    .content_updates
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&id)
                    .cloned()
                    .unwrap_or(json!({ "mods": 0, "resourcepacks": 0, "shaders": 0 }));
                cur["pack"] = up.clone();
                cur["checked"] = json!(now_ms());
                self.set_instance_updates(&id, cur);
                up
            }
            "modpacks:versions" => match self.instances().get(&arg_str(a, 0)) {
                Some(i) => self.modpacks_ctx().versions(&i).await?,
                None => json!([]),
            },
            "modpacks:update" => {
                let o = arg(a, 0);
                let id = o.string_or("instanceId", "");
                if self.running_id().as_deref() == Some(&id) {
                    return Err(msg("Zamknij grę przed aktualizacją modpacka."));
                }
                self.take_busy()?;
                let r = async {
                    let settings = self.store.settings();
                    let inst = self.instances().require(&id)?;
                    let progress = self.modpack_progress();
                    let ctx = self.modpacks_ctx();
                    let mut vid = o.get("versionId").filter(|v| truthy(v)).map(crate::config_edit::js_string).unwrap_or_default();
                    if vid.is_empty() {
                        let up = ctx.check_update(&inst, &settings.string_or("updateChannel", "all")).await?;
                        if up.is_null() {
                            return Err(msg("Paczka jest już aktualna."));
                        }
                        vid = crate::config_edit::js_string(&up["versionId"]);
                    }
                    let r = ctx
                        .update(&id, &vid, &progress, o.get("backupWorlds") != Some(&json!(false)), settings.num_of("concurrency").clamp(1.0, 64.0) as usize)
                        .await?;
                    let backup = r.str_of("backup").map(|b| format!(" (kopia: {b})")).unwrap_or_default();
                    self.log(
                        format!(
                            "[Launcher] Zaktualizowano modpack {}: {} → {}{backup}",
                            inst.string_or("name", ""),
                            inst.pointer("/pack/version").map(crate::config_edit::js_string).unwrap_or_default(),
                            r.pointer("/instance/pack/version").map(crate::config_edit::js_string).unwrap_or_default()
                        ),
                        "out",
                    );
                    self.recheck_instance(&id);
                    let mut out = r.clone();
                    out["kept"] = json!(r["kept"].as_array().map_or(0, Vec::len));
                    let e = self.emitter.clone();
                    let p: ProgressFn = Arc::new(move |mut v| {
                        v["phase"] = json!("game");
                        e.emit("modpack:progress", v)
                    });
                    if let Err(err) = self.prepare_game(&self.instances().require(&id)?, &settings, p).await {
                        self.log(format!("[Launcher] Paczka zaktualizowana, ale pobieranie gry nie powiodło się: {err}"), "err");
                        out["warning"] = json!(err.to_string());
                    }
                    out["instance"] = json!(self.instances().get(&id));
                    Ok(out)
                }
                .await;
                self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
                self.emit("modpack:progress", Value::Null);
                r?
            }

            // ------------------------------------------------------------ performance mods
            "perf:preview" => {
                let inst = self.modded(&arg_str(a, 0))?;
                let p = perf::preview(env, &inst).await;
                let (mods, _) = crate::jvm::count_mods(Path::new(&inst.string_or("gameDir", ""))).await;
                let keep: Vec<Value> = inst["perfAdded"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|o| !o.truthy_of("dep") && p.plan.keep.iter().any(|k| Some(k.as_str()) == o.str_of("slug")))
                    .map(|o| json!({ "slug": o["slug"], "title": perf::title_of(o.str_of("slug").unwrap_or("")), "file": o["file"] }))
                    .collect();
                json!({
                    "enabled": perf::enabled_for(&inst),
                    "add": p.files.iter().map(|f| json!({ "slug": f["slug"], "title": f["title"], "version": f["version"], "why": f.get("why").cloned().filter(truthy).unwrap_or(Value::Null), "dep": f.str_of("dep").map(perf::title_of), "size": f["size"] })).collect::<Vec<_>>(),
                    "keep": keep,
                    "drop": p.plan.drop.iter().map(|d| { let mut d = d.clone(); d["title"] = json!(perf::title_of(d.str_of("slug").unwrap_or(""))); d }).collect::<Vec<_>>(),
                    "skip": p.plan.skip, "missing": p.missing, "mods": mods, "suggestProfile": if mods > 150 { json!("balanced") } else { Value::Null },
                    "profile": inst.get("optionsProfile").cloned().filter(truthy).unwrap_or(Value::Null),
                })
            }
            "perf:apply" => {
                let id = arg_str(a, 0);
                let o = arg(a, 1);
                if self.busy.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err(msg("Trwa już przygotowywanie gry."));
                }
                if self.running_id().as_deref() == Some(&id) {
                    return Err(msg("Zamknij grę, zanim dodasz mody wydajności."));
                }
                self.modded(&id)?;
                self.take_busy()?;
                let r: Result<Value> = async {
                    let mut patch = json!({ "perfMods": true, "perfAsked": true });
                    if o.truthy_of("unblock") {
                        patch["perfBlocked"] = json!([]);
                    }
                    self.instances().update(&id, &patch)?;
                    let progress = self.progress_fn("progress");
                    let e = self.emitter.clone();
                    let log = move |line: String| e.emit("log", json!({ "line": line, "stream": "out" }));
                    let r = perf::ensure(env, &self.instances(), &id, true, &*progress, &log).await?;
                    if let Some(prof) = o.str_of("profile").filter(|p| crate::gameopts::profile(p).is_some()) {
                        let inst = self.instances().require(&id)?;
                        crate::gameopts::apply_to_instance(Path::new(&inst.string_or("gameDir", "")), &inst.string_or("mcVersion", ""), prof).await?;
                        self.instances().update(&id, &json!({ "optionsProfile": prof, "optionsProfileApplied": prof }))?;
                    }
                    self.recheck_instance(&id);
                    let files =
                        |k: &str| r.as_ref().and_then(|r| r[k].as_array().cloned()).unwrap_or_default().iter().map(|x| x["file"].clone()).collect::<Vec<_>>();
                    Ok(json!({ "added": files("added"), "removed": files("removed"), "instance": self.instances().get(&id) }))
                }
                .await;
                self.busy.store(false, std::sync::atomic::Ordering::SeqCst);
                self.emit("progress", Value::Null);
                r?
            }
            "perf:remove" => {
                let id = arg_str(a, 0);
                if self.running_id().as_deref() == Some(&id) {
                    return Err(msg("Zamknij grę, zanim usuniesz mody wydajności."));
                }
                let inst = self.instances().require(&id)?;
                json!({ "removed": perf::remove_all(&self.instances(), &inst)?, "instance": self.instances().get(&id) })
            }
            "perf:decline" => self.instances().update(&arg_str(a, 0), &json!({ "perfAsked": true, "perfMods": false }))?,

            // ------------------------------------------------------------ doctor & gallery
            "doctor:check" => json!(doctor::deep_check(env, &self.instances().require(&arg_str(a, 0))?).await),
            "doctor:fix" => {
                let inst = self.instances().require(&arg_str(a, 0))?;
                json!(doctor::apply(env, &self.instances(), &inst, arg(a, 1).as_array().map(Vec::as_slice).unwrap_or(&[])).await)
            }
            "gallery:list" => gallery::list(self.instances().list(), 300).await,
            "gallery:full" => gallery::full_image(&gallery::screenshot_path(&arg_str(a, 0), &self.instances().list())?).await,
            "gallery:copy" => {
                let p = gallery::screenshot_path(&arg_str(a, 0), &self.instances().list())?;
                let (w, h, px) = util::blocking(move || gallery::rgba(&p)).await?;
                self.shell.copy_image(w, h, px)?;
                json!(true)
            }
            "gallery:reveal" => {
                self.shell.reveal(&gallery::screenshot_path(&arg_str(a, 0), &self.instances().list())?)?;
                Value::Null
            }
            "gallery:open" => {
                self.shell.open_path(&gallery::screenshot_path(&arg_str(a, 0), &self.instances().list())?)?;
                json!("")
            }
            "gallery:delete" => {
                let _ = tokio::fs::remove_file(gallery::screenshot_path(&arg_str(a, 0), &self.instances().list())?).await;
                json!(true)
            }

            // ------------------------------------------------------------ servers
            "servers:list" => self.servers_list(),
            "servers:create" => self.server_create(&arg(a, 0))?,
            "servers:update" => self.server_update(&arg_str(a, 0), &arg(a, 1))?,
            "servers:remove" => {
                self.release_domain_on_remove(&arg_str(a, 0), &arg(a, 1)).await?;
                self.server_remove(&arg_str(a, 0)).await?
            }
            "servers:noreDomain" => self.nore_domain(&arg_str(a, 0), &a[1.min(a.len())..]).await?,
            "servers:start" | "servers:reinstall" => {
                let id = arg_str(a, 0);
                let p = self.server_progress_fn(&id);
                let r = if channel == "servers:start" { self.server_start(&id, p).await } else { self.server_install(&id, p).await };
                self.emit("server:progress", json!({ "id": id, "done": true }));
                r?
            }
            "servers:stop" => json!(self.server_stop(&arg_str(a, 0))),
            "servers:command" => self.server_command(&arg_str(a, 0), &arg_str(a, 1))?,
            "servers:logs" => self.server_logs(&arg_str(a, 0)),
            "servers:folder" => {
                let s = self.server_require(&arg_str(a, 0))?;
                self.shell.open_path(&sc::dir_of(&s))?;
                json!("")
            }
            "servers:restart" => self.server_restart(&arg_str(a, 0)).await?,
            "servers:stats" => self.server_stats(&arg_str(a, 0)),
            "servers:properties" => Value::Object(self.server_read_properties(&arg_str(a, 0))),
            "servers:players" => self.server_players(&arg_str(a, 0)),
            "servers:playerList" => self.server_player_list(&arg_str(a, 0), &arg_str(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?,
            "servers:backup" => self.server_backup(&arg_str(a, 0), "manual").await?,
            "servers:backups" => self.server_list_backups(&arg_str(a, 0)),
            "servers:restoreBackup" => self.server_restore_backup(&arg_str(a, 0), &arg_str(a, 1)).await?,
            "servers:deleteBackup" => self.server_delete_backup(&arg_str(a, 0), &arg_str(a, 1)).await,
            "servers:resetWorld" => self.server_reset_world(&arg_str(a, 0), &arg(a, 1)).await?,
            "servers:setIcon" => {
                let id = arg_str(a, 0);
                let dir = sc::dir_of(&self.server_require(&id)?);
                let Some(src) = self.shell.pick_file("Ikona serwera", "Obrazy", &["png", "jpg", "jpeg", "webp", "gif"]).await else {
                    return Ok(Some(json!(false)));
                };
                util::blocking(move || {
                    let img = image::open(&src).map_err(|_| msg("Nie udało się wczytać obrazu."))?;
                    img.resize_exact(64, 64, image::imageops::FilterType::Lanczos3)
                        .save_with_format(dir.join("server-icon.png"), image::ImageFormat::Png)
                        .map_err(|e| msg(e.to_string()))
                })
                .await?;
                json!(true)
            }
            "servers:icon" => {
                let f = sc::dir_of(&self.server_require(&arg_str(a, 0))?).join("server-icon.png");
                match tokio::fs::read(&f).await {
                    Ok(b) => {
                        use base64::Engine;
                        json!(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
                    }
                    Err(_) => Value::Null,
                }
            }
            "servers:contentKinds" => json!(sc::kinds_for(self.server_require(&arg_str(a, 0))?.str_of("type").unwrap_or(""))),
            "servers:contentSources" => {
                let t = self.server_require(&arg_str(a, 0))?.string_or("type", "");
                json!({ "modrinth": sc::kinds_for(&t), "curseforge": server_cf::kinds_for(&t), "hangar": if hangar::platform_for(&t).is_some() { json!(["plugin"]) } else { json!([]) } })
            }
            "servers:contentSearch" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                let o = arg(a, 1);
                match o.str_of("source") {
                    Some("curseforge") => server_cf::search(env, &self.cf(), &srv, &o).await?,
                    Some("hangar") => hangar::search(env, &srv, &o).await?,
                    _ => sc::search(env, &srv, &o).await?,
                }
            }
            "servers:contentInstall" => {
                let id = arg_str(a, 0);
                let o = arg(a, 1);
                let pid = crate::config_edit::js_string(&o["projectId"]);
                let is_cf = o.str_of("source") == Some("curseforge") || curseforge::is_cf(&pid);
                let status = self.server_status_fn(&id);
                if o.str_of("kind") == Some("modpack") {
                    let src = json!({ "projectId": o["projectId"], "versionId": o["versionId"] });
                    let (env2, cf) = (self.env.clone(), self.cf());
                    return Ok(Some(if is_cf {
                        self.server_modpack(&id, |srv| async move { server_cf::install_modpack(&env2, &cf, &srv, &src, &status).await }).await?
                    } else {
                        self.server_modpack(&id, |srv| async move { sc::install_modpack(&env2, &srv, &src, &status).await }).await?
                    }));
                }
                let r: Result<Value> = async {
                    let srv = self.server_require(&id)?;
                    if hangar::is_hangar(&pid) {
                        let got = hangar::install(env, &srv, &pid, &sc::folder_of(&srv, "plugin"), &status, &mut HashSet::new()).await?;
                        let mut rec = self.server_raw(&id).and_then(|s| s.get("hangar").cloned()).filter(Value::is_object).unwrap_or(json!({}));
                        for g in &got {
                            rec[g.str_of("file").unwrap_or("")] = json!({ "slug": g["slug"], "version": g["version"] });
                        }
                        self.server_update(&id, &json!({ "hangar": rec }))?;
                        return Ok(json!(got.iter().map(|g| g["file"].clone()).collect::<Vec<_>>()));
                    }
                    if is_cf {
                        return Ok(json!(server_cf::install(env, &self.cf(), &srv, &o, &status).await?));
                    }
                    Ok(json!(sc::install(env, &srv, o.str_of("kind").unwrap_or("plugin"), pid.clone(), &status, &mut HashSet::new()).await?))
                }
                .await;
                self.emit("server:progress", json!({ "id": id, "done": true }));
                r?
            }
            "servers:modpackVersions" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                let pid = Some(arg_str(a, 1))
                    .filter(|s| !s.is_empty())
                    .or_else(|| srv.pointer("/pack/projectId").map(crate::config_edit::js_string))
                    .unwrap_or_default();
                json!(if curseforge::is_cf(&pid) {
                    server_cf::pack_versions(env, &self.cf(), &pid).await?
                } else {
                    sc::modpack_versions(env, &srv, &pid).await?
                })
            }
            "servers:modpackUpdate" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                if srv.pointer("/pack/source").and_then(Value::as_str) == Some("curseforge") {
                    server_cf::pack_update(env, &self.cf(), &srv, &sc::version_types(&self.update_channel())).await?
                } else {
                    sc::modpack_update(env, &srv, &self.update_channel()).await?
                }
            }
            "servers:modpackApply" => {
                let id = arg_str(a, 0);
                let pack = self.server_require(&id)?["pack"].clone();
                if !truthy(&pack["projectId"]) {
                    return Err(msg("Ten serwer nie ma paczki z Modrinth ani CurseForge."));
                }
                let src = json!({ "projectId": pack["projectId"], "versionId": arg(a, 1) });
                let status = self.server_status_fn(&id);
                let (env2, cf) = (self.env.clone(), self.cf());
                if pack.str_of("source") == Some("curseforge") {
                    self.server_modpack(&id, |srv| async move { server_cf::install_modpack(&env2, &cf, &srv, &src, &status).await }).await?
                } else {
                    self.server_modpack(&id, |srv| async move { sc::install_modpack(&env2, &srv, &src, &status).await }).await?
                }
            }
            "servers:blocked" => self.server_get(&arg_str(a, 0)).and_then(|s| s.pointer("/pack/blocked").cloned()).filter(Value::is_array).unwrap_or(json!([])),
            "servers:resolveBlocked" => {
                let id = arg_str(a, 0);
                let srv = self.server_require(&id)?;
                let list = srv.pointer("/pack/blocked").and_then(Value::as_array).cloned().unwrap_or_default();
                let (found, rest) = modpacks::find_downloaded(&sc::dir_of(&srv), &list, &util::download_dirs()).await?;
                let mut pack = self.server_require(&id)?["pack"].clone();
                pack["blocked"] = json!(rest);
                self.server_update(&id, &json!({ "pack": pack }))?;
                json!({ "found": found, "blocked": rest })
            }
            "servers:loaderVersions" => self.server_loader_versions(&arg_str(a, 0), &arg_str(a, 1)).await?,
            "servers:propertiesForm" => self.server_properties_form(&arg_str(a, 0)),
            "servers:saveProperties" => self.server_save_properties(&arg_str(a, 0), &arg(a, 1))?,
            "servers:complete" => self.server_complete(&arg_str(a, 0), &arg_str(a, 1), &arg(a, 2)),
            "servers:motdPreview" => server_props::motd_segments(&arg_str(a, 0).chars().take(400).collect::<String>()),
            "servers:jvmPreview" => {
                let id = arg_str(a, 0);
                let mut s = self.server_raw(&id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
                if arg(a, 1).is_object() {
                    assign(&mut s, &arg(a, 1));
                }
                json!(self.server_jvm_args(&s).join(" "))
            }
            "servers:contentList" => sc::list_installed(&self.server_require(&arg_str(a, 0))?).await,
            "servers:contentToggle" => json!(sc::set_enabled(&self.server_require(&arg_str(a, 0))?, &arg_str(a, 1), &arg_str(a, 2), truthy(&arg(a, 3))).await?),
            "servers:contentRemove" => {
                sc::remove(&self.server_require(&arg_str(a, 0))?, &arg_str(a, 1), &arg_str(a, 2)).await?;
                Value::Null
            }
            "servers:contentAddFiles" => {
                let files = self.shell.pick_files("Dodaj pluginy, mody, datapacki lub modpack", "Pluginy, mody, paczki", &["jar", "zip", "mrpack"]).await;
                if files.is_empty() {
                    return Ok(Some(json!({ "added": [], "pack": null })));
                }
                self.add_server_files(&arg_str(a, 0), files).await?
            }
            "servers:contentAddPaths" => {
                let files: Vec<PathBuf> = arg(a, 1).as_array().into_iter().flatten().filter_map(Value::as_str).map(PathBuf::from).collect();
                self.add_server_files(&arg_str(a, 0), files).await?
            }
            "servers:contentUpdates" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                let pins = srv["modPins"].as_array().cloned().unwrap_or_default();
                json!(sc::check_all_updates(env, &self.cf(), &srv, &self.update_channel(), &pins).await)
            }
            "servers:contentApplyUpdates" => {
                let id = arg_str(a, 0);
                let ups = arg(a, 1).as_array().cloned().unwrap_or_default();
                let status = self.server_status_fn(&id);
                let n = sc::apply_updates(env, &self.server_require(&id)?, &ups, &status).await;
                self.emit("server:progress", json!({ "id": id, "done": true }));
                let n = n?;
                let hang: Vec<&Value> = ups.iter().filter(|u| u.str_of("source") == Some("hangar")).collect();
                if !hang.is_empty() {
                    let mut rec = self.server_raw(&id).and_then(|s| s.get("hangar").cloned()).filter(Value::is_object).unwrap_or(json!({}));
                    for u in hang {
                        if let Some(o) = rec.as_object_mut() {
                            o.remove(u.str_of("oldFile").unwrap_or(""));
                        }
                        rec[u.str_of("newFile").unwrap_or("")] =
                            json!({ "slug": hangar::slug_of(u.str_of("projectId").unwrap_or("")), "version": u["version"] });
                    }
                    self.server_update(&id, &json!({ "hangar": rec }))?;
                }
                json!(n)
            }
            "servers:netInfo" => {
                let ip = server_net::public_ip(env).await.ok();
                let platform = if cfg!(windows) {
                    "win32"
                } else if cfg!(target_os = "macos") {
                    "darwin"
                } else {
                    "linux"
                };
                json!({ "lan": server_net::lan_addresses(), "publicIp": ip, "platform": platform, "tunnelSupported": server_tunnel::supported(), "playitLinked": self.store.read(|d| d.pointer("/playit/secret").is_some_and(truthy)) })
            }
            "servers:checkReachable" => {
                server_net::check_reachable(env, &arg_str(a, 0), arg(a, 1).as_u64().or_else(|| arg_str(a, 1).parse().ok()).unwrap_or(25565) as u16).await?
            }
            "servers:upnp" => {
                let id = arg_str(a, 0);
                let open = truthy(&arg(a, 1));
                let srv = self.server_require(&id)?;
                self.server_update(&id, &json!({ "upnp": open }))?;
                let port = srv["port"].as_u64().unwrap_or(25565) as u16;
                if open {
                    server_net::upnp_open(port, &format!("Nore {}", srv.string_or("name", ""))).await?
                } else {
                    json!(server_net::upnp_close(port).await?)
                }
            }
            "servers:diagnose" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                let tunnel = if srv.pointer("/tunnel/enabled") == Some(&json!(true)) { srv["tunnel"].clone() } else { Value::Null };
                server_net::diagnose(env, srv["port"].as_u64().unwrap_or(25565) as u16, srv.str_of("state") == Some("running"), &srv["domain"], &tunnel).await
            }
            "servers:firewall" => json!(server_net::firewall_allow(self.server_require(&arg_str(a, 0))?["port"].as_u64().unwrap_or(25565) as u16).await?),
            "servers:dnsCheck" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                let name = srv.pointer("/domain/name").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| msg("Najpierw ustaw domenę."))?;
                server_net::dns_check(name, srv["port"].as_u64().unwrap_or(25565) as u16).await
            }
            "servers:applyDomain" => {
                let srv = self.server_raw(&arg_str(a, 0)).ok_or_else(|| msg("Nie znaleziono serwera."))?;
                self.server_apply_domain(&srv, None).await?
            }
            "servers:dnsRecords" => {
                let srv = self.server_require(&arg_str(a, 0))?;
                let ip = server_net::public_ip(env).await.ok();
                server_net::manual_records(&arg_str(a, 1), ip.as_deref(), srv["port"].as_u64().unwrap_or(25565) as u16)
            }
            "servers:tunnelLink" => {
                if let Some(url) = self.playit_claim.lock().unwrap_or_else(|e| e.into_inner()).clone() {
                    return Ok(Some(json!({ "url": url, "pending": true })));
                }
                let (code, url) = server_tunnel::claim_start(env).await?;
                *self.playit_claim.lock().unwrap_or_else(|e| e.into_inner()) = Some(url.clone());
                let _ = self.shell.open_url(&url);
                let me = self.clone();
                tokio::spawn(async move {
                    match server_tunnel::claim_finish(&me.env, &code).await {
                        Ok(secret) => {
                            let sealed = me.encrypt_token(&secret);
                            let _ = me.store.update(|d| d["playit"] = json!({ "secret": sealed, "linked": now_ms() }));
                            me.emit("server:tunnel", json!({ "linked": true }));
                        }
                        Err(e) => me.emit("server:tunnel", json!({ "linked": false, "error": e.to_string() })),
                    }
                    *me.playit_claim.lock().unwrap_or_else(|e| e.into_inner()) = None;
                });
                json!({ "url": url, "pending": true })
            }
            "servers:tunnelUnlink" => {
                self.store.update(|d| {
                    d["playit"] = Value::Null;
                    for s in d["servers"].as_array_mut().into_iter().flatten() {
                        if truthy(&s["tunnel"]) {
                            s["tunnel"] = json!({ "enabled": false });
                        }
                    }
                })?;
                json!(true)
            }
            "servers:tunnel" => {
                let id = arg_str(a, 0);
                let srv = self.server_raw(&id).ok_or_else(|| msg("Nie znaleziono serwera."))?;
                if truthy(&arg(a, 1)) {
                    let secret = self
                        .decrypt_token(&self.store.read(|d| d.pointer("/playit/secret").cloned().unwrap_or(Value::Null)))
                        .ok_or_else(|| msg("Najpierw połącz konto playit.gg."))?;
                    let name: String = format!("nore-{id}").chars().take(40).collect();
                    let (tid, addr) = server_tunnel::ensure_tunnel(env, &secret, &name).await?;
                    self.server_update(&id, &json!({ "tunnel": { "enabled": true, "id": tid, "address": addr } }))?;
                    json!({ "enabled": true, "address": addr, "restart": self.server_running(&id) })
                } else {
                    let mut t = srv.get("tunnel").cloned().filter(Value::is_object).unwrap_or(json!({}));
                    t["enabled"] = json!(false);
                    self.server_update(&id, &json!({ "tunnel": t }))?;
                    json!({ "enabled": false, "restart": self.server_running(&id) })
                }
            }
            _ => return Ok(None),
        }))
    }

    fn modded(&self, id: &str) -> Result<Value> {
        let inst = self.instances().get(id).ok_or_else(|| msg("Nie znaleziono instancji."))?;
        if inst.str_of("loader").is_none_or(|l| l.is_empty() || l == "vanilla") {
            return Err(msg("Mody wydajności wymagają instancji z loaderem (Fabric, Quilt, Forge albo NeoForge)."));
        }
        Ok(inst)
    }
}
