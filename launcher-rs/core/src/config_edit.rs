//! Config files as simple forms (port of launcher/src/main/config-edit.js): TOML, .properties,
//! strict JSON and Forge's old .cfg. Parsing keeps every line, so saving a form changes only the
//! edited values. Pure – no file system here.
//!
//! Field (JSON for the renderer): `{ key, section, name, type: bool|int|float|string|array|raw, value, line, endLine, comment }`.

use crate::error::{msg, Result};
use crate::js::{js_f64, js_number};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::LazyLock;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pat).unwrap());
    };
}

pub fn format_of(file: &str) -> Option<&'static str> {
    let ext = file.to_lowercase().rsplit('.').next().unwrap_or("").to_string();
    Some(match ext.as_str() {
        "toml" => "toml",
        "properties" | "txt" => "properties",
        "json" | "json5" => "json",
        "cfg" => "cfg",
        _ => return None,
    })
}

/// `String(v)` of JavaScript.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number(n),
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(|x| if x.is_null() { String::new() } else { js_string(x) }).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `parseInt(String(v), 10)`.
pub fn parse_int(s: &str) -> Option<i64> {
    re!(R, r"^\s*([+-]?\d+)");
    R.captures(s).and_then(|c| c[1].parse().ok())
}

/// `parseFloat(String(v))`.
pub fn parse_float(s: &str) -> Option<f64> {
    re!(R, r"^\s*([+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)");
    R.captures(s).and_then(|c| c[1].parse().ok())
}

fn num(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9e15 {
        json!(f as i64)
    } else {
        json!(f)
    }
}

/// Splits "value # comment" while respecting quoted strings.
pub fn split_comment(s: &str) -> (String, String) {
    let chars: Vec<char> = s.chars().collect();
    let mut q: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(qc) = q {
            if c == '\\' && qc == '"' {
                i += 1;
            } else if c == qc {
                q = None;
            }
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            q = Some(c);
        } else if c == '#' {
            let head: String = chars[..i].iter().collect();
            return (head.trim_end().to_string(), chars[i..].iter().collect());
        }
        i += 1;
    }
    (s.trim_end().to_string(), String::new())
}

/// One TOML value: (type, value).
pub fn toml_value(raw: &str) -> (&'static str, Value) {
    re!(INT, r"^[+-]?\d[\d_]*$");
    re!(FLOAT, r"^[+-]?(\d[\d_]*)?\.\d+([eE][+-]?\d+)?$|^[+-]?\d+[eE][+-]?\d+$|^[+-]?\d+\.\d*$");
    re!(DQ, r#"^"(?:[^"\\]|\\.)*"$"#);
    re!(SQ, r"^'[^']*'$");
    let v = raw.trim();
    if v == "true" || v == "false" {
        return ("bool", json!(v == "true"));
    }
    if INT.is_match(v) {
        if let Ok(n) = v.replace('_', "").parse::<i64>() {
            return ("int", json!(n));
        }
    }
    if FLOAT.is_match(v) {
        if let Ok(f) = v.replace('_', "").parse::<f64>() {
            return ("float", num(f));
        }
    }
    if DQ.is_match(v) {
        if let Ok(Value::String(s)) = serde_json::from_str::<Value>(&v.replace("\\'", "'")) {
            return ("string", json!(s));
        }
    }
    if SQ.is_match(v) {
        return ("string", json!(&v[1..v.len() - 1]));
    }
    if v.starts_with('[') && v.ends_with(']') && v.len() >= 2 {
        let inner = v[1..v.len() - 1].trim();
        if inner.is_empty() {
            return ("array", json!([]));
        }
        let mut items = Vec::new();
        let (mut q, mut cur, mut depth) = (None::<char>, String::new(), 0i32);
        for c in inner.chars() {
            if let Some(qc) = q {
                cur.push(c);
                if c == qc {
                    q = None;
                }
                continue;
            }
            if c == '"' || c == '\'' {
                q = Some(c);
                cur.push(c);
                continue;
            }
            if c == '[' {
                depth += 1;
            }
            if c == ']' {
                depth -= 1;
            }
            if c == ',' && depth == 0 {
                items.push(std::mem::take(&mut cur));
                continue;
            }
            cur.push(c);
        }
        if !cur.trim().is_empty() {
            items.push(cur);
        }
        let vals: Vec<(&str, Value)> = items.iter().map(|i| toml_value(i)).collect();
        if vals.iter().all(|(t, _)| *t != "raw" && *t != "array") {
            return ("array", Value::Array(vals.into_iter().map(|(_, v)| v).collect()));
        }
    }
    ("raw", json!(v))
}

pub fn toml_format(t: &str, value: &Value) -> String {
    match t {
        "bool" => if value.as_bool() == Some(true) { "true" } else { "false" }.into(),
        "int" => format!("{}", value.as_f64().unwrap_or(0.0).trunc() as i64),
        "float" => {
            let n = value.as_f64().unwrap_or(0.0);
            if n.fract() == 0.0 {
                format!("{n:.1}")
            } else {
                js_f64(n)
            }
        }
        "string" => serde_json::to_string(&js_string(value)).unwrap_or_default(),
        "array" => {
            let items: Vec<String> = value
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|v| if v.is_string() { serde_json::to_string(v).unwrap_or_default() } else { js_string(v) })
                .collect();
            format!("[{}]", items.join(", "))
        }
        _ => js_string(value),
    }
}

