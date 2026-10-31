//! Content for local servers from Modrinth (port of launcher/src/main/server-content.js): plugins,
//! server mods, datapacks, modpacks (.mrpack, server pack .zip), client-only mod detection and
//! update checks. `srv` is the public server record (with `dir`).

use crate::curseforge::Cf;
use crate::error::{msg, Result};
use crate::js::{truthy, ValueExt};
use crate::util::{self, inside, sha1_hex, Zip};
use crate::{modrinth, net, Env};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

const API: &str = modrinth::API;

pub fn plugin_loaders(t: &str) -> Option<&'static [&'static str]> {
    Some(match t {
        "paper" => &["paper", "spigot", "bukkit", "purpur"],
        "purpur" => &["purpur", "paper", "spigot", "bukkit"],
        "folia" => &["folia"],
        "velocity" => &["velocity"],
        "bungeecord" => &["bungeecord", "waterfall"],
        _ => return None,
    })
}

pub fn mod_loaders(t: &str) -> Option<&'static [&'static str]> {
    Some(match t {
        "fabric" => &["fabric"],
        "quilt" => &["quilt", "fabric"],
        "forge" => &["forge"],
        "neoforge" => &["neoforge"],
        _ => return None,
    })
}

pub fn is_proxy(t: &str) -> bool {
    t == "velocity" || t == "bungeecord"
}

/// Version types allowed by Settings → update channel.
pub fn version_types(channel: &str) -> Vec<&'static str> {
    modrinth::channel_types(channel)
}

/// Which kinds of content a server type can use.
pub fn kinds_for(t: &str) -> Vec<&'static str> {
    let mut k = Vec::new();
    if plugin_loaders(t).is_some() {
        k.push("plugin");
    }
    if mod_loaders(t).is_some() {
        k.push("mod");
    }
    if !is_proxy(t) {
        k.push("datapack");
    }
    if mod_loaders(t).is_some() {
        k.push("modpack");
    }
    k
}

fn loaders_for(t: &str, kind: &str) -> Vec<&'static str> {
    match kind {
        "plugin" => plugin_loaders(t).unwrap_or(&[]).to_vec(),
        "mod" | "modpack" => mod_loaders(t).unwrap_or(&[]).to_vec(),
        _ => vec!["datapack"],
    }
}

pub fn world_name(srv: &Value) -> String {
    srv.pointer("/props/level-name").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("world").to_string()
}

pub fn dir_of(srv: &Value) -> PathBuf {
    PathBuf::from(srv.string_or("dir", ""))
}

pub fn folder_of(srv: &Value, kind: &str) -> PathBuf {
    let d = dir_of(srv);
    match kind {
        "plugin" => d.join("plugins"),
        "mod" => d.join("mods"),
        _ => d.join(world_name(srv)).join("datapacks"),
    }
}

fn ty(srv: &Value) -> &str {
    srv.str_of("type").unwrap_or("")
}

pub async fn search(env: &Env, srv: &Value, o: &Value) -> Result<Value> {
    let kind = o.str_of("kind").unwrap_or("plugin");
    let cats = |k: &str| loaders_for(ty(srv), k).iter().map(|l| format!("categories:{l}")).collect::<Vec<_>>();
    let mut facets: Vec<Vec<String>> = Vec::new();
    match kind {
        "plugin" => {
            facets.push(vec!["project_type:plugin".into()]);
            facets.push(cats(kind));
        }
        "mod" | "modpack" => {
            facets.push(vec![format!("project_type:{kind}")]);
            facets.push(cats(kind));
            facets.push(vec!["server_side:required".into(), "server_side:optional".into()]);
        }
        _ => facets.push(vec!["project_type:datapack".into()]),
    }
    if kind != "modpack" && !is_proxy(ty(srv)) {
        facets.push(vec![format!("versions:{}", srv.string_or("mcVersion", ""))]);
    }
    let url = modrinth::with_params(
        &format!("{API}/search"),
        &[
            ("query", o.string_or("query", "")),
            ("index", o.string_or("sort", "relevance")),
            ("offset", o.get("offset").and_then(Value::as_i64).unwrap_or(0).to_string()),
            ("limit", "20".into()),
            ("facets", serde_json::to_string(&facets).unwrap_or_default()),
        ],
    );
    env.net.get_json(&url).await
}

