//! Mod loaders: Fabric, Quilt, Forge and NeoForge (port of launcher/src/main/loaders.js).
//! Fabric / Quilt ship ready launcher profiles; Forge / NeoForge are installed by running their
//! official installer headless (`--installClient`) into the data folder (same layout as .minecraft).

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::{net, Env, JavaProvider, ProgressFn};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{HashSet, VecDeque};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, BufReader};

pub const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
pub const QUILT_META: &str = "https://meta.quiltmc.org/v3";
pub const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
pub const NEO_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged";

/// Display name of a loader id.
pub fn name(loader: &str) -> Option<&'static str> {
    Some(match loader {
        "vanilla" => "Vanilla",
        "fabric" => "Fabric",
        "quilt" => "Quilt",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        _ => return None,
    })
}

/// Numeric comparison of dotted versions ("0.16.10" > "0.16.9").
pub fn cmp_version(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| s.split(['.', '-', '+']).map(|n| n.parse::<i64>().unwrap_or(0)).collect::<Vec<_>>();
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        if x != y {
            return x.cmp(&y);
        }
    }
    Ordering::Equal
}

fn mc_minor(mc: &str) -> u32 {
    mc.split('.').nth(1).and_then(|n| n.parse().ok()).unwrap_or(0)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
}

/// NeoForge version prefix for a Minecraft version: 1.21.1 → "21.1.", 26.1 → "26.1.0.".
pub fn neoforge_prefix(mc: &str) -> String {
    let p: Vec<&str> = mc.split('.').collect();
    let third = p.get(2).copied().unwrap_or("0");
    if p.first() == Some(&"1") {
        format!("{}.{}.", p.get(1).copied().unwrap_or("0"), third)
    } else {
        format!("{}.{}.{}.", p.first().copied().unwrap_or("0"), p.get(1).copied().unwrap_or("0"), third)
    }
}

/// Forge versions for `mc` from maven-metadata.xml, newest first; the promoted one is "stable".
pub fn forge_versions_from(xml: &str, mc: &str, recommended: Option<&str>) -> Vec<LoaderVersion> {
    let re = Regex::new(r"<version>([^<]+)</version>").expect("regex");
    let prefix = format!("{mc}-");
    let mut list: Vec<String> = re
        .captures_iter(xml)
        .map(|c| c[1].to_string())
        .filter(|v| v.starts_with(&prefix))
        .map(|v| v[prefix.len()..].to_string())
        .collect();
    list.sort_by(|a, b| cmp_version(b, a));
    list.into_iter().map(|v| LoaderVersion { stable: Some(v.as_str()) == recommended, version: v }).collect()
}

