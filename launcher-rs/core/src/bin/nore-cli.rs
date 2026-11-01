//! nore-cli – drives the Rust backend without a window: the same channels the launcher UI uses.
//!
//!   nore-cli channels                         list every IPC channel and its port status
//!   nore-cli invoke <channel> [json-arg ...]  call one channel and print the JSON answer
//!   nore-cli play --mc 1.21.1 [--loader fabric] [--name Gracz] [--seconds 60]
//!                                             offline account + instance + game:launch; exits 0
//!                                             when the game window came up and ran for --seconds
//!
//!   nore-cli modpack <projectId> [--version <id>] [--seconds 60] [--shot file.png]
//!                                             modpacks:install, then game:launch of the new instance
//!   nore-cli launch <instanceId> [--seconds 60] [--shot file.png]
//!   nore-cli server --type paper --mc 1.21.1 [--seconds 20] [--port 25565]
//!                                             servers:create + servers:start, waits for "Done", runs
//!                                             `list`, then servers:stop
//!
//! Data folder: NORE_LAUNCHER_HOME (default: the launcher's own folder).

use nore_core::ipc::{App, Config, Emitter, HeadlessShell, Status, CHANNELS};
use nore_core::js::ValueExt;
use nore_core::paths::Paths;
use nore_core::updater::DevUpdater;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Print {
    visible: AtomicBool,
    exit: AtomicI64,
    exited: AtomicBool,
    last_progress: Mutex<Instant>,
    quiet_log: bool,
    server_state: Mutex<String>,
    doctor: Mutex<Option<Value>>,
}

impl Emitter for Print {
    fn emit(&self, channel: &str, payload: Value) {
        match channel {
            "log" => {
                if !self.quiet_log {
                    println!("[{}] {}", payload.string_or("stream", "out"), payload.string_or("line", ""));
                }
            }
            "progress" => {
                if payload.is_null() {
                    return;
                }
                let mut last = self.last_progress.lock().unwrap();
                let done_all = payload.get("done").is_some() && payload.get("done") == payload.get("total");
                if last.elapsed() < Duration::from_millis(1500) && !done_all {
                    return;
                }
                *last = Instant::now();
                let extra = match (payload.get("done"), payload.get("total")) {
                    (Some(d), Some(t)) => format!(" {d}/{t}"),
                    _ => String::new(),
                };
                println!("[postęp] {}{extra}", payload.string_or("stage", ""));
            }
            "game:state" => {
                println!("[game:state] {payload}");
                if payload.str_of("phase") == Some("running") {
                    self.visible.store(true, Ordering::SeqCst);
                }
                if payload.get("running") == Some(&Value::Null) {
                    self.exit.store(payload.i64_of("code"), Ordering::SeqCst);
                    self.exited.store(true, Ordering::SeqCst);
                }
            }
            "server:state" => {
                println!("[server:state] {payload}");
                if let Some(st) = payload.str_of("state") {
                    *self.server_state.lock().unwrap() = st.to_string();
                }
            }
            "doctor:report" => {
                println!("[doctor:report] {payload}");
                *self.doctor.lock().unwrap() = Some(payload);
            }
            "server:log" => {
                if !self.quiet_log {
                    println!("[serwer] {}", payload.string_or("line", ""));
                }
            }
            "modpack:progress" | "server:progress" => {
                if payload.is_null() || payload.get("done") == Some(&json!(true)) {
                    return;
                }
                let mut last = self.last_progress.lock().unwrap();
                if last.elapsed() < Duration::from_millis(1500) {
                    return;
                }
                *last = Instant::now();
                println!(
                    "[{channel}] {} {}",
                    payload.string_or("stage", ""),
                    payload.get("done").map(|d| format!("{d}/{}", payload["total"])).unwrap_or_default()
                );
            }
            other => println!("[{other}] {payload}"),
        }
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match run(&args).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Błąd: {e}");
            1
        }
    };
    std::process::exit(code);
}

