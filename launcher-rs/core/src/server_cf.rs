//! CurseForge for local servers (port of launcher/src/main/server-cf.js): mods, Bukkit plugins and
//! datapacks with dependencies, and whole modpacks – from the project's server pack when it has one,
//! otherwise built from manifest.json keeping only server / both-side files.

use crate::curseforge::{self, Cf, PackTask};
use crate::error::{msg, Result};
use crate::js::{number, truthy, ValueExt};
use crate::server_content::{self as sc, folder_of, world_name};
use crate::util::{self, inside, sha1_hex};
use crate::Env;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

const MOD_LOADERS: [&str; 4] = ["fabric", "quilt", "forge", "neoforge"];
const PLUGIN_TYPES: [&str; 3] = ["paper", "purpur", "folia"];

static CLIENT_PATHS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(resourcepacks|shaderpacks|screenshots|saves|options\.txt|optionsof\.txt|optionsshaders\.txt|servers\.dat[^/]*|config/(iris|oculus|sodium|embeddium|rubidium)[^/]*)(/|$)").unwrap()
});
static PROTECTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(world|world_nether|world_the_end|backups|\.nore-backup|server\.properties|eula\.txt|whitelist\.json|ops\.json|banned-players\.json|banned-ips\.json)(/|$)").unwrap()
});

/// Which side a CurseForge file runs on, from its "Client" / "Server" tags.
pub fn cf_side(f: &Value) -> &'static str {
    let gv: Vec<String> = f["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_lowercase).collect();
    let (c, s) = (gv.iter().any(|v| v == "client"), gv.iter().any(|v| v == "server"));
    match (c, s) {
        (true, false) => "client",
        (false, true) => "server",
        (true, true) => "both",
        _ => "unknown",
    }
}

pub fn kinds_for(t: &str) -> Vec<&'static str> {
    let mut k = Vec::new();
    if PLUGIN_TYPES.contains(&t) {
        k.push("plugin");
    }
    if MOD_LOADERS.contains(&t) {
        k.push("mod");
    }
    if t != "velocity" && t != "bungeecord" {
        k.push("datapack");
        k.push("modpack");
    }
    k
}

pub async fn search(env: &Env, cf: &Cf, srv: &Value, o: &Value) -> Result<Value> {
    let kind = o.str_of("kind").unwrap_or("mod");
    let t = srv.str_of("type").unwrap_or("");
    let modded = MOD_LOADERS.contains(&t);
    let gv = if kind == "mod" || kind == "datapack" { srv["mcVersion"].clone() } else { Value::Null };
    let loader = if (kind == "mod" || kind == "modpack") && modded { json!(t) } else { Value::Null };
    cf.search(env, &json!({ "query": o.string_or("query", ""), "kind": kind, "sort": o.string_or("sort", "relevance"), "offset": o.get("offset").cloned().unwrap_or(json!(0)), "limit": 20, "gameVersion": gv, "loader": loader })).await
}

pub async fn install(env: &Env, cf: &Cf, srv: &Value, o: &Value, on_status: crate::modrinth::StatusFn<'_>) -> Result<Vec<String>> {
    let kind = o.str_of("kind").unwrap_or("mod");
    if kind == "modpack" {
        return Err(msg("Modpacki instaluje installModpack()"));
    }
    let req = crate::modrinth::InstallReq {
        project_id: crate::config_edit::js_string(&o["projectId"]),
        kind: kind.into(),
        game_version: if kind == "plugin" { None } else { srv.str_of("mcVersion").map(String::from) },
        loader: if kind == "mod" { srv.str_of("type").map(String::from) } else { None },
        target_dir: folder_of(srv, kind),
        version_id: o.get("versionId").filter(|v| truthy(v)).map(crate::config_edit::js_string),
    };
    cf.install(env, req, on_status, &mut HashSet::new(), &mut Default::default()).await
}

#[derive(Debug, Default)]
pub struct ServerTasks {
    pub tasks: Vec<PackTask>,
    pub client_skipped: Vec<Value>,
    pub optional: Vec<Value>,
    pub missing: Vec<u64>,
}