/// Loader versions for a Minecraft version, newest first.
pub async fn versions(env: &Env, loader: &str, mc: &str) -> Result<Vec<LoaderVersion>> {
    let enc = urlencoding::encode(mc);
    match loader {
        "fabric" | "quilt" => {
            let base = if loader == "quilt" { QUILT_META } else { FABRIC_META };
            let list: Vec<Value> = env.net.get_json(&format!("{base}/versions/loader/{enc}")).await?;
            let unstable = Regex::new(r"(?i)beta|pre|rc").expect("regex");
            Ok(list
                .iter()
                .filter_map(|e| {
                    let l = e.get("loader")?;
                    let version = l.str_of("version")?.to_string();
                    let stable = if loader == "fabric" { l.get("stable").and_then(Value::as_bool).unwrap_or(false) } else { !unstable.is_match(&version) };
                    Some(LoaderVersion { version, stable })
                })
                .collect())
        }
        "forge" => {
            let xml = env.net.get_text(&format!("{FORGE_MAVEN}/maven-metadata.xml")).await?;
            let promos: Value = env
                .net
                .get_json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
                .await
                .unwrap_or_else(|_| json!({}));
            let rec = promos.pointer("/promos").and_then(|p| p.get(format!("{mc}-recommended"))).and_then(Value::as_str);
            Ok(forge_versions_from(&xml, mc, rec))
        }
        "neoforge" => {
            if mc == "1.20.1" {
                let all: Value = env.net.get_json("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge").await?;
                let mut list: Vec<String> = all
                    .get("versions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str()?.strip_prefix("1.20.1-").map(String::from))
                    .collect();
                list.sort_by(|a, b| cmp_version(b, a));
                return Ok(list.into_iter().map(|version| LoaderVersion { version, stable: true }).collect());
            }
            let prefix = neoforge_prefix(mc);
            let all: Value = env.net.get_json("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge").await?;
            let snap = Regex::new(r"(?i)snapshot").expect("regex");
            let beta = Regex::new(r"(?i)beta|alpha").expect("regex");
            let mut list: Vec<String> = all
                .get("versions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(String::from))
                .filter(|v| v.starts_with(&prefix) && !snap.is_match(v))
                .collect();
            list.sort_by(|a, b| cmp_version(b, a));
            Ok(list.into_iter().map(|v| LoaderVersion { stable: !beta.is_match(&v), version: v }).collect())
        }
        _ => Ok(vec![]),
    }
}

/// The newest stable loader version (or the newest at all).
pub async fn pick_version(env: &Env, loader: &str, mc: &str) -> Result<String> {
    let list = versions(env, loader, mc).await?;
    let v = list.iter().find(|l| l.stable).or(list.first());
    v.map(|v| v.version.clone())
        .ok_or_else(|| msg(format!("{} nie wspiera Minecraft {mc}", name(loader).unwrap_or(loader))))
}

/// Fabric / Quilt: writes the launcher profile; returns its version id.
pub async fn install_profile(env: &Env, loader: &str, mc: &str, lv: &str) -> Result<String> {
    let id = format!("{loader}-loader-{lv}-{mc}");
    let file = env.paths.version_json(&id);
    if !net::exists(&file).await {
        let base = if loader == "quilt" { QUILT_META } else { FABRIC_META };
        let mut json: Value = env
            .net
            .get_json(&format!("{base}/versions/loader/{}/{}/profile/json", urlencoding::encode(mc), urlencoding::encode(lv)))
            .await?;
        json["id"] = json!(id);
        tokio::fs::create_dir_all(env.paths.version_dir(&id)).await?;
        tokio::fs::write(&file, serde_json::to_vec_pretty(&json)?).await?;
    }
    Ok(id)
}

/// Runs a Java tool; the last lines of its output go into the error when it fails.
async fn run_java(java: &Path, args: &[String], cwd: &Path, on_line: &(dyn Fn(&str) + Send + Sync)) -> Result<()> {
    // the console java.exe, so the installer's output can be read
    let java = java.to_string_lossy().to_string();
    let java = if java.to_lowercase().ends_with("javaw.exe") { format!("{}java.exe", &java[..java.len() - 9]) } else { java };
    let mut cmd = tokio::process::Command::new(java);
    cmd.args(args).current_dir(cwd).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let mut child = cmd.spawn()?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|s| Box::new(s) as _)]
        .into_iter()
        .flatten()
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stream).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    drop(tx);
    let mut tail = VecDeque::new();
    while let Some(l) = rx.recv().await {
        if l.trim().is_empty() {
            continue;
        }
        on_line(&l);
        tail.push_back(l);
        if tail.len() > 15 {
            tail.pop_front();
        }
    }
    let status = child.wait().await?;
    if status.success() {
        return Ok(());
    }
    let last: Vec<String> = tail.iter().rev().take(5).rev().cloned().collect();
    Err(msg(format!("Instalator zakończył się kodem {}:\n{}", status.code().unwrap_or(-1), last.join("\n"))))
}

async fn version_ids(env: &Env) -> HashSet<String> {
    let mut out = HashSet::new();
    if let Ok(mut rd) = tokio::fs::read_dir(env.paths.versions()).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            out.insert(e.file_name().to_string_lossy().to_string());
        }
    }
    out
}

/// Installer URL and the version ids it may create.
pub fn forge_like_target(loader: &str, mc: &str, lv: &str) -> (String, Vec<String>) {
    if loader == "forge" {
        (format!("{FORGE_MAVEN}/{mc}-{lv}/forge-{mc}-{lv}-installer.jar"), vec![format!("{mc}-forge-{lv}"), format!("{mc}-forge{mc}-{lv}")])
    } else if mc == "1.20.1" {
        (format!("{NEO_MAVEN}/forge/1.20.1-{lv}/forge-1.20.1-{lv}-installer.jar"), vec![format!("1.20.1-forge-{lv}"), format!("forge-1.20.1-{lv}")])
    } else {
        (format!("{NEO_MAVEN}/neoforge/{lv}/neoforge-{lv}-installer.jar"), vec![format!("neoforge-{lv}")])
    }
}

