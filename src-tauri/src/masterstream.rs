//! MasterStream chat source (M9.5).
//!
//! Why this exists: a direct Kick connection is not reachable from Iran
//! without DNS/VPN, but MasterStream's own server connects to Kick and
//! serves the same chat through its widget. ReChat talks only to
//! masterstream.ir; the widget's Socket.IO protocol (pinned from the
//! widget page's own JS, which Taha sent on 2026-11-04) is:
//!
//!   Socket.IO, host = chat_service_url, path = chat_service_path,
//!   transports websocket then polling, EIO=4.
//!   Server emits 'welcome' -> client emits 'login'
//!     {user_id, username, chat_key, websites}.
//!   Server replies 'login_status' {status: 'success'} -> authenticated.
//!   Client sends 'client_time_update' {timestamp} every 10s;
//!   server replies 'server_time_updated' {status: true}.
//!   Chat arrives as event 'message' with payload:
//!     {id, type, platform|service, category,
//!      author{username, display_name, avatar, color,
//!             roles{broadcaster,admin,founder,moderator,vip,subscriber,
//!                   sub_gifter,verified,first_time}},
//!      content{raw, html},
//!      meta{badges[{local_url|url, name, type}], ...},
//!      reply_to, timestamp}.
//!   Deletions: 'delete_message' {id}, 'delete_user_messages'
//!   {username, platform}, 'chat_clear' {platform}.
//!   'disconnect_reason' {reason: 'authorization'} means the widget
//!   key/subscription is no longer valid: stop, do not loop.
//!
//! The login values are NOT guessed and NOT stored in the repo: the
//! backend fetches the pasted widget page (it loads with no login) and
//! parses the page's own PHP-provided runtime values
//! (socket_user_id / socket_username / socket_chat_key /
//! enabled_websites / chat_service_url / chat_service_path) from it.
//! The widget link itself is kept only in the app's localStorage on
//! the user's machine, never written to any file by the backend.
//!
//! Transport is plain tungstenite (already a dependency): Engine.IO
//! packets ("0" open, "2" ping -> "3" pong, "4" + Socket.IO packet)
//! and Socket.IO packets ("40" connect, "42" [event, payload]).
//! Only chat messages (type "message") are mapped in v1; alert events
//! (follow/subscribe/raid/...) and delete-by-user/chat-clear have no
//! ChatHub equivalent yet and are skipped, not guessed into text.
//!
//! Messages flow into the same ChatHub as Kick, so ReChat themes,
//! filters, preview and overlays apply unchanged.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

use crate::kick::{Badge, ChatEvent, ChatHub, ChatMessage, ChatStatus};

const USER_AGENT: &str = "ReChat/0.3.15";
const LABEL: &str = "MasterStream";

/// Login values parsed out of a widget page.
struct WidgetConfig {
    user_id: String,
    username: String,
    chat_key: String,
    websites: Vec<String>,
    service_url: String,
    service_path: String,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Extract `window.<key> = "..."` (or the first quoted string after
/// the key). HTML escapes `/` as `\/` in these values; unescape it.
fn extract_string(html: &str, key: &str) -> Option<String> {
    let pos = html.find(key)?;
    let rest = &html[pos + key.len()..];
    let start = rest.find('"')?;
    let rest = &rest[start + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].replace("\\/", "/"))
}

/// Extract `window.socket_user_id = 15650;` (digits after the key).
fn extract_user_id(html: &str) -> Option<String> {
    let key = "window.socket_user_id";
    let pos = html.find(key)?;
    let rest = &html[pos + key.len()..];
    let mut digits = String::new();
    let mut started = false;
    for c in rest.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            started = true;
        } else if started {
            break;
        }
    }
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