fn balanced(s: &str) -> bool {
    let (mut depth, mut q) = (0i32, None::<char>);
    for c in s.chars() {
        if let Some(qc) = q {
            if c == qc {
                q = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => q = Some(c),
            '[' => depth += 1,
            ']' => depth -= 1,
            _ => {}
        }
    }
    depth <= 0
}

fn split_lines(text: &str) -> Vec<String> {
    re!(NL, r"\r?\n");
    NL.split(text).map(String::from).collect()
}

/// A TOML table: `[name]` / `[[name]]` with its plain values.
#[derive(Clone, Debug)]
pub struct Table {
    pub name: String,
    pub array: bool,
    pub values: Map<String, Value>,
}

pub struct Parsed {
    pub lines: Vec<String>,
    pub fields: Vec<Value>,
}

/// TOML text → lines, fields and tables.
pub fn parse_toml(text: &str) -> (Parsed, Vec<Table>) {
    re!(ARR, r"^\[\[\s*([^\]]+?)\s*\]\]");
    re!(TAB, r"^\[\s*([^\]]+?)\s*\]");
    re!(KV, r#"^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$"#);
    re!(HASHES, r"^#+\s?");
    re!(TRAIL, r",\s*\]$");
    let lines = split_lines(text);
    let mut fields = Vec::new();
    let mut tables = vec![Table { name: String::new(), array: false, values: Map::new() }];
    let mut section = String::new();
    let mut comment: Vec<String> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let l = lines[i].trim();
        if l.is_empty() {
            comment.clear();
            i += 1;
            continue;
        }
        if l.starts_with('#') {
            comment.push(HASHES.replace(l, "").to_string());
            i += 1;
            continue;
        }
        if let Some(c) = ARR.captures(l) {
            section = c[1].to_string();
            tables.push(Table { name: section.clone(), array: true, values: Map::new() });
            comment.clear();
            i += 1;
            continue;
        }
        if let Some(c) = TAB.captures(l) {
            section = c[1].to_string();
            tables.push(Table { name: section.clone(), array: false, values: Map::new() });
            comment.clear();
            i += 1;
            continue;
        }
        let Some(c) = KV.captures(l) else {
            comment.clear();
            i += 1;
            continue;
        };
        let (mut value_part, _) = split_comment(&c[2]);
        let mut end = i;
        if value_part.starts_with('[') && !balanced(&value_part) {
            while end + 1 < lines.len() && !balanced(&value_part) {
                end += 1;
                value_part.push(' ');
                value_part.push_str(&split_comment(lines[end].trim()).0);
            }
        } else if value_part.starts_with("\"\"\"") || value_part.starts_with("'''") {
            let d = value_part[..3].to_string();
            while end + 1 < lines.len() && value_part[3..].find(&d).is_none() {
                end += 1;
                value_part.push('\n');
                value_part.push_str(&lines[end]);
            }
        }
        let name = c[1].trim_matches(|ch| ch == '"' || ch == '\'').to_string();
        let (t, v) = if value_part.starts_with("\"\"\"") || value_part.starts_with("'''") {
            ("raw", json!(value_part))
        } else {
            toml_value(&TRAIL.replace(&value_part, "]"))
        };
        if let Some(last) = tables.last_mut() {
            last.values.insert(name.clone(), v.clone());
        }
        let key = if section.is_empty() { name.clone() } else { format!("{section}.{name}") };
        fields.push(json!({ "key": key, "section": section, "name": name, "type": t, "value": v, "line": i, "endLine": end, "comment": comment.join("\n") }));
        comment.clear();
        i = end + 1;
    }
    (Parsed { lines, fields }, tables)
}

pub fn unescape_prop(v: &str) -> String {
    re!(U, r"\\u([0-9a-fA-F]{4})");
    re!(E, r"\\([:=#!\\ ])");
    let s = U.replace_all(v, |c: &regex::Captures| u32::from_str_radix(&c[1], 16).ok().and_then(char::from_u32).map(String::from).unwrap_or_default());
    let s = E.replace_all(&s, "$1");
    s.replace("\\n", "\n").replace("\\t", "\t")
}

pub fn escape_prop(v: &str) -> String {
    let s = v.replace('\\', "\\\\").replace('\n', "\\n");
    let mut out = String::new();
    for c in s.chars() {
        if (0x20..=0x7e).contains(&(c as u32)) {
            out.push(c);
        } else {
            let mut buf = [0u16; 2];
            for u in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{:04x}", u));
            }
        }
    }
    out
}

