//! Accounts (port of launcher/src/main/auth.js): offline (non-premium) players and the Microsoft
//! device-code login → Xbox Live → XSTS → Minecraft, with refresh.

use crate::error::{msg, Error, Result};
use crate::js::{now_ms, ValueExt};
use crate::net::Net;
use md5::{Digest, Md5};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const MS_DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
pub const MS_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
pub const SCOPE: &str = "XboxLive.signin offline_access";
const NO_CLIENT_ID: &str = "Nie udało się pobrać identyfikatora aplikacji Microsoft – sprawdź połączenie z internetem i spróbuj ponownie.";

/// Endpoints (overridable in tests).
#[derive(Clone, Debug)]
pub struct Endpoints {
    pub device: String,
    pub token: String,
    pub xbl: String,
    pub xsts: String,
    pub mc_login: String,
    pub profile: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            device: MS_DEVICE.into(),
            token: MS_TOKEN.into(),
            xbl: "https://user.auth.xboxlive.com/user/authenticate".into(),
            xsts: "https://xsts.auth.xboxlive.com/xsts/authorize".into(),
            mc_login: "https://api.minecraftservices.com/authentication/login_with_xbox".into(),
            profile: "https://api.minecraftservices.com/minecraft/profile".into(),
        }
    }
}

/// UUID v3 like Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name) – what offline servers use.
pub fn offline_uuid(name: &str) -> String {
    let mut md5: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    md5[6] = (md5[6] & 0x0f) | 0x30;
    md5[8] = (md5[8] & 0x3f) | 0x80;
    let h = hex::encode(md5);
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

static OFFLINE_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_]{3,16}$").unwrap());

pub fn valid_offline_name(name: &str) -> bool {
    OFFLINE_NAME.is_match(name)
}

/// A non-premium account (works offline, never needs a login).
pub fn create_offline(name: &str) -> Result<Value> {
    if !valid_offline_name(name) {
        return Err(msg("Nick musi mieć 3–16 znaków: litery, cyfry lub _"));
    }
    let uuid = offline_uuid(name);
    Ok(json!({ "id": format!("offline-{uuid}"), "type": "offline", "name": name, "uuid": uuid, "accessToken": "0" }))
}

/// Microsoft identity errors (AADSTS codes) in plain Polish.
pub fn ms_error(j: &Value, fallback: &str) -> String {
    let d = j.str_of("error_description").unwrap_or_default();
    let err = j.str_of("error").unwrap_or_default();
    let both = format!("{d}{err}");
    if Regex::new(r"(?i)AADSTS7000218|AADSTS70002|unauthorized_client").unwrap().is_match(&both) {
        return "Aplikacja Nore nie ma włączonego logowania kodem w Microsoft (Allow public client flows).".into();
    }
    if Regex::new(r"AADSTS700016|AADSTS90002").unwrap().is_match(d) {
        return "Aplikacja Nore nie jest zarejestrowana w Microsoft – zgłoś to autorom.".into();
    }
    match err {
        "invalid_grant" => return "Sesja Microsoft wygasła – zaloguj się ponownie.".into(),
        "expired_token" => return "Kod logowania wygasł – spróbuj ponownie.".into(),
        "authorization_declined" | "access_denied" => return "Logowanie zostało odrzucone.".into(),
        _ => {}
    }
    let first = d.lines().next().unwrap_or("");
    let cleaned = Regex::new(r"^AADSTS\d+:\s*").unwrap().replace(first, "").to_string();
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned
    }
}

/// Xbox errors (XErr) in plain Polish.
pub fn xerr_message(code: i64) -> Option<&'static str> {
    Some(match code {
        2148916233 => "To konto Microsoft nie ma konta Xbox – utwórz je na xbox.com.",
        2148916235 => "Xbox Live jest niedostępny w Twoim kraju.",
        2148916236 => "Konto wymaga weryfikacji wieku (Korea).",
        2148916238 => "Konto dziecka – musi zostać dodane do rodziny przez osobę dorosłą.",
        _ => return None,
    })
}