async fn best_version(env: &Env, project: &str, loaders: &[&str], game_version: Option<&str>) -> Result<Option<Value>> {
    let mut p = Vec::new();
    if let Some(gv) = game_version.filter(|s| !s.is_empty()) {
        p.push(("game_versions", serde_json::to_string(&[gv]).unwrap_or_default()));
    }
    if !loaders.is_empty() {
        p.push(("loaders", serde_json::to_string(loaders).unwrap_or_default()));
    }
    let list: Vec<Value> = env.net.get_json(&modrinth::with_params(&format!("{API}/project/{}/version", urlencoding::encode(project)), &p)).await?;
    Ok(list.iter().find(|v| v.str_of("version_type") == Some("release")).or(list.first()).cloned())
}

/// Installs a plugin / mod / datapack (mods also get their required dependencies).
pub fn install<'a>(env: &'a Env, srv: &'a Value, kind: &'a str, project_id: String, on_status: modrinth::StatusFn<'a>, seen: &'a mut HashSet<String>) -> futures::future::BoxFuture<'a, Result<Vec<String>>> {
    Box::pin(async move {
        if !seen.insert(project_id.clone()) {
            return Ok(vec![]);
        }
        let gv = if is_proxy(ty(srv)) { None } else { srv.str_of("mcVersion") };
        let version = best_version(env, &project_id, &loaders_for(ty(srv), kind), gv).await?.ok_or_else(|| msg(format!("Brak wersji zgodnej z {} {}", ty(srv), srv.string_or("mcVersion", ""))))?;
        let file = modrinth::primary_file(&version).ok_or_else(|| msg("Wersja nie ma plików"))?;
        let name = util::basename(file.str_of("filename").unwrap_or(""));
        let dir = folder_of(srv, kind);
        tokio::fs::create_dir_all(&dir).await?;
        on_status(format!("Pobieranie {name}"));
        env.net.download(file.str_of("url").unwrap_or(""), &dir.join(&name), file.pointer("/hashes/sha1").and_then(Value::as_str), file["size"].as_u64(), &|_| {}).await?;
        let mut out = vec![name];
        if kind != "datapack" {
            for dep in version["dependencies"].as_array().cloned().unwrap_or_default() {
                let Some(pid) = dep.str_of("project_id").filter(|_| dep.str_of("dependency_type") == Some("required")) else { continue };
                match install(env, srv, kind, pid.to_string(), on_status, seen).await {
                    Ok(more) => out.extend(more),
                    Err(e) => on_status(format!("Pominięto zależność: {e}")),
                }
            }
        }
        Ok(out)
    })
}

