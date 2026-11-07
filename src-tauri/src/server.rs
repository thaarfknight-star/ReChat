//! Localhost overlay server (M1 + M2).
//!
//! Serves the built frontend (`dist/`) on 127.0.0.1:17874 so Meld can
//! load the overlays as Browser Sources:
//!   http://localhost:17874/chat   -> chat overlay (transparent)
//!   http://localhost:17874/goal   -> goal overlay (transparent)
//!   http://localhost:17874/api/status -> app + chat status (JSON)
//!   http://localhost:17874/api/chat/stream -> SSE: live chat events
//!     (message / deleted / pinned / unpinned / status, JSON per line)
//!
//! The dist dir is resolved by `dist_dir` in lib.rs, which tries the
//! resource dir, the exe dir (nested and flat), and the dev checkout,
//! because the installed layout is not a single fixed path.
//! Only loopback is bound, so nothing is exposed to the network.

use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::broadcast,
};

use crate::goal::GoalHub;
use crate::kick::{self, ChatHub};
use crate::kick_auth::KickAuthState;
use crate::theme::ThemeStore;

pub const PORT: u16 = 17874;

fn mime(path: &PathBuf) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Minimal percent-decoding for query values (profile names).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next().unwrap_or("");
        let v = parts.next().unwrap_or("");
        if k == key {
            Some(percent_decode(v))
        } else {
            None
        }
    })
}

/// Insert `extra` right before </head> (or at the top when absent).
fn inject_head(html: &[u8], extra: &str) -> Vec<u8> {
    let text = String::from_utf8_lossy(html).into_owned();
    match text.find("</head>") {
        Some(idx) => {
            let mut out = String::with_capacity(text.len() + extra.len());
            out.push_str(&text[..idx]);
            out.push_str(extra);
            out.push_str(&text[idx..]);
            out.into_bytes()
        }
        None => {
            let mut out = String::with_capacity(text.len() + extra.len());
            out.push_str(extra);
            out.push_str(&text);
            out.into_bytes()
        }
    }
}

