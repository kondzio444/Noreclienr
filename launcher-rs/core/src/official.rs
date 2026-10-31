//! The official partner server of Nore Client – Nore MC (port of launcher/src/main/official.js):
//! the servers.dat entry every Nore Client instance gets and the live status (Nore API v2, a
//! Minecraft Server List Ping as the fallback).

use crate::error::{msg, Result};
use crate::js::{now_ms, ValueExt};
use crate::nbt::{self, field, field_mut, Compound, Tag};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

pub const NAME: &str = "Nore MC";
pub const ADDRESS: &str = "mc.noreclient.pl";
pub const PORT: u16 = 25565;
pub const TAGLINE: &str = "Oficjalny serwer partnerski Nore Client";

pub fn info() -> Value {
    json!({ "name": NAME, "address": ADDRESS, "port": PORT, "tagline": TAGLINE })
}

fn api_base() -> String {
    std::env::var("NORE_API_V2").unwrap_or_else(|_| "https://noreclient.pl/api/v2".into()).trim_end_matches('/').to_string()
}

/// True when an address points at the official server (any case, :25565, trailing dot).
pub fn matches(address: &str) -> bool {
    let mut a = address.trim().to_lowercase();
    if let Some(s) = a.strip_suffix(":25565") {
        a = s.to_string();
    }
    a.trim_end_matches('.') == ADDRESS
}

/// servers.dat bytes with the official server in it; None when it is listed (and visible) already.
/// A hidden ("Direct Connection") entry becomes visible, otherwise a new entry goes to the top.
pub fn ensure_in_nbt(buf: Option<&[u8]>) -> Result<Option<Vec<u8>>> {
    let (name, mut root) = match buf {
        Some(b) if !b.is_empty() => nbt::read(b)?,
        _ => (String::new(), Vec::new()),
    };
    let ok_list = matches!(field(&root, "servers"), Some(Tag::List(..)));
    if !ok_list {
        root.retain(|(n, _)| n != "servers");
        root.push(("servers".into(), Tag::List(nbt::COMPOUND, vec![])));
    }
    let Some(Tag::List(et, items)) = field_mut(&mut root, "servers") else { unreachable!("servers list") };
    if *et != nbt::COMPOUND {
        *et = nbt::COMPOUND;
        items.clear();
    }
    let ip = |c: &Tag| match c {
        Tag::Compound(c) => match field(c, "ip") {
            Some(Tag::String(s)) => s.clone(),
            _ => String::new(),
        },
        _ => String::new(),
    };
    let hidden = |c: &Tag| match c {
        Tag::Compound(c) => match field(c, "hidden") {
            Some(Tag::Byte(b)) => *b != 0,
            Some(Tag::Short(b)) => *b != 0,
            Some(Tag::Int(b)) => *b != 0,
            _ => false,
        },
        _ => false,
    };
    if items.iter().any(|c| matches(&ip(c)) && !hidden(c)) {
        return Ok(None);
    }
    let entry = match items.iter().position(|c| matches(&ip(c))) {
        Some(i) => {
            let Tag::Compound(mut c) = items.remove(i) else { unreachable!("compound items") };
            if let Some(Tag::Byte(h)) = field_mut(&mut c, "hidden") {
                *h = 0;
            }
            match field_mut(&mut c, "name") {
                Some(n) => *n = Tag::String(NAME.into()),
                None => c.push(("name".into(), Tag::String(NAME.into()))),
            }
            c
        }
        None => vec![("name".into(), Tag::String(NAME.into())), ("ip".into(), Tag::String(ADDRESS.into()))],
    };
    items.insert(0, Tag::Compound(entry));
    Ok(Some(nbt::write(&name, &root)))
}

