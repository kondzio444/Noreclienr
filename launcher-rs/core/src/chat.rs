//! Friends chat – the trusted half of the launcher (port of launcher/src/main/chat.js): this
//! launcher's identity (an ECDSA P-256 key pair, the private key sealed), the Nore ID derived from
//! the public key, contacts, invitations and message history. The transport (WebRTC through PeerJS)
//! stays in the renderer.
//!
//! Formats are those of chat.js, so existing Nore IDs keep working: the public key is SPKI DER in
//! base64, the Nore ID is the first 80 bits of SHA-256(SPKI) in hex, signatures are DER ECDSA over
//! SHA-256 of the UTF-8 text (Node's `crypto.sign('sha256', …)`).

use crate::error::{msg, Result};
use crate::js::{now_ms, ValueExt};
use crate::secrets::Secrets;
use crate::store::Store;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use p256::ecdsa::signature::{Signer, Verifier};
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const ID_HEX: usize = 20;
const HISTORY: usize = 500;

/// Nore ID (hex) of a public key.
pub fn hex_id(pub_b64: &str) -> Option<String> {
    let der = B64.decode(pub_b64).ok()?;
    Some(hex::encode(Sha256::digest(der))[..ID_HEX].to_string())
}

/// "NORE-XXXXX-XXXXX-XXXXX-XXXXX".
pub fn pretty(hex: &str) -> String {
    let up = hex.to_uppercase();
    let parts: Vec<String> = up.as_bytes().chunks(5).map(|c| String::from_utf8_lossy(c).into_owned()).collect();
    format!("NORE-{}", parts.join("-"))
}

/// "NORE-ABCDE-…" / "abcde…" / with spaces → 20 lowercase hex characters.
pub fn parse_id(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let rest = lower.strip_prefix("nore").unwrap_or(&lower);
    let hex: String = rest.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    (hex.len() == ID_HEX).then_some(hex)
}

/// Checks that `pub_b64` belongs to `hex` and signed `text`.
pub fn verify(hex: &str, pub_b64: &str, text: &str, sig_b64: &str) -> bool {
    let check = || -> Option<bool> {
        if hex_id(pub_b64)? != hex {
            return Some(false);
        }
        let key = VerifyingKey::from_public_key_der(&B64.decode(pub_b64).ok()?).ok()?;
        let sig = Signature::from_der(&B64.decode(sig_b64).ok()?).ok()?;
        // Node does not normalise S; accept both halves like OpenSSL does
        let sig = sig.normalize_s().unwrap_or(sig);
        Some(key.verify(text.as_bytes(), &sig).is_ok())
    };
    check().unwrap_or(false)
}

pub struct Identity {
    pub hex: String,
    pub id: String,
    pub pub_b64: String,
    key: SigningKey,
}

impl Identity {
    pub fn from_pem(pub_b64: &str, pem: &str) -> Result<Self> {
        let key = SigningKey::from_pkcs8_pem(pem).map_err(|_| msg("Uszkodzony klucz tożsamości"))?;
        let hex = hex_id(pub_b64).ok_or_else(|| msg("Uszkodzony klucz publiczny"))?;
        Ok(Self { id: pretty(&hex), hex, pub_b64: pub_b64.to_string(), key })
    }

    /// Base64 DER signature of the UTF-8 text.
    pub fn sign(&self, text: &str) -> String {
        let sig: Signature = self.key.sign(text.as_bytes());
        B64.encode(sig.to_der().as_bytes())
    }
}

/// Chat data of the launcher (identity is created on first use).
pub struct Chat {
    cached: Mutex<Option<std::sync::Arc<Identity>>>,
}

impl Default for Chat {
    fn default() -> Self {
        Self { cached: Mutex::new(None) }
    }
}

impl Chat {
    /// This launcher's identity, created on first use.
    pub fn identity(&self, store: &Store, secrets: &Secrets) -> Result<std::sync::Arc<Identity>> {
        let mut cached = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(i) = cached.as_ref() {
            return Ok(i.clone());
        }
        let rec = store.read(|d| d.pointer("/chat/identity").cloned());
        let existing = rec.as_ref().and_then(|r| {
            let pub_b64 = r.str_of("pub")?;
            let pem = secrets.unseal_str(r.str_of("priv")?).ok()?;
            Identity::from_pem(pub_b64, &pem).ok()
        });
        let ident = match existing {
            Some(i) => i,
            None => {
                let key = SigningKey::random(&mut rand::thread_rng());
                let pub_der = key.verifying_key().to_public_key_der().map_err(crate::error::wrap)?;
                let pub_b64 = B64.encode(pub_der.as_bytes());
                let pem = key.to_pkcs8_pem(LineEnding::LF).map_err(crate::error::wrap)?;
                let rec = json!({ "pub": pub_b64, "priv": secrets.seal_str(&pem), "created": now_ms() });
                store.update(|d| {
                    if !d.get("chat").is_some_and(Value::is_object) {
                        d["chat"] = json!({});
                    }
                    d["chat"]["identity"] = rec;
                })?;
                Identity::from_pem(&pub_b64, &pem)?
            }
        };
        let ident = std::sync::Arc::new(ident);
        *cached = Some(ident.clone());
        Ok(ident)
    }