fn guess_type(raw: &str) -> &'static str {
    re!(I, r"^-?\d+$");
    re!(F, r"^-?\d+\.\d+$");
    if raw == "true" || raw == "false" {
        "bool"
    } else if I.is_match(raw) && raw.len() < 16 {
        "int"
    } else if F.is_match(raw) {
        "float"
    } else {
        "string"
    }
}

fn typed(raw: &str) -> Value {
    match guess_type(raw) {
        "bool" => json!(raw == "true"),
        "int" | "float" => num(raw.parse::<f64>().unwrap_or(0.0)),
        _ => json!(raw),
    }
}

/// server.properties style: key=value (also key: value), # and ! comments, \ escapes.
pub fn parse_properties(text: &str) -> Parsed {
    re!(A, r"^((?:\\.|[^=:\s])+)\s*[=:]\s*(.*)$");
    re!(B, r"^((?:\\.|[^=:\s])+)\s*$");
    re!(UN, r"\\(.)");
    re!(C, r"^[#!]+\s?");
    let lines = split_lines(text);
    let mut fields = Vec::new();
    let mut comment: Vec<String> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let l = line.trim();
        if l.is_empty() {
            comment.clear();
            continue;
        }
        if l.starts_with('#') || l.starts_with('!') {
            comment.push(C.replace(l, "").to_string());
            continue;
        }
        let ls = line.trim_start();
        let (name, raw) = match A.captures(ls) {
            Some(c) => (c[1].to_string(), c[2].to_string()),
            None => match B.captures(l) {
                Some(c) => (c[1].to_string(), String::new()),
                None => continue,
            },
        };
        let name = UN.replace_all(&name, "$1").to_string();
        let raw = unescape_prop(&raw);
        fields.push(json!({ "key": name, "section": "", "name": name, "type": guess_type(&raw), "value": typed(&raw), "line": i, "endLine": i, "comment": comment.join("\n") }));
        comment.clear();
    }
    Parsed { lines, fields }
}

