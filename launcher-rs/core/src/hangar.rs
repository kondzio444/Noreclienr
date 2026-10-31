//! Hangar (hangar.papermc.io), the PaperMC plugin repository (port of launcher/src/main/hangar.js):
//! search, install with required dependencies and updates. Project ids are "hangar:<slug>".

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::{modrinth, util, Env};
use futures::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

fn api() -> String {
    std::env::var("NORE_HANGAR_API").unwrap_or_else(|_| "https://hangar.papermc.io/api/v1".into())
}

pub fn is_hangar(id: &str) -> bool {
    id.starts_with("hangar:")
}

pub fn slug_of(id: &str) -> String {
    id.trim_start_matches("hangar:").to_string()
}

pub fn platform_for(t: &str) -> Option<&'static str> {
    Some(match t {
        "paper" | "purpur" | "folia" => "PAPER",
        "velocity" => "VELOCITY",
        "bungeecord" => "WATERFALL",
        _ => return None,
    })
}

pub fn hit(p: &Value) -> Value {
    let slug = p.pointer("/namespace/slug").and_then(Value::as_str).or(p.str_of("name")).unwrap_or("").to_string();
    json!({
        "project_id": format!("hangar:{slug}"), "slug": slug, "title": p["name"], "description": p.string_or("description", ""), "author": p.pointer("/namespace/owner").cloned().unwrap_or(json!("")),
        "icon_url": p.get("avatarUrl").cloned().unwrap_or(Value::Null), "downloads": p.pointer("/stats/downloads").cloned().unwrap_or(json!(0)), "follows": p.pointer("/stats/stars").cloned().unwrap_or(json!(0)),
        "date_modified": p["lastUpdated"], "source": "hangar", "categories": p.str_of("category").map(|c| json!([c])).unwrap_or(json!([])),
    })
}

pub async fn search(env: &Env, srv: &Value, o: &Value) -> Result<Value> {
    let Some(platform) = platform_for(srv.str_of("type").unwrap_or("")) else { return Ok(json!({ "hits": [], "total_hits": 0 })) };
    let sort = match o.str_of("sort").unwrap_or("relevance") {
        "downloads" => "-downloads",
        "updated" => "-updated",
        "newest" => "-newest",
        _ => "-stars",
    };
    let mut p: Vec<(&str, String)> = vec![("limit", o.get("limit").and_then(Value::as_i64).unwrap_or(20).to_string()), ("offset", o.get("offset").and_then(Value::as_i64).unwrap_or(0).to_string()), ("sort", sort.into()), ("platform", platform.into())];
    if let Some(q) = o.str_of("query").filter(|s| !s.is_empty()) {
        p.push(("query", q.into()));
    }
    if platform == "PAPER" {
        if let Some(mc) = srv.str_of("mcVersion").filter(|s| !s.is_empty()) {
            p.push(("version", mc.into()));
        }
    }
    let j: Value = env.net.get_json(&modrinth::with_params(&format!("{}/projects", api()), &p)).await?;
    Ok(json!({ "hits": j["result"].as_array().into_iter().flatten().map(hit).collect::<Vec<_>>(), "total_hits": j.pointer("/pagination/count").cloned().unwrap_or(json!(0)) }))
}

fn parts(v: &str) -> Vec<i64> {
    v.split('.').map(|n| crate::config_edit::parse_int(n).unwrap_or(0)).collect()
}

fn cmp(a: &str, b: &str) -> i64 {
    let (x, y) = (parts(a), parts(b));
    for i in 0..3 {
        let d = x.get(i).copied().unwrap_or(0) - y.get(i).copied().unwrap_or(0);
        if d != 0 {
            return d;
        }
    }
    0
}

/// "1.21.1" matches "1.21.1", "1.21" and ranges like "1.20-1.21.4".
pub fn supports(list: &[String], mc: Option<&str>) -> bool {
    let Some(mc) = mc.filter(|m| !m.is_empty()) else { return true };
    if list.is_empty() {
        return true;
    }
    let minor = mc.split('.').take(2).collect::<Vec<_>>().join(".");
    list.iter().any(|s| {
        if s == mc || *s == minor {
            return true;
        }
        match s.split_once('-') {
            Some((a, b)) if a.trim().chars().all(|c| c.is_ascii_digit() || c == '.') && b.trim().chars().all(|c| c.is_ascii_digit() || c == '.') && !a.trim().is_empty() && !b.trim().is_empty() => {
                cmp(mc, a.trim()) >= 0 && cmp(mc, b.trim()) <= 0
            }
            _ => false,
        }
    })
}

/// Newest version for the server (release channel first).
pub fn pick_version(versions: &[Value], platform: &str, mc: &str) -> Option<Value> {
    let ok: Vec<&Value> = versions
        .iter()
        .filter(|v| {
            v.pointer(&format!("/downloads/{platform}")).is_some_and(|d| !d.is_null()) && {
                let list: Vec<String> = v.pointer(&format!("/platformDependencies/{platform}")).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
                supports(&list, if platform == "PAPER" { Some(mc) } else { None })
            }
        })
        .collect();
    ok.iter().find(|v| v.pointer("/channel/name").and_then(Value::as_str).is_some_and(|n| n.to_lowercase().contains("release"))).or(ok.first()).map(|v| (*v).clone())
}

