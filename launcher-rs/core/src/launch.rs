//! Building the java command and starting the game (port of launcher/src/main/launch.js).

use crate::error::Result;
use crate::js::ValueExt;
use crate::jvm::{self, JvmArgs};
use crate::store::DISCORD_APP_ID;
use crate::versions::{self, Installed};
use hmac::{Hmac, Mac};
use rand::RngCore;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

pub const LAUNCHER_NAME: &str = "nore-launcher";

// Nore Client refuses to run without a ticket signed with this key (see LaunchAuth in the mod)
const SESSION_KEY: &str = "65a21dccdb7cc1c0d27f3c431f20a116c2823186b96ef785ef73623d0c1dea4f";

/// Short-lived signed ticket that lets Nore Client start (time.nonce.hmac).
pub fn session_ticket() -> String {
    let time = crate::js::now_ms().to_string();
    let mut n = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut n);
    let nonce = hex::encode(n);
    let key = hex::decode(SESSION_KEY).expect("constant key");
    let mut mac = Hmac::<sha2::Sha256>::new_from_slice(&key).expect("any key length");
    mac.update(format!("nore:{time}:{nonce}").as_bytes());
    format!("{time}.{nonce}.{}", hex::encode(mac.finalize().into_bytes()))
}

static VAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\$\{([a-zA-Z_]+)\}").unwrap());

/// Replaces `${name}` with known variables; unknown ones stay as they are.
pub fn substitute(s: &str, vars: &HashMap<String, String>) -> String {
    VAR.replace_all(s, |c: &regex::Captures| vars.get(&c[1]).cloned().unwrap_or_else(|| c[0].to_string())).into_owned()
}

/// Expands Mojang's modern argument arrays (strings or `{ rules, value }`).
pub fn expand_args(list: Option<&Value>, vars: &HashMap<String, String>, features: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for a in list.and_then(Value::as_array).into_iter().flatten() {
        match a {
            Value::String(s) => out.push(substitute(s, vars)),
            Value::Object(_) if versions::rules_allow(a.get("rules"), features) => match a.get("value") {
                Some(Value::Array(vs)) => out.extend(vs.iter().filter_map(Value::as_str).map(|v| substitute(v, vars))),
                Some(Value::String(v)) => out.push(substitute(v, vars)),
                _ => {}
            },
            _ => {}
        }
    }
    out
}

/// Arguments that join a server right after the start: quick play (1.20+) when the version has it,
/// else the old --server / --port pair.
pub fn join_args(version: &Value, address: &str) -> Vec<String> {
    let game = version.pointer("/arguments/game").map(|g| g.to_string()).unwrap_or_default();
    if game.contains("quickPlayMultiplayer") {
        return vec!["--quickPlayMultiplayer".into(), address.into()];
    }
    static ADDR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\[[^\]]+\]|[^:]+)(?::(\d+))?$").unwrap());
    let a = address.trim();
    match ADDR.captures(a) {
        None => vec!["--server".into(), a.into()],
        Some(c) => vec![
            "--server".into(),
            c[1].trim_start_matches('[').trim_end_matches(']').to_string(),
            "--port".into(),
            c.get(2).map_or("25565", |m| m.as_str()).to_string(),
        ],
    }
}

/// Drops quick-play options left without a value.
pub fn drop_empty_quick_play(game: &mut Vec<String>) {
    let mut i = game.len();
    while i > 0 {
        i -= 1;
        if i >= game.len() {
            continue;
        }
        let next = game.get(i + 1).cloned();
        if game[i].starts_with("--quickPlay") && next.as_ref().is_none_or(|n| n.is_empty() || n.starts_with("--")) {
            let n = if next.as_deref() == Some("") { 2 } else { 1 };
            game.drain(i..(i + n).min(game.len()));
        }
    }
}

/// Everything [`build_command`] needs.
pub struct LaunchSpec<'a> {
    pub instance: &'a Value,
    pub account: &'a Value,
    pub settings: &'a Value,
    pub installed: &'a Installed,
    pub java_bin: PathBuf,
    pub java_major: u32,
    pub assets_dir: PathBuf,
    pub libraries_dir: PathBuf,
    pub natives_dir: PathBuf,
    pub launcher_version: &'a str,
    /// mods / shaders and system RAM for the memory plan
    pub mods: (u64, bool),
    pub ram_mb: (u64, u64),
}