/// Pure: manifest + API records → server tasks (client mods, resource packs and shaders skipped).
pub fn manifest_server_tasks(manifest: &Value, file_list: &[Value], mod_list: &[Value], root: &Path, world: &str) -> ServerTasks {
    let truthy_id = |v: &Value| number(v) != 0.0;
    let all: Vec<&Value> = manifest["files"].as_array().into_iter().flatten().filter(|f| truthy_id(&f["projectID"]) && truthy_id(&f["fileID"])).collect();
    let mut wanted: Vec<u64> = Vec::new();
    for f in all.iter().filter(|f| f.get("required") != Some(&json!(false))) {
        let id = number(&f["fileID"]) as u64;
        if !wanted.contains(&id) {
            wanted.push(id);
        }
    }
    let optional =
        all.iter().filter(|f| f.get("required") == Some(&json!(false))).map(|f| json!({ "projectId": f["projectID"], "fileId": f["fileID"] })).collect();
    let mods: HashMap<u64, &Value> = mod_list.iter().filter_map(|m| Some((m["id"].as_u64()?, m))).collect();
    let mut out = ServerTasks { optional, ..Default::default() };
    let mut got = HashSet::new();
    let empty = json!({});
    for f in file_list {
        let fid = number(&f["id"]) as u64;
        if !wanted.contains(&fid) {
            continue;
        }
        got.insert(fid);
        let m = mods.get(&f["modId"].as_u64().unwrap_or(0)).copied().unwrap_or(&empty);
        let cls = m["classId"].as_u64().unwrap_or(0);
        let title = m.str_of("name").or(f.str_of("displayName")).or(f.str_of("fileName")).unwrap_or("").to_string();
        let name = util::basename(f.str_of("fileName").unwrap_or(""));
        if cls == curseforge::class_id("resourcepack") || cls == curseforge::class_id("shader") {
            out.client_skipped
                .push(json!({ "title": title, "file": name, "why": if cls == curseforge::class_id("shader") { "shader" } else { "resourcepack" } }));
            continue;
        }
        if cf_side(f) == "client" {
            out.client_skipped.push(json!({ "title": title, "file": name, "why": "client" }));
            continue;
        }
        let dir = if cls == curseforge::class_id("datapack") {
            format!("{world}/datapacks")
        } else if cls == curseforge::class_id("plugin") {
            "plugins".into()
        } else {
            "mods".into()
        };
        let rel = format!("{dir}/{name}");
        let mut t = PackTask {
            url: curseforge::file_url(f),
            dest: root.join(&dir).join(&name),
            rel: rel.clone(),
            sha1: curseforge::sha1_of(f),
            size: f["fileLength"].as_u64(),
            name: name.clone(),
            blocked: None,
        };
        if f.str_of("downloadUrl").is_none_or(str::is_empty) {
            let site = m.pointer("/links/websiteUrl").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| {
                format!("https://www.curseforge.com/minecraft/mc-mods/{}", m.str_of("slug").map(String::from).unwrap_or_else(|| f["modId"].to_string()))
            });
            t.blocked = Some(
                json!({ "projectId": f["modId"], "fileId": f["id"], "title": title, "file": name, "rel": rel, "sha1": t.sha1, "size": f["fileLength"], "page": format!("{}/download/{}", site.trim_end_matches('/'), fid) }),
            );
        }
        out.tasks.push(t);
    }
    out.missing = wanted.into_iter().filter(|id| !got.contains(id)).collect();
    out
}

/// Pure: should an override path from the client pack land on the server?
pub fn server_override(rel: &str) -> bool {
    !CLIENT_PATHS.is_match(rel) && !PROTECTED.is_match(rel)
}

/// Pure: the project's server pack when the chosen client file has one.
pub fn server_pack_plan(rec: Option<&Value>) -> Value {
    match rec {
        Some(r) if r.truthy_of("isServerPack") => json!({ "mode": "serverpack", "fileId": r["id"] }),
        Some(r) if truthy(&r["serverPackFileId"]) => json!({ "mode": "serverpack", "fileId": r["serverPackFileId"] }),
        _ => json!({ "mode": "manifest" }),
    }
}