/// Extract `window.enabled_websites = ["kick", ...];` (quoted items).
fn extract_websites(html: &str) -> Vec<String> {
    let key = "window.enabled_websites";
    let Some(pos) = html.find(key) else {
        return Vec::new();
    };
    let rest = &html[pos + key.len()..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let rest = &rest[open + 1..];
    let Some(close) = rest.find(']') else {
        return Vec::new();
    };
    let inner = &rest[..close];
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    for c in inner.chars() {
        if c == '"' {
            if in_quote {
                if !cur.is_empty() {
                    out.push(cur.clone());
                }
                cur.clear();
            }
            in_quote = !in_quote;
        } else if in_quote {
            cur.push(c);
        }
    }
    out
}

/// Fetch the widget page and parse its login values.
async fn fetch_widget_config(link: &str) -> Result<WidgetConfig, String> {
    let link = link.trim();
    // 0.3.10: mstream.ir is MasterStream's short domain — same widget,
    // same key, only the host differs. Accept both hosts.
    if !link.contains("masterstream.ir") && !link.contains("mstream.ir") {
        return Err("لینک باید لینک ویجت مستراستریم باشد".to_string());
    }
    let resp = http_client()?
        .get(link)
        .send()
        .await
        .map_err(|_| "صفحه‌ی ویجت مستراستریم خوانده نشد؛ اینترنت را چک کن".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("صفحه‌ی ویجت جواب نداد ({})", resp.status()));
    }
    let html = resp.text().await.map_err(|_| {
        "صفحه‌ی ویجت مستراستریم خوانده نشد".to_string()
    })?;
    // 0.3.8: MasterStream now answers a dead widget link with its own
    // "آدرس وارد شده صحیح نیست" page (verified live 2026-11-07: the
    // 2026-11-04 link returns this 1.4 KB error page, with and without
    // its query string). Say so plainly instead of the generic
    // "values not found" text: no retry can heal a dead link.
    if html.contains("آدرس وارد شده صحیح نیست") {
        return Err("این لینک ویجت مستراستریم دیگر معتبر نیست؛ از داشبورد مستراستریم یک لینک تازه‌ی ویجت چت بگیر و جایگزین کن".to_string());
    }
    let user_id = extract_user_id(&html)
        .ok_or("مقادیر لاگین ویجت در صفحه پیدا نشد؛ لینک کامل ویجت را کپی کن")?;
    let chat_key = extract_string(&html, "window.socket_chat_key")
        .filter(|s| !s.is_empty())
        .ok_or("کلید چت ویجت در صفحه پیدا نشد؛ لینک کامل ویجت را کپی کن")?;
    let username = extract_string(&html, "window.socket_username").unwrap_or_default();
    let websites = extract_websites(&html);
    let service_url = extract_string(&html, "window.chat_service_url")
        .unwrap_or_else(|| "https://masterstream.ir".to_string());
    let service_path = extract_string(&html, "window.chat_service_path")
        .unwrap_or_else(|| "/chat_service/server".to_string());
    Ok(WidgetConfig {
        user_id,
        username,
        chat_key,
        websites,
        service_url,
        service_path,
    })
}

/// WebSocket handshake request matching the browser widget: the same
/// Origin the widget page's own socket.io client sends. A bare
/// tungstenite handshake sends no Origin at all. The Origin is the
/// socket's own origin, so it stays right whether the widget lives on
/// masterstream.ir or mstream.ir.
///
/// 0.3.10: tungstenite's generate_request requires a caller-built
/// Request to carry ALL five handshake headers itself — it extracts
/// the Sec-WebSocket-Key from the request instead of generating one,
/// and a missing header fails the handshake before any network I/O.
/// The 0.3.8/0.3.9 request sent Origin + User-Agent only, so the
/// MasterStream connect failed at once with InvalidHeader
/// ("sec-websocket-key") and the app sat on "reconnecting" forever —
/// the 0.3.9 live test used the URL form (which auto-generates the
/// key) and never covered this path. The TeleLivee test caught it.
///
/// Shared since 0.3.12: the Donofa goal socket (goal.rs) builds its
/// handshake with the same helper.
pub(crate) fn ws_request(url: &str, user_agent: &str) -> Result<http::Request<()>, String> {
    let authority = url
        .strip_prefix("wss://")
        .or_else(|| url.strip_prefix("ws://"))
        .unwrap_or(url)
        .split(['/', '?'])
        .next()
        .unwrap_or("");
    let origin = format!("https://{authority}");
    http::Request::builder()
        .uri(url)
        .header("Host", authority)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .header("Origin", origin)
        .header("User-Agent", user_agent)
        .body(())
        .map_err(|e| e.to_string())
}

