//! Small pure helpers of the local server panel (port of launcher/src/main/server-tools.js):
//! scheduled restarts / backups, TPS lines, join / leave lines and console autocomplete.

use crate::js::ValueExt;
use chrono::{Local, TimeZone};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

macro_rules! re {
    ($p:expr) => {{
        static R: LazyLock<Regex> = LazyLock::new(|| Regex::new($p).unwrap());
        &*R
    }};
}

fn hhmm(s: &str) -> Option<(u32, u32, String)> {
    let c = re!(r"^(\d{1,2}):(\d{2})$").captures(s.trim())?;
    let (h, m) = (c[1].parse().ok()?, c[2].parse().ok()?);
    Some((h, m, c[1].to_string()))
}

/// Milliseconds from `now` (ms) to the next "HH:MM" (local time); None for an invalid time.
pub fn ms_until(now: i64, at: &str) -> Option<i64> {
    let (h, m, _) = hhmm(at)?;
    if h > 23 || m > 59 {
        return None;
    }
    let d = Local.timestamp_millis_opt(now).single()?;
    let mut next = Local.with_ymd_and_hms(d.year_ce().1 as i32, d.month0() + 1, d.day0() + 1, h, m, 0).earliest()?;
    if next.timestamp_millis() <= now {
        next = next.checked_add_days(chrono::Days::new(1))?;
    }
    Some(next.timestamp_millis() - now)
}

use chrono::Datelike;

/// `{ restartAt: 'HH:MM'|'', backupEveryH: 0..168, warnMinutes: 0..30 }`.
pub fn normalize_schedule(s: &Value) -> Value {
    let at = s.get("restartAt").map(crate::config_edit::js_string).unwrap_or_default();
    let restart = match hhmm(&at) {
        Some((h, m, hs)) if h < 24 && m < 60 => format!("{:0>2}:{:02}", hs, m),
        _ => String::new(),
    };
    let int = |k: &str| s.get(k).filter(|v| !v.is_null()).and_then(|v| crate::config_edit::parse_int(&crate::config_edit::js_string(v)));
    let warn = if s.get("warnMinutes").is_none_or(Value::is_null) { 5 } else { int("warnMinutes").unwrap_or(0) };
    json!({ "restartAt": restart, "backupEveryH": int("backupEveryH").unwrap_or(0).clamp(0, 168), "warnMinutes": warn.clamp(0, 30) })
}

/// Warnings before a scheduled restart: (ms before the restart, text).
pub fn restart_warnings(warn_minutes: i64) -> Vec<(i64, String)> {
    let mut out: Vec<(i64, String)> = [30, 15, 10, 5, 3, 2, 1]
        .into_iter()
        .filter(|m| *m <= warn_minutes)
        .map(|m| {
            (
                m * 60000,
                format!(
                    "Restart serwera za {m} {}",
                    if m == 1 {
                        "minutę"
                    } else if m < 5 {
                        "minuty"
                    } else {
                        "minut"
                    }
                ),
            )
        })
        .collect();
    if warn_minutes > 0 {
        out.push((10000, "Restart serwera za 10 sekund".into()));
    }
    out
}

pub fn tps_command(t: &str) -> Option<&'static str> {
    match t {
        "paper" | "purpur" | "folia" => Some("tps"),
        "neoforge" => Some("neoforge tps"),
        "forge" => Some("forge tps"),
        _ => None,
    }
}

fn num(s: &str) -> f64 {
    crate::config_edit::parse_float(s).unwrap_or(0.0)
}

/// A TPS line → `{ tps, mspt? }`.
pub fn parse_tps(line: &str) -> Option<Value> {
    let s = re!(r"§.").replace_all(line, "");
    if let Some(c) = re!(r"(?i)TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)").captures(&s) {
        return Some(json!({ "tps": crate::config_edit::coerce("float", &json!(num(&c[1]).min(20.0))) }));
    }
    if let Some(c) = re!(r"(?i)Overall\s*:\s*Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)").captures(&s) {
        return Some(json!({ "tps": crate::config_edit::coerce("float", &json!(num(&c[2]).min(20.0))), "mspt": num(&c[1]) }));
    }
    if let Some(c) = re!(r"(?i)TPS:\s*([\d.]+).*MSPT:\s*([\d.]+)").captures(&s) {
        return Some(json!({ "tps": crate::config_edit::coerce("float", &json!(num(&c[1]).min(20.0))), "mspt": num(&c[2]) }));
    }
    None
}

pub fn is_tps_noise(line: &str) -> bool {
    re!(r"(?i)TPS from last 1m|Mean tick time|Server Health Report|^\s*(\[[^\]]*\]\s*)*(Dim|Overall)\b.*Mean TPS|Region #|Lowest Region TPS|Median Region TPS|Highest Region TPS|Utilisation").is_match(line)
}

