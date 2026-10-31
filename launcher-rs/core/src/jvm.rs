//! JVM tuning for the game (port of launcher/src/main/jvm.js): memory sized to the instance (mods,
//! shaders, system RAM), garbage collector flags tuned for a client and the Java version
//! Minecraft needs. Everything is pure except [`count_mods`].
//!
//! Modes (Settings → Wydajność JVM): `auto` / `g1` (tuned G1), `zgc` (Generational ZGC, Java 21+,
//! G1 on older Java), `custom` (only the player's own arguments). The player's own arguments
//! always win: their -Xmx / -Xms / GC choice replace ours.

use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;

const GB: u64 = 1024;
pub const MODES: [&str; 4] = ["auto", "g1", "zgc", "custom"];

fn round512(mb: u64) -> u64 {
    (mb / 512 * 512).max(512)
}

/// RAM left for the system: at least 2 GB, 3 GB on machines with more than 8 GB.
pub fn system_reserve_mb(total_mb: u64) -> u64 {
    if total_mb > 8 * GB {
        3 * GB
    } else {
        2 * GB
    }
}

/// Most memory the game may get on this machine.
pub fn max_game_mb(total_mb: u64) -> u64 {
    if total_mb == 0 {
        return 4 * GB;
    }
    round512(GB.max(total_mb.saturating_sub(system_reserve_mb(total_mb))))
}

fn is_vanilla(loader: &str) -> bool {
    loader.is_empty() || loader == "vanilla"
}

/// Memory the instance wants: vanilla 2 GB, a few mods 3 GB … big packs (250+ mods) 8 GB.
pub fn wanted_mb(mods: u64, loader: &str, shaders: bool) -> u64 {
    let mut mb = if is_vanilla(loader) {
        2 * GB
    } else if mods <= 25 {
        3 * GB
    } else if mods <= 100 {
        4 * GB
    } else if mods <= 175 {
        5 * GB
    } else if mods <= 250 {
        6 * GB
    } else {
        8 * GB
    };
    if shaders && mb < 4 * GB && loader != "vanilla" {
        mb += GB;
    }
    mb
}