/// Build the websocket URL the Socket.IO JS client would use:
/// `<service_url><service_path>/?EIO=4&transport=websocket`, with the
/// http(s) scheme converted to ws(s).
fn socket_url(cfg: &WidgetConfig) -> String {
    let mut base = cfg.service_url.trim_end_matches('/').to_string();
    if let Some(rest) = base.strip_prefix("https://") {
        base = format!("wss://{rest}");
    } else if let Some(rest) = base.strip_prefix("http://") {
        base = format!("ws://{rest}");
    } else if !base.starts_with("ws") {
        base = format!("wss://{base}");
    }
    let path = cfg.service_path.trim_end_matches('/');
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("{base}{path}/?EIO=4&transport=websocket")
}

fn value_to_id(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// Map a MasterStream 'message' payload to a ReChat chat message.
/// Returns None for messages without a usable author or text.
fn parse_message(payload: &Value, fallback_id: &str) -> Option<ChatMessage> {
    let author = payload.get("author")?;
    let username = str_field(author, "username");
    if username.is_empty() {
        return None;
    }
    let display = str_field(author, "display_name");
    let display = if display.is_empty() {
        username.clone()
    } else {
        display
    };
    let color_raw = str_field(author, "color");
    let color = if color_raw.starts_with('#') {
        Some(color_raw)
    } else {
        None
    };
    let mut badges: Vec<Badge> = Vec::new();
    if let Some(roles) = author.get("roles").and_then(|r| r.as_object()) {
        // Overlay badge labels exist for exactly these kinds.
        for kind in [
            "broadcaster",
            "moderator",
            "vip",
            "subscriber",
            "founder",
            "verified",
            "sub_gifter",
        ] {
            if roles.get(kind).and_then(|x| x.as_bool()) == Some(true) {
                badges.push(Badge {
                    kind: kind.to_string(),
                    text: String::new(),
                    image: None,
                });
            }
        }
    }
    // Custom badges from the widget (artwork URLs, if absolute).
    if let Some(list) = payload
        .get("meta")
        .and_then(|m| m.get("badges"))
        .and_then(|b| b.as_array())
    {
        for b in list {
            let image = b
                .get("local_url")
                .and_then(|x| x.as_str())
                .or_else(|| b.get("url").and_then(|x| x.as_str()))
                .filter(|s| s.starts_with("http"))
                .map(|s| s.to_string());
            let kind = str_field(b, "type");
            let kind = if kind.is_empty() {
                "badge".to_string()
            } else {
                kind
            };
            let text = str_field(b, "name");
            if image.is_some() || !text.is_empty() {
                badges.push(Badge { kind, text, image });
            }
        }
    }
    // Content: raw text only. content.html is pre-rendered widget HTML
    // and must not reach the overlay (it would be escaped, not rendered).
    let content = match payload.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(obj) => str_field(obj, "raw"),
        None => String::new(),
    };
    if content.trim().is_empty() {
        return None;
    }
    let id = value_to_id(payload.get("id").unwrap_or(&Value::Null));
    let id = if id.is_empty() {
        fallback_id.to_string()
    } else {
        id
    };
    let created_at = match payload.get("timestamp") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    Some(ChatMessage {
        id,
        username: display,
        color,
        badges,
        content,
        created_at,
    })
}

/// Spawn the MasterStream loop for the hub's current generation.
/// The caller (Tauri command) bumps the generation first via
/// `disconnect()`, so any older Kick/MasterStream loop exits.
pub fn spawn_masterstream_loop(hub: Arc<ChatHub>, link: String) {
    let gen = hub.generation();
    tokio::spawn(run_masterstream_loop(hub, link, gen));
}

