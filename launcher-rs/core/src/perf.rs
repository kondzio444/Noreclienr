//! Performance mods for every modded instance (port of launcher/src/main/perf.js): what the pack
//! already has is detected by mod id and file name, known conflicts are respected, exact versions
//! come from Modrinth with their dependencies and every added file is recorded in the instance
//! (`perfAdded`). Planning ([`plan_perf_mods`], [`blame_perf`]) is pure and tested.

use crate::error::Result;
use crate::instances::Instances;
use crate::js::{now_ms, truthy, ValueExt};
use crate::util::{self, Zip};
use crate::{loaders, modrinth, Env};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

pub const CATALOG_VERSION: u32 = 2;

pub struct Entry {
    pub slug: &'static str,
    pub title: &'static str,
    pub group: Option<&'static str>,
    pub ids: &'static [&'static str],
    pub loaders: &'static [&'static str],
    pub conflicts: &'static [&'static str],
    pub why: &'static str,
    pub pkg: &'static [&'static str],
}

const ALL: &[&str] = &["fabric", "quilt", "forge", "neoforge"];
const FQN: &[&str] = &["fabric", "quilt", "neoforge"];
const FQ: &[&str] = &["fabric", "quilt"];

pub const CATALOG: &[Entry] = &[
    Entry { slug: "sodium", title: "Sodium", group: Some("renderer"), ids: &["sodium"], loaders: FQN, conflicts: &[], why: "Nowy silnik renderowania – zwykle kilka razy więcej FPS", pkg: &["me.jellysquid.mods.sodium", "net.caffeinemc.mods.sodium"] },
    Entry { slug: "embeddium", title: "Embeddium", group: Some("renderer"), ids: &["embeddium", "rubidium"], loaders: &["forge", "neoforge"], conflicts: &[], why: "Sodium dla Forge / NeoForge – dużo więcej FPS", pkg: &["org.embeddedt.embeddium"] },
    Entry { slug: "lithium", title: "Lithium", group: None, ids: &["lithium"], loaders: FQN, conflicts: &["canary", "radium", "roadrunner"], why: "Szybsza logika gry: mniej lagów z mobami, redstone i chunkami", pkg: &["me.jellysquid.mods.lithium", "net.caffeinemc.mods.lithium"] },
    Entry { slug: "ferrite-core", title: "FerriteCore", group: None, ids: &["ferritecore"], loaders: ALL, conflicts: &[], why: "Mniejsze zużycie RAM – mniej przycięć od GC", pkg: &["malte0811.ferritecore"] },
    Entry { slug: "modernfix", title: "ModernFix", group: None, ids: &["modernfix"], loaders: ALL, conflicts: &[], why: "Szybszy start i mniej RAM w dużych paczkach", pkg: &["org.embeddedt.modernfix"] },
    Entry { slug: "entityculling", title: "EntityCulling", group: None, ids: &["entityculling"], loaders: ALL, conflicts: &["optifine", "vulkanmod"], why: "Nie rysuje mobów i skrzyń za ścianami – więcej FPS na serwerach", pkg: &["dev.tr7zw.entityculling"] },
    Entry { slug: "immediatelyfast", title: "ImmediatelyFast", group: None, ids: &["immediatelyfast"], loaders: ALL, conflicts: &["optifine", "vulkanmod"], why: "Szybsze rysowanie HUD, tekstu i mobów", pkg: &["net.raphimc.immediatelyfast"] },
    Entry { slug: "krypton", title: "Krypton", group: None, ids: &["krypton"], loaders: FQ, conflicts: &["viafabricplus", "viafabric", "raknetify", "nochatreports_krypton"], why: "Lżejszy stos sieciowy – mniej lagów na serwerach", pkg: &["me.steinborn.krypton"] },
    Entry { slug: "moreculling", title: "MoreCulling", group: None, ids: &["moreculling"], loaders: FQ, conflicts: &["optifine", "vulkanmod", "cullleaves"], why: "Pomija niewidoczne ściany bloków i liście", pkg: &["ca.fxco.moreculling"] },
    Entry { slug: "dynamic-fps", title: "Dynamic FPS", group: None, ids: &["dynamic_fps", "dynamicfps"], loaders: ALL, conflicts: &[], why: "Mniej FPS w tle i na pauzie – chłodniejszy komputer, płynniej w innych programach", pkg: &["dynamic_fps.impl", "juliand665.dynamicfps"] },
    Entry { slug: "badoptimizations", title: "BadOptimizations", group: None, ids: &["badoptimizations"], loaders: ALL, conflicts: &["optifine"], why: "Drobne optymalizacje świateł, nieba i mgły", pkg: &["me.thosea.badoptimizations"] },
];

pub const RENDERERS: [&str; 10] = ["sodium", "embeddium", "rubidium", "magnesium", "xenon", "optifine", "optifabric", "canvas", "vulkanmod", "bendyrenderer"];

