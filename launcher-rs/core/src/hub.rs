//! Nore Hub presence (port of launcher/src/main/hub.js): tells the Nore website which Minecraft
//! player this launcher plays as, so other Nore players see the Nore mark (docs/nore-hub.md).
//!
//! A hello signed with the chat identity when the game starts, a heartbeat every 60 s while it runs
//! and `online: false` when it exits. Premium accounts prove the name through Mojang
//! (session/minecraft/join); nick-only accounts are listed unverified. Nothing here blocks the
//! launch: failures only go to the log, and Settings turns it off.

use crate::chat::Identity;
use crate::js::{now_ms, stringify, ValueExt};
use rand::RngCore;
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub const MOJANG_JOIN: &str = "https://sessionserver.mojang.com/session/minecraft/join";
const BEAT: Duration = Duration::from_secs(60);
const GAP: Duration = Duration::from_secs(16); // the worker takes one hello per Nore ID per 15 s
const FAIL: Duration = Duration::from_secs(30);

pub fn hub_base() -> String {
    std::env::var("NORE_HUB").unwrap_or_else(|_| "https://noreclient.pl".into()).trim_end_matches('/').to_string()
}

static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_]{2,16}$").unwrap());
static KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9_]{1,32}$").unwrap());
static OPT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9_]{1,24}$").unwrap());

/// Why a cosmetics object is not acceptable (same rules as the worker), or None.
pub fn cosmetics_error(c: &Value) -> Option<String> {
    let Some(o) = c.as_object() else { return Some("cosmetics: wymagane { v, slots }".into()) };
    let v_ok = o.get("v").and_then(Value::as_f64).is_some_and(|v| v.fract() == 0.0);
    let Some(slots) = o.get("slots").and_then(Value::as_object).filter(|_| v_ok) else {
        return Some("cosmetics: wymagane { v, slots }".into());
    };
    if o.keys().any(|k| k != "v" && k != "slots") {
        return Some("cosmetics: dozwolone są tylko v i slots".into());
    }
    if slots.len() > 10 {
        return Some("cosmetics: najwyżej 10 slotów".into());
    }
    for (slot, s) in slots {
        let Some(so) = s.as_object() else { return Some(format!("cosmetics: zły slot {slot}")) };
        if !KEY.is_match(slot) || so.keys().any(|k| !["id", "color", "variant", "opts"].contains(&k.as_str())) {
            return Some(format!("cosmetics: zły slot {slot}"));
        }
        if !s.str_of("id").is_some_and(|id| KEY.is_match(id)) {
            return Some(format!("cosmetics: zły id w slocie {slot}"));
        }
        if let Some(v) = so.get("variant") {
            if !v.as_str().is_some_and(|v| KEY.is_match(v)) {
                return Some(format!("cosmetics: zły variant w slocie {slot}"));
            }
        }
        if let Some(col) = so.get("color") {
            if !col.as_f64().is_some_and(|c| c.fract() == 0.0 && (0.0..=16_777_215.0).contains(&c)) {
                return Some(format!("cosmetics: zły color w slocie {slot}"));
            }
        }
        if let Some(opts) = so.get("opts") {
            let Some(oo) = opts.as_object().filter(|o| o.len() <= 12) else { return Some(format!("cosmetics: złe opts w slocie {slot}")) };
            for (k, v) in oo {
                let ok = v.is_boolean() || v.as_f64().is_some_and(f64::is_finite) || v.as_str().is_some_and(|s| s.encode_utf16().count() <= 32);
                if !OPT.is_match(k) || !ok {
                    return Some(format!("cosmetics: zła opcja {k} w slocie {slot}"));
                }
            }
        }
    }
    if stringify(c).len() > 2048 {
        return Some("cosmetics: najwyżej 2048 bajtów".into());
    }
    None
}

/// The string a hello is signed over (docs/nore-hub.md).
pub fn canonical(name: &str, uuid: &str, hex: &str, ts: i64, online: bool, cosmetics: &Value) -> String {
    let cos = hex::encode(Sha256::digest(stringify(cosmetics).as_bytes()));
    format!("nore-hub/1|{name}|{uuid}|{hex}|{ts}|{}|{cos}", if online { 1 } else { 0 })
}

/// The signed hello body.
pub fn hello_body(me: &Identity, name: &str, uuid: &str, premium_server_id: Option<&str>, online: bool, cosmetics: &Value, client: &str, ts: i64) -> Value {
    let premium = online && premium_server_id.is_some();
    let mut body = json!({ "name": name, "uuid": uuid, "premium": premium, "hex": me.hex, "pub": me.pub_b64, "ts": ts, "online": online, "cosmetics": cosmetics });
    if premium {
        body["serverId"] = json!(premium_server_id);
    }
    body["client"] = json!(client);
    body["sig"] = json!(me.sign(&canonical(name, uuid, &me.hex, ts, online, cosmetics)));
    body
}

