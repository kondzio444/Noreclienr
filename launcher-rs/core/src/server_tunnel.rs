//! playit.gg tunnel (port of launcher/src/main/server-tunnel.js): the playit agent CLI forwards a
//! public address to the local server port. One agent secret per launcher, one tunnel per server.

use crate::error::{msg, Result};
use crate::Env;
use regex::Regex;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

pub const VERSION: &str = "0.15.26";

fn asset() -> Option<&'static str> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Some("playit-windows-x86_64-signed.exe")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("playit-linux-amd64")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("playit-linux-aarch64")
    } else {
        None
    }
}

pub fn supported() -> bool {
    asset().is_some()
}

fn bin_path(env: &Env) -> PathBuf {
    env.paths.root().join("tools").join(format!("playit-{VERSION}{}", if cfg!(windows) { ".exe" } else { "" }))
}

pub async fn ensure_binary(env: &Env) -> Result<PathBuf> {
    let a = asset().ok_or_else(|| msg("Tunel playit.gg nie ma wersji dla tego systemu – zainstaluj go ze strony playit.gg."))?;
    let bin = bin_path(env);
    if !bin.exists() {
        env.net.download(&format!("https://github.com/playit-cloud/playit-agent/releases/download/v{VERSION}/{a}"), &bin, None, None, &|_| {}).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755))?;
        }
    }
    Ok(bin)
}

pub fn clean(s: &str) -> String {
    static A: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]").unwrap());
    static B: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b[78]").unwrap());
    B.replace_all(&A.replace_all(s, ""), "").trim().to_string()
}

async fn cli(env: &Env, args: &[&str], secret: Option<&str>, timeout: Duration) -> Result<String> {
    let bin = ensure_binary(env).await?;
    let mut c = tokio::process::Command::new(bin);
    if let Some(s) = secret {
        c.args(["--secret", s]);
    }
    c.args(args).stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    let out = tokio::time::timeout(timeout, c.output()).await.map_err(|_| msg("playit: przekroczono czas oczekiwania"))??;
    let text = clean(&String::from_utf8_lossy(&out.stdout));
    if !out.status.success() {
        let err = clean(&String::from_utf8_lossy(&out.stderr));
        let m = if !err.is_empty() { err } else { text };
        return Err(msg(format!("playit: {}", m.trim_start_matches("Error:").trim())));
    }
    Ok(text)
}

/// Step 1: a claim code + URL the user opens to link the agent with their playit.gg account.
pub async fn claim_start(env: &Env) -> Result<(String, String)> {
    let code: String = cli(env, &["claim", "generate"], None, Duration::from_secs(30)).await?.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if code.is_empty() {
        return Err(msg("playit: nie udało się wygenerować kodu"));
    }
    let out = cli(env, &["claim", "url", &code, "--name", "Nore Launcher", "--type", "self-managed"], None, Duration::from_secs(30)).await?;
    static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"https://\S+").unwrap());
    let url = URL.find(&out).map(|m| m.as_str().to_string()).unwrap_or_else(|| format!("https://playit.gg/claim/{code}"));
    Ok((code, url))
}

/// Step 2: waits until the user accepts on playit.gg and returns the agent secret.
pub async fn claim_finish(env: &Env, code: &str) -> Result<String> {
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(msg("Nieprawidłowy kod"));
    }
    let out = cli(env, &["claim", "exchange", code, "--wait", "600"], None, Duration::from_secs(615)).await?;
    let secret = out.split_whitespace().last().unwrap_or("").to_string();
    if secret.len() < 32 {
        return Err(msg("playit: nie otrzymano klucza – zaakceptuj agenta na playit.gg"));
    }
    Ok(secret)
}

/// "[tunnel-id] [port-type] [port-count] [public-address]" lines.
pub fn parse_tunnels(out: &str) -> Vec<(String, String, u32, String)> {
    static ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[0-9a-f-]{20,}$").unwrap());
    out.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            (f.len() >= 4 && ID.is_match(f[0])).then(|| (f[0].to_string(), f[1].to_string(), f[2].parse().unwrap_or(0), f[3].to_string()))
        })
        .collect()
}

/// Creates (or reuses) the Minecraft Java tunnel named after the server: (id, address).
pub async fn ensure_tunnel(env: &Env, secret: &str, name: &str) -> Result<(String, String)> {
    static UUID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap());
    let out = cli(env, &["tunnels", "prepare", "tcp", "1", "--type", "minecraft-java", "--name", name], Some(secret), Duration::from_secs(60)).await?;
    let id = UUID.find(&out).map(|m| m.as_str().to_string());
    let list = parse_tunnels(&cli(env, &["tunnels", "list"], Some(secret), Duration::from_secs(30)).await?);
    let t = id.and_then(|id| list.iter().find(|x| x.0 == id).cloned()).or_else(|| list.iter().find(|x| x.1 == "tcp").cloned()).or_else(|| list.first().cloned());
    t.map(|t| (t.0, t.3)).ok_or_else(|| msg("playit: nie udało się utworzyć tunelu"))
}

/// Runs the agent forwarding the tunnel to the local server port.
pub async fn run(env: &Env, secret: &str, tunnel_id: &str, port: u16) -> Result<tokio::process::Child> {
    let bin = ensure_binary(env).await?;
    let mut c = tokio::process::Command::new(bin);
    c.args(["--secret", secret, "-s", "run", &format!("{tunnel_id}=127.0.0.1:{port}")]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    Ok(c.spawn()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_lines() {
        let out = "\x1b[1mtunnels\x1b[0m\n3f1c2a9e-0000-4000-8000-123456789abc tcp 1 abc.joinmc.link\nnoise";
        let l = parse_tunnels(&clean(out));
        assert_eq!(l, vec![("3f1c2a9e-0000-4000-8000-123456789abc".into(), "tcp".into(), 1, "abc.joinmc.link".into())]);
    }
}