async fn versions(env: &Env, slug: &str, platform: &str) -> Result<Vec<Value>> {
    let j: Value = env.net.get_json(&modrinth::with_params(&format!("{}/projects/{}/versions", api(), urlencoding::encode(slug)), &[("limit", "25".into()), ("offset", "0".into()), ("platform", platform.into())])).await?;
    Ok(j["result"].as_array().cloned().unwrap_or_default())
}

fn download(v: &Value, platform: &str) -> (String, String, Option<u64>) {
    let d = &v["downloads"][platform];
    let url = d.str_of("downloadUrl").or(d.str_of("externalUrl")).unwrap_or("").to_string();
    let name = d.pointer("/fileInfo/name").and_then(Value::as_str).map(String::from).unwrap_or_else(|| format!("{}.jar", v.string_or("name", "plugin")));
    (url, util::basename(&name), d.pointer("/fileInfo/sizeBytes").and_then(Value::as_u64))
}

/// Installs a plugin (with required Hangar dependencies): `[{ file, slug, version }]`.
pub fn install<'a>(env: &'a Env, srv: &'a Value, project_id: &'a str, dir: &'a Path, on_status: modrinth::StatusFn<'a>, seen: &'a mut HashSet<String>) -> BoxFuture<'a, Result<Vec<Value>>> {
    Box::pin(async move {
        let slug = slug_of(project_id);
        if !seen.insert(slug.to_lowercase()) {
            return Ok(vec![]);
        }
        let platform = platform_for(srv.str_of("type").unwrap_or("")).ok_or_else(|| msg("Hangar ma pluginy tylko dla Paper, Purpur, Folia i Velocity."))?;
        let mc = srv.string_or("mcVersion", "");
        let v = pick_version(&versions(env, &slug, platform).await?, platform, &mc).ok_or_else(|| msg(format!("Brak wersji {slug} dla {mc}")))?;
        let (url, name, size) = download(&v, platform);
        if url.is_empty() {
            return Err(msg(format!("{slug}: brak pliku do pobrania")));
        }
        tokio::fs::create_dir_all(dir).await?;
        on_status(format!("Pobieranie {name}"));
        env.net.download(&url, &dir.join(&name), None, size, &|_| {}).await?;
        let mut out = vec![json!({ "file": name, "slug": slug, "version": v["name"] })];
        for d in v.pointer(&format!("/pluginDependencies/{platform}")).and_then(Value::as_array).cloned().unwrap_or_default() {
            let Some(n) = d.str_of("name").filter(|_| d.truthy_of("required")) else { continue };
            match install(env, srv, &format!("hangar:{n}"), dir, on_status, seen).await {
                Ok(more) => out.extend(more),
                Err(e) => on_status(format!("Pominięto zależność {n}: {e}")),
            }
        }
        Ok(out)
    })
}

/// Updates for plugins installed from Hangar. records: `{ file: { slug, version } }`.
pub async fn check_updates(env: &Env, srv: &Value, records: &Value, dir: &Path) -> Vec<Value> {
    let Some(platform) = platform_for(srv.str_of("type").unwrap_or("")) else { return vec![] };
    let mut out = Vec::new();
    for (file, r) in records.as_object().into_iter().flatten() {
        if !dir.join(file).exists() {
            continue;
        }
        let slug = r.string_or("slug", "");
        let Ok(list) = versions(env, &slug, platform).await else { continue };
        let Some(v) = pick_version(&list, platform, srv.str_of("mcVersion").unwrap_or("")) else { continue };
        if v["name"] == r["version"] {
            continue;
        }
        let (url, name, size) = download(&v, platform);
        out.push(json!({ "kind": "plugin", "oldFile": file, "newFile": name, "url": url, "size": size, "version": v["name"], "type": "release", "projectId": format!("hangar:{slug}"), "source": "hangar" }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mods-servers.test.js: Hangar version picking by platform and Minecraft version.
    #[test]
    fn picking() {
        let vs = vec![
            json!({ "name": "3.0-beta", "channel": { "name": "Beta" }, "downloads": { "PAPER": { "downloadUrl": "b" } }, "platformDependencies": { "PAPER": ["1.21.1"] } }),
            json!({ "name": "2.9", "channel": { "name": "Release" }, "downloads": { "PAPER": { "downloadUrl": "r" } }, "platformDependencies": { "PAPER": ["1.20-1.21.4"] } }),
            json!({ "name": "1.0", "channel": { "name": "Release" }, "downloads": { "VELOCITY": { "downloadUrl": "v" } }, "platformDependencies": { "VELOCITY": ["3.3"] } }),
        ];
        assert_eq!(pick_version(&vs, "PAPER", "1.21.1").unwrap()["name"], "2.9");
        assert!(pick_version(&vs, "PAPER", "1.19.4").is_none());
        assert_eq!(pick_version(&vs, "VELOCITY", "1.21.1").unwrap()["name"], "1.0");
        assert!(supports(&["1.21".into()], Some("1.21.3")));
        assert_eq!(platform_for("purpur"), Some("PAPER"));
        assert_eq!(platform_for("fabric"), None);
    }
}
