//! Official Nore domains – a free `<name>.noreclient.pl` for a server hosted here (port of
//! launcher/src/main/nore-domains.js, contract: docs/domains.md). Requests that change something
//! are signed with the Nore ID (the chat identity, ECDSA P-256):
//! `nore-domains/1|<op>|<name>|<hex>|<ts>|sha256hex(JSON.stringify(target ?? null))`.
//! The worker wants `ts` strictly increasing per Nore ID, so requests go through one queue.

use crate::error::{msg, Error, Result};
use crate::ipc::App;
use crate::js::{now_ms, stringify, ValueExt};
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, LazyLock};

pub const ZONE: &str = "noreclient.pl";

fn api() -> String {
    std::env::var("NORE_API").unwrap_or_else(|_| "https://noreclient.pl".into()).trim_end_matches('/').to_string()
}

pub fn normalize(raw: &str) -> String {
    let s = raw.trim().to_lowercase();
    let s = s.strip_suffix('.').unwrap_or(&s);
    s.strip_suffix(".noreclient.pl").unwrap_or(s).to_string()
}

/// Local check before asking the API (the worker has the full rules).
pub fn local_error(name: &str) -> Option<&'static str> {
    static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$").unwrap());
    let n = name.chars().count();
    if !(3..=32).contains(&n) {
        return Some("Nazwa musi mieć od 3 do 32 znaków.");
    }
    if !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Some("Dozwolone są tylko małe litery a–z, cyfry i myślnik (bez polskich znaków).");
    }
    if !NAME.is_match(name) {
        return Some("Nazwa nie może zaczynać się ani kończyć myślnikiem.");
    }
    if name.contains("--") {
        return Some("Nazwa nie może zawierać dwóch myślników obok siebie.");
    }
    None
}

/// The string the worker verifies.
pub fn canonical(op: &str, name: &str, hex: &str, ts: i64, target: Option<&Value>) -> String {
    let digest = hex::encode(Sha256::digest(stringify(target.unwrap_or(&Value::Null)).as_bytes()));
    format!("nore-domains/1|{op}|{name}|{hex}|{ts}|{digest}")
}

static LAST_TS: AtomicI64 = AtomicI64::new(0);

/// An API error with its HTTP status (0 = no connection).
fn api_err(text: String, status: u16) -> Error {
    Error::Status { status, url: text }
}

fn status_of(e: &Error) -> u16 {
    match e {
        Error::Status { status, .. } => *status,
        _ => 0,
    }
}

/// Error text for the player (the Status variant carries the API's message here).
fn text_of(e: &Error) -> String {
    match e {
        Error::Status { url, .. } => url.clone(),
        o => o.to_string(),
    }
}

pub fn clean_target(t: &Value) -> Option<Value> {
    let a = t.str_of("address").filter(|s| !s.is_empty())?;
    let port = t.get("port").and_then(|p| p.as_u64().or_else(|| p.as_str().and_then(|s| s.parse().ok()))).filter(|p| *p > 0).unwrap_or(25565);
    Some(json!({ "address": a, "port": port }))
}

/// Where the domain should point: the tunnel host:port when it is on, else the public IP + port.
pub fn target_for(tunnel: Option<&str>, public_ip: Option<&str>, port: u64) -> Result<Value> {
    static T: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^([a-z0-9.-]+?)(?::(\d{1,5}))?$").unwrap());
    if let Some(c) = tunnel.and_then(|t| T.captures(t.trim())) {
        return Ok(json!({ "address": c[1].to_lowercase(), "port": c.get(2).and_then(|p| p.as_str().parse::<u64>().ok()).unwrap_or(25565) }));
    }
    let ip = public_ip.ok_or_else(|| msg("Nie udało się ustalić publicznego IP (brak internetu?)"))?;
    Ok(json!({ "address": ip, "port": if port == 0 { 25565 } else { port } }))
}

impl App {
    fn domains_signed(&self, op: &str, name: &str, target: Option<&Value>) -> Result<Value> {
        let me = self.chat.identity(&self.store, &self.secrets)?;
        let ts = loop {
            let last = LAST_TS.load(Ordering::SeqCst);
            let ts = now_ms().max(last + 1);
            if LAST_TS.compare_exchange(last, ts, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                break ts;
            }
        };
        let sig = me.sign(&canonical(op, name, &me.hex, ts, target));
        let mut b = json!({ "hex": me.hex, "pub": me.pub_b64, "ts": ts, "sig": sig });
        if let Some(t) = target {
            b["target"] = t.clone();
        }
        Ok(b)
    }

