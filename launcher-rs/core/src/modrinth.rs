//! Modrinth (port of launcher/src/main/modrinth.js): search, categories, project pages, installing
//! content with its required dependencies, installed files, updates by SHA-1 with backups and
//! recognising installed files.

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::util::{self, inside};
use crate::{loaders, net, Env};
use futures::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

pub const API: &str = "https://api.modrinth.com/v2";
pub const FABRIC_API_ID: &str = "P7dR8mSH";
pub const BACKUP_DIR: &str = ".nore-backup";

/// Content kind → (folder, Modrinth project type, file extensions).
pub fn kind(kind: &str) -> Option<(Option<&'static str>, &'static str, &'static [&'static str])> {
    Some(match kind {
        "mod" => (Some("mods"), "mod", &[".jar"]),
        "resourcepack" => (Some("resourcepacks"), "resourcepack", &[".zip"]),
        "datapack" => (Some("datapacks"), "datapack", &[".zip"]),
        "shader" => (Some("shaderpacks"), "shader", &[".zip"]),
        "modpack" => (None, "modpack", &[".mrpack"]),
        _ => return None,
    })
}

pub fn folder_of(k: &str) -> Result<&'static str> {
    kind(k).and_then(|k| k.0).ok_or_else(|| msg(format!("Nieznany rodzaj zawartości: {k}")))
}

pub fn exts_of(k: &str) -> &'static [&'static str] {
    kind(k).map_or(&[".jar"], |k| k.2)
}

/// `base?<URLSearchParams>` (form encoding like the browser).
pub fn with_params(base: &str, params: &[(&str, String)]) -> String {
    match reqwest::Url::parse_with_params(base, params) {
        Ok(u) => u.to_string(),
        Err(_) => base.to_string(),
    }
}

fn enc(s: &str) -> String {
    urlencoding::encode(s).to_string()
}

fn list_strs(v: &[&str]) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

/// The version list query for a mod on a game version / loader.
pub fn versions_url(project: &str, game_version: &str, loader: &str) -> String {
    let mut q = Vec::new();
    if !game_version.is_empty() {
        q.push(format!("game_versions={}", urlencoding::encode(&format!("[\"{game_version}\"]"))));
    }
    let ls = loaders::mod_loaders(loader);
    if !ls.is_empty() {
        let list = ls.iter().map(|l| format!("\"{l}\"")).collect::<Vec<_>>().join(",");
        q.push(format!("loaders={}", urlencoding::encode(&format!("[{list}]"))));
    }
    format!("{API}/project/{}/version?{}", urlencoding::encode(project), q.join("&"))
}

/// Search parameters as the renderer sends them.
pub fn search_url(o: &Value) -> String {
    let k = o.str_of("kind").unwrap_or("mod");
    let ptype = kind(k).map_or("mod", |x| x.1);
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{ptype}")]];
    if let Some(gv) = o.str_of("gameVersion").filter(|s| !s.is_empty()) {
        facets.push(vec![format!("versions:{gv}")]);
    }
    if let Some(l) = o.str_of("loader").filter(|s| !s.is_empty()) {
        if k == "mod" {
            facets.push(loaders::mod_loaders(l).iter().map(|l| format!("categories:{l}")).collect());
        }
    }
    if let Some(ls) = o.get("loaders").and_then(Value::as_array).filter(|l| !l.is_empty()) {
        facets.push(ls.iter().filter_map(Value::as_str).map(|l| format!("categories:{l}")).collect());
    }
    if let Some(c) = o.str_of("category").filter(|s| !s.is_empty()) {
        facets.push(vec![format!("categories:{c}")]);
    }
    for c in o.get("categories").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        facets.push(vec![format!("categories:{c}")]);
    }
    match o.str_of("environment") {
        Some("client") => facets.push(vec!["client_side:required".into(), "client_side:optional".into()]),
        Some("server") => facets.push(vec!["server_side:required".into(), "server_side:optional".into()]),
        _ => {}
    }
    let num = |k: &str, d: i64| o.get(k).and_then(Value::as_i64).unwrap_or(d).to_string();
    with_params(
        &format!("{API}/search"),
        &[
            ("query", o.string_or("query", "")),
            ("index", o.string_or("sort", "relevance")),
            ("offset", num("offset", 0)),
            ("limit", num("limit", 20)),
            ("facets", serde_json::to_string(&facets).unwrap_or_default()),
        ],
    )
}