/// Automatic -Xmx for an instance, capped by system RAM.
pub fn auto_memory_mb(mods: u64, loader: &str, total_mb: u64, shaders: bool) -> u64 {
    wanted_mb(mods, loader, shaders).min(max_game_mb(total_mb))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Memory {
    pub xmx: u64,
    pub xms: u64,
    pub auto: bool,
    pub big: bool,
}

/// Inputs of [`build_jvm_args`] (the `opts` object of jvm.js).
#[derive(Clone, Debug, Default)]
pub struct Opts {
    pub mode: String,
    pub java_major: u32,
    pub instance_mb: u64,
    pub settings_mb: u64,
    pub mods: u64,
    pub loader: String,
    pub total_mb: u64,
    pub free_mb: u64,
    pub shaders: bool,
    pub user_args: String,
}

/// Instance value > launcher value > automatic. Big packs start with Xms = Xmx.
pub fn memory_plan(o: &Opts) -> Memory {
    let loader = if o.loader.is_empty() { "vanilla" } else { o.loader.as_str() };
    let manual = if o.instance_mb > 0 { o.instance_mb } else { o.settings_mb };
    let xmx = if manual > 0 { manual.max(512) } else { auto_memory_mb(o.mods, loader, o.total_mb, o.shaders) };
    let big = loader != "vanilla" && (o.mods > 100 || xmx >= 6 * GB);
    let xms = if big { xmx } else { xmx.min(GB) };
    Memory { xmx, xms, auto: manual == 0, big }
}

/// G1 region size by heap.
pub fn g1_region_mb(xmx: u64) -> u64 {
    if xmx >= 12 * GB {
        32
    } else if xmx >= 6 * GB {
        16
    } else if xmx >= 3 * GB {
        8
    } else {
        4
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Gc {
    pub flags: Vec<String>,
    pub gc: &'static str,
    pub note: Option<String>,
}

/// Garbage collector flags. AlwaysPreTouch only when Xms = Xmx and the heap fits with 2 GB to spare.
pub fn gc_flags(mode: &str, java_major: u32, xmx: u64, xms: u64, free_mb: u64) -> Gc {
    if mode == "custom" {
        return Gc { flags: vec![], gc: "custom", note: None };
    }
    let pre_touch = xms >= xmx && free_mb > 0 && free_mb.saturating_sub(xmx) >= 2 * GB && free_mb >= xmx;
    let base = ["-XX:+IgnoreUnrecognizedVMOptions", "-XX:+UnlockExperimentalVMOptions", "-XX:+UnlockDiagnosticVMOptions"];
    let mut note = None;
    if mode == "zgc" {
        if java_major >= 21 {
            let mut flags: Vec<String> = base.iter().map(|s| s.to_string()).collect();
            flags.push("-XX:+UseZGC".into());
            // generational by default since Java 23 (the switch is gone in 24+)
            if java_major < 23 {
                flags.push("-XX:+ZGenerational".into());
            }
            flags.push("-XX:+DisableExplicitGC".into());
            flags.push("-XX:+PerfDisableSharedMem".into());
            if pre_touch {
                flags.push("-XX:+AlwaysPreTouch".into());
            }
            return Gc { flags, gc: "zgc", note };
        }
        note = Some(format!("ZGC wymaga Javy 21+ (jest {java_major}) – używam zoptymalizowanego G1."));
    }
    let mut flags: Vec<String> = base.iter().map(|s| s.to_string()).collect();
    flags.extend(
        [
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:MaxGCPauseMillis=37",
            "-XX:+DisableExplicitGC",
            "-XX:+AlwaysActAsServerClassMachine",
            "-XX:G1NewSizePercent=23",
            "-XX:G1MaxNewSizePercent=50",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    flags.push(format!("-XX:G1HeapRegionSize={}M", g1_region_mb(xmx)));
    flags.extend(
        [
            "-XX:G1ReservePercent=20",
            "-XX:G1HeapWastePercent=5",
            "-XX:G1MixedGCCountTarget=3",
            "-XX:InitiatingHeapOccupancyPercent=10",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:SurvivorRatio=32",
            "-XX:MaxTenuringThreshold=1",
            "-XX:+PerfDisableSharedMem",
            "-XX:+UseStringDeduplication",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    if java_major >= 17 {
        flags.push("-XX:+UseFastUnorderedTimeStamps".into());
    }
    if pre_touch {
        flags.push("-XX:+AlwaysPreTouch".into());
    }
    Gc { flags, gc: "g1", note }
}

static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?:[^\s"']+|"[^"]*"|'[^']*')+"#).unwrap());
static QUOTES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""([^"]*)"|'([^']*)'"#).unwrap());
static XX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-XX:[+-]?([A-Za-z0-9_]+)").unwrap());
static MEM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-Xm[sx](\d+)([kKmMgG]?)$").unwrap());
static GC_SELECT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-XX:\+Use(G1|Z|Shenandoah|Parallel|ParallelOld|Serial|ConcMarkSweep|Epsilon)GC$").unwrap());
static GC_TUNING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(G1|Z|Shenandoah|MaxGCPauseMillis|ParallelRefProcEnabled|InitiatingHeapOccupancyPercent|SurvivorRatio|MaxTenuringThreshold|AlwaysPreTouch|UseStringDeduplication)").unwrap()
});

/// Splits a user's argument string, keeping "quoted values" together.
pub fn split_args(s: &str) -> Vec<String> {
    SPLIT
        .find_iter(s)
        .map(|m| QUOTES.replace_all(m.as_str(), |c: &regex::Captures| c.get(1).or(c.get(2)).map_or("", |m| m.as_str()).to_string()).into_owned())
        .collect()
}

/// "-XX:+UseG1GC" → "UseG1GC", "-XX:MaxGCPauseMillis=50" → "MaxGCPauseMillis".
pub fn xx_name(arg: &str) -> Option<&str> {
    XX.captures(arg).and_then(|c| c.get(1)).map(|m| m.as_str())
}

/// "-Xms4G" / "-Xmx2048m" → MB.
pub fn parse_mem(arg: &str) -> u64 {
    let Some(c) = MEM.captures(arg) else { return 0 };
    let n: u64 = c[1].parse().unwrap_or(0);
    match c[2].to_ascii_lowercase().as_str() {
        "g" => n * 1024,
        "k" => n.div_ceil(1024),
        "m" => n,
        _ => n.div_ceil(1_048_576),
    }
}

fn starts_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Our tuned flags + the player's own arguments (theirs win).
pub fn merge_args(memory: &Memory, tuned: &[String], user: &[String]) -> Vec<String> {
    let user: Vec<&String> = user.iter().filter(|a| !a.is_empty()).collect();
    let user_xmx = user.iter().any(|a| starts_ci(a, "-Xmx"));
    let user_xms = user.iter().find(|a| starts_ci(a, "-Xms"));
    let user_gc = user.iter().any(|a| GC_SELECT.is_match(a));
    let user_xx: std::collections::HashSet<&str> = user.iter().filter_map(|a| xx_name(a)).collect();
    let mut out = Vec::new();
    if !user_xmx && user_xms.is_none() {
        out.push(format!("-Xmx{}M", memory.xmx));
        out.push(format!("-Xms{}M", memory.xms));
    } else if !user_xmx {
        // only -Xms given: the heap limit must not be below it
        out.push(format!("-Xmx{}M", memory.xmx.max(parse_mem(user_xms.map_or("", |s| s.as_str())))));
    }
    for f in tuned {
        let n = xx_name(f);
        if user_gc && (GC_SELECT.is_match(f) || n.is_some_and(|n| GC_TUNING.is_match(n))) {
            continue;
        }
        if n.is_some_and(|n| user_xx.contains(n)) {
            continue;
        }
        out.push(f.clone());
    }
    out.extend(user.into_iter().cloned());
    out
}

#[derive(Clone, Debug)]
pub struct JvmArgs {
    pub memory: Memory,
    pub gc: &'static str,
    pub note: Option<String>,
    pub args: Vec<String>,
}

/// Everything at once (buildJvmArgs).
pub fn build_jvm_args(o: &Opts) -> JvmArgs {
    let mode = if MODES.contains(&o.mode.as_str()) { o.mode.as_str() } else { "auto" };
    let memory = memory_plan(o);
    let java = if o.java_major == 0 { 17 } else { o.java_major };
    let gc = gc_flags(mode, java, memory.xmx, memory.xms, o.free_mb);
    let user = split_args(&o.user_args);
    JvmArgs { args: merge_args(&memory, &gc.flags, &user), memory, gc: gc.gc, note: gc.note }
}

// ------------------------------------------------------------------ Java per Minecraft version

/// "1.20.4" → (1, 20, 4); "26.1" → (26, 1, 0); snapshots → None.
pub fn parse_mc(v: &str) -> Option<(u32, u32, u32)> {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d+)\.(\d+)(?:\.(\d+))?").unwrap());
    let c = RE.captures(v)?;
    Some((c[1].parse().ok()?, c[2].parse().ok()?, c.get(3).map_or(Some(0), |m| m.as_str().parse().ok())?))
}

/// Java major Minecraft needs: the version JSON knows best; otherwise by version number.
pub fn required_java(mc_version: &str, version_json: Option<&serde_json::Value>) -> u32 {
    if let Some(m) = version_json.and_then(|v| v.pointer("/javaVersion/majorVersion")).and_then(serde_json::Value::as_u64) {
        if m > 0 {
            return m as u32;
        }
    }
    let Some((a, b, c)) = parse_mc(mc_version) else { return 21 };
    if a >= 26 {
        return 25;
    }
    if a != 1 {
        return 21;
    }
    if b <= 16 {
        8
    } else if b == 17 {
        16
    } else if b < 20 || (b == 20 && c <= 4) {
        17
    } else {
        21
    }
}

/// Mojang runtime component for a Java major.
pub fn component_for(major: u32) -> &'static str {
    match major {
        0..=8 => "jre-legacy",
        9..=16 => "java-runtime-alpha",
        17 => "java-runtime-gamma",
        18..=21 => "java-runtime-delta",
        _ => "java-runtime-epsilon",
    }
}

/// Can a Java of this major run the game? Old Forge breaks on Java 9+.
pub fn java_fits(have: Option<u32>, need: u32, loader: &str) -> bool {
    let Some(have) = have.filter(|h| *h > 0) else { return false };
    if have < need {
        return false;
    }
    !(need <= 8 && have > 8 && loader == "forge")
}

// ------------------------------------------------------------------ instance size

/// Enabled mod jars in an instance and whether a shader pack is installed.
pub async fn count_mods(game_dir: &Path) -> (u64, bool) {
    let mut mods = 0;
    let mut shaders = false;
    if let Ok(mut rd) = tokio::fs::read_dir(game_dir.join("mods")).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            if e.file_name().to_string_lossy().to_lowercase().ends_with(".jar") {
                mods += 1;
            }
        }
    }
    if let Ok(mut rd) = tokio::fs::read_dir(game_dir.join("shaderpacks")).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            if e.file_name().to_string_lossy().to_lowercase().ends_with(".zip") {
                shaders = true;
            }
        }
    }
    (mods, shaders)
}

