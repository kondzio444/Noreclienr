//! Automatic repair of broken instances (port of launcher/src/main/doctor.js): preflight before
//! every launch (duplicates, mods for another loader), a deep check against Modrinth (mods for
//! another Minecraft version) and crash log analysis turned into fixes. Disabled files get the
//! ".disabled" suffix, so nothing is lost.

use crate::error::Result;
use crate::instances::Instances;
use crate::js::{number, ValueExt};
use crate::util::{self, Zip};
use crate::{jvm, modrinth, perf, Env};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

fn ln(l: &str) -> String {
    match l {
        "fabric" => "Fabric",
        "quilt" => "Quilt",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        "vanilla" => "Vanilla",
        o => o,
    }
    .to_string()
}

fn mods_dir(inst: &Value) -> PathBuf {
    PathBuf::from(inst.string_or("gameDir", "")).join("mods")
}

#[derive(Clone, Debug, Default)]
pub struct Jar {
    pub file: String,
    pub mtime: f64,
    pub ids: Vec<String>,
    pub loaders: Vec<String>,
    pub version: String,
    pub module: Option<String>,
    pub name: Option<String>,
}

/// Loader metadata of a mod jar: ids, loaders, version, module name.
pub fn read_jar(file: &Path) -> Jar {
    static CTRL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\x00-\x1f]+").unwrap());
    static MODID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^\s*modId\s*=\s*["']([^"']+)["']"#).unwrap());
    static VER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^\s*version\s*=\s*["']([^"']+)["']"#).unwrap());
    static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^\s*displayName\s*=\s*["']([^"']+)["']"#).unwrap());
    static MODULE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Automatic-Module-Name:\s*(\S+)").unwrap());
    let mut out = Jar::default();
    let Ok(mut zip) = Zip::open(file) else { return out };
    let add_loader = |out: &mut Jar, l: &str| {
        if !out.loaders.iter().any(|x| x == l) {
            out.loaders.push(l.into());
        }
    };
    if let Some(j) = zip.text("fabric.mod.json").and_then(|t| serde_json::from_str::<Value>(&CTRL.replace_all(t.trim_start_matches('\u{feff}'), " ")).ok()) {
        if let Some(id) = j.str_of("id") {
            out.ids.push(id.into());
        }
        if let Some(v) = j.str_of("version").filter(|s| !s.is_empty()) {
            out.version = v.into();
        }
        if let Some(n) = j.str_of("name").filter(|s| !s.is_empty()) {
            out.name = Some(n.into());
        }
        add_loader(&mut out, "fabric");
        let provides = match &j["provides"] {
            Value::Array(a) => a.clone(),
            Value::Null => vec![],
            v => vec![v.clone()],
        };
        for p in provides {
            if let Some(s) = p.as_str().map(String::from).or_else(|| p.str_of("id").map(String::from)) {
                out.ids.push(s);
            }
        }
    }
    if let Some(q) = zip.text("quilt.mod.json").and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        let q = &q["quilt_loader"];
        if let Some(id) = q.str_of("id") {
            out.ids.push(id.into());
        }
        if let Some(v) = q.str_of("version").filter(|s| !s.is_empty()) {
            out.version = v.into();
        }
        add_loader(&mut out, "quilt");
    }
    for (name, loader) in [("META-INF/neoforge.mods.toml", "neoforge"), ("META-INF/mods.toml", "forge")] {
        let Some(toml) = zip.text(name) else { continue };
        add_loader(&mut out, loader);
        out.ids.extend(MODID.captures_iter(&toml).map(|c| c[1].to_string()));
        if out.version.is_empty() {
            if let Some(c) = VER.captures(&toml) {
                out.version = c[1].to_string();
            }
        }
        if out.name.is_none() {
            out.name = NAME.captures(&toml).map(|c| c[1].to_string());
        }
    }
    if let Some(mf) = zip.text("META-INF/MANIFEST.MF") {
        out.module = MODULE.captures(&mf).map(|c| c[1].to_string());
    }
    let mut ids: Vec<String> = Vec::new();
    for id in out.ids.iter().filter(|s| !s.is_empty()).map(|s| s.to_lowercase()) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    out.ids = ids;
    out
}