async fn handle(
    mut stream: tokio::net::TcpStream,
    dist: PathBuf,
    hub: Arc<ChatHub>,
    goal_hub: Arc<GoalHub>,
    store: Arc<ThemeStore>,
    auth: Arc<KickAuthState>,
) {
    let mut buf = [0u8; 8192];
    let Ok(n) = stream.read(&mut buf).await else { return };
    let req = String::from_utf8_lossy(&buf[..n]);
    let target = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_string();
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target, String::new()),
    };
    let profile = query_value(&query, "profile");

    // SSE stream: headers first, then one JSON event per line, forever.
    if path == "/api/chat/stream" {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
        if stream.write_all(head.as_bytes()).await.is_err() {
            return;
        }
        let mut rx = hub.subscribe();
        // Current status first, so the overlay never waits blind.
        let st = hub.status_snapshot().await;
        let first = serde_json::json!({"type": "status", "state": st.state, "channel": st.channel, "detail": st.detail});
        let _ = stream
            .write_all(format!("data: {first}\n\n").as_bytes())
            .await;
        let _ = stream.flush().await;
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(15)) => {
                    if stream.write_all(b": ping\n\n").await.is_err() { return; }
                    let _ = stream.flush().await;
                }
                res = rx.recv() => {
                    match res {
                        Ok(ev) => {
                            let json = serde_json::to_string(&ev).unwrap_or_default();
                            if stream.write_all(format!("data: {json}\n\n").as_bytes()).await.is_err() { return; }
                            let _ = stream.flush().await;
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => return,
                    }
                }
            }
        }
    }

    // Kick OAuth callback (M8): validate state, exchange the code,
    // resolve the channel, persist tokens, connect chat — then tell
    // the user to go back to the app (the settings window polls).
    if path == "/oauth/callback" {
        let code = query_value(&query, "code").unwrap_or_default();
        let state = query_value(&query, "state").unwrap_or_default();
        // Await the exchange so the page tells the truth: success
        // only after tokens are saved and chat is connecting.
        let ok = match auth.complete(&code, &state).await {
            Ok((_user, slug)) => {
                if hub.connect(slug.clone()).await {
                    kick::spawn_loop(hub.clone(), slug);
                }
                true
            }
            Err(_e) => false,
        };
        let body = if ok {
            "<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\"><title>ReChat</title></head><body style=\"background:#0d1117;color:#e6edf3;font-family:Tahoma,sans-serif;text-align:center;padding-top:80px\"><h1>اتصال انجام شد ✓</h1><p>به برنامه‌ی ReChat برگردید؛ چت خودکار وصل می‌شود.</p><p>Connected — return to ReChat.</p></body></html>"
        } else {
            "<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\"><title>ReChat</title></head><body style=\"background:#0d1117;color:#e6edf3;font-family:Tahoma,sans-serif;text-align:center;padding-top:80px\"><h1>اتصال ناموفق بود</h1><p>در ReChat دوباره «اتصال با Kick» را بزنید.</p></body></html>"
        };
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(head.as_bytes()).await;
        let _ = stream.write_all(body.as_bytes()).await;
        return;
    }

    let (status, ctype, body): (&str, &str, Vec<u8>) = match path.as_str() {
        "/api/status" => {
            let chat = hub.status_snapshot().await;
            let goal = goal_hub.snapshot().await;
            let body = serde_json::json!({
                "status": "ok",
                "version": "0.3.15",
                "chat": chat,
                "goal": goal,
            });
            (
                "200 OK",
                "application/json",
                serde_json::to_vec(&body).unwrap_or_default(),
            )
        }
        "/api/goal" => {
            let goal = goal_hub.snapshot().await;
            (
                "200 OK",
                "application/json",
                serde_json::to_vec(&goal).unwrap_or_default(),
            )
        }
        "/chat" | "/goal" => {
            let file = if path == "/chat" {
                dist.join("chat.html")
            } else {
                dist.join("goal.html")
            };
            let (status, ctype, body) = serve(&file).await;
            if status != "200 OK" {
                (status, ctype, body)
            } else {
                let themes = store.themes.read().await;
                let css = themes.css(profile.as_deref());
                let max = themes.max_messages(profile.as_deref());
                let mut extra = format!("<style>\n{css}\n</style>");
                if path == "/chat" {
                    extra.push_str(&format!(
                        "<script>window.RECHAT_MAX_MESSAGES={max};</script>"
                    ));
                }
                ("200 OK", ctype, inject_head(&body, &extra))
            }
        }
        p if p.starts_with("/assets/") => {
            // 0.3.3: in a flattened install the asset files sit at the
            // dist root, not under assets/ — try the nested path first,
            // then the flat one, so both layouts serve.
            let nested = dist.join(p.trim_start_matches('/'));
            if nested.exists() {
                serve(&nested).await
            } else {
                let name = p.rsplit('/').next().unwrap_or("");
                serve(&dist.join(name)).await
            }
        }
        _ => (
            "404 Not Found",
            "text/plain",
            b"ReChat overlay server: use /chat or /goal".to_vec(),
        ),
    };
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(&body).await;
}

async fn serve(file: &PathBuf) -> (&'static str, &'static str, Vec<u8>) {
    match tokio::fs::read(file).await {
        Ok(bytes) => ("200 OK", mime(file), bytes),
        Err(_) => (
            "404 Not Found",
            "text/plain",
            b"overlay file not found (frontend files missing from this install)".to_vec(),
        ),
    }
}

/// Run the server forever on loopback. Called from the Tauri setup hook.
pub async fn run(
    dist: PathBuf,
    hub: Arc<ChatHub>,
    goal_hub: Arc<GoalHub>,
    store: Arc<ThemeStore>,
    auth: Arc<KickAuthState>,
) {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let Ok(listener) = TcpListener::bind(addr).await else {
        return;
    };
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let dist = dist.clone();
        let hub = hub.clone();
        let goal_hub = goal_hub.clone();
        let store = store.clone();
        let auth = auth.clone();
        tokio::spawn(handle(stream, dist, hub, goal_hub, store, auth));
    }
}
