//! HTTP with retries and verified, parallel downloads (port of launcher/src/main/net.js).

use crate::error::{msg, Error, Result};
use futures::stream::{self, StreamExt};
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

pub const UA: &str = "NoreLauncher/1.0.0 (github.com/kondzio444/Noreclienr)";

/// One file to download. `sha1` / `size` are checked when given.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Task {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub name: String,
}

/// Progress of [`Net::download_all`], in the shape the renderer expects.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub bytes: u64,
    pub total_bytes: u64,
    pub current: String,
}

#[derive(Clone)]
pub struct Net {
    client: reqwest::Client,
    /// first retry pause; doubles every attempt (500 ms in the launcher, shorter in tests)
    backoff: Duration,
}

impl std::fmt::Debug for Net {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Net")
    }
}

fn install_crypto_provider() {
    // reqwest is built without a default rustls provider: ring is the one the whole app uses
    let _ = rustls::crypto::ring::default_provider().install_default();
}

impl Net {
    pub fn new() -> Result<Self> {
        install_crypto_provider();
        let client = reqwest::Client::builder()
            .user_agent(UA)
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self { client, backoff: Duration::from_millis(500) })
    }

    /// A client for tests against a local server (no proxy, short pauses).
    pub fn for_tests() -> Self {
        install_crypto_provider();
        let client = reqwest::Client::builder().no_proxy().user_agent(UA).build().expect("client");
        Self { client, backoff: Duration::from_millis(5) }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// Sends a request up to `tries` times: network errors, 429 and 5xx are retried with
    /// exponential backoff; other answers (also 4xx) are returned to the caller.
    pub async fn send_with_retry(
        &self,
        make: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
        tries: u32,
    ) -> Result<reqwest::Response> {
        let mut last: Option<Error> = None;
        for i in 0..tries.max(1) {
            match make(&self.client).send().await {
                Ok(res) if res.status().as_u16() == 429 || res.status().is_server_error() => {
                    last = Some(Error::Status { status: res.status().as_u16(), url: res.url().to_string() });
                }
                Ok(res) => return Ok(res),
                Err(e) => last = Some(e.into()),
            }
            if i + 1 < tries {
                tokio::time::sleep(self.backoff * 2u32.pow(i)).await;
            }
        }
        Err(last.unwrap_or_else(|| msg("Brak odpowiedzi")))
    }

    pub async fn get(&self, url: &str) -> Result<reqwest::Response> {
        self.send_with_retry(|c| c.get(url), 4).await
    }

    /// GET + JSON; an error answer becomes "HTTP <status> dla <url>".
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let res = self.get(url).await?;
        if !res.status().is_success() {
            return Err(Error::Status { status: res.status().as_u16(), url: url.to_string() });
        }
        Ok(res.json().await?)
    }

    pub async fn get_text(&self, url: &str) -> Result<String> {
        let res = self.get(url).await?;
        if !res.status().is_success() {
            return Err(Error::Status { status: res.status().as_u16(), url: url.to_string() });
        }
        Ok(res.text().await?)
    }

    /// Downloads `url` to `dest` atomically, verifying the SHA-1 when given. Returns false when a
    /// valid file was already there. `on_bytes(n)` is called for every received chunk.
    pub async fn download(
        &self,
        url: &str,
        dest: &Path,
        sha1: Option<&str>,
        size: Option<u64>,
        on_bytes: &(dyn Fn(u64) + Send + Sync),
    ) -> Result<bool> {
        if is_valid(dest, sha1, size).await {
            if let Some(s) = size {
                on_bytes(s);
            }
            return Ok(false);
        }
        if let Some(dir) = dest.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }
        let file_name = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let tmp = dest.with_file_name(format!("{file_name}.{}.part", std::process::id()));
        for attempt in 0..3 {
            let mut res = self.get(url).await?;
            if !res.status().is_success() {
                return Err(Error::Status { status: res.status().as_u16(), url: url.to_string() });
            }
            let mut hash = Sha1::new();
            let mut out = tokio::fs::File::create(&tmp).await?;
            let body: Result<()> = async {
                while let Some(chunk) = res.chunk().await? {
                    hash.update(&chunk);
                    out.write_all(&chunk).await?;
                    on_bytes(chunk.len() as u64);
                }
                out.flush().await?;
                Ok(())
            }
            .await;
            drop(out);
            if let Err(e) = body {
                let _ = tokio::fs::remove_file(&tmp).await;
                if attempt == 2 {
                    return Err(e);
                }
                continue;
            }
            if let Some(want) = sha1 {
                if hex::encode(hash.finalize()) != want.to_ascii_lowercase() {
                    let _ = tokio::fs::remove_file(&tmp).await;
                    if attempt == 2 {
                        return Err(msg(format!("Błędna suma kontrolna: {file_name}")));
                    }
                    continue;
                }
            }
            tokio::fs::rename(&tmp, dest).await?;
            return Ok(true);
        }
        Ok(false)
    }

    /// Downloads many files with limited parallelism; `progress` gets a report after every file.
    pub async fn download_all(
        &self,
        tasks: Vec<Task>,
        concurrency: usize,
        progress: &(dyn Fn(Progress) + Send + Sync),
        cancel: Option<&CancellationToken>,
    ) -> Result<()> {
        let total = tasks.len();
        let total_bytes: u64 = tasks.iter().filter_map(|t| t.size).sum();
        let done = Arc::new(AtomicUsize::new(0));
        let bytes = Arc::new(AtomicU64::new(0));
        let report = |current: String| {
            progress(Progress {
                done: done.load(Ordering::Relaxed),
                total,
                bytes: bytes.load(Ordering::Relaxed),
                total_bytes,
                current,
            })
        };
        report(String::new());
        let results = stream::iter(tasks.into_iter().map(|t| {
            let bytes = bytes.clone();
            let done = done.clone();
            let report = &report;
            async move {
                if cancel.is_some_and(|c| c.is_cancelled()) {
                    return Err(Error::Cancelled);
                }
                let count = move |n: u64| {
                    bytes.fetch_add(n, Ordering::Relaxed);
                };
                self.download(&t.url, &t.dest, t.sha1.as_deref(), t.size, &count).await?;
                done.fetch_add(1, Ordering::Relaxed);
                report(t.name.clone());
                Ok::<(), Error>(())
            }
        }))
        .buffer_unordered(concurrency.clamp(1, 64))
        .collect::<Vec<_>>()
        .await;
        for r in results {
            r?;
        }
        report(String::new());
        Ok(())
    }
}

