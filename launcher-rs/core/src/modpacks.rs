//! Modpacks for client instances (port of launcher/src/main/modpacks.js): Modrinth .mrpack and
//! CurseForge zips become instances; updates swap the pack's own files and keep everything that
//! belongs to the player (worlds, changed configs, own mods). Files a CurseForge author blocked for
//! other apps are listed for a manual download and picked up from the Downloads folder.

use crate::curseforge::{self, Cf, PackTask};
use crate::error::{msg, Result};
use crate::instances::Instances;
use crate::js::{now_ms, truthy, ValueExt};
use crate::util::{self, inside, sha1_hex, Zip};
use crate::{modrinth, net, Env};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

const API: &str = modrinth::API;

pub type Progress<'a> = &'a (dyn Fn(Value) + Send + Sync);

/// Loader + version from modrinth.index.json dependencies.
pub fn loader_of(deps: &Value) -> (String, Option<String>) {
    for (k, l) in [("fabric-loader", "fabric"), ("quilt-loader", "quilt"), ("neoforge", "neoforge"), ("forge", "forge")] {
        if let Some(v) = deps.get(k).filter(|v| truthy(v)) {
            return (l.into(), Some(crate::config_edit::js_string(v)));
        }
    }
    ("vanilla".into(), None)
}

static PROTECTED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(saves|screenshots|backups|logs|crash-reports|\.nore-backup)(/|$)").unwrap());
static CONTENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(mods|resourcepacks|shaderpacks)/").unwrap());

pub fn norm(rel: &str) -> String {
    let mut s = rel.replace('\\', "/");
    while let Some(r) = s.strip_prefix("./") {
        s = r.to_string();
    }
    s
}

/// Project id from a Modrinth CDN url.
pub fn cdn_project(url: &str) -> Option<String> {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/data/([A-Za-z0-9]{8})/versions/").unwrap());
    R.captures(url).map(|c| c[1].to_string())
}

fn first_download(f: &Value) -> Option<&str> {
    f["downloads"].as_array().and_then(|d| d.first()).and_then(Value::as_str)
}

/// Files of modrinth.index.json the client needs.
pub fn client_files(index: &Value) -> Vec<Value> {
    index["files"].as_array().into_iter().flatten().filter(|f| f.str_of("path").is_some_and(|p| !p.is_empty()) && first_download(f).is_some() && f.pointer("/env/client").and_then(Value::as_str) != Some("unsupported")).cloned().collect()
}

/// Entries under overrides/ and client-overrides/ (the latter wins): (rel, entry name).
pub fn override_entries(zip: &Zip, prefixes: &[&str]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let names = zip.names();
    for prefix in prefixes {
        for n in names.iter().filter(|n| n.starts_with(prefix)) {
            let rel = norm(&n[prefix.len()..]);
            if rel.is_empty() {
                continue;
            }
            match out.iter_mut().find(|(r, _)| *r == rel) {
                Some(e) => e.1 = n.clone(),
                None => out.push((rel, n.clone())),
            }
        }
    }
    out
}

/// What a pack version put into the instance: index paths, their Modrinth projects and override hashes.
pub fn pack_record(index: &Value, zip: &mut Zip) -> Value {
    let (mut files, mut ids, mut overrides) = (Vec::new(), Map::new(), Map::new());
    for f in client_files(index) {
        let rel = norm(f.str_of("path").unwrap_or(""));
        if let Some(id) = first_download(&f).and_then(cdn_project) {
            ids.insert(rel.clone(), json!(id));
        }
        files.push(json!(rel));
    }
    for (rel, entry) in override_entries(zip, &["overrides/", "client-overrides/"]) {
        if let Some(b) = zip.read(&entry) {
            overrides.insert(rel, json!(sha1_hex(&b)));
        }
    }
    json!({ "files": files, "ids": ids, "overrides": overrides })
}

/// What happens with one override file during an update: write | keep | skip.
pub fn override_action(rel: &str, exists: bool, current: Option<&str>, old_hash: Option<&str>, new_hash: Option<&str>) -> &'static str {
    let rel = norm(rel);
    if PROTECTED.is_match(&rel) {
        return "skip";
    }
    if !exists {
        return "write";
    }
    if current.is_some() && current == new_hash {
        return "skip";
    }
    if CONTENT.is_match(&rel) {
        return "write";
    }
    if old_hash.is_some() && current == old_hash {
        return "write";
    }
    "keep"
}

/// Downloads pack files; blocked CurseForge files are tried once through the CDN and returned for
/// the manual-download prompt when that fails.
pub async fn download_tasks(env: &Env, tasks: &[PackTask], concurrency: usize, progress: Progress<'_>) -> Result<Vec<Value>> {
    let normal: Vec<net::Task> =
        tasks.iter().filter(|t| t.blocked.is_none()).map(|t| net::Task { url: t.url.clone(), dest: t.dest.clone(), sha1: t.sha1.clone(), size: t.size, name: t.name.clone() }).collect();
    let last = Mutex::new(0i64);
    env.net
        .download_all(
            normal,
            concurrency,
            &|p| {
                let now = now_ms();
                let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
                if now - *l < 120 && p.done != p.total {
                    return;
                }
                *l = now;
                progress(json!({ "done": p.done, "total": p.total, "bytes": p.bytes, "totalBytes": p.total_bytes, "current": p.current }));
            },
            None,
        )
        .await?;
    let mut blocked = Vec::new();
    for t in tasks.iter().filter(|t| t.blocked.is_some()) {
        if env.net.download(&t.url, &t.dest, t.sha1.as_deref(), t.size, &|_| {}).await.is_err() {
            blocked.push(t.blocked.clone().unwrap_or(Value::Null));
        }
    }
    Ok(blocked)
}

