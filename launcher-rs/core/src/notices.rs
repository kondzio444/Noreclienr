//! What the Nore team says to launcher users (port of launcher/src/main/notices.js):
//! announcements, maintenance and the minimum launcher version from
//! GET /api/v2/client/config?target=launcher, read at start and every 15 minutes.

use crate::js::{now_ms, ValueExt};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

const LEVELS: [&str; 3] = ["info", "warning", "event"];
const EVERY: Duration = Duration::from_secs(15 * 60);

pub fn api_base() -> String {
    std::env::var("NORE_API").unwrap_or_else(|_| "https://noreclient.pl".into()).trim_end_matches('/').to_string()
}

fn parts(v: &str) -> Vec<i64> {
    v.trim_start_matches('v').split(['.', '+', '-']).map(|n| n.parse::<i64>().unwrap_or(0)).collect()
}

/// True when version a is newer than b (major.minor.patch).
pub fn newer(a: &str, b: &str) -> bool {
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..3 {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str).map(|s| s.encode_utf16().take(max).collect::<Vec<u16>>()).map(|u| String::from_utf16_lossy(&u)).unwrap_or_default()
}

static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^https://\S+$").unwrap());

/// Keeps only what the banner shows, from an untrusted answer.
pub fn shape(cfg: &Value, version: &str) -> Value {
    let list = cfg.get("announcements").and_then(Value::as_array).cloned().unwrap_or_default();
    let announcements: Vec<Value> = list
        .iter()
        .take(5)
        .filter(|a| a.get("id").is_some_and(Value::is_string) && a.get("title").is_some_and(Value::is_string))
        .map(|a| {
            let level = a.str_of("level").filter(|l| LEVELS.contains(l)).unwrap_or("info");
            let link = a.str_of("link").filter(|l| LINK.is_match(l)).map(|l| l.chars().take(300).collect::<String>());
            json!({ "id": text(a.get("id"), 40), "title": text(a.get("title"), 120), "body": text(a.get("body"), 600), "level": level, "link": link })
        })
        .collect();
    let maintenance = cfg.get("maintenance").filter(|m| m.get("enabled") == Some(&json!(true))).map(|m| json!({ "message": text(m.get("message"), 300) }));
    let min = cfg.str_of("minLauncherVersion").map(String::from);
    json!({
        "announcements": announcements,
        "maintenance": maintenance,
        "minLauncherVersion": min,
        "updateRequired": min.as_deref().is_some_and(|m| !m.is_empty() && newer(m, version)),
        "at": now_ms(),
    })
}

/// The last good copy (failures keep it).
#[derive(Clone)]
pub struct Notices {
    current: Arc<Mutex<Value>>,
}

impl Default for Notices {
    fn default() -> Self {
        Self { current: Arc::new(Mutex::new(json!({ "announcements": [], "maintenance": null, "updateRequired": false, "minLauncherVersion": null, "at": 0 }))) }
    }
}

impl Notices {
    pub fn get(&self) -> Value {
        self.current.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Polls in the background: `send(state)` gets every new state, `on_update_required` runs once.
    pub fn start(&self, client: reqwest::Client, version: String, send: Arc<dyn Fn(Value) + Send + Sync>, on_update_required: Arc<dyn Fn() + Send + Sync>) {
        let current = self.current.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(4)).await;
            let mut asked = false;
            loop {
                let url = format!("{}/api/v2/client/config?target=launcher", api_base());
                let got = async { client.get(&url).timeout(Duration::from_secs(15)).send().await.ok()?.error_for_status().ok()?.json::<Value>().await.ok() };
                if let Some(cfg) = got.await {
                    let s = shape(&cfg, &version);
                    *current.lock().unwrap_or_else(|e| e.into_inner()) = s.clone();
                    let required = s["updateRequired"] == json!(true);
                    send(s);
                    if required && !asked {
                        asked = true;
                        on_update_required();
                    }
                }
                tokio::time::sleep(EVERY).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    //! Port of launcher/test/notices.test.js.
    use super::*;

    #[test]
    fn config_is_reduced_to_the_banner() {
        let s = shape(
            &json!({
                "maintenance": { "enabled": true, "message": "Aktualizujemy serwery" },
                "minLauncherVersion": "1.5.0",
                "announcements": [
                    { "id": "a1", "title": "Przerwa", "body": "Wracamy o 20:00", "level": "warning", "link": "https://noreclient.pl/status", "targets": ["launcher"] },
                    { "id": "a2", "title": "Zły link", "level": "loud", "link": "javascript:alert(1)" },
                    { "title": "bez id" },
                    null
                ]
            }),
            "1.4.0",
        );
        assert_eq!(s["maintenance"], json!({ "message": "Aktualizujemy serwery" }));
        assert_eq!(s["updateRequired"], true);
        let a = s["announcements"].as_array().unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!((a[0]["id"].clone(), a[0]["level"].clone(), a[0]["link"].clone()), (json!("a1"), json!("warning"), json!("https://noreclient.pl/status")));
        assert_eq!((a[1]["level"].clone(), a[1]["link"].clone()), (json!("info"), Value::Null));
        assert!(a[0].get("targets").is_none());
    }

    #[test]
    fn update_required_only_for_a_newer_minimum() {
        assert_eq!(shape(&json!({ "minLauncherVersion": "1.5.0" }), "1.5.0")["updateRequired"], false);
        assert_eq!(shape(&json!({ "minLauncherVersion": "1.5.1" }), "1.5.0")["updateRequired"], true);
        assert_eq!(shape(&json!({ "minLauncherVersion": null }), "0.1.0")["updateRequired"], false);
        assert_eq!(shape(&json!({ "maintenance": { "enabled": false, "message": "x" } }), "1.0.0")["maintenance"], Value::Null);
        assert!(newer("2.0.0", "1.9.9") && !newer("1.9.9", "2.0.0"));
    }
}
