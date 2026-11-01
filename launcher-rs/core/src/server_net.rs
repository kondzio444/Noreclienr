//! Making a local server reachable from the internet (port of launcher/src/main/server-net.js):
//! public / LAN addresses, UPnP IGD port forwarding with NAT-PMP as a fallback, CGNAT detection,
//! the Windows firewall, a connection diagnosis and domains (DuckDNS, No-IP, Dynu, Cloudflare).

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::Env;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Value};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::LazyLock;
use std::time::Duration;
use tokio::net::UdpSocket;

static VIRTUAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|tailscale|zerotier|hamachi|radmin|wireguard|nordlynx|tun|tap|utun|loopback|bluetooth")
        .unwrap()
});

/// IPv4 addresses of the network cards (virtual adapters last).
pub fn lan_addresses() -> Vec<Value> {
    let mut out: Vec<Value> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match &i.addr {
            if_addrs::IfAddr::V4(a) if !a.ip.is_loopback() && !a.ip.is_link_local() => {
                Some(json!({ "name": i.name, "address": a.ip.to_string(), "netmask": a.netmask.to_string(), "virtual": VIRTUAL.is_match(&i.name) }))
            }
            _ => None,
        })
        .collect();
    out.sort_by_key(|a| a.truthy_of("virtual"));
    out
}

fn ip_to_int(ip: &str) -> Option<u32> {
    ip.parse::<Ipv4Addr>().ok().map(u32::from)
}

fn same_subnet(a: &str, b: &str, mask: &str) -> bool {
    match (ip_to_int(a), ip_to_int(b), ip_to_int(mask)) {
        (Some(a), Some(b), Some(m)) => a & m == b & m,
        _ => false,
    }
}

/// Private, shared (CGNAT 100.64/10) or otherwise not publicly routable IPv4.
pub fn is_private_ip(ip: &str) -> bool {
    let Ok(a) = ip.parse::<Ipv4Addr>() else { return false };
    let [x, y, ..] = a.octets();
    x == 10 || x == 127 || (x == 172 && (16..32).contains(&y)) || (x == 192 && y == 168) || (x == 100 && (64..128).contains(&y)) || (x == 169 && y == 254)
}

pub fn is_cgnat_ip(ip: &str) -> bool {
    ip.parse::<Ipv4Addr>().is_ok_and(|a| a.octets()[0] == 100 && (64..128).contains(&a.octets()[1]))
}

pub async fn public_ip(env: &Env) -> Result<String> {
    for url in ["https://api.ipify.org?format=json", "https://api4.my-ip.io/v2/ip.json", "https://ipv4.icanhazip.com"] {
        let Ok(res) = env.net.send_with_retry(|c| c.get(url), 2).await else { continue };
        let Ok(text) = res.text().await else { continue };
        let t = text.trim();
        let ip = if t.starts_with('{') {
            serde_json::from_str::<Value>(t).ok().and_then(|j| j.str_of("ip").map(String::from)).unwrap_or_default()
        } else {
            t.to_string()
        };
        if ip.parse::<Ipv4Addr>().is_ok() {
            return Ok(ip);
        }
    }
    Err(msg("Nie udało się ustalić publicznego IP (brak internetu?)"))
}

async fn run(cmd: &str, args: &[&str]) -> String {
    let mut c = tokio::process::Command::new(cmd);
    c.args(args).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    match tokio::time::timeout(Duration::from_secs(6), c.output()).await {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => String::new(),
    }
}

/// IPv4 of the default gateway (the router).
pub async fn default_gateway() -> Option<String> {
    if cfg!(target_os = "linux") {
        if let Ok(t) = std::fs::read_to_string("/proc/net/route") {
            for l in t.lines().skip(1) {
                let f: Vec<&str> = l.split_whitespace().collect();
                if f.len() > 2 && f[1] == "00000000" && f[2] != "00000000" && f[2].len() == 8 {
                    let h = f[2];
                    let b: Vec<String> = [6, 4, 2, 0].iter().map(|i| u8::from_str_radix(&h[*i..i + 2], 16).unwrap_or(0).to_string()).collect();
                    return Some(b.join("."));
                }
            }
        }
    } else if cfg!(windows) {
        static R: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"(?m)^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)").unwrap());
        let out = run("route", &["print", "-4", "0.0.0.0"]).await;
        let mut rows: Vec<(String, u32)> =
            R.captures_iter(&out).filter(|c| !VIRTUAL.is_match(&c[2])).map(|c| (c[1].to_string(), c[3].parse().unwrap_or(9999))).collect();
        rows.sort_by_key(|r| r.1);
        if let Some(r) = rows.first() {
            return Some(r.0.clone());
        }
    } else {
        static R: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"gateway:\s*(\d+\.\d+\.\d+\.\d+)").unwrap());
        if let Some(c) = R.captures(&run("route", &["-n", "get", "default"]).await) {
            return Some(c[1].to_string());
        }
    }
    let lan = lan_addresses();
    lan.iter().find(|a| !a.truthy_of("virtual")).map(|a| {
        let ip = a.string_or("address", "");
        format!("{}.1", ip.split('.').take(3).collect::<Vec<_>>().join("."))
    })
}

