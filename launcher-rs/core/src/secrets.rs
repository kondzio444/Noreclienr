//! Sealed secrets (Microsoft / Minecraft tokens, the chat identity key).
//!
//! A random 256-bit key lives in the system key store (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux) through the `keyring` crate; every secret is sealed with AES-256-GCM
//! under that key, so tokens of any size fit (Windows credentials are limited to ~1280 characters,
//! a Minecraft token pair is bigger). Without a key store – a Linux machine without a keyring,
//! a headless CI – the key is a random file `launcher-rs.key` (mode 600) in the data folder, the
//! same fallback the Electron launcher uses. Nothing is ever written in plain text.
//!
//! Sealed box: `{ "gcm": base64(iv[12] | tag[16] | ciphertext), "k": "keyring" | "file" }` –
//! the byte layout of the Electron launcher's fallback, so both can be read with one routine.

use crate::error::{msg, Result};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use serde_json::{json, Value};
use std::path::Path;

const SERVICE: &str = "Nore Launcher";
const KEY_ENTRY: &str = "token-key";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeySource {
    Keyring,
    File,
    Memory,
}

impl KeySource {
    fn tag(self) -> &'static str {
        match self {
            KeySource::Keyring => "keyring",
            KeySource::File => "file",
            KeySource::Memory => "memory",
        }
    }
}

#[derive(Clone)]
pub struct Secrets {
    key: [u8; 32],
    source: KeySource,
}

impl std::fmt::Debug for Secrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Secrets").field("source", &self.source).finish_non_exhaustive()
    }
}

fn random_key() -> [u8; 32] {
    let mut k = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut k);
    k
}

fn keyring_key() -> Option<[u8; 32]> {
    if std::env::var_os("NORE_NO_KEYRING").is_some() {
        return None;
    }
    let entry = keyring::Entry::new(SERVICE, KEY_ENTRY).ok()?;
    match entry.get_password() {
        Ok(b64) => {
            let raw = B64.decode(b64.trim()).ok()?;
            raw.try_into().ok()
        }
        Err(keyring::Error::NoEntry) => {
            let k = random_key();
            entry.set_password(&B64.encode(k)).ok()?;
            // read back: some stores accept a write they cannot keep
            let back = entry.get_password().ok()?;
            (B64.decode(back.trim()).ok()? == k).then_some(k)
        }
        Err(_) => None,
    }
}

fn file_key(file: &Path) -> Result<[u8; 32]> {
    if let Ok(k) = std::fs::read(file) {
        if let Ok(k) = <[u8; 32]>::try_from(k.as_slice()) {
            return Ok(k);
        }
    }
    let k = random_key();
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    write_private(file, &k)?;
    Ok(k)
}

/// Writes a file only the current user can read (mode 600 on Unix).
pub fn write_private(file: &Path, data: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(file)?;
        f.write_all(data)
    }
    #[cfg(not(unix))]
    {
        std::fs::write(file, data)
    }
}

/// AES-256-GCM in the Electron layout: iv(12) | tag(16) | ciphertext.
pub fn gcm_seal(key: &[u8; 32], plain: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(key.into());
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let ct = cipher.encrypt(Nonce::from_slice(&iv), plain).expect("AES-GCM encryption");
    let (data, tag) = ct.split_at(ct.len() - 16);
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    out
}

pub fn gcm_open(key: &[u8; 32], sealed: &[u8]) -> Option<Vec<u8>> {
    if sealed.len() < 28 {
        return None;
    }
    let (iv, rest) = sealed.split_at(12);
    let (tag, data) = rest.split_at(16);
    let mut ct = Vec::with_capacity(rest.len());
    ct.extend_from_slice(data);
    ct.extend_from_slice(tag);
    Aes256Gcm::new(key.into()).decrypt(Nonce::from_slice(iv), ct.as_slice()).ok()
}

impl Secrets {
    /// The key from the system key store, else from `launcher-rs.key`.
    pub fn open(key_file: &Path) -> Result<Self> {
        if let Some(key) = keyring_key() {
            return Ok(Self { key, source: KeySource::Keyring });
        }
        Ok(Self { key: file_key(key_file)?, source: KeySource::File })
    }

    /// A throw-away key (tests, the command line tool with `--ephemeral`).
    pub fn in_memory() -> Self {
        Self { key: random_key(), source: KeySource::Memory }
    }

    pub fn source(&self) -> KeySource {
        self.source
    }

    /// Seals a JSON value into a box for the settings file.
    pub fn seal(&self, value: &Value) -> Value {
        let text = serde_json::to_vec(value).unwrap_or_default();
        json!({ "gcm": B64.encode(gcm_seal(&self.key, &text)), "k": self.source.tag() })
    }

    /// Opens a box; `{}` when it cannot be opened (another machine or user, a damaged entry).
    pub fn unseal(&self, sealed: &Value) -> Value {
        let open = || -> Option<Value> {
            let b = B64.decode(sealed.get("gcm")?.as_str()?).ok()?;
            serde_json::from_slice(&gcm_open(&self.key, &b)?).ok()
        };
        open().unwrap_or_else(|| json!({}))
    }

    /// Seals a string as `gcm:<base64>` (the chat identity key).
    pub fn seal_str(&self, text: &str) -> String {
        format!("gcm:{}", B64.encode(gcm_seal(&self.key, text.as_bytes())))
    }

    /// Opens `gcm:` strings; other strings are returned as they are (plain values of old versions).
    pub fn unseal_str(&self, value: &str) -> Result<String> {
        match value.strip_prefix("gcm:") {
            None => Ok(value.to_string()),
            Some(b) => {
                let raw = B64.decode(b).map_err(|_| msg("Uszkodzony zapis klucza"))?;
                let plain = gcm_open(&self.key, &raw).ok_or_else(|| msg("Nie można odczytać klucza na tym komputerze"))?;
                String::from_utf8(plain).map_err(|_| msg("Uszkodzony zapis klucza"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_round_trip_and_wrong_key() {
        let s = Secrets::in_memory();
        let v = json!({ "accessToken": "abc", "refreshToken": "r".repeat(3000), "expiresAt": 1 });
        let b = s.seal(&v);
        assert!(!b.to_string().contains("abc"));
        assert_eq!(s.unseal(&b), v);
        assert_eq!(Secrets::in_memory().unseal(&b), json!({}));
        assert_eq!(s.unseal(&json!({ "gcm": "AAAA" })), json!({}));
        let t = s.seal_str("-----BEGIN PRIVATE KEY-----");
        assert!(t.starts_with("gcm:"));
        assert_eq!(s.unseal_str(&t).unwrap(), "-----BEGIN PRIVATE KEY-----");
        assert_eq!(s.unseal_str("plain").unwrap(), "plain");
    }

    #[test]
    fn file_key_is_stable_and_private() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("k.key");
        let a = file_key(&f).unwrap();
        assert_eq!(a, file_key(&f).unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    /// A box sealed by the Electron launcher's fallback (main.js seal(), random session.key).
    #[test]
    fn opens_the_electron_gcm_layout() {
        let key: [u8; 32] = hex::decode("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
            .unwrap()
            .try_into()
            .unwrap();
        // node -e: aes-256-gcm, iv = 12 x 0x07, text {"accessToken":"t","refreshToken":"r"}
        let sealed = B64.decode(crate::testdata::ELECTRON_GCM_BOX).unwrap();
        let plain = gcm_open(&key, &sealed).unwrap();
        assert_eq!(String::from_utf8(plain).unwrap(), r#"{"accessToken":"t","refreshToken":"r"}"#);
    }
}
