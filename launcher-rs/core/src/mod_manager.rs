//! Installed mods / plugins of an instance or a server (port of launcher/src/main/mod-manager.js):
//! detailed list, enable / disable, bulk actions, pins, profiles, mod list export, exporting an
//! instance as .mrpack / CurseForge .zip and the config file list.

use crate::error::{msg, Result};
use crate::js::{now_ms, ValueExt};
use crate::mod_meta::{self, ModFile};
use crate::util::{self, locale_cmp};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

const DISABLED: &str = ".disabled";

pub fn base_name(f: &str) -> &str {
    f.strip_suffix(DISABLED).unwrap_or(f)
}

/// Stable key for a mod across versions: its id from metadata, else the file name without version.
pub fn mod_key(file: &str, meta: Option<&Value>) -> String {
    static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.(jar|zip)$").unwrap());
    static VER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)[-_+ ]?(mc)?v?\d[\w.+-]*$").unwrap());
    static NON: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
    if let Some(id) = meta.and_then(|m| m.str_of("id")).filter(|s| !s.is_empty()) {
        return id.to_lowercase();
    }
    let b = base_name(file).to_lowercase();
    let s = EXT.replace(&b, "");
    let s = VER.replace(&s, "");
    let s = NON.replace_all(&s, "").to_string();
    if s.is_empty() {
        b
    } else {
        s
    }
}

/// Jars of a folder with their metadata.
pub async fn read_folder(dir: &Path) -> Vec<ModFile> {
    let dir = dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(&dir) else { return out };
        for e in rd.flatten() {
            if !e.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if !base_name(&name).to_lowercase().ends_with(".jar") {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            out.push(ModFile { file: name.clone(), enabled: !name.ends_with(DISABLED), size: meta.len(), meta: mod_meta::read_jar(&e.path()) });
        }
        out
    })
    .await
    .unwrap_or_default()
}

/// Lists jars with metadata and analysis: `{ mods, warnings }`.
pub async fn list(dir: &Path, server: bool, loader: Option<&str>, pins: &[Value], ids: &Map<String, Value>) -> Value {
    describe(&read_folder(dir).await, server, loader, pins, ids)
}

fn side_from_project(p: Option<&Value>) -> &'static str {
    let Some(p) = p else { return "unknown" };
    let (c, s) = (p.str_of("clientSide"), p.str_of("serverSide"));
    if c.is_none() && s.is_none() {
        return "unknown";
    }
    if s == Some("unsupported") {
        return "client";
    }
    if c == Some("unsupported") {
        return "server";
    }
    "both"
}