pub async fn search(env: &Env, o: &Value) -> Result<Value> {
    env.net.get_json(&search_url(o)).await
}

static TAGS: LazyLock<Mutex<Option<Value>>> = LazyLock::new(Mutex::default);

/// Category tags of a project type (for the filter sidebar).
pub async fn categories(env: &Env, k: &str) -> Result<Value> {
    let cached = TAGS.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let tags = match cached {
        Some(t) => t,
        None => {
            let t: Value = env.net.get_json(&format!("{API}/tag/category")).await?;
            *TAGS.lock().unwrap_or_else(|e| e.into_inner()) = Some(t.clone());
            t
        }
    };
    let ptype = kind(k).map_or("mod", |x| x.1);
    Ok(Value::Array(tags.as_array().into_iter().flatten().filter(|c| c.str_of("project_type") == Some(ptype)).cloned().collect()))
}

/// Primary file of a version (or the first one).
pub fn primary_file(version: &Value) -> Option<&Value> {
    let files = version.get("files")?.as_array()?;
    files.iter().find(|f| f.get("primary").and_then(Value::as_bool) == Some(true)).or(files.first())
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Everything the details view needs: project, versions, members and dependencies.
pub async fn details(env: &Env, id: &str) -> Result<Value> {
    let e = enc(id);
    let (u1, u2, u3, u4) = (format!("{API}/project/{e}"), format!("{API}/project/{e}/version"), format!("{API}/project/{e}/members"), format!("{API}/project/{e}/dependencies"));
    let (proj, vers, members, deps) = tokio::join!(env.net.get_json::<Value>(&u1), env.net.get_json::<Value>(&u2), env.net.get_json::<Value>(&u3), env.net.get_json::<Value>(&u4));
    let proj = proj?;
    let vers = vers.unwrap_or(json!([]));
    let members = members.unwrap_or(json!([]));
    let deps = deps.unwrap_or(json!({ "projects": [] }));
    let versions: Vec<Value> = vers
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| {
            let pf = primary_file(v).cloned().unwrap_or(json!({}));
            json!({
                "id": v["id"], "name": v["name"], "number": v["version_number"], "type": v["version_type"], "date": v["date_published"],
                "downloads": v["downloads"], "gameVersions": v["game_versions"], "loaders": v["loaders"], "changelog": truncate(v.str_of("changelog").unwrap_or(""), 4000),
                "file": pf.get("filename"), "size": pf.get("size"),
                "deps": v["dependencies"].as_array().into_iter().flatten().filter(|d| d.str_of("project_id").is_some()).map(|d| json!({ "id": d["project_id"], "type": d["dependency_type"] })).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(json!({
        "project": proj,
        "versions": versions,
        "members": members.as_array().into_iter().flatten().map(|m| json!({ "name": m["user"]["username"], "role": m["role"], "avatar": m["user"]["avatar_url"] })).collect::<Vec<_>>(),
        "dependencies": deps["projects"].as_array().into_iter().flatten().map(|p| json!({ "id": p["id"], "title": p["title"], "icon": p["icon_url"], "slug": p["slug"], "type": p["project_type"] })).collect::<Vec<_>>(),
    }))
}

pub async fn project(env: &Env, id: &str) -> Result<Value> {
    env.net.get_json(&format!("{API}/project/{}", enc(id))).await
}

pub async fn compatible_versions(env: &Env, project_id: &str, k: &str, game_version: Option<&str>, loader: Option<&str>) -> Result<Vec<Value>> {
    let mut params = Vec::new();
    if let Some(gv) = game_version.filter(|s| !s.is_empty()) {
        params.push(("game_versions", list_strs(&[gv])));
    }
    if k == "mod" {
        if let Some(l) = loader.filter(|s| !s.is_empty()) {
            params.push(("loaders", list_strs(&loaders::mod_loaders(l))));
        }
    }
    if k == "datapack" {
        params.push(("loaders", list_strs(&["datapack"])));
    }
    env.net.get_json(&with_params(&format!("{API}/project/{}/version", enc(project_id)), &params)).await
}

/// What to install (content:install / mods for the game start).
#[derive(Clone, Debug, Default)]
pub struct InstallReq {
    pub project_id: String,
    pub kind: String,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub target_dir: PathBuf,
    pub version_id: Option<String>,
}

/// Status lines for the UI ("Pobieranie …").
pub type StatusFn<'a> = &'a (dyn Fn(String) + Send + Sync);

/// What the folder already has (filled on first use, shared by a whole dependency tree).
#[derive(Default)]
pub struct HaveCtx {
    pub ids: Option<HashSet<String>>,
    pub present: Option<HashSet<String>>,
}

pub fn no_status(_: String) {}

fn check_file_name(name: &str) -> Result<()> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(msg("Niedozwolona nazwa pliku"));
    }
    Ok(())
}

/// Installs a project (and, for mods, its required dependencies) into the target folder.
/// Returns the installed file names.
pub fn install<'a>(env: &'a Env, req: InstallReq, on_status: StatusFn<'a>, seen: &'a mut HashSet<String>, ctx: &'a mut HaveCtx) -> BoxFuture<'a, Result<Vec<String>>> {
    Box::pin(async move {
        if !seen.insert(req.project_id.clone()) {
            return Ok(vec![]);
        }
        let version = match &req.version_id {
            Some(v) if !v.is_empty() => Some(env.net.get_json::<Value>(&format!("{API}/version/{}", enc(v))).await?),
            _ => {
                let list = compatible_versions(env, &req.project_id, &req.kind, req.game_version.as_deref(), req.loader.as_deref()).await?;
                list.iter().find(|v| v.str_of("version_type") == Some("release")).or(list.first()).cloned()
            }
        };
        let Some(version) = version else {
            let gv = req.game_version.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "tą wersją gry".into());
            let l = match (&req.loader, req.kind.as_str()) {
                (Some(l), "mod") if !l.is_empty() => format!(" ({l})"),
                _ => String::new(),
            };
            return Err(msg(format!("Brak wersji zgodnej z {gv}{l}")));
        };
        let file = primary_file(&version).ok_or_else(|| msg("Wersja nie ma plików"))?;
        let name = file.string_or("filename", "");
        check_file_name(&name)?;
        tokio::fs::create_dir_all(&req.target_dir).await?;
        on_status(format!("Pobieranie {name}"));
        env.net
            .download(file.str_of("url").unwrap_or_default(), &req.target_dir.join(&name), file.pointer("/hashes/sha1").and_then(Value::as_str), file.get("size").and_then(Value::as_u64), &|_| {})
            .await?;
        let mut installed = vec![name];
        if req.kind == "mod" {
            for dep in version.get("dependencies").and_then(Value::as_array).cloned().unwrap_or_default() {
                let (Some("required"), Some(id)) = (dep.str_of("dependency_type"), dep.str_of("project_id")) else { continue };
                // a dependency the folder already has (any version, also from CurseForge) is not downloaded again
                if has_project(env, &req.target_dir, id, ctx).await {
                    continue;
                }
                let sub = InstallReq { project_id: id.to_string(), version_id: None, ..req.clone() };
                match install(env, sub, on_status, seen, ctx).await {
                    Ok(more) => installed.extend(more),
                    Err(e) => on_status(format!("Nie udało się pobrać zależności: {e}")),
                }
            }
        }
        Ok(installed)
    })
}

/// Is a Modrinth project already in the folder? By file hash, then by mod id = project slug.
async fn has_project(env: &Env, dir: &Path, project_id: &str, ctx: &mut HaveCtx) -> bool {
    if ctx.ids.is_none() {
        let ids = identify(env, dir, &[".jar"]).await.unwrap_or_default();
        ctx.ids = Some(ids.values().filter_map(|m| m.str_of("projectId").map(String::from)).collect());
    }
    if ctx.ids.as_ref().is_some_and(|s| s.contains(project_id)) {
        return true;
    }
    if ctx.present.is_none() {
        ctx.present = Some(crate::perf::present_set(&crate::perf::scan(dir).await));
    }
    let Ok(p) = project(env, project_id).await else { return false };
    let n = crate::perf::norm(p.str_of("slug").unwrap_or(""));
    !n.is_empty() && ctx.present.as_ref().is_some_and(|s| s.contains(&n))
}

/// Installs a mod and its required dependencies (game start: Fabric API, Nore Pack).
pub async fn install_mod(env: &Env, project: &str, game_version: &str, loader: &str, target: &Path, seen: &mut HashSet<String>) -> Result<Vec<String>> {
    let req = InstallReq {
        project_id: project.into(),
        kind: "mod".into(),
        game_version: Some(game_version.into()),
        loader: Some(loader.into()),
        target_dir: target.into(),
        version_id: None,
    };
    install(env, req, &no_status, seen, &mut HaveCtx::default()).await
}

/// Lists installed files in a content folder (with .disabled support).
pub async fn list_installed(dir: &Path, exts: &[&str]) -> Value {
    let mut out = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().to_string();
            let enabled = !name.ends_with(".disabled");
            let base = if enabled { name.clone() } else { name[..name.len() - 9].to_string() };
            let is_dir = e.file_type().await.is_ok_and(|t| t.is_dir());
            if !is_dir && !exts.iter().any(|x| base.to_lowercase().ends_with(x)) {
                continue;
            }
            let size = tokio::fs::metadata(e.path()).await.map(|m| m.len()).unwrap_or(0);
            out.push(json!({ "file": name, "name": base, "enabled": enabled, "size": size, "dir": is_dir }));
        }
    }
    out.sort_by(|a, b| util::locale_cmp(a.str_of("name").unwrap_or(""), b.str_of("name").unwrap_or("")));
    json!(out)
}