/// Join / leave events: `{ join }` | `{ leave }` (vanilla, Paper, Velocity, BungeeCord).
pub fn player_event(line: &str) -> Option<Value> {
    let joins = [
        re!(r": (\w{3,16}) joined the game"),
        re!(r"\[connected player\] (\w{3,16}) \(.*\) has connected"),
        re!(r"\[(\w{3,16}),.*\] <-> InitialHandler has connected"),
        re!(r"\[(\w{3,16})\] <-> ServerConnector \[.*\] has connected"),
    ];
    for r in joins {
        if let Some(c) = r.captures(line) {
            return Some(json!({ "join": &c[1] }));
        }
    }
    let leaves = [
        re!(r": (\w{3,16}) left the game"),
        re!(r"\[connected player\] (\w{3,16}) \(.*\) has disconnected"),
        re!(r"\[(\w{3,16})\] -> UpstreamBridge has disconnected"),
        re!(r"\[(\w{3,16})\] disconnected with"),
    ];
    for r in leaves {
        if let Some(c) = r.captures(line) {
            return Some(json!({ "leave": &c[1] }));
        }
    }
    None
}

pub fn is_ready_line(line: &str) -> bool {
    re!(r"Done \(.*\)!").is_match(line) || re!(r"Listening on /[\d.:]+").is_match(line)
}

const COMMON: &[(&str, &str)] = &[
    ("help", ""),
    ("list", ""),
    ("say", "<wiadomość>"),
    ("tell", "<gracz> <wiadomość>"),
    ("msg", "<gracz> <wiadomość>"),
    ("me", "<akcja>"),
    ("op", "<gracz>"),
    ("deop", "<gracz>"),
    ("kick", "<gracz> [powód]"),
    ("ban", "<gracz> [powód]"),
    ("ban-ip", "<ip|gracz>"),
    ("pardon", "<gracz>"),
    ("pardon-ip", "<ip>"),
    ("banlist", ""),
    ("whitelist", "add|remove|on|off|list|reload"),
    ("gamemode", "survival|creative|adventure|spectator [gracz]"),
    ("defaultgamemode", "<tryb>"),
    ("difficulty", "peaceful|easy|normal|hard"),
    ("time", "set|add|query day|night|noon|midnight"),
    ("weather", "clear|rain|thunder [czas]"),
    ("tp", "<gracz> <cel>"),
    ("teleport", "<gracz> <cel>"),
    ("give", "<gracz> <przedmiot> [ilość]"),
    ("clear", "[gracz] [przedmiot]"),
    ("kill", "[cel]"),
    ("effect", "give|clear <gracz> <efekt>"),
    ("enchant", "<gracz> <zaklęcie> [poziom]"),
    ("xp", "add|set|query <gracz> <ilość>"),
    ("experience", "add|set|query <gracz> <ilość>"),
    ("gamerule", "<reguła> [wartość]"),
    ("seed", ""),
    ("setworldspawn", "[x y z]"),
    ("spawnpoint", "[gracz] [x y z]"),
    ("worldborder", "set|center|add|get"),
    ("save-all", "[flush]"),
    ("save-on", ""),
    ("save-off", ""),
    ("stop", ""),
    ("reload", ""),
    ("locate", "structure|biome <nazwa>"),
    ("summon", "<byt> [x y z]"),
    ("setblock", "<x y z> <blok>"),
    ("fill", "<od> <do> <blok>"),
    ("execute", "…"),
    ("scoreboard", "objectives|players …"),
    ("team", "add|remove|join|leave …"),
    ("title", "<gracz> title|subtitle|actionbar <tekst>"),
    ("tellraw", "<gracz> <json>"),
    ("playsound", "<dźwięk> <źródło> <gracz>"),
    ("particle", "<cząsteczka> [x y z]"),
    ("spreadplayers", "…"),
    ("forceload", "add|remove|query"),
    ("datapack", "list|enable|disable"),
    ("function", "<funkcja>"),
    ("schedule", "function|clear …"),
    ("bossbar", "add|set|remove …"),
    ("attribute", "<cel> <atrybut> get|base …"),
    ("damage", "<cel> <ilość>"),
    ("ride", "<cel> mount|dismount"),
    ("tick", "query|rate|freeze|unfreeze|step|sprint"),
    ("debug", "start|stop"),
    ("perf", "start|stop"),
    ("jfr", "start|stop"),
    ("publish", ""),
    ("transfer", "<host> [port] [gracz]"),
];
const PAPER: &[(&str, &str)] = &[
    ("tps", ""),
    ("mspt", ""),
    ("plugins", ""),
    ("pl", ""),
    ("version", "[plugin]"),
    ("timings", "on|off|paste"),
    ("spark", "profiler|tps|health"),
    ("paper", "heap|dumpitem|entity"),
    ("restart", ""),
];
const FORGE: &[(&str, &str)] = &[("forge", "tps|track|entity|generate"), ("neoforge", "tps|track|entity|generate"), ("spark", "profiler|tps|health")];
const FABRIC: &[(&str, &str)] = &[("spark", "profiler|tps|health")];
const PROXY: &[(&str, &str)] = &[
    ("end", ""),
    ("shutdown", ""),
    ("velocity", "version|plugins|reload|dump"),
    ("server", "[serwer]"),
    ("glist", ""),
    ("send", "<gracz> <serwer>"),
    ("alert", "<wiadomość>"),
    ("find", "<gracz>"),
    ("greload", ""),
];