pub fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

/// A jar of mods/ with its mod ids.
#[derive(Clone, Debug, PartialEq)]
pub struct Present {
    pub file: String,
    pub ids: Vec<String>,
    pub enabled: bool,
}

/// File-name tokens of jars without mod metadata (OptiFine is a plain jar).
pub fn file_tokens(file: &str) -> Vec<String> {
    static HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([a-z][a-z_\-]*?)(?:[-_ ]?(?:fabric|forge|neoforge|quilt|mc)?[-_ ]?\d|$)").unwrap());
    let lower = file.to_lowercase();
    let base = lower.strip_suffix(".disabled").unwrap_or(&lower);
    let base = base.strip_suffix(".jar").unwrap_or(base);
    let mut out = Vec::new();
    if base.contains("optifine") {
        out.push("optifine".into());
    }
    if base.contains("optifabric") {
        out.push("optifabric".into());
    }
    if let Some(c) = HEAD.captures(base) {
        if !c[1].is_empty() {
            out.push(c[1].to_string());
        }
    }
    out
}

pub fn present_set(present: &[Present]) -> HashSet<String> {
    let mut set = HashSet::new();
    for m in present {
        set.extend(m.ids.iter().map(|i| norm(i)));
        set.extend(file_tokens(&m.file).iter().map(|t| norm(t)));
    }
    set
}

fn disabled_set(present: &[Present]) -> HashSet<String> {
    let off: Vec<Present> = present.iter().filter(|m| !m.enabled).cloned().collect();
    present_set(&off)
}

/// A mod we added before.
#[derive(Clone, Debug, Default)]
pub struct Own {
    pub slug: String,
    pub file: String,
}

#[derive(Debug, Default)]
pub struct Plan {
    pub add: Vec<Value>,
    pub keep: Vec<String>,
    pub skip: Vec<Value>,
    pub drop: Vec<Value>,
}

/// Decides which performance mods to add (see perf.js planPerfMods).
pub fn plan_perf_mods(loader: &str, present: &[Present], own: &[Own], blocked: &[String], removed: &[String]) -> Plan {
    let mut out = Plan::default();
    if loader.is_empty() || loader == "vanilla" {
        return out;
    }
    let have = present_set(present);
    let off = disabled_set(present);
    let own_by: HashMap<&str, &Own> = own.iter().map(|o| (o.slug.as_str(), o)).collect();
    let has = |ids: &[&str]| ids.iter().any(|id| have.contains(&norm(id)));
    let renderer_taken = RENDERERS.iter().any(|r| have.contains(&norm(r))) || (have.contains("iris") && !have.contains("sodium")) || have.contains("oculus");
    let iris = have.contains("iris") || have.contains("oculus");
    for c in CATALOG {
        if !c.loaders.contains(&loader) {
            continue;
        }
        let mine = own_by.get(c.slug);
        if has(c.ids) {
            match mine {
                Some(m) => out.drop.push(json!({ "slug": c.slug, "file": m.file, "reason": "jest już w paczce" })),
                None => {
                    let reason = if c.ids.iter().any(|id| off.contains(&norm(id))) { "wyłączony przez gracza" } else { "już jest w paczce" };
                    out.skip.push(json!({ "slug": c.slug, "title": c.title, "reason": reason }));
                }
            }
            continue;
        }
        if blocked.iter().any(|b| b == c.slug) {
            if let Some(m) = mine {
                out.drop.push(json!({ "slug": c.slug, "file": m.file, "reason": "wyłączony po crashu" }));
            }
            out.skip.push(json!({ "slug": c.slug, "title": c.title, "reason": "zabrany po crashu gry" }));
            continue;
        }
        if removed.iter().any(|r| r == c.slug) && mine.is_none() {
            out.skip.push(json!({ "slug": c.slug, "title": c.title, "reason": "usunięty przez gracza" }));
            continue;
        }
        if let Some(conflict) = c.conflicts.iter().find(|id| have.contains(&norm(id))) {
            if let Some(m) = mine {
                out.drop.push(json!({ "slug": c.slug, "file": m.file, "reason": format!("konflikt z {conflict}") }));
            }
            out.skip.push(json!({ "slug": c.slug, "title": c.title, "reason": format!("konflikt z {conflict}") }));
            continue;
        }
        if c.group == Some("renderer") && renderer_taken {
            if mine.is_some() {
                out.keep.push(c.slug.into());
            } else {
                let reason = if iris { "shadery z własnym Sodium / Embeddium" } else { "paczka ma inny silnik renderowania" };
                out.skip.push(json!({ "slug": c.slug, "title": c.title, "reason": reason }));
            }
            continue;
        }
        if mine.is_some() {
            out.keep.push(c.slug.into());
            continue;
        }
        out.add.push(json!({ "slug": c.slug, "title": c.title, "why": c.why, "group": c.group }));
    }
    if CATALOG.iter().any(|c| c.group == Some("renderer") && out.keep.iter().any(|k| k == c.slug)) {
        out.add.retain(|a| a.str_of("group") != Some("renderer"));
    }
    out
}