/// The game account the hello is about.
#[derive(Clone, Debug)]
pub struct Player {
    pub name: String,
    pub uuid: String,
    pub premium: bool,
    pub access_token: Option<String>,
}

impl Player {
    /// From a launch-ready account; None when the name / uuid cannot be announced.
    pub fn from_account(a: &Value) -> Option<Self> {
        let name = a.str_of("name")?.to_string();
        let uuid = a.str_of("uuid")?.replace('-', "").to_lowercase();
        if !NAME.is_match(&name) || uuid.len() != 32 || !uuid.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let token = a.str_of("accessToken").filter(|t| !t.is_empty() && *t != "0").map(String::from);
        let premium = a.str_of("type") == Some("microsoft") && token.is_some();
        Some(Self { name, uuid, premium, access_token: if premium { token } else { None } })
    }
}

#[derive(Default)]
struct Pace {
    last: Option<tokio::time::Instant>,
    failed: Option<tokio::time::Instant>,
}

/// Hub presence of the running game (one session at a time).
pub struct Hub {
    client: reqwest::Client,
    version: String,
    pace: Arc<Mutex<Pace>>,
    running: std::sync::Mutex<Option<CancellationToken>>,
}

pub type Log = Arc<dyn Fn(String) + Send + Sync>;

impl Hub {
    pub fn new(client: reqwest::Client, version: &str) -> Self {
        Self { client, version: version.to_string(), pace: Arc::default(), running: std::sync::Mutex::new(None) }
    }

    /// Waits for the gap the worker wants, then sends one hello. Ok(true) when accepted, Ok(false)
    /// when the name belongs to another Nore player (no more hellos this session).
    async fn hello(client: &reqwest::Client, pace: &Mutex<Pace>, me: &Identity, p: &Player, server_id: &mut Option<String>, online: bool, cosmetics: &Value, version: &str, log: &Log) -> bool {
        let mut pace = pace.lock().await;
        let now = tokio::time::Instant::now();
        let ready = [pace.last.map(|l| l + GAP), pace.failed.map(|f| f + FAIL)].into_iter().flatten().max();
        if let Some(r) = ready.filter(|r| *r > now) {
            tokio::time::sleep_until(r).await;
        }
        pace.last = Some(tokio::time::Instant::now());
        if online && p.premium && server_id.is_none() {
            // without the Mojang proof this hello goes out unverified, the next one tries again
            match mojang_join(client, p).await {
                Ok(id) => *server_id = Some(id),
                Err(e) => log(e),
            }
        }
        let body = hello_body(me, &p.name, &p.uuid, server_id.as_deref().filter(|_| p.premium), online, cosmetics, version, now_ms());
        let res = client.post(format!("{}/api/v1/hub/hello", hub_base())).header("User-Agent", "NoreLauncher").json(&body).timeout(Duration::from_secs(10)).send().await;
        match res {
            Ok(r) if r.status().is_success() => {
                pace.failed = None;
                true
            }
            Ok(r) => {
                pace.failed = Some(tokio::time::Instant::now());
                let status = r.status().as_u16();
                let err = r.json::<Value>().await.ok().and_then(|v| v.str_of("error").map(String::from)).unwrap_or_default();
                log(format!("hello {status}: {err}"));
                if status == 401 && body["premium"] == json!(true) {
                    *server_id = None; // a fresh Mojang join next time
                }
                status != 409 // the name belongs to another Nore player
            }
            Err(e) => {
                pace.failed = Some(tokio::time::Instant::now());
                log(e.to_string());
                true
            }
        }
    }

    /// The game started: hello now, then every 60 s until [`Hub::game_stopped`].
    pub fn game_started(&self, me: Arc<Identity>, player: Player, cosmetics: Value, log: Log) {
        self.game_stopped();
        let token = CancellationToken::new();
        *self.running.lock().unwrap_or_else(|e| e.into_inner()) = Some(token.clone());
        let client = self.client.clone();
        let pace = self.pace.clone();
        let version = self.version.clone();
        tokio::spawn(async move {
            let mut server_id = None;
            let mut sent = false;
            loop {
                let go_on = tokio::select! {
                    _ = token.cancelled() => break,
                    ok = Self::hello(&client, &pace, &me, &player, &mut server_id, true, &cosmetics, &version, &log) => ok,
                };
                sent = true;
                if !go_on {
                    return;
                }
                tokio::select! {
                    _ = token.cancelled() => break,
                    _ = tokio::time::sleep(BEAT) => {}
                }
            }
            if sent {
                Self::hello(&client, &pace, &me, &player, &mut server_id, false, &cosmetics, &version, &log).await;
            }
        });
    }

    pub fn game_stopped(&self) {
        if let Some(t) = self.running.lock().unwrap_or_else(|e| e.into_inner()).take() {
            t.cancel();
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }
}

async fn mojang_join(client: &reqwest::Client, p: &Player) -> Result<String, String> {
    let mut raw = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut raw);
    let server_id = hex::encode(raw);
    let res = client
        .post(MOJANG_JOIN)
        .json(&json!({ "accessToken": p.access_token, "selectedProfile": p.uuid, "serverId": server_id }))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Mojang join: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Mojang join: HTTP {}", res.status().as_u16()));
    }
    Ok(server_id)
}