pub fn read_pack(file: &Path) -> Result<(Zip, Value)> {
    let mut zip = Zip::open(file)?;
    let index = zip.json("modrinth.index.json").ok_or_else(|| msg("To nie jest paczka Modrinth (.mrpack) – brak modrinth.index.json."))?;
    Ok((zip, index))
}

/// Everything a modpack install / update needs.
pub struct Ctx<'a> {
    pub env: &'a Env,
    pub insts: Instances<'a>,
    pub cf: Cf,
}

fn with_stage<'a>(progress: Progress<'a>, stage: &str) -> impl Fn(Value) + Send + Sync + 'a {
    let stage = stage.to_string();
    move |mut p: Value| {
        p["stage"] = json!(stage);
        progress(p)
    }
}

impl Ctx<'_> {
    fn cache(&self) -> PathBuf {
        self.env.paths.cache().join("modpacks")
    }

    /// Creates an instance from a .mrpack (or CurseForge .zip) file.
    pub async fn install_file(&self, file: &Path, meta: Value, progress: Progress<'_>, concurrency: usize) -> Result<Value> {
        let f = file.to_path_buf();
        let is_cf = util::blocking(move || Ok(curseforge::read_manifest(&f).is_some() && !Zip::open(&f).map(|z| z.has("modrinth.index.json")).unwrap_or(false))).await?;
        if is_cf {
            return self.install_curseforge(file, meta, progress, concurrency).await;
        }
        let (zip, index) = read_pack(file)?;
        self.install_index(zip, index, meta, progress, concurrency).await
    }

    /// Creates the instance for an index (Modrinth, or CurseForge converted by to_index).
    pub async fn install_index(&self, mut zip: Zip, index: Value, meta: Value, progress: Progress<'_>, concurrency: usize) -> Result<Value> {
        let deps = index["dependencies"].clone();
        let mc = deps.str_of("minecraft").filter(|s| !s.is_empty()).ok_or_else(|| msg("Paczka nie podaje wersji Minecraft."))?.to_string();
        let (loader, lv) = loader_of(&deps);
        let title = meta.str_of("title").filter(|s| !s.is_empty()).map(String::from).or_else(|| index.str_of("name").map(String::from));
        let inst = self.insts.create(&json!({ "name": title.clone().unwrap_or_else(|| "Modpack".into()), "mcVersion": mc, "loader": loader, "loaderVersion": lv, "modpack": "pack" }))?;
        let id = inst.string_or("id", "");
        let mut pack = json!({
            "projectId": meta.get("projectId").cloned().filter(truthy).unwrap_or(Value::Null), "versionId": meta.get("versionId").cloned().filter(truthy).unwrap_or(Value::Null),
            "title": title, "version": meta.get("version").cloned().filter(truthy).or(index.get("versionId").cloned()).unwrap_or(json!("")), "summary": index.string_or("summary", ""),
            "type": meta.get("type").cloned().unwrap_or(Value::Null), "date": meta.get("date").cloned().unwrap_or(Value::Null), "source": meta.str_of("source").unwrap_or("modrinth"),
        });
        crate::js::assign(&mut pack, &pack_record(&index, &mut zip));
        self.insts.update(
            &id,
            &json!({ "pack": pack, "iconUrl": meta.get("icon").cloned().unwrap_or(Value::Null), "bannerUrl": meta.get("banner").cloned().unwrap_or(Value::Null), "packInstalled": true,
                "noreClient": loader == "fabric" && self.insts.mods.supports(&mc), "perfMods": loader != "vanilla", "perfAsked": true }),
        )?;
        let root = PathBuf::from(inst.string_or("gameDir", ""));
        let r: Result<()> = async {
            let mut tasks = Vec::new();
            for f in index["files"].as_array().into_iter().flatten().filter(|f| f.pointer("/env/client").and_then(Value::as_str) != Some("unsupported")) {
                let Some(dest) = inside(&root, f.str_of("path").unwrap_or("")) else { continue };
                let Some(url) = first_download(f) else { continue };
                tasks.push(PackTask {
                    url: url.into(),
                    dest,
                    rel: String::new(),
                    sha1: f.pointer("/hashes/sha1").and_then(Value::as_str).map(String::from),
                    size: f["fileSize"].as_u64(),
                    name: util::basename(f.str_of("path").unwrap_or("")),
                    blocked: f.get("blocked").cloned().filter(truthy),
                });
            }
            progress(json!({ "stage": "Pobieranie plików paczki", "done": 0, "total": tasks.len() }));
            let blocked = download_tasks(self.env, &tasks, concurrency, &with_stage(progress, "Pobieranie plików paczki")).await?;
            let server_only = index["serverOnly"].as_array().map_or(0, Vec::len);
            if !blocked.is_empty() || server_only > 0 {
                let mut p = self.insts.require(&id)?["pack"].clone();
                p["blocked"] = json!(blocked);
                p["serverOnly"] = json!(server_only);
                self.insts.update(&id, &json!({ "pack": p }))?;
            }
            progress(json!({ "stage": "Rozpakowywanie ustawień paczki" }));
            for (rel, entry) in override_entries(&zip, &["overrides/", "client-overrides/"]) {
                let Some(dest) = inside(&root, &rel) else { continue };
                let Some(data) = zip.read(&entry) else { continue };
                if let Some(d) = dest.parent() {
                    tokio::fs::create_dir_all(d).await?;
                }
                tokio::fs::write(&dest, data).await?;
            }
            Ok(())
        }
        .await;
        if let Err(e) = r {
            let _ = self.insts.remove(&id, true).await;
            return Err(e);
        }
        self.insts.require(&id)
    }

    /// CurseForge modpack (.zip with manifest.json) – through the same path as .mrpack.
    pub async fn install_curseforge(&self, file: &Path, mut meta: Value, progress: Progress<'_>, concurrency: usize) -> Result<Value> {
        let (zip, manifest) = curseforge::read_manifest(file).ok_or_else(|| msg("To nie jest paczka CurseForge (brak manifest.json)."))?;
        meta["source"] = json!("curseforge");
        if !meta.truthy_of("title") {
            meta["title"] = manifest["name"].clone();
        }
        if !meta.truthy_of("version") {
            meta["version"] = manifest["version"].clone();
        }
        let index = self.cf.to_index(self.env, &manifest, progress).await?;
        self.install_index(zip, index, meta, progress, concurrency).await
    }

    /// Downloads a pack version (newest release when empty) and installs it.
    pub async fn install(&self, project_id: &str, version_id: Option<&str>, progress: Progress<'_>, concurrency: usize) -> Result<Value> {
        progress(json!({ "stage": "Pobieranie informacji o paczce" }));
        if curseforge::is_cf(project_id) {
            let d = self.cf.download_pack(self.env, project_id, version_id, &self.cache()).await?;
            let file = PathBuf::from(d.string_or("file", ""));
            let meta = json!({ "title": d["title"], "icon": d["icon"], "banner": d["banner"], "projectId": project_id, "versionId": d["fileId"].as_u64().map(|x| x.to_string()), "version": d["version"], "type": d["type"], "date": d["date"] });
            let r = self.install_curseforge(&file, meta, progress, concurrency).await;
            let _ = tokio::fs::remove_file(&file).await;
            return r;
        }
        let project: Value = self.env.net.get_json(&format!("{API}/project/{}", urlencoding::encode(project_id))).await?;
        let version: Value = match version_id.filter(|s| !s.is_empty()) {
            Some(v) => self.env.net.get_json(&format!("{API}/version/{}", urlencoding::encode(v))).await?,
            None => {
                let list: Vec<Value> = self.env.net.get_json(&format!("{API}/project/{}/version", urlencoding::encode(project_id))).await?;
                list.iter().find(|v| v.str_of("version_type") == Some("release")).or(list.first()).cloned().ok_or_else(|| msg("Ta paczka nie ma jeszcze żadnej wersji."))?
            }
        };
        let f = mrpack_file(&version)?;
        let name = util::basename(f.str_of("filename").unwrap_or("pack.mrpack"));
        let tmp = self.cache().join(&name);
        progress(json!({ "stage": format!("Pobieranie {name}") }));
        self.env.net.download(f.str_of("url").unwrap_or(""), &tmp, f.pointer("/hashes/sha1").and_then(Value::as_str), f["size"].as_u64(), &|_| {}).await?;
        let gallery = project["gallery"].as_array().cloned().unwrap_or_default();
        let banner = gallery.iter().find(|g| g.truthy_of("featured")).or(gallery.first()).map(|g| g["url"].clone()).unwrap_or(Value::Null);
        let meta = json!({ "title": project["title"], "icon": project["icon_url"], "projectId": project["id"], "banner": banner, "versionId": version["id"], "version": version["version_number"], "type": version["version_type"], "date": version["date_published"] });
        let r = self.install_file(&tmp, meta, progress, concurrency).await;
        let _ = tokio::fs::remove_file(&tmp).await;
        r
    }

    async fn pack_versions(&self, project_id: &str) -> Result<Vec<Value>> {
        let list: Vec<Value> = self.env.net.get_json(&format!("{API}/project/{}/version", urlencoding::encode(project_id))).await?;
        let mut l: Vec<Value> = list.into_iter().filter(|v| v["files"].as_array().is_some_and(|f| f.iter().any(|x| x.str_of("filename").is_some_and(|n| n.ends_with(".mrpack"))))).collect();
        l.sort_by_key(|v| std::cmp::Reverse(util::parse_date(v.str_of("date_published").unwrap_or(""))));
        Ok(l)
    }

    /// Newest pack version for the instance's Minecraft version allowed by the channel, or null.
    pub async fn check_update(&self, inst: &Value, channel: &str) -> Result<Value> {
        let Some(pid) = inst.pointer("/pack/projectId").and_then(Value::as_str).filter(|s| !s.is_empty()) else { return Ok(Value::Null) };
        let mc = inst.str_of("mcVersion").unwrap_or("");
        let types = modrinth::channel_types(channel);
        let cur_id = inst.pointer("/pack/versionId").map(crate::config_edit::js_string).unwrap_or_default();
        let pack_date = util::parse_date(inst.pointer("/pack/date").and_then(Value::as_str).unwrap_or(""));
        if curseforge::is_cf(pid) {
            let list = self.cf.pack_versions(self.env, &json!(pid)).await?;
            let has_mc = |v: &Value| v["gameVersions"].as_array().is_some_and(|g| g.iter().any(|x| x.as_str() == Some(mc)));
            let Some(best) = list.iter().find(|v| types.contains(&v.str_of("type").unwrap_or("")) && has_mc(v)) else { return Ok(Value::Null) };
            if best.str_of("id") == Some(&cur_id) {
                return Ok(Value::Null);
            }
            let cur_date = list.iter().find(|v| v.str_of("id") == Some(&cur_id)).map_or(pack_date, |v| util::parse_date(v.str_of("date").unwrap_or("")));
            if cur_date != 0 && util::parse_date(best.str_of("date").unwrap_or("")) <= cur_date {
                return Ok(Value::Null);
            }
            return Ok(cf_describe(best, inst));
        }
        let list = self.pack_versions(pid).await?;
        let has_mc = |v: &Value| v["game_versions"].as_array().is_some_and(|g| g.iter().any(|x| x.as_str() == Some(mc)));
        let Some(best) = list.iter().find(|v| types.contains(&v.str_of("version_type").unwrap_or("")) && has_mc(v)) else { return Ok(Value::Null) };
        if best.str_of("id") == Some(&cur_id) {
            return Ok(Value::Null);
        }
        let cur_date = list.iter().find(|v| v.str_of("id") == Some(&cur_id)).map_or(pack_date, |v| util::parse_date(v.str_of("date_published").unwrap_or("")));
        if cur_date != 0 && util::parse_date(best.str_of("date_published").unwrap_or("")) <= cur_date {
            return Ok(Value::Null);
        }
        Ok(describe(best, inst))
    }

    /// Every version of the instance's pack for the version picker.
    pub async fn versions(&self, inst: &Value) -> Result<Value> {
        let Some(pid) = inst.pointer("/pack/projectId").and_then(Value::as_str).filter(|s| !s.is_empty()) else { return Ok(json!([])) };
        let cur = inst.pointer("/pack/versionId").map(crate::config_edit::js_string).unwrap_or_default();
        if curseforge::is_cf(pid) {
            let list = self.cf.pack_versions(self.env, &json!(pid)).await?;
            return Ok(Value::Array(
                list.iter()
                    .take(80)
                    .map(|v| {
                        let mut d = cf_describe(v, inst);
                        d["id"] = v["id"].clone();
                        d["number"] = v["number"].clone();
                        d["current"] = json!(v.str_of("id") == Some(&cur));
                        d
                    })
                    .collect(),
            ));
        }
        let list = self.pack_versions(pid).await?;
        Ok(Value::Array(
            list.iter()
                .take(80)
                .map(|v| {
                    json!({ "id": v["id"], "number": v["version_number"], "name": v["name"], "type": v["version_type"], "date": v["date_published"], "mcVersion": mc_of(v, inst),
                "current": v.str_of("id") == Some(&cur), "changelog": truncate(v.str_of("changelog").unwrap_or(""), 4000) })
                })
                .collect(),
        ))
    }

    async fn download_pack(&self, version: &Value, tag: &str) -> Result<PathBuf> {
        let f = mrpack_file(version)?;
        let tmp = self.cache().join(format!("{}{tag}-{}", version.string_or("id", ""), util::basename(f.str_of("filename").unwrap_or(""))));
        self.env.net.download(f.str_of("url").unwrap_or(""), &tmp, f.pointer("/hashes/sha1").and_then(Value::as_str), f["size"].as_u64(), &|_| {}).await?;
        Ok(tmp)
    }

    async fn old_record(&self, inst: &Value, progress: Progress<'_>, temp: &mut Vec<PathBuf>) -> Value {
        let p = &inst["pack"];
        if p["files"].is_array() {
            return json!({ "files": p["files"], "ids": p.get("ids").cloned().filter(truthy).unwrap_or(json!({})), "overrides": p.get("overrides").cloned().filter(truthy).unwrap_or(json!({})) });
        }
        if let Some(vid) = p.str_of("versionId").filter(|s| !s.is_empty()) {
            progress(json!({ "stage": "Pobieranie poprzedniej wersji paczki" }));
            let r: Result<Value> = async {
                let v: Value = self.env.net.get_json(&format!("{API}/version/{}", urlencoding::encode(vid))).await?;
                let tmp = self.download_pack(&v, "-old").await?;
                temp.push(tmp.clone());
                let (mut zip, index) = read_pack(&tmp)?;
                Ok(pack_record(&index, &mut zip))
            }
            .await;
            if let Ok(r) = r {
                return r;
            }
        }
        json!({ "files": [], "ids": {}, "overrides": {} })
    }

    /// Updates (or downgrades) a modpack instance to `version_id` without losing the player's data.
    pub async fn update(&self, inst_id: &str, version_id: &str, progress: Progress<'_>, backup_worlds: bool, concurrency: usize) -> Result<Value> {
        let inst = self.insts.get(inst_id).filter(|i| truthy(&i["pack"])).ok_or_else(|| msg("To nie jest instancja modpacka."))?;
        if version_id.is_empty() {
            return Err(msg("Nie wybrano wersji paczki."));
        }
        let mut temp: Vec<PathBuf> = Vec::new();
        let r = self.update_inner(&inst, version_id, progress, backup_worlds, concurrency, &mut temp).await;
        for t in temp {
            let _ = tokio::fs::remove_file(t).await;
        }
        r
    }

    async fn update_inner(&self, inst: &Value, version_id: &str, progress: Progress<'_>, backup_worlds: bool, concurrency: usize, temp: &mut Vec<PathBuf>) -> Result<Value> {
        let root = PathBuf::from(inst.string_or("gameDir", ""));
        let id = inst.string_or("id", "");
        let p = inst["pack"].clone();
        progress(json!({ "stage": "Pobieranie informacji o wersji" }));
        let pid = p.string_or("projectId", "");
        let (mut zip, index, old, meta) = if curseforge::is_cf(&pid) {
            let d = self.cf.download_pack(self.env, &pid, Some(version_id), &self.cache()).await?;
            let file = PathBuf::from(d.string_or("file", ""));
            temp.push(file.clone());
            let (zip, manifest) = curseforge::read_manifest(&file).ok_or_else(|| msg("To nie jest paczka CurseForge (brak manifest.json)."))?;
            let index = self.cf.to_index(self.env, &manifest, progress).await?;
            let old = json!({ "files": p.get("files").cloned().filter(truthy).unwrap_or(json!([])), "ids": p.get("ids").cloned().filter(truthy).unwrap_or(json!({})), "overrides": p.get("overrides").cloned().filter(truthy).unwrap_or(json!({})) });
            let meta = json!({ "versionId": d["fileId"].as_u64().map(|x| x.to_string()), "version": d["version"], "type": d["type"], "date": d["date"] });
            (zip, index, old, meta)
        } else {
            let version: Value = self.env.net.get_json(&format!("{API}/version/{}", urlencoding::encode(version_id))).await?;
            if !pid.is_empty() && version.str_of("project_id") != Some(&pid) {
                return Err(msg("Ta wersja należy do innej paczki."));
            }
            progress(json!({ "stage": format!("Pobieranie {}", mrpack_file(&version)?.string_or("filename", "")) }));
            let tmp = self.download_pack(&version, "").await?;
            temp.push(tmp.clone());
            let (zip, index) = read_pack(&tmp)?;
            if index.pointer("/dependencies/minecraft").and_then(Value::as_str).is_none_or(str::is_empty) {
                return Err(msg("Paczka nie podaje wersji Minecraft."));
            }
            let old = self.old_record(inst, progress, temp).await;
            let meta = json!({ "versionId": version["id"], "version": version["version_number"], "type": version["version_type"], "date": version["date_published"] });
            (zip, index, old, meta)
        };
        let deps = index["dependencies"].clone();
        let mc = deps.string_or("minecraft", "");
        let rec = pack_record(&index, &mut zip);
        let (loader, lv) = loader_of(&deps);
        let nore = loader == "fabric" && self.insts.mods.supports(&mc);
        let label = json!({ "from": p["version"], "to": meta["version"], "mcFrom": inst["mcVersion"], "mcTo": mc });
        let result = swap_files(
            self.env,
            &root,
            &mut zip,
            &index,
            &rec,
            &old,
            progress,
            concurrency,
            backup_worlds && Some(mc.as_str()) != inst.str_of("mcVersion"),
            inst.truthy_of("noreClient") && !nore,
            &label,
        )
        .await?;
        let mut pack = p.clone();
        crate::js::assign(&mut pack, &meta);
        if !curseforge::is_cf(&pid) {
            pack["summary"] = json!(index.str_of("summary").filter(|s| !s.is_empty()).or(p.str_of("summary")).unwrap_or(""));
        }
        crate::js::assign(&mut pack, &rec);
        pack["updated"] = json!(now_ms());
        if curseforge::is_cf(&pid) {
            pack["blocked"] = result.get("blocked").cloned().unwrap_or(json!([]));
            pack["serverOnly"] = json!(index["serverOnly"].as_array().map_or(0, Vec::len));
        }
        self.insts.update(&id, &json!({ "mcVersion": mc, "loader": loader, "loaderVersion": lv, "packInstalled": true, "noreClient": nore, "pack": pack }))?;
        progress(json!({ "stage": "Gotowe", "done": 1, "total": 1 }));
        let mut out = result;
        out["instance"] = self.insts.require(&id)?;
        Ok(out)
    }

    /// Picks up blocked files the player downloaded by hand.
    pub async fn resolve_blocked(&self, inst_id: &str, dirs: &[PathBuf]) -> Result<Value> {
        let inst = self.insts.get(inst_id).filter(|i| truthy(&i["pack"])).ok_or_else(|| msg("To nie jest instancja modpacka."))?;
        let list = inst.pointer("/pack/blocked").and_then(Value::as_array).cloned().unwrap_or_default();
        let (found, rest) = find_downloaded(Path::new(&inst.string_or("gameDir", "")), &list, dirs).await?;
        let mut p = self.insts.require(inst_id)?["pack"].clone();
        p["blocked"] = json!(rest);
        self.insts.update(inst_id, &json!({ "pack": p }))?;
        Ok(json!({ "found": found, "blocked": rest }))
    }
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn mrpack_file(version: &Value) -> Result<Value> {
    let files = version["files"].as_array().cloned().unwrap_or_default();
    let is_pack = |f: &&Value| f.str_of("filename").is_some_and(|n| n.ends_with(".mrpack"));
    files.iter().filter(is_pack).find(|f| f.truthy_of("primary")).or(files.iter().find(is_pack)).cloned().ok_or_else(|| msg("Ta wersja nie zawiera pliku .mrpack."))
}

