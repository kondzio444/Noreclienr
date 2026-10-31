//! Instances (port of launcher/src/main/instances.js): create / update / remove, folders, worlds,
//! screenshots and the bundled Nore Client jars (nore-mods.js).

use crate::error::{msg, Result};
use crate::js::{assign, now_ms, truthy, ValueExt};
use crate::paths::Paths;
use crate::store::Store;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub const NORE_MC_VERSION: &str = "1.21.1";

/// The Nore Client jars that ship with the launcher (`<dir>/index.json`: `[{ file, versions }]`).
#[derive(Clone, Debug, Default)]
pub struct NoreMods {
    dir: Option<PathBuf>,
    list: Vec<Value>,
}

impl NoreMods {
    /// First folder with a readable index.json wins (listed jars that are missing are skipped).
    pub fn load(dirs: &[PathBuf]) -> Self {
        for dir in dirs {
            let Ok(text) = std::fs::read_to_string(dir.join("index.json")) else { continue };
            let Ok(Value::Array(list)) = serde_json::from_str::<Value>(&text) else { continue };
            let list = list.into_iter().filter(|p| p.str_of("file").is_some_and(|f| dir.join(f).exists())).collect();
            return Self { dir: Some(dir.clone()), list };
        }
        Self::default()
    }

    /// Default places: `NORE_MODS_DIR`, the app's resources (`nore/mods`), the Electron dev folder.
    pub fn default_dirs(resource_dir: Option<&Path>) -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if let Some(d) = std::env::var_os("NORE_MODS_DIR") {
            dirs.push(PathBuf::from(d));
        }
        if let Some(r) = resource_dir {
            dirs.push(r.join("nore").join("mods"));
        }
        if let Ok(exe) = std::env::current_exe() {
            for up in exe.ancestors().skip(1).take(6) {
                dirs.push(up.join("launcher").join("resources").join("mods"));
            }
        }
        dirs
    }

    /// Minecraft versions some bundled jar supports.
    pub fn versions(&self) -> Vec<String> {
        self.list
            .iter()
            .flat_map(|p| p.get("versions").and_then(Value::as_array).cloned().unwrap_or_default())
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    }

    pub fn supports(&self, mc: &str) -> bool {
        self.versions().iter().any(|v| v == mc)
    }

    /// Absolute path of the jar for this Minecraft version.
    pub fn jar_for(&self, mc: &str) -> Option<PathBuf> {
        let p = self.list.iter().find(|p| p.get("versions").and_then(Value::as_array).is_some_and(|v| v.iter().any(|x| x.as_str() == Some(mc))))?;
        Some(self.dir.as_ref()?.join(p.str_of("file")?))
    }
}

pub struct Instances<'a> {
    pub store: &'a Store,
    pub paths: &'a Paths,
    pub mods: &'a NoreMods,
}

static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());

/// Folder name of a new instance: "Nore Client" → "nore-client-1a2b3c".
pub fn slug(name: &str) -> String {
    let lower = name.to_lowercase();
    let base = SLUG.replace_all(&lower, "-");
    let base = base.trim_matches('-');
    let base = if base.is_empty() { "instancja" } else { base };
    let mut r = [0u8; 3];
    rand::thread_rng().fill_bytes(&mut r);
    format!("{base}-{}", hex::encode(r))
}

fn is(v: &Value, k: &str, s: &str) -> bool {
    v.str_of(k) == Some(s)
}