/// Name / version from plugin.yml, fabric.mod.json, quilt.mod.json or mods.toml.
pub fn describe_jar(file: &Path) -> Value {
    let Ok(mut zip) = Zip::open(file) else { return json!({}) };
    if let Some(yml) = zip.text("plugin.yml").or_else(|| zip.text("paper-plugin.yml")) {
        let get = |k: &str| Regex::new(&format!(r#"(?m)^{k}:\s*['"]?([^'"\r\n]+)"#)).ok().and_then(|r| r.captures(&yml).map(|c| c[1].trim().to_string()));
        return json!({ "name": get("name"), "version": get("version"), "description": get("description") });
    }
    if let Some(j) = zip.text("fabric.mod.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        return json!({ "name": j.get("name").filter(|v| truthy(v)).unwrap_or(&j["id"]), "version": j["version"], "description": j["description"], "clientOnly": j.str_of("environment") == Some("client") });
    }
    if let Some(j) = zip.text("quilt.mod.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        let q = &j["quilt_loader"];
        return json!({ "name": q.pointer("/metadata/name").filter(|v| truthy(v)).unwrap_or(&q["id"]), "version": q["version"], "description": q.pointer("/metadata/description"), "clientOnly": j.pointer("/minecraft/environment").and_then(Value::as_str) == Some("client") });
    }
    if let Some(t) = zip.text("META-INF/neoforge.mods.toml").or_else(|| zip.text("META-INF/mods.toml")) {
        let get = |k: &str| Regex::new(&format!(r#"(?m)^\s*{k}\s*=\s*"([^"]+)""#)).ok().and_then(|r| r.captures(&t).map(|c| c[1].to_string()));
        return json!({ "name": get("displayName").or_else(|| get("modId")), "version": get("version"), "description": get("description") });
    }
    json!({})
}

pub async fn list_installed(srv: &Value) -> Value {
    static BUILTIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(bukkit|paper)$").unwrap());
    static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(jar|zip)$").unwrap());
    let srv = srv.clone();
    let mut out = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for kind in kinds_for(ty(&srv)).into_iter().filter(|k| *k != "modpack") {
            let dir = folder_of(&srv, kind);
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                let enabled = !name.ends_with(".disabled");
                let base = if enabled { name.clone() } else { name[..name.len() - 9].to_string() };
                let is_jar = base.to_lowercase().ends_with(".jar");
                let is_dir = e.file_type().is_ok_and(|t| t.is_dir());
                if kind != "datapack" && !is_jar {
                    continue;
                }
                if kind == "datapack" && !is_dir && !base.to_lowercase().ends_with(".zip") {
                    continue;
                }
                if kind == "datapack" && is_dir && BUILTIN.is_match(&base) {
                    continue;
                }
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                let info = if is_jar { describe_jar(&e.path()) } else { json!({}) };
                out.push(json!({
                    "kind": kind, "file": name, "name": info.str_of("name").filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| EXT.replace(&base, "").to_string()),
                    "version": info.str_of("version").unwrap_or(""), "description": info.str_of("description").unwrap_or(""), "enabled": enabled, "size": size, "dir": is_dir, "clientOnly": info.truthy_of("clientOnly"),
                }));
            }
        }
        out
    })
    .await
    .unwrap_or_default();
    out.sort_by(|a, b| util::locale_cmp(a.str_of("name").unwrap_or(""), b.str_of("name").unwrap_or("")));
    json!(out)
}

/// Disables mods that only work on the client (they crash a dedicated server); returns their names.
pub async fn disable_client_only(srv: &Value) -> Vec<String> {
    if mod_loaders(ty(srv)).is_none() {
        return vec![];
    }
    let dir = folder_of(srv, "mod");
    let mut off = Vec::new();
    for f in util::read_dir_names(&dir).into_iter().filter(|f| f.to_lowercase().ends_with(".jar")) {
        if describe_jar(&dir.join(&f)).truthy_of("clientOnly") && std::fs::rename(dir.join(&f), dir.join(format!("{f}.disabled"))).is_ok() {
            off.push(f);
        }
    }
    off
}

pub async fn set_enabled(srv: &Value, kind: &str, file: &str, enabled: bool) -> Result<String> {
    let dir = folder_of(srv, kind);
    let file = util::safe_name(file)?;
    let base = file.strip_suffix(".disabled").unwrap_or(&file).to_string();
    let target = if enabled { base } else { format!("{base}.disabled") };
    if target != file {
        tokio::fs::rename(dir.join(&file), dir.join(&target)).await?;
    }
    Ok(target)
}

pub async fn remove(srv: &Value, kind: &str, file: &str) -> Result<()> {
    let p = folder_of(srv, kind).join(util::safe_name(file)?);
    if p.is_dir() {
        let _ = tokio::fs::remove_dir_all(p).await;
    } else {
        let _ = tokio::fs::remove_file(p).await;
    }
    Ok(())
}

/// Copies files chosen by the user (jar → plugins/mods by server type, zip → datapacks).
pub async fn add_files(srv: &Value, files: &[PathBuf]) -> Result<Vec<String>> {
    let mut added = Vec::new();
    for f in files {
        let lower = f.to_string_lossy().to_lowercase();
        let kind = if lower.ends_with(".jar") {
            if plugin_loaders(ty(srv)).is_some() {
                Some("plugin")
            } else if mod_loaders(ty(srv)).is_some() {
                Some("mod")
            } else {
                None
            }
        } else if lower.ends_with(".zip") {
            if is_server_pack(f) {
                None
            } else {
                Some("datapack")
            }
        } else {
            None
        };
        let Some(kind) = kind else { continue };
        let dir = folder_of(srv, kind);
        tokio::fs::create_dir_all(&dir).await?;
        let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        tokio::fs::copy(f, dir.join(&name)).await?;
        added.push(name);
    }
    Ok(added)
}