/// Total and free RAM in MB.
pub fn system_memory_mb() -> (u64, u64) {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    (s.total_memory() / 1_048_576, s.available_memory() / 1_048_576)
}

pub const SERVER_PROFILES: [&str; 4] = ["aikar", "zgc", "basic", "custom"];

/// Flags of a server profile (serverFlags of jvm.js).
pub struct ServerFlags {
    pub xms: u64,
    pub flags: Vec<String>,
    pub note: Option<String>,
}

/// Flags for a local server: 'aikar' (Paper's recommendation), 'zgc' (Java 21+), 'basic' / 'custom'
/// (only memory); proxies get Velocity's small-heap flags. `free_mb` decides AlwaysPreTouch.
pub fn server_flags(profile: &str, memory_mb: u64, java_major: u32, proxy: bool, free_mb: u64) -> ServerFlags {
    let xmx = memory_mb.max(512);
    let pre_touch = free_mb > 0 && free_mb as i64 - xmx as i64 >= 2 * GB as i64;
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    let base = s(&["-XX:+IgnoreUnrecognizedVMOptions", "-XX:+UnlockExperimentalVMOptions"]);
    if profile == "basic" || profile == "custom" {
        return ServerFlags { xms: xmx.min(1024), flags: vec![], note: None };
    }
    if proxy {
        let mut f = base;
        f.extend(s(&["-XX:+UseG1GC", "-XX:G1HeapRegionSize=4M", "-XX:+ParallelRefProcEnabled"]));
        if pre_touch {
            f.push("-XX:+AlwaysPreTouch".into());
        }
        f.push("-XX:MaxInlineLevel=15".into());
        return ServerFlags { xms: xmx, flags: f, note: None };
    }
    let mut note = None;
    if profile == "zgc" {
        if java_major >= 21 {
            let mut f = base;
            f.push("-XX:+UseZGC".into());
            if java_major < 23 {
                f.push("-XX:+ZGenerational".into());
            }
            f.extend(s(&["-XX:+DisableExplicitGC", "-XX:+PerfDisableSharedMem"]));
            if pre_touch {
                f.push("-XX:+AlwaysPreTouch".into());
            }
            return ServerFlags { xms: xmx, flags: f, note: None };
        }
        note = Some(format!("ZGC wymaga Javy 21+ (jest {java_major}) – użyto flag Aikara."));
    }
    let big = xmx >= 12 * GB;
    let mut f = base;
    f.extend(s(&["-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200", "-XX:+DisableExplicitGC"]));
    f.push(format!("-XX:G1NewSizePercent={}", if big { 40 } else { 30 }));
    f.push(format!("-XX:G1MaxNewSizePercent={}", if big { 50 } else { 40 }));
    f.push(format!("-XX:G1HeapRegionSize={}M", if big { 16 } else { 8 }));
    f.push(format!("-XX:G1ReservePercent={}", if big { 15 } else { 20 }));
    f.extend(s(&["-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4"]));
    f.push(format!("-XX:InitiatingHeapOccupancyPercent={}", if big { 20 } else { 15 }));
    f.extend(s(&[
        "-XX:G1MixedGCLiveThresholdPercent=90",
        "-XX:G1RSetUpdatingPauseTimePercent=5",
        "-XX:SurvivorRatio=32",
        "-XX:+PerfDisableSharedMem",
        "-XX:MaxTenuringThreshold=1",
        "-Dusing.aikars.flags=https://mcflags.emc.gs",
        "-Daikars.new.flags=true",
    ]));
    if pre_touch {
        f.push("-XX:+AlwaysPreTouch".into());
    }
    let half = ((xmx as f64 / 2.0 / 512.0).round() as u64 * 512).max(1024);
    ServerFlags { xms: if pre_touch { xmx } else { xmx.min(half) }, flags: f, note }
}