/// Which of our added mods a crash points at (mixin failures or the top frames of an exception).
pub fn blame_perf(lines: &[String], own: &[Own]) -> Vec<String> {
    static EXC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(Exception|Error)\b|Caused by:").unwrap());
    static AT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*at ").unwrap());
    let slugs: HashSet<&str> = own.iter().map(|o| o.slug.as_str()).collect();
    let mut top: Vec<&str> = Vec::new();
    for i in 0..lines.len() {
        if !EXC.is_match(&lines[i]) || AT.is_match(&lines[i]) {
            continue;
        }
        let mut n = 0;
        for l in lines.iter().skip(i + 1) {
            if n >= 6 {
                break;
            }
            if !AT.is_match(l) {
                if n > 0 {
                    break;
                }
                continue;
            }
            top.push(l);
            n += 1;
        }
    }
    let mut out = Vec::new();
    for c in CATALOG {
        if !slugs.contains(c.slug) {
            continue;
        }
        let ids: Vec<String> = c.ids.iter().map(|id| id.chars().filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_').collect()).collect();
        let alt = ids.join("|");
        let mixin = Regex::new(&format!(r"(?i)(Mixin apply(?: for mod)? ({alt}) failed|\b({alt})[\w.-]*\.mixins\.json[^\n]*(fail|error|exception))")).unwrap();
        if lines.iter().any(|l| mixin.is_match(l)) {
            out.push(c.slug.to_string());
            continue;
        }
        if top.iter().any(|l| c.pkg.iter().any(|p| l.contains(&format!("at {p}.")) || l.contains(&format!("/{p}.")))) {
            out.push(c.slug.to_string());
        }
    }
    out
}

/// Mod ids of a jar (fabric / quilt / forge / neoforge metadata).
pub fn jar_ids(file: &Path) -> Vec<String> {
    static CTRL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\x00-\x1f]+").unwrap());
    static MODID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^\s*modId\s*=\s*["']([^"']+)["']"#).unwrap());
    let mut ids: Vec<String> = Vec::new();
    let Ok(mut zip) = Zip::open(file) else { return ids };
    if let Some(f) = zip.text("fabric.mod.json") {
        if let Ok(j) = serde_json::from_str::<Value>(&CTRL.replace_all(f.trim_start_matches('\u{feff}'), " ")) {
            if let Some(id) = j.str_of("id") {
                ids.push(id.into());
            }
            let provides = match &j["provides"] {
                Value::Array(a) => a.clone(),
                Value::Null => vec![],
                v => vec![v.clone()],
            };
            for p in provides {
                if let Some(s) = p.as_str().map(String::from).or_else(|| p.str_of("id").map(String::from)) {
                    ids.push(s);
                }
            }
        }
    }
    if let Some(q) = zip.text("quilt.mod.json") {
        if let Some(id) = serde_json::from_str::<Value>(&q).ok().and_then(|j| j["quilt_loader"].str_of("id").map(String::from)) {
            ids.push(id);
        }
    }
    for n in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
        if let Some(t) = zip.text(n) {
            ids.extend(MODID.captures_iter(&t).map(|c| c[1].to_string()));
        }
    }
    let mut out: Vec<String> = Vec::new();
    for id in ids.into_iter().filter(|s| !s.is_empty()).map(|s| s.to_lowercase()) {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

static IDS: LazyLock<Mutex<HashMap<String, Vec<String>>>> = LazyLock::new(Mutex::default);

/// Every jar in mods/ (switched off ones too) with its mod ids.
pub async fn scan(mods_dir: &Path) -> Vec<Present> {
    let dir = mods_dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        static JAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.jar(\.disabled)?$").unwrap());
        let mut out = Vec::new();
        for file in util::read_dir_names(&dir) {
            if !JAR.is_match(&file) {
                continue;
            }
            let full = dir.join(&file);
            let Ok(meta) = std::fs::metadata(&full) else { continue };
            if !meta.is_file() {
                continue;
            }
            let k = format!("{}|{}|{}", full.display(), meta.len(), util::mtime_ms(&meta));
            let cached = IDS.lock().unwrap_or_else(|e| e.into_inner()).get(&k).cloned();
            let ids = match cached {
                Some(i) => i,
                None => {
                    let i = jar_ids(&full);
                    IDS.lock().unwrap_or_else(|e| e.into_inner()).insert(k, i.clone());
                    i
                }
            };
            out.push(Present { enabled: !file.ends_with(".disabled"), file, ids });
        }
        out
    })
    .await
    .unwrap_or_default()
}