impl Instances<'_> {
    pub fn game_dir(&self, id: &str) -> PathBuf {
        self.paths.instances().join(id)
    }

    fn with_dir(&self, mut inst: Value) -> Value {
        let dir = self.game_dir(inst.str_of("id").unwrap_or_default());
        inst["gameDir"] = json!(dir.to_string_lossy());
        inst
    }

    pub fn list(&self) -> Vec<Value> {
        let raw = self.store.read(|d| d.get("instances").and_then(Value::as_array).cloned().unwrap_or_default());
        raw.into_iter().map(|i| self.with_dir(i)).collect()
    }

    pub fn get(&self, id: &str) -> Option<Value> {
        let raw = self.store.read(|d| d.get("instances").and_then(Value::as_array).and_then(|l| l.iter().find(|i| i.str_of("id") == Some(id)).cloned()));
        raw.map(|i| self.with_dir(i))
    }

    pub fn require(&self, id: &str) -> Result<Value> {
        self.get(id).ok_or_else(|| msg("Nie znaleziono instancji."))
    }

    /// modpack: 'vanilla', 'fabric', 'nore' (Fabric + Nore Client on supported versions),
    /// 'loader' (plain Quilt / Forge / NeoForge) or 'pack' (a modpack with its own loader).
    pub fn create(&self, opts: &Value) -> Result<Value> {
        let name = opts.str_of("name").unwrap_or_default();
        let mc = opts.string_or("mcVersion", NORE_MC_VERSION);
        let mut loader = opts.string_or("loader", "vanilla");
        let nore_client = opts.truthy_of("noreClient");
        let mut perf_pack = opts.truthy_of("perfPack");
        let mut modpack = match opts.str_of("modpack").filter(|m| !m.is_empty()) {
            Some(m) => m.to_string(),
            None if loader == "fabric" => if nore_client { "nore" } else { "fabric" }.to_string(),
            None => "vanilla".into(),
        };
        if modpack == "nore" && !self.mods.supports(&mc) {
            modpack = "fabric".into();
            perf_pack = true;
        }
        if modpack == "loader" && (loader == "vanilla" || loader == "fabric") {
            modpack = loader.clone();
        }
        if !["vanilla", "pack", "loader"].contains(&modpack.as_str()) {
            loader = "fabric".into();
        }
        if modpack == "vanilla" {
            loader = "vanilla".into();
        }
        let trimmed = name.trim();
        let mut inst = json!({
            "id": slug(name),
            "name": if trimmed.is_empty() { mc.clone() } else { trimmed.to_string() },
            "mcVersion": mc,
            "loader": loader,
            "loaderVersion": opts.get("loaderVersion").cloned().unwrap_or(Value::Null),
            "modpack": modpack,
            "noreClient": modpack == "nore",
            "perfPack": perf_pack && modpack != "vanilla",
            "packInstalled": false,
            "color": opts.get("color").cloned().unwrap_or(json!(0)),
            "created": now_ms(),
            "lastPlayed": 0,
            "playTime": 0,
            "memoryMb": 0,
            "joinServer": "",
            "jvmArgs": "",
            "width": 0,
            "height": 0,
        });
        // new modded instances get the performance set (perf.js); imported ones are asked once
        if modpack != "vanilla" && !opts.truthy_of("askPerf") {
            inst["perfMods"] = json!(true);
            inst["perfAsked"] = json!(true);
        }
        let id = inst["id"].as_str().unwrap_or_default().to_string();
        self.store.update(|d| {
            if !d["instances"].is_array() {
                d["instances"] = json!([]);
            }
            d["instances"].as_array_mut().expect("array").push(inst);
            d["selectedInstance"] = json!(id);
        })?;
        std::fs::create_dir_all(self.game_dir(&id))?;
        self.require(&id)
    }

    /// Object.assign with the rules of instances.js (version / loader / modpack changes reset what depends on them).
    pub fn update(&self, id: &str, patch: &Value) -> Result<Value> {
        let supports = |mc: &str| self.mods.supports(mc);
        self.store.update(|d| {
            let Some(i) = d.get_mut("instances").and_then(Value::as_array_mut).and_then(|l| l.iter_mut().find(|x| x.str_of("id") == Some(id))) else { return };
            let version_changed = patch.str_of("mcVersion").is_some_and(|v| !v.is_empty() && Some(v) != i.str_of("mcVersion"));
            let loader_changed = patch.str_of("loader").is_some_and(|v| !v.is_empty() && Some(v) != i.str_of("loader"));
            let has = |k: &str| patch.get(k).is_some();
            assign(i, patch);
            i["id"] = json!(id);
            if loader_changed && !has("loaderVersion") {
                i["loaderVersion"] = Value::Null;
            }
            if version_changed {
                // an explicit loaderVersion / packInstalled in the same patch wins (modpack updates set both)
                if !has("loaderVersion") {
                    i["loaderVersion"] = Value::Null;
                }
                if !has("packInstalled") {
                    i["packInstalled"] = json!(false);
                }
                i["perfModsInstalled"] = json!(false);
            }
            let mc = i.string_or("mcVersion", "");
            if patch.get("modpack").is_some_and(truthy) {
                if is(i, "modpack", "nore") && !supports(&mc) {
                    i["modpack"] = json!("fabric");
                    i["perfPack"] = json!(true);
                }
                let mp = i.string_or("modpack", "");
                if mp != "pack" && mp != "loader" {
                    i["loader"] = json!(if mp == "vanilla" { "vanilla" } else { "fabric" });
                }
                i["noreClient"] = json!(mp == "nore");
                if mp == "vanilla" {
                    i["perfPack"] = json!(false);
                }
                i["packInstalled"] = json!(false);
            } else if version_changed && is(i, "modpack", "nore") && !supports(&mc) {
                i["modpack"] = json!("fabric");
                i["noreClient"] = json!(false);
                i["perfPack"] = json!(true);
            }
            if has("perfPack") {
                i["packInstalled"] = json!(false);
            }
            if patch.get("perfMods") == Some(&json!(true)) {
                i["perfModsInstalled"] = json!(false);
            }
        })?;
        Ok(self.get(id).unwrap_or(Value::Null))
    }

    pub async fn remove(&self, id: &str, delete_files: bool) -> Result<()> {
        let inst = self.get(id);
        self.store.update(|d| {
            if let Some(l) = d.get_mut("instances").and_then(Value::as_array_mut) {
                l.retain(|x| x.str_of("id") != Some(id));
            }
            if d.str_of("selectedInstance") == Some(id) {
                let first = d["instances"].get(0).and_then(|i| i.get("id")).cloned().unwrap_or(Value::Null);
                d["selectedInstance"] = first;
            }
        })?;
        if let (Some(_), true) = (inst, delete_files) {
            let dir = self.game_dir(id);
            if dir.starts_with(self.paths.instances()) && !id.is_empty() && !id.contains("..") {
                let _ = tokio::fs::remove_dir_all(dir).await;
            }
        }
        Ok(())
    }

    /// The default "Nore Client" instance on first start.
    pub fn ensure_default(&self) -> Result<()> {
        if self.store.read(|d| d["instances"].as_array().is_some_and(|l| !l.is_empty())) {
            return Ok(());
        }
        self.create(&json!({ "name": "Nore Client", "mcVersion": NORE_MC_VERSION, "loader": "fabric", "noreClient": true, "color": 0 }))?;
        Ok(())
    }

    pub async fn worlds(&self, id: &str) -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(mut rd) = tokio::fs::read_dir(self.game_dir(id).join("saves")).await {
            while let Ok(Some(e)) = rd.next_entry().await {
                if e.file_type().await.is_ok_and(|t| t.is_dir()) {
                    out.push(e.file_name().to_string_lossy().to_string());
                }
            }
        }
        out.sort();
        out
    }

    pub async fn worlds_info(&self, id: &str) -> Vec<Value> {
        if self.get(id).is_none() {
            return vec![];
        }
        let mut out = Vec::new();
        for name in self.worlds(id).await {
            let wdir = self.game_dir(id).join("saves").join(&name);
            let mtime = tokio::fs::metadata(wdir.join("level.dat")).await.ok().and_then(|m| m.modified().ok()).map(mtime_ms).unwrap_or(0);
            let icon = tokio::fs::read(wdir.join("icon.png")).await.ok().map(|b| format!("data:image/png;base64,{}", B64.encode(b)));
            out.push(json!({ "name": name, "size": dir_size(&wdir).await, "lastPlayed": mtime, "icon": icon }));
        }
        out.sort_by_key(|w| std::cmp::Reverse(w.i64_of("lastPlayed")));
        out
    }

    pub async fn screenshots(&self, id: &str, limit: usize) -> Vec<Value> {
        if self.get(id).is_none() {
            return vec![];
        }
        let sdir = self.game_dir(id).join("screenshots");
        let mut files = Vec::new();
        if let Ok(mut rd) = tokio::fs::read_dir(&sdir).await {
            while let Ok(Some(e)) = rd.next_entry().await {
                let name = e.file_name().to_string_lossy().to_string();
                if name.to_lowercase().ends_with(".png") {
                    let t = e.metadata().await.ok().and_then(|m| m.modified().ok()).map(mtime_ms).unwrap_or(0);
                    files.push((name, t));
                }
            }
        }
        files.sort_by_key(|(_, t)| std::cmp::Reverse(*t));
        let mut out = Vec::new();
        for (name, t) in files.into_iter().take(limit) {
            let p = sdir.join(&name);
            let data = tokio::fs::read(&p).await.map(|b| format!("data:image/png;base64,{}", B64.encode(b))).unwrap_or_default();
            out.push(json!({ "name": name, "time": t, "path": p.to_string_lossy(), "data": data }));
        }
        out
    }
}