/// Full JVM arguments for a server: memory + profile flags merged with the owner's own (theirs win).
pub fn server_jvm_args(profile: &str, memory_mb: u64, java_major: u32, proxy: bool, free_mb: u64, user_args: &str) -> Vec<String> {
    let f = server_flags(profile, memory_mb, java_major, proxy, free_mb);
    let xmx = if memory_mb == 0 { 2048 } else { memory_mb.max(512) };
    merge_args(&Memory { xmx, xms: f.xms, auto: false, big: false }, &f.flags, &split_args(user_args))
}

#[cfg(test)]
mod tests {
    /// mods-servers.test.js: Aikar flags, ZGC on Java 21+, proxy flags, owner arguments win.
    #[test]
    fn server_profiles() {
        use super::*;
        let a = server_jvm_args("aikar", 4096, 21, false, 0, "");
        assert!(a.contains(&"-Xmx4096M".into()) && a.contains(&"-Xms2048M".into()));
        assert!(a.contains(&"-XX:G1HeapRegionSize=8M".into()) && a.contains(&"-Dusing.aikars.flags=https://mcflags.emc.gs".into()));
        let pre = server_flags("aikar", 4096, 21, false, 16000);
        assert_eq!(pre.xms, 4096);
        assert!(pre.flags.contains(&"-XX:+AlwaysPreTouch".into()));
        assert!(server_flags("aikar", 16384, 21, false, 0).flags.contains(&"-XX:G1HeapRegionSize=16M".into()));
        assert!(server_flags("zgc", 2048, 21, false, 0).flags.contains(&"-XX:+ZGenerational".into()));
        let old = server_flags("zgc", 2048, 17, false, 0);
        assert!(old.flags.contains(&"-XX:+UseG1GC".into()) && old.note.is_some());
        assert!(server_flags("aikar", 2048, 21, true, 0).flags.contains(&"-XX:MaxInlineLevel=15".into()));
        assert_eq!(server_jvm_args("basic", 3072, 21, false, 0, ""), vec!["-Xmx3072M", "-Xms1024M"]);
        let own = server_jvm_args("aikar", 4096, 21, false, 0, "-XX:+UseZGC -Xmx6G");
        assert!(own.contains(&"-XX:+UseZGC".into()) && own.contains(&"-Xmx6G".into()));
        assert!(!own.contains(&"-XX:+UseG1GC".into()) && !own.contains(&"-Xmx4096M".into()));
    }

