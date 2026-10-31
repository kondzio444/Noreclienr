//! server.properties as a form (port of launcher/src/main/server-props.js): parse / serialize that
//! keeps comments and unknown keys, the form schema, validation, warnings and MOTD colours.

use crate::config_edit::{escape_prop, js_string, parse_int, parse_properties};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::LazyLock;

pub fn schema() -> Value {
    json!([
        { "key": "motd", "label": "MOTD (opis na liście serwerów)", "type": "motd", "group": "general", "max": 120 },
        { "key": "max-players", "label": "Maks. graczy", "type": "int", "min": 1, "max": 1000, "group": "general" },
        { "key": "gamemode", "label": "Tryb gry", "type": "enum", "options": [["survival", "Przetrwanie"], ["creative", "Kreatywny"], ["adventure", "Przygoda"], ["spectator", "Obserwator"]], "group": "game" },
        { "key": "force-gamemode", "label": "Wymuszaj tryb gry przy wejściu", "type": "bool", "group": "game" },
        { "key": "difficulty", "label": "Poziom trudności", "type": "enum", "options": [["peaceful", "Pokojowy"], ["easy", "Łatwy"], ["normal", "Normalny"], ["hard", "Trudny"]], "group": "game" },
        { "key": "hardcore", "label": "Hardcore", "type": "bool", "group": "game" },
        { "key": "pvp", "label": "PvP (walka między graczami)", "type": "bool", "group": "game" },
        { "key": "allow-flight", "label": "Zezwól na latanie (mody, elytra-glitche)", "type": "bool", "group": "game" },
        { "key": "spawn-protection", "label": "Ochrona spawnu (bloki)", "type": "int", "min": 0, "max": 1000, "def": 16, "group": "game" },
        { "key": "allow-nether", "label": "Nether", "type": "bool", "def": true, "group": "world" },
        { "key": "generate-structures", "label": "Generuj struktury", "type": "bool", "def": true, "group": "world" },
        { "key": "level-seed", "label": "Seed świata", "type": "string", "group": "world" },
        { "key": "level-type", "label": "Typ świata", "type": "enum", "options": [["minecraft:normal", "Normalny"], ["minecraft:flat", "Płaski"], ["minecraft:large_biomes", "Duże biomy"], ["minecraft:amplified", "Wzmocniony"]], "group": "world" },
        { "key": "view-distance", "label": "Zasięg widzenia (chunki)", "type": "int", "min": 3, "max": 32, "group": "perf" },
        { "key": "simulation-distance", "label": "Zasięg symulacji (chunki)", "type": "int", "min": 3, "max": 32, "group": "perf" },
        { "key": "entity-broadcast-range-percentage", "label": "Zasięg widoczności mobów (%)", "type": "int", "min": 10, "max": 1000, "def": 100, "group": "perf" },
        { "key": "max-tick-time", "label": "Watchdog: maks. czas ticku (ms, -1 = wył.)", "type": "int", "min": -1, "max": 600000, "def": 60000, "group": "perf" },
        { "key": "online-mode", "label": "Tylko konta premium (online-mode)", "type": "bool", "group": "access" },
        { "key": "white-list", "label": "Biała lista", "type": "bool", "group": "access" },
        { "key": "enforce-whitelist", "label": "Wyrzucaj spoza białej listy po jej włączeniu", "type": "bool", "group": "access" },
        { "key": "enable-command-block", "label": "Bloki poleceń", "type": "bool", "group": "access" },
        { "key": "resource-pack", "label": "Paczka zasobów serwera (URL .zip)", "type": "string", "group": "access" },
        { "key": "require-resource-pack", "label": "Wymagaj paczki zasobów", "type": "bool", "group": "access" },
    ])
}

pub fn groups() -> Value {
    json!({ "general": "Ogólne", "game": "Rozgrywka", "world": "Świat", "perf": "Wydajność", "access": "Dostęp i bezpieczeństwo" })
}

static SCHEMA: LazyLock<Value> = LazyLock::new(schema);

fn field(k: &str) -> Option<&'static Value> {
    SCHEMA.as_array()?.iter().find(|f| f["key"] == k)
}

/// Text → plain `{ key: string }` map (values unescaped).
pub fn parse(text: &str) -> Map<String, Value> {
    let mut out = Map::new();
    for f in parse_properties(text).fields {
        let v = match &f["value"] {
            Value::String(s) => s.clone(),
            other => js_string(other),
        };
        out.insert(f["key"].as_str().unwrap_or("").to_string(), json!(v));
    }
    out
}