/// Version of a project for Minecraft + loader: newest release, else newest beta (never alpha).
async fn best_version(env: &Env, project: &str, mc: &str, loader: &str) -> Result<Option<Value>> {
    let url = modrinth::with_params(
        &format!("{}/project/{}/version", modrinth::API, urlencoding::encode(project)),
        &[("game_versions", serde_json::to_string(&[mc]).unwrap_or_default()), ("loaders", serde_json::to_string(&loaders::mod_loaders(loader)).unwrap_or_default())],
    );
    let list: Vec<Value> = match env.net.get_json(&url).await {
        Ok(l) => l,
        Err(crate::Error::Status { status: 404, .. }) => vec![],
        Err(e) => return Err(e),
    };
    Ok(list.iter().find(|v| v.str_of("version_type") == Some("release")).or_else(|| list.iter().find(|v| v.str_of("version_type") == Some("beta"))).cloned())
}

pub struct Resolved {
    pub files: Vec<Value>,
    pub missing: Vec<Value>,
    pub errors: usize,
}

/// Turns a plan into files to download with required dependencies the instance does not have.
pub async fn resolve(env: &Env, plan: &Plan, mc: &str, loader: &str, present: &[Present]) -> Resolved {
    let have = present_set(present);
    let mut r = Resolved { files: vec![], missing: vec![], errors: 0 };
    let mut done_groups: HashSet<String> = HashSet::new();
    let mut seen: HashSet<String> = HashSet::new();
    for a in &plan.add {
        let group = a.str_of("group").map(String::from);
        if group.as_ref().is_some_and(|g| done_groups.contains(g)) {
            continue;
        }
        let slug = a.string_or("slug", "");
        let v = match best_version(env, &slug, mc, loader).await {
            Ok(v) => v,
            Err(_) => {
                r.errors += 1;
                break;
            }
        };
        let Some((v, f)) = v.and_then(|v| modrinth::primary_file(&v).cloned().map(|f| (v, f))) else {
            if group.is_none() {
                r.missing.push(json!({ "slug": slug, "title": a["title"] }));
            }
            continue;
        };
        if let Some(g) = &group {
            done_groups.insert(g.clone());
        }
        seen.insert(v.string_or("project_id", ""));
        r.files.push(json!({ "slug": slug, "title": a["title"], "why": a["why"], "version": v["version_number"], "versionId": v["id"], "projectId": v["project_id"], "file": f["filename"], "url": f["url"], "sha1": f["hashes"]["sha1"], "size": f["size"] }));
        add_deps(env, &v, &slug, 0, mc, loader, &have, &mut seen, &mut r).await;
    }
    if r.errors == 0 {
        for a in &plan.add {
            if let Some(g) = a.str_of("group") {
                if !done_groups.contains(g) && !r.missing.iter().any(|m| m.str_of("slug") == Some(g)) {
                    r.missing.push(json!({ "slug": g, "title": "Sodium / Embeddium" }));
                }
            }
        }
    }
    r
}

#[allow(clippy::too_many_arguments)]
fn add_deps<'a>(env: &'a Env, v: &'a Value, for_slug: &'a str, depth: u32, mc: &'a str, loader: &'a str, have: &'a HashSet<String>, seen: &'a mut HashSet<String>, r: &'a mut Resolved) -> futures::future::BoxFuture<'a, ()> {
    Box::pin(async move {
        for d in v["dependencies"].as_array().cloned().unwrap_or_default() {
            let Some(pid) = d.str_of("project_id").filter(|_| d.str_of("dependency_type") == Some("required")).map(String::from) else { continue };
            if !seen.insert(pid.clone()) {
                continue;
            }
            let Ok(proj) = modrinth::project(env, &pid).await else {
                r.errors += 1;
                continue;
            };
            let n = norm(proj.str_of("slug").unwrap_or(""));
            if have.contains(&n) || have.contains(n.strip_suffix("api").unwrap_or(&n)) {
                continue;
            }
            let dv = match d.str_of("version_id") {
                Some(vid) => env.net.get_json::<Value>(&format!("{}/version/{}", modrinth::API, urlencoding::encode(vid))).await.map(Some),
                None => best_version(env, &pid, mc, loader).await,
            };
            let dv = match dv {
                Ok(Some(dv)) => dv,
                Ok(None) => continue,
                Err(_) => {
                    r.errors += 1;
                    continue;
                }
            };
            let Some(f) = modrinth::primary_file(&dv).cloned() else { continue };
            r.files.push(json!({ "slug": proj["slug"], "title": proj["title"], "version": dv["version_number"], "versionId": dv["id"], "projectId": pid, "file": f["filename"], "url": f["url"], "sha1": f["hashes"]["sha1"], "size": f["size"], "dep": for_slug }));
            if depth < 2 {
                add_deps(env, &dv, for_slug, depth + 1, mc, loader, have, seen, r).await;
            }
        }
    })
}

