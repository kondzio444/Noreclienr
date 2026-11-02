//! Minecraft versions: Mojang's manifest, version JSON inheritance, libraries, natives and assets
//! (port of launcher/src/main/versions.js).

use crate::error::{msg, Result};
use crate::js::{truthy, ValueExt};
use crate::net::{self, Task};
use crate::{loaders, Env, JavaProvider, ProgressFn};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

pub const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
pub const RESOURCES: &str = "https://resources.download.minecraft.net";

/// Mojang's name of this OS in rules and natives.
pub const OS_NAME: &str = if cfg!(windows) {
    "windows"
} else if cfg!(target_os = "macos") {
    "osx"
} else {
    "linux"
};

/// Node's `process.arch` naming, which Mojang's `os.arch` rules are compared with (ia32 → x86).
pub const RULE_ARCH: &str = if cfg!(target_arch = "x86_64") {
    "x64"
} else if cfg!(target_arch = "aarch64") {
    "arm64"
} else if cfg!(target_arch = "x86") {
    "x86"
} else {
    "other"
};

/// `os.release()`: kernel release (Linux / macOS Darwin), "10.0.<build>" on Windows.
pub fn os_release() -> String {
    if cfg!(windows) {
        format!("10.0.{}", sysinfo::System::kernel_version().unwrap_or_default())
    } else {
        sysinfo::System::kernel_version().unwrap_or_default()
    }
}

/// Evaluates Mojang's `rules` arrays. `features`: `{ is_demo_user, has_custom_resolution, ... }`.
pub fn rules_allow(rules: Option<&Value>, features: &Value) -> bool {
    let Some(rules) = rules.and_then(Value::as_array) else { return true };
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        let mut matched = true;
        if let Some(os) = rule.get("os") {
            if let Some(name) = os.str_of("name") {
                if !name.is_empty() && name != OS_NAME {
                    matched = false;
                }
            }
            if let Some(arch) = os.str_of("arch") {
                if !arch.is_empty() && arch != RULE_ARCH {
                    matched = false;
                }
            }
            if let Some(ver) = os.str_of("version") {
                if !ver.is_empty() && !Regex::new(ver).is_ok_and(|re| re.is_match(&os_release())) {
                    matched = false;
                }
            }
        }
        if let Some(f) = rule.get("features").and_then(Value::as_object) {
            for (k, v) in f {
                let have = features.get(k).is_some_and(truthy);
                if Some(have) != v.as_bool() {
                    matched = false;
                }
            }
        }
        if matched {
            allowed = rule.str_of("action") == Some("allow");
        }
    }
    allowed
}

