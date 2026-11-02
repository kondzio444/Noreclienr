//! Importing instances from other launchers (port of launcher/src/main/importers.js): Prism
//! Launcher / MultiMC, the CurseForge app and the Modrinth App. The source stays untouched.

use crate::js::{number, ValueExt};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

fn read_json(file: &Path) -> Option<Value> {
    let t = std::fs::read_to_string(file).ok()?;
    serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()
}

/// key=value lines of MultiMC / Prism instance.cfg.
pub fn parse_cfg(text: &str) -> Map<String, Value> {
    let mut out = Map::new();
    for line in text.lines() {
        if let Some(i) = line.find('=') {
            if i > 0 && !line.starts_with('[') {
                out.insert(line[..i].trim().to_string(), json!(line[i + 1..].trim()));
            }
        }
    }
    out
}

/// mmc-pack.json → (mcVersion, loader, loaderVersion).
pub fn from_mmc_pack(pack: &Value) -> (Option<String>, String, Option<String>) {
    let comps = pack["components"].as_array().cloned().unwrap_or_default();
    let ver = |c: &Value| c.str_of("version").or(c.str_of("cachedVersion")).map(String::from);
    let mc = comps.iter().find(|c| c.str_of("uid") == Some("net.minecraft")).and_then(ver);
    for c in &comps {
        let l = match c.str_of("uid") {
            Some("net.fabricmc.fabric-loader") => "fabric",
            Some("org.quiltmc.quilt-loader") => "quilt",
            Some("net.minecraftforge") => "forge",
            Some("net.neoforged") => "neoforge",
            _ => continue,
        };
        return (mc, l.into(), ver(c));
    }
    (mc, "vanilla".into(), None)
}

/// "forge-47.2.0" / "fabric-0.15.7-1.20.1" → (loader, loaderVersion).
pub fn from_loader_name(name: &str, mc: &str) -> (String, Option<String>) {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(forge|neoforge|fabric|quilt)-(.+)$").unwrap());
    let Some(c) = R.captures(name) else { return ("vanilla".into(), None) };
    let mut v = c[2].to_string();
    if !mc.is_empty() {
        if let Some(s) = v.strip_suffix(&format!("-{mc}")) {
            v = s.to_string();
        }
        if let Some(s) = v.strip_prefix(&format!("{mc}-")) {
            v = s.to_string();
        }
    }
    (c[1].to_lowercase(), Some(v))
}