pub async fn scan_mods(inst: &Value) -> Vec<Jar> {
    let dir = mods_dir(inst);
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut names = util::read_dir_names(&dir);
        names.sort();
        for file in names {
            if !file.to_lowercase().ends_with(".jar") {
                continue;
            }
            let full = dir.join(&file);
            let Ok(meta) = std::fs::metadata(&full) else { continue };
            if !meta.is_file() {
                continue;
            }
            let mut j = read_jar(&full);
            j.file = file;
            j.mtime = util::mtime_ms(&meta);
            out.push(j);
        }
        out
    })
    .await
    .unwrap_or_default()
}

fn loader_ok(m: &Jar, loader: &str) -> bool {
    if m.loaders.is_empty() {
        return true;
    }
    let has = |l: &str| m.loaders.iter().any(|x| x == l);
    match loader {
        "fabric" => has("fabric"),
        "quilt" => has("quilt") || has("fabric"),
        "neoforge" => has("neoforge") || has("forge"),
        "forge" => has("forge"),
        _ => false,
    }
}

/// Version comparison of doctor.js (numbers part by part, non-numbers lowest).
pub fn cmp_version(a: &str, b: &str) -> std::cmp::Ordering {
    let split = |s: &str| s.split(['.', '+', '-', '_', ' ']).map(|p| crate::config_edit::parse_int(p).unwrap_or(-1)).collect::<Vec<_>>();
    let (pa, pb) = (split(a), split(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (pa.get(i).copied().unwrap_or(-1), pb.get(i).copied().unwrap_or(-1));
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

fn newest_first(a: &Jar, b: &Jar) -> std::cmp::Ordering {
    cmp_version(&b.version, &a.version).then(b.mtime.partial_cmp(&a.mtime).unwrap_or(std::cmp::Ordering::Equal))
}

const LIBRARY_IDS: [&str; 7] = ["fabricloader", "java", "minecraft", "forge", "neoforge", "quilt_loader", "mixinextras"];

fn problem(kind: &str, file: Option<&str>, title: String, detail: String, fix: Value) -> Value {
    json!({ "kind": kind, "file": file, "title": title, "detail": detail, "fix": fix })
}

/// Offline checks run before every launch.
pub async fn preflight(inst: &Value) -> Vec<Value> {
    let mut problems = Vec::new();
    let loader = inst.str_of("loader").unwrap_or("");
    if loader.is_empty() || loader == "vanilla" {
        return problems;
    }
    let mods = scan_mods(inst).await;
    for m in mods.iter().filter(|m| !loader_ok(m, loader)) {
        problems.push(problem(
            "wrong-loader",
            Some(&m.file),
            format!("{} jest dla {}", m.name.clone().unwrap_or(m.file.clone()), m.loaders.iter().map(|l| ln(l)).collect::<Vec<_>>().join("/")),
            format!("Instancja używa {} – ten mod nie zadziała i może wywalić grę.", ln(loader)),
            json!({ "action": "disable", "file": m.file }),
        ));
    }
    let mut by_id: Vec<(String, Vec<&Jar>)> = Vec::new();
    for m in mods.iter().filter(|m| loader_ok(m, loader)) {
        let Some(main) = m.ids.iter().find(|id| !LIBRARY_IDS.contains(&id.as_str())) else { continue };
        match by_id.iter_mut().find(|(k, _)| k == main) {
            Some((_, l)) => l.push(m),
            None => by_id.push((main.clone(), vec![m])),
        }
    }
    for (id, mut list) in by_id {
        if list.len() < 2 {
            continue;
        }
        list.sort_by(|a, b| newest_first(a, b));
        let keep = list[0];
        for old in &list[1..] {
            problems.push(problem(
                "duplicate",
                Some(&old.file),
                format!("Zdublowany mod: {}", keep.name.clone().unwrap_or(id.clone())),
                format!(
                    "Zostaje {}{}, wyłączam starszy {}.",
                    keep.file,
                    if keep.version.is_empty() { String::new() } else { format!(" ({})", keep.version) },
                    old.file
                ),
                json!({ "action": "disable", "file": old.file }),
            ));
        }
    }
    problems
}

/// Online check: mods built for another Minecraft version (by Modrinth hash).
pub async fn deep_check(env: &Env, inst: &Value) -> Vec<Value> {
    let mut problems = preflight(inst).await;
    let loader = inst.str_of("loader").unwrap_or("");
    if loader.is_empty() || loader == "vanilla" {
        return problems;
    }
    let flagged: HashSet<String> = problems.iter().filter_map(|p| p.str_of("file").map(String::from)).collect();
    let Ok(meta) = modrinth::identify(env, &mods_dir(inst), &[".jar"]).await else { return problems };
    let mc = inst.str_of("mcVersion").unwrap_or("");
    for (file, m) in meta {
        if flagged.contains(&file) || file.ends_with(".disabled") || !m["gameVersions"].is_array() {
            continue;
        }
        let gv: Vec<&str> = m["gameVersions"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        if !gv.contains(&mc) {
            problems.push(problem(
                "wrong-version",
                Some(&file),
                format!("{} jest dla Minecraft {}", m.str_of("title").filter(|s| !s.is_empty()).unwrap_or(&file), gv.last().unwrap_or(&"?")),
                format!("Instancja to {mc} – pobiorę pasującą wersję albo wyłączę mod."),
                json!({ "action": "replace", "file": file, "projectId": m["projectId"] }),
            ));
        }
    }
    problems
}

fn find_jars<'a>(mods: &'a [Jar], id: &str) -> Vec<&'a Jar> {
    static SUFFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"_service$|_api$|-api$").unwrap());
    let l = id.to_lowercase();
    let base = SUFFIX.replace(&l, "").to_string();
    mods.iter().filter(|m| m.ids.iter().any(|x| *x == l || *x == base) || m.module.as_ref().is_some_and(|mo| mo.to_lowercase() == l)).collect()
}