async fn run(args: &[String]) -> nore_core::Result<i32> {
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    if cmd == "channels" {
        for (c, s) in CHANNELS {
            let mark = match s {
                Status::Ported => "ported ",
                Status::Stub => "stub   ",
                Status::Pending => "pending",
            };
            println!("{mark} {c}");
        }
        let ported = CHANNELS.iter().filter(|(_, s)| *s == Status::Ported).count();
        println!("\n{ported} / {} kanałów przeniesionych", CHANNELS.len());
        return Ok(0);
    }
    let printer = Arc::new(Print {
        visible: AtomicBool::new(false),
        exit: AtomicI64::new(0),
        exited: AtomicBool::new(false),
        last_progress: Mutex::new(Instant::now() - Duration::from_secs(10)),
        quiet_log: args.iter().any(|a| a == "--quiet"),
        server_state: Mutex::new(String::new()),
        doctor: Mutex::new(None),
    });
    let version = env!("CARGO_PKG_VERSION").to_string();
    let app = App::new(Config {
        paths: Paths::from_env(),
        version: version.clone(),
        emitter: printer.clone(),
        shell: Arc::new(HeadlessShell),
        updater: Arc::new(DevUpdater { version }),
        resource_dir: None,
        ephemeral_secrets: false,
    })?;
    if let Some(r) = &app.imported {
        println!("[import] {}", serde_json::to_string(r).unwrap_or_default());
    }
    match cmd {
        "invoke" => {
            let channel = args.get(1).cloned().unwrap_or_default();
            let call: Vec<Value> =
                args[2.min(args.len())..].iter().filter(|a| !a.starts_with("--")).map(|a| serde_json::from_str(a).unwrap_or_else(|_| json!(a))).collect();
            let out = app.invoke(&channel, call).await?;
            println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
            Ok(0)
        }
        "modpack" => {
            let pid = args.get(1).cloned().unwrap_or_default();
            let mut o = json!({ "projectId": pid });
            if let Some(v) = flag(args, "--version") {
                o["versionId"] = json!(v);
            }
            app.invoke("accounts:offline", vec![json!(flag(args, "--name").unwrap_or_else(|| "Gracz".into()))]).await?;
            let t0 = Instant::now();
            let r = app.invoke("modpacks:install", vec![o]).await?;
            let inst = &r["instance"];
            println!(
                "[cli] modpack zainstalowany w {:.0} s: {} ({} {} {}), plików paczki: {}{}",
                t0.elapsed().as_secs_f64(),
                inst.string_or("name", ""),
                inst.string_or("mcVersion", ""),
                inst.string_or("loader", ""),
                inst.string_or("loaderVersion", ""),
                inst["pack"]["files"].as_array().map_or(0, Vec::len),
                r.str_of("warning").map(|w| format!(" (uwaga: {w})")).unwrap_or_default()
            );
            let id = inst.string_or("id", "");
            play_instance(&app, &printer, &id, args).await
        }
        "launch" => {
            let id = args.get(1).cloned().unwrap_or_default();
            app.instances().require(&id)?;
            play_instance(&app, &printer, &id, args).await
        }
        "server" => {
            let t = flag(args, "--type").unwrap_or_else(|| "paper".into());
            let mc = flag(args, "--mc").unwrap_or_else(|| "1.21.1".into());
            let port: u64 = flag(args, "--port").and_then(|p| p.parse().ok()).unwrap_or(25565);
            let seconds: u64 = flag(args, "--seconds").and_then(|s| s.parse().ok()).unwrap_or(20);
            let srv = app
                .invoke(
                    "servers:create",
                    vec![json!({ "name": format!("CLI {t} {mc}"), "mcVersion": mc, "type": t, "eula": true, "memoryMb": 1536, "port": port })],
                )
                .await?;
            let id = srv.string_or("id", "");
            println!("[cli] serwer {id} ({t} {mc}, port {port})");
            let t0 = Instant::now();
            app.invoke("servers:start", vec![json!(id)]).await?;
            let deadline = Instant::now() + Duration::from_secs(900);
            loop {
                let st = printer.server_state.lock().unwrap().clone();
                if st == "running" || st == "stopped" || Instant::now() > deadline {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if printer.server_state.lock().unwrap().as_str() != "running" {
                println!("[cli] serwer nie wystartował");
                return Ok(2);
            }
            println!("[cli] serwer działa po {:.0} s – {} s pracy", t0.elapsed().as_secs_f64(), seconds);
            tokio::time::sleep(Duration::from_secs(3)).await;
            app.invoke("servers:command", vec![json!(id), json!("list")]).await?;
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            println!("[cli] statystyki: {}", app.invoke("servers:stats", vec![json!(id)]).await?);
            println!("[cli] właściwości: motd={}", app.invoke("servers:properties", vec![json!(id)]).await?["motd"]);
            app.invoke("servers:stop", vec![json!(id)]).await?;
            let stop = Instant::now() + Duration::from_secs(60);
            while printer.server_state.lock().unwrap().as_str() != "stopped" && Instant::now() < stop {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            let backup = app.invoke("servers:backup", vec![json!(id)]).await?;
            println!("[cli] OK – serwer zatrzymany ({}), kopia świata: {backup}", printer.server_state.lock().unwrap());
            Ok(0)
        }
        "play" => {
            let mc = flag(args, "--mc").unwrap_or_else(|| "1.21.1".into());
            let loader = flag(args, "--loader").unwrap_or_else(|| "vanilla".into());
            let name = flag(args, "--name").unwrap_or_else(|| "Gracz".into());
            app.invoke("accounts:offline", vec![json!(name)]).await?;
            let title = format!("CLI {mc} {loader}");
            let existing = app.instances().list().into_iter().find(|i| i.str_of("name") == Some(&title));
            let inst = match existing {
                Some(i) => i,
                None => app.invoke("instances:create", vec![json!({ "name": title, "mcVersion": mc, "loader": loader, "modpack": if loader == "vanilla" { "vanilla" } else if loader == "fabric" { "fabric" } else { "loader" } })]).await?,
            };
            let id = inst.string_or("id", "");
            println!("[cli] instancja {id} ({mc}, {loader}), konto offline {name}");
            play_instance(&app, &printer, &id, args).await
        }
        _ => {
            println!("nore-cli channels | invoke <kanał> [argumenty JSON] | play --mc 1.21.1 [--loader fabric] [--name Gracz] [--seconds 60] [--quiet]");
            Ok(0)
        }
    }
}

/// game:launch, waits for the window, plays `--seconds` (optionally takes a screenshot), closes the game.
async fn play_instance(app: &Arc<App>, printer: &Arc<Print>, id: &str, args: &[String]) -> nore_core::Result<i32> {
    let code = play_once(app, printer, id, args).await?;
    if code != 3 {
        return Ok(code);
    }
    // a crash: wait for the automatic repair (doctor:report) and start once more when it fixed something
    let until = Instant::now() + Duration::from_secs(60);
    while printer.doctor.lock().unwrap().is_none() && Instant::now() < until {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let report = printer.doctor.lock().unwrap().take();
    let fixed = report.as_ref().is_some_and(|r| r.truthy_of("applied") && r["problems"].as_array().is_some_and(|p| !p.is_empty()));
    if !fixed {
        return Ok(3);
    }
    println!("[cli] automatyczna naprawa zastosowana – uruchamiam ponownie");
    printer.exited.store(false, Ordering::SeqCst);
    printer.visible.store(false, Ordering::SeqCst);
    play_once(app, printer, id, args).await
}

async fn play_once(app: &Arc<App>, printer: &Arc<Print>, id: &str, args: &[String]) -> nore_core::Result<i32> {
    let seconds: u64 = flag(args, "--seconds").and_then(|s| s.parse().ok()).unwrap_or(60);
    let id = id.to_string();

    let t0 = Instant::now();
    app.invoke("game:launch", vec![json!(id), json!({})]).await?;
    println!("[cli] gra uruchomiona po {:.1} s przygotowań", t0.elapsed().as_secs_f64());
    let deadline = Instant::now() + Duration::from_secs(600);
    while !printer.visible.load(Ordering::SeqCst) && !printer.exited.load(Ordering::SeqCst) && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    if !printer.visible.load(Ordering::SeqCst) {
        println!("[cli] okno gry się nie pojawiło (kod {})", printer.exit.load(Ordering::SeqCst));
        return Ok(2);
    }
    println!("[cli] okno gry jest – gram {seconds} s");
    if let Some(shot) = flag(args, "--shot") {
        let s2 = shot.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(25)).await;
            let ok = tokio::process::Command::new("import").args(["-window", "root", &s2]).status().await.is_ok_and(|s| s.success());
            println!("[cli] zrzut ekranu {s2}: {}", if ok { "zapisany" } else { "nie udał się" });
        });
    }
    let until = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < until && !printer.exited.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    if printer.exited.load(Ordering::SeqCst) {
        println!("[cli] gra zamknęła się sama z kodem {}", printer.exit.load(Ordering::SeqCst));
        return Ok(3);
    }
    app.invoke("game:kill", vec![]).await?;
    let stop = Instant::now() + Duration::from_secs(30);
    while !printer.exited.load(Ordering::SeqCst) && Instant::now() < stop {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let st = app.invoke("state:get", vec![]).await?;
    let played = st["instances"].as_array().and_then(|l| l.iter().find(|i| i.str_of("id") == Some(&id))).map_or(0, |i| i.i64_of("playTime"));
    println!("[cli] OK – gra działała, zamknięta przez launcher (czas gry zapisany: {} s)", played / 1000);
    Ok(0)
}
