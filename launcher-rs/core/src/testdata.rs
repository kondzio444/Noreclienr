//! Test vectors produced by the JavaScript launcher (Node's crypto and launcher/src/main/*.js),
//! so the Rust port is checked against the real thing. The key pair is a throw-away test key.

/// main.js seal() fallback layout: key 00..1f, iv = 12 x 0x07, `{"accessToken":"t","refreshToken":"r"}`.
pub const ELECTRON_GCM_BOX: &str =
    "BwcHBwcHBwcHBwcHGlJ9eVgC56n1WZmtQuMIfXRIxz8MaqSHkvJ45e5zzrnVfqFR+pLna5vINq5rtVd1BX7TDKM9";

/// Chromium os_crypt "v10" on Linux (PBKDF2("peanuts"), AES-128-CBC): `{"accessToken":"x"}`.
pub const OSCRYPT_V10_LINUX: &str = "djEwcwmwCMA70Op3O0k/Q1cxvnXzeIGn0sVKRZ9NjzXUen0=";

/// chat.js identity: SPKI DER of the public key (base64) and the PKCS#8 PEM private key.
pub const ID_PUB: &str = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhoJymZ/Gc5LcGtpoMextWJRfl5u2k/zZGLdB7AHkhg//OEbvKLYNXypuz2AlTacxMzUTvJ23Hz+2wulkDLhsQA==";
pub const ID_PRIV: &str = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgH6UtJn6QclLkHyab\nq6MnstbPPSNbGO/LTel1TJaCuiqhRANCAASGgnKZn8Zzktwa2mgx7G1YlF+Xm7aT\n/NkYt0HsAeSGD/84Ru8otg1fKm7PYCVNpzEzNRO8nbcfP7bC6WQMuGxA\n-----END PRIVATE KEY-----\n";
/// sha256(SPKI)[..20 hex] – the Nore ID of that key.
pub const ID_HEX: &str = "1715be5dfbe1cfc04c92";

/// hub.js canonical() of { name: 'Steve_PL', uuid: '0123…cdef', hex: ID_HEX, ts: 1792270000000,
/// online: true, cosmetics: WINGS }.
pub const CANON: &str = "nore-hub/1|Steve_PL|0123456789abcdef0123456789abcdef|1715be5dfbe1cfc04c92|1792270000000|1|823ee26d45cc7d0eb189266074fbd7fc59446095f4bee73ea4d33db5f91b5872";
pub const WINGS: &str = r#"{"v":1,"slots":{"back":{"id":"bat_wings","color":16711935,"variant":"classic","opts":{"speed":1.5,"glow":true,"style":"soft"}}}}"#;
/// official.js writeNbt() of a servers.dat with an own server and a hidden Nore MC entry.
pub const SERVERS_DAT: &str = "0a0000090007736572766572730a000000020800046e616d6500044dc3b36a08000269700010706c61792e6578616d706c652e6f726701000e616363657074546578747572657302000800046e616d6500106d632e6e6f7265636c69656e742e706c080002697000106d632e6e6f7265636c69656e742e706c01000668696464656e010004000178000000000000000500";
/// official.js ensureInNbt(SERVERS_DAT).
pub const SERVERS_DAT_ENSURED: &str = "0a0000090007736572766572730a000000020800046e616d6500074e6f7265204d43080002697000106d632e6e6f7265636c69656e742e706c01000668696464656e00000800046e616d6500044dc3b36a08000269700010706c61792e6578616d706c652e6f726701000e6163636570745465787475726573020004000178000000000000000500";
/// official.js ensureInNbt(null).
pub const EMPTY_ENSURED: &str = "0a0000090007736572766572730a000000010800046e616d6500074e6f7265204d43080002697000106d632e6e6f7265636c69656e742e706c0000";

/// crypto.sign('sha256', CANON, key) by Node (DER).
pub const SIG: &str = "MEUCIQCBHU2hXF4x4o4GNbjW0AvKk+KgkxTE8tG1Os/Dtc5G5AIgfo9c7mhczrpZi1L0/Ckyt4HGLQIkAnGLK9m4UmRdLsI=";
