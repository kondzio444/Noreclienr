//! What is inside a mod / plugin jar (port of launcher/src/main/mod-meta.js): id, name, version,
//! loader, side, dependencies (fabric.mod.json, quilt.mod.json, mods.toml, mcmod.info, plugin.yml,
//! paper-plugin.yml, velocity-plugin.json, bungee.yml) and the analysis of a whole folder.

use crate::config_edit::parse_toml;
use crate::js::ValueExt;
use crate::util::{self, Zip};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

const BUILTIN: [&str; 15] = [
    "minecraft",
    "java",
    "fabricloader",
    "fabric-loader",
    "quilt_loader",
    "quilt-loader",
    "forge",
    "neoforge",
    "javafml",
    "lowcodefml",
    "mcp",
    "fml",
    "mixinextras",
    "mixin",
    "quilted_fabric_api_base",
];
const BUILTIN_PLUGINS: [&str; 8] = ["bukkit", "spigot", "paper", "purpur", "folia", "velocity", "bungeecord", "waterfall"];

fn side(env: &str) -> &'static str {
    match env {
        "client" => "client",
        "server" => "server",
        "*" | "both" => "both",
        _ => "unknown",
    }
}

fn as_list(v: &Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a.clone(),
        Value::String(s) if !s.is_empty() => vec![json!(s)],
        Value::Object(o) => o.keys().map(|k| json!(k)).collect(),
        _ => vec![],
    }
}

fn str_list(v: &Value) -> Vec<String> {
    as_list(v).iter().filter_map(|x| x.as_str().map(String::from)).collect()
}

fn unquote(s: &str) -> String {
    let s = s.strip_prefix(['\'', '"']).unwrap_or(s);
    s.strip_suffix(['\'', '"']).unwrap_or(s).to_string()
}

/// Tiny YAML reader for plugin.yml: top-level scalars and lists.
pub fn yaml_top(text: &str) -> Map<String, Value> {
    static TOP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([A-Za-z0-9_-]+):\s*(.*)$").unwrap());
    static CMT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+#.*$").unwrap());
    static LI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s+-\s*(.+)$").unwrap());
    static KM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\s+)([^:\s]+):\s*(.*)$").unwrap());
    let lines: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let mut out = Map::new();
    let mut i = 0;
    while i < lines.len() {
        let Some(m) = TOP.captures(lines[i]) else {
            i += 1;
            continue;
        };
        let raw = CMT.replace(&m[2], "").trim().to_string();
        let v = if raw.starts_with('[') {
            let inner = raw.trim_start_matches('[').trim_end_matches(']');
            Value::Array(inner.split(',').map(|s| unquote(s.trim())).filter(|s| !s.is_empty()).map(Value::String).collect())
        } else if raw.is_empty() || raw == "|" || raw == ">" {
            let mut list = Vec::new();
            let mut map = Map::new();
            while i + 1 < lines.len() && (lines[i + 1].is_empty() || lines[i + 1].starts_with([' ', '\t'])) {
                i += 1;
                let l = lines[i];
                if l.trim().is_empty() {
                    continue;
                }
                if let Some(li) = LI.captures(l) {
                    list.push(json!(unquote(li[1].trim())));
                } else if let Some(km) = KM.captures(l) {
                    map.insert(km[2].to_string(), json!({ "indent": km[1].len(), "value": km[3].trim() }));
                }
            }
            if !list.is_empty() {
                Value::Array(list)
            } else if !map.is_empty() {
                Value::Object(map)
            } else {
                json!("")
            }
        } else {
            json!(unquote(&raw))
        };
        out.insert(m[1].to_string(), v);
        i += 1;
    }
    out
}

/// paper-plugin.yml dependencies: `server: { Name: { required: … } }`.
pub fn paper_deps(text: &str) -> (Vec<String>, Vec<String>) {
    static L: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\s+)([^:\s]+):\s*(.*)$").unwrap());
    let (mut req, mut opt): (Vec<String>, Vec<String>) = (vec![], vec![]);
    let (mut in_deps, mut in_server, mut cur, mut base) = (false, false, None::<String>, 0usize);
    for l in text.lines() {
        if l.starts_with("dependencies:") {
            in_deps = true;
            continue;
        }
        if in_deps && l.chars().next().is_some_and(|c| !c.is_whitespace()) {
            in_deps = false;
            in_server = false;
        }
        if !in_deps {
            continue;
        }
        let Some(m) = L.captures(l) else { continue };
        let ind = m[1].len();
        if &m[2] == "server" || &m[2] == "bootstrap" {
            in_server = &m[2] == "server";
            base = ind;
            continue;
        }
        if !in_server {
            continue;
        }
        if ind == base + 2 || (ind > base && cur.is_none()) {
            cur = Some(m[2].to_string());
            req.push(m[2].to_string());
            continue;
        }
        if let Some(c) = &cur {
            if &m[2] == "required" && &m[3] == "false" {
                if let Some(p) = req.iter().position(|x| x == c) {
                    req.remove(p);
                }
                opt.push(c.clone());
            }
        }
    }
    (req, opt)
}