fn update_loaders(k: &str) -> Vec<&'static str> {
    match k {
        "mod" => vec!["fabric"],
        "resourcepack" => vec!["minecraft"],
        "shader" => vec!["iris", "optifine", "canvas"],
        _ => vec!["datapack"],
    }
}

/// Version types allowed by the update channel: 'all' (alpha/beta too), 'beta' or 'release'.
pub fn channel_types(channel: &str) -> Vec<&'static str> {
    match channel {
        "release" => vec!["release"],
        "beta" => vec!["release", "beta"],
        _ => vec!["release", "beta", "alpha"],
    }
}

/// SHA-1 → file name of the files in a folder with one of the extensions.
async fn hashes_of(dir: &Path, exts: &[&str], with_disabled: bool) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut names = util::read_dir_names(dir);
    names.sort();
    for n in names {
        let l = n.to_lowercase();
        let l = if with_disabled { l.trim_end_matches(".disabled").to_string() } else { l };
        if !exts.iter().any(|e| l.ends_with(e)) {
            continue;
        }
        let full = dir.join(&n);
        if !full.is_file() {
            continue;
        }
        if let Ok(h) = cached_sha1(&full).await {
            out.insert(h, n);
        }
    }
    out
}

static HASHES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);

/// SHA-1 cached by path + size + mtime.
pub async fn cached_sha1(full: &Path) -> Result<String> {
    let meta = tokio::fs::metadata(full).await?;
    let key = format!("{}|{}|{}", full.display(), meta.len(), util::mtime_ms(&meta));
    if let Some(h) = HASHES.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return Ok(h.clone());
    }
    let h = net::sha1_file(full).await?;
    HASHES.lock().unwrap_or_else(|e| e.into_inner()).insert(key, h.clone());
    Ok(h)
}