#[derive(Clone)]
pub struct Auth {
    net: Net,
    pub ep: Endpoints,
}

struct JsonError {
    status: u16,
    xerr: Option<i64>,
    message: String,
}

impl Auth {
    pub fn new(net: Net) -> Self {
        Self { net, ep: Endpoints::default() }
    }

    async fn post_form(&self, url: &str, body: &[(&str, &str)]) -> Result<(u16, Value)> {
        let res = self.net.send_with_retry(|c| c.post(url).form(body), 4).await?;
        let status = res.status().as_u16();
        Ok((status, res.json().await.unwrap_or_else(|_| json!({}))))
    }

    async fn post_json(&self, url: &str, body: &Value) -> Result<Result<Value, JsonError>> {
        let res = self.net.send_with_retry(|c| c.post(url).header("Accept", "application/json").json(body), 4).await?;
        let status = res.status().as_u16();
        let j: Value = res.json().await.unwrap_or_else(|_| json!({}));
        if (200..300).contains(&status) {
            return Ok(Ok(j));
        }
        let message = ["errorMessage", "Message", "error"]
            .iter()
            .find_map(|k| j.str_of(k).filter(|s| !s.is_empty()).map(String::from))
            .unwrap_or_else(|| format!("HTTP {status} ({url})"));
        Ok(Err(JsonError { status, xerr: j.get("XErr").and_then(Value::as_i64), message }))
    }

    /// Starts the device code login: `{ device_code, user_code, verification_uri, expires_in, interval }`.
    pub async fn start_device_code(&self, client_id: Option<&str>) -> Result<Value> {
        let cid = client_id.filter(|c| !c.is_empty()).ok_or_else(|| msg(NO_CLIENT_ID))?;
        let (status, j) = self.post_form(&self.ep.device, &[("client_id", cid), ("scope", SCOPE)]).await?;
        if status != 200 {
            return Err(msg(ms_error(&j, "Nie udało się rozpocząć logowania Microsoft")));
        }
        Ok(j)
    }