/// Writes props into existing text, keeping comments and unknown keys.
pub fn serialize(text: &str, props: &Map<String, Value>) -> String {
    static KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\s*(?:\\.|[^=:\s])+\s*[=:]\s*)").unwrap());
    let changes: Vec<(String, String)> = props.iter().map(|(k, v)| (k.clone(), if v.is_null() { String::new() } else { js_string(v) })).collect();
    let base = if text.trim().is_empty() { "#Minecraft server properties\n" } else { text };
    let parsed = parse_properties(base);
    let mut lines = parsed.lines.clone();
    let have: Map<String, Value> = parsed.fields.iter().map(|f| (f["key"].as_str().unwrap_or("").to_string(), f["line"].clone())).collect();
    for (k, v) in &changes {
        if let Some(line) = have.get(k).and_then(Value::as_u64) {
            let l = &lines[line as usize];
            let head = KEY.captures(l).map(|c| c[1].to_string()).unwrap_or_else(|| format!("{k}="));
            lines[line as usize] = format!("{head}{}", escape_prop(v));
        }
    }
    let add: Vec<&(String, String)> = changes.iter().filter(|(k, _)| !have.contains_key(k)).collect();
    if !add.is_empty() {
        while lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        for (k, v) in add {
            lines.push(format!("{k}={}", escape_prop(v)));
        }
    }
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines.join("\n") + "\n"
}

/// Form value → stored value with limits applied: (value, error). value None = not saved.
pub fn validate(key: &str, value: &Value) -> (Option<Value>, Option<String>) {
    let Some(f) = field(key) else { return (Some(json!(js_string(value))), None) };
    let label = f["label"].as_str().unwrap_or("");
    match f["type"].as_str().unwrap_or("") {
        "bool" => (Some(json!(value == &json!(true) || value == &json!("true"))), None),
        "int" => {
            let Some(n) = parse_int(&js_string(value)) else { return (None, Some(format!("{label}: podaj liczbę"))) };
            let (min, max) = (f["min"].as_i64().unwrap_or(i64::MIN), f["max"].as_i64().unwrap_or(i64::MAX));
            if n < min || n > max {
                return (Some(json!(n.clamp(min, max))), Some(format!("{label}: zakres {min}–{max}")));
            }
            (Some(json!(n)), None)
        }
        "enum" => {
            let opts = f["options"].as_array().cloned().unwrap_or_default();
            if opts.iter().any(|o| o[0] == *value) {
                (Some(value.clone()), None)
            } else {
                (Some(opts[0][0].clone()), Some(format!("{label}: nieznana wartość")))
            }
        }
        "motd" => {
            static AMP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)&([0-9a-fk-or])").unwrap());
            static NL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\r?\n").unwrap());
            let s = AMP.replace_all(&js_string(value), "§$1").replace("\\n", "\n");
            let joined: String = NL.split(&s).take(2).collect::<Vec<_>>().join("\n").chars().take(300).collect();
            (Some(json!(joined)), None)
        }
        _ => (Some(json!(js_string(value))), None),
    }
}

/// Warnings shown above the form.
pub fn warnings(props: &Map<String, Value>) -> Vec<Value> {
    let p = |k: &str| props.get(k).filter(|v| !v.is_null()).map(js_string).unwrap_or_default();
    let mut out = Vec::new();
    if p("online-mode") == "false" {
        out.push(json!({ "level": "warn", "key": "online-mode", "text": "Tryb offline: każdy może wejść pod dowolnym nickiem (także adminów). Włącz białą listę albo plugin logowania (np. AuthMe), jeśli serwer jest publiczny." }));
    }
    if p("online-mode") == "true" {
        out.push(json!({ "level": "info", "key": "online-mode", "text": "Tylko konta premium – gracze non-premium nie wejdą na serwer." }));
    }
    if p("white-list") == "true" && p("enforce-whitelist") != "true" {
        out.push(json!({ "level": "info", "key": "enforce-whitelist", "text": "Gracze spoza białej listy, którzy są już online, zostaną do wyjścia – włącz „Wyrzucaj spoza białej listy”." }));
    }
    let vd = parse_int(&p("view-distance"));
    let sd = parse_int(&p("simulation-distance"));
    if let Some(v) = vd.filter(|v| *v > 16) {
        out.push(json!({ "level": "warn", "key": "view-distance", "text": format!("Zasięg widzenia {v} mocno obciąża serwer – 8–12 wystarcza większości serwerów.") }));
    }
    if let (Some(s), Some(v)) = (sd, vd) {
        if s > v && v != 0 {
            out.push(json!({ "level": "info", "key": "simulation-distance", "text": "Zasięg symulacji większy niż zasięg widzenia nic nie daje." }));
        }
    }
    if p("enable-command-block") == "true" && p("online-mode") == "false" {
        out.push(json!({ "level": "info", "key": "enable-command-block", "text": "Bloki poleceń na serwerze offline – pilnuj, kto ma OP." }));
    }
    out
}

fn color(code: char) -> Option<&'static str> {
    Some(match code {
        '0' => "#000000",
        '1' => "#0000aa",
        '2' => "#00aa00",
        '3' => "#00aaaa",
        '4' => "#aa0000",
        '5' => "#aa00aa",
        '6' => "#ffaa00",
        '7' => "#aaaaaa",
        '8' => "#555555",
        '9' => "#5555ff",
        'a' => "#55ff55",
        'b' => "#55ffff",
        'c' => "#ff5555",
        'd' => "#ff55ff",
        'e' => "#ffff55",
        'f' => "#ffffff",
        _ => return None,
    })
}