/// Turns the last lines of a crashed game into problems with fixes.
pub async fn analyze_log(insts: &Instances<'_>, inst: &Value, lines: &[String]) -> Vec<Value> {
    macro_rules! re {
        ($p:expr) => {{
            static R: LazyLock<Regex> = LazyLock::new(|| Regex::new($p).unwrap());
            &*R
        }};
    }
    let text = lines.join("\n");
    let mut problems: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut add = |problems: &mut Vec<Value>, p: Value| {
        let k = format!("{}{}", p.string_or("kind", ""), crate::js::stringify(&p["fix"]));
        if seen.insert(k) {
            problems.push(p);
        }
    };
    let mods = scan_mods(inst).await;
    let file_of = |j: Option<&&Jar>| j.map(|j| j.file.clone());
    for c in re!(r"Modules (\S+) and (\S+) export package (\S+)").captures_iter(&text) {
        let mut cands: Vec<&Jar> = Vec::new();
        for j in find_jars(&mods, &c[1]).into_iter().chain(find_jars(&mods, &c[2])) {
            if !cands.iter().any(|x| x.file == j.file) {
                cands.push(j);
            }
        }
        let title = format!("Konflikt modułów: {} i {}", &c[1], &c[2]);
        if cands.len() >= 2 {
            cands.sort_by(|a, b| newest_first(a, b));
            for old in &cands[1..] {
                add(
                    &mut problems,
                    problem(
                        "module-conflict",
                        Some(&old.file),
                        title.clone(),
                        format!("Dwie kopie tego samego moda. Zostaje {}, wyłączam {}.", cands[0].file, old.file),
                        json!({ "action": "disable", "file": old.file }),
                    ),
                );
            }
        } else if cands.len() == 1 {
            add(
                &mut problems,
                problem(
                    "module-conflict",
                    Some(&cands[0].file),
                    title,
                    format!("{} gryzie się z modem, który zawiera go w środku – wyłączam osobną kopię.", cands[0].file),
                    json!({ "action": "disable", "file": cands[0].file }),
                ),
            );
        }
    }
    for c in re!(r"Mod '([^']+)' \(([^)]+)\) \S* ?requires (?:any version|version \S+)(?: or later)? of (?:mod )?'([^']+)' \(([^)]+)\), which is missing")
        .captures_iter(&text)
    {
        if LIBRARY_IDS.contains(&&c[4]) {
            continue;
        }
        add(
            &mut problems,
            problem(
                "missing-dep",
                None,
                format!("Brakuje moda {}", &c[3]),
                format!("Wymaga go {} – pobiorę go z Modrinth.", &c[1]),
                json!({ "action": "install", "id": &c[4] }),
            ),
        );
    }
    for c in re!(r"Mod '([^']+)' \(([^)]+)\) \S* ?requires (?:version \S+|any version)(?: or later)? of (?:mod )?'([^']+)' \(([^)]+)\), but only the wrong version is present").captures_iter(&text) {
        if &c[4] == "minecraft" || &c[4] == "java" {
            if let Some(f) = file_of(find_jars(&mods, &c[2]).first()) {
                add(&mut problems, problem("wrong-version", Some(&f), format!("{} jest dla innej wersji {}", &c[1], &c[3]), "Pobiorę pasującą wersję albo wyłączę mod.".into(), json!({ "action": "replace", "file": f, "slug": &c[2] })));
            }
        } else if !LIBRARY_IDS.contains(&&c[4]) {
            let f = file_of(find_jars(&mods, &c[4]).first());
            add(&mut problems, problem("dep-version", f.as_deref(), format!("Zła wersja moda {}", &c[3]), format!("Wymaga jej {} – zaktualizuję {}.", &c[1], &c[3]), json!({ "action": "replace", "file": f, "slug": &c[4] })));
        }
    }
    for c in re!(r"Mod '([^']+)' \(([^)]+)\) \S* ?is incompatible with (?:any version|version \S+) of (?:mod )?'([^']+)' \(([^)]+)\)").captures_iter(&text) {
        if let Some(f) = file_of(find_jars(&mods, &c[2]).first()) {
            add(
                &mut problems,
                problem(
                    "incompatible",
                    Some(&f),
                    format!("{} nie działa z {}", &c[1], &c[3]),
                    format!("Wyłączam {f}."),
                    json!({ "action": "disable", "file": f }),
                ),
            );
        }
    }
    for c in re!(r"Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '\[?MISSING\]?'").captures_iter(&text) {
        if LIBRARY_IDS.contains(&&c[1]) {
            continue;
        }
        add(
            &mut problems,
            problem(
                "missing-dep",
                None,
                format!("Brakuje moda {}", &c[1]),
                format!("Wymaga go {} – pobiorę go z Modrinth.", &c[2]),
                json!({ "action": "install", "id": &c[1] }),
            ),
        );
    }
    for c in re!(r"Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^'M][^']*)'").captures_iter(&text) {
        if LIBRARY_IDS.contains(&&c[1]) {
            continue;
        }
        let f = file_of(find_jars(&mods, &c[1]).first());
        add(
            &mut problems,
            problem(
                "dep-version",
                f.as_deref(),
                format!("Zła wersja moda {}", &c[1]),
                format!("{} wymaga {}, jest {} – zaktualizuję.", &c[2], &c[3], &c[4]),
                json!({ "action": "replace", "file": f, "slug": &c[1] }),
            ),
        );
    }
    for c in re!(r"(?is)(?:Duplicate mods found|Found duplicate mods?|DuplicateModsFoundException).{0,400}?\(([a-z0-9_\-]+)\)").captures_iter(&text) {
        let mut jars = find_jars(&mods, &c[1]);
        jars.sort_by(|a, b| newest_first(a, b));
        for old in jars.iter().skip(1) {
            add(
                &mut problems,
                problem(
                    "duplicate",
                    Some(&old.file),
                    format!("Zdublowany mod: {}", &c[1]),
                    format!("Wyłączam starszy {}.", old.file),
                    json!({ "action": "disable", "file": old.file }),
                ),
            );
        }
    }
    if re!(r"UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime|Unsupported class file major version").is_match(&text) {
        add(
            &mut problems,
            problem(
                "java",
                None,
                "Zła wersja Javy".into(),
                "Mod albo gra wymaga nowszej Javy – przełączam na Javę dobieraną automatycznie.".into(),
                json!({ "action": "auto-java" }),
            ),
        );
    }
    if text.contains("java.lang.OutOfMemoryError") {
        let (total, _) = jvm::system_memory_mb();
        let (mods_n, shaders) = jvm::count_mods(Path::new(&inst.string_or("gameDir", ""))).await;
        let settings_mb = insts.store.settings().num_of("memoryMb");
        let mut cur = number(&inst["memoryMb"]);
        if cur == 0.0 {
            cur = settings_mb;
        }
        if cur == 0.0 {
            cur = jvm::auto_memory_mb(mods_n, inst.str_of("loader").unwrap_or("vanilla"), total, shaders) as f64;
        }
        let next = (jvm::max_game_mb(total) as f64).min(cur + 2048.0);
        if next > cur {
            add(
                &mut problems,
                problem(
                    "memory",
                    None,
                    "Zabrakło pamięci RAM".into(),
                    format!("Zwiększam pamięć instancji z {:.1} do {:.1} GB.", cur / 1024.0, next / 1024.0),
                    json!({ "action": "memory", "mb": next as i64 }),
                ),
            );
        }
    }
    for c in re!(
        r"(?i)Mixin apply(?: for mod)? ([a-z0-9_\-]+) failed|from mod ([a-z0-9_\-]+)\] .*?(?:InvalidInjectionException|InvalidMixinException|MixinApplyError)"
    )
    .captures_iter(&text)
    {
        let id = c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or("");
        if id.is_empty() || id == "noreclient" {
            continue;
        }
        if let Some(j) = find_jars(&mods, id).first() {
            add(
                &mut problems,
                problem(
                    "mixin",
                    Some(&j.file),
                    format!("Mod {} nie pasuje do tej wersji gry", j.name.clone().unwrap_or(id.into())),
                    "Pobiorę pasującą wersję albo wyłączę mod.".into(),
                    json!({ "action": "replace", "file": j.file, "slug": id }),
                ),
            );
        }
    }
    if re!(
        r"NoClassDefFoundError: net/fabricmc|Mod resolution failed|Incompatible mods found|Missing or unsupported mandatory dependencies|LoadingFailedException"
    )
    .is_match(&text)
        || problems.is_empty()
    {
        for p in preflight(inst).await {
            add(&mut problems, p);
        }
    }
    // performance mods the launcher added are taken back instead of being "fixed"
    let own: Vec<Value> = inst["perfAdded"].as_array().cloned().unwrap_or_default();
    if !own.is_empty() {
        let mut taken: HashSet<String> = HashSet::new();
        for p in problems.iter_mut() {
            let Some(f) = p.str_of("file").map(String::from) else { continue };
            let Some(o) = own.iter().find(|o| o.str_of("file") == Some(&f) || format!("{}.disabled", o.string_or("file", "")) == f) else { continue };
            let slug = o.str_of("dep").filter(|s| !s.is_empty()).or(o.str_of("slug")).unwrap_or("").to_string();
            p["fix"] = json!({ "action": "perf-remove", "slug": slug, "file": o["file"] });
            p["detail"] = json!(format!("{} dodał launcher (Mody wydajności) – usuwam go i nie dodam ponownie w tej instancji.", perf::title_of(&slug)));
            taken.insert(slug);
        }
        let own_list: Vec<perf::Own> = own.iter().map(|o| perf::Own { slug: o.string_or("slug", ""), file: o.string_or("file", "") }).collect();
        for slug in perf::blame_perf(lines, &own_list) {
            if taken.contains(&slug) {
                continue;
            }
            add(
                &mut problems,
                json!({ "kind": "perf", "title": format!("Mod wydajności {} wywala grę", perf::title_of(&slug)), "detail": "Dodał go launcher – usuwam go i nie dodam ponownie w tej instancji (przywrócisz go przyciskiem Optymalizuj).", "fix": { "action": "perf-remove", "slug": slug } }),
            );
        }
    }
    problems
}