pub struct GameCommand {
    pub java_bin: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub tuned: JvmArgs,
}

/// Memory + GC flags for an instance (see jvm.rs).
pub fn tuned_jvm(instance: &Value, settings: &Value, java_major: u32, mods: (u64, bool), ram: (u64, u64)) -> JvmArgs {
    let mode = instance.str_of("jvmMode").filter(|m| !m.is_empty()).or(settings.str_of("jvmMode")).unwrap_or("auto");
    jvm::build_jvm_args(&jvm::Opts {
        mode: mode.into(),
        java_major: if java_major == 0 { 17 } else { java_major },
        instance_mb: instance.num_of("memoryMb").max(0.0) as u64,
        settings_mb: settings.num_of("memoryMb").max(0.0) as u64,
        mods: mods.0,
        shaders: mods.1,
        loader: instance.string_or("loader", "vanilla"),
        total_mb: ram.0,
        free_mb: ram.1,
        user_args: settings.string_or("jvmArgs", ""),
    })
}

/// The full java command for an installed version (natives must be extracted to `natives_dir`).
pub fn build_command(s: &LaunchSpec) -> GameCommand {
    let version = &s.installed.version;
    let game_dir = PathBuf::from(s.instance.string_or("gameDir", "."));
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut cp: Vec<String> = s.installed.libs.classpath.iter().map(|p| p.to_string_lossy().to_string()).collect();
    cp.push(s.installed.jar_path.to_string_lossy().to_string());
    let classpath = cp.join(sep);
    let num = |v: &Value, k: &str| v.num_of(k) as i64;
    let width = if num(s.instance, "width") > 0 { num(s.instance, "width") } else { num(s.settings, "width") };
    let height = if num(s.instance, "height") > 0 { num(s.instance, "height") } else { num(s.settings, "height") };
    let token = s.account.string_or("accessToken", "0");
    let path = |p: &Path| p.to_string_lossy().to_string();
    let vars: HashMap<String, String> = [
        ("auth_player_name", s.account.string_or("name", "Gracz")),
        ("version_name", s.installed.launch_id.clone()),
        ("game_directory", path(&game_dir)),
        ("assets_root", path(&s.assets_dir)),
        ("game_assets", path(&s.assets_dir.join("virtual").join("legacy"))),
        ("assets_index_name", version.pointer("/assetIndex/id").and_then(Value::as_str).unwrap_or_default().to_string()),
        ("auth_uuid", s.account.string_or("uuid", "").replace('-', "")),
        ("auth_access_token", token.clone()),
        ("auth_session", token),
        ("clientid", String::new()),
        ("auth_xuid", String::new()),
        ("user_type", if s.account.str_of("type") == Some("microsoft") { "msa" } else { "legacy" }.into()),
        ("version_type", "Nore Launcher".into()),
        ("user_properties", "{}".into()),
        ("resolution_width", width.to_string()),
        ("resolution_height", height.to_string()),
        ("natives_directory", path(&s.natives_dir)),
        ("launcher_name", LAUNCHER_NAME.into()),
        ("launcher_version", s.launcher_version.into()),
        ("classpath", classpath.clone()),
        ("classpath_separator", sep.into()),
        ("library_directory", path(&s.libraries_dir)),
        ("quickPlayPath", String::new()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    let fullscreen = s.settings.truthy_of("fullscreen");
    let features = json!({ "has_custom_resolution": !fullscreen, "is_demo_user": false });

    let major = if s.java_major > 0 { s.java_major } else { version.pointer("/javaVersion/majorVersion").and_then(Value::as_u64).unwrap_or(17) as u32 };
    let tuned = tuned_jvm(s.instance, s.settings, major, s.mods, s.ram_mb);
    let mut jvm_args = Vec::new();
    if version.pointer("/arguments/jvm").is_some() {
        jvm_args.extend(expand_args(version.pointer("/arguments/jvm"), &vars, &features));
    } else {
        jvm_args.push(format!("-Djava.library.path={}", path(&s.natives_dir)));
        jvm_args.push("-cp".into());
        jvm_args.push(classpath);
    }
    if let Some(lc) = version.pointer("/logging/client") {
        let id = lc.pointer("/file/id").and_then(Value::as_str).unwrap_or("client.xml");
        let mut v = HashMap::new();
        v.insert("path".to_string(), path(&s.assets_dir.join("log_configs").join(id)));
        jvm_args.push(substitute(lc.str_of("argument").unwrap_or_default(), &v));
    }
    jvm_args.push(format!("-Dnoreclient.session={}", session_ticket()));
    jvm_args.push(format!("-Dnoreclient.discordAppId={}", s.settings.string_or("discordAppId", DISCORD_APP_ID)));
    if let Some(b) = s.settings.str_of("chatBridge").filter(|b| !b.is_empty()) {
        jvm_args.push(format!("-Dnoreclient.chatBridge={b}"));
    }
    // the Nore Hub address is built into the mod; NORE_HUB points the launcher and the game elsewhere
    if let Ok(hub) = std::env::var("NORE_HUB") {
        jvm_args.push(format!("-Dnoreclient.hub={}", hub.trim_end_matches('/')));
    }
    // memory, GC and the player's own arguments (theirs win) – after Mojang's
    jvm_args.extend(tuned.args.iter().cloned());
    if cfg!(target_os = "macos") {
        jvm_args.push("-XstartOnFirstThread".into());
    }

    let mut game = if version.pointer("/arguments/game").is_some() {
        expand_args(version.pointer("/arguments/game"), &vars, &features)
    } else {
        let mut g: Vec<String> =
            substitute(version.str_of("minecraftArguments").unwrap_or_default(), &vars).split(' ').filter(|x| !x.is_empty()).map(String::from).collect();
        if !fullscreen {
            g.extend(["--width".into(), vars["resolution_width"].clone(), "--height".into(), vars["resolution_height"].clone()]);
        }
        g
    };
    drop_empty_quick_play(&mut game);
    if fullscreen {
        game.push("--fullscreen".into());
    }
    if let Some(j) = s.instance.str_of("joinServer").filter(|j| !j.is_empty()) {
        game.extend(join_args(version, j));
    }
    let mut args = jvm_args;
    args.push(version.str_of("mainClass").unwrap_or_default().to_string());
    args.extend(game);
    GameCommand { java_bin: s.java_bin.clone(), args, cwd: game_dir, tuned }
}

/// The launcher's first log line about memory / GC / Java.
pub fn summary_line(t: &JvmArgs, java_major: u32) -> String {
    let gc = match t.gc {
        "zgc" => "Generational ZGC",
        "g1" => "G1 zoptymalizowany",
        _ => "własne argumenty",
    };
    format!(
        "[Launcher] Pamięć: {:.1} GB{}, GC: {gc}{}",
        t.memory.xmx as f64 / 1024.0,
        if t.memory.auto { " (automatycznie)" } else { "" },
        if java_major > 0 { format!(", Java {java_major}") } else { String::new() }
    )
}

pub type LogFn = Arc<dyn Fn(String, &'static str) + Send + Sync>;
pub type ExitFn = Box<dyn FnOnce(i32) + Send>;

/// A running game: kill() stops it; the exit callback runs either way.
pub struct GameHandle {
    kill: Option<oneshot::Sender<()>>,
    pub pid: Option<u32>,
}

impl GameHandle {
    pub fn kill(&mut self) {
        if let Some(k) = self.kill.take() {
            let _ = k.send(());
        }
    }
}

/// Starts the game, streams its output line by line and reports the exit code.
pub fn spawn(cmd: &GameCommand, on_log: LogFn, on_exit: ExitFn) -> Result<GameHandle> {
    let mut c = Command::new(&cmd.java_bin);
    c.args(&cmd.args).current_dir(&cmd.cwd).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            on_log(format!("Błąd uruchamiania Javy: {e}"), "err");
            on_exit(-1);
            return Err(e.into());
        }
    };
    let pid = child.id();
    let mut readers = Vec::new();
    for (stream, name) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), "out"),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), "err"),
    ] {
        let Some(stream) = stream else { continue };
        let on_log = on_log.clone();
        readers.push(tokio::spawn(async move {
            let mut r = BufReader::new(stream);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match r.read_until(b'\n', &mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&buf);
                        on_log(line.trim_end_matches(['\n', '\r']).to_string(), name);
                    }
                }
            }
        }));
    }
    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let status = tokio::select! {
            s = child.wait() => s,
            // a dropped handle is not a kill request: only an explicit kill() stops the game
            Ok(()) = rx => {
                let _ = child.kill().await;
                child.wait().await
            }
        };
        for r in readers {
            let _ = r.await;
        }
        on_exit(status.ok().and_then(|s| s.code()).unwrap_or(-1));
    });
    Ok(GameHandle { kill: Some(tx), pid })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::versions::Libs;

    #[test]
    fn argument_expansion() {
        let vars: HashMap<String, String> =
            [("auth_player_name", "Steve"), ("resolution_width", "1280")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        let args = expand_args(
            Some(&json!([
                "--username", "${auth_player_name}",
                { "rules": [{ "action": "allow", "features": { "is_demo_user": true } }], "value": "--demo" },
                { "rules": [{ "action": "allow", "features": { "has_custom_resolution": true } }], "value": ["--width", "${resolution_width}"] },
                "${unknown}"
            ])),
            &vars,
            &json!({ "has_custom_resolution": true }),
        );
        assert_eq!(args, vec!["--username", "Steve", "--width", "1280", "${unknown}"]);
    }

    #[test]
    fn joining_a_server() {
        let modern = json!({ "arguments": { "game": [{ "rules": [{ "features": { "is_quick_play_multiplayer": true } }], "value": ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"] }] } });
        assert_eq!(join_args(&modern, "mc.noreclient.pl"), vec!["--quickPlayMultiplayer", "mc.noreclient.pl"]);
        assert_eq!(join_args(&json!({ "minecraftArguments": "" }), "mc.noreclient.pl"), vec!["--server", "mc.noreclient.pl", "--port", "25565"]);
        assert_eq!(join_args(&json!({}), "a.pl:25570"), vec!["--server", "a.pl", "--port", "25570"]);
        assert_eq!(join_args(&json!({}), "[::1]:25570"), vec!["--server", "::1", "--port", "25570"]);
    }

    #[test]
    fn quick_play_without_value_is_dropped() {
        let mut g: Vec<String> = ["--quickPlayPath", "", "--username", "x", "--quickPlaySingleplayer"].iter().map(|s| s.to_string()).collect();
        drop_empty_quick_play(&mut g);
        assert_eq!(g, vec!["--username", "x"]);
    }

    #[test]
    fn ticket_is_signed() {
        let t = session_ticket();
        let p: Vec<&str> = t.split('.').collect();
        assert_eq!(p.len(), 3);
        let mut mac = Hmac::<sha2::Sha256>::new_from_slice(&hex::decode(SESSION_KEY).unwrap()).unwrap();
        mac.update(format!("nore:{}:{}", p[0], p[1]).as_bytes());
        assert_eq!(hex::encode(mac.finalize().into_bytes()), p[2]);
    }

    #[test]
    fn full_command_for_a_modern_version() {
        let version = json!({
            "id": "1.21.1", "mainClass": "net.minecraft.client.main.Main", "assetIndex": { "id": "17" },
            "javaVersion": { "majorVersion": 21 },
            "logging": { "client": { "argument": "-Dlog4j.configurationFile=${path}", "file": { "id": "client-1.12.xml" } } },
            "arguments": {
                "jvm": ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
                "game": ["--username", "${auth_player_name}", "--uuid", "${auth_uuid}", "--accessToken", "${auth_access_token}", "--userType", "${user_type}",
                         { "rules": [{ "action": "allow", "features": { "has_custom_resolution": true } }], "value": ["--width", "${resolution_width}", "--height", "${resolution_height}"] },
                         { "rules": [{ "action": "allow", "features": { "is_quick_play_multiplayer": true } }], "value": ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"] }]
            }
        });
        let installed = Installed {
            version,
            launch_id: "1.21.1".into(),
            jar_path: "/d/versions/1.21.1/1.21.1.jar".into(),
            libs: Libs { classpath: vec!["/d/libraries/a.jar".into()], ..Default::default() },
            loader_version: None,
        };
        let account = crate::auth::create_offline("Gracz").unwrap();
        let instance = json!({ "id": "x", "gameDir": "/d/instances/x", "loader": "vanilla", "joinServer": "mc.noreclient.pl", "width": 0 });
        let settings = crate::store::defaults()["settings"].clone();
        let cmd = build_command(&LaunchSpec {
            instance: &instance,
            account: &account,
            settings: &settings,
            installed: &installed,
            java_bin: "/java".into(),
            java_major: 21,
            assets_dir: "/d/assets".into(),
            libraries_dir: "/d/libraries".into(),
            natives_dir: "/d/versions/1.21.1/natives".into(),
            launcher_version: "1.4.5",
            mods: (0, false),
            ram_mb: (16384, 8000),
        });
        let a = &cmd.args;
        let sep = if cfg!(windows) { ";" } else { ":" };
        assert_eq!(a[0], "-Djava.library.path=/d/versions/1.21.1/natives");
        assert_eq!(a[2], format!("/d/libraries/a.jar{sep}/d/versions/1.21.1/1.21.1.jar"));
        assert!(a.iter().any(|x| x == "-Dlog4j.configurationFile=/d/assets/log_configs/client-1.12.xml"));
        assert!(a.iter().any(|x| x.starts_with("-Dnoreclient.session=")));
        assert!(a.iter().any(|x| x == "-Xmx2048M") && a.iter().any(|x| x == "-XX:+UseG1GC"));
        let main = a.iter().position(|x| x == "net.minecraft.client.main.Main").unwrap();
        assert_eq!(&a[main + 1..main + 3], ["--username", "Gracz"]);
        assert!(a.contains(&crate::auth::offline_uuid("Gracz").replace('-', "")));
        assert!(a.windows(2).any(|w| w == ["--userType", "legacy"]));
        assert!(a.windows(4).any(|w| w == ["--width", "1280", "--height", "720"]));
        assert_eq!(&a[a.len() - 2..], ["--quickPlayMultiplayer", "mc.noreclient.pl"]);
        assert_eq!(cmd.cwd, PathBuf::from("/d/instances/x"));
        assert!(summary_line(&cmd.tuned, 21).contains("Pamięć: 2.0 GB (automatycznie), GC: G1 zoptymalizowany, Java 21"));
    }

    #[tokio::test]
    async fn spawn_streams_lines_and_exit_code() {
        #[cfg(unix)]
        let cmd = GameCommand {
            java_bin: "/bin/sh".into(),
            args: vec!["-c".into(), "echo one; echo two 1>&2; printf 'three\\r\\n'; exit 3".into()],
            cwd: std::env::temp_dir(),
            tuned: crate::jvm::build_jvm_args(&Default::default()),
        };
        #[cfg(windows)]
        let cmd = GameCommand {
            java_bin: "cmd".into(),
            args: vec!["/C".into(), "echo one & echo two 1>&2 & echo three & exit 3".into()],
            cwd: std::env::temp_dir(),
            tuned: crate::jvm::build_jvm_args(&Default::default()),
        };
        let lines = Arc::new(std::sync::Mutex::new(Vec::new()));
        let l2 = lines.clone();
        let (tx, rx) = oneshot::channel();
        spawn(
            &cmd,
            Arc::new(move |l, s| l2.lock().unwrap().push((l.trim().to_string(), s))),
            Box::new(move |c| {
                let _ = tx.send(c);
            }),
        )
        .unwrap();
        assert_eq!(rx.await.unwrap(), 3);
        let mut got = lines.lock().unwrap().clone();
        got.sort();
        assert_eq!(got, vec![("one".into(), "out"), ("three".into(), "out"), ("two".into(), "err")]);
    }
}