pub fn mtime_ms(t: std::time::SystemTime) -> i64 {
    t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Size of a file or folder (recursive, symlinks not followed).
pub async fn dir_size(p: &Path) -> u64 {
    let p = p.to_path_buf();
    tokio::task::spawn_blocking(move || {
        fn walk(p: &Path) -> u64 {
            let Ok(meta) = std::fs::symlink_metadata(p) else { return 0 };
            if !meta.is_dir() {
                return meta.len();
            }
            std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| walk(&e.path())).sum()).unwrap_or(0)
        }
        walk(&p)
    })
    .await
    .unwrap_or(0)
}

/// Copies a folder recursively (instance duplicate).
pub async fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    let (from, to) = (from.to_path_buf(), to.to_path_buf());
    tokio::task::spawn_blocking(move || -> Result<()> {
        fn walk(from: &Path, to: &Path) -> std::io::Result<()> {
            std::fs::create_dir_all(to)?;
            for e in std::fs::read_dir(from)? {
                let e = e?;
                let t = e.file_type()?;
                let dest = to.join(e.file_name());
                if t.is_dir() {
                    walk(&e.path(), &dest)?;
                } else if t.is_file() {
                    std::fs::copy(e.path(), dest)?;
                }
            }
            Ok(())
        }
        if from.exists() {
            walk(&from, &to)?;
        }
        Ok(())
    })
    .await
    .map_err(crate::error::wrap)?
}