/// Newer Modrinth versions for installed plugins / mods (matched by file hash).
pub async fn check_updates(env: &Env, srv: &Value, channel: &str) -> Vec<Value> {
    let mut updates = Vec::new();
    for kind in ["plugin", "mod"] {
        if !kinds_for(ty(srv)).contains(&kind) {
            continue;
        }
        let dir = folder_of(srv, kind);
        let mut files: Vec<String> = util::read_dir_names(&dir).into_iter().filter(|f| f.ends_with(".jar")).collect();
        files.sort();
        if files.is_empty() {
            continue;
        }
        let mut hashes: Map<String, Value> = Map::new();
        for f in &files {
            if let Ok(h) = net::sha1_file(&dir.join(f)).await {
                hashes.insert(h, json!(f));
            }
        }
        let mut body = json!({ "hashes": hashes.keys().collect::<Vec<_>>(), "algorithm": "sha1", "loaders": loaders_for(ty(srv), kind) });
        if !is_proxy(ty(srv)) {
            body["game_versions"] = json!([srv["mcVersion"]]);
        }
        body["version_types"] = json!(version_types(channel));
        let Ok(Some(map)) = env.net.post_json(&format!("{API}/version_files/update"), &body).await else { continue };
        for (hash, v) in map.as_object().into_iter().flatten() {
            let Some(file) = modrinth::primary_file(v) else { continue };
            if file.pointer("/hashes/sha1").and_then(Value::as_str) == Some(hash) {
                continue;
            }
            updates.push(json!({
                "kind": kind, "oldFile": hashes.get(hash), "newFile": file["filename"], "url": file["url"], "sha1": file["hashes"]["sha1"], "size": file["size"],
                "version": v["version_number"], "type": v["version_type"], "projectId": v["project_id"], "versionId": v["id"], "source": "modrinth",
            }));
        }
    }
    updates
}

pub async fn apply_updates(env: &Env, srv: &Value, updates: &[Value], on_status: &(dyn Fn(String) + Send + Sync)) -> Result<usize> {
    for u in updates {
        let dir = folder_of(srv, u.str_of("kind").unwrap_or("plugin"));
        let new = util::safe_name(u.str_of("newFile").unwrap_or(""))?;
        let old = util::basename(u.str_of("oldFile").unwrap_or(""));
        on_status(format!("Aktualizacja {new}"));
        env.net.download(u.str_of("url").unwrap_or(""), &dir.join(&new), u.str_of("sha1"), u["size"].as_u64(), &|_| {}).await?;
        if old != new && !old.is_empty() {
            move_to_backup(srv, &dir.join(&old), "aktualizacja").await;
        }
    }
    Ok(updates.len())
}

/// Old files go to .nore-backup/<label-date>/ instead of being deleted (keeps the newest 5).
pub async fn move_to_backup(srv: &Value, file: &Path, label: &str) {
    let base = dir_of(srv);
    let Ok(rel) = file.strip_prefix(&base) else { return };
    if !file.exists() {
        return;
    }
    let root = base.join(".nore-backup");
    let dest = root.join(format!("{label}-{}", util::stamp_dash(13))).join(rel);
    let (f, d) = (file.to_path_buf(), dest.clone());
    let _ = util::blocking(move || Ok(util::move_path(&f, &d)?)).await;
    let mut all = util::read_dir_names(&root);
    all.sort();
    let n = all.len().saturating_sub(5);
    for old in all.into_iter().take(n) {
        let _ = tokio::fs::remove_dir_all(root.join(old)).await;
    }
}