    /// `chat:identity` – what the renderer may know.
    pub fn public_identity(&self, store: &Store, secrets: &Secrets) -> Result<Value> {
        let me = self.identity(store, secrets)?;
        let name = store.read(|d| {
            let sel = d.str_of("selectedAccount").map(String::from);
            d.get("accounts")
                .and_then(Value::as_array)
                .and_then(|a| a.iter().find(|x| x.str_of("id").map(String::from) == sel))
                .and_then(|a| a.str_of("name").map(String::from))
        });
        Ok(json!({ "hex": me.hex, "id": me.id, "pub": me.pub_b64, "name": name.unwrap_or_else(|| "Gracz".into()), "peer": format!("nore-{}", me.hex) }))
    }

    pub fn sign(&self, store: &Store, secrets: &Secrets, text: &str) -> Result<String> {
        Ok(self.identity(store, secrets)?.sign(text))
    }
}

// ------------------------------------------------------------------ contacts & invitations

fn data(store: &Store) -> (Vec<Value>, Vec<Value>, Value, Vec<Value>) {
    store.read(|d| {
        let c = d.get("chat").cloned().unwrap_or_else(|| json!({}));
        let arr = |k: &str| c.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
        (arr("contacts"), arr("requests"), c.get("history").cloned().unwrap_or_else(|| json!({})), arr("blocked"))
    })
}

fn update(store: &Store, f: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Result<()> {
    store.update(|d| {
        if !d.get("chat").is_some_and(Value::is_object) {
            d["chat"] = json!({});
        }
        let c = d["chat"].as_object_mut().expect("object");
        for k in ["contacts", "requests", "blocked"] {
            if !c.get(k).is_some_and(Value::is_array) {
                c.insert(k.into(), json!([]));
            }
        }
        if !c.get("history").is_some_and(Value::is_object) {
            c.insert("history".into(), json!({}));
        }
        f(c);
    })
}

fn arr<'a>(c: &'a mut serde_json::Map<String, Value>, k: &str) -> &'a mut Vec<Value> {
    c.get_mut(k).and_then(Value::as_array_mut).expect("prepared array")
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn contacts(store: &Store) -> Value {
    let (list, _, history, _) = data(store);
    Value::Array(
        list.into_iter()
            .map(|mut c| {
                let hex = c.string_or("hex", "");
                let h = history.get(&hex).and_then(Value::as_array).cloned().unwrap_or_default();
                let unread = h.iter().filter(|m| !m.truthy_of("mine") && !m.truthy_of("read")).count();
                crate::js::assign(
                    &mut c,
                    &json!({ "id": pretty(&hex), "peer": format!("nore-{hex}"), "last": h.last().cloned().unwrap_or(Value::Null), "unread": unread }),
                );
                c
            })
            .collect(),
    )
}

pub fn add_contact(store: &Store, my_hex: &str, id_text: &str, name: Option<&str>) -> Result<Value> {
    let hex = parse_id(id_text).ok_or_else(|| msg("To nie jest poprawny Nore ID (NORE-XXXXX-XXXXX-XXXXX-XXXXX)."))?;
    if hex == my_hex {
        return Err(msg("To Twój własny Nore ID."));
    }
    let (list, requests, _, _) = data(store);
    if list.iter().any(|c| c.str_of("hex") == Some(&hex)) {
        return Err(msg("Ten znajomy już jest na liście."));
    }
    let req = requests.iter().find(|r| r.str_of("hex") == Some(&hex)).cloned();
    let name = name
        .filter(|n| !n.is_empty())
        .map(String::from)
        .or_else(|| req.as_ref().and_then(|r| r.str_of("name").map(String::from)))
        .unwrap_or_else(|| "Znajomy".into());
    update(store, |c| {
        arr(c, "contacts").push(json!({ "hex": hex, "name": truncate(&name, 24), "pub": req.as_ref().and_then(|r| r.get("pub").cloned()).unwrap_or(Value::Null), "added": now_ms() }));
        arr(c, "requests").retain(|r| r.str_of("hex") != Some(&hex));
        arr(c, "blocked").retain(|b| b.as_str() != Some(&hex));
    })?;
    Ok(contacts(store))
}