fn manifest_version(read: &mut dyn FnMut(&str) -> Option<String>) -> String {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^Implementation-Version:\s*(.+)$").unwrap());
    read("META-INF/MANIFEST.MF").and_then(|mf| R.captures(&mf).map(|c| c[1].trim().to_string())).unwrap_or_default()
}

fn clean_json(s: &str) -> Option<Value> {
    static CTRL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\x00-\x19]+").unwrap());
    serde_json::from_str(&CTRL.replace_all(s.trim_start_matches('\u{feff}'), " ")).ok()
}

fn s(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => crate::config_edit::js_string(other),
    }
}

/// `read(name)` → text of a jar entry. Returns the metadata or None.
pub fn parse_meta(read: &mut dyn FnMut(&str) -> Option<String>) -> Option<Value> {
    if let Some(j) = read("fabric.mod.json").and_then(|t| clean_json(&t)) {
        let mut optional = str_list(&j["recommends"]);
        optional.extend(str_list(&j["suggests"]));
        let mut breaks = str_list(&j["breaks"]);
        breaks.extend(str_list(&j["conflicts"]));
        let authors: Vec<String> = as_list(&j["authors"]).iter().filter_map(|a| a.as_str().map(String::from).or_else(|| a.str_of("name").map(String::from))).filter(|a| !a.is_empty()).collect();
        let provides: Vec<String> = as_list(&j["provides"]).iter().filter_map(|p| p.as_str().map(String::from).or_else(|| p.str_of("id").map(String::from))).collect();
        return Some(json!({
            "kind": "mod", "loader": "fabric", "id": j["id"], "name": j.get("name").filter(|v| v.as_str().is_some_and(|x| !x.is_empty())).unwrap_or(&j["id"]),
            "version": s(&j["version"]), "side": side(j.str_of("environment").unwrap_or("*")),
            "depends": str_list(&j["depends"]), "optional": optional, "breaks": breaks, "provides": provides,
            "description": j.string_or("description", ""), "authors": authors,
        }));
    }
    if let Some(j) = read("quilt.mod.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        let q = &j["quilt_loader"];
        let deps: Vec<Value> = q["depends"].as_array().cloned().unwrap_or_default().into_iter().map(|d| if d.is_string() { json!({ "id": d }) } else { d }).collect();
        let id_of = |d: &Value| d.as_str().map(String::from).or_else(|| d.str_of("id").map(String::from));
        return Some(json!({
            "kind": "mod", "loader": "quilt", "id": q["id"], "name": q.pointer("/metadata/name").cloned().filter(|v| !v.is_null()).unwrap_or(q["id"].clone()), "version": s(&q["version"]),
            "side": side(j.pointer("/minecraft/environment").and_then(Value::as_str).unwrap_or("*")),
            "depends": deps.iter().filter(|d| !d.truthy_of("optional")).map(|d| d["id"].clone()).collect::<Vec<_>>(),
            "optional": deps.iter().filter(|d| d.truthy_of("optional")).map(|d| d["id"].clone()).collect::<Vec<_>>(),
            "breaks": q["breaks"].as_array().into_iter().flatten().filter_map(id_of).collect::<Vec<_>>(),
            "provides": q["provides"].as_array().into_iter().flatten().filter_map(id_of).collect::<Vec<_>>(),
            "description": q.pointer("/metadata/description").and_then(Value::as_str).unwrap_or(""),
            "authors": q.pointer("/metadata/contributors").and_then(Value::as_object).map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
        }));
    }
    let neo = read("META-INF/neoforge.mods.toml");
    let is_neo = neo.is_some();
    if let Some(toml) = neo.or_else(|| read("META-INF/mods.toml")) {
        let (_, tables) = parse_toml(&toml);
        let mods: Vec<_> = tables.iter().filter(|t| t.name == "mods").collect();
        let empty = Map::new();
        let main = mods.first().map(|t| &t.values).unwrap_or(&empty);
        let id = main.get("modId").cloned().unwrap_or(Value::Null);
        let (mut depends, mut optional, mut breaks) = (vec![], vec![], vec![]);
        let (mut client_deps, mut server_deps) = (0, 0);
        for t in &tables {
            if !t.name.starts_with("dependencies.") || !t.array {
                continue;
            }
            let owner = t.name["dependencies.".len()..].trim_matches('"');
            if Some(owner) != id.as_str() {
                continue;
            }
            let v = &t.values;
            let Some(dep) = v.get("modId").and_then(Value::as_str).filter(|x| !x.is_empty()) else { continue };
            let ty = v.get("type").map(s).unwrap_or_else(|| if v.get("mandatory") == Some(&json!(false)) { "optional".into() } else { "required".into() }).to_lowercase();
            let sd = v.get("side").map(|x| s(x).to_uppercase()).unwrap_or_default();
            if sd == "CLIENT" {
                client_deps += 1;
            }
            if sd == "SERVER" {
                server_deps += 1;
            }
            match ty.as_str() {
                "required" => depends.push(dep.to_string()),
                "optional" => optional.push(dep.to_string()),
                "incompatible" => breaks.push(dep.to_string()),
                _ => {}
            }
        }
        let mut version = main.get("version").map(s).unwrap_or_default();
        if version.is_empty() || version.contains("${") {
            let mv = manifest_version(read);
            if !mv.is_empty() {
                version = mv;
            }
        }
        let client_only = main.get("clientSideOnly") == Some(&json!(true)) || tables[0].values.get("clientSideOnly") == Some(&json!(true));
        let sd = if client_only || (client_deps > 0 && server_deps == 0 && client_deps == depends.len()) { "client" } else { "unknown" };
        return Some(json!({
            "kind": "mod", "loader": if is_neo { "neoforge" } else { "forge" }, "id": id, "name": main.get("displayName").cloned().unwrap_or(id.clone()), "version": version,
            "side": sd, "depends": depends, "optional": optional, "breaks": breaks,
            "provides": mods.iter().skip(1).filter_map(|m| m.values.get("modId").cloned()).collect::<Vec<_>>(),
            "description": main.get("description").map(s).unwrap_or_default().trim(), "authors": main.get("authors").map(str_list).unwrap_or_default(),
        }));
    }
    if let Some(j) = read("mcmod.info").and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        let list = if j.is_array() { j.clone() } else { j["modList"].clone() };
        let m = list.get(0).cloned().unwrap_or(json!({}));
        return Some(json!({
            "kind": "mod", "loader": "forge", "id": m["modid"], "name": m.get("name").cloned().filter(|v| !v.is_null()).unwrap_or(m["modid"].clone()), "version": s(&m["version"]), "side": "unknown",
            "depends": str_list(&m["requiredMods"]).iter().map(|x| x.split('@').next().unwrap_or("").to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>(),
            "optional": [], "breaks": [], "provides": [], "description": m.string_or("description", ""), "authors": str_list(&m["authorList"]),
        }));
    }
    let paper = read("paper-plugin.yml");
    let plugin_yml = read("plugin.yml");
    if let Some(yml) = plugin_yml.clone().or(paper.clone()) {
        let y = Value::Object(yaml_top(&yml));
        let (depends, optional) = match (&paper, &plugin_yml) {
            (Some(p), None) => paper_deps(p),
            _ => (str_list(&y["depend"]), str_list(&y["softdepend"])),
        };
        let mut authors = str_list(&y["authors"]);
        if let Some(a) = y.str_of("author").filter(|a| !a.is_empty()) {
            authors.push(a.into());
        }
        return Some(json!({
            "kind": "plugin", "loader": if paper.is_some() { "paper" } else { "bukkit" }, "id": s(&y["name"]), "name": s(&y["name"]), "version": s(&y["version"]), "side": "server",
            "depends": depends, "optional": optional, "breaks": [], "provides": str_list(&y["provides"]),
            "description": y.str_of("description").unwrap_or(""), "authors": authors,
        }));
    }
    if let Some(j) = read("velocity-plugin.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        let deps = j["dependencies"].as_array().cloned().unwrap_or_default();
        return Some(json!({
            "kind": "plugin", "loader": "velocity", "id": j["id"], "name": j.get("name").cloned().filter(|v| !v.is_null()).unwrap_or(j["id"].clone()), "version": s(&j["version"]), "side": "server",
            "depends": deps.iter().filter(|d| !d.truthy_of("optional")).map(|d| d["id"].clone()).collect::<Vec<_>>(),
            "optional": deps.iter().filter(|d| d.truthy_of("optional")).map(|d| d["id"].clone()).collect::<Vec<_>>(),
            "breaks": [], "provides": [], "description": j.string_or("description", ""), "authors": j.get("authors").cloned().unwrap_or(json!([])),
        }));
    }
    if let Some(b) = read("bungee.yml") {
        let y = Value::Object(yaml_top(&b));
        return Some(json!({
            "kind": "plugin", "loader": "bungeecord", "id": s(&y["name"]), "name": s(&y["name"]), "version": s(&y["version"]), "side": "server",
            "depends": str_list(&y["depends"]), "optional": str_list(&y["softDepends"]), "breaks": [], "provides": [],
            "description": y.str_of("description").unwrap_or(""), "authors": y.str_of("author").filter(|a| !a.is_empty()).map(|a| vec![a.to_string()]).unwrap_or_default(),
        }));
    }
    None
}