fn arg_values(cmd: &str) -> Option<&'static [&'static str]> {
    const MODES: &[&str] = &["survival", "creative", "adventure", "spectator"];
    const LOADER_CMDS: &[&str] = &["tps", "track", "entity", "generate"];
    Some(match cmd {
        "gamemode" | "defaultgamemode" => MODES,
        "difficulty" => &["peaceful", "easy", "normal", "hard"],
        "weather" => &["clear", "rain", "thunder"],
        "time" => &["set", "add", "query"],
        "whitelist" => &["add", "remove", "on", "off", "list", "reload"],
        "save-all" => &["flush"],
        "effect" => &["give", "clear"],
        "xp" => &["add", "set", "query"],
        "gamerule" => &[
            "keepInventory",
            "doDaylightCycle",
            "doWeatherCycle",
            "doMobSpawning",
            "mobGriefing",
            "doFireTick",
            "playersSleepingPercentage",
            "randomTickSpeed",
            "showDeathMessages",
            "announceAdvancements",
            "doImmediateRespawn",
            "naturalRegeneration",
            "spawnRadius",
            "doInsomnia",
            "doPatrolSpawning",
            "doTraderSpawning",
            "fallDamage",
            "fireDamage",
            "drowningDamage",
            "commandBlockOutput",
            "sendCommandFeedback",
            "maxEntityCramming",
            "disableRaids",
            "forgiveDeadPlayers",
            "universalAnger",
        ],
        "time set" => &["day", "night", "noon", "midnight"],
        "time add" => &["1000", "6000", "12000"],
        "forge" | "neoforge" => LOADER_CMDS,
        "tick" => &["query", "rate", "freeze", "unfreeze", "step", "sprint"],
        "datapack" => &["list", "enable", "disable"],
        "worldborder" => &["set", "center", "add", "get"],
        _ => return None,
    })
}

const PLAYER_ARG: &[&str] = &[
    "op",
    "deop",
    "kick",
    "ban",
    "pardon",
    "tell",
    "msg",
    "tp",
    "teleport",
    "give",
    "clear",
    "kill",
    "spawnpoint",
    "whitelist add",
    "whitelist remove",
    "gamemode survival",
    "gamemode creative",
    "gamemode adventure",
    "gamemode spectator",
    "title",
    "tellraw",
    "send",
    "find",
    "effect give",
    "effect clear",
    "xp add",
    "xp set",
    "xp query",
];

pub fn commands_for(t: &str) -> Vec<(&'static str, &'static str)> {
    if t == "velocity" || t == "bungeecord" {
        return PROXY.to_vec();
    }
    let extra: &[(&str, &str)] = match t {
        "paper" | "purpur" | "folia" => PAPER,
        "forge" | "neoforge" => FORGE,
        "fabric" | "quilt" => FABRIC,
        _ => &[],
    };
    COMMON.iter().chain(extra.iter()).copied().collect()
}