/// SHA-1 of a file (hex).
pub async fn sha1_file(file: &Path) -> Result<String> {
    let file = file.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<String> {
        use std::io::Read;
        let mut f = std::fs::File::open(file)?;
        let mut h = Sha1::new();
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = f.read(&mut buf)?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
        }
        Ok(hex::encode(h.finalize()))
    })
    .await
    .map_err(crate::error::wrap)?
}

pub async fn exists(file: &Path) -> bool {
    tokio::fs::try_exists(file).await.unwrap_or(false)
}

/// True when the file exists and matches the size / hash that are given.
pub async fn is_valid(file: &Path, sha1: Option<&str>, size: Option<u64>) -> bool {
    let Ok(meta) = tokio::fs::metadata(file).await else { return false };
    if size.is_some_and(|s| s != meta.len()) {
        return false;
    }
    match sha1 {
        None => true,
        Some(want) => sha1_file(file).await.is_ok_and(|h| h == want.to_ascii_lowercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{serve, Reply};

    fn sha1_hex(b: &[u8]) -> String {
        hex::encode(Sha1::digest(b))
    }

    #[tokio::test]
    async fn retries_server_errors_then_succeeds() {
        let srv = serve(vec![Reply::status(503), Reply::status(429), Reply::json(r#"{"ok":true}"#)]).await;
        let v: serde_json::Value = Net::for_tests().get_json(&srv.url("/x")).await.unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(srv.hits(), 3);
    }

    #[tokio::test]
    async fn client_errors_are_not_retried() {
        let srv = serve(vec![Reply::status(404), Reply::json("{}")]).await;
        let e = Net::for_tests().get_json::<serde_json::Value>(&srv.url("/missing")).await.unwrap_err();
        assert!(e.to_string().starts_with("HTTP 404 dla"), "{e}");
        assert_eq!(srv.hits(), 1);
    }

    #[tokio::test]
    async fn download_verifies_sha1_and_skips_valid_files() {
        let body = b"hello minecraft".to_vec();
        let good = sha1_hex(&body);
        let srv = serve(vec![Reply::bytes(b"corrupted".to_vec()), Reply::bytes(body.clone())]).await;
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("a/b.jar");
        let net = Net::for_tests();
        let nop = |_n: u64| {};
        assert!(net.download(&srv.url("/f"), &dest, Some(&good), None, &nop).await.unwrap());
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert_eq!(srv.hits(), 2);
        // valid already: no request
        assert!(!net.download(&srv.url("/f"), &dest, Some(&good), Some(body.len() as u64), &nop).await.unwrap());
        assert_eq!(srv.hits(), 2);
        assert!(std::fs::read_dir(dest.parent().unwrap()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".part")));
    }

    #[tokio::test]
    async fn download_gives_up_on_a_wrong_checksum() {
        let srv = serve(vec![Reply::bytes(b"x".to_vec()), Reply::bytes(b"x".to_vec()), Reply::bytes(b"x".to_vec())]).await;
        let dir = tempfile::tempdir().unwrap();
        let e = Net::for_tests()
            .download(&srv.url("/f"), &dir.path().join("f.bin"), Some(&"0".repeat(40)), None, &|_| {})
            .await
            .unwrap_err();
        assert_eq!(e.to_string(), "Błędna suma kontrolna: f.bin");
    }

    #[tokio::test]
    async fn download_all_runs_in_parallel_and_reports() {
        let bodies: Vec<Vec<u8>> = (0..12).map(|i| format!("file {i}").into_bytes()).collect();
        let srv = serve(bodies.iter().map(|b| Reply::bytes(b.clone())).collect()).await;
        let dir = tempfile::tempdir().unwrap();
        let tasks: Vec<Task> = (0..12)
            .map(|i| Task {
                url: srv.url(&format!("/f{i}")),
                dest: dir.path().join(format!("f{i}")),
                sha1: None,
                size: Some(6 + if i >= 10 { 1 } else { 0 }),
                name: format!("f{i}"),
            })
            .collect();
        let last = std::sync::Mutex::new(None);
        Net::for_tests()
            .download_all(tasks, 4, &|p| *last.lock().unwrap() = Some(p), None)
            .await
            .unwrap();
        let p = last.lock().unwrap().clone().unwrap();
        assert_eq!((p.done, p.total), (12, 12));
        assert_eq!(p.total_bytes, 74);
        assert_eq!(srv.hits(), 12);
    }
}