/// Forge 1.12 .cfg: "category {", "B:name=true", "I:count=5", "S:text=abc", "}".
pub fn parse_cfg(text: &str) -> Parsed {
    re!(CAT, r#"^"?([^"{]+?)"?\s*\{$"#);
    re!(KV, r#"^([BIDS]):"?([^"=]+)"?=(.*)$"#);
    re!(H, r"^#+\s?");
    let lines = split_lines(text);
    let mut fields = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut comment: Vec<String> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let l = line.trim();
        if l.is_empty() {
            comment.clear();
            continue;
        }
        if l.starts_with('#') {
            comment.push(H.replace(l, "").to_string());
            continue;
        }
        if let Some(c) = CAT.captures(l) {
            stack.push(c[1].trim().to_string());
            comment.clear();
            continue;
        }
        if l == "}" {
            stack.pop();
            continue;
        }
        let Some(c) = KV.captures(l) else { continue };
        let t = match &c[1] {
            "B" => "bool",
            "I" => "int",
            "D" => "float",
            _ => "string",
        };
        let value = match t {
            "bool" => json!(c[3].trim() == "true"),
            "string" => json!(&c[3]),
            _ => c[3].trim().parse::<f64>().map(num).unwrap_or(Value::Null),
        };
        let section = stack.join(".");
        let key = if section.is_empty() { c[2].to_string() } else { format!("{section}.{}", &c[2]) };
        fields.push(json!({ "key": key, "section": section, "name": &c[2], "type": t, "value": value, "line": i, "endLine": i, "comment": comment.join("\n"), "prefix": &c[1] }));
        comment.clear();
    }
    Parsed { lines, fields }
}

/// Strict JSON only (comments make it a text-only file); nested objects flatten to dotted keys.
pub fn parse_json(text: &str) -> Option<(Value, Vec<Value>)> {
    let data: Value = serde_json::from_str(text).ok()?;
    let mut fields = Vec::new();
    fn walk(obj: &Map<String, Value>, prefix: &str, fields: &mut Vec<Value>) {
        for (k, v) in obj {
            let key = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
            if let Value::Object(o) = v {
                walk(o, &key, fields);
                continue;
            }
            let t = match v {
                Value::Bool(_) => "bool",
                Value::Number(n) => {
                    if n.as_f64().is_some_and(|f| f.fract() == 0.0) {
                        "int"
                    } else {
                        "float"
                    }
                }
                Value::String(_) => "string",
                Value::Array(a) if a.iter().all(|x| !x.is_object() && !x.is_array()) => "array",
                _ => "raw",
            };
            let value = if t == "raw" { json!(crate::js::stringify(v)) } else { v.clone() };
            let mut path: Vec<String> = if prefix.is_empty() { vec![] } else { prefix.split('.').map(String::from).collect() };
            path.push(k.clone());
            fields.push(json!({ "key": key, "section": prefix, "name": k, "type": t, "value": value, "path": path, "comment": "" }));
        }
    }
    if let Value::Object(o) = &data {
        walk(o, "", &mut fields);
    }
    Some((data, fields))
}

/// Text → `{ format, fields, editable }` (editable false = only the raw text editor).
pub fn parse(file: &str, text: &str) -> Value {
    let format = format_of(file);
    let fields = match format {
        Some("toml") => parse_toml(text).0.fields,
        Some("properties") => parse_properties(text).fields,
        Some("cfg") => parse_cfg(text).fields,
        Some("json") => match parse_json(text) {
            Some((_, f)) => f,
            None => return json!({ "format": format, "fields": [], "editable": false }),
        },
        _ => return json!({ "format": null, "fields": [], "editable": false }),
    };
    let editable = !fields.is_empty();
    json!({ "format": format, "fields": fields, "editable": editable })
}

/// Coerces a form value to the field's type (strings from inputs → numbers / booleans).
pub fn coerce(t: &str, v: &Value) -> Value {
    match t {
        "bool" => json!(v == &json!(true) || v == &json!("true") || v == &json!("on")),
        "int" => json!(parse_int(&js_string(v)).unwrap_or(0)),
        "float" => num(parse_float(&js_string(v).replacen(',', ".", 1)).unwrap_or(0.0)),
        "array" => {
            if v.is_array() {
                return v.clone();
            }
            if let Ok(Value::Array(a)) = serde_json::from_str::<Value>(&js_string(v)) {
                return Value::Array(a);
            }
            Value::Array(js_string(v).split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| json!(s)).collect())
        }
        _ => json!(js_string(v)),
    }
}

/// `JSON.stringify(v, null, indent)`.
pub fn pretty(v: &Value, indent: &str) -> String {
    fn w(out: &mut String, v: &Value, indent: &str, level: usize) {
        match v {
            Value::Array(a) if !a.is_empty() => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    out.push_str(if i > 0 { ",\n" } else { "\n" });
                    out.push_str(&indent.repeat(level + 1));
                    w(out, x, indent, level + 1);
                }
                out.push('\n');
                out.push_str(&indent.repeat(level));
                out.push(']');
            }
            Value::Object(o) if !o.is_empty() => {
                out.push('{');
                for (i, (k, x)) in o.iter().enumerate() {
                    out.push_str(if i > 0 { ",\n" } else { "\n" });
                    out.push_str(&indent.repeat(level + 1));
                    out.push_str(&crate::js::stringify(&json!(k)));
                    out.push_str(": ");
                    w(out, x, indent, level + 1);
                }
                out.push('\n');
                out.push_str(&indent.repeat(level));
                out.push('}');
            }
            other => out.push_str(&crate::js::stringify(other)),
        }
    }
    let mut out = String::new();
    w(&mut out, v, indent, 0);
    out
}