/// Newer Modrinth versions for the files in a content folder (matched by SHA-1).
pub async fn check_updates(env: &Env, dir: &Path, k: &str, game_version: &str, loader: &str, channel: &str) -> Result<Vec<Value>> {
    let hashes = hashes_of(dir, exts_of(k), false).await;
    if hashes.is_empty() {
        return Ok(vec![]);
    }
    let ls: Vec<&str> = if k == "mod" && !loader.is_empty() && loader != "vanilla" { loaders::mod_loaders(loader) } else { update_loaders(k) };
    let body = json!({ "hashes": hashes.keys().collect::<Vec<_>>(), "algorithm": "sha1", "loaders": ls, "game_versions": [game_version], "version_types": channel_types(channel) });
    let Some(map) = env.net.post_json(&format!("{API}/version_files/update"), &body).await? else { return Ok(vec![]) };
    let mut out = Vec::new();
    for (hash, version) in map.as_object().into_iter().flatten() {
        let Some(file) = primary_file(version) else { continue };
        if file.pointer("/hashes/sha1").and_then(Value::as_str) == Some(hash) {
            continue;
        }
        out.push(json!({
            "oldFile": hashes.get(hash), "newFile": file["filename"], "url": file["url"], "sha1": file["hashes"]["sha1"], "size": file["size"],
            "version": version["version_number"], "type": version["version_type"], "versionId": version["id"], "projectId": version["project_id"],
        }));
    }
    Ok(out)
}

