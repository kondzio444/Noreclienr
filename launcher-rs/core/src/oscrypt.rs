//! Reading what the Electron launcher sealed with `safeStorage` (Chromium's os_crypt), so a premium
//! session and the chat identity survive the move to the Rust launcher.
//!
//! * Windows: `v10` + nonce(12) + AES-256-GCM, the key is `os_crypt.encrypted_key` of
//!   `<userData>/Local State`, protected with DPAPI (`DPAPI` prefix).
//! * macOS: `v10` + AES-128-CBC, key = PBKDF2-SHA1(Keychain password of "Nore Launcher Safe
//!   Storage", "saltysalt", 1003 rounds).
//! * Linux: `v10` = AES-128-CBC with PBKDF2-SHA1("peanuts", "saltysalt", 1 round) (no keyring);
//!   `v11` (password in the desktop keyring) is not read in phase 1 – the player logs in again.

use std::path::Path;

#[allow(dead_code)]
const SALT: &[u8] = b"saltysalt";

#[allow(dead_code)]
fn cbc_key(password: &[u8], rounds: u32) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password, SALT, rounds, &mut key);
    key
}

#[allow(dead_code)]
fn cbc_decrypt(key: &[u8; 16], data: &[u8]) -> Option<Vec<u8>> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    let iv = [b' '; 16];
    cbc::Decryptor::<aes::Aes128>::new(key.into(), &iv.into()).decrypt_padded_vec_mut::<Pkcs7>(data).ok()
}

/// Decrypts one `safeStorage.encryptString` result. `user_data` is Electron's userData folder.
pub fn decrypt(data: &[u8], user_data: &Path) -> Option<Vec<u8>> {
    let _ = user_data;
    #[cfg(target_os = "linux")]
    {
        if let Some(rest) = data.strip_prefix(b"v10") {
            return cbc_decrypt(&cbc_key(b"peanuts", 1), rest);
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let rest = data.strip_prefix(b"v10")?;
        let entry = keyring::Entry::new("Nore Launcher Safe Storage", "Nore Launcher").ok()?;
        let password = entry.get_password().ok()?;
        cbc_decrypt(&cbc_key(password.as_bytes(), 1003), rest)
    }
    #[cfg(windows)]
    {
        windows::decrypt(data, user_data)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = data;
        None
    }
}

#[cfg(windows)]
mod windows {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    use base64::Engine;
    use std::path::Path;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    fn dpapi(data: &[u8]) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: input points at `data` for the call; output is allocated by Windows and freed below.
        let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut output) };
        if ok == 0 || output.pbData.is_null() {
            return None;
        }
        // SAFETY: Windows returned cbData bytes at pbData.
        let out = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { LocalFree(output.pbData as _) };
        Some(out)
    }

    fn master_key(user_data: &Path) -> Option<Vec<u8>> {
        let text = std::fs::read_to_string(user_data.join("Local State")).ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).ok()?;
        let b64 = json.get("os_crypt")?.get("encrypted_key")?.as_str()?;
        let raw = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
        dpapi(raw.strip_prefix(b"DPAPI")?)
    }

    pub fn decrypt(data: &[u8], user_data: &Path) -> Option<Vec<u8>> {
        match data.strip_prefix(b"v10") {
            Some(rest) if rest.len() > 12 + 16 => {
                let key = master_key(user_data)?;
                if key.len() != 32 {
                    return None;
                }
                let (nonce, ct) = rest.split_at(12);
                Aes256Gcm::new_from_slice(&key).ok()?.decrypt(Nonce::from_slice(nonce), ct).ok()
            }
            // very old Chromium: the value itself is a DPAPI blob
            _ => dpapi(data),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn cbc_matches_node() {
        let raw = base64::engine::general_purpose::STANDARD.decode(crate::testdata::OSCRYPT_V10_LINUX).unwrap();
        let plain = cbc_decrypt(&cbc_key(b"peanuts", 1), &raw[3..]).unwrap();
        assert_eq!(plain, br#"{"accessToken":"x"}"#);
        #[cfg(target_os = "linux")]
        assert_eq!(decrypt(&raw, Path::new("/nonexistent")).unwrap(), plain);
        assert!(decrypt(b"v11whatever", Path::new("/nonexistent")).is_none());
    }
}