/// Applies `{ key: newValue }` to the text, changing only those values.
pub fn apply(file: &str, text: &str, changes: &Map<String, Value>) -> Result<String> {
    re!(KEYPART, r"^[^=]*=[ \t]*");
    re!(BEFORE_EQ, r"^[^=]*=");
    re!(PROPKEY, r"^(\s*(?:\\.|[^=:\s])+\s*[=:]\s*)");
    re!(EQREST, r"=.*$");
    re!(JSON_INDENT, r#"\n(\s+)""#);
    let format = format_of(file);
    if changes.is_empty() {
        return Ok(text.to_string());
    }
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    if format == Some("json") {
        let (mut data, fields) = parse_json(text).ok_or_else(|| msg("Ten plik JSON ma komentarze – edytuj go jako tekst."))?;
        for f in &fields {
            let key = f["key"].as_str().unwrap_or("");
            let Some(ch) = changes.get(key) else { continue };
            let path: Vec<&str> = f["path"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let t = f["type"].as_str().unwrap_or("raw");
            let new = if t == "raw" { serde_json::from_str(&js_string(ch)).map_err(|_| msg("Nieprawidłowy JSON"))? } else { coerce(t, ch) };
            let mut o = &mut data;
            for p in &path[..path.len().saturating_sub(1)] {
                o = &mut o[*p];
            }
            if let Some(last) = path.last() {
                o[*last] = new;
            }
        }
        let indent = JSON_INDENT.captures(text).map(|c| c[1].to_string()).unwrap_or_else(|| "  ".into());
        let ind = if indent.contains('\t') { "\t".to_string() } else { " ".repeat(indent.len().min(10)) };
        return Ok(pretty(&data, &ind) + if text.ends_with('\n') { "\n" } else { "" });
    }
    let parsed = match format {
        Some("toml") => parse_toml(text).0,
        Some("cfg") => parse_cfg(text),
        _ => parse_properties(text),
    };
    let mut lines = parsed.lines.clone();
    let mut edits: Vec<&Value> = parsed.fields.iter().filter(|f| changes.contains_key(f["key"].as_str().unwrap_or(""))).collect();
    edits.sort_by_key(|f| std::cmp::Reverse(f["line"].as_u64().unwrap_or(0)));
    for f in edits {
        let v = &changes[f["key"].as_str().unwrap_or("")];
        let li = f["line"].as_u64().unwrap_or(0) as usize;
        let end = f["endLine"].as_u64().unwrap_or(li as u64) as usize;
        let t = f["type"].as_str().unwrap_or("string");
        let name = f["name"].as_str().unwrap_or("");
        let line = lines[li].clone();
        let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
        match format {
            Some("toml") => {
                let (_, trailing) = split_comment(&BEFORE_EQ.replace(&lines[end], ""));
                let key_part = KEYPART.find(&line).map(|m| m.as_str().to_string()).unwrap_or_else(|| format!("{indent}{name} = "));
                let val = if t == "raw" { js_string(v) } else { toml_format(t, &coerce(t, v)) };
                let tail = if !trailing.is_empty() && end == li { format!(" {trailing}") } else { String::new() };
                lines.splice(li..=end, [format!("{key_part}{val}{tail}")]);
            }
            Some("cfg") => {
                let val = js_string(&coerce(t, v));
                lines[li] = EQREST.replace(&line, format!("={}", val.replace('$', "$$"))).to_string();
            }
            _ => {
                let val = if t == "bool" {
                    js_string(&coerce("bool", v))
                } else if t == "string" {
                    escape_prop(&js_string(v))
                } else {
                    escape_prop(&js_string(&coerce(t, v)))
                };
                let head = PROPKEY.captures(&line).map(|c| c[1].to_string()).unwrap_or_else(|| format!("{indent}{name}="));
                lines[li] = format!("{head}{val}");
            }
        }
    }
    if format == Some("properties") {
        let have: std::collections::HashSet<&str> = parsed.fields.iter().filter_map(|f| f["key"].as_str()).collect();
        let add: Vec<(&String, &Value)> = changes.iter().filter(|(k, _)| !have.contains(k.as_str())).collect();
        if !add.is_empty() {
            while lines.last().is_some_and(|l| l.is_empty()) {
                lines.pop();
            }
            for (k, v) in add {
                let val = if let Value::String(s) = v { escape_prop(s) } else { js_string(v) };
                lines.push(format!("{k}={val}"));
            }
            lines.push(String::new());
        }
    }
    Ok(lines.join(eol))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ch(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    fn field<'a>(r: &'a Value, key: &str) -> &'a Value {
        r["fields"].as_array().unwrap().iter().find(|f| f["key"] == key).unwrap()
    }

    /// mods-servers.test.js: TOML fields keep comments, sections and formatting when one value changes.
    #[test]
    fn toml_keeps_formatting() {
        let text = [
            "# Client settings",
            "[client]",
            "\t# Show the HUD",
            "\tshowHud = true # inline",
            "\tscale = 1.5",
            "",
            "[server]",
            "\tname = \"Nore\"",
            "\tlist = [\"a\", \"b\",",
            "\t  \"c\"]",
            "\tmax = 20",
        ]
        .join("\n");
        let r = parse("x.toml", &text);
        assert_eq!(r["editable"], true);
        assert_eq!(field(&r, "client.showHud")["value"], true);
        assert_eq!(field(&r, "client.showHud")["comment"], "Show the HUD");
        assert_eq!(field(&r, "client.scale")["type"], "float");
        assert_eq!(field(&r, "server.list")["value"], json!(["a", "b", "c"]));
        let out = apply("x.toml", &text, &ch(json!({ "client.showHud": false, "server.max": "32", "server.name": "Nore \"2\"" }))).unwrap();
        assert!(out.lines().any(|l| l == "\tshowHud = false # inline"), "{out}");
        assert!(out.lines().any(|l| l == "\tmax = 32"));
        assert!(out.lines().any(|l| l == "\tname = \"Nore \\\"2\\\"\""));
        assert!(out.contains("# Client settings") && out.contains("\"c\"]"));
        let out2 = apply("x.toml", &text, &ch(json!({ "server.list": "x, y" }))).unwrap();
        assert!(out2.lines().any(|l| l == "\tlist = [\"x\", \"y\"]"), "{out2}");
        assert_eq!(field(&parse("x.toml", &out2), "server.max")["value"], 20);
    }

    /// mods-servers.test.js: properties, Forge .cfg and JSON (JSON with comments is text-only).
    #[test]
    fn properties_cfg_json() {
        let p = "#c\nfoo=bar\nn: 5\nflag=true\n";
        let r = parse("a.properties", p);
        let kv: Vec<(Value, Value)> = r["fields"].as_array().unwrap().iter().map(|f| (f["key"].clone(), f["value"].clone())).collect();
        assert_eq!(kv, vec![(json!("foo"), json!("bar")), (json!("n"), json!(5)), (json!("flag"), json!(true))]);
        assert_eq!(apply("a.properties", p, &ch(json!({ "n": 7, "flag": false, "added": "x" }))).unwrap(), "#c\nfoo=bar\nn: 7\nflag=false\nadded=x\n");
        let c = "general {\n    # Enables\n    B:enabled=true\n    I:count=3\n}\n";
        assert_eq!(parse("a.cfg", c)["fields"][0]["key"], "general.enabled");
        assert_eq!(apply("a.cfg", c, &ch(json!({ "general.count": "9" }))).unwrap(), c.replace("count=3", "count=9"));
        let j = "{\n  \"a\": { \"b\": 1, \"c\": \"x\" },\n  \"list\": [1, 2]\n}\n";
        let keys: Vec<Value> = parse("a.json", j)["fields"].as_array().unwrap().iter().map(|f| f["key"].clone()).collect();
        assert_eq!(keys, vec![json!("a.b"), json!("a.c"), json!("list")]);
        let out = apply("a.json", j, &ch(json!({ "a.b": "5", "list": "[3]" }))).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&out).unwrap(), json!({ "a": { "b": 5, "c": "x" }, "list": [3] }));
        assert_eq!(out, "{\n  \"a\": {\n    \"b\": 5,\n    \"c\": \"x\"\n  },\n  \"list\": [\n    3\n  ]\n}\n");
        assert_eq!(parse("a.json", "{ // c\n \"a\": 1 }")["editable"], false);
        assert!(apply("a.json", "{ // c\n \"a\": 1 }", &ch(json!({ "a": 2 }))).is_err());
    }

    #[test]
    fn escapes_and_numbers() {
        assert_eq!(escape_prop("Zażółć\n"), "Za\\u017c\\u00f3\\u0142\\u0107\\n");
        assert_eq!(unescape_prop("Za\\u017c\\:x\\n"), "Zaż:x\n");
        assert_eq!(parse_int(" 12abc"), Some(12));
        assert_eq!(parse_float("1.5e2x"), Some(150.0));
        assert_eq!(coerce("float", &json!("2,5")), json!(2.5));
        assert_eq!(toml_format("float", &json!(3)), "3.0");
        assert_eq!(js_string(&json!([1, "a"])), "1,a");
    }
}