    // Port of launcher/test/jvm.test.js.
    use super::*;

    fn opts(mods: u64, loader: &str, total: u64) -> Opts {
        Opts { mods, loader: loader.into(), total_mb: total, ..Default::default() }
    }

    #[test]
    fn memory_sized_by_mods_and_capped_by_ram() {
        assert_eq!(auto_memory_mb(0, "vanilla", 16 * GB, false), 2 * GB);
        assert_eq!(auto_memory_mb(10, "fabric", 16 * GB, false), 3 * GB);
        assert_eq!(auto_memory_mb(80, "fabric", 16 * GB, false), 4 * GB);
        assert_eq!(auto_memory_mb(220, "forge", 16 * GB, false), 6 * GB);
        assert_eq!(auto_memory_mb(400, "neoforge", 32 * GB, false), 8 * GB);
        assert_eq!(auto_memory_mb(400, "forge", 8 * GB, false), 6 * GB);
        assert_eq!(max_game_mb(16 * GB), 13 * GB);
        assert_eq!(auto_memory_mb(400, "forge", 4 * GB, false), 2 * GB);
        assert!(max_game_mb(2 * GB) >= 1024);
        assert_eq!(auto_memory_mb(10, "fabric", 16 * GB, true), 4 * GB);
    }

    #[test]
    fn memory_plan_priorities() {
        let p = memory_plan(&Opts { instance_mb: 5000, settings_mb: 3000, loader: "fabric".into(), total_mb: 16 * GB, ..Default::default() });
        assert_eq!(p, Memory { xmx: 5000, xms: 1024, auto: false, big: false });
        assert_eq!(memory_plan(&Opts { settings_mb: 3072, total_mb: 16 * GB, ..Default::default() }).xmx, 3072);
        assert_eq!(memory_plan(&opts(300, "forge", 32 * GB)), Memory { xmx: 8 * GB, xms: 8 * GB, auto: true, big: true });
        let small = memory_plan(&opts(5, "fabric", 16 * GB));
        assert_eq!(small.xms, 1024);
        assert!(small.auto);
    }

