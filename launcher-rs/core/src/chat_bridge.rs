//! Local bridge between the friends chat and Nore Client in the game (port of
//! launcher/src/main/chat-bridge.js): a tiny HTTP server on 127.0.0.1 (random port) with a random
//! token handed to the game as `-Dnoreclient.chatBridge=<port>:<token>`. Requests without the token
//! or with a foreign Host header (DNS rebinding) are refused. Same routes as the Electron launcher:
//!
//!   GET  /v1/state, /v1/history?hex=&limit=, /v1/events?since= (25 s long poll)
//!   POST /v1/send, /v1/read, /v1/contacts/remove, /v1/requests/decline, /v1/presence, /v1/contacts/add

use crate::chat;
use crate::ipc::App;
use crate::js::{now_ms, ValueExt};
use rand::RngCore;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Bridge state kept in the app.
pub struct Bridge {
    port: AtomicU16,
    token: String,
    presence: Mutex<Value>,
    events: Mutex<(u64, VecDeque<Value>)>,
    notify: tokio::sync::Notify,
}

impl Default for Bridge {
    fn default() -> Self {
        let mut b = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut b);
        Self { port: AtomicU16::new(0), token: hex::encode(b), presence: Mutex::new(json!({})), events: Mutex::new((0, VecDeque::new())), notify: tokio::sync::Notify::new() }
    }
}

impl Bridge {
    /// "<port>:<token>" for -Dnoreclient.chatBridge, or None before start.
    pub fn address(&self) -> Option<String> {
        let p = self.port.load(Ordering::SeqCst);
        (p != 0).then(|| format!("{p}:{}", self.token))
    }

    fn push(&self, mut ev: Value) {
        let mut e = self.events.lock().unwrap_or_else(|e| e.into_inner());
        e.0 += 1;
        ev["seq"] = json!(e.0);
        e.1.push_back(ev);
        while e.1.len() > 200 {
            e.1.pop_front();
        }
        drop(e);
        self.notify.notify_waiters();
    }

    fn since(&self, since: u64) -> Value {
        let e = self.events.lock().unwrap_or_else(|e| e.into_inner());
        json!({ "seq": e.0, "events": e.1.iter().filter(|x| x["seq"].as_u64().unwrap_or(0) > since).cloned().collect::<Vec<_>>() })
    }

    fn seq(&self) -> u64 {
        self.events.lock().unwrap_or_else(|e| e.into_inner()).0
    }
}

fn contact_name(contacts: &Value, hex: &str) -> String {
    contacts.as_array().into_iter().flatten().find(|c| c.str_of("hex") == Some(hex)).and_then(|c| c.str_of("name").map(String::from)).unwrap_or_else(|| "Znajomy".into())
}

