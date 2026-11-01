//! CurseForge next to Modrinth (port of launcher/src/main/curseforge.js): search, project pages,
//! installs with required dependencies, modpacks (manifest.json zips) and recognising installed
//! files by fingerprint.
//!
//! The official API needs a key: the player's own one (Settings, sealed in the settings file) or one
//! given to the build (`NORE_CF_KEY`, a CI secret – never in git). Without a key every call goes
//! through the Nore API proxy (noreclient.pl/api/v1/cf), which adds its key on the server.

use crate::error::{msg, Result};
use crate::js::{number, ValueExt};
use crate::util::{self, Zip};
use crate::Env;
use futures::future::BoxFuture;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

pub const GAME: u32 = 432;
pub const PROXY: &str = "https://noreclient.pl/api/v1/cf";
pub const API: &str = "https://api.curseforge.com";

pub fn class_id(kind: &str) -> u64 {
    match kind {
        "modpack" => 4471,
        "resourcepack" => 12,
        "shader" => 6552,
        "datapack" => 6945,
        "plugin" => 5,
        _ => 6,
    }
}

pub fn class_kind(id: u64) -> Option<&'static str> {
    Some(match id {
        6 => "mod",
        4471 => "modpack",
        12 => "resourcepack",
        6552 => "shader",
        6945 => "datapack",
        5 => "plugin",
        _ => return None,
    })
}

fn loader_type(l: &str) -> Option<u64> {
    Some(match l {
        "forge" => 1,
        "fabric" => 4,
        "quilt" => 5,
        "neoforge" => 6,
        _ => return None,
    })
}

fn loader_name(t: u64) -> Option<&'static str> {
    Some(match t {
        1 => "forge",
        4 => "fabric",
        5 => "quilt",
        6 => "neoforge",
        _ => return None,
    })
}

pub fn release(t: u64) -> &'static str {
    match t {
        2 => "beta",
        3 => "alpha",
        _ => "release",
    }
}

fn folder(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "mod" => "mods",
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => return None,
    })
}

pub fn is_cf(id: &str) -> bool {
    id.starts_with("cf:")
}

pub fn raw_id(id: &Value) -> u64 {
    match id {
        Value::Number(n) => n.as_u64().unwrap_or(0),
        Value::String(s) => s.trim_start_matches("cf:").parse().unwrap_or(0),
        _ => 0,
    }
}

fn id_of(n: &Value) -> String {
    format!("cf:{}", raw_id(n))
}

pub fn is_mc_version(v: &str) -> bool {
    static A: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+\.\d+(\.\d+)?$").unwrap());
    static B: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}w\d{2}[a-z]$").unwrap());
    A.is_match(v) || B.is_match(v)
}