    #[test]
    fn g1_flags_and_pre_touch() {
        let g = gc_flags("auto", 21, 6 * GB, 6 * GB, 12 * GB);
        assert_eq!(g.gc, "g1");
        for f in [
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:+DisableExplicitGC",
            "-XX:G1HeapRegionSize=16M",
            "-XX:G1ReservePercent=20",
            "-XX:+AlwaysPreTouch",
            "-XX:+IgnoreUnrecognizedVMOptions",
        ] {
            assert!(g.flags.iter().any(|x| x == f), "{f}");
        }
        assert!(g.flags.iter().any(|f| f.starts_with("-XX:MaxGCPauseMillis=")));
        assert!(g.flags.iter().any(|f| f.starts_with("-XX:G1NewSizePercent=")));
        assert!(!gc_flags("auto", 17, 6 * GB, 6 * GB, 7 * GB).flags.contains(&"-XX:+AlwaysPreTouch".into()));
        assert!(!gc_flags("auto", 17, 6 * GB, 1024, 30 * GB).flags.contains(&"-XX:+AlwaysPreTouch".into()));
        assert!(gc_flags("auto", 17, 2 * GB, 1024, 0).flags.contains(&"-XX:G1HeapRegionSize=4M".into()));
        assert!(gc_flags("auto", 17, 16 * GB, 1024, 0).flags.contains(&"-XX:G1HeapRegionSize=32M".into()));
    }

    #[test]
    fn zgc_generational_and_fallback() {
        let z21 = gc_flags("zgc", 21, 8 * GB, 1024, 0);
        assert_eq!(z21.gc, "zgc");
        assert!(z21.flags.contains(&"-XX:+UseZGC".into()) && z21.flags.contains(&"-XX:+ZGenerational".into()));
        assert!(!z21.flags.contains(&"-XX:+UseG1GC".into()));
        let z25 = gc_flags("zgc", 25, 8 * GB, 1024, 0);
        assert!(z25.flags.contains(&"-XX:+UseZGC".into()) && !z25.flags.contains(&"-XX:+ZGenerational".into()));
        let z17 = gc_flags("zgc", 17, 4 * GB, 1024, 0);
        assert_eq!(z17.gc, "g1");
        assert!(z17.note.unwrap().contains("Javy 21"));
        assert!(gc_flags("custom", 17, 4096, 1024, 0).flags.is_empty());
    }

