//! TeleLivee chat source (0.3.10).
//!
//! Why this exists: TeleLivee (telelivee.ir) is another Iranian
//! streaming service like MasterStream, and Taha asked for its OBS
//! overlay link to work as a chat source too. Its overlay page loads
//! with no login and its chat comes from a separate chat host — the
//! protocol is pinned from the overlay page's own JS (fetched live
//! 2026-11-07) and proven end-to-end with a live polling session
//! the same day (open -> "40" -> joined event -> tl_client ping ->
//! server "pong"):
//!
//!   Overlay page: https://telelivee.ir/obs-overlay/?key=<base64
//!     {"t":"OBS_<32 hex>","o":"chat","v":2}>, which embeds
//!     window.__TL_OVL_STYLE = {token, appUrl, channelId, pollMs}.
//!   Socket.IO, host = https://chat.telelivee.ir, path = /socket.io,
//!   EIO=4. Handshake query: overlay=1&channel=<channelId>.
//!   Client sends '40' (namespace connect); keepalive is
//!   42["tl_client",{"type":"ping"}] every 25s; server answers
//!   42["tl",{"type":"pong"}].
//!   Chat arrives as event 'tl' with payload:
//!     {channel_id, id, type, message_type
//!      ('chat'|'sub'|'gift_sub'|'tele'),
//!      name_for_overlay|display_name|username, user_id, color,
//!      message, visible_to_user_ids, is_private,
//!      is_private_to_streamer, show_admin_badge, admin_keep_profile,
//!      created_at}.
//!   The overlay renders 'chat' and 'tele' (a 'tele' message may
//!   carry a "[tlgif:<slug>]" marker, stripped here); 'sub' and
//!   'gift_sub' have no ChatHub equivalent in v1 and are skipped,
//!   like MasterStream's alert events. The 'joined'/'pong' events
//!   carry no author or text and are skipped too.
//!
//! Transport is Socket.IO POLLING (plain HTTP via reqwest), not
//! websocket — and that is deliberate, not a fallback: the chat
//! host's 101 response carries `Connection: close`, and tungstenite
//! strictly requires `Connection: Upgrade` (RFC 6455 step 3), so
//! the websocket transport can never complete its handshake
//! against this server — verified live with curl, both with and
//! without a polling sid. The overlay's own JS also treats polling
//! as a first-class transport (its overlay-ws lists polling first).
//! Polling packets are plain text, one per POST; GET responses
//! carry packets separated by U+001E.
//!
//! The overlay key/token is a bearer token: it is read from the
//! pasted link only to parse the page, NEVER written to any file by
//! the backend and NEVER committed. The chat connection needs only
//! the channel id (query channel + overlay=1); the token is only
//! used by the overlay's HTTP event-poll fallback, which v1 does
//! not implement.
//!
//! Messages flow into the same ChatHub as Kick/MasterStream, so
//! ReChat themes, filters, preview and overlays apply unchanged.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use crate::kick::{ChatEvent, ChatHub, ChatMessage, ChatStatus};

const USER_AGENT: &str = "ReChat/0.3.14";
const LABEL: &str = "TeleLivee";
const POLL_BASE: &str = "https://chat.telelivee.ir/socket.io/";

/// Values parsed out of an overlay page.
struct OverlayConfig {
    channel_id: String,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Long-poll client: the server holds a GET for up to ~12-25s
/// (pingInterval 12000, pingTimeout 25000), so the timeout must be
/// far above the page-fetch one.
fn poll_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())
}

/// Extract `channelId: 15093` (digits after the key) from the page.
fn extract_channel_id(html: &str) -> Option<String> {
    let key = "channelId";
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

/// Fetch the overlay page and parse its channel id.
async fn fetch_overlay_config(link: &str) -> Result<OverlayConfig, String> {
    let link = link.trim();
    if !link.contains("telelivee.ir") {
        return Err("لینک باید لینک اورلی تل‌لایو باشد".to_string());
    }
    let resp = http_client()?
        .get(link)
        .send()
        .await
        .map_err(|_| "صفحه‌ی اورلی تل‌لایو خوانده نشد؛ اینترنت را چک کن".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("صفحه‌ی اورلی جواب نداد ({})", resp.status()));
    }
    let html = resp.text().await.map_err(|_| {
        "صفحه‌ی اورلی تل‌لایو خوانده نشد".to_string()
    })?;
    let channel_id = extract_channel_id(&html).ok_or(
        "شناسه‌ی کانال در صفحه‌ی اورلی پیدا نشد؛ لینک کامل اورلی را کپی کن",
    )?;
    Ok(OverlayConfig { channel_id })
}