/// Makes sure servers.dat in the game folder lists the official server. True when written.
pub async fn ensure_servers_dat(game_dir: &Path) -> Result<bool> {
    let file = game_dir.join("servers.dat");
    let buf = match tokio::fs::read(&file).await {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    // unreadable file: leave it to the game rather than overwrite the player's servers
    let Ok(out) = ensure_in_nbt(buf.as_deref()) else { return Ok(false) };
    let Some(out) = out else { return Ok(false) };
    tokio::fs::create_dir_all(game_dir).await?;
    let tmp = game_dir.join("servers.dat.nore-tmp");
    tokio::fs::write(&tmp, out).await?;
    tokio::fs::rename(&tmp, &file).await?;
    Ok(true)
}

// ------------------------------------------------------------------ status

pub fn varint(n: i32) -> Vec<u8> {
    let mut v = n as u32;
    let mut out = Vec::new();
    loop {
        let mut b = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            b |= 0x80;
        }
        out.push(b);
        if v == 0 {
            return out;
        }
    }
}

/// Reads a VarInt; (value, next offset) or None when the buffer is too short.
pub fn read_varint(buf: &[u8], mut o: usize) -> Result<Option<(u32, usize)>> {
    let mut v: u32 = 0;
    let mut shift = 0;
    loop {
        let Some(&b) = buf.get(o) else { return Ok(None) };
        o += 1;
        v |= ((b & 0x7f) as u32) << shift;
        if b & 0x80 == 0 {
            return Ok(Some((v, o)));
        }
        shift += 7;
        if shift > 28 {
            return Err(msg("VarInt za długi"));
        }
    }
}

fn packet(parts: &[&[u8]]) -> Vec<u8> {
    let body: Vec<u8> = parts.concat();
    let mut out = varint(body.len() as i32);
    out.extend(body);
    out
}

fn mc_string(s: &str) -> Vec<u8> {
    let mut out = varint(s.len() as i32);
    out.extend_from_slice(s.as_bytes());
    out
}

/// Plain text of a status description (string or chat component).
pub fn motd_text(d: &Value) -> String {
    match d {
        Value::String(s) => s.clone(),
        Value::Object(_) => {
            let mut s = d.str_of("text").unwrap_or_default().to_string();
            if let Some(extra) = d.get("extra").and_then(Value::as_array) {
                s.extend(extra.iter().map(motd_text));
            }
            s
        }
        _ => String::new(),
    }
}

/// Server List Ping (1.7+): the status JSON and the ping in ms (-1 when the server did not answer it).
pub async fn slp(host: &str, port: u16, timeout: Duration) -> Result<(Value, i64)> {
    tokio::time::timeout(timeout, slp_inner(host, port)).await.map_err(|_| msg("timeout"))?
}

async fn slp_inner(host: &str, port: u16) -> Result<(Value, i64)> {
    let mut sock = tokio::net::TcpStream::connect((host, port)).await?;
    sock.write_all(&packet(&[&varint(0), &varint(767), &mc_string(host), &port.to_be_bytes(), &varint(1)])).await?;
    sock.write_all(&packet(&[&varint(0)])).await?;
    let mut buf: Vec<u8> = Vec::new();
    let mut status: Option<Value> = None;
    let mut sent = 0i64;
    let mut chunk = [0u8; 8192];
    loop {
        let n = sock.read(&mut chunk).await?;
        if n == 0 {
            return status.map(|s| (s, -1)).ok_or_else(|| msg("Serwer zamknął połączenie"));
        }
        buf.extend_from_slice(&chunk[..n]);
        loop {
            let Some((len, o)) = read_varint(&buf, 0)? else { break };
            let len = len as usize;
            if buf.len() < o + len {
                break;
            }
            let body: Vec<u8> = buf[o..o + len].to_vec();
            buf.drain(..o + len);
            let Some((id, o2)) = read_varint(&body, 0)? else { continue };
            if status.is_none() && id == 0 {
                let (sl, o3) = read_varint(&body, o2)?.ok_or_else(|| msg("Zła odpowiedź serwera"))?;
                let text = body.get(o3..o3 + sl as usize).ok_or_else(|| msg("Zła odpowiedź serwera"))?;
                status = Some(serde_json::from_slice(text)?);
                sent = now_ms();
                sock.write_all(&packet(&[&varint(1), &sent.to_be_bytes()])).await?;
            } else if id == 1 {
                if let Some(s) = status.take() {
                    return Ok((s, now_ms() - sent));
                }
            }
        }
    }
}