/// The LAN address in the router's subnet (port forwarding points to it).
pub fn local_address_for(gateway: &str) -> String {
    let lan = lan_addresses();
    let prefix = |ip: &str| ip.split('.').take(3).collect::<Vec<_>>().join(".");
    lan.iter()
        .find(|a| same_subnet(a.str_of("address").unwrap_or(""), gateway, a.str_of("netmask").unwrap_or("")))
        .or_else(|| lan.iter().find(|a| prefix(a.str_of("address").unwrap_or("")) == prefix(gateway)))
        .or_else(|| lan.iter().find(|a| !a.truthy_of("virtual")))
        .or(lan.first())
        .map(|a| a.string_or("address", ""))
        .unwrap_or_default()
}

/// Asks mcsrvstat.us whether the server answers from the internet.
pub async fn check_reachable(env: &Env, host: &str, port: u16) -> Result<Value> {
    let target = if port != 0 && port != 25565 { format!("{host}:{port}") } else { host.to_string() };
    let j: Value = env.net.get_json(&format!("https://api.mcsrvstat.us/3/{}", urlencoding::encode(&target))).await?;
    Ok(json!({
        "online": j.truthy_of("online"), "ip": j["ip"], "port": j["port"],
        "players": if j["players"].is_object() { json!({ "online": j["players"]["online"], "max": j["players"]["max"] }) } else { Value::Null },
        "version": j.get("version").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
        "motd": j.pointer("/motd/clean").and_then(Value::as_array).map(|l| json!(l.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n"))).unwrap_or(Value::Null),
        "srv": j.pointer("/debug/srv").is_some_and(crate::js::truthy), "cached": j.pointer("/debug/cachehit").is_some_and(crate::js::truthy),
    }))
}

/// True when something accepts TCP connections on host:port.
pub async fn port_open(host: &str, port: u16) -> bool {
    matches!(tokio::time::timeout(Duration::from_millis(2500), tokio::net::TcpStream::connect((host, port))).await, Ok(Ok(_)))
}

// ------------------------------------------------------------------ UPnP

fn lan_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(6))
        .user_agent("NoreLauncher UPnP/1.1")
        .pool_max_idle_per_host(0)
        .build()
        .unwrap_or_default()
}

/// One HTTP request to a router (fresh connection, retried on hang-ups).
async fn http(url: &str, body: Option<(String, String)>) -> Result<(u16, String)> {
    let c = lan_client();
    let mut last = None;
    for i in 0..3 {
        let mut r = match &body {
            Some((b, action)) => c.post(url).header("Content-Type", "text/xml; charset=\"utf-8\"").header("SOAPAction", action.as_str()).body(b.clone()),
            None => c.get(url),
        };
        r = r.header("Connection", "close");
        match r.send().await {
            Ok(res) => {
                let s = res.status().as_u16();
                return Ok((s, res.text().await.unwrap_or_default()));
            }
            Err(e) => last = Some(e),
        }
        tokio::time::sleep(Duration::from_millis(350 * (i + 1))).await;
    }
    Err(last.map(Into::into).unwrap_or_else(|| msg("timeout")))
}

const SEARCH_TARGETS: [&str; 5] = [
    "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
    "urn:schemas-upnp-org:service:WANIPConnection:1",
    "urn:schemas-upnp-org:service:WANIPConnection:2",
    "urn:schemas-upnp-org:service:WANPPPConnection:1",
];
const WAN_TYPES: [&str; 3] =
    ["urn:schemas-upnp-org:service:WANIPConnection:2", "urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1"];

/// SSDP discovery from every LAN interface: (location, responder).
async fn discover_gateways(timeout: Duration) -> Vec<String> {
    static LOC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?im)^location:\s*(\S+)").unwrap());
    let mut binds: Vec<Ipv4Addr> = vec![Ipv4Addr::UNSPECIFIED];
    binds.extend(lan_addresses().iter().filter_map(|a| a.str_of("address").and_then(|s| s.parse::<Ipv4Addr>().ok())));
    let found = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let mut tasks = Vec::new();
    for addr in binds {
        let found = found.clone();
        tasks.push(tokio::spawn(async move {
            let Ok(sock) = UdpSocket::bind(SocketAddr::from((addr, 0))).await else { return };
            for st in SEARCH_TARGETS {
                let m = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n");
                let _ = sock.send_to(m.as_bytes(), "239.255.255.250:1900").await;
            }
            let mut buf = [0u8; 2048];
            let end = tokio::time::Instant::now() + timeout;
            while let Ok(Ok((n, _))) = tokio::time::timeout_at(end, sock.recv_from(&mut buf)).await {
                if let Some(c) = LOC.captures(&String::from_utf8_lossy(&buf[..n])) {
                    let mut f = found.lock().unwrap_or_else(|e| e.into_inner());
                    if !f.contains(&c[1].to_string()) {
                        f.push(c[1].to_string());
                    }
                }
            }
        }));
    }
    for t in tasks {
        let _ = t.await;
    }
    let v = found.lock().unwrap_or_else(|e| e.into_inner()).clone();
    v
}