/// MOTD → lines of segments `{ text, color, bold, italic, underline, strike, obfuscated }`.
pub fn motd_segments(motd: &str) -> Value {
    static U: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\\u00a7").unwrap());
    static HEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^#([0-9a-f]{6})").unwrap());
    let src = U.replace_all(motd, "§").replace("\\n", "\n");
    let plain = |c: &str| json!({ "color": c, "bold": false, "italic": false, "underline": false, "strike": false, "obfuscated": false });
    let mut lines = Vec::new();
    for line in src.split('\n').take(2) {
        let chars: Vec<char> = line.chars().collect();
        let mut segs: Vec<Value> = Vec::new();
        let mut st = plain("#aaaaaa");
        let mut buf = String::new();
        let flush = |buf: &mut String, st: &Value, segs: &mut Vec<Value>| {
            if !buf.is_empty() {
                let mut s = json!({ "text": std::mem::take(buf) });
                crate::js::assign(&mut s, st);
                segs.push(s);
            }
        };
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if (c == '§' || c == '&') && i + 1 < chars.len() {
                let rest: String = chars[i + 1..].iter().collect();
                if let Some(h) = HEX.captures(&rest) {
                    flush(&mut buf, &st, &mut segs);
                    st = plain(&format!("#{}", h[1].to_lowercase()));
                    i += 8;
                    continue;
                }
                let code = chars[i + 1].to_ascii_lowercase();
                if let Some(col) = color(code) {
                    flush(&mut buf, &st, &mut segs);
                    st = plain(col);
                    i += 2;
                    continue;
                }
                let fmt = match code {
                    'l' => Some("bold"),
                    'o' => Some("italic"),
                    'n' => Some("underline"),
                    'm' => Some("strike"),
                    'k' => Some("obfuscated"),
                    _ => None,
                };
                if let Some(f) = fmt {
                    flush(&mut buf, &st, &mut segs);
                    st[f] = json!(true);
                    i += 2;
                    continue;
                }
                if code == 'r' {
                    flush(&mut buf, &st, &mut segs);
                    st = plain("#aaaaaa");
                    i += 2;
                    continue;
                }
            }
            buf.push(c);
            i += 1;
        }
        flush(&mut buf, &st, &mut segs);
        lines.push(Value::Array(segs));
    }
    Value::Array(lines)
}

pub fn motd_plain(motd: &str) -> String {
    motd_segments(motd).as_array().into_iter().flatten().map(|l| l.as_array().into_iter().flatten().map(|s| s["text"].as_str().unwrap_or("")).collect::<String>()).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_serialize() {
        let text = "#Minecraft server properties\n#Mon Jan 01\nmotd=\\u00A7aNore \\u00A7lServer\nmax-players=10\ncustom-key=keep me\nonline-mode=false\n";
        let p = parse(text);
        assert_eq!(p["motd"], "§aNore §lServer");
        assert_eq!(p["custom-key"], "keep me");
        let out = serialize(text, json!({ "motd": "§cHej\nDruga linia", "max-players": 20, "pvp": false }).as_object().unwrap());
        assert!(out.starts_with("#Minecraft server properties\n#Mon Jan 01\n"));
        assert!(out.lines().any(|l| l == "motd=\\u00a7cHej\\nDruga linia"), "{out}");
        assert!(out.lines().any(|l| l == "max-players=20") && out.lines().any(|l| l == "custom-key=keep me") && out.lines().any(|l| l == "pvp=false"));
        assert_eq!(parse(&out)["motd"], "§cHej\nDruga linia");
        assert_eq!(serialize("", json!({ "a": 1 }).as_object().unwrap()), "#Minecraft server properties\na=1\n");
    }

    #[test]
    fn validation_warnings_colours() {
        assert_eq!(validate("view-distance", &json!("99")), (Some(json!(32)), Some("Zasięg widzenia (chunki): zakres 3–32".into())));
        assert_eq!(validate("pvp", &json!("true")), (Some(json!(true)), None));
        assert_eq!(validate("difficulty", &json!("nope")).0, Some(json!("peaceful")));
        assert_eq!(validate("motd", &json!("a\\nb\nc")).0, Some(json!("a\nb")));
        assert_eq!(validate("motd", &json!("&aZielony &lB")).0, Some(json!("§aZielony §lB")));
        let w: Vec<Value> = warnings(json!({ "online-mode": "false", "view-distance": "20", "simulation-distance": "24" }).as_object().unwrap()).iter().map(|x| x["key"].clone()).collect();
        assert_eq!(w, vec![json!("online-mode"), json!("view-distance"), json!("simulation-distance")]);
        let segs = motd_segments("§aZielony &lgruby§r zwykły &#ff8800hex\\ndruga");
        assert_eq!(segs.as_array().unwrap().len(), 2);
        let first: Vec<Value> = segs[0].as_array().unwrap().iter().map(|s| json!([s["text"], s["color"], s["bold"]])).collect();
        assert_eq!(first, vec![json!(["Zielony ", "#55ff55", false]), json!(["gruby", "#55ff55", true]), json!([" zwykły ", "#aaaaaa", false]), json!(["hex", "#ff8800", false])]);
        assert_eq!(motd_plain("§aA§lB"), "AB");
    }
}