fn mc_of(v: &Value, inst: &Value) -> Value {
    let gv: Vec<&str> = v["game_versions"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let mc = inst.str_of("mcVersion").unwrap_or("");
    if gv.contains(&mc) {
        json!(mc)
    } else {
        gv.last().map(|s| json!(s)).unwrap_or(Value::Null)
    }
}

fn describe(v: &Value, inst: &Value) -> Value {
    let mc = mc_of(v, inst);
    json!({
        "versionId": v["id"], "version": v["version_number"], "name": v["name"], "type": v["version_type"], "date": v["date_published"],
        "changelog": truncate(v.str_of("changelog").unwrap_or(""), 4000), "mcVersion": mc, "loaders": v.get("loaders").cloned().unwrap_or(json!([])),
        "mcChanged": mc.as_str().is_some_and(|m| Some(m) != inst.str_of("mcVersion")), "current": inst.pointer("/pack/version").cloned().filter(truthy).unwrap_or(Value::Null),
    })
}

fn cf_describe(v: &Value, inst: &Value) -> Value {
    let gv: Vec<&str> = v["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let me = inst.str_of("mcVersion").unwrap_or("");
    let mc = if gv.contains(&me) { json!(me) } else { gv.last().map(|s| json!(s)).unwrap_or(Value::Null) };
    json!({
        "versionId": v["id"], "version": v["number"], "name": v["name"], "type": v["type"], "date": v["date"], "changelog": "", "mcVersion": mc, "loaders": [],
        "mcChanged": mc.as_str().is_some_and(|m| m != me), "current": inst.pointer("/pack/version").cloned().filter(truthy).unwrap_or(Value::Null),
    })
}

/// Swaps the old pack files for the new ones; everything removed / replaced goes to
/// `<gameDir>/.nore-backup/<time>-pack/`. On failure everything is put back.
#[allow(clippy::too_many_arguments)]
pub async fn swap_files(
    env: &Env,
    root: &Path,
    zip: &mut Zip,
    index: &Value,
    rec: &Value,
    old: &Value,
    progress: Progress<'_>,
    concurrency: usize,
    backup_worlds: bool,
    drop_nore: bool,
    label: &Value,
) -> Result<Value> {
    let backup = root.join(modrinth::BACKUP_DIR).join(format!("{}-pack", modrinth::stamp()));
    let state = Arc::new(Mutex::new((Vec::<String>::new(), Vec::<String>::new()))); // moved, created
    let mut tasks: Vec<PackTask> = Vec::new();
    let r = swap_inner(env, root, &backup, zip, index, rec, old, progress, concurrency, backup_worlds, drop_nore, label, &state, &mut tasks).await;
    if let Err(e) = r {
        progress(json!({ "stage": "Przywracanie poprzednich plików" }));
        let (moved, created) = state.lock().unwrap_or_else(|e| e.into_inner()).clone();
        for t in &tasks {
            let part = t.dest.with_file_name(format!("{}.{}.part", t.dest.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
            let _ = std::fs::remove_file(part);
        }
        for rel in &created {
            let _ = std::fs::remove_file(root.join(rel));
        }
        let mut lost = 0;
        for rel in moved.iter().rev() {
            let dest = root.join(rel);
            if let Some(d) = dest.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            if std::fs::rename(backup.join(rel), &dest).is_err() {
                lost += 1;
            }
        }
        if lost == 0 {
            let _ = std::fs::remove_dir_all(&backup);
        }
        return Err(e);
    }
    r
}

#[allow(clippy::too_many_arguments)]
async fn swap_inner(
    env: &Env,
    root: &Path,
    backup: &Path,
    zip: &mut Zip,
    index: &Value,
    rec: &Value,
    old: &Value,
    progress: Progress<'_>,
    concurrency: usize,
    backup_worlds: bool,
    drop_nore: bool,
    label: &Value,
    state: &Arc<Mutex<(Vec<String>, Vec<String>)>>,
    tasks: &mut Vec<PackTask>,
) -> Result<Value> {
    let exists = |rel: &str| root.join(rel).exists();
    let stash = |rel: &str| -> Result<()> {
        if inside(root, rel).is_none() || PROTECTED.is_match(rel) {
            return Ok(());
        }
        let dst = backup.join(rel);
        if let Some(d) = dst.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::rename(root.join(rel), dst)?;
        state.lock().unwrap_or_else(|e| e.into_inner()).0.push(rel.to_string());
        Ok(())
    };
    let created = |rel: &str| state.lock().unwrap_or_else(|e| e.into_inner()).1.push(rel.to_string());
    if backup_worlds && exists("saves") {
        progress(json!({ "stage": "Kopia zapasowa światów" }));
        let (from, to) = (root.join("saves"), backup.join("saves"));
        util::blocking(move || Ok(util::copy_recursive(&from, &to, true)?)).await?;
    }
    progress(json!({ "stage": "Porównywanie plików paczki" }));
    let strs = |v: &Value| v.as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect::<Vec<_>>();
    let old_set: Vec<String> = {
        let mut v: Vec<String> = Vec::new();
        for f in strs(&old["files"]).iter().map(|f| norm(f)) {
            if !v.contains(&f) {
                v.push(f);
            }
        }
        v
    };
    let new_files = client_files(index);
    let new_paths: HashSet<String> = strs(&rec["files"]).into_iter().collect();
    let new_projects: HashSet<String> = rec["ids"].as_object().into_iter().flatten().filter_map(|(_, v)| v.as_str().map(String::from)).collect();
    let mut found: Vec<(String, String)> = Vec::new();
    for (dir, kind) in [("mods", "mod"), ("resourcepacks", "resourcepack"), ("shaderpacks", "shader")] {
        if !new_paths.iter().any(|r| r.starts_with(&format!("{dir}/"))) || !exists(dir) {
            continue;
        }
        if let Ok(ids) = modrinth::identify(env, &root.join(dir), modrinth::exts_of(kind)).await {
            for (file, m) in ids {
                found.push((format!("{dir}/{file}"), m.string_or("projectId", "")));
            }
        }
    }
    let old_ids = old["ids"].as_object().cloned().unwrap_or_default();
    let mut disabled: HashSet<String> = HashSet::new();
    for rel in &old_set {
        if let Some(pid) = old_ids.get(rel).and_then(Value::as_str) {
            if !exists(rel) && exists(&format!("{rel}.disabled")) {
                disabled.insert(pid.into());
            }
        }
    }
    for (rel, pid) in &found {
        if rel.ends_with(".disabled") && !found.iter().any(|(r, p)| p == pid && !r.ends_with(".disabled")) {
            disabled.insert(pid.clone());
        }
    }
    let mut keep_paths: HashSet<String> = HashSet::new();
    for f in &new_files {
        let rel = norm(f.str_of("path").unwrap_or(""));
        if PROTECTED.is_match(&rel) || inside(root, &rel).is_none() {
            continue;
        }
        let url = first_download(f).unwrap_or("").to_string();
        let pid = cdn_project(&url);
        let mut dest_rel = rel.clone();
        if pid.as_ref().is_some_and(|p| disabled.contains(p)) || (!exists(&rel) && exists(&format!("{rel}.disabled"))) {
            dest_rel = format!("{rel}.disabled");
        }
        keep_paths.insert(dest_rel.clone());
        let sha = f.pointer("/hashes/sha1").and_then(Value::as_str).map(String::from);
        if exists(&dest_rel) {
            if let Some(s) = &sha {
                if net::is_valid(&root.join(&dest_rel), Some(s), None).await {
                    continue;
                }
            }
            stash(&dest_rel)?;
        } else {
            created(&dest_rel);
        }
        let blocked = f.get("blocked").filter(|b| truthy(b)).map(|b| {
            let mut b = b.clone();
            b["rel"] = json!(dest_rel);
            b
        });
        tasks.push(PackTask { url, dest: root.join(&dest_rel), rel: dest_rel, sha1: sha, size: f["fileSize"].as_u64(), name: util::basename(&rel), blocked });
    }
    progress(json!({ "stage": "Pobieranie nowych plików paczki", "done": 0, "total": tasks.len() }));
    let blocked = download_tasks(env, tasks, concurrency, &with_stage(progress, "Pobieranie nowych plików paczki")).await?;

    progress(json!({ "stage": "Usuwanie starych plików paczki" }));
    let mut removed = 0;
    for rel in &old_set {
        if new_paths.contains(rel) {
            continue;
        }
        for r in [rel.clone(), format!("{rel}.disabled")] {
            if !keep_paths.contains(&r) && exists(&r) {
                stash(&r)?;
                removed += 1;
            }
        }
    }
    for (rel, pid) in &found {
        if !new_projects.contains(pid) || keep_paths.contains(rel) || new_paths.contains(rel) || !exists(rel) {
            continue;
        }
        stash(rel)?;
        removed += 1;
    }
    if drop_nore && exists("mods/noreclient.jar") {
        stash("mods/noreclient.jar")?;
    }

    progress(json!({ "stage": "Aktualizowanie ustawień paczki" }));
    let (mut replaced, mut kept) = (0, Vec::<String>::new());
    let old_over = old["overrides"].as_object().cloned().unwrap_or_default();
    let new_over = rec["overrides"].as_object().cloned().unwrap_or_default();
    for (rel, entry) in override_entries(zip, &["overrides/", "client-overrides/"]) {
        let mut dest_rel = rel.clone();
        if CONTENT.is_match(&rel) && !exists(&rel) && exists(&format!("{rel}.disabled")) {
            dest_rel = format!("{rel}.disabled");
        }
        let Some(dest) = inside(root, &dest_rel) else { continue };
        let meta = std::fs::metadata(&dest).ok();
        if meta.as_ref().is_some_and(|m| !m.is_file()) {
            continue;
        }
        let current = match &meta {
            Some(_) => Some(net::sha1_file(&dest).await?),
            None => None,
        };
        let action = override_action(&rel, meta.is_some(), current.as_deref(), old_over.get(&rel).and_then(Value::as_str), new_over.get(&rel).and_then(Value::as_str));
        if action == "keep" {
            kept.push(rel.clone());
        }
        if action != "write" {
            continue;
        }
        if meta.is_some() {
            stash(&dest_rel)?;
            replaced += 1;
        } else {
            created(&dest_rel);
        }
        if let Some(d) = dest.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&dest, zip.read(&entry).unwrap_or_default())?;
    }
    for (rel, hash) in &old_over {
        if new_over.contains_key(rel) || new_paths.contains(rel) || !CONTENT.is_match(rel) || PROTECTED.is_match(rel) {
            continue;
        }
        let p = root.join(rel);
        if p.is_file() && net::sha1_file(&p).await.ok().as_deref() == hash.as_str() {
            stash(rel)?;
            removed += 1;
        }
    }
    let moved = state.lock().unwrap_or_else(|e| e.into_inner()).0.clone();
    let created_n = state.lock().unwrap_or_else(|e| e.into_inner()).1.len();
    let has_backup = !moved.is_empty() || backup.join("saves").exists();
    if has_backup {
        std::fs::create_dir_all(backup)?;
        let mut info = label.clone();
        info["date"] = json!(now_ms());
        info["moved"] = json!(moved);
        info["kept"] = json!(kept);
        std::fs::write(backup.join("nore-backup.json"), crate::config_edit::pretty(&info, "  "))?;
        modrinth::prune_backups(root, |n| n.ends_with("-pack"), 3).await;
    }
    Ok(json!({ "added": created_n, "removed": removed, "replaced": replaced, "kept": kept, "backup": if has_backup { json!(backup.to_string_lossy()) } else { Value::Null }, "blocked": blocked }))
}

/// Looks for blocked files (`{ file, rel, sha1 }`) in the folders – by name, also "name (1).jar",
/// and SHA-1 – and copies them under root. Returns (found file names, still missing records).
pub async fn find_downloaded(root: &Path, list: &[Value], dirs: &[PathBuf]) -> Result<(Vec<Value>, Vec<Value>)> {
    static COPY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ ?\(\d+\)$").unwrap());
    let listings: Vec<(PathBuf, Vec<String>)> = dirs.iter().map(|d| (d.clone(), util::read_dir_names(d))).collect();
    let (mut found, mut rest) = (vec![], vec![]);
    for b in list {
        let Some(dest) = inside(root, b.str_of("rel").unwrap_or("")) else { continue };
        let sha = b.str_of("sha1");
        let file = b.string_or("file", "");
        if net::is_valid(&dest, sha, None).await {
            found.push(json!(file));
            continue;
        }
        let (stem, ext) = match file.rfind('.') {
            Some(i) if i > 0 => (&file[..i], &file[i..]),
            _ => (file.as_str(), ""),
        };
        let mut hit = None;
        'outer: for (dir, names) in &listings {
            for n in names {
                let copy = n.len() > stem.len() + ext.len() && n.starts_with(stem) && n.ends_with(ext) && COPY.is_match(&n[stem.len()..n.len() - ext.len()]);
                if n != &file && !copy {
                    continue;
                }
                let full = dir.join(n);
                if net::is_valid(&full, sha, None).await {
                    hit = Some(full);
                    break 'outer;
                }
            }
        }
        let Some(h) = hit else {
            rest.push(b.clone());
            continue;
        };
        if let Some(d) = dest.parent() {
            tokio::fs::create_dir_all(d).await?;
        }
        tokio::fs::copy(&h, &dest).await?;
        found.push(json!(file));
    }
    Ok((found, rest))
}

/// Paths of a modpack instance that belong to the pack (None when unknown – older installs).
pub fn pack_file_set(inst: &Value) -> Option<HashSet<String>> {
    if inst.str_of("modpack") != Some("pack") || !truthy(&inst["pack"]) {
        return Some(HashSet::new());
    }
    inst.pointer("/pack/files").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
}

/// Keeps a modpack's file list in sync when one of its files is updated on its own.
pub fn remap_pack_files(insts: &Instances<'_>, inst: &Value, dir: &Path, updates: &[Value]) {
    let Some(files) = inst.pointer("/pack/files").and_then(Value::as_array) else { return };
    let game = PathBuf::from(inst.string_or("gameDir", ""));
    let rel = dir.strip_prefix(&game).map(|r| r.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")).unwrap_or_default();
    let mut files: Vec<Value> = files.clone();
    let mut ids: Map<String, Value> = inst.pointer("/pack/ids").and_then(Value::as_object).cloned().unwrap_or_default();
    let mut changed = false;
    for u in updates {
        let from = format!("{rel}/{}", u.str_of("oldFile").unwrap_or(""));
        let to = format!("{rel}/{}", u.str_of("newFile").unwrap_or(""));
        let Some(k) = files.iter().position(|f| f.as_str() == Some(&from)) else { continue };
        if from == to {
            continue;
        }
        files[k] = json!(to);
        if let Some(v) = ids.remove(&from) {
            ids.insert(to, v);
        }
        changed = true;
    }
    if changed {
        if let Some(mut p) = insts.get(inst.str_of("id").unwrap_or("")).map(|i| i["pack"].clone()) {
            p["files"] = json!(files);
            p["ids"] = Value::Object(ids);
            let _ = insts.update(inst.str_of("id").unwrap_or(""), &json!({ "pack": p }));
        }
    }
}

/// `HashMap` of `.mrpack` metadata for importers / previews.
pub fn inspect(file: &Path) -> Result<Value> {
    let (_, index) = read_pack(file)?;
    let deps = &index["dependencies"];
    let (loader, lv) = loader_of(deps);
    let _ = HashMap::<(), ()>::new();
    Ok(json!({ "name": index["name"], "version": index["versionId"], "mcVersion": deps["minecraft"], "loader": loader, "loaderVersion": lv, "files": index["files"].as_array().map_or(0, Vec::len) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// modpacks.test.js: override merge – player changes are kept, untouched pack files follow the pack.
    #[test]
    fn override_merge() {
        assert_eq!(override_action("saves/w/level.dat", true, Some("a"), Some("b"), Some("c")), "skip");
        assert_eq!(override_action("config/x.toml", false, None, None, Some("n")), "write");
        assert_eq!(override_action("config/x.toml", true, Some("n"), Some("o"), Some("n")), "skip");
        assert_eq!(override_action("config/x.toml", true, Some("o"), Some("o"), Some("n")), "write");
        assert_eq!(override_action("config/x.toml", true, Some("mine"), Some("o"), Some("n")), "keep");
        assert_eq!(override_action("mods/a.jar", true, Some("mine"), Some("o"), Some("n")), "write");
        assert_eq!(override_action("./options.txt", true, Some("mine"), None, Some("n")), "keep");
    }

    /// modpacks.test.js: pack record – index paths, Modrinth projects and override hashes.
    #[test]
    fn record() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("p.mrpack");
        util::write_zip(&f, vec![
            ("modrinth.index.json".into(), b"{}".to_vec()),
            ("overrides/config/a.toml".into(), b"a".to_vec()),
            ("overrides/options.txt".into(), b"o".to_vec()),
            ("client-overrides/options.txt".into(), b"c".to_vec()),
        ])
        .unwrap();
        let mut zip = Zip::open(&f).unwrap();
        let index = json!({ "files": [
            { "path": "mods/sodium.jar", "downloads": ["https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar"] },
            { "path": ".\\mods\\server.jar", "downloads": ["https://x/s.jar"], "env": { "client": "unsupported" } },
            { "path": "resourcepacks/p.zip", "downloads": ["https://github.com/p.zip"] },
        ]});
        let r = pack_record(&index, &mut zip);
        assert_eq!(r["files"], json!(["mods/sodium.jar", "resourcepacks/p.zip"]));
        assert_eq!(r["ids"], json!({ "mods/sodium.jar": "AANobbMI" }));
        assert_eq!(r["overrides"]["options.txt"], json!(sha1_hex(b"c")));
        assert_eq!(r["overrides"]["config/a.toml"], json!(sha1_hex(b"a")));
        assert_eq!(loader_of(&json!({ "minecraft": "1.21.1", "fabric-loader": "0.16.9" })), ("fabric".into(), Some("0.16.9".into())));
        assert_eq!(loader_of(&json!({ "minecraft": "1.21.1" })), ("vanilla".into(), None));
    }

    /// curseforge.test.js: blocked files downloaded by hand are picked up from Downloads (also "name (1).jar").
    #[tokio::test]
    async fn blocked_from_downloads() {
        let d = tempfile::tempdir().unwrap();
        let (root, dl) = (d.path().join("inst"), d.path().join("Downloads"));
        std::fs::create_dir_all(&dl).unwrap();
        std::fs::write(dl.join("a.jar"), b"wrong").unwrap();
        std::fs::write(dl.join("a (1).jar"), b"right").unwrap();
        std::fs::write(dl.join("b.zip"), b"bee").unwrap();
        let list = vec![
            json!({ "file": "a.jar", "rel": "mods/a.jar", "sha1": sha1_hex(b"right") }),
            json!({ "file": "b.zip", "rel": "resourcepacks/b.zip", "sha1": sha1_hex(b"bee") }),
            json!({ "file": "c.jar", "rel": "mods/c.jar", "sha1": sha1_hex(b"cee") }),
            json!({ "file": "x.jar", "rel": "../x.jar", "sha1": "0" }),
        ];
        let (found, rest) = find_downloaded(&root, &list, &[dl.clone()]).await.unwrap();
        assert_eq!(found, vec![json!("a.jar"), json!("b.zip")]);
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0]["file"], "c.jar");
        assert_eq!(std::fs::read(root.join("mods/a.jar")).unwrap(), b"right");
        // already in place: found without looking again
        let (found, _) = find_downloaded(&root, &list[..1], &[]).await.unwrap();
        assert_eq!(found, vec![json!("a.jar")]);
    }
}