/// "2026-10-31_12-34-56" for backup folders.
pub fn stamp() -> String {
    util::iso_now().replace([':', '.'], "-").replacen('T', "_", 1).chars().take(19).collect()
}

/// Removes old backups, keeping the `keep` newest folders whose name matches.
pub async fn prune_backups(game_dir: &Path, matches: impl Fn(&str) -> bool, keep: usize) {
    let root = game_dir.join(BACKUP_DIR);
    let mut names: Vec<String> = util::read_dir_names(&root).into_iter().filter(|n| matches(n)).collect();
    names.sort();
    let n = names.len().saturating_sub(keep);
    for name in names.into_iter().take(n) {
        let _ = tokio::fs::remove_dir_all(root.join(name)).await;
    }
}

pub fn is_update_backup(n: &str) -> bool {
    static RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^\d{4}-\d\d-\d\d_[\d-]+$").unwrap());
    RE.is_match(n)
}

/// Installs updates: the new file first, then the old one goes to `<gameDir>/.nore-backup/<time>/<folder>/`
/// (the 3 newest backups are kept). Without a game folder old files are deleted.
pub async fn apply_updates(env: &Env, dir: &Path, updates: &[Value], game_dir: Option<&Path>) -> Result<usize> {
    let backup = match game_dir {
        Some(g) if !updates.is_empty() => {
            let rel = dir.strip_prefix(g).map(|r| r.to_path_buf()).unwrap_or_else(|_| PathBuf::from(dir.file_name().unwrap_or_default()));
            Some(g.join(BACKUP_DIR).join(stamp()).join(rel))
        }
        _ => None,
    };
    for u in updates {
        let old = util::basename(u.str_of("oldFile").unwrap_or(""));
        let new = util::basename(u.str_of("newFile").unwrap_or(""));
        check_file_name(&new)?;
        env.net.download(u.str_of("url").unwrap_or(""), &dir.join(&new), u.str_of("sha1"), u.get("size").and_then(Value::as_u64), &|_| {}).await?;
        if old == new || old.is_empty() {
            continue;
        }
        match &backup {
            Some(b) => {
                tokio::fs::create_dir_all(b).await?;
                if tokio::fs::rename(dir.join(&old), b.join(&old)).await.is_err() {
                    let _ = tokio::fs::remove_file(dir.join(&old)).await;
                }
            }
            None => {
                let _ = tokio::fs::remove_file(dir.join(&old)).await;
            }
        }
    }
    if let (Some(_), Some(g)) = (&backup, game_dir) {
        prune_backups(g, is_update_backup, 3).await;
    }
    Ok(updates.len())
}