#[derive(Clone, Debug)]
struct Service {
    url: String,
    ty: String,
    host: String,
}

fn tag(xml: &str, name: &str) -> Option<String> {
    Regex::new(&format!(r"(?i)<{name}>([^<]*)<")).ok()?.captures(xml).map(|c| c[1].to_string())
}

async fn gateway_services() -> (Option<String>, Vec<Service>) {
    static SVC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<service>").unwrap());
    let (gateway, mut found) = tokio::join!(default_gateway(), discover_gateways(Duration::from_secs(3)));
    let host_of = |u: &str| reqwest::Url::parse(u).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
    found.sort_by_key(|l| Some(host_of(l)) != gateway);
    let mut services = Vec::new();
    for location in found {
        let Ok((_, body)) = http(&location, None).await else { continue };
        let base = tag(&body, "URLBase").map(|s| s.trim().to_string()).unwrap_or_else(|| location.clone());
        for block in SVC.split(&body).skip(1) {
            let (Some(ty), Some(ctl)) = (tag(block, "serviceType"), tag(block, "controlURL")) else { continue };
            let ty = ty.trim().to_string();
            if !WAN_TYPES.contains(&ty.as_str()) {
                continue;
            }
            let Some(url) = reqwest::Url::parse(&base).ok().and_then(|b| b.join(ctl.trim()).ok()) else { continue };
            services.push(Service { url: url.to_string(), ty, host: host_of(&location) });
        }
    }
    services.sort_by_key(|s| WAN_TYPES.iter().position(|t| *t == s.ty));
    (gateway, services)
}

fn upnp_error(code: u32) -> Option<&'static str> {
    Some(match code {
        402 => "router odrzucił parametry",
        501 => "router nie wykonał polecenia (UPnP może być w trybie tylko do odczytu)",
        606 => "router nie pozwala programom zmieniać przekierowań – włącz „Zezwalaj na zmiany” / „UPnP: pełny dostęp”",
        714 => "brak takiego przekierowania",
        715 | 716 => "router nie obsługuje symboli wieloznacznych",
        718 => "port jest już przekierowany na inne urządzenie",
        724 => "router wymaga tego samego portu wewnętrznego i zewnętrznego",
        725 => "router obsługuje tylko stałe przekierowania",
        726 => "router nie obsługuje dowolnego zdalnego hosta",
        727 => "router nie obsługuje dowolnego portu zewnętrznego",
        728 => "tablica przekierowań w routerze jest pełna",
        _ => return None,
    })
}

struct SoapError {
    code: u32,
    text: String,
}

async fn soap(svc: &Service, action: &str, args: &[(&str, String)]) -> std::result::Result<String, SoapError> {
    let params: String = args.iter().map(|(k, v)| format!("<{k}>{v}</{k}>")).collect();
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{}\">{params}</u:{action}></s:Body></s:Envelope>\r\n",
        svc.ty
    );
    match http(&svc.url, Some((body, format!("\"{}#{action}\"", svc.ty)))).await {
        Ok((200, b)) => Ok(b),
        Ok((status, b)) => {
            let code = tag(&b, "errorCode").and_then(|c| c.trim().parse().ok()).unwrap_or(0);
            let desc = tag(&b, "errorDescription").unwrap_or_else(|| format!("HTTP {status}"));
            let text = upnp_error(code).map(String::from).unwrap_or(desc);
            Err(SoapError { code, text: format!("UPnP {action}: {text}{}", if code > 0 { format!(" (kod {code})") } else { String::new() }) })
        }
        Err(e) => Err(SoapError { code: 0, text: format!("UPnP {action}: {e}") }),
    }
}

async fn add_mapping(svc: &Service, port: u16, proto: &str, client: &str, desc: &str) -> std::result::Result<(), SoapError> {
    let args = |lease: u32| {
        vec![
            ("NewRemoteHost", String::new()),
            ("NewExternalPort", port.to_string()),
            ("NewProtocol", proto.to_string()),
            ("NewInternalPort", port.to_string()),
            ("NewInternalClient", client.to_string()),
            ("NewEnabled", "1".to_string()),
            ("NewPortMappingDescription", desc.to_string()),
            ("NewLeaseDuration", lease.to_string()),
        ]
    };
    match soap(svc, "AddPortMapping", &args(0)).await {
        Ok(_) => Ok(()),
        Err(e) if e.code == 718 => {
            let _ =
                soap(svc, "DeletePortMapping", &[("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", proto.to_string())])
                    .await;
            soap(svc, "AddPortMapping", &args(0)).await.map(|_| ())
        }
        Err(e) if e.code == 725 => Err(e),
        Err(_) => soap(svc, "AddPortMapping", &args(604800)).await.map(|_| ()),
    }
}