fn mc_versions(f: &Value) -> Vec<Value> {
    f["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|v| is_mc_version(v)).map(|v| json!(v)).collect()
}

/// A CurseForge client: the API with a key, the Nore proxy without one.
#[derive(Clone, Debug, Default)]
pub struct Cf {
    pub key: Option<String>,
    pub api: Option<String>,
    pub proxy: Option<String>,
}

static CATS: LazyLock<Mutex<HashMap<u64, Vec<Value>>>> = LazyLock::new(Mutex::default);
static FPS: LazyLock<Mutex<HashMap<String, u32>>> = LazyLock::new(Mutex::default);

/// Key given to the build (CI secret), never stored in git.
pub fn bundled_key() -> Option<String> {
    std::env::var("NORE_CF_KEY").ok().filter(|s| !s.is_empty()).or_else(|| option_env!("NORE_CF_KEY").map(String::from).filter(|s| !s.is_empty()))
}

impl Cf {
    pub fn new(key: Option<String>) -> Self {
        Self { key: key.filter(|k| !k.is_empty()).or_else(bundled_key), api: std::env::var("NORE_CF_API").ok(), proxy: std::env::var("NORE_CF_PROXY").ok() }
    }

    /// Always true: without a key of our own the Nore API proxy answers.
    pub fn available(&self) -> bool {
        true
    }

    pub async fn call(&self, env: &Env, path: &str, body: Option<&Value>) -> Result<Value> {
        self.call_with(env, path, body, self.key.as_deref()).await
    }

    async fn call_with(&self, env: &Env, path: &str, body: Option<&Value>, key: Option<&str>) -> Result<Value> {
        let base = match key {
            Some(_) => self.api.clone().unwrap_or_else(|| API.into()),
            None => self.proxy.clone().unwrap_or_else(|| PROXY.into()),
        };
        let url = format!("{base}{path}");
        let res = env
            .net
            .send_with_retry(
                |c| {
                    let mut r = match body {
                        Some(b) => c.post(&url).json(b),
                        None => c.get(&url),
                    };
                    r = r.header("Accept", "application/json");
                    if let Some(k) = key {
                        r = r.header("x-api-key", k);
                    }
                    r
                },
                3,
            )
            .await?;
        let s = res.status().as_u16();
        if s == 401 || s == 403 {
            return Err(msg(if key.is_some() {
                "CurseForge odrzucił klucz API – sprawdź go w Ustawieniach."
            } else {
                "CurseForge jest chwilowo niedostępny – spróbuj później albo dodaj własny klucz w Ustawieniach."
            }));
        }
        if s == 404 {
            return Err(msg("Nie znaleziono na CurseForge."));
        }
        if !res.status().is_success() {
            return Err(msg(format!("CurseForge: HTTP {s}")));
        }
        Ok(res.json().await?)
    }

    /// Checks a key before saving it.
    pub async fn test_key(&self, env: &Env, k: &str) -> Result<bool> {
        self.call_with(env, &format!("/v1/games/{GAME}"), None, Some(k)).await?;
        Ok(true)
    }

    async fn category_list(&self, env: &Env, kind: &str) -> Result<Vec<Value>> {
        let cid = class_id(kind);
        if let Some(c) = CATS.lock().unwrap_or_else(|e| e.into_inner()).get(&cid) {
            return Ok(c.clone());
        }
        let j = self.call(env, &format!("/v1/categories?gameId={GAME}&classId={cid}"), None).await?;
        let list: Vec<Value> = j["data"].as_array().into_iter().flatten().filter(|c| !c.truthy_of("isClass")).cloned().collect();
        CATS.lock().unwrap_or_else(|e| e.into_inner()).insert(cid, list.clone());
        Ok(list)
    }

    pub async fn categories(&self, env: &Env, kind: &str) -> Result<Value> {
        Ok(Value::Array(
            self.category_list(env, kind).await?.iter().map(|c| json!({ "name": c["slug"], "header": "categories", "icon": c["iconUrl"] })).collect(),
        ))
    }

    pub async fn search(&self, env: &Env, o: &Value) -> Result<Value> {
        let kind = o.str_of("kind").unwrap_or("mod");
        let sort = match o.str_of("sort").unwrap_or("relevance") {
            "downloads" => 6,
            "follows" => 2,
            "newest" => 11,
            "updated" => 3,
            _ => 1,
        };
        let offset = o.get("offset").and_then(Value::as_i64).unwrap_or(0);
        let limit = o.get("limit").and_then(Value::as_i64).unwrap_or(20);
        let mut p: Vec<(&str, String)> = vec![
            ("gameId", GAME.to_string()),
            ("classId", class_id(kind).to_string()),
            ("sortField", sort.to_string()),
            ("sortOrder", "desc".into()),
            ("index", offset.to_string()),
            ("pageSize", limit.min(50).to_string()),
        ];
        if let Some(q) = o.str_of("query").filter(|s| !s.is_empty()) {
            p.push(("searchFilter", q.into()));
        }
        if let Some(gv) = o.str_of("gameVersion").filter(|s| !s.is_empty()) {
            p.push(("gameVersion", gv.into()));
        }
        let loader_list: Vec<&str> = match o.str_of("loader").filter(|s| !s.is_empty()) {
            Some(l) => vec![l],
            None => o["loaders"].as_array().into_iter().flatten().filter_map(Value::as_str).collect(),
        };
        let loader_list: Vec<u64> = loader_list.into_iter().filter_map(loader_type).collect();
        if loader_list.len() == 1 && (kind == "mod" || kind == "modpack") {
            p.push(("modLoaderType", loader_list[0].to_string()));
        }
        let cats: Vec<&str> = o["categories"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        if !cats.is_empty() {
            let all = self.category_list(env, kind).await.unwrap_or_default();
            let ids: Vec<u64> = cats.iter().filter_map(|s| all.iter().find(|c| c.str_of("slug") == Some(s)).and_then(|c| c["id"].as_u64())).collect();
            if ids.len() == 1 {
                p.push(("categoryId", ids[0].to_string()));
            } else if ids.len() > 1 {
                p.push(("categoryIds", serde_json::to_string(&ids[..ids.len().min(10)]).unwrap_or_default()));
            }
        }
        let url = crate::modrinth::with_params("http://x/v1/mods/search", &p);
        let path = url.trim_start_matches("http://x");
        let j = self.call(env, path, None).await?;
        let total = j.pointer("/pagination/totalCount").and_then(Value::as_u64).unwrap_or(0).min(10000);
        Ok(json!({ "hits": j["data"].as_array().into_iter().flatten().map(hit).collect::<Vec<_>>(), "total_hits": total, "offset": offset, "limit": limit }))
    }

    /// Files of a project, newest first (unavailable ones left out).
    pub async fn files(&self, env: &Env, id: &Value, game_version: Option<&str>, loader: Option<&str>) -> Result<Vec<Value>> {
        let mut p: Vec<(&str, String)> = vec![("pageSize", "50".into()), ("index", "0".into())];
        if let Some(gv) = game_version.filter(|s| !s.is_empty()) {
            p.push(("gameVersion", gv.into()));
        }
        if let Some(t) = loader.and_then(loader_type) {
            p.push(("modLoaderType", t.to_string()));
        }
        let url = crate::modrinth::with_params(&format!("http://x/v1/mods/{}/files", raw_id(id)), &p);
        let j = self.call(env, url.trim_start_matches("http://x"), None).await?;
        let mut list: Vec<Value> = j["data"].as_array().into_iter().flatten().filter(|f| f.get("isAvailable") != Some(&json!(false))).cloned().collect();
        list.sort_by_key(|f| std::cmp::Reverse(util::parse_date(f.str_of("fileDate").unwrap_or(""))));
        Ok(list)
    }

    pub async fn details(&self, env: &Env, id: &str) -> Result<Value> {
        let n = json!(raw_id(&json!(id)));
        let (u1, u2) = (format!("/v1/mods/{n}"), format!("/v1/mods/{n}/description"));
        let (m, desc, list) = tokio::join!(self.call(env, &u1, None), self.call(env, &u2, None), self.files(env, &n, None, None));
        let m = m?["data"].clone();
        let desc = desc.map(|d| d["data"].clone()).unwrap_or(json!(""));
        let list = list.unwrap_or_default();
        let mut dep_ids: Vec<u64> = Vec::new();
        for f in list.iter().take(5) {
            for d in f["dependencies"].as_array().into_iter().flatten() {
                if d["relationType"].as_u64() == Some(3) {
                    if let Some(id) = d["modId"].as_u64() {
                        if !dep_ids.contains(&id) {
                            dep_ids.push(id);
                        }
                    }
                }
            }
        }
        let deps = if dep_ids.is_empty() {
            vec![]
        } else {
            self.call(env, "/v1/mods", Some(&json!({ "modIds": dep_ids }))).await.ok().and_then(|j| j["data"].as_array().cloned()).unwrap_or_default()
        };
        let links = &m["links"];
        let slug = m.string_or("slug", "");
        Ok(json!({
            "project": {
                "id": id_of(&m["id"]), "slug": m["slug"], "title": m["name"], "description": m["summary"], "bodyHtml": if desc.is_string() { desc } else { json!("") }, "body": "",
                "icon_url": m["logo"]["thumbnailUrl"], "gallery": m["screenshots"].as_array().into_iter().flatten().map(|s| json!({ "url": s["url"], "title": s["title"], "featured": false })).collect::<Vec<_>>(),
                "categories": m["categories"].as_array().into_iter().flatten().map(|c| c["slug"].clone()).collect::<Vec<_>>(), "downloads": m["downloadCount"], "followers": m["thumbsUpCount"], "updated": m["dateModified"],
                "license": null, "project_type": class_kind(m["classId"].as_u64().unwrap_or(0)).unwrap_or("mod"), "source": "curseforge",
                "source_url": links.get("sourceUrl").cloned().filter(|v| !v.is_null()), "issues_url": links.get("issuesUrl").cloned().filter(|v| !v.is_null()), "wiki_url": links.get("wikiUrl").cloned().filter(|v| !v.is_null()), "discord_url": null,
                "web_url": links.str_of("websiteUrl").filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| format!("https://www.curseforge.com/minecraft/{slug}")),
            },
            "versions": list.iter().map(version).collect::<Vec<_>>(),
            "members": m["authors"].as_array().into_iter().flatten().map(|a| json!({ "name": a["name"], "role": "Autor", "avatar": null })).collect::<Vec<_>>(),
            "dependencies": deps.iter().map(|d| json!({ "id": id_of(&d["id"]), "title": d["name"], "icon": d["logo"]["thumbnailUrl"], "slug": d["slug"], "type": "wymagana" })).collect::<Vec<_>>(),
        }))
    }

    pub async fn project(&self, env: &Env, id: &str) -> Result<Value> {
        let m = self.call(env, &format!("/v1/mods/{}", raw_id(&json!(id))), None).await?["data"].clone();
        Ok(json!({ "id": id_of(&m["id"]), "title": m["name"], "icon_url": m["logo"]["thumbnailUrl"], "slug": m["slug"], "description": m["summary"] }))
    }

    /// Installs a project into the target folder (mods / plugins also get their required dependencies).
    pub fn install<'a>(
        &'a self,
        env: &'a Env,
        req: crate::modrinth::InstallReq,
        on_status: crate::modrinth::StatusFn<'a>,
        seen: &'a mut HashSet<u64>,
        ctx: &'a mut crate::modrinth::HaveCtx,
    ) -> BoxFuture<'a, Result<Vec<String>>> {
        Box::pin(async move {
            let n = raw_id(&json!(req.project_id));
            if !seen.insert(n) {
                return Ok(vec![]);
            }
            let gv = req.game_version.clone().filter(|s| !s.is_empty());
            let file = match req.version_id.as_deref().filter(|s| !s.is_empty()) {
                Some(v) => Some(self.call(env, &format!("/v1/mods/{n}/files/{v}"), None).await?["data"].clone()),
                None => {
                    let loader = if req.kind == "mod" { req.loader.as_deref() } else { None };
                    let list = self.files(env, &json!(n), gv.as_deref(), loader).await?;
                    let ok: Vec<&Value> = list
                        .iter()
                        .filter(|f| gv.as_ref().is_none_or(|g| f["gameVersions"].as_array().is_some_and(|l| l.iter().any(|x| x.as_str() == Some(g)))))
                        .collect();
                    ok.iter().find(|f| f["releaseType"].as_u64() == Some(1)).or(ok.first()).map(|f| (*f).clone())
                }
            };
            let Some(file) = file else {
                let l = match (&req.loader, req.kind.as_str()) {
                    (Some(l), "mod") if !l.is_empty() => format!(" ({l})"),
                    _ => String::new(),
                };
                return Err(msg(format!("Brak wersji zgodnej z {}{l}", gv.unwrap_or_else(|| "tą wersją gry".into()))));
            };
            let name = file.string_or("fileName", "");
            if name.is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
                return Err(msg("Niedozwolona nazwa pliku"));
            }
            tokio::fs::create_dir_all(&req.target_dir).await?;
            on_status(format!("Pobieranie {name}"));
            env.net.download(&file_url(&file), &req.target_dir.join(&name), sha1_of(&file).as_deref(), file["fileLength"].as_u64(), &|_| {}).await?;
            let mut out = vec![name];
            if req.kind == "mod" || req.kind == "plugin" {
                for d in file["dependencies"].as_array().cloned().unwrap_or_default() {
                    if d["relationType"].as_u64() != Some(3) {
                        continue;
                    }
                    let mid = d["modId"].as_u64().unwrap_or(0);
                    if self.has_project(env, &req.target_dir, mid, ctx).await {
                        continue;
                    }
                    let sub = crate::modrinth::InstallReq { project_id: mid.to_string(), version_id: None, ..req.clone() };
                    match self.install(env, sub, on_status, seen, ctx).await {
                        Ok(more) => out.extend(more),
                        Err(e) => on_status(format!("Nie udało się pobrać zależności: {e}")),
                    }
                }
            }
            Ok(out)
        })
    }

    async fn has_project(&self, env: &Env, dir: &Path, mod_id: u64, ctx: &mut crate::modrinth::HaveCtx) -> bool {
        if ctx.ids.is_none() {
            let ids = self.identify(env, dir, &[".jar"], &HashSet::new()).await.unwrap_or_default();
            ctx.ids = Some(ids.values().filter_map(|m| m.str_of("projectId").map(String::from)).collect());
        }
        if ctx.ids.as_ref().is_some_and(|s| s.contains(&format!("cf:{mod_id}"))) {
            return true;
        }
        if ctx.present.is_none() {
            ctx.present = Some(crate::perf::present_set(&crate::perf::scan(dir).await));
        }
        let Ok(m) = self.call(env, &format!("/v1/mods/{mod_id}"), None).await else { return false };
        let n = crate::perf::norm(m["data"].str_of("slug").unwrap_or(""));
        !n.is_empty() && ctx.present.as_ref().is_some_and(|s| s.contains(&n))
    }

    /// Files of a folder that are CurseForge projects: `{ file: { projectId, version, title, icon, … } }`.
    pub async fn identify(&self, env: &Env, dir: &Path, exts: &[&str], skip: &HashSet<String>) -> Result<serde_json::Map<String, Value>> {
        let mut names: Vec<String> = util::read_dir_names(dir)
            .into_iter()
            .filter(|n| !skip.contains(n) && exts.iter().any(|e| n.to_lowercase().trim_end_matches(".disabled").ends_with(e)))
            .collect();
        names.sort();
        let by_fp = fingerprints(dir, &names).await;
        if by_fp.is_empty() {
            return Ok(Default::default());
        }
        let fps: Vec<u32> = by_fp.keys().copied().collect();
        let j = self.call(env, &format!("/v1/fingerprints/{GAME}"), Some(&json!({ "fingerprints": fps }))).await?;
        let matches = j.pointer("/data/exactMatches").and_then(Value::as_array).cloned().unwrap_or_default();
        if matches.is_empty() {
            return Ok(Default::default());
        }
        let mut ids: Vec<u64> = matches.iter().filter_map(|m| m["id"].as_u64()).collect();
        ids.sort();
        ids.dedup();
        let mods = self.call(env, "/v1/mods", Some(&json!({ "modIds": ids }))).await.ok().and_then(|j| j["data"].as_array().cloned()).unwrap_or_default();
        let by_id: HashMap<u64, &Value> = mods.iter().filter_map(|m| Some((m["id"].as_u64()?, m))).collect();
        let mut out = serde_json::Map::new();
        for mt in &matches {
            let empty = json!({});
            let m = by_id.get(&mt["id"].as_u64().unwrap_or(0)).copied().unwrap_or(&empty);
            let f = &mt["file"];
            let Some(file) = f["fileFingerprint"].as_u64().and_then(|fp| by_fp.get(&(fp as u32))) else { continue };
            out.insert(
                file.clone(),
                json!({
                    "projectId": id_of(&mt["id"]), "version": f["displayName"], "versionId": f["id"].as_u64().map(|x| x.to_string()), "title": m.get("name"), "icon": m.pointer("/logo/thumbnailUrl"),
                    "slug": m.get("slug"), "description": m.get("summary"), "gameVersions": mc_versions(f), "loaders": [], "source": "curseforge",
                }),
            );
        }
        Ok(out)
    }

    /// Newer CurseForge files for recognised files (same game version / loader, by update channel).
    #[allow(clippy::too_many_arguments)]
    pub async fn check_updates(
        &self,
        env: &Env,
        dir: &Path,
        kind: &str,
        game_version: &str,
        loader: &str,
        types: &[&str],
        skip: &HashSet<String>,
    ) -> Result<Vec<Value>> {
        let exts: &[&str] = if kind == "mod" { &[".jar"] } else { &[".zip"] };
        let ids = self.identify(env, dir, exts, skip).await?;
        let mut out = Vec::new();
        for (file, info) in ids {
            if file.ends_with(".disabled") {
                continue;
            }
            let loader = if kind == "mod" { Some(loader) } else { None };
            let Ok(list) = self.files(env, &info["projectId"], Some(game_version), loader).await else { continue };
            let cur_id = info.string_or("versionId", "");
            let best = list.iter().find(|f| {
                types.contains(&release(f["releaseType"].as_u64().unwrap_or(1)))
                    && f["gameVersions"].as_array().is_some_and(|l| l.iter().any(|x| x.as_str() == Some(game_version)))
            });
            let Some(best) = best else { continue };
            let cur_date = list
                .iter()
                .find(|f| f["id"].as_u64().map(|x| x.to_string()) == Some(cur_id.clone()))
                .map_or(0, |f| util::parse_date(f.str_of("fileDate").unwrap_or("")));
            if best["id"].as_u64().map(|x| x.to_string()) == Some(cur_id.clone()) || util::parse_date(best.str_of("fileDate").unwrap_or("")) <= cur_date {
                continue;
            }
            out.push(json!({
                "oldFile": file, "newFile": best["fileName"], "url": file_url(best), "sha1": sha1_of(best), "size": best["fileLength"], "version": best["displayName"],
                "type": release(best["releaseType"].as_u64().unwrap_or(1)), "projectId": info["projectId"], "versionId": best["id"].as_u64().map(|x| x.to_string()), "source": "curseforge",
            }));
        }
        Ok(out)
    }

    /// Resolves manifest files to download tasks (chunks of 200 file + project records).
    pub async fn resolve_files(&self, env: &Env, manifest: &Value, root: &Path, on_progress: &(dyn Fn(Value) + Send + Sync)) -> Result<ManifestTasks> {
        let wanted: Vec<&Value> = manifest["files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| f.get("required") != Some(&json!(false)) && truthy_id(&f["projectID"]) && truthy_id(&f["fileID"]))
            .collect();
        let mut all = ManifestTasks::default();
        for (i, chunk) in wanted.chunks(200).enumerate() {
            on_progress(json!({ "stage": "Pobieranie listy plików z CurseForge", "done": i * 200, "total": wanted.len() }));
            let file_ids: Vec<&Value> = chunk.iter().map(|f| &f["fileID"]).collect();
            let mod_ids: Vec<&Value> = chunk.iter().map(|f| &f["projectID"]).collect();
            let (b1, b2) = (json!({ "fileIds": file_ids }), json!({ "modIds": mod_ids }));
            let (fl, mods) = tokio::join!(self.call(env, "/v1/mods/files", Some(&b1)), self.call(env, "/v1/mods", Some(&b2)));
            let (fl, mods) = (fl?, mods?);
            let r = manifest_tasks(
                &json!({ "files": chunk }),
                fl["data"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                mods["data"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                root,
            );
            all.tasks.extend(r.tasks);
            all.server_only.extend(r.server_only);
            all.missing.extend(r.missing);
        }
        Ok(all)
    }

    /// The pack as a modrinth.index.json-like index so installs / safe updates treat both formats alike.
    pub async fn to_index(&self, env: &Env, manifest: &Value, on_progress: &(dyn Fn(Value) + Send + Sync)) -> Result<Value> {
        let r = self.resolve_files(env, manifest, Path::new("."), on_progress).await?;
        let (loader, lv) = loader_of(manifest);
        let mut deps = serde_json::Map::new();
        deps.insert("minecraft".into(), manifest["minecraft"]["version"].clone());
        if let Some(d) = match loader.as_str() {
            "fabric" => Some("fabric-loader"),
            "quilt" => Some("quilt-loader"),
            "forge" => Some("forge"),
            "neoforge" => Some("neoforge"),
            _ => None,
        } {
            deps.insert(d.into(), json!(lv));
        }
        Ok(json!({
            "name": manifest["name"], "versionId": manifest["version"], "summary": manifest.str_of("author").filter(|a| !a.is_empty()).map(|a| format!("Autor: {a}")).unwrap_or_default(),
            "dependencies": deps,
            "files": r.tasks.iter().map(|t| {
                let mut f = json!({ "path": t.rel, "downloads": [t.url], "hashes": t.sha1.as_ref().map(|s| json!({ "sha1": s })).unwrap_or(json!({})), "fileSize": t.size });
                if let Some(b) = &t.blocked { f["blocked"] = b.clone(); }
                f
            }).collect::<Vec<_>>(),
            "serverOnly": r.server_only,
        }))
    }

    /// Pack files of a project for the version picker, newest first.
    pub async fn pack_versions(&self, env: &Env, project_id: &Value) -> Result<Vec<Value>> {
        Ok(self
            .files(env, project_id, None, None)
            .await?
            .iter()
            .map(|f| {
                json!({ "id": f["id"].as_u64().map(|x| x.to_string()), "number": f.get("displayName").filter(|v| !v.is_null()).unwrap_or(&f["fileName"]), "name": f["displayName"],
                "type": release(f["releaseType"].as_u64().unwrap_or(1)), "date": f["fileDate"], "gameVersions": mc_versions(f), "changelog": "" })
            })
            .collect())
    }

    /// Pack file (newest release or the given file) downloaded to the cache, with project info.
    pub async fn download_pack(&self, env: &Env, project_id: &str, file_id: Option<&str>, cache_dir: &Path) -> Result<Value> {
        let n = raw_id(&json!(project_id));
        let f = match file_id.filter(|s| !s.is_empty()) {
            Some(id) => self.call(env, &format!("/v1/mods/{n}/files/{id}"), None).await?["data"].clone(),
            None => {
                let list = self.files(env, &json!(n), None, None).await?;
                list.iter()
                    .find(|x| x["releaseType"].as_u64() == Some(1))
                    .or(list.first())
                    .cloned()
                    .ok_or_else(|| msg("Ta paczka nie ma jeszcze żadnej wersji."))?
            }
        };
        let name = util::basename(f.str_of("fileName").unwrap_or("pack.zip"));
        let dest = cache_dir.join(&name);
        env.net.download(&file_url(&f), &dest, sha1_of(&f).as_deref(), f["fileLength"].as_u64(), &|_| {}).await?;
        let m = self.call(env, &format!("/v1/mods/{n}"), None).await?["data"].clone();
        Ok(json!({
            "file": dest.to_string_lossy(), "fileId": f["id"], "version": f["displayName"], "type": release(f["releaseType"].as_u64().unwrap_or(1)), "date": f["fileDate"],
            "title": m["name"], "icon": m["logo"]["thumbnailUrl"], "banner": m["screenshots"].get(0).map(|s| s["url"].clone()).unwrap_or(Value::Null),
        }))
    }

    /// Changelog of a file as plain text (CurseForge returns HTML).
    pub async fn changelog(&self, env: &Env, project_id: &Value, file_id: &Value) -> String {
        let fid = raw_id(file_id);
        let j = self.call(env, &format!("/v1/mods/{}/files/{fid}/changelog", raw_id(project_id)), None).await.unwrap_or(json!({ "data": "" }));
        html_to_text(j.str_of("data").unwrap_or(""))
    }

    pub async fn file_info(&self, env: &Env, project_id: &Value, file_id: &Value) -> Result<Value> {
        Ok(self.call(env, &format!("/v1/mods/{}/files/{}", raw_id(project_id), raw_id(file_id)), None).await?["data"].clone())
    }
}

fn truthy_id(v: &Value) -> bool {
    number(v) != 0.0 && !v.is_null()
}

/// A search hit in the Modrinth shape the browser uses.
pub fn hit(m: &Value) -> Value {
    let cats: Vec<Value> = m["categories"].as_array().into_iter().flatten().map(|c| c["slug"].clone()).collect();
    let mut all = cats.clone();
    let mut seen = HashSet::new();
    for f in m["latestFilesIndexes"].as_array().into_iter().flatten() {
        if let Some(l) = f["modLoader"].as_u64().and_then(loader_name) {
            if seen.insert(l) {
                all.push(json!(l));
            }
        }
    }
    let shot = m["screenshots"].get(0).map(|s| s["url"].clone()).unwrap_or(Value::Null);
    json!({
        "project_id": id_of(&m["id"]), "slug": m["slug"], "title": m["name"], "description": m.string_or("summary", ""), "author": m["authors"].get(0).map(|a| a["name"].clone()).unwrap_or(json!("")),
        "icon_url": m["logo"].get("thumbnailUrl").filter(|v| !v.is_null()).or(m["logo"].get("url")).cloned().unwrap_or(Value::Null),
        "downloads": m.get("downloadCount").cloned().unwrap_or(json!(0)), "follows": m.get("thumbsUpCount").cloned().unwrap_or(json!(0)),
        "date_modified": m["dateModified"], "categories": all, "display_categories": cats, "featured_gallery": shot, "source": "curseforge",
        "project_type": class_kind(m["classId"].as_u64().unwrap_or(0)).unwrap_or("mod"),
    })
}

/// One file in the Modrinth version shape of the details view.
pub fn version(f: &Value) -> Value {
    let loaders: Vec<String> = f["gameVersions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_lowercase)
        .filter(|v| ["forge", "fabric", "quilt", "neoforge"].contains(&v.as_str()))
        .collect();
    let name = f.get("displayName").filter(|v| v.as_str().is_some_and(|s| !s.is_empty())).unwrap_or(&f["fileName"]).clone();
    json!({
        "id": f["id"].as_u64().map(|x| x.to_string()), "name": name, "number": name, "type": release(f["releaseType"].as_u64().unwrap_or(1)),
        "date": f["fileDate"], "downloads": f.get("downloadCount").cloned().unwrap_or(json!(0)), "gameVersions": mc_versions(f), "loaders": loaders,
        "changelog": "", "file": f["fileName"], "size": f["fileLength"],
        "deps": f["dependencies"].as_array().into_iter().flatten().filter(|d| d["relationType"].as_u64() == Some(3)).map(|d| json!({ "id": id_of(&d["modId"]), "type": "required" })).collect::<Vec<_>>(),
    })
}

/// Direct CDN link of a file (authors can block third-party downloads: the path is predictable).
pub fn file_url(f: &Value) -> String {
    if let Some(u) = f.str_of("downloadUrl").filter(|s| !s.is_empty()) {
        return u.to_string();
    }
    let id = f["id"].as_u64().unwrap_or(0);
    format!("https://edge.forgecdn.net/files/{}/{}/{}", id / 1000, id % 1000, urlencoding::encode(f.str_of("fileName").unwrap_or("")))
}

pub fn website_download(project_id: u64, file_id: u64) -> String {
    format!("https://www.curseforge.com/api/v1/mods/{project_id}/files/{file_id}/download")
}

pub fn sha1_of(f: &Value) -> Option<String> {
    f["hashes"].as_array()?.iter().find(|h| h["algo"].as_u64() == Some(1)).and_then(|h| h.str_of("value").map(String::from))
}

/// CurseForge's file fingerprint: MurmurHash2 (seed 1) over the bytes without whitespace (9, 10, 13, 32).
pub fn fingerprint(buf: &[u8]) -> u32 {
    let data: Vec<u8> = buf.iter().copied().filter(|b| !matches!(b, 9 | 10 | 13 | 32)).collect();
    let m: u32 = 0x5bd1e995;
    let len = data.len();
    let mut h: u32 = 1 ^ (len as u32);
    let mut chunks = data.chunks_exact(4);
    for c in &mut chunks {
        let mut k = u32::from_le_bytes([c[0], c[1], c[2], c[3]]);
        k = k.wrapping_mul(m);
        k ^= k >> 24;
        k = k.wrapping_mul(m);
        h = h.wrapping_mul(m) ^ k;
    }
    let rest = chunks.remainder();
    match rest.len() {
        3 => {
            h ^= (rest[2] as u32) << 16;
            h ^= (rest[1] as u32) << 8;
            h ^= rest[0] as u32;
            h = h.wrapping_mul(m);
        }
        2 => {
            h ^= (rest[1] as u32) << 8;
            h ^= rest[0] as u32;
            h = h.wrapping_mul(m);
        }
        1 => {
            h ^= rest[0] as u32;
            h = h.wrapping_mul(m);
        }
        _ => {}
    }
    h ^= h >> 13;
    h = h.wrapping_mul(m);
    h ^= h >> 15;
    h
}

async fn fingerprints(dir: &Path, names: &[String]) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    for n in names {
        let full = dir.join(n);
        let Ok(meta) = tokio::fs::metadata(&full).await else { continue };
        if !meta.is_file() {
            continue;
        }
        let key = format!("{}|{}|{}", full.display(), meta.len(), util::mtime_ms(&meta));
        let cached = FPS.lock().unwrap_or_else(|e| e.into_inner()).get(&key).copied();
        let fp = match cached {
            Some(f) => f,
            None => {
                let Ok(b) = tokio::fs::read(&full).await else { continue };
                let f = tokio::task::spawn_blocking(move || fingerprint(&b)).await.unwrap_or(0);
                FPS.lock().unwrap_or_else(|e| e.into_inner()).insert(key, f);
                f
            }
        };
        out.insert(fp, n.clone());
    }
    out
}

/// Reads manifest.json of a CurseForge pack zip (None when it is not one).
pub fn read_manifest(file: &Path) -> Option<(Zip, Value)> {
    let mut zip = Zip::open(file).ok()?;
    let manifest = zip.json("manifest.json")?;
    if manifest.get("minecraft").is_none_or(Value::is_null) || !manifest["files"].is_array() {
        return None;
    }
    Some((zip, manifest))
}

/// "forge-47.2.0" / "neoforge-21.1.80" / "fabric-0.16.9" → (loader, loaderVersion).
pub fn loader_of(manifest: &Value) -> (String, Option<String>) {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(forge|neoforge|fabric|quilt)-(.+)$").unwrap());
    let list = manifest["minecraft"]["modLoaders"].as_array().cloned().unwrap_or_default();
    let l = list.iter().find(|x| x.truthy_of("primary")).or(list.first()).and_then(|x| x.str_of("id")).unwrap_or("").to_string();
    let Some(c) = RE.captures(&l) else { return ("vanilla".into(), None) };
    let loader = c[1].to_lowercase();
    let mut v = c[2].to_string();
    let mc = manifest["minecraft"].string_or("version", "");
    if loader == "forge" && v.starts_with(&format!("{mc}-")) {
        v = v[mc.len() + 1..].to_string();
    }
    (loader, Some(v))
}

/// Folder for a pack file without project info: by looking inside the file.
pub fn guess_folder(file: &Path) -> &'static str {
    if file.to_string_lossy().to_lowercase().ends_with(".jar") {
        return "mods";
    }
    if let Ok(z) = Zip::open(file) {
        let names = z.names();
        if names.iter().any(|n| n.to_lowercase().starts_with("shaders/")) {
            return "shaderpacks";
        }
        if names.iter().any(|n| n == "pack.mcmeta") {
            return "resourcepacks";
        }
    }
    "mods"
}

/// A file only for dedicated servers (CurseForge tags files with "Client" / "Server").
pub fn server_only(f: &Value) -> bool {
    let gv: Vec<String> = f["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_lowercase).collect();
    gv.iter().any(|v| v == "server") && !gv.iter().any(|v| v == "client")
}

/// One file of a pack to download.
#[derive(Clone, Debug, Default)]
pub struct PackTask {
    pub url: String,
    pub dest: PathBuf,
    pub rel: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub name: String,
    pub blocked: Option<Value>,
}

#[derive(Debug, Default)]
pub struct ManifestTasks {
    pub tasks: Vec<PackTask>,
    pub server_only: Vec<Value>,
    pub optional: Vec<Value>,
    pub missing: Vec<u64>,
}

/// Pure part of resolving a manifest: manifest.files + the API's file and project records → tasks.
/// Files whose author blocked third-party downloads get the CDN link and a `blocked` record.
pub fn manifest_tasks(manifest: &Value, file_list: &[Value], mod_list: &[Value], root: &Path) -> ManifestTasks {
    let all: Vec<&Value> = manifest["files"].as_array().into_iter().flatten().filter(|f| truthy_id(&f["projectID"]) && truthy_id(&f["fileID"])).collect();
    let optional =
        all.iter().filter(|f| f.get("required") == Some(&json!(false))).map(|f| json!({ "projectId": f["projectID"], "fileId": f["fileID"] })).collect();
    let mut wanted: Vec<u64> = Vec::new();
    for f in all.iter().filter(|f| f.get("required") != Some(&json!(false))) {
        let id = number(&f["fileID"]) as u64;
        if !wanted.contains(&id) {
            wanted.push(id);
        }
    }
    let mods: HashMap<u64, &Value> = mod_list.iter().filter_map(|m| Some((m["id"].as_u64()?, m))).collect();
    let mut out = ManifestTasks { optional, ..Default::default() };
    let mut got = HashSet::new();
    let empty = json!({});
    for f in file_list {
        let fid = number(&f["id"]) as u64;
        if !wanted.contains(&fid) {
            continue;
        }
        got.insert(fid);
        let m = mods.get(&f["modId"].as_u64().unwrap_or(0)).copied().unwrap_or(&empty);
        let title = m.str_of("name").or(f.str_of("displayName")).unwrap_or("").to_string();
        if server_only(f) {
            out.server_only.push(json!({ "projectId": f["modId"], "fileId": f["id"], "name": f["fileName"], "title": title }));
            continue;
        }
        let dir = class_kind(m["classId"].as_u64().unwrap_or(0)).and_then(folder).unwrap_or("mods");
        let name = util::basename(f.str_of("fileName").unwrap_or(""));
        let rel = format!("{dir}/{name}");
        let mut t = PackTask {
            url: file_url(f),
            dest: root.join(dir).join(&name),
            rel: rel.clone(),
            sha1: sha1_of(f),
            size: f["fileLength"].as_u64(),
            name: name.clone(),
            blocked: None,
        };
        if f.str_of("downloadUrl").is_none_or(str::is_empty) {
            let site = m.pointer("/links/websiteUrl").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| {
                format!("https://www.curseforge.com/minecraft/mc-mods/{}", m.str_of("slug").map(String::from).unwrap_or_else(|| f["modId"].to_string()))
            });
            let title = if title.is_empty() { name.clone() } else { title };
            t.blocked = Some(json!({
                "projectId": f["modId"], "fileId": f["id"], "title": title, "file": name, "rel": rel, "sha1": t.sha1, "size": f["fileLength"],
                "page": format!("{}/download/{}", site.trim_end_matches('/'), fid),
            }));
        }
        out.tasks.push(t);
    }
    out.missing = wanted.into_iter().filter(|id| !got.contains(id)).collect();
    out
}

pub fn html_to_text(html: &str) -> String {
    static R: LazyLock<[Regex; 6]> = LazyLock::new(|| {
        [
            Regex::new(r"(?i)<br\s*/?>").unwrap(),
            Regex::new(r"(?i)</(p|div|li|h\d)>").unwrap(),
            Regex::new(r"(?i)<li[^>]*>").unwrap(),
            Regex::new(r"<[^>]+>").unwrap(),
            Regex::new(r"\n{3,}").unwrap(),
            Regex::new(r"x").unwrap(),
        ]
    });
    let s = R[0].replace_all(html, "\n");
    let s = R[1].replace_all(&s, "\n");
    let s = R[2].replace_all(&s, "• ");
    let s = R[3].replace_all(&s, "");
    let s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'");
    R[4].replace_all(&s, "\n\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_matches_curseforge() {
        // values computed with curseforge.js fingerprint()
        assert_eq!(fingerprint(b""), 1540447798);
        assert_eq!(fingerprint(b"hello"), 2788266382);
        assert_eq!(fingerprint(b"abcdefg"), 184182053);
        assert_eq!(fingerprint(b"a b\tc\r\n"), fingerprint(b"abc"));
        assert_eq!(fingerprint(b"hello"), fingerprint(b"he llo"));
    }

    /// curseforge.test.js: manifest loader and Minecraft version.
    #[test]
    fn manifest_loader_and_version() {
        let m = |id: &str, mc: &str| json!({ "minecraft": { "version": mc, "modLoaders": [{ "id": id, "primary": true }] }, "files": [] });
        assert_eq!(loader_of(&m("forge-47.2.0", "1.20.1")), ("forge".into(), Some("47.2.0".into())));
        assert_eq!(loader_of(&m("neoforge-21.1.80", "1.21.1")), ("neoforge".into(), Some("21.1.80".into())));
        assert_eq!(loader_of(&m("forge-1.20.1-47.1.3", "1.20.1")), ("forge".into(), Some("47.1.3".into())));
        assert_eq!(loader_of(&m("fabric-0.16.9", "1.21.1")), ("fabric".into(), Some("0.16.9".into())));
        assert_eq!(loader_of(&json!({ "minecraft": { "version": "1.21" }, "files": [] })), ("vanilla".into(), None));
    }

    /// curseforge.test.js: folders by class, server-only and optional files skipped, blocked files flagged.
    #[test]
    fn manifest_files() {
        let manifest = json!({ "files": [
            { "projectID": 1, "fileID": 11, "required": true }, { "projectID": 2, "fileID": 22 }, { "projectID": 3, "fileID": 33 },
            { "projectID": 4, "fileID": 44, "required": false }, { "projectID": 5, "fileID": 55 }, { "projectID": 6, "fileID": 66 },
        ]});
        let files = vec![
            json!({ "id": 11, "modId": 1, "fileName": "sodium.jar", "downloadUrl": "https://x/sodium.jar", "fileLength": 10, "hashes": [{ "algo": 1, "value": "aa" }], "gameVersions": ["1.21.1", "Client"] }),
            json!({ "id": 22, "modId": 2, "fileName": "faithful.zip", "downloadUrl": "https://x/f.zip", "fileLength": 5 }),
            json!({ "id": 33, "modId": 3, "fileName": "blocked-1234.jar", "downloadUrl": null, "fileLength": 7, "hashes": [{ "algo": 1, "value": "bb" }] }),
            json!({ "id": 55, "modId": 5, "fileName": "server-util.jar", "downloadUrl": "https://x/s.jar", "gameVersions": ["Server"] }),
        ];
        let mods = vec![
            json!({ "id": 1, "classId": 6, "name": "Sodium" }),
            json!({ "id": 2, "classId": 12, "name": "Faithful" }),
            json!({ "id": 3, "classId": 6, "name": "Blocked Mod", "slug": "blocked-mod" }),
            json!({ "id": 5, "classId": 6, "name": "Server Util" }),
        ];
        let r = manifest_tasks(&manifest, &files, &mods, Path::new("/i"));
        let rels: Vec<&str> = r.tasks.iter().map(|t| t.rel.as_str()).collect();
        assert_eq!(rels, vec!["mods/sodium.jar", "resourcepacks/faithful.zip", "mods/blocked-1234.jar"]);
        assert_eq!(r.tasks[0].sha1.as_deref(), Some("aa"));
        assert_eq!(r.tasks[0].dest, Path::new("/i/mods/sodium.jar"));
        let b = r.tasks[2].blocked.as_ref().unwrap();
        assert_eq!(b["page"], "https://www.curseforge.com/minecraft/mc-mods/blocked-mod/download/33");
        assert_eq!(r.tasks[2].url, "https://edge.forgecdn.net/files/0/33/blocked-1234.jar");
        assert_eq!(r.server_only.len(), 1);
        assert_eq!(r.optional, vec![json!({ "projectId": 4, "fileId": 44 })]);
        assert_eq!(r.missing, vec![66]);
        assert!(server_only(&files[3]) && !server_only(&files[0]));
    }

    #[test]
    fn html_changelog_to_text() {
        assert_eq!(html_to_text("<p>Fix &amp; <b>speed</b></p><ul><li>a</li><li>b</li></ul>"), "Fix & speed\n• a\n• b");
        assert!(is_mc_version("1.21.1") && is_mc_version("24w14a") && !is_mc_version("Forge"));
        assert_eq!(raw_id(&json!("cf:238222")), 238222);
        assert_eq!(file_url(&json!({ "id": 4567890, "fileName": "a b.jar" })), "https://edge.forgecdn.net/files/4567/890/a%20b.jar");
    }
}
