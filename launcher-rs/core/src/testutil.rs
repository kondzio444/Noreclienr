//! A tiny local HTTP server for tests: answers requests with prepared replies, in order.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct Reply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn status(status: u16) -> Self {
        Self { status, content_type: "text/plain", body: Vec::new() }
    }
    pub fn json(body: &str) -> Self {
        Self { status: 200, content_type: "application/json", body: body.as_bytes().to_vec() }
    }
    pub fn json_status(status: u16, body: &str) -> Self {
        Self { status, content_type: "application/json", body: body.as_bytes().to_vec() }
    }
    pub fn bytes(body: Vec<u8>) -> Self {
        Self { status: 200, content_type: "application/octet-stream", body }
    }
}

#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub body: String,
}

pub struct Server {
    port: u16,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Server {
    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }
    pub fn hits(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
    pub fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Starts the server; every request takes the next reply (500 when they run out).
pub async fn serve(replies: Vec<Reply>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let queue = Arc::new(Mutex::new(VecDeque::from(replies)));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen2 = seen.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else { return };
            let queue = queue.clone();
            let seen = seen2.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let head_end = loop {
                    let Ok(n) = sock.read(&mut chunk).await else { return };
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(i) = find(&buf, b"\r\n\r\n") {
                        break i + 4;
                    }
                };
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                let len = head
                    .lines()
                    .find_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        k.eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<usize>().ok())?
                    })
                    .unwrap_or(0);
                while buf.len() < head_end + len {
                    let Ok(n) = sock.read(&mut chunk).await else { return };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let mut first = head.lines().next().unwrap_or("").split(' ');
                let method = first.next().unwrap_or("").to_string();
                let path = first.next().unwrap_or("").to_string();
                let body = String::from_utf8_lossy(&buf[head_end..]).to_string();
                seen.lock().unwrap().push(Seen { method, path, body });
                let reply = queue.lock().unwrap().pop_front().unwrap_or_else(|| Reply::status(500));
                let head = format!(
                    "HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    reply.status,
                    reply.content_type,
                    reply.body.len()
                );
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.write_all(&reply.body).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    Server { port, seen }
}