fn poll_url(channel_id: &str, sid: Option<&str>) -> String {
    match sid {
        Some(s) => format!(
            "{POLL_BASE}?EIO=4&transport=polling&overlay=1&channel={channel_id}&sid={s}"
        ),
        None => format!("{POLL_BASE}?EIO=4&transport=polling&overlay=1&channel={channel_id}"),
    }
}

/// Open a polling session: GET without sid, read the sid out of the
/// Engine.IO open packet ("0{...sid...}").
async fn open_session(client: &reqwest::Client, channel_id: &str) -> Result<String, String> {
    let body = client
        .get(poll_url(channel_id, None))
        .send()
        .await
        .map_err(|_| "نشست تل‌لایو باز نشد؛ اینترنت را چک کن".to_string())?
        .error_for_status()
        .map_err(|e| format!("نشست تل‌لایو باز نشد ({e})"))?
        .text()
        .await
        .map_err(|_| "نشست تل‌لایو باز نشد".to_string())?;
    for part in body.split('\u{1e}') {
        if let Some(json) = part.strip_prefix('0') {
            if let Ok(v) = serde_json::from_str::<Value>(json) {
                if let Some(sid) = v.get("sid").and_then(|s| s.as_str()) {
                    if !sid.is_empty() {
                        return Ok(sid.to_string());
                    }
                }
            }
        }
    }
    Err("نشست تل‌لایو باز نشد؛ کمی بعد دوباره امتحان کن".to_string())
}