/// Matches installed files with Modrinth projects (by SHA-1): `{ file: { projectId, version, title, icon, … } }`.
pub async fn identify(env: &Env, dir: &Path, exts: &[&str]) -> Result<serde_json::Map<String, Value>> {
    let by_hash = hashes_of(dir, exts, true).await;
    if by_hash.is_empty() {
        return Ok(Default::default());
    }
    let body = json!({ "hashes": by_hash.keys().collect::<Vec<_>>(), "algorithm": "sha1" });
    let Some(versions) = env.net.post_json(&format!("{API}/version_files"), &body).await? else { return Ok(Default::default()) };
    let mut ids: Vec<String> = versions.as_object().into_iter().flatten().filter_map(|(_, v)| v.str_of("project_id").map(String::from)).collect();
    ids.sort();
    ids.dedup();
    let projects: Value = if ids.is_empty() {
        json!([])
    } else {
        env.net.get_json(&format!("{API}/projects?ids={}", enc(&serde_json::to_string(&ids).unwrap_or_default()))).await.unwrap_or(json!([]))
    };
    let pmap: HashMap<&str, &Value> = projects.as_array().into_iter().flatten().filter_map(|p| Some((p.str_of("id")?, p))).collect();
    let mut out = serde_json::Map::new();
    for (hash, v) in versions.as_object().into_iter().flatten() {
        let empty = json!({});
        let p = pmap.get(v.str_of("project_id").unwrap_or("")).copied().unwrap_or(&empty);
        let Some(file) = by_hash.get(hash) else { continue };
        out.insert(
            file.clone(),
            json!({
                "projectId": v["project_id"], "version": v["version_number"], "versionId": v["id"], "title": p.get("title"), "icon": p.get("icon_url"), "slug": p.get("slug"),
                "description": p.get("description"), "gameVersions": v.get("game_versions").cloned().unwrap_or(json!([])), "loaders": v.get("loaders").cloned().unwrap_or(json!([])),
                "clientSide": p.get("client_side").cloned().unwrap_or(Value::Null), "serverSide": p.get("server_side").cloned().unwrap_or(Value::Null), "source": "modrinth",
            }),
        );
    }
    Ok(out)
}