/// Suggestions for the console input: `[{ value, label, hint }]` (value is the whole new input).
pub fn complete(input: &str, t: &str, players: &[String], history: &[String]) -> Vec<Value> {
    let text = input.strip_prefix('/').unwrap_or(input);
    let words: Vec<&str> = text.split(' ').collect();
    let last = words.last().copied().unwrap_or("").to_lowercase();
    let head = &words[..words.len() - 1];
    let mut out: Vec<Value> = Vec::new();
    let add = |out: &mut Vec<Value>, word: &str, hint: &str| {
        let mut parts: Vec<&str> = head.to_vec();
        parts.push(word);
        let value = parts.join(" ");
        if value != text && !out.iter().any(|o| o.str_of("value") == Some(&value)) {
            out.push(json!({ "value": value, "label": word, "hint": hint }));
        }
    };
    if head.is_empty() {
        for h in history.iter().rev() {
            if h.to_lowercase().starts_with(&text.to_lowercase()) && h != text && out.len() < 3 {
                out.push(json!({ "value": h, "label": h, "hint": "historia" }));
            }
        }
        for (c, hint) in commands_for(t) {
            if c.starts_with(&last) {
                add(&mut out, c, hint);
            }
        }
        out.truncate(12);
        return out;
    }
    let cmd = head.join(" ").to_lowercase();
    for v in arg_values(&cmd).unwrap_or(&[]) {
        if v.to_lowercase().starts_with(&last) {
            add(&mut out, v, "");
        }
    }
    let first2 = head.iter().take(2).copied().collect::<Vec<_>>().join(" ").to_lowercase();
    if PLAYER_ARG.contains(&cmd.as_str())
        || (head.len() >= 2 && PLAYER_ARG.contains(&first2.as_str()))
        || (PLAYER_ARG.contains(&head[0].to_lowercase().as_str()) && head.len() == 1)
    {
        for p in players {
            if p.to_lowercase().starts_with(&last) {
                add(&mut out, p, "gracz");
            }
        }
        for sel in ["@a", "@p", "@r", "@s", "@e"] {
            if sel.starts_with(&last) && last.starts_with('@') {
                add(&mut out, sel, "selektor");
            }
        }
    }
    out.truncate(12);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mods-servers.test.js: schedule, TPS lines, join / leave on proxies, console autocomplete.
    #[test]
    fn tools() {
        let now = Local.with_ymd_and_hms(2026, 10, 31, 3, 50, 0).unwrap().timestamp_millis();
        assert_eq!(ms_until(now, "04:00"), Some(10 * 60000));
        assert_eq!(ms_until(now, "03:50"), Some(24 * 3600000));
        assert_eq!(ms_until(now, "25:00"), None);
        assert_eq!(
            normalize_schedule(&json!({ "restartAt": "4:05", "backupEveryH": "500", "warnMinutes": 99 })),
            json!({ "restartAt": "04:05", "backupEveryH": 168, "warnMinutes": 30 })
        );
        assert_eq!(normalize_schedule(&json!({ "restartAt": "x" })), json!({ "restartAt": "", "backupEveryH": 0, "warnMinutes": 5 }));
        assert_eq!(restart_warnings(5).iter().map(|w| w.0).collect::<Vec<_>>(), vec![300000, 180000, 120000, 60000, 10000]);
        assert_eq!(parse_tps("[12:00:00 INFO]: §6TPS from last 1m, 5m, 15m: §a*20.0, §a19.97, §a19.99"), Some(json!({ "tps": 20 })));
        assert_eq!(parse_tps("[Server thread/INFO]: Overall: Mean tick time: 4.512 ms. Mean TPS: 20.000"), Some(json!({ "tps": 20, "mspt": 4.512 })));
        assert_eq!(parse_tps("hello"), None);
        assert!(is_tps_noise("TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0") && !is_tps_noise("Steve joined the game"));
        assert_eq!(tps_command("paper"), Some("tps"));
        assert_eq!(tps_command("vanilla"), None);
        assert_eq!(player_event("[Server thread/INFO]: Steve joined the game"), Some(json!({ "join": "Steve" })));
        assert_eq!(player_event("[INFO]: [connected player] Alex (/1.2.3.4:5) has connected"), Some(json!({ "join": "Alex" })));
        assert_eq!(player_event("[INFO]: Steve left the game"), Some(json!({ "leave": "Steve" })));
        assert!(is_ready_line("[INFO]: Done (1.23s)!") && is_ready_line("Listening on /0.0.0.0:25577"));
        let vals = |v: Vec<Value>| v.iter().map(|s| s["value"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        let c1 = vals(complete("gam", "paper", &[], &[]));
        assert!(c1.contains(&"gamemode".into()) && c1.contains(&"gamerule".into()));
        assert_eq!(vals(complete("gamemode cr", "paper", &[], &[])), vec!["gamemode creative"]);
        assert_eq!(vals(complete("op St", "paper", &["Steve".into(), "Alex".into()], &[])), vec!["op Steve"]);
        assert_eq!(vals(complete("time set n", "paper", &[], &[])), vec!["time set night", "time set noon"]);
        assert_eq!(complete("t", "paper", &[], &["tp Steve Alex".into()])[0]["value"], "tp Steve Alex");
        assert!(vals(complete("en", "velocity", &[], &[])).contains(&"end".into()));
        assert!(!vals(complete("tp", "vanilla", &[], &[])).contains(&"tps".into()));
    }
}