/// Forge / NeoForge: runs the official installer; returns the installed version id.
pub async fn install_forge_like(env: &Env, loader: &str, mc: &str, lv: &str, java: &Path, progress: &ProgressFn) -> Result<String> {
    let lname = name(loader).unwrap_or(loader);
    if loader == "forge" && mc_minor(mc) < 13 {
        return Err(msg(format!("Forge dla Minecraft {mc} używa starego instalatora – wybierz Fabric albo wersję 1.13+.")));
    }
    let (url, guesses) = forge_like_target(loader, mc, lv);
    for id in &guesses {
        if net::exists(&env.paths.version_json(id)).await {
            return Ok(id.clone());
        }
    }
    let tmp = env.paths.cache().join("installers");
    tokio::fs::create_dir_all(&tmp).await?;
    let installer = tmp.join(url.rsplit('/').next().unwrap_or("installer.jar"));
    progress(json!({ "stage": format!("Pobieranie {lname} {lv}") }));
    env.net.download(&url, &installer, None, None, &|_| {}).await?;
    // the installer insists on a launcher profile file in the target folder
    let profiles = env.paths.root().join("launcher_profiles.json");
    if !net::exists(&profiles).await {
        tokio::fs::create_dir_all(env.paths.root()).await?;
        tokio::fs::write(&profiles, r#"{"profiles":{},"settings":{},"version":3}"#).await?;
    }
    let before = version_ids(env).await;
    let stage = format!("Instalowanie {lname} {lv}");
    progress(json!({ "stage": stage, "current": "To może potrwać minutę…" }));
    let interesting = Regex::new(r"(?i)^\s*(Processor|Downloading|Extracting|Task|Considering|Splitting|Building)").expect("regex");
    let p2 = progress.clone();
    let args = vec!["-jar".to_string(), installer.to_string_lossy().to_string(), "--installClient".into(), env.paths.root().to_string_lossy().to_string()];
    run_java(java, &args, &tmp, &move |line| {
        if interesting.is_match(line) {
            p2(json!({ "stage": stage, "current": line.trim().chars().take(90).collect::<String>() }));
        }
    })
    .await?;
    let _ = tokio::fs::remove_file(&installer).await;
    let _ = tokio::fs::remove_file(installer.with_extension("jar.log")).await;
    for id in &guesses {
        if net::exists(&env.paths.version_json(id)).await {
            return Ok(id.clone());
        }
    }
    let after = version_ids(env).await;
    if let Some(id) = after.into_iter().find(|id| !before.contains(id) && id != mc) {
        return Ok(id);
    }
    Err(msg(format!("Nie znaleziono profilu {lname} po instalacji.")))
}

#[derive(Clone, Debug)]
pub struct LoaderInstall {
    pub launch_id: String,
    pub loader_version: Option<String>,
    /// the client jar must be named after the loader profile (Forge / NeoForge)
    pub own_jar: bool,
}

/// Installs a loader for an installed vanilla version. `java`: how to get a Java for the
/// Forge / NeoForge installer, with the Mojang component of the vanilla version.
pub async fn install(
    env: &Env,
    loader: &str,
    mc: &str,
    loader_version: Option<&str>,
    progress: ProgressFn,
    java: Option<(JavaProvider, String)>,
) -> Result<LoaderInstall> {
    if loader.is_empty() || loader == "vanilla" {
        return Ok(LoaderInstall { launch_id: mc.into(), loader_version: None, own_jar: false });
    }
    let lname = name(loader).ok_or_else(|| msg(format!("Nieznany loader: {loader}")))?;
    let lv = match loader_version.filter(|v| !v.is_empty()) {
        Some(v) => v.to_string(),
        None => pick_version(env, loader, mc).await?,
    };
    if loader == "fabric" || loader == "quilt" {
        progress(json!({ "stage": format!("Instalowanie {lname} {lv}") }));
        let id = install_profile(env, loader, mc, &lv).await?;
        return Ok(LoaderInstall { launch_id: id, loader_version: Some(lv), own_jar: false });
    }
    let (provider, component) = java.ok_or_else(|| msg(format!("Brak Javy do instalacji {lname}")))?;
    let java = provider(component).await?;
    let id = install_forge_like(env, loader, mc, &lv, &java, &progress).await?;
    Ok(LoaderInstall { launch_id: id, loader_version: Some(lv), own_jar: true })
}

/// Modrinth loader names that can run mods of an instance loader.
pub fn mod_loaders(loader: &str) -> Vec<&'static str> {
    match loader {
        "quilt" => vec!["quilt", "fabric"],
        "neoforge" => vec!["neoforge"],
        "forge" => vec!["forge"],
        "fabric" => vec!["fabric"],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order() {
        assert_eq!(cmp_version("0.16.10", "0.16.9"), Ordering::Greater);
        assert_eq!(cmp_version("21.1.77", "21.1.77"), Ordering::Equal);
        assert_eq!(cmp_version("47.3.0", "47.10.1"), Ordering::Less);
    }

    #[test]
    fn forge_metadata_and_targets() {
        let xml = "<versions><version>1.20.1-47.3.0</version><version>1.20.1-47.10.1</version><version>1.21.1-52.0.1</version></versions>";
        let v = forge_versions_from(xml, "1.20.1", Some("47.3.0"));
        assert_eq!(v, vec![LoaderVersion { version: "47.10.1".into(), stable: false }, LoaderVersion { version: "47.3.0".into(), stable: true }]);
        let (url, ids) = forge_like_target("neoforge", "1.21.1", "21.1.77");
        assert_eq!(url, "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.77/neoforge-21.1.77-installer.jar");
        assert_eq!(ids, vec!["neoforge-21.1.77"]);
        assert_eq!(forge_like_target("forge", "1.20.1", "47.3.0").1[0], "1.20.1-forge-47.3.0");
        assert_eq!(neoforge_prefix("1.21.1"), "21.1.");
        assert_eq!(neoforge_prefix("1.21"), "21.0.");
        assert_eq!(neoforge_prefix("26.1"), "26.1.0.");
        assert_eq!(mod_loaders("quilt"), vec!["quilt", "fabric"]);
    }
}
