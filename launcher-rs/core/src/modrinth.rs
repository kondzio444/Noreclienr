//! The part of launcher/src/main/modrinth.js the game start needs in phase 1: installing the newest
//! compatible version of a mod (Fabric API for Nore Client, the Nore Pack) with its required
//! dependencies. Search, updates, CurseForge and modpacks follow in phase 2 (PORTING.md).

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::{loaders, Env};
use futures::future::BoxFuture;
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

pub const API: &str = "https://api.modrinth.com/v2";
pub const FABRIC_API_ID: &str = "P7dR8mSH";

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

/// Primary file of a version (or the first one).
pub fn primary_file(version: &Value) -> Option<&Value> {
    let files = version.get("files")?.as_array()?;
    files.iter().find(|f| f.get("primary").and_then(Value::as_bool) == Some(true)).or(files.first())
}

/// Installs a mod and its required dependencies into `target`; returns the file names.
pub fn install_mod<'a>(env: &'a Env, project: &'a str, game_version: &'a str, loader: &'a str, target: &'a Path, seen: &'a mut HashSet<String>) -> BoxFuture<'a, Result<Vec<String>>> {
    Box::pin(async move {
        if !seen.insert(project.to_string()) {
            return Ok(vec![]);
        }
        let list: Vec<Value> = env.net.get_json(&versions_url(project, game_version, loader)).await?;
        let version = list
            .iter()
            .find(|v| v.str_of("version_type") == Some("release"))
            .or(list.first())
            .ok_or_else(|| msg(format!("Brak wersji zgodnej z {game_version} ({loader})")))?;
        let file = primary_file(version).ok_or_else(|| msg("Wersja nie ma plików"))?;
        let name = file.str_of("filename").ok_or_else(|| msg("Wersja nie ma plików"))?;
        if name.contains('/') || name.contains('\\') || name.starts_with('.') {
            return Err(msg("Niedozwolona nazwa pliku"));
        }
        tokio::fs::create_dir_all(target).await?;
        env.net
            .download(file.str_of("url").unwrap_or_default(), &target.join(name), file.pointer("/hashes/sha1").and_then(Value::as_str), file.get("size").and_then(Value::as_u64), &|_| {})
            .await?;
        let mut installed = vec![name.to_string()];
        for dep in version.get("dependencies").and_then(Value::as_array).into_iter().flatten() {
            let (Some("required"), Some(id)) = (dep.str_of("dependency_type"), dep.str_of("project_id")) else { continue };
            if let Ok(more) = install_mod(env, id, game_version, loader, target, seen).await {
                installed.extend(more);
            }
        }
        Ok(installed)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_matches_modrinth_js() {
        assert_eq!(
            versions_url("P7dR8mSH", "1.21.1", "quilt"),
            "https://api.modrinth.com/v2/project/P7dR8mSH/version?game_versions=%5B%221.21.1%22%5D&loaders=%5B%22quilt%22%2C%22fabric%22%5D"
        );
        let v = serde_json::json!({ "files": [{ "filename": "a.jar" }, { "filename": "b.jar", "primary": true }] });
        assert_eq!(primary_file(&v).unwrap()["filename"], "b.jar");
    }
}