/// Is the performance set on for this instance? (Nore Client instances had it on by default.)
pub fn enabled_for(inst: &Value) -> bool {
    let loader = inst.str_of("loader").unwrap_or("");
    if loader.is_empty() || loader == "vanilla" {
        return false;
    }
    match inst.get("perfMods") {
        Some(Value::Bool(b)) => *b,
        _ => inst.truthy_of("noreClient"),
    }
}

pub fn state_key(inst: &Value) -> String {
    let pack = inst.get("pack").map(|p| p.get("versionId").filter(|v| truthy(v)).or(p.get("version")).map(crate::config_edit::js_string).unwrap_or_default()).unwrap_or_default();
    let pack = if pack == "null" { String::new() } else { pack };
    format!("{CATALOG_VERSION}|{}|{}|{pack}", inst.string_or("mcVersion", ""), inst.string_or("loader", ""))
}

pub fn title_of(slug: &str) -> String {
    CATALOG.iter().find(|c| c.slug == slug).map_or(slug.to_string(), |c| c.title.to_string())
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect()
}

pub struct Preview {
    pub plan: Plan,
    pub files: Vec<Value>,
    pub missing: Vec<Value>,
    pub errors: usize,
    pub own: Vec<Value>,
    pub stale: Vec<Value>,
}

fn same_target(inst: &Value) -> bool {
    inst.pointer("/perfFor/mc").and_then(Value::as_str) == inst.str_of("mcVersion") && inst.pointer("/perfFor/loader").and_then(Value::as_str) == inst.str_of("loader") && inst.get("perfFor").is_some_and(truthy)
}

/// What would change in this instance (the "Optymalizuj" preview and ensure).
pub async fn preview(env: &Env, inst: &Value) -> Preview {
    let mods_dir = PathBuf::from(inst.string_or("gameDir", "")).join("mods");
    let all = scan(&mods_dir).await;
    let mut own: Vec<Value> = inst["perfAdded"].as_array().into_iter().flatten().filter(|o| all.iter().any(|m| m.file == o.string_or("file", "") || m.file == format!("{}.disabled", o.string_or("file", "")))).cloned().collect();
    let same = same_target(inst);
    let stale = if same { vec![] } else { std::mem::take(&mut own) };
    let own_files: HashSet<String> = own.iter().chain(stale.iter()).flat_map(|o| [o.string_or("file", ""), format!("{}.disabled", o.string_or("file", ""))]).collect();
    let present: Vec<Present> = all.iter().filter(|m| !own_files.contains(&m.file)).cloned().collect();
    let own_plain: Vec<Own> = own.iter().filter(|o| !o.truthy_of("dep")).map(|o| Own { slug: o.string_or("slug", ""), file: o.string_or("file", "") }).collect();
    let plan = plan_perf_mods(inst.str_of("loader").unwrap_or(""), &present, &own_plain, &strings(&inst["perfBlocked"]), &strings(&inst["perfRemoved"]));
    let for_resolve: Vec<Present> = all.iter().filter(|m| !own_files.contains(&m.file) || own.iter().any(|o| o.str_of("file") == Some(&m.file))).cloned().collect();
    let r = resolve(env, &plan, inst.str_of("mcVersion").unwrap_or(""), inst.str_of("loader").unwrap_or(""), &for_resolve).await;
    Preview { plan, files: r.files, missing: r.missing, errors: r.errors, own, stale }
}