/// Versions of a modpack usable on this server's loader.
pub async fn modpack_versions(env: &Env, srv: &Value, project_id: &str) -> Result<Vec<Value>> {
    let loaders: Vec<&str> = mod_loaders(ty(srv)).map(|l| l.to_vec()).unwrap_or_else(|| vec!["fabric", "quilt", "forge", "neoforge"]);
    let url = modrinth::with_params(&format!("{API}/project/{}/version", urlencoding::encode(project_id)), &[("loaders", serde_json::to_string(&loaders).unwrap_or_default())]);
    let list: Vec<Value> = env.net.get_json(&url).await?;
    Ok(list
        .iter()
        .filter(|v| v["files"].as_array().is_some_and(|f| f.iter().any(|x| x.str_of("filename").is_some_and(|n| n.ends_with(".mrpack")))))
        .map(|v| {
            json!({ "id": v["id"], "number": v["version_number"], "name": v["name"], "type": v["version_type"], "date": v["date_published"],
            "mcVersion": v["game_versions"].get(0), "gameVersions": v.get("game_versions").cloned().unwrap_or(json!([])), "loaders": v["loaders"],
            "changelog": v.str_of("changelog").unwrap_or("").chars().take(3000).collect::<String>() })
        })
        .collect())
}

/// Newest pack version allowed by the update channel, or null when the server is up to date.
pub async fn modpack_update(env: &Env, srv: &Value, channel: &str) -> Result<Value> {
    let Some(pid) = srv.pointer("/pack/projectId").and_then(Value::as_str).filter(|s| !s.is_empty()) else { return Ok(Value::Null) };
    let types = version_types(channel);
    let mc = srv.string_or("mcVersion", "");
    let mut list: Vec<Value> = modpack_versions(env, srv, pid)
        .await?
        .into_iter()
        .filter(|v| types.contains(&v.str_of("type").unwrap_or("")) && v["gameVersions"].as_array().is_some_and(|g| g.iter().any(|x| x.as_str() == Some(&mc))))
        .collect();
    list.sort_by_key(|v| std::cmp::Reverse(util::parse_date(v.str_of("date").unwrap_or(""))));
    let cur = srv.pointer("/pack/versionId").map(crate::config_edit::js_string).unwrap_or_default();
    let Some(newest) = list.first().cloned() else { return Ok(Value::Null) };
    if newest.str_of("id") == Some(&cur) {
        return Ok(Value::Null);
    }
    if let Some(c) = list.iter().find(|v| v.str_of("id") == Some(&cur)) {
        if util::parse_date(c.str_of("date").unwrap_or("")) >= util::parse_date(newest.str_of("date").unwrap_or("")) {
            return Ok(Value::Null);
        }
    }
    let mut out = newest.clone();
    out["mcChanged"] = json!(newest.str_of("mcVersion").is_some_and(|m| m != mc));
    Ok(out)
}

fn loader_of(deps: &Value, fallback: &str) -> String {
    for (k, l) in [("fabric-loader", "fabric"), ("quilt-loader", "quilt"), ("neoforge", "neoforge"), ("forge", "forge")] {
        if deps.get(k).is_some_and(truthy) {
            return l.into();
        }
    }
    fallback.into()
}

/// Overrides land unless the server owner changed that file since the pack wrote it.
pub fn override_action(rel: &str, existing: Option<&str>, old_hash: Option<&str>, first_install: bool) -> &'static str {
    static W: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(world|world_nether|world_the_end)/").unwrap());
    static C: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(mods|plugins)/").unwrap());
    if W.is_match(rel) {
        return "skip";
    }
    if existing.is_none() || first_install {
        return "write";
    }
    if C.is_match(rel) {
        return "write";
    }
    if old_hash.is_some() && existing == old_hash {
        "write"
    } else {
        "keep"
    }
}