pub async fn pack_versions(env: &Env, cf: &Cf, project_id: &str) -> Result<Vec<Value>> {
    Ok(cf
        .files(env, &json!(project_id), None, None)
        .await?
        .iter()
        .map(|f| {
            let gv: Vec<Value> = f["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|v| curseforge::is_mc_version(v)).map(|v| json!(v)).collect();
            let loaders: Vec<String> = f["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_lowercase).filter(|v| MOD_LOADERS.contains(&v.as_str())).collect();
            json!({
                "id": f["id"].as_u64().map(|x| x.to_string()), "number": f.get("displayName").filter(|v| truthy(v)).unwrap_or(&f["fileName"]), "name": f["displayName"],
                "type": curseforge::release(f["releaseType"].as_u64().unwrap_or(1)), "date": f["fileDate"], "mcVersion": gv.first(), "gameVersions": gv, "loaders": loaders,
                "hasServerPack": truthy(&f["serverPackFileId"]), "changelog": "",
            })
        })
        .collect())
}

/// Newest pack file for the server's Minecraft version newer than the installed one, or null.
pub async fn pack_update(env: &Env, cf: &Cf, srv: &Value, types: &[&str]) -> Result<Value> {
    let p = &srv["pack"];
    if p.str_of("source") != Some("curseforge") || !truthy(&p["projectId"]) {
        return Ok(Value::Null);
    }
    let mc = srv.string_or("mcVersion", "");
    let mut list: Vec<Value> = pack_versions(env, cf, &crate::config_edit::js_string(&p["projectId"]))
        .await?
        .into_iter()
        .filter(|v| types.contains(&v.str_of("type").unwrap_or("")) && v["gameVersions"].as_array().is_some_and(|g| g.iter().any(|x| x.as_str() == Some(&mc))))
        .collect();
    list.sort_by_key(|v| std::cmp::Reverse(util::parse_date(v.str_of("date").unwrap_or(""))));
    let cur = crate::config_edit::js_string(&p["versionId"]);
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
    out["changelog"] = json!(cf.changelog(env, &p["projectId"], &newest["id"]).await);
    Ok(out)
}

/// Installs / updates a CurseForge modpack on a server. source: `{ projectId, versionId }` or `{ file }`.
pub async fn install_modpack(env: &Env, cf: &Cf, srv: &Value, source: &Value, on_status: &(dyn Fn(String) + Send + Sync)) -> Result<Value> {
    let base = sc::dir_of(srv);
    let cache = base.join(".nore-cf");
    tokio::fs::create_dir_all(&cache).await?;
    let r = install_modpack_inner(env, cf, srv, source, on_status, &base, &cache).await;
    let _ = tokio::fs::remove_dir_all(&cache).await;
    r
}

async fn install_modpack_inner(
    env: &Env,
    cf: &Cf,
    srv: &Value,
    source: &Value,
    on_status: &(dyn Fn(String) + Send + Sync),
    base: &Path,
    cache: &Path,
) -> Result<Value> {
    let mut pack_file = source.str_of("file").map(PathBuf::from);
    let (mut info, mut record) = (Value::Null, None);
    if pack_file.is_none() {
        on_status("Pobieranie paczki z CurseForge".into());
        let pid = crate::config_edit::js_string(&source["projectId"]);
        let vid = source.get("versionId").filter(|v| truthy(v)).map(crate::config_edit::js_string);
        info = cf.download_pack(env, &pid, vid.as_deref(), cache).await?;
        pack_file = Some(PathBuf::from(info.string_or("file", "")));
        record = cf.file_info(env, &source["projectId"], &info["fileId"]).await.ok();
    }
    let file = pack_file.unwrap_or_default();
    let (mut zip, manifest) = curseforge::read_manifest(&file).ok_or_else(|| msg("To nie jest paczka CurseForge (brak manifest.json)."))?;
    let (loader, lv) = curseforge::loader_of(&manifest);
    let old = srv.get("pack").cloned().filter(truthy).unwrap_or(json!({}));
    let plan = server_pack_plan(record.as_ref());
    let t = srv.str_of("type").unwrap_or("");
    let mut base_v = json!({ "name": manifest["name"], "mcVersion": manifest["minecraft"]["version"], "type": if MOD_LOADERS.contains(&loader.as_str()) { loader.clone() } else { t.to_string() }, "loaderVersion": lv.clone().unwrap_or_default() });
    let pack_meta = json!({
        "source": "curseforge", "projectId": if truthy(&source["projectId"]) { json!(format!("cf:{}", curseforge::raw_id(&source["projectId"]))) } else { Value::Null },
        "versionId": if info.is_null() { Value::Null } else { json!(info["fileId"].as_u64().map(|x| x.to_string())) },
        "version": info.get("version").filter(|v| truthy(v)).cloned().or_else(|| manifest.get("version").cloned()).unwrap_or(json!("")),
        "title": info.get("title").filter(|v| truthy(v)).cloned().unwrap_or(manifest["name"].clone()),
    });
    if plan["mode"] == "serverpack" {
        on_status("Pobieranie server packa od autora paczki".into());
        let sp = cf.file_info(env, &source["projectId"], &plan["fileId"]).await?;
        let sp_file = cache.join(util::basename(sp.str_of("fileName").unwrap_or("server.zip")));
        env.net.download(&curseforge::file_url(&sp), &sp_file, curseforge::sha1_of(&sp).as_deref(), sp["fileLength"].as_u64(), &|_| {}).await?;
        for rel in old["files"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if let Some(p) = inside(base, rel) {
                sc::move_to_backup(srv, &p, "modpack").await;
            }
        }
        let r = sc::install_server_pack(srv, &sp_file, on_status).await?;
        if truthy(&r["type"]) {
            base_v["type"] = r["type"].clone();
        }
        if truthy(&r["mcVersion"]) {
            base_v["mcVersion"] = r["mcVersion"].clone();
        }
        base_v["files"] = r["files"].clone();
        base_v["serverPack"] = json!(true);
        let mut pm = pack_meta.clone();
        pm["serverPack"] = json!(true);
        pm["files"] = json!([]);
        pm["overrides"] = json!({});
        base_v["pack"] = pm;
        return Ok(base_v);
    }
    // the manifest: file and project records in chunks of 200
    let wanted: Vec<&Value> = manifest["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| truthy(&f["projectID"]) && truthy(&f["fileID"]) && f.get("required") != Some(&json!(false)))
        .collect();
    let (mut files, mut mods) = (Vec::new(), Vec::new());
    for (i, chunk) in wanted.chunks(200).enumerate() {
        on_status(format!("Lista plików z CurseForge {}/{}", ((i + 1) * 200).min(wanted.len()), wanted.len()));
        let b1 = json!({ "fileIds": chunk.iter().map(|f| &f["fileID"]).collect::<Vec<_>>() });
        let b2 = json!({ "modIds": chunk.iter().map(|f| &f["projectID"]).collect::<Vec<_>>() });
        let (fl, ml) = tokio::join!(cf.call(env, "/v1/mods/files", Some(&b1)), cf.call(env, "/v1/mods", Some(&b2)));
        files.extend(fl?["data"].as_array().cloned().unwrap_or_default());
        mods.extend(ml?["data"].as_array().cloned().unwrap_or_default());
    }
    let r = manifest_server_tasks(&manifest, &files, &mods, base, &world_name(srv));
    let new_rel: Vec<String> = r.tasks.iter().map(|t| t.rel.clone()).collect();
    for rel in old["files"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        if new_rel.iter().any(|x| x == rel) {
            continue;
        }
        if let Some(p) = inside(base, rel) {
            sc::move_to_backup(srv, &p, "modpack").await;
            sc::move_to_backup(srv, &PathBuf::from(format!("{}.disabled", p.display())), "modpack").await;
        }
    }
    let tasks: Vec<PackTask> = r.tasks.iter().filter_map(|t| inside(base, &t.rel).map(|d| PackTask { dest: d, ..t.clone() })).collect();
    let last = std::sync::Mutex::new(usize::MAX);
    let blocked = crate::modpacks::download_tasks(env, &tasks, 8, &|p: Value| {
        let done = p["done"].as_u64().unwrap_or(0) as usize;
        let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
        if done != *l {
            *l = done;
            on_status(format!("Pliki paczki {done}/{}", p["total"]));
        }
    })
    .await?;
    let prefix = format!("{}/", manifest.str_of("overrides").unwrap_or("overrides").trim_end_matches('/'));
    let mut overrides = Map::new();
    let first = !old["files"].is_array();
    for (rel, entry) in crate::modpacks::override_entries(&zip, &[prefix.as_str()]) {
        if !server_override(&rel) {
            continue;
        }
        let Some(dest) = inside(base, &rel) else { continue };
        let Some(data) = zip.read(&entry) else { continue };
        let existing = std::fs::read(&dest).ok().map(|b| sha1_hex(&b));
        overrides.insert(rel.clone(), json!(sha1_hex(&data)));
        if sc::override_action(&rel, existing.as_deref(), old["overrides"].get(&rel).and_then(Value::as_str), first) != "write" {
            continue;
        }
        if let Some(d) = dest.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&dest, data)?;
    }
    base_v["files"] = json!(r.tasks.len());
    base_v["clientSkipped"] = json!(r.client_skipped);
    base_v["blocked"] = json!(blocked);
    base_v["missing"] = json!(r.missing);
    let mut pm = pack_meta;
    pm["files"] = json!(new_rel);
    pm["overrides"] = Value::Object(overrides);
    pm["blocked"] = json!(blocked);
    pm["clientSkipped"] = json!(r.client_skipped.len());
    base_v["pack"] = pm;
    Ok(base_v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_pack_plans() {
        assert_eq!(server_pack_plan(Some(&json!({ "id": 5, "serverPackFileId": 9 }))), json!({ "mode": "serverpack", "fileId": 9 }));
        assert_eq!(server_pack_plan(Some(&json!({ "id": 5, "isServerPack": true }))), json!({ "mode": "serverpack", "fileId": 5 }));
        assert_eq!(server_pack_plan(Some(&json!({ "id": 5 }))), json!({ "mode": "manifest" }));
        assert_eq!(server_pack_plan(None), json!({ "mode": "manifest" }));
    }

    /// mods-servers.test.js: CurseForge manifest → server.
    #[test]
    fn manifest_to_server() {
        let manifest = json!({ "files": [
            { "projectID": 1, "fileID": 10, "required": true }, { "projectID": 2, "fileID": 20, "required": true }, { "projectID": 3, "fileID": 30, "required": true },
            { "projectID": 4, "fileID": 40, "required": true }, { "projectID": 5, "fileID": 50, "required": true }, { "projectID": 6, "fileID": 60, "required": true },
            { "projectID": 7, "fileID": 70, "required": false }, { "projectID": 8, "fileID": 80, "required": true },
        ]});
        let files = vec![
            json!({ "id": 10, "modId": 1, "fileName": "create.jar", "downloadUrl": "https://edge.forgecdn.net/create.jar", "gameVersions": ["1.20.1", "Forge", "Client", "Server"], "hashes": [{ "algo": 1, "value": "aa" }], "fileLength": 5 }),
            json!({ "id": 20, "modId": 2, "fileName": "oculus.jar", "downloadUrl": "u", "gameVersions": ["1.20.1", "Forge", "Client"] }),
            json!({ "id": 30, "modId": 3, "fileName": "pack.zip", "downloadUrl": "u", "gameVersions": ["1.20.1"] }),
            json!({ "id": 40, "modId": 4, "fileName": "ftbbackups.jar", "downloadUrl": "u", "gameVersions": ["1.20.1", "Server"] }),
            json!({ "id": 50, "modId": 5, "fileName": "blocked.jar", "downloadUrl": null, "gameVersions": ["1.20.1"], "hashes": [{ "algo": 1, "value": "bb" }], "fileLength": 7 }),
            json!({ "id": 60, "modId": 6, "fileName": "dp.zip", "downloadUrl": "u", "gameVersions": ["1.20.1"] }),
            json!({ "id": 70, "modId": 7, "fileName": "optional.jar", "downloadUrl": "u", "gameVersions": [] }),
        ];
        let mods = vec![
            json!({ "id": 1, "classId": 6, "name": "Create" }),
            json!({ "id": 2, "classId": 6, "name": "Oculus" }),
            json!({ "id": 3, "classId": 12, "name": "Faithful" }),
            json!({ "id": 4, "classId": 6, "name": "FTB Backups" }),
            json!({ "id": 5, "classId": 6, "name": "Blocky", "slug": "blocky", "links": { "websiteUrl": "https://www.curseforge.com/minecraft/mc-mods/blocky/" } }),
            json!({ "id": 6, "classId": 6945, "name": "DP" }),
        ];
        let r = manifest_server_tasks(&manifest, &files, &mods, Path::new("/srv"), "swiat");
        assert_eq!(
            r.tasks.iter().map(|t| t.rel.as_str()).collect::<Vec<_>>(),
            vec!["mods/create.jar", "mods/ftbbackups.jar", "mods/blocked.jar", "swiat/datapacks/dp.zip"]
        );
        assert_eq!(
            r.client_skipped.iter().map(|c| json!([c["title"], c["why"]])).collect::<Vec<_>>(),
            vec![json!(["Oculus", "client"]), json!(["Faithful", "resourcepack"])]
        );
        assert_eq!(r.missing, vec![80]);
        assert_eq!(r.optional, vec![json!({ "projectId": 7, "fileId": 70 })]);
        let b = r.tasks.iter().find(|t| t.blocked.is_some()).unwrap();
        assert_eq!(b.blocked.as_ref().unwrap()["page"], "https://www.curseforge.com/minecraft/mc-mods/blocky/download/50");
        assert_eq!(b.blocked.as_ref().unwrap()["rel"], "mods/blocked.jar");
        assert!(b.url.contains("edge.forgecdn.net/files/0/50/blocked.jar"));
        assert_eq!(r.tasks[0].sha1.as_deref(), Some("aa"));
        assert_eq!(cf_side(&json!({ "gameVersions": ["Server"] })), "server");
        assert_eq!(cf_side(&json!({ "gameVersions": [] })), "unknown");
        assert!(server_override("config/create-common.toml") && server_override("kubejs/server_scripts/a.js"));
        for p in ["resourcepacks/x.zip", "options.txt", "servers.dat_old", "world/level.dat", "server.properties"] {
            assert!(!server_override(p), "{p}");
        }
        assert_eq!(kinds_for("paper"), vec!["plugin", "datapack", "modpack"]);
        assert!(kinds_for("velocity").is_empty());
    }
}