/// Ids of mods bundled inside a jar (jar-in-jar) – they satisfy dependencies too.
fn nested_ids(zip: &mut Zip) -> Vec<String> {
    static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^META-INF/(jars|jarjar)/.+\.jar$").unwrap());
    let mut ids = Vec::new();
    for n in zip.names().into_iter().filter(|n| R.is_match(n)) {
        let Some(bytes) = zip.read(&n) else { continue };
        let Ok(mut inner) = Zip::from_bytes(bytes) else { continue };
        if let Some(m) = parse_meta(&mut |x| inner.text(x)) {
            if let Some(id) = m.str_of("id").filter(|s| !s.is_empty()) {
                ids.push(id.to_string());
                ids.extend(str_list(&m["provides"]));
            }
        }
    }
    ids
}

static CACHE: LazyLock<Mutex<HashMap<String, Option<Value>>>> = LazyLock::new(Mutex::default);

/// Reads one jar (cached by size + mtime). Returns the metadata (with `bundled` ids) or None.
pub fn read_jar(file: &Path) -> Option<Value> {
    let meta = std::fs::metadata(file).ok()?;
    let key = format!("{}|{}|{}", file.display(), meta.len(), util::mtime_ms(&meta));
    if let Some(m) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return m.clone();
    }
    let m = Zip::open(file).ok().and_then(|mut zip| {
        let mut m = parse_meta(&mut |n| zip.text(n))?;
        m["bundled"] = json!(nested_ids(&mut zip));
        Some(m)
    });
    CACHE.lock().unwrap_or_else(|e| e.into_inner()).insert(key, m.clone());
    m
}