async fn run_masterstream_loop(hub: Arc<ChatHub>, link: String, gen: u64) {
    let mut attempt: u32 = 0;
    let mut backoff = Duration::from_secs(1);
    let mut msg_counter: u64 = 0;
    loop {
        if hub.generation() != gen {
            return;
        }
        if attempt == 0 {
            hub.set_status(ChatStatus {
                state: "resolving".to_string(),
                channel: Some(LABEL.to_string()),
                detail: None,
            })
            .await;
        }
        // Re-fetch the widget page on every attempt: login values are
        // read from the page itself, never hardcoded or guessed.
        let cfg = match fetch_widget_config(&link).await {
            Ok(c) => c,
            Err(e) => {
                // A dead widget link never heals by retrying: show the
                // error once and stop instead of looping forever.
                if e.contains("دیگر معتبر نیست") {
                    hub.set_status(ChatStatus {
                        state: "error".to_string(),
                        channel: Some(LABEL.to_string()),
                        detail: Some(e),
                    })
                    .await;
                    return;
                }
                hub.set_status(ChatStatus {
                    state: "error".to_string(),
                    channel: Some(LABEL.to_string()),
                    detail: Some(e),
                })
                .await;
                attempt += 1;
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
                continue;
            }
        };
        hub.set_status(ChatStatus {
            state: "connecting".to_string(),
            channel: Some(LABEL.to_string()),
            detail: None,
        })
        .await;
        let url = socket_url(&cfg);
        let req = match ws_request(&url, USER_AGENT) {
            Ok(r) => r,
            Err(e) => {
                hub.set_status(ChatStatus {
                    state: "reconnecting".to_string(),
                    channel: Some(LABEL.to_string()),
                    detail: Some(format!("اتصال به مستراستریم ناموفق: {e}")),
                })
                .await;
                attempt += 1;
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
                continue;
            }
        };
        let ws = match connect_async(req).await {
            Ok((s, _)) => s,
            Err(e) => {
                hub.set_status(ChatStatus {
                    state: "reconnecting".to_string(),
                    channel: Some(LABEL.to_string()),
                    detail: Some(format!("اتصال به مستراستریم ناموفق: {e}")),
                })
                .await;
                attempt += 1;
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
                continue;
            }
        };
        let (mut sink, mut stream) = ws.split();
        // Socket.IO connect for the default namespace.
        if sink.send(WsMessage::Text("40".into())).await.is_err() {
            continue;
        }
        let mut authenticated = false;
        let mut ping_interval = tokio::time::interval(Duration::from_secs(10));
        let mut stop_entirely = false;
        // Read loop: select between the 10s application ping (the
        // widget's client_time_update) and incoming socket frames.
        let disconnected = loop {
            tokio::select! {
                _ = ping_interval.tick() => {
                    if authenticated {
                        let ping = serde_json::json!(["client_time_update", {"timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)}]);
                        if sink.send(WsMessage::Text(format!("42{ping}").into())).await.is_err() {
                            break true;
                        }
                    }
                }
                msg = stream.next() => {
                    match msg {
                        Some(Ok(WsMessage::Text(text))) => {
                            let text = text.to_string();
                            // Engine.IO packets.
                            if text == "2" {
                                // Server ping -> pong.
                                if sink.send(WsMessage::Text("3".into())).await.is_err() {
                                    break true;
                                }
                                continue;
                            }
                            if text.starts_with('0') || text == "3" {
                                // Open / pong: nothing to do.
                                continue;
                            }
                            let Some(packet) = text.strip_prefix("42") else {
                                if text == "41" {
                                    // Server namespace disconnect.
                                    break true;
                                }
                                continue;
                            };
                            let Ok(arr) = serde_json::from_str::<Value>(packet) else {
                                continue;
                            };
                            let Some(arr) = arr.as_array() else { continue };
                            let event = arr.first().and_then(|e| e.as_str()).unwrap_or("").to_string();
                            let payload = arr.get(1).cloned().unwrap_or(Value::Null);
                            match event.as_str() {
                                "welcome" => {
                                    let user_id: Value = cfg.user_id.parse::<u64>().map(Value::from).unwrap_or_else(|_| Value::String(cfg.user_id.clone()));
                                    let login = serde_json::json!(["login", {
                                        "user_id": user_id,
                                        "username": cfg.username,
                                        "chat_key": cfg.chat_key,
                                        "websites": cfg.websites,
                                    }]);
                                    if sink.send(WsMessage::Text(format!("42{login}").into())).await.is_err() {
                                        break true;
                                    }
                                }
                                "login_status" => {
                                    if payload.get("status").and_then(|s| s.as_str()) == Some("success") {
                                        authenticated = true;
                                        attempt = 0;
                                        backoff = Duration::from_secs(1);
                                        hub.set_status(ChatStatus {
                                            state: "connected".to_string(),
                                            channel: Some(LABEL.to_string()),
                                            detail: None,
                                        }).await;
                                    } else {
                                        hub.set_status(ChatStatus {
                                            state: "error".to_string(),
                                            channel: Some(LABEL.to_string()),
                                            detail: Some("ورود به ویجت مستراستریم رد شد؛ لینک ویجت را چک کن".to_string()),
                                        }).await;
                                        stop_entirely = true;
                                        break false;
                                    }
                                }
                                "disconnect_reason" => {
                                    if payload.get("reason").and_then(|r| r.as_str()) == Some("authorization") {
                                        hub.set_status(ChatStatus {
                                            state: "error".to_string(),
                                            channel: Some(LABEL.to_string()),
                                            detail: Some("دسترسی ویجت مستراستریم دیگر معتبر نیست؛ لینک تازه از داشبورد بگیر".to_string()),
                                        }).await;
                                        stop_entirely = true;
                                        break false;
                                    }
                                    break true;
                                }
                                "server_time_updated" => {}
                                "message" => {
                                    if !authenticated {
                                        continue;
                                    }
                                    let ptype = payload.get("type").and_then(|t| t.as_str()).unwrap_or_else(|| payload.get("event").and_then(|t| t.as_str()).unwrap_or(""));
                                    if ptype != "message" {
                                        // Alert events (follow/subscribe/raid/...)
                                        // have no ChatHub equivalent in v1.
                                        continue;
                                    }
                                    let platform = payload.get("platform").and_then(|p| p.as_str()).unwrap_or_else(|| payload.get("service").and_then(|p| p.as_str()).unwrap_or(""));
                                    if !cfg.websites.is_empty() && !platform.is_empty() && !cfg.websites.iter().any(|w| w == platform) {
                                        continue;
                                    }
                                    msg_counter += 1;
                                    let fallback = format!("ms-{msg_counter}");
                                    if let Some(m) = parse_message(&payload, &fallback) {
                                        if !hub.blocks(&m).await {
                                            hub.emit(ChatEvent::Message(m));
                                        }
                                    }
                                }
                                "delete_message" => {
                                    let id = value_to_id(payload.get("id").unwrap_or(&Value::Null));
                                    let id = if id.is_empty() {
                                        payload.get("message").map(|inner| value_to_id(inner.get("id").unwrap_or(&Value::Null))).unwrap_or_default()
                                    } else { id };
                                    if !id.is_empty() {
                                        hub.emit(ChatEvent::Deleted { id });
                                    }
                                }
                                _ => {}
                            }
                        }
                        Some(Ok(WsMessage::Ping(payload))) => {
                            if sink.send(WsMessage::Pong(payload)).await.is_err() {
                                break true;
                            }
                        }
                        Some(Ok(WsMessage::Close(_))) => break true,
                        Some(Ok(_)) => {}
                        Some(Err(_)) | None => break true,
                    }
                }
            }
            if hub.generation() != gen {
                return;
            }
        };
        if stop_entirely || hub.generation() != gen {
            return;
        }
        let _ = disconnected;
        attempt += 1;
        hub.set_status(ChatStatus {
            state: "reconnecting".to_string(),
            channel: Some(LABEL.to_string()),
            detail: Some(format!("تلاش {attempt}")),
        })
        .await;
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
    }
}