/// Opens the port on the router (UPnP, then NAT-PMP).
pub async fn upnp_open(port: u16, desc: &str) -> Result<Value> {
    let (gateway, services) = gateway_services().await;
    let mut errors: Vec<String> = Vec::new();
    for svc in &services {
        let client = local_address_for(&svc.host);
        match add_mapping(svc, port, "TCP", &client, desc).await {
            Ok(()) => {
                let _ = add_mapping(svc, port, "UDP", &client, desc).await;
                let external = soap(svc, "GetExternalIPAddress", &[]).await.ok().and_then(|b| tag(&b, "NewExternalIPAddress")).filter(|s| !s.is_empty());
                let verified = soap(
                    svc,
                    "GetSpecificPortMappingEntry",
                    &[("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", "TCP".into())],
                )
                .await
                .ok()
                .map(|e| tag(&e, "NewInternalClient").as_deref() == Some(client.as_str()));
                let cgnat = external.as_deref().is_some_and(is_private_ip);
                return Ok(json!({ "method": "upnp", "router": svc.host, "client": client, "external": external, "verified": verified, "cgnat": cgnat }));
            }
            Err(e) => errors.push(e.text),
        }
    }
    if let Some(g) = &gateway {
        match natpmp_map(g, port, 7200).await {
            Ok((external, lifetime)) => {
                let cgnat = external.as_deref().is_some_and(is_private_ip);
                return Ok(
                    json!({ "method": "natpmp", "router": g, "client": local_address_for(g), "external": external, "lifetime": lifetime, "verified": true, "cgnat": cgnat }),
                );
            }
            Err(e) => errors.push(format!("NAT-PMP: {e}")),
        }
    }
    if services.is_empty() {
        let g = gateway.map(|g| format!(" ({g})")).unwrap_or_default();
        return Err(msg(format!(
            "Router{g} nie odpowiada na UPnP ani NAT-PMP. Włącz UPnP w panelu routera albo przekieruj port {port} ręcznie – lub użyj tunelu playit.gg."
        )));
    }
    Err(msg(errors.into_iter().next().unwrap_or_else(|| "Nie udało się otworzyć portu.".into())))
}

pub async fn upnp_close(port: u16) -> Result<bool> {
    let (gateway, services) = gateway_services().await;
    for svc in &services {
        for proto in ["TCP", "UDP"] {
            let _ =
                soap(svc, "DeletePortMapping", &[("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", proto.into())]).await;
        }
    }
    if let Some(g) = gateway {
        let _ = natpmp_map(&g, port, 0).await;
    }
    Ok(true)
}

async fn router_info(port: u16) -> Value {
    let (gateway, services) = gateway_services().await;
    let mut out = json!({ "gateway": gateway, "upnp": !services.is_empty(), "natpmp": false, "external": null, "mapping": null });
    for svc in &services {
        if out["external"].is_null() {
            if let Some(e) = soap(svc, "GetExternalIPAddress", &[]).await.ok().and_then(|b| tag(&b, "NewExternalIPAddress")).filter(|s| !s.is_empty()) {
                out["external"] = json!(e);
            }
        }
        if let Ok(e) =
            soap(svc, "GetSpecificPortMappingEntry", &[("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", "TCP".into())])
                .await
        {
            out["mapping"] =
                json!({ "client": tag(&e, "NewInternalClient"), "port": tag(&e, "NewInternalPort"), "enabled": tag(&e, "NewEnabled").as_deref() != Some("0") });
        }
        if !out["external"].is_null() {
            break;
        }
    }
    if services.is_empty() {
        if let Some(g) = &gateway {
            if let Ok(e) = natpmp_external(g).await {
                out["external"] = json!(e);
                out["natpmp"] = json!(true);
            }
        }
    }
    out
}

// ------------------------------------------------------------------ NAT-PMP (RFC 6886)

async fn natpmp_request(gateway: &str, msg_bytes: &[u8], expect_op: u8) -> Result<Vec<u8>> {
    let sock = UdpSocket::bind("0.0.0.0:0").await?;
    let target: SocketAddr = format!("{gateway}:5351").parse().map_err(|_| msg("Nieprawidłowy adres routera"))?;
    let mut buf = [0u8; 64];
    for tries in 1..=4u32 {
        sock.send_to(msg_bytes, target).await?;
        let wait = Duration::from_millis(250 * 2u64.pow(tries));
        let end = tokio::time::Instant::now() + wait;
        while let Ok(Ok((n, _))) = tokio::time::timeout_at(end, sock.recv_from(&mut buf)).await {
            if n < 8 || buf[1] != expect_op {
                continue;
            }
            let result = u16::from_be_bytes([buf[2], buf[3]]);
            if result != 0 {
                let t = ["", "nieobsługiwana wersja", "brak uprawnień", "błąd sieci", "brak zasobów", "nieobsługiwana operacja"]
                    .get(result as usize)
                    .copied()
                    .map(String::from)
                    .unwrap_or_else(|| format!("kod {result}"));
                return Err(msg(t));
            }
            return Ok(buf[..n].to_vec());
        }
    }
    Err(msg("router nie odpowiada"))
}

async fn natpmp_external(gateway: &str) -> Result<String> {
    let m = natpmp_request(gateway, &[0, 0], 128).await?;
    if m.len() < 12 {
        return Err(msg("router nie odpowiada"));
    }
    Ok(format!("{}.{}.{}.{}", m[8], m[9], m[10], m[11]))
}