pub fn remove_contact(store: &Store, hex: &str) -> Result<Value> {
    update(store, |c| {
        arr(c, "contacts").retain(|x| x.str_of("hex") != Some(hex));
        if let Some(h) = c.get_mut("history").and_then(Value::as_object_mut) {
            h.remove(hex);
        }
    })?;
    Ok(contacts(store))
}

/// After a verified handshake: remember the key and the name the friend uses now.
pub fn seen(store: &Store, hex: &str, pub_b64: &str, name: Option<&str>) -> Result<Value> {
    if hex_id(pub_b64).as_deref() != Some(hex) {
        return Ok(Value::Null);
    }
    let mut known = false;
    update(store, |c| {
        if let Some(x) = arr(c, "contacts").iter_mut().find(|k| k.str_of("hex") == Some(hex)) {
            known = true;
            x["pub"] = json!(pub_b64);
            if let Some(n) = name.filter(|n| !n.is_empty()) {
                x["name"] = json!(truncate(n, 24));
            }
            x["seen"] = json!(now_ms());
        }
    })?;
    Ok(json!(known))
}

pub fn requests(store: &Store) -> Value {
    let (_, reqs, _, _) = data(store);
    Value::Array(
        reqs.into_iter()
            .map(|mut r| {
                let id = pretty(r.str_of("hex").unwrap_or_default());
                r["id"] = json!(id);
                r
            })
            .collect(),
    )
}

/// Someone not on the list connected and proved their identity: an invitation.
pub fn add_request(store: &Store, hex: &str, pub_b64: &str, name: Option<&str>, text: Option<&str>) -> Result<Value> {
    let (list, _, _, blocked) = data(store);
    if hex_id(pub_b64).as_deref() != Some(hex) || blocked.iter().any(|b| b.as_str() == Some(hex)) || list.iter().any(|c| c.str_of("hex") == Some(hex)) {
        return Ok(requests(store));
    }
    update(store, |c| {
        let r = arr(c, "requests");
        r.retain(|x| x.str_of("hex") != Some(hex));
        r.push(json!({ "hex": hex, "pub": pub_b64, "name": truncate(name.filter(|n| !n.is_empty()).unwrap_or("Gracz"), 24), "text": truncate(text.unwrap_or(""), 200), "at": now_ms() }));
        let len = r.len();
        if len > 30 {
            r.drain(..len - 30);
        }
    })?;
    Ok(requests(store))
}

pub fn decline_request(store: &Store, hex: &str, block: bool) -> Result<Value> {
    update(store, |c| {
        arr(c, "requests").retain(|r| r.str_of("hex") != Some(hex));
        let b = arr(c, "blocked");
        if block && !b.iter().any(|x| x.as_str() == Some(hex)) {
            b.push(json!(hex));
        }
    })?;
    Ok(requests(store))
}

pub fn history(store: &Store, hex: &str) -> Value {
    let (_, _, h, _) = data(store);
    let list = h.get(hex).and_then(Value::as_array).cloned().unwrap_or_default();
    let skip = list.len().saturating_sub(HISTORY);
    Value::Array(list.into_iter().skip(skip).collect())
}

/// Adds or updates a message ({ mid, text, ts, mine, state }) – an existing mid is merged.
pub fn put_message(store: &Store, hex: &str, msg_in: &Value) -> Result<Value> {
    let (list, _, _, _) = data(store);
    if !list.iter().any(|c| c.str_of("hex") == Some(hex)) {
        return Ok(Value::Null);
    }
    let mut out = Value::Null;
    update(store, |c| {
        let h = c.get_mut("history").and_then(Value::as_object_mut).expect("history");
        let list = h.entry(hex.to_string()).or_insert_with(|| json!([])).as_array_mut().expect("array");
        let mid = msg_in.get("mid");
        if let Some(existing) = list.iter_mut().find(|m| mid.is_some() && m.get("mid") == mid) {
            crate::js::assign(existing, msg_in);
            out = existing.clone();
        } else {
            let mut m = json!({ "text": "", "ts": now_ms() });
            crate::js::assign(&mut m, msg_in);
            m["text"] = json!(truncate(msg_in.str_of("text").unwrap_or(""), 2000));
            out = m.clone();
            list.push(m);
        }
        let len = list.len();
        if len > HISTORY {
            list.drain(..len - HISTORY);
        }
    })?;
    Ok(out)
}