/// Zips a folder (world backups) under `prefix/` inside the archive.
pub async fn zip_dir(src: &Path, prefix: &str, out: &Path) -> Result<()> {
    let (src, prefix, out) = (src.to_path_buf(), prefix.to_string(), out.to_path_buf());
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&out)?);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        fn walk(zip: &mut zip::ZipWriter<std::fs::File>, base: &Path, dir: &Path, prefix: &str, opts: zip::write::SimpleFileOptions) -> Result<()> {
            for e in std::fs::read_dir(dir)? {
                let e = e?;
                let p = e.path();
                let rel = p.strip_prefix(base).unwrap_or(&p).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                let name = format!("{prefix}/{rel}");
                if e.file_type()?.is_dir() {
                    zip.add_directory(format!("{name}/"), opts)?;
                    walk(zip, base, &p, prefix, opts)?;
                } else {
                    zip.start_file(name, opts)?;
                    std::io::copy(&mut std::fs::File::open(&p)?, zip)?;
                }
            }
            Ok(())
        }
        walk(&mut zip, &src, &src, &prefix, opts)?;
        zip.finish()?;
        Ok(())
    })
    .await
    .map_err(crate::error::wrap)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Store, Paths, NoreMods) {
        let dir = tempfile::tempdir().unwrap();
        let mods_dir = dir.path().join("mods");
        std::fs::create_dir_all(&mods_dir).unwrap();
        std::fs::write(mods_dir.join("noreclient-1.21.jar"), b"jar").unwrap();
        std::fs::write(mods_dir.join("index.json"), r#"[{"file":"noreclient-1.21.jar","versions":["1.21.1"]},{"file":"missing.jar","versions":["1.20.1"]}]"#)
            .unwrap();
        let mods = NoreMods::load(&[mods_dir]);
        (dir, Store::memory(json!({})), Paths::new("/tmp/nore-test-root"), mods)
    }

    #[test]
    fn slugs() {
        let s = slug("Mój Świat 2!");
        assert!(s.starts_with("m-j-wiat-2-"), "{s}");
        assert_eq!(s.len(), "m-j-wiat-2-".len() + 6);
        assert!(slug("ąę").starts_with("instancja-"));
    }

    #[test]
    fn bundled_jars() {
        let (_d, _s, _p, mods) = setup();
        assert_eq!(mods.versions(), vec!["1.21.1"]);
        assert!(mods.jar_for("1.21.1").unwrap().ends_with("noreclient-1.21.jar"));
        assert!(mods.jar_for("1.20.1").is_none());
    }

    #[test]
    fn create_follows_the_modpack_rules() {
        let (dir, store, _p, mods) = setup();
        let paths = Paths::new(dir.path());
        let inst = Instances { store: &store, paths: &paths, mods: &mods };
        let nore = inst.create(&json!({ "name": "Nore Client", "mcVersion": "1.21.1", "loader": "fabric", "noreClient": true })).unwrap();
        assert_eq!(
            (nore["modpack"].clone(), nore["noreClient"].clone(), nore["loader"].clone(), nore["perfMods"].clone()),
            (json!("nore"), json!(true), json!("fabric"), json!(true))
        );
        assert!(Path::new(nore["gameDir"].as_str().unwrap()).is_dir());
        // Nore Client does not support this version: plain Fabric with the performance pack
        let old = inst.create(&json!({ "name": "x", "mcVersion": "1.20.1", "loader": "fabric", "noreClient": true })).unwrap();
        assert_eq!((old["modpack"].clone(), old["perfPack"].clone(), old["noreClient"].clone()), (json!("fabric"), json!(true), json!(false)));
        let van = inst.create(&json!({ "name": "", "mcVersion": "1.8.9" })).unwrap();
        assert_eq!((van["loader"].clone(), van["name"].clone(), van.get("perfMods").cloned()), (json!("vanilla"), json!("1.8.9"), None));
        let forge = inst.create(&json!({ "name": "F", "mcVersion": "1.20.1", "loader": "forge", "modpack": "loader", "askPerf": true })).unwrap();
        assert_eq!((forge["loader"].clone(), forge.get("perfMods").cloned()), (json!("forge"), None));
        assert_eq!(store.read(|d| d["selectedInstance"].clone()), forge["id"]);
        assert_eq!(inst.list().len(), 4);
    }

    #[tokio::test]
    async fn update_resets_dependent_fields_and_remove() {
        let (dir, store, _p, mods) = setup();
        let paths = Paths::new(dir.path());
        let inst = Instances { store: &store, paths: &paths, mods: &mods };
        let a = inst.create(&json!({ "name": "A", "mcVersion": "1.21.1", "loader": "fabric", "noreClient": true })).unwrap();
        let id = a["id"].as_str().unwrap().to_string();
        inst.update(&id, &json!({ "loaderVersion": "0.16.5", "packInstalled": true })).unwrap();
        let b = inst.update(&id, &json!({ "mcVersion": "1.20.1" })).unwrap();
        assert_eq!(
            (b["loaderVersion"].clone(), b["packInstalled"].clone(), b["modpack"].clone(), b["noreClient"].clone(), b["perfPack"].clone()),
            (Value::Null, json!(false), json!("fabric"), json!(false), json!(true))
        );
        let c = inst.update(&id, &json!({ "modpack": "vanilla" })).unwrap();
        assert_eq!((c["loader"].clone(), c["perfPack"].clone()), (json!("vanilla"), json!(false)));
        let d = inst.update(&id, &json!({ "id": "hijack", "name": "B" })).unwrap();
        assert_eq!((d["id"].as_str().unwrap(), d["name"].clone()), (id.as_str(), json!("B")));
        inst.remove(&id, true).await.unwrap();
        assert!(inst.get(&id).is_none());
        assert!(!dir.path().join("instances").join(&id).exists());
        assert_eq!(store.read(|d| d["selectedInstance"].clone()), Value::Null);
    }

    #[tokio::test]
    async fn worlds_and_backup_zip() {
        let (dir, store, _p, mods) = setup();
        let paths = Paths::new(dir.path());
        let inst = Instances { store: &store, paths: &paths, mods: &mods };
        let a = inst.create(&json!({ "name": "W", "mcVersion": "1.21.1" })).unwrap();
        let id = a["id"].as_str().unwrap();
        let w = inst.game_dir(id).join("saves").join("Świat");
        std::fs::create_dir_all(w.join("region")).unwrap();
        std::fs::write(w.join("level.dat"), b"1234").unwrap();
        std::fs::write(w.join("region").join("r.0.0.mca"), b"abc").unwrap();
        assert_eq!(inst.worlds(id).await, vec!["Świat"]);
        let info = inst.worlds_info(id).await;
        assert_eq!(info[0]["size"], 7);
        let out = dir.path().join("b.zip");
        zip_dir(&w, "Świat", &out).await.unwrap();
        let z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
        let mut names: Vec<_> = z.file_names().map(String::from).collect();
        names.sort();
        assert_eq!(names, vec!["Świat/level.dat", "Świat/region/", "Świat/region/r.0.0.mca"]);
        let copy = dir.path().join("copy");
        copy_dir(&inst.game_dir(id), &copy).await.unwrap();
        assert_eq!(dir_size(&copy).await, 7);
    }
}