/// Maps TCP + UDP port → port for `lifetime` seconds (0 removes it): (external IP, granted lifetime).
async fn natpmp_map(gateway: &str, port: u16, lifetime: u32) -> Result<(Option<String>, u32)> {
    let mut granted = lifetime;
    for op in [2u8, 1u8] {
        let mut m = [0u8; 12];
        m[1] = op;
        m[4..6].copy_from_slice(&port.to_be_bytes());
        m[6..8].copy_from_slice(&(if lifetime > 0 { port } else { 0 }).to_be_bytes());
        m[8..12].copy_from_slice(&lifetime.to_be_bytes());
        let r = natpmp_request(gateway, &m, 128 + op).await?;
        if op == 2 && r.len() >= 16 {
            granted = u32::from_be_bytes([r[12], r[13], r[14], r[15]]);
        }
    }
    let external = if lifetime > 0 { natpmp_external(gateway).await.ok() } else { None };
    Ok((external, granted))
}

// ------------------------------------------------------------------ Windows firewall

fn rule_name(port: u16) -> String {
    format!("Nore Server {port}")
}

pub async fn firewall_status(port: u16) -> Value {
    if !cfg!(windows) {
        return json!({ "supported": false });
    }
    let out = run("netsh", &["advfirewall", "firewall", "show", "rule", &format!("name={}", rule_name(port))]).await;
    json!({ "supported": true, "rule": out.contains(&rule_name(port)) })
}

/// Adds inbound TCP + UDP rules for the port (asks for administrator rights once).
pub async fn firewall_allow(port: u16) -> Result<bool> {
    if !cfg!(windows) {
        return Err(msg("Zapora jest ustawiana tylko na Windows."));
    }
    let script = std::env::temp_dir().join(format!("nore-firewall-{port}.cmd"));
    let name = rule_name(port);
    std::fs::write(
        &script,
        [
            "@echo off".to_string(),
            format!("netsh advfirewall firewall delete rule name=\"{name}\" >nul 2>&1"),
            format!("netsh advfirewall firewall add rule name=\"{name}\" dir=in action=allow protocol=TCP localport={port} profile=any"),
            format!("netsh advfirewall firewall add rule name=\"{name}\" dir=in action=allow protocol=UDP localport={port} profile=any"),
        ]
        .join("\r\n"),
    )?;
    let ps = format!(
        "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c \"\"{}\"\"' -Verb RunAs -WindowStyle Hidden -Wait",
        script.display().to_string().replace('\'', "''")
    );
    let mut c = tokio::process::Command::new("powershell.exe");
    c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps]);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    let ok = matches!(tokio::time::timeout(Duration::from_secs(120), c.status()).await, Ok(Ok(s)) if s.success());
    let _ = std::fs::remove_file(&script);
    if !ok {
        return Err(msg("Nie dodano reguły – potrzebna zgoda administratora."));
    }
    if !firewall_status(port).await.truthy_of("rule") {
        return Err(msg("Reguła zapory nie została dodana (odmówiono uprawnień?)."));
    }
    Ok(true)
}

// ------------------------------------------------------------------ domains

/// Resolves through public resolvers so a stale local cache does not hide a fresh record.
pub async fn dns_check(host: &str, port: u16) -> Value {
    use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
    let mut opts = ResolverOpts::default();
    opts.timeout = Duration::from_secs(4);
    opts.attempts = 2;
    let cfg =
        ResolverConfig::from_parts(None, vec![], NameServerConfigGroup::from_ips_clear(&["1.1.1.1".parse().unwrap(), "8.8.8.8".parse().unwrap()], 53, true));
    let r = hickory_resolver::TokioAsyncResolver::tokio(cfg, opts);
    let mut out = json!({ "host": host, "a": [], "srv": null });
    match r.ipv4_lookup(format!("{host}.")).await {
        Ok(l) => out["a"] = json!(l.iter().map(|a| a.to_string()).collect::<Vec<_>>()),
        Err(e) => {
            out["error"] = json!(if matches!(e.kind(), hickory_resolver::error::ResolveErrorKind::NoRecordsFound { .. }) {
                "brak rekordu A".to_string()
            } else {
                e.to_string()
            });
        }
    }
    if let Ok(srv) = r.srv_lookup(format!("_minecraft._tcp.{host}.")).await {
        if let Some(s) = srv.iter().next() {
            out["srv"] = json!({ "target": s.target().to_utf8().trim_end_matches('.'), "port": s.port() });
        }
    }
    if out["srv"].is_object() && port != 0 && out["srv"]["port"].as_u64() != Some(port as u64) {
        out["srvWrongPort"] = json!(true);
    }
    out
}

async fn duckdns_update(env: &Env, sub: &str, token: &str, ip: &str) -> Result<String> {
    let name = sub.trim().trim_end_matches(".duckdns.org").trim().to_string();
    let url = format!(
        "https://www.duckdns.org/update?domains={}&token={}&ip={}&verbose=true",
        urlencoding::encode(&name),
        urlencoding::encode(token),
        urlencoding::encode(ip)
    );
    let text = env.net.send_with_retry(|c| c.get(&url), 2).await?.text().await?;
    if !text.trim().starts_with("OK") {
        return Err(msg("DuckDNS odrzucił aktualizację – sprawdź subdomenę (bez .duckdns.org) i token."));
    }
    Ok(format!("{name}.duckdns.org"))
}