fn name_of(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// Recognises an instance folder of another launcher.
pub fn detect(dir: &Path) -> Option<Value> {
    let pack = read_json(&dir.join("mmc-pack.json"));
    let cfg_text = std::fs::read_to_string(dir.join("instance.cfg")).ok();
    if pack.is_some() || cfg_text.is_some() {
        let cfg = Value::Object(parse_cfg(cfg_text.as_deref().unwrap_or("")));
        let (mc, loader, lv) = match &pack {
            Some(p) => from_mmc_pack(p),
            None => (cfg.str_of("IntendedVersion").map(String::from), "vanilla".into(), None),
        };
        let game_dir = [".minecraft", "minecraft"].iter().map(|d| dir.join(d)).find(|d| d.exists()).unwrap_or_else(|| dir.join(".minecraft"));
        return Some(json!({
            "type": "prism", "label": "Prism Launcher / MultiMC", "name": cfg.str_of("name").map(String::from).unwrap_or_else(|| name_of(dir)), "mcVersion": mc, "loader": loader, "loaderVersion": lv,
            "gameDir": game_dir.to_string_lossy(),
            "memoryMb": if cfg.str_of("OverrideMemory") == Some("true") { cfg.str_of("MaxMemAlloc").and_then(crate::config_edit::parse_int).unwrap_or(0) } else { 0 },
            "jvmArgs": if cfg.str_of("OverrideJavaArgs") == Some("true") { cfg.string_or("JvmArgs", "") } else { String::new() },
        }));
    }
    if let Some(cf) = read_json(&dir.join("minecraftinstance.json")) {
        let mc = cf.str_of("gameVersion").filter(|s| !s.is_empty()).or(cf.pointer("/baseModLoader/minecraftVersion").and_then(Value::as_str)).map(String::from);
        if let Some(mc) = mc {
            let (loader, lv) = from_loader_name(cf.pointer("/baseModLoader/name").and_then(Value::as_str).unwrap_or(""), &mc);
            let mem = if cf.truthy_of("isMemoryOverride") || cf.truthy_of("allocatedMemory") { number(&cf["allocatedMemory"]) as i64 } else { 0 };
            return Some(json!({
                "type": "curseforge", "label": "CurseForge", "name": cf.str_of("name").map(String::from).unwrap_or_else(|| name_of(dir)), "mcVersion": mc,
                "loader": loader, "loaderVersion": lv, "gameDir": dir.to_string_lossy(), "memoryMb": mem, "jvmArgs": cf.string_or("javaArgsOverride", ""),
            }));
        }
    }
    if let Some(mr) = read_json(&dir.join("profile.json")) {
        let m = &mr["metadata"];
        if let Some(gv) = m.str_of("game_version") {
            let loader = m.str_of("loader").filter(|l| ["fabric", "quilt", "forge", "neoforge"].contains(l)).unwrap_or("vanilla");
            let lv = if loader == "vanilla" {
                Value::Null
            } else {
                m["loader_version"].get("id").cloned().or_else(|| m.get("loader_version").filter(|v| v.is_string()).cloned()).unwrap_or(Value::Null)
            };
            return Some(json!({
                "type": "modrinth", "label": "Modrinth App", "name": m.str_of("name").map(String::from).unwrap_or_else(|| name_of(dir)), "mcVersion": gv, "loader": loader,
                "loaderVersion": lv, "gameDir": dir.to_string_lossy(), "memoryMb": mr.pointer("/memory/maximum").cloned().unwrap_or(json!(0)), "jvmArgs": "",
            }));
        }
    }
    None
}

const SKIP: [&str; 15] = [
    "logs",
    "crash-reports",
    "natives",
    ".cache",
    ".fabric",
    "webcache",
    "webcache2",
    "downloads",
    ".mixin.out",
    "instance.cfg",
    "mmc-pack.json",
    "minecraftinstance.json",
    "profile.json",
    "patches",
    "libraries",
];

/// Copies the game folder of a detected instance into dest (nothing already there is overwritten).
pub async fn copy_game(found: &Value, dest: &Path, progress: &(dyn Fn(Value) + Send + Sync)) -> crate::Result<()> {
    let src = PathBuf::from(found.string_or("gameDir", ""));
    let names = crate::util::read_dir_names(&src);
    for (i, n) in names.iter().enumerate() {
        let l = n.to_lowercase();
        if SKIP.contains(&l.as_str()) || l == "icon.png" {
            continue;
        }
        progress(json!({ "stage": "Kopiowanie plików instancji", "current": n, "done": i + 1, "total": names.len() }));
        let (from, to) = (src.join(n), dest.join(n));
        crate::util::blocking(move || Ok(crate::util::copy_recursive(&from, &to, false)?)).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// curseforge.test.js: Prism / MultiMC, CurseForge app and Modrinth App instances are recognised.
    #[tokio::test]
    async fn recognised() {
        let d = tempfile::tempdir().unwrap();
        let prism = d.path().join("prism");
        std::fs::create_dir_all(prism.join(".minecraft/mods")).unwrap();
        std::fs::write(prism.join("instance.cfg"), "[General]\nname=Moja paczka\nOverrideMemory=true\nMaxMemAlloc=6144\n").unwrap();
        std::fs::write(
            prism.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.minecraftforge","version":"47.2.0"}]}"#,
        )
        .unwrap();
        std::fs::write(prism.join(".minecraft/mods/a.jar"), "a").unwrap();
        std::fs::write(prism.join(".minecraft/icon.png"), "i").unwrap();
        let p = detect(&prism).unwrap();
        assert_eq!(
            json!([p["type"], p["name"], p["mcVersion"], p["loader"], p["loaderVersion"], p["memoryMb"]]),
            json!(["prism", "Moja paczka", "1.20.1", "forge", "47.2.0", 6144])
        );
        let cf = d.path().join("cf");
        std::fs::create_dir_all(&cf).unwrap();
        std::fs::write(
            cf.join("minecraftinstance.json"),
            r#"{"name":"ATM","gameVersion":"1.21.1","baseModLoader":{"name":"neoforge-21.1.80","minecraftVersion":"1.21.1"},"allocatedMemory":8192}"#,
        )
        .unwrap();
        let c = detect(&cf).unwrap();
        assert_eq!(json!([c["type"], c["loader"], c["loaderVersion"], c["memoryMb"]]), json!(["curseforge", "neoforge", "21.1.80", 8192]));
        let mr = d.path().join("mr");
        std::fs::create_dir_all(&mr).unwrap();
        std::fs::write(mr.join("profile.json"), r#"{"metadata":{"name":"Fab","game_version":"1.21.1","loader":"fabric","loader_version":{"id":"0.16.9"}}}"#)
            .unwrap();
        let m = detect(&mr).unwrap();
        assert_eq!(json!([m["type"], m["loader"], m["loaderVersion"]]), json!(["modrinth", "fabric", "0.16.9"]));
        assert!(detect(d.path()).is_none());
        assert_eq!(from_loader_name("fabric-0.15.7-1.20.1", "1.20.1"), ("fabric".into(), Some("0.15.7".into())));
        let dest = d.path().join("dest");
        copy_game(&p, &dest, &|_| {}).await.unwrap();
        assert!(dest.join("mods/a.jar").exists() && !dest.join("icon.png").exists());
    }
}