/// Pure part of [`list`]: analysis, keys, pins and identified project info.
pub fn describe(mods: &[ModFile], server: bool, loader: Option<&str>, pins: &[Value], ids: &Map<String, Value>) -> Value {
    static JAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.jar$").unwrap());
    let (by_file, warnings) = mod_meta::analyze(mods, server, loader);
    let pin_set: HashSet<String> = pins.iter().map(|p| crate::config_edit::js_string(p).to_lowercase()).collect();
    let name_of = |f: &str| -> String {
        match mods.iter().find(|m| m.file == f) {
            Some(m) => m.meta.as_ref().and_then(|x| x.str_of("name")).filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| base_name(f).to_string()),
            None => f.to_string(),
        }
    };
    let empty = json!({});
    let mut out: Vec<Value> = mods
        .iter()
        .map(|m| {
            let a = by_file.get(&m.file).cloned().unwrap_or(json!({ "dependents": [], "missing": [], "conflicts": [] }));
            let md = m.meta.as_ref().unwrap_or(&empty);
            let idf = ids.get(&m.file).or_else(|| ids.get(base_name(&m.file)));
            let key = mod_key(&m.file, m.meta.as_ref());
            let pick = |a: Option<&str>, b: Option<&str>| a.filter(|s| !s.is_empty()).or(b.filter(|s| !s.is_empty())).map(String::from);
            let name = pick(idf.and_then(|i| i.str_of("title")), md.str_of("name")).unwrap_or_else(|| JAR.replace(base_name(&m.file), "").to_string());
            let side = match md.str_of("side") {
                Some(s) if s != "unknown" => s,
                _ => side_from_project(idf),
            };
            let names = |k: &str| a[k].as_array().into_iter().flatten().filter_map(Value::as_str).map(|f| json!({ "file": f, "name": name_of(f) })).collect::<Vec<_>>();
            json!({
                "file": m.file, "enabled": m.enabled, "size": m.size, "key": key,
                "id": md.get("id").cloned().filter(|v| v.as_str().is_some_and(|s| !s.is_empty())).unwrap_or(Value::Null),
                "name": name, "version": pick(md.str_of("version"), idf.and_then(|i| i.str_of("version"))).unwrap_or_default(),
                "loader": md.get("loader").cloned().unwrap_or(Value::Null), "kind": md.str_of("kind").unwrap_or("mod"), "side": side,
                "description": pick(md.str_of("description"), idf.and_then(|i| i.str_of("description"))).unwrap_or_default(),
                "authors": md.get("authors").cloned().unwrap_or(json!([])), "depends": md.get("depends").cloned().unwrap_or(json!([])), "optional": md.get("optional").cloned().unwrap_or(json!([])),
                "dependents": names("dependents"), "missing": a["missing"], "conflicts": names("conflicts"),
                "pinned": pin_set.contains(&key), "source": idf.map(|i| i.get("source").cloned().filter(|v| !v.is_null()).unwrap_or(json!("modrinth"))).unwrap_or(Value::Null),
                "projectId": idf.map(|i| i["projectId"].clone()).unwrap_or(Value::Null), "icon": idf.map(|i| i["icon"].clone()).unwrap_or(Value::Null),
                "serverSide": idf.and_then(|i| i.get("serverSide")).filter(|v| crate::js::truthy(v)).cloned().unwrap_or(Value::Null),
                "clientSide": idf.and_then(|i| i.get("clientSide")).filter(|v| crate::js::truthy(v)).cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    out.sort_by(|a, b| locale_cmp(a.str_of("name").unwrap_or(""), b.str_of("name").unwrap_or("")));
    json!({ "mods": out, "warnings": warnings })
}

/// Filter + sort of the installed list (the same rules the UI uses).
pub fn filter_sort(mods: &[Value], query: &str, state: &str, side: &str, sort: &str) -> Vec<Value> {
    let q = query.trim().to_lowercase();
    let len = |m: &Value, k: &str| m[k].as_array().map_or(0, Vec::len);
    let mut out: Vec<Value> = mods
        .iter()
        .filter(|m| {
            let authors: Vec<&str> = m["authors"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let hay = format!("{} {} {} {}", m.string_or("name", ""), m.string_or("file", ""), m.string_or("id", ""), authors.join(" ")).to_lowercase();
            if !q.is_empty() && !hay.contains(&q) {
                return false;
            }
            let enabled = m.truthy_of("enabled");
            match state {
                "enabled" if !enabled => return false,
                "disabled" if enabled => return false,
                "problems" if len(m, "missing") + len(m, "conflicts") == 0 => return false,
                "pinned" if !m.truthy_of("pinned") => return false,
                _ => {}
            }
            side == "all" || m.str_of("side") == Some(side)
        })
        .cloned()
        .collect();
    let by_name = |a: &Value, b: &Value| locale_cmp(a.str_of("name").unwrap_or(""), b.str_of("name").unwrap_or(""));
    match sort {
        "size" => out.sort_by(|a, b| b.num_of("size").partial_cmp(&a.num_of("size")).unwrap_or(std::cmp::Ordering::Equal)),
        "dependents" => out.sort_by(|a, b| len(b, "dependents").cmp(&len(a, "dependents")).then_with(|| by_name(a, b))),
        "state" => out.sort_by(|a, b| b.truthy_of("enabled").cmp(&a.truthy_of("enabled")).then_with(|| by_name(a, b))),
        _ => out.sort_by(by_name),
    }
    out
}

/// "x.jar" ⇄ "x.jar.disabled".
pub fn toggled_name(file: &str, enabled: bool) -> String {
    let b = base_name(file);
    if enabled {
        b.to_string()
    } else {
        format!("{b}{DISABLED}")
    }
}

pub async fn set_enabled(dir: &Path, file: &str, enabled: bool) -> Result<String> {
    let file = util::safe_name(file)?;
    let target = toggled_name(&file, enabled);
    if target == file {
        return Ok(file);
    }
    if dir.join(&target).exists() {
        return Err(msg(format!("Plik {target} już istnieje.")));
    }
    tokio::fs::rename(dir.join(&file), dir.join(&target)).await?;
    Ok(target)
}

/// Bulk: enable | disable | remove. Removed files go to `backup_dir` when given.
pub async fn bulk(dir: &Path, files: &[String], action: &str, backup_dir: Option<&Path>) -> Vec<String> {
    let mut done = Vec::new();
    for f in files {
        let r: Result<String> = async {
            if action == "remove" {
                let n = util::safe_name(f)?;
                match backup_dir {
                    Some(b) => {
                        tokio::fs::create_dir_all(b).await?;
                        if tokio::fs::rename(dir.join(&n), b.join(&n)).await.is_err() {
                            let _ = tokio::fs::remove_file(dir.join(&n)).await;
                        }
                    }
                    None => {
                        let _ = tokio::fs::remove_file(dir.join(&n)).await;
                    }
                }
                Ok(n)
            } else {
                set_enabled(dir, f, action == "enable").await
            }
        }
        .await;
        if let Ok(n) = r {
            done.push(n);
        }
    }
    done
}

/// Drops updates of pinned mods.
pub fn without_pinned(updates: Vec<Value>, pins: &[Value], key_of: impl Fn(&str) -> String) -> Vec<Value> {
    let set: HashSet<String> = pins.iter().map(|p| crate::config_edit::js_string(p).to_lowercase()).collect();
    if set.is_empty() {
        return updates;
    }
    updates.into_iter().filter(|u| !set.contains(&key_of(u.str_of("oldFile").unwrap_or("")))).collect()
}

pub fn toggle_pin(pins: &[Value], key: &str, on: bool) -> Vec<String> {
    let mut set: Vec<String> = pins.iter().map(|p| crate::config_edit::js_string(p).to_lowercase()).collect();
    let k = key.to_lowercase();
    set.retain(|p| p != &k);
    if on {
        set.push(k);
    }
    set.sort();
    set.dedup();
    set
}

/// A profile from the current folder: which keys are on, and every key it knew about.
pub fn make_profile(name: &str, mods: &[Value]) -> Value {
    let n: String = name.trim().chars().take(40).collect();
    let mut enabled: Vec<String> = mods.iter().filter(|m| m.truthy_of("enabled")).map(|m| m.string_or("key", "")).collect();
    let mut known: Vec<String> = mods.iter().map(|m| m.string_or("key", "")).collect();
    enabled.sort();
    known.sort();
    json!({ "name": if n.is_empty() { "Profil".into() } else { n }, "enabled": enabled, "known": known, "created": now_ms() })
}

/// Renames that switch the folder to a profile; mods the profile did not know keep their state.
pub fn profile_plan(mods: &[Value], profile: &Value) -> Vec<Value> {
    let strs = |v: &Value| v.as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect::<HashSet<_>>();
    let on = strs(&profile["enabled"]);
    let known = if profile["known"].is_array() { strs(&profile["known"]) } else { on.clone() };
    let mut out = Vec::new();
    for m in mods {
        let key = m.string_or("key", "");
        if !known.contains(&key) {
            continue;
        }
        let want = on.contains(&key);
        if want != m.truthy_of("enabled") {
            let file = m.string_or("file", "");
            out.push(json!({ "file": file, "to": toggled_name(&file, want) }));
        }
    }
    out
}

pub fn upsert_profile(profiles: &[Value], p: Value) -> Vec<Value> {
    let name = p["name"].clone();
    let mut out: Vec<Value> = profiles.iter().filter(|x| x["name"] != name).cloned().collect();
    out.push(p);
    out.sort_by(|a, b| locale_cmp(a.str_of("name").unwrap_or(""), b.str_of("name").unwrap_or("")));
    out
}

pub async fn apply_profile(dir: &Path, mods: &[Value], profile: &Value) -> usize {
    let plan = profile_plan(mods, profile);
    for r in &plan {
        let (Ok(from), Ok(to)) = (util::safe_name(r.str_of("file").unwrap_or("")), util::safe_name(r.str_of("to").unwrap_or(""))) else { continue };
        let _ = tokio::fs::rename(dir.join(from), dir.join(to)).await;
    }
    plan.len()
}

fn side_txt(s: &str) -> &'static str {
    match s {
        "client" => "klient",
        "server" => "serwer",
        "both" => "klient + serwer",
        _ => "",
    }
}

fn md(s: &str) -> String {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([|\\`*_\[\]])").unwrap());
    R.replace_all(s, "\\$1").to_string()
}

/// Text / Markdown list of mods.
pub fn modlist(mods: &[Value], format: &str, title: &str, mc_version: &str, loader: &str) -> String {
    let on: Vec<&Value> = mods.iter().filter(|m| m.truthy_of("enabled")).collect();
    let off: Vec<&Value> = mods.iter().filter(|m| !m.truthy_of("enabled")).collect();
    let second = [(!mc_version.is_empty()).then(|| format!("Minecraft {mc_version}")), (!loader.is_empty()).then(|| loader.to_string())]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" • ");
    let head: Vec<String> = [title.to_string(), second].into_iter().filter(|s| !s.is_empty()).collect();
    let link = |m: &Value| -> Option<String> {
        let pid = crate::config_edit::js_string(&m["projectId"]);
        if !crate::js::truthy(&m["projectId"]) {
            return None;
        }
        Some(if m.str_of("source") == Some("curseforge") {
            format!("https://www.curseforge.com/projects/{}", pid.trim_start_matches("cf:"))
        } else {
            format!("https://modrinth.com/project/{pid}")
        })
    };
    if format == "md" {
        let row = |m: &Value| {
            let name = md(m.str_of("name").unwrap_or(""));
            let n = match link(m) {
                Some(l) => format!("[{name}]({l})"),
                None => name,
            };
            let v = m.str_of("version").filter(|s| !s.is_empty()).unwrap_or("–");
            format!("| {n} | {} | {} | `{}` |", md(v), side_txt(m.str_of("side").unwrap_or("")), md(m.str_of("file").unwrap_or("")))
        };
        let table = |list: &[&Value]| {
            let mut v = vec!["| Mod | Wersja | Strona | Plik |".to_string(), "|---|---|---|---|".to_string()];
            v.extend(list.iter().map(|m| row(m)));
            v.join("\n")
        };
        let parts = [
            if head.is_empty() { "# Mody".to_string() } else { format!("# {}", md(if head[0].is_empty() { "Mody" } else { &head[0] })) },
            head.get(1).map(|h| format!("\n{h}")).unwrap_or_default(),
            format!("\nWłączone: {}{}\n", on.len(), if off.is_empty() { String::new() } else { format!(" • wyłączone: {}", off.len()) }),
            table(&on),
            if off.is_empty() { String::new() } else { format!("\n## Wyłączone\n\n{}", table(&off)) },
        ];
        return parts.into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("\n") + "\n";
    }
    let line = |m: &Value| {
        let v = m.str_of("version").filter(|s| !s.is_empty()).map(|v| format!(" {v}")).unwrap_or_default();
        let s = side_txt(m.str_of("side").unwrap_or(""));
        let s = if s.is_empty() { String::new() } else { format!(" [{s}]") };
        format!("- {}{v}{s} ({})", m.str_of("name").unwrap_or(""), m.str_of("file").unwrap_or(""))
    };
    let mut out = head.clone();
    out.push(format!("Włączone mody ({}):", on.len()));
    out.extend(on.iter().map(|m| line(m)));
    if !off.is_empty() {
        out.push(String::new());
        out.push(format!("Wyłączone ({}):", off.len()));
        out.extend(off.iter().map(|m| line(m)));
    }
    out.push(String::new());
    out.join("\n")
}

const CONTENT_DIRS: [&str; 3] = ["mods", "resourcepacks", "shaderpacks"];

fn loader_dep(l: &str) -> Option<&'static str> {
    Some(match l {
        "fabric" => "fabric-loader",
        "quilt" => "quilt-loader",
        "forge" => "forge",
        "neoforge" => "neoforge",
        _ => return None,
    })
}

/// modrinth.index.json from resolved files.
pub fn mrpack_index(name: &str, version: &str, summary: &str, mc_version: &str, loader: &str, loader_version: &str, files: &[Value]) -> Value {
    let mut deps = Map::new();
    deps.insert("minecraft".into(), json!(mc_version));
    if let (Some(d), false) = (loader_dep(loader), loader_version.is_empty()) {
        deps.insert(d.into(), json!(loader_version));
    }
    let mut idx = json!({ "formatVersion": 1, "game": "minecraft", "versionId": if version.is_empty() { "1.0.0" } else { version }, "name": if name.is_empty() { "Paczka" } else { name } });
    if !summary.is_empty() {
        idx["summary"] = json!(summary);
    }
    idx["files"] = Value::Array(
        files
            .iter()
            .map(|f| {
                let mut o = json!({ "path": f["path"], "hashes": { "sha1": f["sha1"], "sha512": f["sha512"] } });
                if !f["env"].is_null() {
                    o["env"] = f["env"].clone();
                }
                o["downloads"] = json!([f["url"]]);
                o["fileSize"] = f["size"].clone();
                o
            })
            .collect(),
    );
    idx["dependencies"] = Value::Object(deps);
    idx
}

/// CurseForge manifest.json.
pub fn cf_manifest(name: &str, version: &str, author: &str, mc_version: &str, loader: &str, loader_version: &str, files: &[Value]) -> Value {
    let mod_loaders = if loader_dep(loader).is_some() && !loader_version.is_empty() {
        json!([{ "id": format!("{loader}-{loader_version}"), "primary": true }])
    } else {
        json!([])
    };
    json!({
        "minecraft": { "version": mc_version, "modLoaders": mod_loaders }, "manifestType": "minecraftModpack", "manifestVersion": 1,
        "name": if name.is_empty() { "Paczka" } else { name }, "version": if version.is_empty() { "1.0.0" } else { version }, "author": author,
        "files": files.iter().map(|f| json!({ "projectID": f["projectID"], "fileID": f["fileID"], "required": f.get("required") != Some(&json!(false)) })).collect::<Vec<_>>(),
        "overrides": "overrides",
    })
}

/// Every exportable file of a game folder as relative paths.
pub fn exportable_files(root: &Path, include_options: bool) -> Vec<String> {
    static SKIP: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^(\.[^/]*|saves|logs|crash-reports|screenshots|backups|\.nore-backup|\.fabric|\.mixin\.out|\.cache|cache|downloads|natives|libraries|assets|versions|usercache\.json|usernamecache\.json|launcher_profiles\.json|.*\.log)(/|$)").unwrap()
    });
    static ROOT_OK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(options\.txt|optionsof\.txt|servers\.dat)$").unwrap());
    static OPTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^options(of)?\.txt$").unwrap());
    fn walk(root: &Path, rel: &str, include_options: bool, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(root.join(rel)) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if SKIP.is_match(&r) {
                continue;
            }
            let Ok(t) = e.file_type() else { continue };
            if rel.is_empty() && t.is_file() && !include_options && OPTS.is_match(&name) {
                continue;
            }
            if rel.is_empty() && t.is_file() && !ROOT_OK.is_match(&name) {
                continue;
            }
            if t.is_dir() {
                walk(root, &r, include_options, out);
            } else if t.is_file() && !name.ends_with(DISABLED) {
                out.push(r);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", include_options, &mut out);
    out.sort();
    out
}

/// Splits files into pack downloads and overrides (pure).
pub fn split_export(files: &[String], lookup: &Map<String, Value>, format: &str) -> (Vec<Value>, Vec<String>) {
    let (mut remote, mut overrides) = (vec![], vec![]);
    for rel in files {
        let l = lookup.get(rel);
        let content = CONTENT_DIRS.iter().any(|d| rel.starts_with(&format!("{d}/")));
        let ok = l.is_some_and(|l| {
            if format == "mrpack" {
                l.truthy_of("url") && l.truthy_of("sha512")
            } else {
                crate::js::truthy(&l["projectID"]) && crate::js::truthy(&l["fileID"])
            }
        });
        if content && ok {
            let mut r = json!({ "path": rel });
            crate::js::assign(&mut r, l.unwrap_or(&Value::Null));
            remote.push(r);
        } else {
            overrides.push(rel.clone());
        }
    }
    (remote, overrides)
}

/// Modrinth versions for files by SHA-1 → `{ rel: { url, sha1, sha512, size } }`.
pub async fn modrinth_lookup(env: &crate::Env, root: &Path, rels: &[String]) -> Result<Map<String, Value>> {
    let mut by_hash = std::collections::HashMap::new();
    for rel in rels {
        by_hash.insert(crate::net::sha1_file(&root.join(rel)).await?, rel.clone());
    }
    if by_hash.is_empty() {
        return Ok(Map::new());
    }
    let body = json!({ "hashes": by_hash.keys().collect::<Vec<_>>(), "algorithm": "sha1" });
    let Some(map) = env.net.post_json("https://api.modrinth.com/v2/version_files", &body).await? else { return Ok(Map::new()) };
    let mut out = Map::new();
    for (hash, v) in map.as_object().into_iter().flatten() {
        if let Some(f) = v["files"].as_array().into_iter().flatten().find(|x| x.pointer("/hashes/sha1").and_then(Value::as_str) == Some(hash)) {
            if let Some(rel) = by_hash.get(hash) {
                out.insert(rel.clone(), json!({ "url": f["url"], "sha1": hash, "sha512": f["hashes"]["sha512"], "size": f["size"] }));
            }
        }
    }
    Ok(out)
}

/// CurseForge files by fingerprint → `{ rel: { projectID, fileID } }`.
pub async fn curseforge_lookup(env: &crate::Env, cf: &crate::curseforge::Cf, root: &Path, rels: &[String]) -> Map<String, Value> {
    let mut by_dir: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for rel in rels {
        let (d, n) = rel.rsplit_once('/').unwrap_or((".", rel));
        by_dir.entry(d.to_string()).or_default().push(n.to_string());
    }
    let mut out = Map::new();
    for (d, names) in by_dir {
        let ids = cf.identify(env, &root.join(&d), &[".jar", ".zip"], &HashSet::new()).await.unwrap_or_default();
        for n in names {
            if let Some(i) = ids.get(&n) {
                out.insert(
                    format!("{d}/{n}"),
                    json!({ "projectID": crate::curseforge::raw_id(&i["projectId"]), "fileID": i.str_of("versionId").and_then(|v| v.parse::<u64>().ok()) }),
                );
            }
        }
    }
    out
}

/// What to export (mods:exportPack).
pub struct ExportOpts {
    pub mrpack: bool,
    pub out: PathBuf,
    pub version: String,
    pub author: String,
    pub include_options: bool,
}

/// Writes the instance as a pack: `{ file, remote, overrides }`.
pub async fn export_pack(
    env: &crate::Env,
    cf: &crate::curseforge::Cf,
    inst: &Value,
    o: &ExportOpts,
    on_status: &(dyn Fn(&str) + Send + Sync),
) -> Result<Value> {
    let root = PathBuf::from(inst.string_or("gameDir", ""));
    on_status("Zbieranie plików");
    let r2 = root.clone();
    let inc = o.include_options;
    let files = util::blocking(move || Ok(exportable_files(&r2, inc))).await?;
    let content: Vec<String> = files.iter().filter(|r| CONTENT_DIRS.iter().any(|d| r.starts_with(&format!("{d}/")))).cloned().collect();
    on_status(if o.mrpack { "Szukanie plików w Modrinth" } else { "Szukanie plików w CurseForge" });
    let lookup = if o.mrpack { modrinth_lookup(env, &root, &content).await.unwrap_or_default() } else { curseforge_lookup(env, cf, &root, &content).await };
    let (remote, overrides) = split_export(&files, &lookup, if o.mrpack { "mrpack" } else { "curseforge" });
    let name = inst.string_or("name", "");
    let mc = inst.string_or("mcVersion", "");
    let loader = inst.string_or("loader", "");
    let lv = inst.str_of("loaderVersion").filter(|s| !s.is_empty()).or(inst.str_of("installedLoader")).unwrap_or("").to_string();
    let version = if o.version.is_empty() { "1.0.0".to_string() } else { o.version.clone() };
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    if o.mrpack {
        let idx = mrpack_index(&name, &version, "Wyeksportowano z Nore Launcher", &mc, &loader, &lv, &remote);
        entries.push(("modrinth.index.json".into(), crate::config_edit::pretty(&idx, "  ").into_bytes()));
    } else {
        let man = cf_manifest(&name, &version, &o.author, &mc, &loader, &lv, &remote);
        entries.push(("manifest.json".into(), crate::config_edit::pretty(&man, "  ").into_bytes()));
        let items: Vec<String> = remote.iter().map(|r| format!("<li>{}</li>", util::basename(r.str_of("path").unwrap_or("")))).collect();
        entries.push(("modlist.html".into(), format!("<ul>\n{}\n</ul>\n", items.join("\n")).into_bytes()));
    }
    on_status("Pakowanie");
    let out = o.out.clone();
    let n_remote = remote.len();
    let n_over = overrides.len();
    util::blocking(move || {
        for rel in &overrides {
            entries.push((format!("overrides/{rel}"), std::fs::read(root.join(rel))?));
        }
        util::write_zip(&out, entries)
    })
    .await?;
    Ok(json!({ "file": o.out.to_string_lossy(), "remote": n_remote, "overrides": n_over }))
}

/// Config files under root/config (and defaultconfigs) with size, for the config editor.
pub fn config_files(root: &Path, dirs: &[&str]) -> Vec<Value> {
    static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(toml|json|json5|properties|cfg|txt|yml|yaml)$").unwrap());
    fn walk(root: &Path, rel: &str, depth: usize, out: &mut Vec<Value>) {
        if depth > 4 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(root.join(rel)) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let r = format!("{rel}/{name}");
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                walk(root, &r, depth + 1, out);
            } else if EXT.is_match(&name) {
                if let Ok(m) = e.metadata() {
                    if m.len() < 2 * 1024 * 1024 {
                        out.push(json!({ "path": r, "size": m.len(), "mtime": util::mtime_ms(&m) }));
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for d in dirs {
        walk(root, d, 0, &mut out);
    }
    out.sort_by(|a, b| a.str_of("path").cmp(&b.str_of("path")));
    out
}

/// A relative config path inside root (never outside it).
pub fn inside_root(root: &Path, rel: &str) -> Result<PathBuf> {
    util::inside(root, rel).ok_or_else(|| msg("Nieprawidłowa ścieżka pliku"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jar(dir: &Path, name: &str, entries: Value) {
        let files = entries
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), if let Value::String(s) = v { s.clone().into_bytes() } else { v.to_string().into_bytes() }))
            .collect();
        util::write_zip(&dir.join(name), files).unwrap();
    }

    /// mods-servers.test.js: list a real folder, toggle, bulk, keys and filters.
    #[tokio::test]
    async fn real_folder() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("mods");
        std::fs::create_dir_all(&dir).unwrap();
        jar(
            &dir,
            "sodium-fabric-0.6.0+mc1.21.1.jar",
            json!({ "fabric.mod.json": { "id": "sodium", "name": "Sodium", "version": "0.6.0", "environment": "client", "depends": { "fabric-api": "*" } } }),
        );
        jar(&dir, "fabric-api-0.100.jar", json!({ "fabric.mod.json": { "id": "fabric-api", "name": "Fabric API", "version": "0.100", "environment": "*" } }));
        jar(&dir, "lithium.jar.disabled", json!({ "fabric.mod.json": { "id": "lithium", "name": "Lithium", "version": "0.13", "environment": "*" } }));
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        let r = list(&dir, false, None, &[json!("lithium")], &Map::new()).await;
        let mods = r["mods"].as_array().unwrap().clone();
        let names: Vec<&str> = mods.iter().map(|m| m["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["Fabric API", "Lithium", "Sodium"]);
        let by = |id: &str| mods.iter().find(|m| m["id"] == id).unwrap().clone();
        assert_eq!(by("fabric-api")["dependents"], json!([{ "file": "sodium-fabric-0.6.0+mc1.21.1.jar", "name": "Sodium" }]));
        assert_eq!(by("lithium")["pinned"], true);
        assert_eq!(by("sodium")["side"], "client");
        let ids = |v: Vec<Value>| v.iter().map(|m| m["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(ids(filter_sort(&mods, "", "disabled", "all", "name")), vec!["lithium"]);
        assert_eq!(ids(filter_sort(&mods, "", "all", "client", "name")), vec!["sodium"]);
        assert_eq!(ids(filter_sort(&mods, "api", "all", "all", "name")), vec!["fabric-api"]);
        assert_eq!(filter_sort(&mods, "", "all", "all", "dependents")[0]["id"], "fabric-api");
        assert_eq!(set_enabled(&dir, "lithium.jar.disabled", true).await.unwrap(), "lithium.jar");
        assert!(dir.join("lithium.jar").exists());
        assert!(set_enabled(&dir, "../x.jar", false).await.is_err());
        let done = bulk(&dir, &["lithium.jar".into(), "fabric-api-0.100.jar".into()], "disable", None).await;
        assert_eq!(done, vec!["lithium.jar.disabled", "fabric-api-0.100.jar.disabled"]);
        let backup = d.path().join("bk");
        bulk(&dir, &["lithium.jar.disabled".into()], "remove", Some(&backup)).await;
        assert!(backup.join("lithium.jar.disabled").exists());
        assert_eq!(mod_key("Xaeros_Minimap_24.5.0_Fabric_1.21.jar", None), "xaerosminimap");
        assert_eq!(toggled_name("a.jar", false), "a.jar.disabled");
        assert_eq!(toggled_name("a.jar.disabled", true), "a.jar");
    }

    /// mods-servers.test.js: pins drop updates, profiles switch sets and leave unknown mods alone.
    #[test]
    fn pins_and_profiles() {
        let ups = vec![json!({ "oldFile": "a-1.jar" }), json!({ "oldFile": "b-1.jar" })];
        let key_of = |f: &str| f.split('-').next().unwrap().to_string();
        assert_eq!(without_pinned(ups, &[json!("A")], key_of), vec![json!({ "oldFile": "b-1.jar" })]);
        assert_eq!(toggle_pin(&[json!("a")], "B", true), vec!["a", "b"]);
        assert_eq!(toggle_pin(&[json!("a"), json!("b")], "a", false), vec!["b"]);
        let mods = vec![
            json!({ "key": "a", "file": "a.jar", "enabled": true }),
            json!({ "key": "b", "file": "b.jar.disabled", "enabled": false }),
            json!({ "key": "c", "file": "c.jar", "enabled": true }),
        ];
        let p = make_profile("  PvP  ", &mods);
        assert_eq!(p["enabled"], json!(["a", "c"]));
        assert_eq!(p["name"], "PvP");
        let now = vec![
            json!({ "key": "a", "file": "a.jar.disabled", "enabled": false }),
            json!({ "key": "b", "file": "b.jar", "enabled": true }),
            json!({ "key": "c", "file": "c.jar", "enabled": true }),
            json!({ "key": "new", "file": "new.jar.disabled", "enabled": false }),
        ];
        assert_eq!(profile_plan(&now, &p), vec![json!({ "file": "a.jar.disabled", "to": "a.jar" }), json!({ "file": "b.jar", "to": "b.jar.disabled" })]);
        let list = upsert_profile(&[json!({ "name": "Zz" }), json!({ "name": "PvP", "enabled": [] })], p);
        assert_eq!(list.iter().map(|x| x["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["PvP", "Zz"]);
        assert_eq!(list[0]["enabled"], json!(["a", "c"]));
    }

    /// mods-servers.test.js: mod list export (txt, markdown) and pack formats.
    #[test]
    fn modlist_and_formats() {
        let mods = vec![
            json!({ "name": "Sodium", "version": "0.6", "side": "client", "file": "sodium.jar", "enabled": true, "projectId": "AANobbMI", "source": "modrinth" }),
            json!({ "name": "JEI | x", "version": "19", "side": "both", "file": "jei.jar", "enabled": true, "projectId": "cf:238222", "source": "curseforge" }),
            json!({ "name": "Old", "version": "", "side": "unknown", "file": "old.jar.disabled", "enabled": false }),
        ];
        let txt = modlist(&mods, "txt", "Paczka", "1.21.1", "Fabric");
        assert!(txt.starts_with("Paczka\nMinecraft 1.21.1 • Fabric\nWłączone mody (2):\n- Sodium 0.6 [klient] (sodium.jar)"), "{txt}");
        assert!(txt.contains("Wyłączone (1):\n- Old (old.jar.disabled)"));
        let m = modlist(&mods, "md", "Paczka", "", "");
        assert!(m.starts_with("# Paczka"));
        assert!(m.contains("| [Sodium](https://modrinth.com/project/AANobbMI) | 0.6 | klient | `sodium.jar` |"), "{m}");
        assert!(m.contains("[JEI \\| x](https://www.curseforge.com/projects/238222)"));
        assert!(m.contains("## Wyłączone"));
        let idx = mrpack_index(
            "P",
            "2",
            "",
            "1.21.1",
            "fabric",
            "0.16.9",
            &[json!({ "path": "mods/a.jar", "sha1": "s1", "sha512": "s5", "size": 3, "url": "https://cdn.modrinth.com/a.jar" })],
        );
        assert_eq!(idx["dependencies"], json!({ "minecraft": "1.21.1", "fabric-loader": "0.16.9" }));
        assert_eq!(
            idx["files"][0],
            json!({ "path": "mods/a.jar", "hashes": { "sha1": "s1", "sha512": "s5" }, "downloads": ["https://cdn.modrinth.com/a.jar"], "fileSize": 3 })
        );
        assert_eq!(idx["formatVersion"], 1);
        let man = cf_manifest("P", "", "", "1.20.1", "forge", "47.2.0", &[json!({ "projectID": 1, "fileID": 2 })]);
        assert_eq!(man["minecraft"], json!({ "version": "1.20.1", "modLoaders": [{ "id": "forge-47.2.0", "primary": true }] }));
        assert_eq!(man["files"], json!([{ "projectID": 1, "fileID": 2, "required": true }]));
        let lookup = json!({ "mods/a.jar": { "url": "u", "sha512": "h", "projectID": 1, "fileID": 2 } });
        let (remote, over) =
            split_export(&["mods/a.jar".into(), "mods/own.jar".into(), "config/x.toml".into(), "options.txt".into()], lookup.as_object().unwrap(), "mrpack");
        assert_eq!(remote.iter().map(|r| r["path"].as_str().unwrap()).collect::<Vec<_>>(), vec!["mods/a.jar"]);
        assert_eq!(over, vec!["mods/own.jar", "config/x.toml", "options.txt"]);
    }

    /// mods-servers.test.js: exportable files skip worlds, logs and launcher files; .mrpack offline.
    #[tokio::test]
    async fn export_offline() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("inst");
        for f in
            ["mods/own.jar", "config/a.toml", "saves/w/level.dat", "logs/latest.log", ".nore-backup/x", "options.txt", "usercache.json", "resourcepacks/p.zip"]
        {
            std::fs::create_dir_all(root.join(f).parent().unwrap()).unwrap();
            std::fs::write(root.join(f), "x").unwrap();
        }
        std::fs::write(root.join("mods/off.jar.disabled"), "x").unwrap();
        assert_eq!(exportable_files(&root, true), vec!["config/a.toml", "mods/own.jar", "options.txt", "resourcepacks/p.zip"]);
        assert_eq!(exportable_files(&root, false), vec!["config/a.toml", "mods/own.jar", "resourcepacks/p.zip"]);
        let srv = crate::testutil::serve(vec![crate::testutil::Reply::status(404)]).await;
        let _ = srv;
        let env = crate::Env::new(crate::paths::Paths::new(d.path()), crate::net::Net::for_tests());
        // lookups fail offline: everything becomes an override
        let lookup = Map::new();
        let (remote, over) = split_export(&exportable_files(&root, true), &lookup, "mrpack");
        assert_eq!((remote.len(), over.len()), (0, 4));
        let _ = env;
        assert!(inside_root(&root, "../etc/passwd").is_err());
    }
}