    /// Waits until the player confirms the code; returns the Microsoft token answer.
    pub async fn poll_device_code(&self, client_id: &str, device_code: &str, expires_in: u64, interval: u64, cancel: &CancellationToken) -> Result<Value> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(expires_in);
        let mut every = Duration::from_secs(if interval == 0 { 5 } else { interval });
        while tokio::time::Instant::now() < deadline {
            tokio::select! {
                _ = cancel.cancelled() => return Err(msg("Anulowano logowanie")),
                _ = tokio::time::sleep(every) => {}
            }
            let (_, j) = self
                .post_form(
                    &self.ep.token,
                    &[("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("client_id", client_id), ("device_code", device_code)],
                )
                .await?;
            if j.get("access_token").is_some() {
                return Ok(j);
            }
            match j.str_of("error") {
                Some("authorization_pending") => continue,
                Some("slow_down") => {
                    every += Duration::from_secs(5);
                    continue;
                }
                _ => return Err(msg(ms_error(&j, "Logowanie nie powiodło się"))),
            }
        }
        Err(msg("Kod logowania wygasł – spróbuj ponownie"))
    }

    /// Microsoft access token → Minecraft profile + token.
    pub async fn minecraft_from_ms(&self, ms_access_token: &str) -> Result<Value> {
        let xbl = self
            .post_json(
                &self.ep.xbl,
                &json!({ "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access_token}") }, "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT" }),
            )
            .await?
            .map_err(|e| msg(e.message))?;
        let xsts = self
            .post_json(
                &self.ep.xsts,
                &json!({ "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.str_of("Token")] }, "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT" }),
            )
            .await?
            .map_err(|e| msg(e.xerr.and_then(xerr_message).map(String::from).unwrap_or(e.message)))?;
        let uhs = xsts.pointer("/DisplayClaims/xui/0/uhs").and_then(Value::as_str).ok_or_else(|| msg("Xbox Live nie zwrócił profilu"))?;
        let mc = match self
            .post_json(&self.ep.mc_login, &json!({ "identityToken": format!("XBL3.0 x={uhs};{}", xsts.str_of("Token").unwrap_or_default()) }))
            .await?
        {
            Ok(v) => v,
            Err(e) if e.status == 403 => return Err(msg("Mojang nie zatwierdził jeszcze aplikacji Nore do Minecraft API – logowanie ruszy po zatwierdzeniu.")),
            Err(e) if e.status == 429 => return Err(msg("Za dużo prób logowania – odczekaj kilka minut.")),
            Err(e) => return Err(msg(e.message)),
        };
        let token = mc.str_of("access_token").unwrap_or_default().to_string();
        let res = self.net.send_with_retry(|c| c.get(&self.ep.profile).bearer_auth(&token), 4).await?;
        if res.status().as_u16() == 404 {
            return Err(msg("To konto nie posiada Minecraft: Java Edition."));
        }
        let profile: Value = res.json().await.unwrap_or_else(|_| json!({}));
        let id = profile.str_of("id").filter(|i| i.len() == 32).ok_or_else(|| msg("Nie udało się pobrać profilu Minecraft"))?;
        let uuid = format!("{}-{}-{}-{}-{}", &id[..8], &id[8..12], &id[12..16], &id[16..20], &id[20..]);
        let expires = mc.get("expires_in").and_then(Value::as_i64).filter(|e| *e > 0).unwrap_or(86400);
        Ok(json!({
            "uuid": uuid,
            "name": profile.str_of("name"),
            "accessToken": token,
            "expiresAt": now_ms() + expires * 1000,
            "skin": profile.pointer("/skins/0/url").cloned().unwrap_or(Value::Null),
        }))
    }

    /// Microsoft refresh token → { accessToken, refreshToken } (the refresh token may rotate).
    pub async fn refresh_ms_token(&self, refresh_token: &str, client_id: Option<&str>) -> Result<(String, String)> {
        let cid = client_id.filter(|c| !c.is_empty()).ok_or_else(|| msg(NO_CLIENT_ID))?;
        let (_, j) =
            self.post_form(&self.ep.token, &[("grant_type", "refresh_token"), ("client_id", cid), ("refresh_token", refresh_token), ("scope", SCOPE)]).await?;
        match j.str_of("access_token") {
            Some(at) => Ok((at.to_string(), j.str_of("refresh_token").unwrap_or(refresh_token).to_string())),
            None => {
                let text = ms_error(&j, "Sesja Microsoft wygasła – zaloguj się ponownie.");
                // refresh token revoked or expired: the player has to log in again
                Err(if j.get("error").is_some() { Error::Auth(text) } else { msg(text) })
            }
        }
    }

    /// True when the Minecraft token still opens the profile (false on 401).
    pub async fn check_profile(&self, access_token: &str) -> Result<bool> {
        let res = self.net.send_with_retry(|c| c.get(&self.ep.profile).bearer_auth(access_token), 4).await?;
        match res.status().as_u16() {
            401 => Ok(false),
            404 => Err(Error::Auth("To konto nie posiada Minecraft: Java Edition.".into())),
            s => Ok((200..300).contains(&s)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{serve, Reply};

    #[test]
    fn offline_uuid_matches_java() {
        assert_eq!(offline_uuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f");
    }

    #[test]
    fn offline_nick_validation() {
        assert!(valid_offline_name("Steve_123"));
        assert!(!valid_offline_name("ab"));
        assert!(!valid_offline_name("zła nazwa"));
        assert!(create_offline("x").is_err());
        let a = create_offline("Gracz").unwrap();
        assert_eq!(a["id"], format!("offline-{}", offline_uuid("Gracz")));
        assert_eq!(a["accessToken"], "0");
    }

    #[test]
    fn microsoft_errors_in_polish() {
        assert_eq!(ms_error(&json!({ "error": "invalid_grant" }), "x"), "Sesja Microsoft wygasła – zaloguj się ponownie.");
        assert!(ms_error(&json!({ "error": "unauthorized_client" }), "x").contains("Allow public client flows"));
        assert_eq!(ms_error(&json!({ "error_description": "AADSTS50059: Coś poszło nie tak.\r\nTrace" }), "x"), "Coś poszło nie tak.");
        assert_eq!(ms_error(&json!({}), "fallback"), "fallback");
        assert_eq!(xerr_message(2148916233), Some("To konto Microsoft nie ma konta Xbox – utwórz je na xbox.com."));
    }

    fn auth_for(srv: &crate::testutil::Server) -> Auth {
        let mut a = Auth::new(Net::for_tests());
        a.ep = Endpoints {
            device: srv.url("/device"),
            token: srv.url("/token"),
            xbl: srv.url("/xbl"),
            xsts: srv.url("/xsts"),
            mc_login: srv.url("/mc"),
            profile: srv.url("/profile"),
        };
        a
    }

    #[tokio::test]
    async fn xbox_chain_to_minecraft_profile() {
        let srv = serve(vec![
            Reply::json(r#"{"Token":"xbl-token"}"#),
            Reply::json(r#"{"Token":"xsts-token","DisplayClaims":{"xui":[{"uhs":"1234"}]}}"#),
            Reply::json(r#"{"access_token":"mc-token","expires_in":86400}"#),
            Reply::json(r#"{"id":"0123456789abcdef0123456789abcdef","name":"Steve","skins":[{"url":"https://textures/skin"}]}"#),
        ])
        .await;
        let mc = auth_for(&srv).minecraft_from_ms("ms-token").await.unwrap();
        assert_eq!(mc["uuid"], "01234567-89ab-cdef-0123-456789abcdef");
        assert_eq!(mc["name"], "Steve");
        assert_eq!(mc["accessToken"], "mc-token");
        let seen = srv.seen();
        assert_eq!(seen[0].method, "POST");
        assert!(seen[0].body.contains(r#""RpsTicket":"d=ms-token""#));
        assert!(seen[2].body.contains("XBL3.0 x=1234;xsts-token"));
    }

    #[tokio::test]
    async fn xsts_errors_are_explained() {
        let srv = serve(vec![Reply::json(r#"{"Token":"t"}"#), Reply::json_status(401, r#"{"XErr":2148916238}"#)]).await;
        let e = auth_for(&srv).minecraft_from_ms("ms").await.unwrap_err();
        assert_eq!(e.to_string(), "Konto dziecka – musi zostać dodane do rodziny przez osobę dorosłą.");
    }

    #[tokio::test]
    async fn refresh_rotates_and_revoked_needs_login() {
        let srv = serve(vec![Reply::json(r#"{"access_token":"a2","refresh_token":"r2"}"#), Reply::json_status(400, r#"{"error":"invalid_grant"}"#)]).await;
        let a = auth_for(&srv);
        assert_eq!(a.refresh_ms_token("r1", Some("cid")).await.unwrap(), ("a2".into(), "r2".into()));
        assert!(srv.seen()[0].body.contains("grant_type=refresh_token"));
        let e = a.refresh_ms_token("r2", Some("cid")).await.unwrap_err();
        assert!(e.is_auth());
        assert!(a.refresh_ms_token("r", None).await.is_err());
    }

    #[tokio::test]
    async fn device_code_polls_until_confirmed() {
        let srv = serve(vec![Reply::json(r#"{"error":"authorization_pending"}"#), Reply::json(r#"{"access_token":"ms","refresh_token":"r"}"#)]).await;
        let a = auth_for(&srv);
        let cancel = CancellationToken::new();
        // interval 0 → the 5 s default; keep the test quick by pausing time
        tokio::time::pause();
        let j = a.poll_device_code("cid", "dc", 30, 0, &cancel).await.unwrap();
        assert_eq!(j["refresh_token"], "r");
    }
}