/// Installs or updates a Modrinth modpack on the server. source: `{ projectId, versionId }` or `{ file }`.
pub async fn install_modpack(env: &Env, srv: &Value, source: &Value, on_status: &(dyn Fn(String) + Send + Sync)) -> Result<Value> {
    let base = dir_of(srv);
    let mut file = source.str_of("file").map(PathBuf::from);
    let mut version = Value::Null;
    let mut tmp = None;
    if file.is_none() {
        let pid = source.string_or("projectId", "");
        if let Some(v) = source.str_of("versionId").filter(|s| !s.is_empty()) {
            version = env.net.get_json(&format!("{API}/version/{}", urlencoding::encode(v))).await?;
        } else {
            let list = modpack_versions(env, srv, &pid).await?;
            if let Some(pick) = list.iter().find(|v| v.str_of("type") == Some("release")).or(list.first()) {
                version = env.net.get_json(&format!("{API}/version/{}", urlencoding::encode(pick.str_of("id").unwrap_or("")))).await?;
            }
        }
        if version.is_null() {
            return Err(msg(format!("Ta paczka nie ma wersji dla {}", ty(srv))));
        }
        let f = crate::modpacks::mrpack_file(&version).map_err(|_| msg("Ta wersja nie zawiera pliku .mrpack"))?;
        let t = base.join(".nore-modpack.mrpack");
        on_status(format!("Pobieranie paczki {}", f.string_or("filename", "")));
        env.net.download(f.str_of("url").unwrap_or(""), &t, f.pointer("/hashes/sha1").and_then(Value::as_str), f["size"].as_u64(), &|_| {}).await?;
        tmp = Some(t.clone());
        file = Some(t);
    }
    let file = file.unwrap_or_default();
    let r = async {
        let mut zip = Zip::open(&file)?;
        let index = zip.json("modrinth.index.json").ok_or_else(|| msg("To nie jest paczka Modrinth (.mrpack)"))?;
        let deps = index["dependencies"].clone();
        let old = srv.get("pack").cloned().filter(truthy).unwrap_or(json!({}));
        let files: Vec<Value> = index["files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| f.pointer("/env/server").and_then(Value::as_str) != Some("unsupported") && f["downloads"].as_array().is_some_and(|d| !d.is_empty()) && inside(&base, f.str_of("path").unwrap_or("")).is_some())
            .cloned()
            .collect();
        let new_paths: Vec<String> = files.iter().map(|f| f.string_or("path", "")).collect();
        for rel in old["files"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if new_paths.iter().any(|p| p == rel) {
                continue;
            }
            if let Some(p) = inside(&base, rel) {
                move_to_backup(srv, &p, "modpack").await;
                move_to_backup(srv, &PathBuf::from(format!("{}.disabled", p.display())), "modpack").await;
            }
        }
        let tasks: Vec<net::Task> = files
            .iter()
            .filter_map(|f| {
                Some(net::Task {
                    url: f["downloads"][0].as_str()?.to_string(),
                    dest: inside(&base, f.str_of("path")?)?,
                    sha1: f.pointer("/hashes/sha1").and_then(Value::as_str).map(String::from),
                    size: f["fileSize"].as_u64(),
                    name: util::basename(f.str_of("path").unwrap_or("")),
                })
            })
            .collect();
        let last = std::sync::Mutex::new(usize::MAX);
        env.net
            .download_all(
                tasks,
                8,
                &|p| {
                    let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
                    if p.done != *l {
                        *l = p.done;
                        on_status(format!("Pliki paczki {}/{}", p.done, p.total));
                    }
                },
                None,
            )
            .await?;
        let mut overrides = Map::new();
        let first = !old["files"].is_array();
        for (rel, entry) in crate::modpacks::override_entries(&zip, &["overrides/", "server-overrides/"]) {
            let Some(dest) = inside(&base, &rel) else { continue };
            let Some(data) = zip.read(&entry) else { continue };
            let existing = std::fs::read(&dest).ok().map(|b| sha1_hex(&b));
            let act = override_action(&rel, existing.as_deref(), old["overrides"].get(&rel).and_then(Value::as_str), first);
            overrides.insert(rel.clone(), json!(sha1_hex(&data)));
            if act != "write" {
                continue;
            }
            if let Some(d) = dest.parent() {
                std::fs::create_dir_all(d)?;
            }
            std::fs::write(&dest, data)?;
        }
        let lv = ["fabric-loader", "quilt-loader", "neoforge", "forge"].iter().find_map(|k| deps.get(*k).filter(|v| truthy(v)).map(crate::config_edit::js_string)).unwrap_or_default();
        Ok(json!({
            "name": index["name"], "mcVersion": deps.get("minecraft").filter(|v| truthy(v)).cloned().unwrap_or(srv["mcVersion"].clone()), "type": loader_of(&deps, ty(srv)),
            "files": files.len(), "loaderVersion": lv,
            "pack": {
                "projectId": source.get("projectId").filter(|v| truthy(v)).cloned().or_else(|| version.get("project_id").cloned()).unwrap_or(Value::Null),
                "versionId": if version.is_null() { Value::Null } else { version["id"].clone() },
                "version": if version.is_null() { index.get("versionId").cloned().unwrap_or(json!("")) } else { version["version_number"].clone() },
                "title": index["name"], "files": new_paths, "overrides": overrides,
            },
        }))
    }
    .await;
    if let Some(t) = tmp {
        let _ = tokio::fs::remove_file(t).await;
    }
    r
}

/// A CurseForge / FTB style server pack: a zip with mods/ (maybe inside one top folder).
pub fn is_server_pack(file: &Path) -> bool {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^([^/]+/)?mods/[^/]+\.jar$").unwrap());
    Zip::open(file).is_ok_and(|z| z.names().iter().any(|n| R.is_match(n)))
}

/// Unpacks a server pack zip into the server folder (one shared top folder is stripped).
pub async fn install_server_pack(srv: &Value, file: &Path, on_status: &(dyn Fn(String) + Send + Sync)) -> Result<Value> {
    static SKIP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(world|world_nether|world_the_end)/").unwrap());
    static CFG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(eula\.txt|server\.properties)$").unwrap());
    static INST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(neoforge|forge)-(\d+\.\d+(?:\.\d+)?)-?([\d.]*)-installer\.jar$").unwrap());
    static FAB: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(fabric)-server-mc\.([\d.]+)-loader").unwrap());
    let base = dir_of(srv);
    let mut zip = Zip::open(file)?;
    let names = zip.names();
    let tops: HashSet<&str> = names.iter().map(|n| n.split('/').next().unwrap_or("")).collect();
    let strip = if tops.len() == 1 && names.iter().all(|n| n.contains('/')) { format!("{}/", tops.iter().next().copied().unwrap_or("")) } else { String::new() };
    let (mut n, mut loader, mut mc): (usize, Option<String>, Option<String>) = (0, None, None);
    for e in &names {
        let rel = &e[strip.len().min(e.len())..];
        if rel.is_empty() || SKIP.is_match(rel) || CFG.is_match(rel) {
            continue;
        }
        let Some(dest) = inside(&base, rel) else { continue };
        let Some(data) = zip.read(e) else { continue };
        if let Some(d) = dest.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&dest, data)?;
        n += 1;
        if n % 50 == 0 {
            on_status(format!("Rozpakowywanie {n}/{}", names.len()));
        }
        let b = util::basename(rel);
        if let Some(c) = INST.captures(&b).or_else(|| FAB.captures(&b)) {
            let l = c[1].to_lowercase();
            mc = if l == "neoforge" { None } else { Some(c[2].to_string()) };
            loader = Some(l);
        }
    }
    if let Ok(t) = std::fs::read_to_string(base.join("variables.txt")) {
        static MCV: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"MINECRAFT_VERSION=([\d.]+)").unwrap());
        static ML: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"MODLOADER=(\w+)").unwrap());
        mc = mc.or_else(|| MCV.captures(&t).map(|c| c[1].to_string()));
        loader = loader.or_else(|| ML.captures(&t).map(|c| c[1].to_lowercase()).filter(|s| !s.is_empty()));
    }
    let t = loader.filter(|l| mod_loaders(l).is_some());
    Ok(json!({ "files": n, "type": t, "mcVersion": mc }))
}