async fn disable(inst: &Value, file: &str) -> Result<()> {
    let n = util::safe_name(file)?;
    let from = mods_dir(inst).join(&n);
    tokio::fs::rename(&from, mods_dir(inst).join(format!("{n}.disabled"))).await?;
    Ok(())
}

async fn install(env: &Env, inst: &Value, id: &str) -> Result<Vec<String>> {
    let req = modrinth::InstallReq {
        project_id: id.into(),
        kind: "mod".into(),
        game_version: inst.str_of("mcVersion").map(String::from),
        loader: inst.str_of("loader").map(String::from),
        target_dir: mods_dir(inst),
        version_id: None,
    };
    modrinth::install(env, req, &modrinth::no_status, &mut Default::default(), &mut Default::default()).await
}

/// Applies the fixes; returns the problems with result strings.
pub async fn apply(env: &Env, insts: &Instances<'_>, inst: &Value, problems: &[Value]) -> Vec<Value> {
    let mut done = Vec::new();
    for p in problems {
        let f = &p["fix"];
        let file = f.str_of("file").unwrap_or("");
        let r: Result<Option<String>> = async {
            Ok(match f.str_of("action").unwrap_or("") {
                "disable" => {
                    disable(inst, file).await?;
                    Some("wyłączono".into())
                }
                "install" => {
                    install(env, inst, f.str_of("id").unwrap_or("")).await?;
                    Some("pobrano".into())
                }
                "replace" => {
                    let id = f.str_of("projectId").or(f.str_of("slug")).unwrap_or("");
                    Some(match install(env, inst, id).await {
                        Ok(files) => {
                            if !file.is_empty() && !files.iter().any(|x| x == file) {
                                let _ = tokio::fs::remove_file(mods_dir(inst).join(util::basename(file))).await;
                            }
                            format!("zaktualizowano ({})", files.first().cloned().unwrap_or_default())
                        }
                        Err(_) => {
                            if !file.is_empty() {
                                let _ = disable(inst, file).await;
                            }
                            "brak zgodnej wersji – wyłączono".into()
                        }
                    })
                }
                "memory" => {
                    insts.update(inst.str_of("id").unwrap_or(""), &json!({ "memoryMb": f["mb"] }))?;
                    Some("zwiększono".into())
                }
                "perf-remove" => {
                    let fresh = insts.get(inst.str_of("id").unwrap_or("")).unwrap_or_else(|| inst.clone());
                    let gone = perf::take_back(insts, &fresh, f.str_of("slug").unwrap_or(""))?;
                    Some(if gone.is_empty() { "zablokowano".into() } else { format!("usunięto {}", gone.join(", ")) })
                }
                "auto-java" => {
                    insts.store.update(|d| d["settings"]["javaPath"] = json!(""))?;
                    Some("ustawiono automatyczną Javę".into())
                }
                _ => None,
            })
        }
        .await;
        let mut out = p.clone();
        out["result"] = match r {
            Ok(Some(s)) => json!(s),
            Ok(None) => Value::Null,
            Err(e) => json!(format!("nie udało się: {e}")),
        };
        done.push(out);
    }
    done
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instances::NoreMods;
    use crate::paths::Paths;
    use crate::store::Store;

    fn jar(dir: &Path, name: &str, entry: &str, text: &str) {
        util::write_zip(&dir.join(name), vec![(entry.into(), text.as_bytes().to_vec())]).unwrap();
    }
    fn neo_toml(id: &str, v: &str) -> String {
        format!("modLoader=\"javafml\"\n[[mods]]\nmodId=\"{id}\"\nversion=\"{v}\"\ndisplayName=\"{id}\"\n")
    }
    fn instance(d: &Path, loader: &str) -> Value {
        std::fs::create_dir_all(d.join("mods")).unwrap();
        json!({ "id": "x", "name": "Test", "mcVersion": "1.21.1", "loader": loader, "gameDir": d.to_string_lossy() })
    }

    #[tokio::test]
    async fn preflight_duplicate_and_wrong_loader() {
        let d = tempfile::tempdir().unwrap();
        let inst = instance(d.path(), "neoforge");
        let mods = d.path().join("mods");
        jar(&mods, "sodium-neoforge-0.8.13.jar", "META-INF/neoforge.mods.toml", &neo_toml("sodium", "0.8.13"));
        jar(&mods, "sodium-neoforge-0.6.0.jar", "META-INF/neoforge.mods.toml", &neo_toml("sodium", "0.6.0"));
        jar(&mods, "lithium-fabric.jar", "fabric.mod.json", r#"{"id":"lithium","version":"0.15.4","name":"Lithium"}"#);
        let p = preflight(&inst).await;
        let mut kinds: Vec<(String, String)> = p.iter().map(|x| (x.string_or("kind", ""), x.string_or("file", ""))).collect();
        kinds.sort();
        assert_eq!(kinds, vec![("duplicate".into(), "sodium-neoforge-0.6.0.jar".into()), ("wrong-loader".into(), "lithium-fabric.jar".into())]);
        let store = Store::memory(json!({}));
        let paths = Paths::new(d.path());
        let nm = NoreMods::default();
        let insts = Instances { store: &store, paths: &paths, mods: &nm };
        let env = Env::new(paths.clone(), crate::net::Net::for_tests());
        let fixed = apply(&env, &insts, &inst, &p).await;
        assert!(fixed.iter().all(|f| f["result"] == "wyłączono"));
        assert!(mods.join("sodium-neoforge-0.6.0.jar.disabled").exists() && mods.join("sodium-neoforge-0.8.13.jar").exists());
    }

    #[tokio::test]
    async fn crash_logs() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::memory(json!({ "settings": {} }));
        let paths = Paths::new(d.path());
        let nm = NoreMods::default();
        let insts = Instances { store: &store, paths: &paths, mods: &nm };
        let a = d.path().join("a");
        let inst = instance(&a, "neoforge");
        jar(&a.join("mods"), "sodium-neoforge-0.8.13.jar", "META-INF/neoforge.mods.toml", &neo_toml("sodium", "0.8.13"));
        jar(&a.join("mods"), "sodium-0.6.0.jar", "META-INF/neoforge.mods.toml", &neo_toml("sodium", "0.6.0"));
        let log = vec![
            "Exception in thread \"main\" java.lang.module.ResolutionException: Modules sodium_service and sodium export package net.caffeinemc.mods.sodium.client.compatibility.workarounds.intel to module connector$authlib".to_string(),
            "\tat java.base/java.lang.module.Resolver.resolveFail(Resolver.java:900)".into(),
        ];
        let p = analyze_log(&insts, &inst, &log).await;
        let c: Vec<&Value> = p.iter().filter(|x| x["kind"] == "module-conflict").collect();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0]["fix"]["file"], "sodium-0.6.0.jar");

        let b = d.path().join("b");
        let inst = instance(&b, "fabric");
        let p = analyze_log(
            &insts,
            &inst,
            &[
                "\t - Mod 'Sodium Extra' (sodium-extra) 0.5.4+mc1.21.1 requires any version of mod 'Sodium' (sodium), which is missing!".into(),
                "\tMod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4,)', Actual version: '[MISSING]'".into(),
            ],
        )
        .await;
        let mut ids: Vec<String> = p.iter().filter(|x| x["kind"] == "missing-dep").map(|x| x["fix"].string_or("id", "")).collect();
        ids.sort();
        assert_eq!(ids, vec!["geckolib", "sodium"]);

        let mut inst = instance(&d.path().join("c"), "fabric");
        inst["memoryMb"] = json!(2048);
        let p = analyze_log(
            &insts,
            &inst,
            &[
                "java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version of the Java Runtime".into(),
                "java.lang.OutOfMemoryError: Java heap space".into(),
            ],
        )
        .await;
        let kinds: Vec<&str> = p.iter().map(|x| x["kind"].as_str().unwrap()).collect();
        assert!(kinds.contains(&"java"));
        if jvm::system_memory_mb().0 > 6000 {
            assert!(kinds.contains(&"memory"));
        }
    }
}