/// The folder of a content kind inside an instance (datapacks live in a world).
pub fn content_dir(game_dir: &Path, k: &str, world: Option<&str>) -> Result<PathBuf> {
    if k == "datapack" {
        let w = world.filter(|w| !w.is_empty()).ok_or_else(|| msg("Wybierz świat, do którego chcesz dodać datapack."))?;
        return inside(&game_dir.join("saves"), w).map(|p| p.join("datapacks")).ok_or_else(|| msg("Niedozwolona ścieżka."));
    }
    Ok(game_dir.join(folder_of(k)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{serve, Reply};

    #[test]
    fn query_matches_modrinth_js() {
        assert_eq!(
            versions_url("P7dR8mSH", "1.21.1", "quilt"),
            "https://api.modrinth.com/v2/project/P7dR8mSH/version?game_versions=%5B%221.21.1%22%5D&loaders=%5B%22quilt%22%2C%22fabric%22%5D"
        );
        let v = json!({ "files": [{ "filename": "a.jar" }, { "filename": "b.jar", "primary": true }] });
        assert_eq!(primary_file(&v).unwrap()["filename"], "b.jar");
        let u = search_url(&json!({ "query": "sodium mod", "kind": "mod", "gameVersion": "1.21.1", "loader": "quilt", "environment": "client" }));
        let parsed = reqwest::Url::parse(&u).unwrap();
        let q: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q["query"], "sodium mod");
        assert_eq!(q["index"], "relevance");
        assert_eq!(
            q["facets"],
            r#"[["project_type:mod"],["versions:1.21.1"],["categories:quilt","categories:fabric"],["client_side:required","client_side:optional"]]"#
        );
        assert!(u.contains("query=sodium+mod"));
    }

    #[test]
    fn channels_map_to_version_types() {
        assert_eq!(channel_types("release"), vec!["release"]);
        assert_eq!(channel_types("beta"), vec!["release", "beta"]);
        assert_eq!(channel_types("all"), vec!["release", "beta", "alpha"]);
        assert_eq!(channel_types(""), vec!["release", "beta", "alpha"]);
        assert!(is_update_backup(&stamp()), "{}", stamp());
    }

    /// modpacks.test.js: content updates move the old file into .nore-backup and keep the 3 newest backups.
    #[tokio::test]
    async fn updates_back_up_the_old_file_and_keep_three_backups() {
        let srv = serve(vec![Reply::bytes(b"new".to_vec())]).await;
        let d = tempfile::tempdir().unwrap();
        let game = d.path();
        let mods = game.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("a-1.jar"), b"old").unwrap();
        for n in ["2020-01-01_00-00-00", "2020-01-02_00-00-00", "2020-01-03_00-00-00"] {
            std::fs::create_dir_all(game.join(BACKUP_DIR).join(n)).unwrap();
        }
        std::fs::create_dir_all(game.join(BACKUP_DIR).join("2020-01-01_00-00-00-pack")).unwrap();
        let env = Env::new(crate::paths::Paths::new(game), crate::net::Net::for_tests());
        let n = apply_updates(&env, &mods, &[json!({ "oldFile": "a-1.jar", "newFile": "a-2.jar", "url": srv.url("/a-2.jar") })], Some(game)).await.unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read(mods.join("a-2.jar")).unwrap(), b"new");
        assert!(!mods.join("a-1.jar").exists());
        let mut kept = util::read_dir_names(&game.join(BACKUP_DIR));
        kept.sort();
        assert_eq!(kept.len(), 4, "{kept:?}");
        assert!(!kept.contains(&"2020-01-01_00-00-00".to_string()));
        assert!(kept.contains(&"2020-01-01_00-00-00-pack".to_string()), "pack backups are not pruned with content backups");
        let newest = kept.iter().filter(|n| is_update_backup(n)).max().unwrap();
        assert!(game.join(BACKUP_DIR).join(newest).join("mods/a-1.jar").exists());
    }

    #[tokio::test]
    async fn installed_list_and_datapack_folder() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("b.zip"), b"1").unwrap();
        std::fs::write(d.path().join("A.zip.disabled"), b"12").unwrap();
        std::fs::write(d.path().join("readme.txt"), b"x").unwrap();
        std::fs::create_dir(d.path().join("folderpack")).unwrap();
        let l = list_installed(d.path(), &[".zip"]).await;
        let names: Vec<&str> = l.as_array().unwrap().iter().map(|x| x["file"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["A.zip.disabled", "b.zip", "folderpack"]);
        assert_eq!(l[0]["enabled"], false);
        assert!(content_dir(d.path(), "datapack", None).is_err());
        assert!(content_dir(d.path(), "datapack", Some("../x")).is_err());
        assert_eq!(content_dir(d.path(), "datapack", Some("W")).unwrap(), d.path().join("saves/W/datapacks"));
    }
}