#[cfg(test)]
mod tests {
    //! Port of launcher/test/hub.test.js (cosmetics + signature parts).
    use super::*;
    use crate::testdata;

    fn wings() -> Value {
        serde_json::from_str(testdata::WINGS).unwrap()
    }

    #[test]
    fn cosmetics_validation_follows_the_contract() {
        assert_eq!(cosmetics_error(&wings()), None);
        assert_eq!(cosmetics_error(&json!({ "v": 1, "slots": {} })), None);
        assert!(cosmetics_error(&Value::Null).is_some());
        assert!(cosmetics_error(&json!({ "v": 1.5, "slots": {} })).is_some());
        assert!(cosmetics_error(&json!({ "v": 1, "slots": [] })).is_some());
        assert!(cosmetics_error(&json!({ "v": 1, "slots": { "Back": { "id": "x" } } })).is_some());
        assert!(cosmetics_error(&json!({ "v": 1, "slots": { "back": { "id": "x", "color": 0x1000000 } } })).is_some());
        assert!(cosmetics_error(&json!({ "v": 1, "slots": { "back": { "id": "x", "opts": { "s": "x".repeat(33) } } } })).is_some());
        assert!(cosmetics_error(&json!({ "v": 1, "slots": { "back": { "id": "x", "url": "https://example.com" } } })).is_some());
        let many: serde_json::Map<String, Value> = (0..11).map(|i| (format!("s{i}"), json!({ "id": "x" }))).collect();
        assert!(cosmetics_error(&json!({ "v": 1, "slots": many })).is_some());
    }

    #[test]
    fn canonical_string_is_identical_to_hub_js() {
        let text = canonical("Steve_PL", "0123456789abcdef0123456789abcdef", testdata::ID_HEX, 1792270000000, true, &wings());
        assert_eq!(text, testdata::CANON);
        let me = Identity::from_pem(testdata::ID_PUB, testdata::ID_PRIV).unwrap();
        let body = hello_body(&me, "Steve_PL", "0123456789abcdef0123456789abcdef", None, true, &wings(), "1.4.5", 1792270000000);
        assert_eq!(body["premium"], false);
        assert!(crate::chat::verify(testdata::ID_HEX, body["pub"].as_str().unwrap(), testdata::CANON, body["sig"].as_str().unwrap()));
    }

    #[test]
    fn players_that_can_be_announced() {
        let p = Player::from_account(&json!({ "type": "offline", "name": "Gracz_1", "uuid": "B50AD385-829D-3141-A216-7E7D7539BA7F", "accessToken": "0" })).unwrap();
        assert_eq!(p.uuid, "b50ad385829d3141a2167e7d7539ba7f");
        assert!(!p.premium);
        assert!(Player::from_account(&json!({ "name": "zła nazwa", "uuid": "b50ad385829d3141a2167e7d7539ba7f" })).is_none());
        assert!(Player::from_account(&json!({ "type": "microsoft", "name": "Steve", "uuid": "b50ad385829d3141a2167e7d7539ba7f", "accessToken": "ey" })).unwrap().premium);
    }

    #[tokio::test]
    async fn hello_goes_to_the_hub_and_offline_on_stop() {
        let srv = crate::testutil::serve(vec![crate::testutil::Reply::json("{}"), crate::testutil::Reply::json("{}")]).await;
        std::env::set_var("NORE_HUB", srv.url(""));
        let hub = Hub::new(crate::net::Net::for_tests().client().clone(), "1.4.5");
        let me = Arc::new(Identity::from_pem(testdata::ID_PUB, testdata::ID_PRIV).unwrap());
        let p = Player::from_account(&json!({ "type": "offline", "name": "Gracz_1", "uuid": "b50ad385829d3141a2167e7d7539ba7f" })).unwrap();
        hub.game_started(me, p, json!({ "v": 1, "slots": {} }), Arc::new(|_| {}));
        for _ in 0..100 {
            if srv.hits() >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let first: Value = serde_json::from_str(&srv.seen()[0].body).unwrap();
        assert_eq!(srv.seen()[0].path, "/api/v1/hub/hello");
        assert_eq!((first["name"].clone(), first["online"].clone(), first["hex"].clone()), (json!("Gracz_1"), json!(true), json!(testdata::ID_HEX)));
        assert!(crate::chat::verify(
            testdata::ID_HEX,
            testdata::ID_PUB,
            &canonical("Gracz_1", "b50ad385829d3141a2167e7d7539ba7f", testdata::ID_HEX, first["ts"].as_i64().unwrap(), true, &json!({ "v": 1, "slots": {} })),
            first["sig"].as_str().unwrap()
        ));
        hub.game_stopped();
        std::env::remove_var("NORE_HUB");
    }
}