    #[test]
    fn player_arguments_win() {
        let r = build_jvm_args(&Opts {
            mode: "auto".into(),
            java_major: 21,
            loader: "fabric".into(),
            total_mb: 16 * GB,
            user_args: r#"-Xmx6G -XX:+UseZGC -Dfoo="a b""#.into(),
            ..Default::default()
        });
        assert!(!r.args.iter().any(|a| a.starts_with("-Xmx") && a.ends_with('M')), "our -Xmx dropped");
        assert!(!r.args.iter().any(|a| a.starts_with("-Xms")));
        assert!(!r.args.contains(&"-XX:+UseG1GC".into()) && !r.args.iter().any(|a| a.starts_with("-XX:G1")));
        assert!(r.args.contains(&"-XX:+UseZGC".into()) && r.args.contains(&"-Xmx6G".into()) && r.args.contains(&"-Dfoo=a b".into()));
        let p =
            build_jvm_args(&Opts { mode: "g1".into(), java_major: 17, total_mb: 16 * GB, user_args: "-XX:MaxGCPauseMillis=100".into(), ..Default::default() });
        assert_eq!(p.args.iter().filter(|a| a.starts_with("-XX:MaxGCPauseMillis")).collect::<Vec<_>>(), vec!["-XX:MaxGCPauseMillis=100"]);
        let s = build_jvm_args(&Opts { mode: "custom".into(), loader: "vanilla".into(), total_mb: 16 * GB, user_args: "-Xms3G".into(), ..Default::default() });
        assert_eq!(s.args, vec!["-Xmx3072M", "-Xms3G"]);
        let c = build_jvm_args(&Opts {
            mode: "custom".into(),
            loader: "vanilla".into(),
            total_mb: 16 * GB,
            user_args: "-XX:+UseG1GC".into(),
            ..Default::default()
        });
        assert_eq!(c.args, vec!["-Xmx2048M", "-Xms1024M", "-XX:+UseG1GC"]);
        assert_eq!(build_jvm_args(&Opts { mode: "nonsense".into(), ..Default::default() }).gc, "g1");
        assert_eq!(parse_mem("-Xmx4G"), 4096);
        assert_eq!(parse_mem("-Xms512m"), 512);
        assert_eq!(split_args("-Da='x y' -Db"), vec!["-Da=x y", "-Db"]);
    }

    #[test]
    fn java_per_minecraft_version() {
        assert_eq!(required_java("1.12.2", None), 8);
        assert_eq!(required_java("1.16.5", None), 8);
        assert_eq!(required_java("1.17.1", None), 16);
        assert_eq!(required_java("1.18.2", None), 17);
        assert_eq!(required_java("1.20.4", None), 17);
        assert_eq!(required_java("1.20.5", None), 21);
        assert_eq!(required_java("1.21.1", None), 21);
        assert_eq!(required_java("26.1", None), 25);
        assert_eq!(required_java("1.21.1", Some(&serde_json::json!({ "javaVersion": { "majorVersion": 21, "component": "java-runtime-delta" } }))), 21);
        assert_eq!(required_java("24w14a", None), 21);
        assert_eq!(component_for(8), "jre-legacy");
        assert_eq!(component_for(17), "java-runtime-gamma");
        assert_eq!(component_for(21), "java-runtime-delta");
        assert_eq!(component_for(25), "java-runtime-epsilon");
        assert!(java_fits(Some(21), 17, ""));
        assert!(!java_fits(Some(17), 21, ""));
        assert!(!java_fits(Some(17), 8, "forge"));
        assert!(java_fits(Some(8), 8, "forge"));
        assert!(!java_fits(None, 8, ""));
    }
}