async fn dyndns_update(env: &Env, provider: &str, hostname: &str, user: &str, password: &str, ip: &str) -> Result<String> {
    let (base, label) = if provider == "noip" { ("https://dynupdate.no-ip.com/nic/update", "No-IP") } else { ("https://api.dynu.com/nic/update", "Dynu") };
    let url = format!("{base}?hostname={}&myip={}", urlencoding::encode(hostname), urlencoding::encode(ip));
    let auth = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}")));
    let res = env.net.send_with_retry(|c| c.get(&url).header("Authorization", auth.as_str()), 2).await?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    let code = text.split_whitespace().next().unwrap_or("");
    if code == "good" || code == "nochg" {
        return Ok(hostname.into());
    }
    let why = match code {
        "badauth" => "zły login lub hasło".to_string(),
        "nohost" => "nie ma takiej nazwy hosta na koncie".into(),
        "notfqdn" => "podaj pełną nazwę hosta".into(),
        "abuse" => "konto zablokowane za nadużycia".into(),
        "!donator" => "funkcja wymaga płatnego konta".into(),
        "badagent" => "odrzucono klienta".into(),
        "911" => "awaria po stronie dostawcy – spróbuj później".into(),
        _ if !text.trim().is_empty() => text.trim().to_string(),
        _ => format!("HTTP {status}"),
    };
    Err(msg(format!("{label}: {why}")))
}

async fn cloudflare_update(env: &Env, token: &str, hostname: &str, ip: &str, port: u16) -> Result<String> {
    let api = "https://api.cloudflare.com/client/v4";
    let call = |method: &'static str, url: String, body: Option<Value>| {
        let auth = format!("Bearer {token}");
        async move {
            let res = env
                .net
                .send_with_retry(
                    |c| {
                        let r = match method {
                            "PUT" => c.put(&url),
                            "POST" => c.post(&url),
                            _ => c.get(&url),
                        };
                        let r = r.header("Authorization", auth.as_str()).header("Content-Type", "application/json");
                        match &body {
                            Some(b) => r.body(b.to_string()),
                            None => r,
                        }
                    },
                    2,
                )
                .await?;
            let j: Value = res.json().await?;
            if !j.truthy_of("success") {
                return Err(msg(format!("Cloudflare: {}", j.pointer("/errors/0/message").and_then(Value::as_str).unwrap_or("błąd API"))));
            }
            Ok(j["result"].clone())
        }
    };
    let host = hostname.to_lowercase().trim_end_matches('.').to_string();
    let parts: Vec<&str> = host.split('.').collect();
    let mut zone = None;
    for i in 0..parts.len().saturating_sub(1) {
        let name = parts[i..].join(".");
        let zones = call("GET", format!("{api}/zones?name={}", urlencoding::encode(&name)), None).await?;
        if let Some(z) = zones.get(0) {
            zone = Some(z.clone());
            break;
        }
    }
    let zone = zone.ok_or_else(|| msg(format!("Domena {host} nie jest w Twoim koncie Cloudflare (albo token nie ma dostępu Zone:Read).")))?;
    let zid = zone.string_or("id", "");
    let cname = call("GET", format!("{api}/zones/{zid}/dns_records?type=CNAME&name={}", urlencoding::encode(&host)), None).await?;
    if cname.as_array().is_some_and(|a| !a.is_empty()) {
        return Err(msg(format!("Cloudflare: {host} ma już rekord CNAME – usuń go albo wybierz inną nazwę.")));
    }
    let upsert = |ty: &'static str, name: String, record: Value| {
        let zid = zid.clone();
        async move {
            let existing = call("GET", format!("{api}/zones/{zid}/dns_records?type={ty}&name={}", urlencoding::encode(&name)), None).await?;
            let mut body = json!({ "type": ty, "name": name, "ttl": 120 });
            crate::js::assign(&mut body, &record);
            match existing.get(0) {
                Some(e) => call("PUT", format!("{api}/zones/{zid}/dns_records/{}", e.string_or("id", "")), Some(body)).await,
                None => call("POST", format!("{api}/zones/{zid}/dns_records"), Some(body)).await,
            }
        }
    };
    upsert("A", host.clone(), json!({ "content": ip, "proxied": false })).await?;
    if port != 0 && port != 25565 {
        upsert("SRV", format!("_minecraft._tcp.{host}"), json!({ "data": { "priority": 0, "weight": 5, "port": port, "target": host } })).await?;
    }
    Ok(host)
}

/// Points the server's domain at ip with the chosen provider; returns the hostname.
pub async fn update_domain(env: &Env, domain: &Value, secret: &str, ip: &str, port: u16) -> Result<String> {
    let name = domain.string_or("name", "");
    match domain.str_of("provider").unwrap_or("") {
        "duckdns" => duckdns_update(env, &name, secret, ip).await,
        p @ ("noip" | "dynu") => dyndns_update(env, p, &name, domain.str_of("user").unwrap_or(""), secret, ip).await,
        "cloudflare" => cloudflare_update(env, secret, &name, ip, port).await,
        _ => Ok(name),
    }
}