/// Brings the performance mods in line with the plan (cheap when nothing changed – no network).
/// Returns `{ added, removed, skipped, missing }` or None when skipped.
pub async fn ensure(env: &Env, insts: &Instances<'_>, id: &str, force: bool, progress: &(dyn Fn(Value) + Send + Sync), log: &(dyn Fn(String) + Send + Sync)) -> Result<Option<Value>> {
    let Some(mut inst) = insts.get(id) else { return Ok(None) };
    if !enabled_for(&inst) {
        return Ok(None);
    }
    let mods_dir = PathBuf::from(inst.string_or("gameDir", "")).join("mods");
    let key = state_key(&inst);
    let recorded: Vec<Value> = inst["perfAdded"].as_array().cloned().unwrap_or_default();
    let there = |o: &Value| {
        let f = o.string_or("file", "");
        mods_dir.join(&f).exists() || mods_dir.join(format!("{f}.disabled")).exists()
    };
    if !force && inst.str_of("perfKey") == Some(&key) && recorded.iter().all(there) {
        return Ok(None);
    }
    let gone: Vec<String> = if same_target(&inst) { recorded.iter().filter(|o| !o.truthy_of("dep") && !there(o)).map(|o| o.string_or("slug", "")).collect() } else { vec![] };
    if force || !gone.is_empty() {
        let removed_now: Vec<String> = if force {
            vec![]
        } else {
            let mut v = strings(&inst["perfRemoved"]);
            for g in gone {
                if !v.contains(&g) {
                    v.push(g);
                }
            }
            v
        };
        inst = insts.update(id, &json!({ "perfRemoved": removed_now }))?;
    }
    progress(json!({ "stage": "Mody wydajności: sprawdzanie paczki", "step": "nore" }));
    // offline: do not hold the start up with retries – the check runs again next time
    let online = tokio::time::timeout(std::time::Duration::from_secs(4), env.net.client().get("https://api.modrinth.com/").send()).await;
    if !matches!(online, Ok(Ok(ref r)) if r.status().is_success()) {
        log("[Launcher] Mody wydajności: Modrinth niedostępny – sprawdzę przy następnym starcie.".into());
        return Ok(None);
    }
    let p = preview(env, &inst).await;
    let mut removed: Vec<Value> = Vec::new();
    let rm = |file: &str, reason: &str, removed: &mut Vec<Value>| {
        for f in [file.to_string(), format!("{file}.disabled")] {
            if mods_dir.join(&f).exists() && std::fs::remove_file(mods_dir.join(&f)).is_ok() {
                removed.push(json!({ "file": f, "reason": reason }));
            }
        }
    };
    for o in &p.stale {
        rm(&o.string_or("file", ""), "inna wersja gry", &mut removed);
    }
    let drop_slugs: HashSet<String> = p.plan.drop.iter().map(|d| d.string_or("slug", "")).collect();
    for d in &p.plan.drop {
        rm(&d.string_or("file", ""), d.str_of("reason").unwrap_or(""), &mut removed);
    }
    for o in &p.own {
        if o.str_of("dep").is_some_and(|d| drop_slugs.contains(d)) {
            rm(&o.string_or("file", ""), "zależność usuniętego moda", &mut removed);
        }
    }
    let keep: Vec<Value> = p.own.iter().filter(|o| !drop_slugs.contains(&o.string_or("slug", "")) && !o.str_of("dep").is_some_and(|d| drop_slugs.contains(d))).cloned().collect();
    let mut added: Vec<Value> = Vec::new();
    let mut failed = p.errors;
    for (i, f) in p.files.iter().enumerate() {
        let title = f.str_of("title").or(f.str_of("slug")).unwrap_or("").to_string();
        progress(json!({ "stage": "Mody wydajności", "current": title, "done": i, "total": p.files.len(), "step": "nore" }));
        let name = util::basename(f.str_of("file").unwrap_or(""));
        match env.net.download(f.str_of("url").unwrap_or(""), &mods_dir.join(&name), f.str_of("sha1"), f["size"].as_u64(), &|_| {}).await {
            Ok(_) => added.push(json!({ "slug": f["slug"], "file": name, "projectId": f["projectId"], "versionId": f["versionId"], "version": f["version"], "dep": f.get("dep").cloned().unwrap_or(Value::Null), "added": now_ms() })),
            Err(e) => {
                failed += 1;
                log(format!("[Launcher] {title} – nie udało się pobrać ({e})"));
            }
        }
    }
    let mc = inst.string_or("mcVersion", "");
    let loader = inst.string_or("loader", "");
    for m in &p.missing {
        log(format!("[Launcher] {}: brak wersji dla {mc} ({loader}) – pomijam.", m.str_of("title").unwrap_or("")));
    }
    if p.errors > 0 {
        log("[Launcher] Mody wydajności: brak połączenia z Modrinth – sprawdzę ponownie przy następnym starcie.".into());
    }
    let mut all = keep.clone();
    all.extend(added.iter().cloned());
    insts.update(id, &json!({ "perfAdded": all, "perfKey": if failed > 0 { Value::Null } else { json!(key) }, "perfFor": { "mc": mc, "loader": loader }, "perfModsInstalled": true }))?;
    if !added.is_empty() {
        log(format!("[Launcher] Dodano mody wydajności: {}", added.iter().map(|a| a.string_or("file", "")).collect::<Vec<_>>().join(", ")));
    }
    if !removed.is_empty() {
        log(format!("[Launcher] Usunięto mody wydajności: {}", removed.iter().map(|r| format!("{} ({})", r.string_or("file", ""), r.string_or("reason", ""))).collect::<Vec<_>>().join(", ")));
    }
    Ok(Some(json!({ "added": added, "removed": removed, "skipped": p.plan.skip, "missing": p.missing })))
}