/// POST one Engine.IO packet ("40", "3", `42[...]`). The server
/// answers 200 "ok".
async fn post_packet(
    client: &reqwest::Client,
    channel_id: &str,
    sid: &str,
    packet: &str,
) -> Result<(), String> {
    client
        .post(poll_url(channel_id, Some(sid)))
        .header("Content-Type", "text/plain;charset=UTF-8")
        .body(packet.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Long-poll GET: returns the packets the server has for us
/// (U+001E-separated; usually one per round: a "2" ping, a "40"
/// connect ack, or "42[...]" events).
async fn get_packets(
    client: &reqwest::Client,
    channel_id: &str,
    sid: &str,
) -> Result<Vec<String>, String> {
    let body = client
        .get(poll_url(channel_id, Some(sid)))
        .timeout(Duration::from_secs(45))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(body
        .split('\u{1e}')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect())
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

fn num_field(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

/// Map a TeleLivee 'tl' payload to a ReChat chat message.
/// Returns None for non-chat types and for messages without a usable
/// author or text. Mirrors the overlay's own visibility filters.
fn parse_message(payload: &Value, channel_id: &str, fallback_id: &str) -> Option<ChatMessage> {
    // Session events ('joined', 'pong', ...) carry no chat text.
    if let Some(t) = payload.get("type").and_then(|x| x.as_str()) {
        if t == "joined" || t == "pong" {
            return None;
        }
    }
    // A message for another channel never belongs here.
    if let Some(cid) = payload.get("channel_id") {
        let cid = value_to_id(cid);
        if !cid.is_empty() && cid != channel_id {
            return None;
        }
    }
    // The overlay hides these; so do we.
    if let Some(list) = payload.get("visible_to_user_ids").and_then(|x| x.as_array()) {
        if !list.is_empty() {
            return None;
        }
    }
    if num_field(payload, "is_private") != 0
        || num_field(payload, "is_private_to_streamer") != 0
    {
        return None;
    }
    if num_field(payload, "show_admin_badge") == 1 && num_field(payload, "admin_keep_profile") != 1
    {
        return None;
    }
    let mtype = payload
        .get("message_type")
        .and_then(|x| x.as_str())
        .unwrap_or("chat");
    // v1: chat + tele (text-bearing). sub/gift_sub have no ChatHub
    // equivalent and are skipped, like MasterStream's alerts.
    if mtype != "chat" && mtype != "tele" {
        return None;
    }
    let username = [
        str_field(payload, "name_for_overlay"),
        str_field(payload, "display_name"),
        str_field(payload, "username"),
    ]
    .into_iter()
    .find(|s| !s.is_empty())
    .unwrap_or_default();
    if username.is_empty() {
        return None;
    }
    let color_raw = str_field(payload, "color");
    let color = if color_raw.starts_with('#') {
        Some(color_raw)
    } else {
        None
    };
    let mut content = str_field(payload, "message");
    if mtype == "tele" {
        // Strip the "[tlgif:<slug>]" marker the overlay renders as a
        // separate GIF; ReChat shows the text only.
        if let Some(start) = content.find("[tlgif:") {
            if let Some(end) = content[start..].find(']') {
                let end = start + end + 1;
                let mut stripped = content[..start].to_string();
                stripped.push_str(content[end..].trim_start());
                content = stripped.trim().to_string();
            }
        }
    }
    if content.trim().is_empty() {
        return None;
    }
    let id = value_to_id(payload.get("id").unwrap_or(&Value::Null));
    let id = if id.is_empty() {
        fallback_id.to_string()
    } else {
        id
    };
    let created_at = match payload.get("created_at").or_else(|| payload.get("timestamp")) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    Some(ChatMessage {
        id,
        username,
        color,
        badges: Vec::new(),
        content,
        created_at,
    })
}

/// Spawn the TeleLivee loop for the hub's current generation.
/// The caller (Tauri command) bumps the generation first via
/// `disconnect()`, so any older chat loop exits.
pub fn spawn_telelivee_loop(hub: Arc<ChatHub>, link: String) {
    let gen = hub.generation();
    tokio::spawn(run_telelivee_loop(hub, link, gen));
}

async fn run_telelivee_loop(hub: Arc<ChatHub>, link: String, gen: u64) {
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
        // Re-fetch the overlay page on every attempt: the channel id
        // is read from the page itself, never hardcoded or guessed.
        let cfg = match fetch_overlay_config(&link).await {
            Ok(c) => c,
            Err(e) => {
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
        let client = match poll_client() {
            Ok(c) => c,
            Err(e) => {
                hub.set_status(ChatStatus {
                    state: "reconnecting".to_string(),
                    channel: Some(LABEL.to_string()),
                    detail: Some(format!("اتصال به تل‌لایو ناموفق: {e}")),
                })
                .await;
                attempt += 1;
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
                continue;
            }
        };
        let sid = match open_session(&client, &cfg.channel_id).await {
            Ok(s) => s,
            Err(e) => {
                hub.set_status(ChatStatus {
                    state: "reconnecting".to_string(),
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
        // Socket.IO namespace connect.
        if post_packet(&client, &cfg.channel_id, &sid, "40")
            .await
            .is_err()
        {
            attempt += 1;
            tokio::time::sleep(backoff).await;
            backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
            continue;
        }
        // The overlay's keepalive: tl_client ping every 25s, only
        // once the server has answered the namespace connect ("40").
        let mut ns_connected = false;
        let mut ping_interval = tokio::time::interval(Duration::from_secs(25));
        // In-flight long-poll GET, recreated after every round.
        let mut poll_fut = Box::pin(get_packets(&client, &cfg.channel_id, &sid));
        let disconnected = loop {
            tokio::select! {
                _ = ping_interval.tick() => {
                    if ns_connected {
                        let ping = serde_json::json!(["tl_client", {"type": "ping"}]);
                        if post_packet(&client, &cfg.channel_id, &sid, &format!("42{ping}")).await.is_err() {
                            break true;
                        }
                    }
                }
                res = &mut poll_fut => {
                    match res {
                        Ok(packets) => {
                            let mut reconnect = false;
                            for packet in packets {
                                // Engine.IO packets.
                                if packet == "2" {
                                    // Server ping -> pong.
                                    if post_packet(&client, &cfg.channel_id, &sid, "3").await.is_err() {
                                        reconnect = true;
                                        break;
                                    }
                                    continue;
                                }
                                if packet.starts_with('0') || packet == "3" {
                                    // Open / pong: nothing to do.
                                    continue;
                                }
                                if packet.starts_with("40") {
                                    // Server namespace connect: chat is live.
                                    ns_connected = true;
                                    attempt = 0;
                                    backoff = Duration::from_secs(1);
                                    hub.set_status(ChatStatus {
                                        state: "connected".to_string(),
                                        channel: Some(LABEL.to_string()),
                                        detail: None,
                                    }).await;
                                    continue;
                                }
                                if packet == "41" {
                                    // Server namespace disconnect.
                                    reconnect = true;
                                    break;
                                }
                                let Some(json) = packet.strip_prefix("42") else {
                                    continue;
                                };
                                let Ok(arr) = serde_json::from_str::<Value>(json) else {
                                    continue;
                                };
                                let Some(arr) = arr.as_array() else { continue };
                                let event = arr.first().and_then(|e| e.as_str()).unwrap_or("").to_string();
                                let payload = arr.get(1).cloned().unwrap_or(Value::Null);
                                if event == "tl" {
                                    msg_counter += 1;
                                    let fallback = format!("tl-{msg_counter}");
                                    if let Some(m) = parse_message(&payload, &cfg.channel_id, &fallback) {
                                        if !hub.blocks(&m).await {
                                            hub.emit(ChatEvent::Message(m));
                                        }
                                    }
                                }
                                // Any other event is ignored.
                            }
                            if reconnect {
                                break true;
                            }
                            if hub.generation() != gen {
                                return;
                            }
                            poll_fut = Box::pin(get_packets(&client, &cfg.channel_id, &sid));
                        }
                        Err(_) => break true,
                    }
                }
            }
            if hub.generation() != gen {
                return;
            }
        };
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
