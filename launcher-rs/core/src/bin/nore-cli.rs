//! nore-cli – drives the Rust backend without a window: the same channels the launcher UI uses.
//!
//!   nore-cli channels                         list every IPC channel and its port status
//!   nore-cli invoke <channel> [json-arg ...]  call one channel and print the JSON answer
//!   nore-cli play --mc 1.21.1 [--loader fabric] [--name Gracz] [--seconds 60]
//!                                             offline account + instance + game:launch; exits 0
//!                                             when the game window came up and ran for --seconds
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
        "play" => {
            let mc = flag(args, "--mc").unwrap_or_else(|| "1.21.1".into());
            let loader = flag(args, "--loader").unwrap_or_else(|| "vanilla".into());
            let name = flag(args, "--name").unwrap_or_else(|| "Gracz".into());
            let seconds: u64 = flag(args, "--seconds").and_then(|s| s.parse().ok()).unwrap_or(60);
            app.invoke("accounts:offline", vec![json!(name)]).await?;
            let title = format!("CLI {mc} {loader}");
            let existing = app.instances().list().into_iter().find(|i| i.str_of("name") == Some(&title));
            let inst = match existing {
                Some(i) => i,
                None => app.invoke("instances:create", vec![json!({ "name": title, "mcVersion": mc, "loader": loader, "modpack": if loader == "vanilla" { "vanilla" } else if loader == "fabric" { "fabric" } else { "loader" } })]).await?,
            };
            let id = inst.string_or("id", "");
            println!("[cli] instancja {id} ({mc}, {loader}), konto offline {name}");
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
        _ => {
            println!("nore-cli channels | invoke <kanał> [argumenty JSON] | play --mc 1.21.1 [--loader fabric] [--name Gracz] [--seconds 60] [--quiet]");
            Ok(0)
        }
    }
}
