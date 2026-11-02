//! Discord Rich Presence over Discord's local IPC (port of launcher/src/main/discord.js): the
//! named pipe `\\?\pipe\discord-ipc-N` on Windows, the unix socket elsewhere. Frames are
//! `[op i32 LE][len i32 LE][json]`; reconnects every 15 s while Discord is closed.

use rand::RngCore;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

const OP_HANDSHAKE: i32 = 0;
const OP_FRAME: i32 = 1;
const OP_CLOSE: i32 = 2;

enum Cmd {
    ClientId(Option<String>),
    Activity(Option<Value>),
}

/// Handle to the presence task.
pub struct Discord {
    tx: mpsc::UnboundedSender<Cmd>,
    start: i64,
}

pub fn encode(op: i32, data: &Value) -> Vec<u8> {
    let body = data.to_string().into_bytes();
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as i32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

/// `{ details, state, start? }` → the activity Discord expects.
pub fn activity(a: &Value, start: i64) -> Value {
    let mut assets = json!({ "large_image": "logo", "large_text": "Nore Launcher" });
    if let Some(s) = a.get("small").filter(|v| !v.is_null()) {
        assets["small_image"] = s.clone();
    }
    if let Some(s) = a.get("smallText").filter(|v| !v.is_null()) {
        assets["small_text"] = s.clone();
    }
    json!({
        "details": a["details"], "state": a["state"], "timestamps": { "start": a.get("start").and_then(Value::as_i64).filter(|s| *s != 0).unwrap_or(start) },
        "assets": assets, "buttons": [{ "label": "Nore Client", "url": "https://github.com/kondzio444/Noreclienr" }],
    })
}

fn nonce() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex::encode(b);
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

#[cfg(unix)]
fn candidates() -> Vec<std::path::PathBuf> {
    let mut bases: Vec<String> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].iter().filter_map(|k| std::env::var(k).ok()).collect();
    bases.push("/tmp".into());
    let subs = ["", "app/com.discordapp.Discord", "snap.discord", ".flatpak/com.discordapp.Discord/xdg-run"];
    let mut out = Vec::new();
    for i in 0..10 {
        for b in &bases {
            for s in subs {
                out.push(std::path::Path::new(b).join(s).join(format!("discord-ipc-{i}")));
            }
        }
    }
    out
}

async fn connect() -> Option<Box<dyn Io>> {
    #[cfg(unix)]
    {
        for p in candidates() {
            if let Ok(s) = tokio::net::UnixStream::connect(&p).await {
                return Some(Box::new(s));
            }
        }
        None
    }
    #[cfg(windows)]
    {
        for i in 0..10 {
            if let Ok(c) = tokio::net::windows::named_pipe::ClientOptions::new().open(format!(r"\\?\pipe\discord-ipc-{i}")) {
                return Some(Box::new(c));
            }
        }
        None
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

impl Discord {
    /// Starts the presence task (needs a tokio runtime).
    pub fn start() -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Cmd>();
        let start = crate::js::now_ms() / 1000;
        tokio::spawn(async move {
            let mut client_id: Option<String> = None;
            let mut current: Option<Value> = None;
            loop {
                // wait for a client id
                while client_id.is_none() {
                    match rx.recv().await {
                        None => return,
                        Some(Cmd::ClientId(id)) => client_id = id,
                        Some(Cmd::Activity(a)) => current = a,
                    }
                }
                let Some(mut sock) = connect().await else {
                    // Discord closed: try again in 15 s, keep taking commands meanwhile
                    let sleep = tokio::time::sleep(Duration::from_secs(15));
                    tokio::pin!(sleep);
                    loop {
                        tokio::select! {
                            _ = &mut sleep => break,
                            c = rx.recv() => match c {
                                None => return,
                                Some(Cmd::ClientId(id)) => { client_id = id; if client_id.is_none() { break; } }
                                Some(Cmd::Activity(a)) => current = a,
                            }
                        }
                    }
                    continue;
                };
                let cid = client_id.clone().unwrap_or_default();
                if sock.write_all(&encode(OP_HANDSHAKE, &json!({ "v": 1, "client_id": cid }))).await.is_err() {
                    continue;
                }
                let mut ready = false;
                let mut buf: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 4096];
                let push = |current: &Option<Value>| {
                    encode(OP_FRAME, &json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": current }, "nonce": nonce() }))
                };
                'conn: loop {
                    tokio::select! {
                        n = sock.read(&mut chunk) => {
                            let Ok(n) = n else { break 'conn };
                            if n == 0 { break 'conn; }
                            buf.extend_from_slice(&chunk[..n]);
                            while buf.len() >= 8 {
                                let op = i32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
                                let len = i32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]).max(0) as usize;
                                if buf.len() < 8 + len { break; }
                                let m: Option<Value> = serde_json::from_slice(&buf[8..8 + len]).ok();
                                buf.drain(..8 + len);
                                if op == OP_CLOSE { break 'conn; }
                                if m.as_ref().and_then(|m| m.get("evt")).and_then(Value::as_str) == Some("READY") {
                                    ready = true;
                                    if sock.write_all(&push(&current)).await.is_err() { break 'conn; }
                                }
                            }
                        }
                        c = rx.recv() => match c {
                            None => return,
                            Some(Cmd::ClientId(id)) => { if id != client_id { client_id = id; break 'conn; } }
                            Some(Cmd::Activity(a)) => {
                                current = a;
                                if ready && sock.write_all(&push(&current)).await.is_err() { break 'conn; }
                            }
                        }
                    }
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
        Self { tx, start }
    }

    /// The Discord application id (empty disables Rich Presence).
    pub fn set_client_id(&self, id: &str) {
        let id = id.trim();
        let _ = self.tx.send(Cmd::ClientId(if id.is_empty() { None } else { Some(id.to_string()) }));
    }

    /// Shows an activity (`{ details, state, start? }`) or clears it.
    pub fn set_activity(&self, a: Option<&Value>) {
        let _ = self.tx.send(Cmd::Activity(a.map(|a| activity(a, self.start))));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames() {
        let f = encode(OP_FRAME, &json!({ "a": 1 }));
        assert_eq!(&f[..4], &1i32.to_le_bytes());
        assert_eq!(&f[4..8], &7i32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
        let a = activity(&json!({ "details": "W launcherze", "state": "Wybiera" }), 100);
        assert_eq!(a["timestamps"]["start"], 100);
        assert_eq!(a["assets"]["large_image"], "logo");
        assert!(a["assets"].get("small_image").is_none());
        assert_eq!(nonce().len(), 36);
    }
}