/// DNS records to add by hand at any other provider.
pub fn manual_records(hostname: &str, ip: Option<&str>, port: u16) -> Value {
    let host = if hostname.is_empty() { "mc.twojadomena.pl" } else { hostname }.trim_end_matches('.').to_string();
    let mut records =
        vec![json!({ "type": "A", "name": host, "value": ip.unwrap_or("<twoje publiczne IP>"), "note": "Adres serwera (bez proxy / „DNS only”)" })];
    if port != 0 && port != 25565 {
        records.push(json!({ "type": "SRV", "name": format!("_minecraft._tcp.{host}"), "value": format!("0 5 {port} {host}"), "note": "Pozwala łączyć się bez wpisywania portu" }));
    }
    Value::Array(records)
}

/// Step-by-step connection check (each step: `{ id, status: ok|warn|bad|skip, title, text, fix }`).
pub async fn diagnose(env: &Env, port: u16, running: bool, domain: &Value, tunnel: &Value) -> Value {
    let mut steps: Vec<Value> = Vec::new();
    let mut add = |id: &str, status: &str, title: String, text: String, fix: Option<&str>| {
        steps.push(json!({ "id": id, "status": status, "title": title, "text": text, "fix": fix }))
    };
    let lan = lan_addresses();
    let real: Vec<String> = lan.iter().filter(|a| !a.truthy_of("virtual")).map(|a| a.string_or("address", "")).collect();
    add(
        "lan",
        if real.is_empty() { "bad" } else { "ok" },
        "Sieć lokalna".into(),
        if real.is_empty() { "Brak połączenia z siecią lokalną.".into() } else { format!("IP w sieci domowej: {}", real.join(", ")) },
        None,
    );
    if running {
        let l = port_open("127.0.0.1", port).await;
        add(
            "local",
            if l { "ok" } else { "bad" },
            "Serwer na tym komputerze".into(),
            if l { format!("Serwer nasłuchuje na porcie {port}.") } else { format!("Nic nie odpowiada na porcie {port} – sprawdź konsolę serwera.") },
            None,
        );
    } else {
        add(
            "local",
            "warn",
            "Serwer na tym komputerze".into(),
            "Serwer jest wyłączony – uruchom go, aby sprawdzić połączenie z internetu.".into(),
            Some("start"),
        );
    }
    let (pubip, router) = tokio::join!(public_ip(env), router_info(port));
    let pubip = pubip.ok();
    add(
        "public",
        if pubip.is_some() { "ok" } else { "bad" },
        "Publiczne IP".into(),
        pubip.as_ref().map(|p| format!("Twoje IP w internecie: {p}")).unwrap_or_else(|| "Brak połączenia z internetem.".into()),
        None,
    );
    let ext = router.str_of("external").map(String::from);
    let gw = router.str_of("gateway").unwrap_or("?").to_string();
    let cgnat = ext.as_deref().is_some_and(is_private_ip) || pubip.as_deref().is_some_and(is_cgnat_ip);
    if router.truthy_of("upnp") || router.truthy_of("natpmp") {
        add(
            "router",
            "ok",
            "Router".into(),
            format!(
                "Brama {gw} obsługuje {}{}.",
                if router.truthy_of("upnp") { "UPnP" } else { "NAT-PMP" },
                ext.as_ref().map(|e| format!(" • IP routera w internecie: {e}")).unwrap_or_default()
            ),
            None,
        );
    } else {
        add(
            "router",
            "warn",
            "Router".into(),
            format!("Brama {gw} nie odpowiada na UPnP ani NAT-PMP – włącz UPnP w panelu routera albo przekieruj port ręcznie."),
            Some("manual"),
        );
    }
    if cgnat {
        add("cgnat", "bad", "CGNAT / podwójny NAT".into(), format!("Router dostaje adres {}, który nie jest publiczny – dostawca internetu dzieli jedno IP między klientów, więc przekierowanie portu nie zadziała. Użyj tunelu playit.gg albo poproś operatora o publiczne IP.", ext.clone().or(pubip.clone()).unwrap_or_default()), Some("tunnel"));
    } else if let (Some(e), Some(p)) = (&ext, &pubip) {
        if e != p {
            add("cgnat", "warn", "Podwójny NAT".into(), format!("Router widzi IP {e}, a internet {p} – przed routerem jest drugi router (np. modem operatora). Przekieruj port także na nim albo ustaw go w trybie bridge."), Some("tunnel"));
        }
    }
    let lan_ip = match router.str_of("gateway") {
        Some(g) => local_address_for(g),
        None => real.first().cloned().unwrap_or_default(),
    };
    if router["mapping"].is_object() {
        let m = &router["mapping"];
        let ok = m.str_of("client") == Some(&lan_ip) && m.truthy_of("enabled");
        add(
            "mapping",
            if ok { "ok" } else { "warn" },
            format!("Przekierowanie portu {port}"),
            if ok {
                format!("Router przekierowuje port {port} na ten komputer ({lan_ip}).")
            } else {
                format!("Port {port} jest przekierowany na {}, a ten komputer ma {lan_ip}.", m.str_of("client").unwrap_or("?"))
            },
            if ok { None } else { Some("upnp") },
        );
    } else if router.truthy_of("upnp") {
        add(
            "mapping",
            "warn",
            format!("Przekierowanie portu {port}"),
            "Router nie ma przekierowania tego portu (albo nie pokazuje go przez UPnP).".into(),
            Some("upnp"),
        );
    }
    if cfg!(windows) {
        let fw = firewall_status(port).await;
        if fw.truthy_of("supported") {
            let rule = fw.truthy_of("rule");
            add(
                "firewall",
                if rule { "ok" } else { "warn" },
                "Zapora Windows".into(),
                if rule {
                    format!("Reguła „{}” przepuszcza połączenia.", rule_name(port))
                } else {
                    "Brak reguły dla portu serwera – Windows może blokować połączenia z zewnątrz.".into()
                },
                if rule { None } else { Some("firewall") },
            );
        }
    }
    if let Some(name) = domain.str_of("name").filter(|n| !n.is_empty() && domain.str_of("provider").is_some_and(|p| !p.is_empty() && p != "none")) {
        let d = dns_check(name, port).await;
        let a: Vec<String> = d["a"].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect();
        if a.is_empty() {
            add(
                "dns",
                "bad",
                format!("Domena {name}"),
                format!("DNS: {} – kliknij „Zapisz i zastosuj” w sekcji domeny.", d.str_of("error").unwrap_or("brak rekordu A")),
                Some("domain"),
            );
        } else if pubip.as_ref().is_some_and(|p| !a.contains(p))
            && !(domain.str_of("provider") == Some("nore") && tunnel.str_of("address").is_some_and(|s| !s.is_empty()))
        {
            add(
                "dns",
                "warn",
                format!("Domena {name}"),
                format!(
                    "Wskazuje na {}, a Twoje IP to {} – zaktualizuj domenę (zmiana DNS może potrwać kilka minut).",
                    a.join(", "),
                    pubip.clone().unwrap_or_default()
                ),
                Some("domain"),
            );
        } else {
            add(
                "dns",
                "ok",
                format!("Domena {name}"),
                format!("Wskazuje na {}{}.", a.join(", "), d["srv"]["port"].as_u64().map(|p| format!(" • SRV → port {p}")).unwrap_or_default()),
                None,
            );
        }
    }
    if let Some(addr) = tunnel.str_of("address").filter(|s| !s.is_empty()) {
        add("tunnel", "ok", "Tunel playit.gg".into(), format!("Znajomi mogą łączyć się przez {addr}."), None);
    }
    if let (true, Some(p)) = (running, &pubip) {
        let r = check_reachable(env, p, port).await.ok();
        if r.as_ref().is_some_and(|r| r.truthy_of("online")) {
            let v = r.as_ref().and_then(|r| r.str_of("version").map(|v| format!(" ({v})"))).unwrap_or_default();
            add("internet", "ok", "Test z internetu".into(), format!("Serwer odpowiada pod {p}:{port}{v}. Znajomi mogą dołączyć!"), None);
        } else {
            let has_tunnel = tunnel.str_of("address").is_some_and(|s| !s.is_empty());
            add(
                "internet",
                if cgnat && has_tunnel { "warn" } else { "bad" },
                "Test z internetu".into(),
                format!(
                    "Serwer nie odpowiada pod {p}:{port}{}. Wynik może pochodzić z pamięci podręcznej (do 5 min).",
                    if cgnat { " (CGNAT – użyj tunelu)" } else { " – sprawdź kroki powyżej" }
                ),
                Some(if cgnat { "tunnel" } else { "upnp" }),
            );
        }
    }
    json!({ "steps": steps, "publicIp": pubip, "lanIp": lan_ip, "gateway": router.get("gateway").cloned().unwrap_or(Value::Null), "cgnat": cgnat })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_and_records() {
        assert!(is_private_ip("192.168.1.5") && is_private_ip("100.70.1.1") && is_private_ip("172.20.0.1") && !is_private_ip("8.8.8.8") && !is_private_ip("x"));
        assert!(is_cgnat_ip("100.64.0.1") && !is_cgnat_ip("100.128.0.1"));
        assert!(same_subnet("192.168.1.5", "192.168.1.1", "255.255.255.0") && !same_subnet("192.168.2.5", "192.168.1.1", "255.255.255.0"));
        let r = manual_records("mc.example.pl.", Some("1.2.3.4"), 25570);
        assert_eq!(r[0]["name"], "mc.example.pl");
        assert_eq!(r[1]["value"], "0 5 25570 mc.example.pl");
        assert_eq!(manual_records("", None, 25565).as_array().unwrap().len(), 1);
        assert_eq!(tag("<a><NewExternalIPAddress>5.6.7.8</NewExternalIPAddress></a>", "NewExternalIPAddress").as_deref(), Some("5.6.7.8"));
        let _ = lan_addresses();
    }
}
