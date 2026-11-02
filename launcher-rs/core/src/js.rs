//! Small helpers that keep the Rust port byte-compatible with the JavaScript launcher:
//! `JSON.stringify` (signatures are computed over its output), JS-like truthiness on JSON values
//! and `Date.now()`.

use serde_json::{Map, Value};

/// `Date.now()`: milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `JSON.stringify(value)` exactly as V8 writes it (no spaces, keys in insertion order,
/// integral numbers without a fraction, the same string escapes).
pub fn stringify(v: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, v);
    out
}

fn write_value(out: &mut String, v: &Value) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&js_number(n)),
        Value::String(s) => write_string(out, s),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(out, x);
            }
            out.push(']');
        }
        Value::Object(o) => {
            out.push('{');
            for (i, (k, x)) in o.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, k);
                out.push(':');
                write_value(out, x);
            }
            out.push('}');
        }
    }
}

/// Number formatting of JavaScript (`String(n)` for the values JSON can hold).
pub fn js_number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let f = n.as_f64().unwrap_or(0.0);
    js_f64(f)
}

pub fn js_f64(f: f64) -> String {
    if !f.is_finite() {
        return "null".into();
    }
    if f == f.trunc() && f.abs() < 1e21 {
        return format!("{}", f as i128);
    }
    let abs = f.abs();
    if (1e-6..1e21).contains(&abs) {
        // Rust's shortest round-trip representation matches V8 in this range
        return format!("{f}");
    }
    // exponent form: 1e+21, 1.5e-7
    let s = format!("{f:e}");
    match s.split_once('e') {
        Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
        _ => s,
    }
}

fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Reading JSON values the way the JavaScript code does (`x.y || default`, `!!x.z`).
pub trait ValueExt {
    fn str_of(&self, key: &str) -> Option<&str>;
    fn string_or(&self, key: &str, default: &str) -> String;
    fn num_of(&self, key: &str) -> f64;
    fn i64_of(&self, key: &str) -> i64;
    fn truthy_of(&self, key: &str) -> bool;
    fn obj(&self) -> Option<&Map<String, Value>>;
}

/// JavaScript truthiness of a JSON value.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `Number(v) || 0`.
pub fn number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse().unwrap_or(0.0),
        Value::Bool(true) => 1.0,
        _ => 0.0,
    }
}

impl ValueExt for Value {
    fn str_of(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }
    fn string_or(&self, key: &str, default: &str) -> String {
        match self.str_of(key) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => default.to_string(),
        }
    }
    fn num_of(&self, key: &str) -> f64 {
        self.get(key).map(number).unwrap_or(0.0)
    }
    fn i64_of(&self, key: &str) -> i64 {
        self.num_of(key) as i64
    }
    fn truthy_of(&self, key: &str) -> bool {
        self.get(key).is_some_and(truthy)
    }
    fn obj(&self) -> Option<&Map<String, Value>> {
        self.as_object()
    }
}

/// `Object.assign(target, patch)` for JSON objects.
pub fn assign(target: &mut Value, patch: &Value) {
    if let (Some(t), Some(p)) = (target.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            t.insert(k.clone(), v.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stringify_matches_v8() {
        let v: Value = serde_json::from_str(
            r#"{"v":1,"slots":{"back":{"id":"bat_wings","color":16711935,"opts":{"speed":1.5,"glow":true,"s":"a\"b\n\u0001"}}},"f":2.0,"neg":-0.5}"#,
        )
        .unwrap();
        assert_eq!(
            stringify(&v),
            r#"{"v":1,"slots":{"back":{"id":"bat_wings","color":16711935,"opts":{"speed":1.5,"glow":true,"s":"a\"b\n\u0001"}}},"f":2,"neg":-0.5}"#
        );
        assert_eq!(js_f64(1e21), "1e+21");
        assert_eq!(js_f64(1.5e-7), "1.5e-7");
        assert_eq!(js_f64(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(stringify(&json!("zażółć")), "\"zażółć\"");
    }

    #[test]
    fn truthiness() {
        assert!(!truthy(&json!(0)));
        assert!(!truthy(&json!("")));
        assert!(truthy(&json!([])));
        assert_eq!(number(&json!("4096")), 4096.0);
    }
}