fn num(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(-1.0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(-1.0),
        _ => -1.0,
    }
}

fn whole(f: f64) -> Value {
    if f.fract() == 0.0 {
        json!(f as i64)
    } else {
        json!(f)
    }
}

/// Shapes an API v2 or ping result the same way for the renderer.
pub fn normalize(d: &Value, source: &str) -> Value {
    let players = d.get("players").cloned().unwrap_or_else(|| json!({}));
    let motd = match d.get("motd") {
        Some(m @ Value::Object(_)) => {
            let lines = m.get("lines").and_then(Value::as_array).map(|l| l.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n"));
            [m.str_of("clean").map(String::from), m.str_of("text").map(String::from), lines]
                .into_iter()
                .flatten()
                .find(|s| !s.is_empty())
                .unwrap_or_else(|| motd_text(m))
        }
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let version = match d.get("version") {
        Some(v @ Value::Object(_)) => v.string_or("name", ""),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let online = d.get("online") != Some(&json!(false));
    let pick = |a: Option<&Value>, b: Option<&Value>| if a.is_some_and(|v| !v.is_null()) { num(a) } else { num(b) };
    let favicon = d.str_of("favicon").filter(|f| f.starts_with("data:image/")).map(String::from);
    let mut out = info();
    crate::js::assign(
        &mut out,
        &json!({
            "state": if online { "online" } else { "offline" },
            "online": online,
            "players": whole(pick(players.get("online"), d.get("playersOnline"))),
            "max": whole(pick(players.get("max"), d.get("playersMax"))),
            "version": version,
            "motd": motd,
            "ping": whole(pick(d.get("ping"), d.get("latency"))),
            "favicon": favicon,
            "source": source,
            "checked": now_ms(),
        }),
    );
    out
}

/// Status with a 30 s cache; one check at a time (callers wait for the running one).
pub struct Status {
    cache: Mutex<Option<Value>>,
}

impl Default for Status {
    fn default() -> Self {
        Self { cache: Mutex::new(None) }
    }
}

impl Status {
    /// Live status of Nore MC: API v2 first, then a direct ping; never fails.
    pub async fn get(&self, client: &reqwest::Client, force: bool) -> Value {
        let mut cache = self.cache.lock().await;
        if let Some(c) = cache.as_ref() {
            if !force && now_ms() - c.i64_of("checked") < 30_000 {
                return c.clone();
            }
        }
        let v = fetch_status(client, &api_base()).await;
        *cache = Some(v.clone());
        v
    }
}

pub async fn fetch_status(client: &reqwest::Client, api: &str) -> Value {
    let url = format!("{api}/servers/{}", urlencoding::encode(ADDRESS));
    let api_answer = async {
        let res = client.get(&url).header("accept", "application/json").timeout(Duration::from_secs(4)).send().await.ok()?;
        if !res.status().is_success() {
            return None;
        }
        let body: Value = res.json().await.ok()?;
        Some(normalize(body.get("data").filter(|d| !d.is_null()).unwrap_or(&body), "api"))
    };
    if let Some(v) = api_answer.await {
        return v;
    }
    // API unreachable: ping the server ourselves
    let (host, port) = srv_target().await;
    match slp(&host, port, Duration::from_secs(5)).await {
        Ok((status, ping)) => normalize(
            &json!({
                "online": true,
                "players": status.get("players").cloned().unwrap_or_else(|| json!({})),
                "version": status.pointer("/version/name").cloned().unwrap_or(Value::Null),
                "motd": motd_text(status.get("description").unwrap_or(&Value::Null)),
                "favicon": status.get("favicon").cloned().unwrap_or(Value::Null),
                "ping": ping,
            }),
            "ping",
        ),
        Err(e) => {
            let unknown = matches!(&e, crate::Error::Io(io) if io.kind() == std::io::ErrorKind::NotFound) || e.to_string().contains("failed to lookup address");
            let mut out = info();
            crate::js::assign(
                &mut out,
                &json!({ "state": if unknown { "unknown" } else { "offline" }, "online": false, "players": -1, "max": -1, "version": "", "motd": "", "ping": -1, "favicon": null, "source": "ping", "checked": now_ms() }),
            );
            out
        }
    }
}

/// `_minecraft._tcp` SRV record of the official address, if there is one.
async fn srv_target() -> (String, u16) {
    let lookup = async {
        let resolver = hickory_resolver::TokioAsyncResolver::tokio_from_system_conf().ok()?;
        let srv = resolver.srv_lookup(format!("_minecraft._tcp.{ADDRESS}.")).await.ok()?;
        let r = srv.iter().next()?;
        Some((r.target().to_utf8().trim_end_matches('.').to_string(), r.port()))
    };
    tokio::time::timeout(Duration::from_secs(3), lookup).await.ok().flatten().unwrap_or_else(|| (ADDRESS.to_string(), PORT))
}

/// Instance to play Nore MC with: the selected Nore Client instance, else the last played one.
pub fn pick_instance(instances: &[Value], selected: Option<&str>) -> Value {
    let nore: Vec<&Value> = instances.iter().filter(|i| i.truthy_of("noreClient")).collect();
    if let Some(sel) = nore.iter().find(|i| selected.is_some() && i.str_of("id") == selected) {
        return (*sel).clone();
    }
    nore.into_iter().max_by_key(|i| i.i64_of("lastPlayed")).cloned().unwrap_or(Value::Null)
}

#[allow(dead_code)]
fn compound_of(t: &Tag) -> Option<&Compound> {
    match t {
        Tag::Compound(c) => Some(c),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    //! Port of launcher/test/official.test.js.
    use super::*;
    use crate::testdata;

    fn entries(buf: &[u8]) -> Vec<Compound> {
        let (_, root) = nbt::read(buf).unwrap();
        match field(&root, "servers") {
            Some(Tag::List(_, items)) => items.iter().filter_map(|t| compound_of(t).cloned()).collect(),
            _ => vec![],
        }
    }
    fn s(c: &Compound, k: &str) -> String {
        match field(c, k) {
            Some(Tag::String(s)) => s.clone(),
            _ => String::new(),
        }
    }
    fn dat(list: &[(&str, &str)]) -> Vec<u8> {
        let items =
            list.iter().map(|(n, ip)| Tag::Compound(vec![("name".into(), Tag::String((*n).into())), ("ip".into(), Tag::String((*ip).into()))])).collect();
        nbt::write("", &vec![("servers".into(), Tag::List(nbt::COMPOUND, items))])
    }

    #[test]
    fn address_matching() {
        for a in ["mc.noreclient.pl", "MC.NoreClient.PL", "mc.noreclient.pl:25565", " mc.noreclient.pl. "] {
            assert!(matches(a), "{a}");
        }
        for a in ["mc.noreclient.pl:25566", "play.noreclient.pl", "mc.noreclient.pl.evil.com", ""] {
            assert!(!matches(a), "{a}");
        }
    }

    #[test]
    fn byte_identical_with_the_javascript_launcher() {
        let input = hex::decode(testdata::SERVERS_DAT).unwrap();
        let (name, root) = nbt::read(&input).unwrap();
        assert_eq!(nbt::write(&name, &root), input);
        assert_eq!(hex::encode(ensure_in_nbt(Some(&input)).unwrap().unwrap()), testdata::SERVERS_DAT_ENSURED);
        assert_eq!(hex::encode(ensure_in_nbt(None).unwrap().unwrap()), testdata::EMPTY_ENSURED);
    }

    #[test]
    fn added_at_the_top_own_servers_untouched() {
        let out = ensure_in_nbt(Some(&dat(&[("Mój", "play.example.org"), ("H", "mc.hypixel.net")]))).unwrap().unwrap();
        let list = entries(&out);
        assert_eq!(list.iter().map(|c| s(c, "ip")).collect::<Vec<_>>(), vec![ADDRESS, "play.example.org", "mc.hypixel.net"]);
        assert_eq!(s(&list[0], "name"), NAME);
        assert!(ensure_in_nbt(Some(&dat(&[("Mój", "x.pl"), ("Nore", "MC.NoreClient.pl:25565")]))).unwrap().is_none());
    }

    #[tokio::test]
    async fn servers_dat_created_and_unreadable_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ensure_servers_dat(dir.path()).await.unwrap());
        assert_eq!(entries(&std::fs::read(dir.path().join("servers.dat")).unwrap()).len(), 1);
        assert!(!ensure_servers_dat(dir.path()).await.unwrap());
        std::fs::write(dir.path().join("servers.dat"), [1, 2, 3]).unwrap();
        assert!(!ensure_servers_dat(dir.path()).await.unwrap());
        assert_eq!(std::fs::read(dir.path().join("servers.dat")).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn instance_choice() {
        let list = vec![
            json!({ "id": "v", "noreClient": false, "lastPlayed": 9 }),
            json!({ "id": "a", "noreClient": true, "lastPlayed": 1 }),
            json!({ "id": "b", "noreClient": true, "lastPlayed": 5 }),
        ];
        assert_eq!(pick_instance(&list, Some("a"))["id"], "a");
        assert_eq!(pick_instance(&list, Some("v"))["id"], "b");
        assert_eq!(pick_instance(&[json!({ "id": "v" })], Some("v")), Value::Null);
    }

    #[tokio::test]
    async fn api_answer_is_used() {
        let srv = crate::testutil::serve(vec![crate::testutil::Reply::json(
            r#"{"online":true,"players":{"online":12,"max":100},"version":{"name":"1.21.x"},"motd":{"clean":"Witaj"},"ping":31}"#,
        )])
        .await;
        let s = fetch_status(crate::net::Net::for_tests().client(), &srv.url("/api/v2")).await;
        assert_eq!(srv.seen()[0].path, "/api/v2/servers/mc.noreclient.pl");
        assert_eq!(s["source"], "api");
        assert_eq!(
            (s["online"].clone(), s["players"].clone(), s["max"].clone(), s["version"].clone(), s["motd"].clone(), s["ping"].clone()),
            (json!(true), json!(12), json!(100), json!("1.21.x"), json!("Witaj"), json!(31))
        );
    }

    #[tokio::test]
    async fn server_list_ping_against_a_fake_server() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 1024];
            loop {
                let n = sock.read(&mut chunk).await.unwrap();
                if n == 0 {
                    return;
                }
                buf.extend_from_slice(&chunk[..n]);
                while let Some((len, o)) = read_varint(&buf, 0).unwrap() {
                    if buf.len() < o + len as usize {
                        break;
                    }
                    let body: Vec<u8> = buf[o..o + len as usize].to_vec();
                    buf.drain(..o + len as usize);
                    if body == [0] {
                        let j =
                            br#"{"version":{"name":"Paper 1.21.1"},"players":{"online":3,"max":50},"description":{"text":"Nore ","extra":[{"text":"MC"}]}}"#;
                        sock.write_all(&packet(&[&varint(0), &varint(j.len() as i32), j])).await.unwrap();
                    } else if body[0] == 1 {
                        sock.write_all(&packet(&[&body])).await.unwrap();
                    }
                }
            }
        });
        let (status, ping) = slp("127.0.0.1", port, Duration::from_secs(3)).await.unwrap();
        assert_eq!(status["players"]["online"], 3);
        assert_eq!(status["version"]["name"], "Paper 1.21.1");
        assert_eq!(motd_text(&status["description"]), "Nore MC");
        assert!(ping >= 0);
    }
}