/// Removes every mod the launcher added (switching the set off).
pub fn remove_all(insts: &Instances<'_>, inst: &Value) -> Result<Vec<String>> {
    let mods_dir = PathBuf::from(inst.string_or("gameDir", "")).join("mods");
    let mut removed = Vec::new();
    for o in inst["perfAdded"].as_array().into_iter().flatten() {
        let f = util::basename(o.str_of("file").unwrap_or(""));
        for n in [f.clone(), format!("{f}.disabled")] {
            if !f.is_empty() && mods_dir.join(&n).exists() && std::fs::remove_file(mods_dir.join(&n)).is_ok() {
                removed.push(n);
            }
        }
    }
    insts.update(inst.str_of("id").unwrap_or(""), &json!({ "perfAdded": [], "perfKey": null, "perfMods": false, "perfAsked": true }))?;
    Ok(removed)
}

/// Crash repair took one back: remove the file (and deps only it needed) and never add it again.
pub fn take_back(insts: &Instances<'_>, inst: &Value, slug: &str) -> Result<Vec<String>> {
    let mods_dir = PathBuf::from(inst.string_or("gameDir", "")).join("mods");
    let own: Vec<Value> = inst["perfAdded"].as_array().cloned().unwrap_or_default();
    let (gone, rest): (Vec<Value>, Vec<Value>) = own.into_iter().partition(|o| o.str_of("slug") == Some(slug) || o.str_of("dep") == Some(slug));
    for o in &gone {
        let f = util::basename(o.str_of("file").unwrap_or(""));
        let _ = std::fs::remove_file(mods_dir.join(&f));
        let _ = std::fs::remove_file(mods_dir.join(format!("{f}.disabled")));
    }
    let mut blocked = strings(&inst["perfBlocked"]);
    if !blocked.iter().any(|b| b == slug) {
        blocked.push(slug.into());
    }
    insts.update(inst.str_of("id").unwrap_or(""), &json!({ "perfAdded": rest, "perfBlocked": blocked }))?;
    Ok(gone.iter().map(|o| o.string_or("file", "")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slugs(v: &[Value]) -> Vec<String> {
        v.iter().map(|a| a.string_or("slug", "")).collect()
    }
    fn m(file: &str, ids: &[&str], enabled: bool) -> Present {
        Present { file: file.into(), ids: ids.iter().map(|s| s.to_string()).collect(), enabled }
    }
    fn own(v: &[(&str, &str)]) -> Vec<Own> {
        v.iter().map(|(s, f)| Own { slug: s.to_string(), file: f.to_string() }).collect()
    }

    #[test]
    fn fabric_only_missing_mods() {
        let p = plan_perf_mods("fabric", &[m("lithium-fabric-0.15.jar", &["lithium"], true), m("fabric-api-0.100.jar", &["fabric-api"], true)], &[], &[], &[]);
        let add = slugs(&p.add);
        for s in ["sodium", "ferrite-core", "modernfix", "entityculling", "immediatelyfast", "krypton", "moreculling", "dynamic-fps", "badoptimizations"] {
            assert!(add.contains(&s.to_string()), "{s}");
        }
        assert!(!add.contains(&"lithium".into()) && !add.contains(&"embeddium".into()));
        assert_eq!(slugs(&p.skip), vec!["lithium"]);
    }

    #[test]
    fn renderer_conflicts() {
        let has = |p: &Plan, s: &str| slugs(&p.add).contains(&s.to_string());
        let emb = plan_perf_mods("neoforge", &[m("embeddium-1.0.jar", &["embeddium"], true)], &[], &[], &[]);
        assert!(!has(&emb, "sodium") && !has(&emb, "embeddium"));
        let of = plan_perf_mods("forge", &[m("OptiFine_1.20.1_HD_U_I6.jar", &[], true)], &[], &[], &[]);
        assert!(!has(&of, "embeddium") && !has(&of, "entityculling") && !has(&of, "immediatelyfast") && has(&of, "ferrite-core"));
        assert!(!has(&plan_perf_mods("fabric", &[m("iris-mc1.21-1.7.jar", &["iris"], true)], &[], &[], &[]), "sodium"));
        let vk = plan_perf_mods("fabric", &[m("VulkanMod_1.21-0.5.jar", &["vulkanmod"], true)], &[], &[], &[]);
        assert!(!has(&vk, "sodium") && !has(&vk, "immediatelyfast"));
        assert!(!has(&plan_perf_mods("fabric", &[m("ViaFabricPlus-4.0.jar", &["viafabricplus"], true)], &[], &[], &[]), "krypton"));
    }

    #[test]
    fn neoforge_groups() {
        let neo = plan_perf_mods("neoforge", &[], &[], &[], &[]);
        let r: Vec<String> = neo.add.iter().filter(|a| a.str_of("group") == Some("renderer")).map(|a| a.string_or("slug", "")).collect();
        assert_eq!(r, vec!["sodium", "embeddium"]);
        assert!(!slugs(&neo.add).contains(&"krypton".into()));
        let forge = plan_perf_mods("forge", &[], &[], &[], &[]);
        assert_eq!(forge.add.iter().filter(|a| a.str_of("group") == Some("renderer")).map(|a| a.string_or("slug", "")).collect::<Vec<_>>(), vec!["embeddium"]);
        assert!(plan_perf_mods("vanilla", &[], &[], &[], &[]).add.is_empty());
    }

    #[test]
    fn never_duplicate() {
        let p = plan_perf_mods("fabric", &[m("sodium-fabric-0.6.5.jar", &["sodium"], true)], &own(&[("sodium", "sodium-fabric-0.6.jar"), ("krypton", "krypton-0.2.jar")]), &[], &[]);
        assert_eq!(p.drop.iter().map(|d| d.string_or("file", "")).collect::<Vec<_>>(), vec!["sodium-fabric-0.6.jar"]);
        assert!(p.keep.contains(&"krypton".into()));
        assert!(!slugs(&p.add).contains(&"sodium".into()) && !slugs(&p.add).contains(&"krypton".into()));
        let off = plan_perf_mods("fabric", &[m("entityculling-1.0.jar.disabled", &["entityculling"], false)], &[], &[], &[]);
        assert!(!slugs(&off.add).contains(&"entityculling".into()));
        assert_eq!(off.skip.iter().find(|s| s["slug"] == "entityculling").unwrap()["reason"], "wyłączony przez gracza");
        let own_r = plan_perf_mods("neoforge", &[], &own(&[("embeddium", "embeddium.jar")]), &[], &[]);
        assert!(own_r.keep.contains(&"embeddium".into()) && !slugs(&own_r.add).contains(&"sodium".into()));
        let b = plan_perf_mods("fabric", &[], &own(&[("moreculling", "moreculling.jar")]), &["moreculling".into()], &[]);
        assert!(!slugs(&b.add).contains(&"moreculling".into()));
        assert_eq!(slugs(&b.drop), vec!["moreculling"]);
    }

    #[test]
    fn blame() {
        let o = own(&[("immediatelyfast", "if.jar"), ("sodium", "s.jar"), ("krypton", "k.jar")]);
        let l = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(blame_perf(&l(&["Mixin apply for mod immediatelyfast failed immediatelyfast-common.mixins.json:x"]), &o), vec!["immediatelyfast"]);
        let trace = l(&[
            "java.lang.NullPointerException: Cannot invoke \"x\"",
            "\tat me.steinborn.krypton.mod.shared.network.pipeline.MinecraftCompressEncoder.encode(MinecraftCompressEncoder.java:40)",
            "\tat io.netty.handler.codec.MessageToByteEncoder.write(MessageToByteEncoder.java:107)",
        ]);
        assert_eq!(blame_perf(&trace, &o), vec!["krypton"]);
        let mut deep = vec!["java.lang.RuntimeException: boom".to_string()];
        deep.extend((0..7).map(|i| format!("\tat some.other.Mod.m{i}(Mod.java:1)")));
        deep.push("\tat net.caffeinemc.mods.sodium.client.Render.r(Render.java:1)".into());
        assert!(blame_perf(&deep, &o).is_empty());
        assert!(blame_perf(&trace, &own(&[("sodium", "s.jar")])).is_empty());
    }

    #[tokio::test]
    async fn jar_scan() {
        let d = tempfile::tempdir().unwrap();
        util::write_zip(&d.path().join("a.jar"), vec![("fabric.mod.json".into(), br#"{"id":"sodium","provides":["indium-compat"]}"#.to_vec())]).unwrap();
        util::write_zip(&d.path().join("b.jar.disabled"), vec![("META-INF/neoforge.mods.toml".into(), b"modId=\"ferritecore\"\n".to_vec())]).unwrap();
        std::fs::write(d.path().join("notes.txt"), "x").unwrap();
        let mut list = scan(d.path()).await;
        list.sort_by(|a, b| a.file.cmp(&b.file));
        assert_eq!(list, vec![m("a.jar", &["sodium", "indium-compat"], true), m("b.jar.disabled", &["ferritecore"], false)]);
    }

    #[test]
    fn enabled() {
        assert!(enabled_for(&json!({ "loader": "fabric", "perfMods": true })));
        assert!(enabled_for(&json!({ "loader": "fabric", "noreClient": true })));
        assert!(!enabled_for(&json!({ "loader": "fabric" })));
        assert!(!enabled_for(&json!({ "loader": "forge", "perfMods": false })));
        assert!(!enabled_for(&json!({ "loader": "vanilla", "perfMods": true })));
        assert_eq!(state_key(&json!({ "mcVersion": "1.21.1", "loader": "fabric" })), "2|1.21.1|fabric|");
        assert_eq!(file_tokens("Sodium-Fabric-0.6.jar.disabled"), vec!["sodium"]);
    }
}