fn norm(id: &str) -> String {
    id.to_lowercase()
}

/// Can a mod built for `mod_loader` run on `loader`?
pub fn loader_fits(mod_loader: &str, loader: &str) -> bool {
    mod_loader == loader
        || (loader == "quilt" && mod_loader == "fabric")
        || (loader == "neoforge" && mod_loader == "forge")
        || (["paper", "purpur", "folia"].contains(&loader) && ["bukkit", "paper"].contains(&mod_loader))
}

/// One jar of a folder for [`analyze`].
#[derive(Clone, Debug)]
pub struct ModFile {
    pub file: String,
    pub enabled: bool,
    pub size: u64,
    pub meta: Option<Value>,
}

/// Whole folder: who depends on whom, missing dependencies, conflicts, duplicates. Disabled mods
/// count as absent (a dependency on one is "missing – it is switched off").
pub fn analyze(mods: &[ModFile], server: bool, loader: Option<&str>) -> (Map<String, Value>, Vec<Value>) {
    let mut provided: HashMap<String, Vec<String>> = HashMap::new();
    let mut disabled: HashMap<String, Vec<String>> = HashMap::new();
    for m in mods {
        let Some(meta) = &m.meta else { continue };
        let Some(id) = meta.str_of("id").filter(|s| !s.is_empty()) else { continue };
        let mut ids = vec![id.to_string()];
        ids.extend(str_list(&meta["provides"]));
        ids.extend(str_list(&meta["bundled"]));
        for id in ids {
            let target = if m.enabled { &mut provided } else { &mut disabled };
            target.entry(norm(&id)).or_default().push(m.file.clone());
        }
    }
    let has_api = provided.contains_key("fabric-api") || provided.contains_key("fabric");
    let qsl = provided.contains_key("qsl") || provided.contains_key("quilted_fabric_api");
    let satisfied = |n: &str| {
        BUILTIN.contains(&n)
            || BUILTIN_PLUGINS.contains(&n)
            || provided.contains_key(n)
            || (has_api && (n.starts_with("fabric-") || n == "fabric"))
            || (qsl && (n.starts_with("quilt_") || n.starts_with("fabric-")))
    };
    let mut out: HashMap<String, (Vec<String>, Vec<Value>, Vec<String>)> = mods.iter().map(|m| (m.file.clone(), (vec![], vec![], vec![]))).collect();
    let mut warnings = Vec::new();
    for m in mods.iter().filter(|m| m.enabled) {
        let Some(meta) = &m.meta else { continue };
        let name = meta["name"].clone();
        for d in str_list(&meta["depends"]) {
            let n = norm(&d);
            if satisfied(&n) {
                for f in provided.get(&n).cloned().unwrap_or_default() {
                    if f != m.file {
                        let e = out.entry(f).or_default();
                        if !e.0.contains(&m.file) {
                            e.0.push(m.file.clone());
                        }
                    }
                }
                continue;
            }
            let off = disabled.get(&n).and_then(|l| l.first()).cloned();
            out.entry(m.file.clone()).or_default().1.push(json!({ "id": d, "disabled": off }));
            warnings.push(json!({ "type": "missing", "file": m.file, "name": name, "dep": d, "disabled": off }));
        }
        for b in str_list(&meta["breaks"]) {
            for f in provided.get(&norm(&b)).cloned().unwrap_or_default() {
                if f == m.file {
                    continue;
                }
                out.entry(m.file.clone()).or_default().2.push(f.clone());
                let e = out.entry(f.clone()).or_default();
                if !e.2.contains(&m.file) {
                    e.2.push(m.file.clone());
                }
                warnings.push(json!({ "type": "conflict", "file": m.file, "name": name, "other": f }));
            }
        }
        if server && meta.str_of("side") == Some("client") {
            warnings.push(json!({ "type": "client", "file": m.file, "name": name }));
        }
        if let (Some(l), Some("mod"), Some(ml)) = (loader, meta.str_of("kind"), meta.str_of("loader")) {
            if !loader_fits(ml, l) {
                warnings.push(json!({ "type": "loader", "file": m.file, "name": name, "loader": ml }));
            }
        }
    }
    let mut seen: HashMap<String, String> = HashMap::new();
    for m in mods.iter().filter(|m| m.enabled) {
        let Some(id) = m.meta.as_ref().and_then(|x| x.str_of("id")).filter(|s| !s.is_empty()) else { continue };
        let id = norm(id);
        match seen.get(&id).cloned() {
            Some(other) => {
                out.entry(m.file.clone()).or_default().2.push(other.clone());
                out.entry(other.clone()).or_default().2.push(m.file.clone());
                warnings.push(json!({ "type": "duplicate", "file": m.file, "name": m.meta.as_ref().map(|x| x["name"].clone()), "other": other }));
            }
            None => {
                seen.insert(id, m.file.clone());
            }
        }
    }
    let mut by_file = Map::new();
    for m in mods {
        let (dependents, missing, conflicts) = out.remove(&m.file).unwrap_or_default();
        by_file.insert(m.file.clone(), json!({ "dependents": dependents, "missing": missing, "conflicts": conflicts }));
    }
    let _ = HashSet::<()>::new();
    (by_file, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reader(files: Value) -> impl FnMut(&str) -> Option<String> {
        move |n: &str| match files.get(n) {
            None => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(v) => Some(v.to_string()),
        }
    }

    /// mods-servers.test.js: Fabric, Forge mods.toml with dependencies, plugin.yml and paper-plugin.yml.
    #[test]
    fn metadata() {
        let fab = parse_meta(&mut reader(json!({ "fabric.mod.json": { "id": "sodium", "name": "Sodium", "version": "0.6", "environment": "client", "depends": { "minecraft": "1.21", "fabric-api": "*" }, "breaks": { "optifabric": "*" } } }))).unwrap();
        assert_eq!(fab["side"], "client");
        assert_eq!(fab["depends"], json!(["minecraft", "fabric-api"]));
        assert_eq!(fab["breaks"], json!(["optifabric"]));
        let toml = [
            "modLoader=\"javafml\"", "loaderVersion=\"[47,)\"", "[[mods]]", "modId=\"create\"", "version=\"${file.jarVersion}\"", "displayName=\"Create\"",
            "[[dependencies.create]]", "modId=\"forge\"", "mandatory=true", "side=\"BOTH\"", "[[dependencies.create]]", "modId=\"flywheel\"", "mandatory=true", "side=\"BOTH\"",
            "[[dependencies.create]]", "modId=\"jei\"", "type=\"optional\"", "side=\"CLIENT\"", "[[dependencies.create]]", "modId=\"badmod\"", "type=\"incompatible\"",
        ]
        .join("\n");
        let forge = parse_meta(&mut reader(json!({ "META-INF/mods.toml": toml, "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nImplementation-Version: 0.5.1f\n" }))).unwrap();
        assert_eq!(forge["id"], "create");
        assert_eq!(forge["version"], "0.5.1f");
        assert_eq!(forge["depends"], json!(["forge", "flywheel"]));
        assert_eq!(forge["optional"], json!(["jei"]));
        assert_eq!(forge["breaks"], json!(["badmod"]));
        let neo = parse_meta(&mut reader(json!({ "META-INF/neoforge.mods.toml": "[[mods]]\nmodId=\"x\"\nversion=\"1\"\n" }))).unwrap();
        assert_eq!(neo["loader"], "neoforge");
        let pl = parse_meta(&mut reader(json!({ "plugin.yml": "name: Essentials\nversion: 2.20\ndepend: [Vault]\nsoftdepend:\n  - LuckPerms\n  - WorldGuard\nauthor: md_5\n" }))).unwrap();
        assert_eq!(json!([pl["kind"], pl["id"], pl["version"], pl["depends"], pl["optional"]]), json!(["plugin", "Essentials", "2.20", ["Vault"], ["LuckPerms", "WorldGuard"]]));
        let pp = parse_meta(&mut reader(json!({ "paper-plugin.yml": "name: Shop\nversion: 1\ndependencies:\n  server:\n    Vault:\n      load: BEFORE\n      required: true\n    PlaceholderAPI:\n      required: false\n" }))).unwrap();
        assert_eq!(json!([pp["depends"], pp["optional"]]), json!([["Vault"], ["PlaceholderAPI"]]));
        assert!(parse_meta(&mut reader(json!({}))).is_none());
    }

    fn m(file: &str, id: &str, extra: Value, enabled: bool) -> ModFile {
        let mut meta = json!({ "kind": "mod", "loader": "fabric", "id": id, "name": id, "side": "both", "depends": [], "breaks": [], "provides": [] });
        crate::js::assign(&mut meta, &extra);
        ModFile { file: file.into(), enabled, size: 0, meta: Some(meta) }
    }

    /// mods-servers.test.js: dependents, missing (also "switched off"), conflicts, duplicates, client-only on servers.
    #[test]
    fn analysis() {
        let mods = vec![
            m("api.jar", "fabric-api", json!({ "bundled": ["fabric-api-base"] }), true),
            m("a.jar", "a", json!({ "depends": ["fabric-api", "fabric-networking-api-v1", "b", "minecraft"] }), true),
            m("b.jar.disabled", "b", json!({}), false),
            m("c.jar", "c", json!({ "depends": ["nothere"], "breaks": ["a"] }), true),
            m("d1.jar", "d", json!({}), true),
            m("d2.jar", "d", json!({}), true),
            m("s.jar", "sodium", json!({ "side": "client" }), true),
        ];
        let (by, warnings) = analyze(&mods, true, Some("fabric"));
        assert_eq!(by["api.jar"]["dependents"], json!(["a.jar"]));
        assert_eq!(by["a.jar"]["missing"], json!([{ "id": "b", "disabled": "b.jar.disabled" }]));
        assert_eq!(by["c.jar"]["missing"], json!([{ "id": "nothere", "disabled": null }]));
        assert!(by["a.jar"]["conflicts"].as_array().unwrap().contains(&json!("c.jar")));
        assert!(by["d1.jar"]["conflicts"].as_array().unwrap().contains(&json!("d2.jar")));
        let mut types: Vec<&str> = warnings.iter().map(|w| w["type"].as_str().unwrap()).collect();
        types.sort();
        assert_eq!(types, vec!["client", "conflict", "duplicate", "missing", "missing"]);
        assert!(loader_fits("fabric", "quilt") && !loader_fits("forge", "fabric"));
    }
}