fn valid_hex(h: &str) -> bool {
    h.len() == 20 && h.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

struct Req {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    host: String,
    token: String,
    body: Vec<u8>,
}

async fn read_req(sock: &mut TcpStream) -> Option<Req> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        let n = tokio::time::timeout(Duration::from_secs(10), sock.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 32 * 1024 {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let target = first.next()?.to_string();
    let (mut host, mut token, mut len) = (String::new(), String::new(), 0usize);
    for l in lines {
        let Some((k, v)) = l.split_once(':') else { continue };
        match k.trim().to_ascii_lowercase().as_str() {
            "host" => host = v.trim().to_string(),
            "x-nore-token" => token = v.trim().to_string(),
            "content-length" => len = v.trim().parse().unwrap_or(0),
            _ => {}
        }
    }
    if len > 16384 {
        return None;
    }
    while buf.len() < head_end + len {
        let n = tokio::time::timeout(Duration::from_secs(10), sock.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    Some(Req { method, path: url.path().to_string(), query: url.query_pairs().into_owned().collect(), host, token, body: buf[head_end..(head_end + len).min(buf.len())].to_vec() })
}

async fn reply(sock: &mut TcpStream, code: u16, body: &Value) {
    let text = body.to_string();
    let head = format!("HTTP/1.1 {code} X\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", text.len());
    let _ = sock.write_all(head.as_bytes()).await;
    let _ = sock.write_all(text.as_bytes()).await;
    let _ = sock.shutdown().await;
}

fn eq_const(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl App {
    /// Starts the bridge (once); returns its address.
    pub async fn start_chat_bridge(self: &Arc<Self>) -> Option<String> {
        if let Some(a) = self.bridge.address() {
            return Some(a);
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
        self.bridge.port.store(listener.local_addr().ok()?.port(), Ordering::SeqCst);
        let me: Weak<App> = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let Some(app) = me.upgrade() else { return };
                tokio::spawn(async move {
                    if let Some(req) = read_req(&mut sock).await {
                        let (code, body) = app.bridge_handle(req).await;
                        reply(&mut sock, code, &body).await;
                    }
                });
            }
        });
        self.bridge.address()
    }

    fn contact_view(&self, c: &Value) -> Value {
        let hex = c.string_or("hex", "");
        let last = &c["last"];
        let mut v = json!({
            "hex": hex, "name": c["name"], "unread": c["unread"],
            "last": if last.is_object() { json!({ "text": last["text"], "mine": last.truthy_of("mine"), "ts": last["ts"] }) } else { Value::Null },
        });
        let p = self.bridge.presence.lock().unwrap_or_else(|e| e.into_inner()).get(&hex).cloned().unwrap_or(json!({ "online": false, "status": "offline", "detail": "" }));
        crate::js::assign(&mut v, &p);
        v
    }

    fn bridge_state(&self) -> Value {
        let me = self.chat.public_identity(&self.store, &self.secrets).unwrap_or(json!({}));
        let contacts = chat::contacts(&self.store);
        json!({
            "me": { "hex": me["hex"], "name": me["name"], "id": me["id"] },
            "contacts": contacts.as_array().into_iter().flatten().map(|c| self.contact_view(c)).collect::<Vec<_>>(),
            "requests": chat::requests(&self.store).as_array().into_iter().flatten().map(|r| json!({ "hex": r["hex"], "name": r["name"], "text": r["text"], "at": r["at"] })).collect::<Vec<_>>(),
        })
    }

    async fn bridge_handle(&self, req: Req) -> (u16, Value) {
        let port = self.bridge.port.load(Ordering::SeqCst);
        if req.host != format!("127.0.0.1:{port}") && req.host != format!("localhost:{port}") {
            return (403, json!({ "error": "host" }));
        }
        if !eq_const(req.token.as_bytes(), self.bridge.token.as_bytes()) {
            return (401, json!({ "error": "token" }));
        }
        let q = |k: &str| req.query.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone()).unwrap_or_default();
        match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/v1/state") => return (200, self.bridge_state()),
            ("GET", "/v1/history") => {
                let limit = q("limit").parse::<usize>().ok().filter(|n| *n > 0).unwrap_or(50).clamp(1, 200);
                let h = chat::history(&self.store, &q("hex"));
                let list: Vec<Value> = h.as_array().cloned().unwrap_or_default();
                let start = list.len().saturating_sub(limit);
                let msgs: Vec<Value> = list[start..].iter().map(|m| json!({ "text": m["text"], "mine": m.truthy_of("mine"), "ts": m["ts"], "state": m.get("state").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null) })).collect();
                return (200, json!({ "messages": msgs }));
            }
            ("GET", "/v1/events") => {
                let since: u64 = q("since").parse().unwrap_or(0);
                if since != self.bridge.seq() {
                    return (200, self.bridge.since(since));
                }
                let notified = self.bridge.notify.notified();
                let _ = tokio::time::timeout(Duration::from_secs(25), notified).await;
                return (200, self.bridge.since(since));
            }
            ("POST", _) => {}
            _ => return (404, json!({ "error": "not found" })),
        }
        let Ok(b) = (if req.body.is_empty() { Ok(json!({})) } else { serde_json::from_slice::<Value>(&req.body) }) else { return (400, json!({ "error": "body" })) };
        let hex = b.str_of("hex").map(String::from).unwrap_or_else(|| b.get("hex").filter(|v| !v.is_null()).map(crate::config_edit::js_string).unwrap_or_default());
        match req.path.as_str() {
            "/v1/send" | "/v1/read" => {
                let contacts = chat::contacts(&self.store);
                if !contacts.as_array().is_some_and(|l| l.iter().any(|c| c.str_of("hex") == Some(&hex))) {
                    return (404, json!({ "error": "contact" }));
                }
                if req.path == "/v1/read" {
                    let _ = chat::mark_read(&self.store, &hex);
                    self.emit("chat:bridgeRead", json!({ "hex": hex }));
                    return (200, json!({ "ok": true }));
                }
                let text: String = b.get("text").map(crate::config_edit::js_string).unwrap_or_default().trim().chars().take(2000).collect();
                if text.is_empty() {
                    return (400, json!({ "error": "empty" }));
                }
                self.emit("chat:bridgeSend", json!({ "hex": hex, "text": text }));
                (202, json!({ "ok": true }))
            }
            "/v1/presence" => {
                let c = b.get("cosmetics").cloned().unwrap_or(Value::Null);
                if let Some(bad) = crate::hub::cosmetics_error(&c) {
                    return (400, json!({ "error": bad }));
                }
                // used for the next Nore Hub hello (hub.rs reads the stored wardrobe)
                if self.store.read(|d| d.get("hubCosmetics") != Some(&c)) {
                    let _ = self.store.update(|d| d["hubCosmetics"] = c);
                }
                (200, json!({ "ok": true }))
            }
            "/v1/contacts/add" => {
                let name = b.get("name").filter(|v| !v.is_null()).map(crate::config_edit::js_string).unwrap_or_default();
                let name_ok = name.is_empty() || (name.len() >= 2 && name.len() <= 16 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
                if !valid_hex(&hex) || !name_ok {
                    return (400, json!({ "error": "hex" }));
                }
                let me = match self.chat.identity(&self.store, &self.secrets) {
                    Ok(m) => m,
                    Err(e) => return (400, json!({ "error": e.to_string() })),
                };
                if me.hex == hex {
                    return (400, json!({ "error": "self" }));
                }
                let find = |s: &App| chat::contacts(&s.store).as_array().and_then(|l| l.iter().find(|c| c.str_of("hex") == Some(&hex)).cloned());
                let c = match find(self) {
                    Some(c) => c,
                    None => {
                        if let Err(e) = chat::add_contact(&self.store, &me.hex, &hex, Some(&name)) {
                            return (400, json!({ "error": e.to_string() }));
                        }
                        self.emit("chat:bridgeAdd", json!({ "hex": hex }));
                        find(self).unwrap_or(json!({ "hex": hex, "name": name }))
                    }
                };
                (200, json!({ "ok": true, "contact": self.contact_view(&c) }))
            }
            "/v1/contacts/remove" | "/v1/requests/decline" => {
                if !valid_hex(&hex) {
                    return (400, json!({ "error": "hex" }));
                }
                if req.path == "/v1/contacts/remove" {
                    let _ = chat::remove_contact(&self.store, &hex);
                } else {
                    let _ = chat::decline_request(&self.store, &hex, b.truthy_of("block"));
                }
                self.emit("chat:bridgeRead", json!({ "hex": hex }));
                (200, json!({ "ok": true }))
            }
            _ => (404, json!({ "error": "not found" })),
        }
    }

    /// Every stored incoming message goes to the game too.
    pub fn bridge_message(&self, hex: &str, m: &Value) {
        if m.truthy_of("mine") || !m.truthy_of("text") {
            return;
        }
        let name = contact_name(&chat::contacts(&self.store), hex);
        self.bridge.push(json!({ "type": "message", "hex": hex, "name": name, "text": m["text"], "ts": m["ts"] }));
    }

    /// Presence snapshot from the renderer (who is online / in game).
    pub fn bridge_set_presence(&self, map: &Value) {
        let map = if map.is_object() { map.clone() } else { json!({}) };
        let before = std::mem::replace(&mut *self.bridge.presence.lock().unwrap_or_else(|e| e.into_inner()), map.clone());
        let contacts = chat::contacts(&self.store);
        for (hex, p) in map.as_object().into_iter().flatten() {
            if p.truthy_of("online") && !before[hex.as_str()].truthy_of("online") {
                self.bridge.push(json!({ "type": "online", "hex": hex, "name": contact_name(&contacts, hex), "text": p.string_or("detail", ""), "ts": now_ms() }));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hex_and_compare() {
        assert!(super::valid_hex("0123456789abcdef0123") && !super::valid_hex("0123456789ABCDEF0123") && !super::valid_hex("x"));
        assert!(super::eq_const(b"abc", b"abc") && !super::eq_const(b"abc", b"abd") && !super::eq_const(b"ab", b"abc"));
    }
}