pub fn mark_read(store: &Store, hex: &str) -> Result<Value> {
    update(store, |c| {
        if let Some(list) = c.get_mut("history").and_then(|h| h.get_mut(hex)).and_then(Value::as_array_mut) {
            for m in list.iter_mut().filter(|m| !m.truthy_of("mine")) {
                m["read"] = json!(true);
            }
        }
    })?;
    Ok(json!(true))
}

pub fn clear_history(store: &Store, hex: &str) -> Result<Value> {
    update(store, |c| {
        if let Some(h) = c.get_mut("history").and_then(Value::as_object_mut) {
            h.insert(hex.into(), json!([]));
        }
    })?;
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdata;

    #[test]
    fn javascript_identity_keeps_its_nore_id_and_signatures() {
        assert_eq!(hex_id(testdata::ID_PUB).unwrap(), testdata::ID_HEX);
        let me = Identity::from_pem(testdata::ID_PUB, testdata::ID_PRIV).unwrap();
        assert_eq!(me.id, "NORE-1715B-E5DFB-E1CFC-04C92");
        // a signature made by Node verifies here, ours verifies too
        assert!(verify(testdata::ID_HEX, testdata::ID_PUB, testdata::CANON, testdata::SIG));
        let sig = me.sign(testdata::CANON);
        assert!(verify(testdata::ID_HEX, testdata::ID_PUB, testdata::CANON, &sig));
        assert!(!verify(testdata::ID_HEX, testdata::ID_PUB, "other text", &sig));
        assert!(!verify("0000000000aaaaaaaaaa", testdata::ID_PUB, testdata::CANON, &sig));
    }

    #[test]
    fn ids_parse_in_every_spelling() {
        assert_eq!(parse_id("NORE-1715B-E5DFB-E1CFC-04C92").as_deref(), Some(testdata::ID_HEX));
        assert_eq!(parse_id("1715b e5dfb e1cfc 04c92").as_deref(), Some(testdata::ID_HEX));
        assert_eq!(parse_id("NORE-123"), None);
    }

    #[test]
    fn identity_is_created_once_and_sealed() {
        let store = Store::memory(json!({}));
        let secrets = Secrets::in_memory();
        let chat = Chat::default();
        let a = chat.identity(&store, &secrets).unwrap();
        let rec = store.read(|d| d["chat"]["identity"].clone());
        assert!(rec["priv"].as_str().unwrap().starts_with("gcm:"));
        let again = Chat::default().identity(&store, &secrets).unwrap();
        assert_eq!(a.hex, again.hex);
        let text = "nore-hub/1|x";
        assert!(verify(&a.hex, &a.pub_b64, text, &a.sign(text)));
    }

    #[test]
    fn contacts_requests_and_history() {
        let store = Store::memory(json!({}));
        let friend = "abcdef0123456789abcd";
        add_contact(&store, "ffffffffffffffffffff", friend, Some("Alex")).unwrap();
        assert!(add_contact(&store, "ffffffffffffffffffff", friend, None).is_err());
        assert!(add_contact(&store, friend, friend, None).is_err());
        put_message(&store, friend, &json!({ "mid": "1", "text": "hej", "mine": false })).unwrap();
        put_message(&store, friend, &json!({ "mid": "1", "state": "read" })).unwrap();
        let c = contacts(&store);
        assert_eq!(c[0]["unread"], 1);
        assert_eq!(c[0]["last"]["state"], "read");
        assert_eq!(c[0]["id"], "NORE-ABCDE-F0123-45678-9ABCD");
        mark_read(&store, friend).unwrap();
        assert_eq!(contacts(&store)[0]["unread"], 0);
        assert_eq!(history(&store, friend).as_array().unwrap().len(), 1);
        clear_history(&store, friend).unwrap();
        assert_eq!(history(&store, friend), json!([]));
        assert_eq!(put_message(&store, "0000000000aaaaaaaaaa", &json!({ "mid": "x" })).unwrap(), Value::Null);
        // invitations need a key that matches the id
        let r = add_request(&store, testdata::ID_HEX, testdata::ID_PUB, Some("Steve"), Some("cześć")).unwrap();
        assert_eq!(r[0]["id"], "NORE-1715B-E5DFB-E1CFC-04C92");
        assert_eq!(add_request(&store, "1111111111aaaaaaaaaa", testdata::ID_PUB, None, None).unwrap().as_array().unwrap().len(), 1);
        decline_request(&store, testdata::ID_HEX, true).unwrap();
        assert_eq!(requests(&store), json!([]));
        assert_eq!(add_request(&store, testdata::ID_HEX, testdata::ID_PUB, None, None).unwrap(), json!([]));
        remove_contact(&store, friend).unwrap();
        assert_eq!(contacts(&store), json!([]));
    }
}
