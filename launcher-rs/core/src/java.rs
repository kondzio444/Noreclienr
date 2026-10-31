//! Java for the game: Mojang's runtimes and the player's own Java (port of launcher/src/main/java.js).

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::net::Task;
use crate::{jvm, Env, ProgressFn};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const ALL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

/// Mojang's platform key in the runtime list.
pub fn platform_key() -> &'static str {
    if cfg!(windows) {
        if cfg!(target_arch = "aarch64") {
            "windows-arm64"
        } else if cfg!(target_arch = "x86") {
            "windows-x86"
        } else {
            "windows-x64"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "mac-os-arm64"
        } else {
            "mac-os"
        }
    } else if cfg!(target_arch = "x86") {
        "linux-i386"
    } else {
        "linux"
    }
}

pub fn java_executable(home: &Path) -> PathBuf {
    if cfg!(windows) {
        home.join("bin").join("javaw.exe")
    } else if cfg!(target_os = "macos") {
        home.join("jre.bundle").join("Contents").join("Home").join("bin").join("java")
    } else {
        home.join("bin").join("java")
    }
}

/// Ensures Mojang's Java runtime `component` (e.g. java-runtime-delta) and returns its java binary.
pub async fn ensure_runtime(env: &Env, component: &str, progress: &ProgressFn) -> Result<PathBuf> {
    let component = if component.is_empty() { "java-runtime-delta" } else { component };
    let home = env.paths.runtime().join(component).join(platform_key());
    let exe = java_executable(&home);
    let marker = home.join(".installed");
    if crate::net::exists(&marker).await && crate::net::exists(&exe).await {
        return Ok(exe);
    }
    progress(json!({ "stage": format!("Pobieranie Javy ({component})") }));
    let all: Value = env.net.get_json(ALL).await?;
    let entry = all
        .get(platform_key())
        .and_then(|p| p.get(component))
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .ok_or_else(|| msg(format!("Brak Javy {component} dla tej platformy – ustaw własną ścieżkę Javy w ustawieniach.")))?;
    let manifest: Value = env.net.get_json(entry.pointer("/manifest/url").and_then(Value::as_str).unwrap_or_default()).await?;
    let mut tasks = Vec::new();
    let mut execs = Vec::new();
    let mut links = Vec::new();
    for (rel, info) in manifest.get("files").and_then(Value::as_object).into_iter().flatten() {
        let dest = home.join(rel);
        match info.str_of("type") {
            Some("directory") => tokio::fs::create_dir_all(&dest).await?,
            Some("file") => {
                let raw = info.pointer("/downloads/raw").cloned().unwrap_or_default();
                tasks.push(Task {
                    url: raw.str_of("url").unwrap_or_default().into(),
                    dest: dest.clone(),
                    sha1: raw.str_of("sha1").map(String::from),
                    size: raw.get("size").and_then(Value::as_u64),
                    name: rel.rsplit('/').next().unwrap_or(rel).into(),
                });
                if info.truthy_of("executable") {
                    execs.push(dest);
                }
            }
            Some("link") => links.push((dest, info.string_or("target", ""))),
            _ => {}
        }
    }
    let last = Mutex::new(Instant::now() - Duration::from_secs(1));
    env.net
        .download_all(
            tasks,
            16,
            &|p| {
                let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
                if l.elapsed().as_millis() < 100 && p.done != p.total {
                    return;
                }
                *l = Instant::now();
                let mut v = json!({ "stage": "Pobieranie Javy" });
                crate::js::assign(&mut v, &serde_json::to_value(&p).unwrap_or_default());
                progress(v);
            },
            None,
        )
        .await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for f in &execs {
            let _ = tokio::fs::set_permissions(f, std::fs::Permissions::from_mode(0o755)).await;
        }
        for (dest, target) in &links {
            let _ = tokio::fs::remove_file(dest).await;
            let _ = tokio::fs::symlink(target, dest).await;
        }
    }
    #[cfg(not(unix))]
    let _ = (&execs, &links);
    tokio::fs::write(&marker, chrono::Utc::now().to_rfc3339()).await?;
    Ok(exe)
}

/// Major version from `java -version` output ("1.8.0_402" → 8, "21.0.3" → 21).
pub fn parse_java_version(text: &str) -> Option<u32> {
    let re = Regex::new(r#"version "(\d+)(?:\.(\d+))?"#).expect("regex");
    let c = re.captures(text)?;
    let first: u32 = c.get(1)?.as_str().parse().ok()?;
    if first == 1 {
        c.get(2)?.as_str().parse().ok()
    } else {
        Some(first)
    }
}

/// Runs `java -version` (8 s at most) and returns the major version.
pub async fn probe_java(bin: &Path) -> Option<u32> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.arg("-version").stdin(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = tokio::time::timeout(Duration::from_secs(8), cmd.output()).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = format!("{}{}", String::from_utf8_lossy(&out.stderr), String::from_utf8_lossy(&out.stdout));
    parse_java_version(&text)
}

static PROBED: Mutex<Option<HashMap<String, Option<u32>>>> = Mutex::new(None);

/// probe_java with a cache keyed by path + modification time.
pub async fn probe_cached(bin: &Path) -> Option<u32> {
    let mtime = std::fs::metadata(bin).ok()?.modified().ok()?;
    let key = format!("{}|{:?}", bin.display(), mtime);
    if let Some(hit) = PROBED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).get(&key) {
        return *hit;
    }
    let major = probe_java(bin).await;
    PROBED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(key, major);
    major
}

#[derive(Clone, Debug)]
pub struct Picked {
    pub bin: PathBuf,
    pub major: u32,
    pub own: bool,
    pub note: Option<String>,
}

/// Java for a Minecraft version: the player's own Java when it fits, otherwise Mojang's runtime.
pub async fn pick(
    env: &Env,
    java_path: &str,
    need: u32,
    component: Option<&str>,
    loader: &str,
    progress: &ProgressFn,
) -> Result<Picked> {
    let mut note = None;
    if !java_path.is_empty() {
        let major = probe_cached(Path::new(java_path)).await;
        if jvm::java_fits(major, need, loader) {
            return Ok(Picked { bin: java_path.into(), major: major.unwrap_or(need), own: true, note });
        }
        note = Some(match major {
            Some(m) => format!(
                "Twoja Java {m} nie pasuje do tej wersji gry (potrzebna {need}{}) – używam Javy pobranej automatycznie.",
                if need <= 8 { "" } else { "+" }
            ),
            None => "Nie udało się uruchomić Javy z ustawień – używam Javy pobranej automatycznie.".into(),
        });
    }
    let comp = component.filter(|c| !c.is_empty()).map(String::from).unwrap_or_else(|| jvm::component_for(need).into());
    let bin = ensure_runtime(env, &comp, progress).await?;
    Ok(Picked { bin, major: need, own: false, note })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_version_output() {
        assert_eq!(parse_java_version("openjdk version \"21.0.3\" 2024-04-16 LTS"), Some(21));
        assert_eq!(parse_java_version("java version \"1.8.0_402\""), Some(8));
        assert_eq!(parse_java_version("openjdk version \"25\" 2025-09-16"), Some(25));
        assert_eq!(parse_java_version("nonsense"), None);
    }

    #[test]
    fn executable_layout() {
        let p = java_executable(Path::new("/r"));
        assert!(p.ends_with(if cfg!(windows) { "bin/javaw.exe" } else { "bin/java" }));
        assert!(!platform_key().is_empty());
    }
}