/// "group:artifact:version[:classifier][@ext]" → relative maven path.
pub fn maven_path(name: &str) -> PathBuf {
    let (coords, ext) = name.split_once('@').unwrap_or((name, "jar"));
    let parts: Vec<&str> = coords.split(':').collect();
    let group = parts.first().copied().unwrap_or_default();
    let artifact = parts.get(1).copied().unwrap_or_default();
    let version = parts.get(2).copied().unwrap_or_default();
    let file = match parts.get(3) {
        Some(c) => format!("{artifact}-{version}-{c}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    let mut p = PathBuf::new();
    for g in group.split('.') {
        p.push(g);
    }
    p.push(artifact);
    p.push(version);
    p.push(file);
    p
}

/// Maven path with forward slashes (for URLs).
fn url_path(p: &Path) -> String {
    p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

impl Env {
    /// Mojang's version manifest (cached in memory and on disk for offline starts).
    pub async fn manifest(&self, force: bool) -> Result<Value> {
        let mut cache = self.manifest.lock().await;
        if let (Some(m), false) = (cache.as_ref(), force) {
            return Ok(m.clone());
        }
        let file = self.paths.cache().join("version_manifest_v2.json");
        let m = match self.net.get_json::<Value>(MANIFEST).await {
            Ok(m) => {
                tokio::fs::create_dir_all(self.paths.cache()).await?;
                tokio::fs::write(&file, serde_json::to_vec(&m)?).await?;
                m
            }
            Err(e) => match tokio::fs::read(&file).await {
                Ok(b) => serde_json::from_slice(&b)?,
                Err(_) => return Err(e),
            },
        };
        *cache = Some(m.clone());
        Ok(m)
    }

    pub async fn fabric_game_versions(&self) -> Result<Vec<String>> {
        let list: Vec<Value> = self.net.get_json(&format!("{FABRIC_META}/versions/game")).await?;
        Ok(list.iter().filter_map(|v| v.str_of("version").map(String::from)).collect())
    }

    pub async fn read_version_json(&self, id: &str) -> Result<Value> {
        let b = tokio::fs::read(self.paths.version_json(id)).await.map_err(|_| msg(format!("Brak pliku wersji {id}")))?;
        Ok(serde_json::from_slice(&b)?)
    }

    /// Downloads (if needed) and returns the vanilla version JSON.
    pub async fn fetch_vanilla_json(&self, id: &str) -> Result<Value> {
        let file = self.paths.version_json(id);
        let manifest = self.manifest(false).await.ok();
        let entry = manifest.as_ref().and_then(|m| m.get("versions")?.as_array()?.iter().find(|v| v.str_of("id") == Some(id)).cloned());
        if let Some(e) = entry {
            let url = e.str_of("url").unwrap_or_default();
            self.net.download(url, &file, e.str_of("sha1"), None, &|_| {}).await?;
        } else if !net::exists(&file).await {
            return Err(msg(format!("Nieznana wersja Minecraft: {id}")));
        }
        self.read_version_json(id).await
    }

    /// Merges a child version (Fabric, Forge…) with the versions it inherits from.
    pub async fn resolve_version(&self, id: &str) -> Result<Value> {
        let mut chain = vec![self.read_version_json(id).await?];
        while let Some(parent) = chain.last().and_then(|j| j.str_of("inheritsFrom")).map(String::from) {
            if chain.len() > 8 {
                return Err(msg("Za długi łańcuch dziedziczenia wersji"));
            }
            chain.push(self.read_version_json(&parent).await?);
        }
        let mut merged = chain.pop().expect("at least one version");
        while let Some(child) = chain.pop() {
            merged = merge_version(&merged, &child);
        }
        Ok(merged)
    }
}

/// resolveVersion() for one parent/child pair (pure).
pub fn merge_version(parent: &Value, json: &Value) -> Value {
    let mut merged: Map<String, Value> = parent.as_object().cloned().unwrap_or_default();
    for (k, v) in json.as_object().into_iter().flatten() {
        merged.insert(k.clone(), v.clone());
    }
    let libs = |v: &Value| v.get("libraries").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut libraries = libs(json);
    libraries.extend(libs(parent));
    merged.insert("libraries".into(), Value::Array(libraries));
    let main = json.get("mainClass").filter(|v| truthy(v)).or_else(|| parent.get("mainClass")).cloned();
    merged.insert("mainClass".into(), main.unwrap_or(Value::Null));
    if parent.get("arguments").is_some() || json.get("arguments").is_some() {
        let part = |v: &Value, k: &str| v.pointer(&format!("/arguments/{k}")).and_then(Value::as_array).cloned().unwrap_or_default();
        let mut game = part(parent, "game");
        game.extend(part(json, "game"));
        let mut jvm = part(parent, "jvm");
        jvm.extend(part(json, "jvm"));
        merged.insert("arguments".into(), json!({ "game": game, "jvm": jvm }));
    }
    let jar = parent.get("jar").filter(|v| truthy(v)).or_else(|| parent.get("id")).cloned();
    merged.insert("jar".into(), jar.unwrap_or(Value::Null));
    for k in ["assetIndex", "assets", "downloads", "logging"] {
        match parent.get(k) {
            Some(v) => merged.insert(k.into(), v.clone()),
            None => merged.remove(k),
        };
    }
    let java = json.get("javaVersion").filter(|v| truthy(v)).or_else(|| parent.get("javaVersion")).cloned();
    match java {
        Some(j) => merged.insert("javaVersion".into(), j),
        None => merged.remove("javaVersion"),
    };
    merged.remove("inheritsFrom");
    Value::Object(merged)
}

/// A native jar to unpack before the start.
#[derive(Clone, Debug, PartialEq)]
pub struct Native {
    pub file: PathBuf,
    pub exclude: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Libs {
    pub downloads: Vec<Task>,
    pub classpath: Vec<PathBuf>,
    pub natives: Vec<Native>,
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// Libraries to download, classpath entries and native jars (child libraries win on duplicates).
pub fn collect_libraries(version: &Value, libraries_dir: &Path) -> Libs {
    let mut out = Libs::default();
    let mut seen = std::collections::HashSet::new();
    let no_features = json!({});
    for lib in version.get("libraries").and_then(Value::as_array).into_iter().flatten() {
        if !rules_allow(lib.get("rules"), &no_features) {
            continue;
        }
        let name = lib.str_of("name").unwrap_or_default();
        let parts: Vec<&str> = name.split(':').collect();
        let key = if parts.len() > 3 {
            format!("{}:{}:{}", parts[0], parts[1], parts[3])
        } else {
            format!("{}:{}", parts.first().unwrap_or(&""), parts.get(1).unwrap_or(&""))
        };
        if !seen.insert(key) {
            continue;
        }
        let art = lib.pointer("/downloads/artifact").filter(|v| truthy(v));
        let natives = lib.get("natives").filter(|v| truthy(v));
        if let Some(art) = art {
            let rel = art.str_of("path").map(PathBuf::from).unwrap_or_else(|| maven_path(name));
            let dest = libraries_dir.join(rel);
            if let Some(url) = art.str_of("url").filter(|u| !u.is_empty()) {
                out.downloads.push(Task {
                    url: url.to_string(),
                    dest: dest.clone(),
                    sha1: art.str_of("sha1").map(String::from),
                    size: art.get("size").and_then(Value::as_u64),
                    name: file_name(&dest),
                });
            }
            out.classpath.push(dest);
        } else if natives.is_none() {
            // Fabric style: maven repository url + coordinates
            let rel = maven_path(name);
            let base = lib.str_of("url").filter(|u| !u.is_empty()).unwrap_or("https://libraries.minecraft.net/");
            let base = if base.ends_with('/') { base.to_string() } else { format!("{base}/") };
            let dest = libraries_dir.join(&rel);
            out.downloads.push(Task {
                url: base + &url_path(&rel),
                dest: dest.clone(),
                sha1: lib.str_of("sha1").map(String::from),
                size: lib.get("size").and_then(Value::as_u64),
                name: file_name(&dest),
            });
            out.classpath.push(dest);
        }
        // legacy natives (before 1.19)
        if let Some(classifier) = natives.and_then(|n| n.str_of(OS_NAME)) {
            let classifier = classifier.replace("${arch}", if cfg!(target_arch = "x86") { "32" } else { "64" });
            if let Some(nat) = lib.pointer("/downloads/classifiers").and_then(|c| c.get(&classifier)) {
                let dest = libraries_dir.join(nat.str_of("path").unwrap_or_default());
                out.downloads.push(Task {
                    url: nat.str_of("url").unwrap_or_default().to_string(),
                    dest: dest.clone(),
                    sha1: nat.str_of("sha1").map(String::from),
                    size: nat.get("size").and_then(Value::as_u64),
                    name: file_name(&dest),
                });
                let exclude = lib
                    .pointer("/extract/exclude")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                out.natives.push(Native { file: dest, exclude });
            }
        }
        // modern natives are separate libraries with a "natives-<os>" classifier
        if let (Some(c), Some(art)) = (parts.get(3), art) {
            if c.starts_with("natives-") {
                out.natives.push(Native { file: libraries_dir.join(art.str_of("path").unwrap_or_default()), exclude: vec!["META-INF/".into()] });
            }
        }
    }
    out
}

/// Unpacks the native libraries (.dll / .so / .dylib / .jnilib) into `dir`, flat.
pub async fn extract_natives(natives: &[Native], dir: &Path) -> Result<()> {
    let natives = natives.to_vec();
    let dir = dir.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let re = Regex::new(r"(?i)\.(dll|so|dylib|jnilib)$").expect("regex");
        for n in &natives {
            // a broken native jar is downloaded again on the next install
            let Ok(f) = std::fs::File::open(&n.file) else { continue };
            let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(f)) else { continue };
            for i in 0..zip.len() {
                let Ok(mut entry) = zip.by_index(i) else { continue };
                let name = entry.name().to_string();
                if entry.is_dir() || n.exclude.iter().any(|e| name.starts_with(e.as_str())) || !re.is_match(&name) {
                    continue;
                }
                let base = name.rsplit('/').next().unwrap_or(&name).to_string();
                let mut out = std::fs::File::create(dir.join(base))?;
                std::io::copy(&mut entry, &mut out)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(crate::error::wrap)?
}

/// Download tasks of the asset index (the index file itself is fetched here).
pub async fn asset_tasks(env: &Env, version: &Value) -> Result<Vec<Task>> {
    let idx = version.get("assetIndex").ok_or_else(|| msg("Wersja nie ma indeksu zasobów"))?;
    let assets = env.paths.assets();
    let index_file = assets.join("indexes").join(format!("{}.json", idx.str_of("id").unwrap_or_default()));
    env.net.download(idx.str_of("url").unwrap_or_default(), &index_file, idx.str_of("sha1"), None, &|_| {}).await?;
    let index: Value = serde_json::from_slice(&tokio::fs::read(&index_file).await?)?;
    let legacy = index.truthy_of("map_to_resources");
    let mut tasks = Vec::new();
    for (name, obj) in index.get("objects").and_then(Value::as_object).into_iter().flatten() {
        let hash = obj.str_of("hash").unwrap_or_default();
        if hash.len() < 2 {
            continue;
        }
        let sub = &hash[..2];
        let dest = if legacy { assets.join("virtual").join("legacy").join(name) } else { assets.join("objects").join(sub).join(hash) };
        tasks.push(Task {
            url: format!("{RESOURCES}/{sub}/{hash}"),
            dest,
            sha1: Some(hash.to_string()),
            size: obj.get("size").and_then(Value::as_u64),
            name: name.clone(),
        });
    }
    Ok(tasks)
}

/// What [`install_version`] prepared for the start.
#[derive(Clone, Debug)]
pub struct Installed {
    pub version: Value,
    pub launch_id: String,
    pub jar_path: PathBuf,
    pub libs: Libs,
    pub loader_version: Option<String>,
}

pub struct InstallRequest<'a> {
    pub mc_version: &'a str,
    pub loader: &'a str,
    pub loader_version: Option<&'a str>,
}

/// Installs everything needed to launch: version JSON, loader, client jar, libraries, log
/// config and assets (SHA-1 verified, `concurrency` downloads at once).
pub async fn install_version(env: &Env, req: InstallRequest<'_>, concurrency: usize, progress: ProgressFn, java: Option<JavaProvider>) -> Result<Installed> {
    let step = |stage: &str, extra: Value| {
        let mut p = json!({ "stage": stage });
        crate::js::assign(&mut p, &extra);
        progress(p);
    };
    step("Pobieranie informacji o wersji", json!({}));
    let mc = req.mc_version;
    let vanilla = env.fetch_vanilla_json(mc).await?;
    let mut launch_id = mc.to_string();
    let mut loader_version = req.loader_version.map(String::from);
    let mut own_jar = false;
    let vanilla_jar = env.paths.version_dir(mc).join(format!("{mc}.jar"));
    if !req.loader.is_empty() && req.loader != "vanilla" {
        if req.loader == "forge" || req.loader == "neoforge" {
            // the Forge / NeoForge installer needs the vanilla client jar in place
            if let Some(c) = vanilla.pointer("/downloads/client") {
                env.net.download(c.str_of("url").unwrap_or_default(), &vanilla_jar, c.str_of("sha1"), c.get("size").and_then(Value::as_u64), &|_| {}).await?;
            }
        }
        let component = vanilla.pointer("/javaVersion/component").and_then(Value::as_str).unwrap_or("jre-legacy").to_string();
        let p2 = progress.clone();
        let r = loaders::install(env, req.loader, mc, loader_version.as_deref(), Arc::new(move |p| p2(p)), java.map(|j| (j, component))).await?;
        launch_id = r.launch_id;
        loader_version = r.loader_version;
        own_jar = r.own_jar;
    }
    let version = env.resolve_version(&launch_id).await?;

    let mut tasks = Vec::new();
    let client = version.pointer("/downloads/client").cloned();
    if let Some(c) = &client {
        tasks.push(Task {
            url: c.str_of("url").unwrap_or_default().into(),
            dest: vanilla_jar.clone(),
            sha1: c.str_of("sha1").map(String::from),
            size: c.get("size").and_then(Value::as_u64),
            name: format!("{mc}.jar"),
        });
    }
    // Forge / NeoForge skip the game jar by its file name (<profile id>.jar), like the official launcher lays it out
    let jar_path = if own_jar { env.paths.version_dir(&launch_id).join(format!("{launch_id}.jar")) } else { vanilla_jar.clone() };
    let libs = collect_libraries(&version, &env.paths.libraries());
    tasks.extend(libs.downloads.iter().cloned());
    if let Some(f) = version.pointer("/logging/client/file") {
        let id = f.str_of("id").unwrap_or("client.xml");
        tasks.push(Task {
            url: f.str_of("url").unwrap_or_default().into(),
            dest: env.paths.assets().join("log_configs").join(id),
            sha1: f.str_of("sha1").map(String::from),
            size: f.get("size").and_then(Value::as_u64),
            name: id.into(),
        });
    }
    step("Pobieranie indeksu zasobów", json!({}));
    tasks.extend(asset_tasks(env, &version).await?);
    // the same file may be listed twice (an asset under two names): download it once
    let mut seen = std::collections::HashSet::new();
    tasks.retain(|t| seen.insert(t.dest.clone()));

    let last = std::sync::Mutex::new(Instant::now() - std::time::Duration::from_secs(1));
    env.net
        .download_all(
            tasks,
            concurrency,
            &|p| {
                let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
                if l.elapsed().as_millis() < 100 && p.done != p.total {
                    return;
                }
                *l = Instant::now();
                step("Pobieranie plików gry", serde_json::to_value(&p).unwrap_or_default());
            },
            None,
        )
        .await?;
    if own_jar && !net::is_valid(&jar_path, client.as_ref().and_then(|c| c.str_of("sha1")), None).await {
        tokio::fs::copy(&vanilla_jar, &jar_path).await?;
    }
    Ok(Installed { version, launch_id, jar_path, libs, loader_version })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maven_coordinates_to_path() {
        assert_eq!(maven_path("net.fabricmc:fabric-loader:0.16.5"), PathBuf::from("net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar"));
        assert_eq!(maven_path("org.lwjgl:lwjgl:3.3.3:natives-linux"), PathBuf::from("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar"));
        assert_eq!(maven_path("de.oceanlabs.mcp:mcp_config:1.20.1@zip"), PathBuf::from("de/oceanlabs/mcp/mcp_config/1.20.1/mcp_config-1.20.1.zip"));
    }

    #[test]
    fn rules_by_os_and_features() {
        let none = json!({});
        assert!(rules_allow(None, &none));
        assert!(rules_allow(Some(&json!([{ "action": "allow" }])), &none));
        assert!(!rules_allow(Some(&json!([{ "action": "allow", "os": { "name": "nonexistent-os" } }])), &none));
        assert!(!rules_allow(Some(&json!([{ "action": "allow" }, { "action": "disallow", "os": { "name": OS_NAME } }])), &none));
        assert!(rules_allow(Some(&json!([{ "action": "allow", "features": { "has_custom_resolution": true } }])), &json!({ "has_custom_resolution": true })));
        assert!(!rules_allow(Some(&json!([{ "action": "allow", "features": { "is_demo_user": true } }])), &none));
        assert!(!rules_allow(Some(&json!([{ "action": "allow", "os": { "arch": "x86" } }])), &none) || RULE_ARCH == "x86");
    }

    #[test]
    fn inheritance_merges_like_resolve_version() {
        let parent = json!({
            "id": "1.21.1", "mainClass": "net.minecraft.client.main.Main", "assetIndex": { "id": "17" }, "assets": "17",
            "downloads": { "client": {} }, "javaVersion": { "majorVersion": 21 }, "logging": { "client": {} },
            "libraries": [{ "name": "a:b:1" }], "arguments": { "game": ["--username"], "jvm": ["-cp"] }, "type": "release"
        });
        let child = json!({
            "id": "fabric-loader-0.16.5-1.21.1", "inheritsFrom": "1.21.1", "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "libraries": [{ "name": "net.fabricmc:fabric-loader:0.16.5" }], "arguments": { "game": [], "jvm": ["-DFabricMcEmu= net.minecraft.client.main.Main "] }
        });
        let m = merge_version(&parent, &child);
        assert_eq!(m["id"], "fabric-loader-0.16.5-1.21.1");
        assert_eq!(m["mainClass"], "net.fabricmc.loader.impl.launch.knot.KnotClient");
        assert_eq!(m["libraries"][0]["name"], "net.fabricmc:fabric-loader:0.16.5");
        assert_eq!(m["libraries"][1]["name"], "a:b:1");
        assert_eq!(m["arguments"]["jvm"], json!(["-cp", "-DFabricMcEmu= net.minecraft.client.main.Main "]));
        assert_eq!(m["jar"], "1.21.1");
        assert_eq!(m["assetIndex"]["id"], "17");
        assert_eq!(m["javaVersion"]["majorVersion"], 21);
        assert!(m.get("inheritsFrom").is_none());
    }

    #[test]
    fn libraries_dedupe_child_first_and_find_natives() {
        let v = json!({ "libraries": [
            { "name": "net.fabricmc:fabric-loader:0.16.5", "url": "https://maven.fabricmc.net/", "sha1": "abc", "size": 10 },
            { "name": "org.ow2.asm:asm:9.7", "url": "https://maven.fabricmc.net" },
            { "name": "org.ow2.asm:asm:9.6", "downloads": { "artifact": { "path": "org/ow2/asm/asm/9.6/asm-9.6.jar", "url": "https://x/asm.jar", "sha1": "1", "size": 1 } } },
            { "name": format!("org.lwjgl:lwjgl:3.3.3:natives-{}", if OS_NAME == "osx" { "macos" } else { OS_NAME }),
              "downloads": { "artifact": { "path": "org/lwjgl/n.jar", "url": "https://x/n.jar", "sha1": "2", "size": 2 } } },
            { "name": "x:only-other-os:1", "rules": [{ "action": "allow", "os": { "name": "nonexistent" } }], "downloads": { "artifact": { "path": "x.jar", "url": "u" } } }
        ]});
        let libs = collect_libraries(&v, Path::new("/L"));
        assert_eq!(libs.classpath.len(), 3);
        assert_eq!(libs.downloads[0].url, "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar");
        assert_eq!(libs.downloads[0].sha1.as_deref(), Some("abc"));
        assert_eq!(libs.downloads[1].url, "https://maven.fabricmc.net/org/ow2/asm/asm/9.7/asm-9.7.jar");
        assert_eq!(libs.natives, vec![Native { file: PathBuf::from("/L/org/lwjgl/n.jar"), exclude: vec!["META-INF/".into()] }]);
    }

    #[tokio::test]
    async fn natives_are_unpacked_flat() {
        let dir = tempfile::tempdir().unwrap();
        let jar = dir.path().join("n.jar");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&jar).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            for (n, d) in [("linux/x64/org/lwjgl/liblwjgl.so", "so"), ("META-INF/x.so", "no"), ("readme.txt", "no"), ("win/lwjgl.dll", "dll")] {
                z.start_file(n, o).unwrap();
                std::io::Write::write_all(&mut z, d.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        let out = dir.path().join("natives");
        extract_natives(&[Native { file: jar, exclude: vec!["META-INF/".into()] }], &out).await.unwrap();
        let mut names: Vec<_> = std::fs::read_dir(&out).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        names.sort();
        assert_eq!(names, vec!["liblwjgl.so", "lwjgl.dll"]);
    }
}