/// Updates from every source: Modrinth (hash), CurseForge (fingerprint) and Hangar; pinned left out.
pub async fn check_all_updates(env: &Env, cf: &Cf, srv: &Value, channel: &str, pins: &[Value]) -> Vec<Value> {
    let mut ups = check_updates(env, srv, channel).await;
    let known: HashSet<String> = ups.iter().filter_map(|u| u.str_of("oldFile").map(String::from)).collect();
    for kind in ["plugin", "mod"] {
        if !kinds_for(ty(srv)).contains(&kind) {
            continue;
        }
        let dir = folder_of(srv, kind);
        let mr = modrinth::identify(env, &dir, &[".jar"]).await.unwrap_or_default();
        let skip: HashSet<String> = mr.keys().cloned().chain(known.iter().cloned()).collect();
        let loader = if kind == "mod" { ty(srv) } else { "" };
        let list = cf.check_updates(env, &dir, "mod", srv.str_of("mcVersion").unwrap_or(""), loader, &version_types(channel), &skip).await.unwrap_or_default();
        ups.extend(list.into_iter().map(|mut u| {
            u["kind"] = json!(kind);
            u
        }));
    }
    if srv["hangar"].as_object().is_some_and(|o| !o.is_empty()) {
        ups.extend(crate::hangar::check_updates(env, srv, &srv["hangar"], &folder_of(srv, "plugin")).await);
    }
    if pins.is_empty() {
        return ups;
    }
    let srv2 = srv.clone();
    crate::mod_manager::without_pinned(ups, pins, move |f| {
        for kind in ["plugin", "mod"] {
            let p = folder_of(&srv2, kind).join(f);
            if p.exists() {
                return crate::mod_manager::mod_key(f, crate::mod_meta::read_jar(&p).as_ref());
            }
        }
        crate::mod_manager::mod_key(f, None)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_overrides() {
        assert_eq!(kinds_for("paper"), vec!["plugin", "datapack"]);
        assert_eq!(kinds_for("fabric"), vec!["mod", "datapack", "modpack"]);
        assert_eq!(kinds_for("velocity"), vec!["plugin"]);
        assert_eq!(override_action("world/level.dat", None, None, true), "skip");
        assert_eq!(override_action("config/a.toml", Some("x"), Some("y"), true), "write");
        assert_eq!(override_action("config/a.toml", Some("x"), Some("x"), false), "write");
        assert_eq!(override_action("config/a.toml", Some("mine"), Some("x"), false), "keep");
        assert_eq!(override_action("mods/a.jar", Some("mine"), Some("x"), false), "write");
    }

    #[tokio::test]
    async fn server_pack_and_files() {
        let d = tempfile::tempdir().unwrap();
        let srv = json!({ "type": "fabric", "dir": d.path().join("srv").to_string_lossy(), "props": {} });
        let zip = d.path().join("pack.zip");
        util::write_zip(
            &zip,
            vec![
                ("Pack/mods/a.jar".into(), b"a".to_vec()),
                ("Pack/config/x.toml".into(), b"x".to_vec()),
                ("Pack/server.properties".into(), b"p".to_vec()),
                ("Pack/world/level.dat".into(), b"w".to_vec()),
                ("Pack/variables.txt".into(), b"MINECRAFT_VERSION=1.20.1\nMODLOADER=Forge\n".to_vec()),
            ],
        )
        .unwrap();
        assert!(is_server_pack(&zip));
        let r = install_server_pack(&srv, &zip, &|_| {}).await.unwrap();
        assert_eq!(r, json!({ "files": 3, "type": "forge", "mcVersion": "1.20.1" }));
        let base = d.path().join("srv");
        assert!(base.join("mods/a.jar").exists() && !base.join("server.properties").exists() && !base.join("world").exists());
        std::fs::write(d.path().join("dp.zip"), b"x").unwrap();
        util::write_zip(&d.path().join("own.jar"), vec![("fabric.mod.json".into(), br#"{"id":"own","name":"Own","environment":"client"}"#.to_vec())]).unwrap();
        let added = add_files(&srv, &[d.path().join("own.jar"), d.path().join("dp.zip"), zip.clone()]).await.unwrap();
        assert_eq!(added, vec!["own.jar", "dp.zip"]);
        assert_eq!(disable_client_only(&srv).await, vec!["own.jar"]);
        let list = list_installed(&srv).await;
        let names: Vec<&str> = list.as_array().unwrap().iter().map(|x| x["file"].as_str().unwrap()).collect();
        assert!(names.contains(&"own.jar.disabled") && names.contains(&"a.jar") && names.contains(&"dp.zip"), "{names:?}");
    }
}