    async fn domains_call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        let url = format!("{}/api/v2/domains{path}", api());
        let c = self.env.net.client();
        let mut r = match method {
            "POST" => c.post(&url),
            "PUT" => c.put(&url),
            "DELETE" => c.delete(&url),
            _ => c.get(&url),
        }
        .timeout(std::time::Duration::from_secs(15));
        if let Some(b) = &body {
            r = r.json(b);
        }
        let res = r.send().await.map_err(|_| api_err("Brak połączenia z Nore API – sprawdź internet.".into(), 0))?;
        let status = res.status();
        let j: Option<Value> = res.json().await.ok();
        match j {
            Some(j) if status.is_success() && j.get("ok") != Some(&json!(false)) => Ok(j),
            j => Err(api_err(
                j.as_ref().and_then(|j| j.str_of("error").map(String::from)).unwrap_or_else(|| format!("Nore API odpowiedziało {}", status.as_u16())),
                status.as_u16().max(1),
            )),
        }
    }

    async fn domains_queued(&self, method: &str, op: &str, name: &str, target: Option<Value>) -> Result<Value> {
        let _one = self.domains_queue.lock().await;
        let body = self.domains_signed(op, name, target.as_ref())?;
        let path = if op == "mine" { "/@mine".to_string() } else { format!("/{name}") };
        self.domains_call(method, &path, Some(body)).await
    }

    pub(crate) async fn nore_domain_release(&self, name: &str) -> Result<Value> {
        self.domains_queued("DELETE", "release", &normalize(name), None).await
    }

    fn tunnel_address_of(&self, srv: &Value) -> Option<String> {
        let rt = self
            .servers_rt
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(srv.str_of("id").unwrap_or(""))
            .and_then(|r| r.net.str_of("tunnel").map(String::from));
        rt.or_else(|| {
            (srv.pointer("/tunnel/enabled") == Some(&json!(true))).then(|| srv.pointer("/tunnel/address").and_then(Value::as_str).map(String::from)).flatten()
        })
    }

    async fn nore_target(&self, srv: &Value, ip: Option<String>) -> Result<Value> {
        let tunnel = self.tunnel_address_of(srv);
        let ip = match (&tunnel, ip) {
            (Some(_), _) => None,
            (None, Some(i)) => Some(i),
            (None, None) => Some(crate::server_net::public_ip(&self.env).await?),
        };
        target_for(tunnel.as_deref(), ip.as_deref(), srv["port"].as_u64().unwrap_or(25565))
    }

    /// Official Nore domain: points it at the current target (claims it again when it expired).
    pub(crate) async fn apply_nore_domain(&self, srv: &Value, ip: Option<String>) -> Result<Value> {
        let name = normalize(srv.pointer("/domain/name").and_then(Value::as_str).unwrap_or(""));
        let target = self.nore_target(srv, ip).await?;
        let r = match self.domains_queued("PUT", "update", &name, Some(target.clone())).await {
            Ok(r) => r,
            Err(e) if status_of(&e) == 404 => self.domains_queued("POST", "claim", &name, Some(target.clone())).await.map_err(|e| msg(text_of(&e)))?,
            Err(e) => return Err(msg(text_of(&e))),
        };
        let port = target["port"].as_u64().unwrap_or(25565);
        let shown = if port != 25565 { format!("{}:{port}", target.string_or("address", "")) } else { target.string_or("address", "") };
        let id = srv.string_or("id", "");
        let exp = r.pointer("/domain/expiresAt").cloned().unwrap_or(Value::Null);
        let _ = self.store.update(|x| {
            if let Some(s) = x["servers"].as_array_mut().and_then(|l| l.iter_mut().find(|s| s.str_of("id") == Some(&id))) {
                if s["domain"].is_object() {
                    s["domain"]["lastIp"] = json!(shown);
                    s["domain"]["expiresAt"] = exp;
                }
            }
        });
        Ok(json!({ "host": r.pointer("/domain/fqdn"), "ip": shown, "target": target, "domain": r["domain"], "records": [] }))
    }

    /// servers:noreDomain – check(name) · claim(id, name) · release(id) · mine().
    pub(crate) async fn nore_domain(self: &Arc<Self>, op: &str, a: &[Value]) -> Result<Value> {
        let s = |i: usize| a.get(i).map(crate::config_edit::js_string).unwrap_or_default();
        let r: Result<Value> = async {
            match op {
                "check" => {
                    let name = normalize(&s(0));
                    if let Some(bad) = local_error(&name) {
                        return Ok(json!({ "name": name, "fqdn": format!("{name}.{ZONE}"), "valid": false, "available": false, "reason": "invalid", "message": bad, "domain": null }));
                    }
                    self.domains_call("GET", &format!("/{}", urlencoding::encode(&name)), None).await
                }
                "mine" => self.domains_queued("POST", "mine", "", None).await,
                "claim" | "release" => {
                    let srv = self.server_raw(&s(0)).ok_or_else(|| msg("Nie ma takiego serwera."))?;
                    let id = srv.string_or("id", "");
                    if op == "claim" {
                        let name = normalize(&s(1));
                        if let Some(bad) = local_error(&name) {
                            return Err(api_err(bad.into(), 400));
                        }
                        let target = self.nore_target(&srv, None).await.ok();
                        let r = self.domains_queued("POST", "claim", &name, target.clone()).await?;
                        self.server_update(&id, &json!({ "domain": { "provider": "nore", "name": name, "auto": true, "token": null, "lastIp": target.as_ref().map(|t| t["address"].clone()), "expiresAt": r.pointer("/domain/expiresAt") } }))?;
                        return Ok(json!({ "domain": r["domain"], "created": r["created"], "server": self.server_get(&id) }));
                    }
                    let d = &srv["domain"];
                    let name = d.str_of("name").filter(|n| !n.is_empty() && d.str_of("provider") == Some("nore")).ok_or_else(|| msg("Ten serwer nie ma domeny Nore."))?.to_string();
                    if let Err(e) = self.nore_domain_release(&name).await {
                        if status_of(&e) != 404 {
                            return Err(e);
                        }
                    }
                    self.server_update(&id, &json!({ "domain": { "provider": "none", "name": "", "auto": false, "token": null } }))?;
                    Ok(json!({ "released": name, "server": self.server_get(&id) }))
                }
                _ => Err(msg(format!("Nieznana operacja domeny: {op}"))),
            }
        }
        .await;
        r.map_err(|e| if matches!(e, Error::Status { .. }) { msg(text_of(&e)) } else { e })
    }

    /// servers:remove with `{ releaseDomain }`: the free domain goes back to the pool first.
    pub(crate) async fn release_domain_on_remove(&self, id: &str, opts: &Value) -> Result<()> {
        if !opts.truthy_of("releaseDomain") {
            return Ok(());
        }
        let Some(s) = self.server_raw(id) else { return Ok(()) };
        let d = &s["domain"];
        let Some(name) = d.str_of("name").filter(|n| !n.is_empty() && d.str_of("provider") == Some("nore")) else { return Ok(()) };
        if let Err(e) = self.nore_domain_release(name).await {
            let st = status_of(&e);
            if st != 404 && st != 403 {
                return Err(msg(format!("Nie udało się zwolnić domeny {name}.noreclient.pl: {}", text_of(&e))));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_and_rules() {
        let target = json!({ "address": "93.184.216.34", "port": 25570 });
        let d = hex::encode(Sha256::digest(br#"{"address":"93.184.216.34","port":25570}"#));
        assert_eq!(canonical("update", "mojserwer", "abc", 1792270000000, Some(&target)), format!("nore-domains/1|update|mojserwer|abc|1792270000000|{d}"));
        assert_eq!(canonical("release", "x", "h", 1, None), format!("nore-domains/1|release|x|h|1|{}", hex::encode(Sha256::digest(b"null"))));
        assert_eq!(normalize(" MojSerwer.noreclient.pl "), "mojserwer");
        for bad in ["ab", &"x".repeat(33), "-abc", "abc-", "a--b", "żółw", "a_b"] {
            assert!(local_error(&normalize(bad)).is_some(), "{bad}");
        }
        assert!(local_error("moj-serwer-2").is_none());
        assert_eq!(target_for(Some("abc.joinmc.link:12345"), None, 25565).unwrap(), json!({ "address": "abc.joinmc.link", "port": 12345 }));
        assert_eq!(target_for(None, Some("1.2.3.4"), 25570).unwrap(), json!({ "address": "1.2.3.4", "port": 25570 }));
        assert!(target_for(None, None, 1).is_err());
    }
}
