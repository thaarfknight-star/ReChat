//! Kick live chat (M2).
//!
//! Transport: the same Pusher WebSocket Kick's own website uses.
//! No public official Kick chat socket exists, and no login is needed:
//! public channels only.
//!
//! Connection recipe (pinned live 2026-11-04, see M2 notes):
//!   1. Slug -> ids:  GET https://kick.com/api/v2/channels/{slug}
//!      (no auth) -> `id` (channel id) + `chatroom.id`.
//!   2. Pusher credentials per channel:
//!      POST https://web.kick.com/api/v1/realtime/channels/{channel_id}/chat/connection
//!      body {"client":{"id":"rechat","type":"web"},
//!            "capabilities":{"accepted_providers":[{"provider":"pusher"}]}}
//!      -> data.connections[] -> provider "pusher" -> credentials{app_key, cluster}.
//!      Kick rotates the app key (it changed in Oct 2026), so the key is
//!      NEVER hardcoded as the primary source. The old public web key is
//!      kept only as a fallback when the endpoint itself fails.
//!   3. WS: wss://ws-{cluster}.pusher.com/app/{key}?protocol=7&client=js
//!      -> subscribe `chatrooms.{chatroom_id}.v2`
//!      -> events: `App\Events\ChatMessageEvent`, `MessageDeletedEvent`,
//!         `PinnedMessageCreatedEvent`, `PinnedMessageDeletedEvent`.
//!      Pusher data is a JSON string; ping every ~35s of silence
//!      (activity_timeout is 120s). Reconnect with backoff 1s..30s and
//!      re-fetch credentials on every attempt (keys rotate).
//!
//! Message shape (tolerant parse: every field defaulted, unknown fields
//! ignored, so payload drift never breaks the overlay):
//!   sender.username, sender.identity.username_color,
//!   sender.identity.badges[] {type, text}, badges_v2[] (artwork URLs),
//!   content with `[emote:ID:NAME]` syntax (rendered by the overlay page),
//!   id (string or number), created_at.

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::{broadcast, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

const USER_AGENT: &str = "ReChat/0.3.2";
const FALLBACK_PUSHER_KEY: &str = "34bf7a0ff419a2a775b9";
const FALLBACK_CLUSTER: &str = "us2";

/// One badge on a chatter (moderator, VIP, subscriber, ...).
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Badge {
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// One chat message, ready for the overlay.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub badges: Vec<Badge>,
    pub content: String,
    #[serde(default)]
    pub created_at: String,
}

/// User filters (M2): hide `!commands`, users, bots, words.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Filters {
    #[serde(default)]
    pub hide_commands: bool,
    #[serde(default)]
    pub hidden_users: Vec<String>,
    #[serde(default)]
    pub hidden_words: Vec<String>,
    #[serde(default)]
    pub hidden_bots: Vec<String>,
}

impl Filters {
    /// True when this message must NOT reach the overlay.
    pub fn blocks(&self, m: &ChatMessage) -> bool {
        let user = m.username.to_lowercase();
        if self.hidden_users.iter().any(|u| u.to_lowercase() == user) {
            return true;
        }
        if self.hidden_bots.iter().any(|u| u.to_lowercase() == user) {
            return true;
        }
        if self.hide_commands && m.content.trim_start().starts_with('!') {
            return true;
        }
        let c = m.content.to_lowercase();
        self.hidden_words
            .iter()
            .any(|w| !w.trim().is_empty() && c.contains(&w.to_lowercase()))
    }
}

/// Connection state, shared with the settings window and overlays.
#[derive(Clone, Debug, Serialize)]
pub struct ChatStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ChatStatus {
    fn new(state: &str, channel: Option<String>, detail: Option<String>) -> Self {
        ChatStatus {
            state: state.to_string(),
            channel,
            detail,
        }
    }
}

/// Everything the overlay stream carries.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChatEvent {
    Message(ChatMessage),
    Deleted { id: String },
    Pinned(ChatMessage),
    Unpinned { id: String },
    Status(ChatStatus),
}

/// Shared chat hub: one WS connection, many overlay subscribers.
pub struct ChatHub {
    tx: broadcast::Sender<ChatEvent>,
    status: RwLock<ChatStatus>,
    filters: RwLock<Filters>,
    gen: AtomicU64,
    channel: RwLock<Option<String>>,
    emitter: RwLock<Option<tauri::AppHandle>>,
}

impl ChatHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        ChatHub {
            tx,
            status: RwLock::new(ChatStatus::new("idle", None, None)),
            filters: RwLock::new(Filters::default()),
            gen: AtomicU64::new(0),
            channel: RwLock::new(None),
            emitter: RwLock::new(None),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ChatEvent> {
        self.tx.subscribe()
    }

    pub async fn set_emitter(&self, app: tauri::AppHandle) {
        *self.emitter.write().await = Some(app);
    }

    pub async fn set_status(&self, s: ChatStatus) {
        *self.status.write().await = s.clone();
        let _ = self.tx.send(ChatEvent::Status(s.clone()));
        if let Some(app) = self.emitter.read().await.clone() {
            let _ = app.emit("chat-status", &s);
        }
    }

    pub async fn status_snapshot(&self) -> ChatStatus {
        self.status.read().await.clone()
    }

    pub async fn set_filters(&self, f: Filters) {
        *self.filters.write().await = f;
    }

    pub async fn filters_snapshot(&self) -> Filters {
        self.filters.read().await.clone()
    }

    async fn blocks(&self, m: &ChatMessage) -> bool {
        self.filters.read().await.blocks(m)
    }

    pub fn generation(&self) -> u64 {
        self.gen.load(Ordering::SeqCst)
    }

    /// (Re)connect to a channel. Returns true when a new loop must be
    /// spawned; false when nothing changed (same channel already live),
    /// so the caller never spawns a duplicate loop.
    pub async fn connect(&self, input: String) -> bool {
        let slug = slug_from_input(&input);
        if slug.is_empty() {
            self.set_status(ChatStatus::new(
                "error",
                None,
                Some("نام کانال خالی است".to_string()),
            ))
            .await;
            return false;
        }
        let same = self.channel.read().await.clone() == Some(slug.clone());
        if same {
            let st = self.status_snapshot().await;
            if st.state == "connected" || st.state == "connecting" || st.state == "resolving"
            {
                return false;
            }
        }
        *self.channel.write().await = Some(slug);
        // Bump the generation: any older loop sees the mismatch and exits.
        // The caller spawns the new loop via spawn_loop() right after.
        self.gen.fetch_add(1, Ordering::SeqCst);
        true
    }

    /// Stop the current connection (bumping the generation kills the loop).
    pub async fn disconnect(&self) {
        self.gen.fetch_add(1, Ordering::SeqCst);
        *self.channel.write().await = None;
        self.set_status(ChatStatus::new("idle", None, None)).await;
    }
}

/// Spawn the WS loop for the hub's current generation. The Tauri
/// command layer calls this right after `connect()` bumps the gen.
pub fn spawn_loop(hub: Arc<ChatHub>, input: String) {
    let gen = hub.generation();
    tokio::spawn(run_chat_loop(hub, input, gen));
}

/// Accept `tahaa`, `@tahaa`, `kick.com/tahaa`, full URLs.
pub fn slug_from_input(input: &str) -> String {
    let mut s = input.trim().to_string();
    for prefix in [
        "https://www.kick.com/",
        "http://www.kick.com/",
        "https://kick.com/",
        "http://kick.com/",
        "www.kick.com/",
        "kick.com/",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.to_string();
            break;
        }
    }
    let s = s.trim_start_matches('@');
    s.split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Slug -> (channel id, chatroom id).
async fn resolve_channel(slug: &str) -> Result<(u64, u64), String> {
    let resp = http_client()?
        .get(format!("https://kick.com/api/v2/channels/{slug}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("کانال پیدا نشد ({})", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let channel_id = v
        .get("id")
        .and_then(|x| x.as_u64())
        .ok_or("پاسخ کیک شناسه‌ی کانال ندارد")?;
    let chatroom_id = v
        .get("chatroom")
        .and_then(|c| c.get("id"))
        .and_then(|x| x.as_u64())
        .ok_or("پاسخ کیک شناسه‌ی چت‌روم ندارد")?;
    Ok((channel_id, chatroom_id))
}

/// Per-channel Pusher credentials from Kick's realtime endpoint.
async fn fetch_pusher(channel_id: u64) -> Result<(String, String), String> {
    let body = serde_json::json!({
        "client": {"id": "rechat", "type": "web"},
        "capabilities": {"accepted_providers": [{"provider": "pusher"}]}
    });
    let resp = http_client()?
        .post(format!(
            "https://web.kick.com/api/v1/realtime/channels/{channel_id}/chat/connection"
        ))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("سرویس realtime کیک جواب نداد ({})", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let conns = v
        .get("data")
        .and_then(|d| d.get("connections"))
        .and_then(|c| c.as_array())
        .ok_or("در پاسخ realtime اتصالی نبود")?;
    for c in conns {
        if c.get("provider").and_then(|p| p.as_str()) == Some("pusher") {
            let creds = c.get("credentials").ok_or("credentials در پاسخ نبود")?;
            let key = creds
                .get("app_key")
                .and_then(|k| k.as_str())
                .ok_or("app_key در پاسخ نبود")?;
            let cluster = creds
                .get("cluster")
                .and_then(|k| k.as_str())
                .unwrap_or("us2");
            return Ok((key.to_string(), cluster.to_string()));
        }
    }
    Err("اتصال Pusher در پاسخ realtime نبود".to_string())
}

// ---------- tolerant payload parsing ----------

#[derive(Deserialize, Default)]
struct RawMessage {
    #[serde(default)]
    id: serde_json::Value,
    #[serde(default)]
    content: String,
    #[serde(default)]
    sender: RawSender,
    #[serde(default)]
    created_at: String,
}

#[derive(Deserialize, Default)]
struct RawSender {
    #[serde(default)]
    username: String,
    #[serde(default)]
    identity: RawIdentity,
}

#[derive(Deserialize, Default)]
struct RawIdentity {
    #[serde(default)]
    username_color: Option<String>,
    #[serde(default)]
    badges: Vec<RawBadge>,
    #[serde(default)]
    badges_v2: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
struct RawBadge {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    text: Option<String>,
}

fn value_to_id(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn parse_message(data: &serde_json::Value) -> Option<ChatMessage> {
    let raw: RawMessage = serde_json::from_value(data.clone()).ok()?;
    if raw.sender.username.is_empty() {
        return None;
    }
    let mut badges: Vec<Badge> = raw
        .sender
        .identity
        .badges
        .iter()
        .map(|b| Badge {
            kind: b.r#type.clone(),
            text: b.text.clone().unwrap_or_else(|| b.r#type.clone()),
            image: None,
        })
        .collect();
    // badges_v2: artwork entries, shape varies; take any http string as image.
    for entry in &raw.sender.identity.badges_v2 {
        if let Some(obj) = entry.as_object() {
            let image = ["image", "url", "src", "icon"]
                .iter()
                .find_map(|k| obj.get(*k))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    obj.values().find_map(|v| {
                        v.as_str().filter(|s| s.starts_with("http")).map(|s| s.to_string())
                    })
                });
            let kind = obj
                .get("type")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("name").and_then(|v| v.as_str()))
                .unwrap_or("badge")
                .to_string();
            let text = obj
                .get("text")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("label").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            if image.is_some() || !text.is_empty() {
                badges.push(Badge { kind, text, image });
            }
        }
    }
    Some(ChatMessage {
        id: value_to_id(&raw.id),
        username: raw.sender.username,
        color: raw.sender.identity.username_color,
        badges,
        content: raw.content,
        created_at: raw.created_at,
    })
}

/// Delete/unpin payloads carry the id directly or under `message`.
fn parse_id(data: &serde_json::Value) -> Option<String> {
    let direct = value_to_id(data.get("id").unwrap_or(&serde_json::Value::Null));
    if !direct.is_empty() {
        return Some(direct);
    }
    if let Some(inner) = data.get("message") {
        let id = value_to_id(inner.get("id").unwrap_or(&serde_json::Value::Null));
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
}

/// Pusher `data` is usually a JSON string, sometimes already an object.
fn normalize_data(data: Option<&serde_json::Value>) -> serde_json::Value {
    match data {
        Some(serde_json::Value::String(s)) => {
            serde_json::from_str(s).unwrap_or(serde_json::Value::Null)
        }
        Some(v) => v.clone(),
        None => serde_json::Value::Null,
    }
}

async fn run_chat_loop(hub: Arc<ChatHub>, input: String, gen: u64) {
    let slug = slug_from_input(&input);
    let mut attempt: u32 = 0;
    let mut backoff = Duration::from_secs(1);
    loop {
        if hub.generation() != gen {
            return;
        }
        if attempt == 0 {
            hub.set_status(ChatStatus::new(
                "resolving",
                Some(slug.clone()),
                None,
            ))
            .await;
        }
        // Resolve + credentials (endpoint first, public key as fallback).
        let resolved = resolve_channel(&slug).await;
        let (chatroom_id, key, cluster) = match resolved {
            Ok((channel_id, chatroom_id)) => {
                let (key, cluster) = fetch_pusher(channel_id)
                    .await
                    .unwrap_or((FALLBACK_PUSHER_KEY.to_string(), FALLBACK_CLUSTER.to_string()));
                (chatroom_id, key, cluster)
            }
            Err(e) => {
                hub.set_status(ChatStatus::new(
                    "error",
                    Some(slug.clone()),
                    Some(e),
                ))
                .await;
                attempt += 1;
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
                continue;
            }
        };
        let channel_name = format!("chatrooms.{chatroom_id}.v2");
        hub.set_status(ChatStatus::new(
            "connecting",
            Some(slug.clone()),
            None,
        ))
        .await;
        let url = format!(
            "wss://ws-{cluster}.pusher.com/app/{key}?protocol=7&client=js&version=8.4.0&flash=false"
        );
        let ws = match connect_async(&url).await {
            Ok((s, _)) => s,
            Err(e) => {
                hub.set_status(ChatStatus::new(
                    "reconnecting",
                    Some(slug.clone()),
                    Some(format!("اتصال ناموفق: {e}")),
                ))
                .await;
                attempt += 1;
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
                continue;
            }
        };
        let (mut sink, mut stream) = ws.split();
        let sub = serde_json::json!({
            "event": "pusher:subscribe",
            "data": {"channel": channel_name}
        });
        if sink
            .send(WsMessage::Text(sub.to_string().into()))
            .await
            .is_err()
        {
            continue;
        }
        // Read loop: 35s of silence -> send a ping (activity_timeout 120s).
        let mut announced = false;
        loop {
            match tokio::time::timeout(Duration::from_secs(35), stream.next()).await {
                Ok(Some(Ok(WsMessage::Text(text)))) => {
                    let env: serde_json::Value =
                        match serde_json::from_str(&text) { Ok(v) => v, Err(_) => continue };
                    let event = env
                        .get("event")
                        .and_then(|e| e.as_str())
                        .unwrap_or("")
                        .to_string();
                    let data = normalize_data(env.get("data"));
                    match event.as_str() {
                        "pusher:connection_established" => {}
                        "pusher_internal:subscription_succeeded" => {
                            if !announced {
                                announced = true;
                                attempt = 0;
                                backoff = Duration::from_secs(1);
                                hub.set_status(ChatStatus::new(
                                    "connected",
                                    Some(slug.clone()),
                                    None,
                                ))
                                .await;
                            }
                        }
                        "pusher:ping" => {
                            let _ = sink
                                .send(WsMessage::Text(
                                    r#"{"event":"pusher:pong","data":{}}"#.into(),
                                ))
                                .await;
                        }
                        "pusher:pong" => {}
                        "pusher:error" => break,
                        "App\\Events\\ChatMessageEvent" => {
                            if let Some(m) = parse_message(&data) {
                                if !hub.blocks(&m).await {
                                    let _ = hub.tx.send(ChatEvent::Message(m));
                                }
                            }
                        }
                        "App\\Events\\MessageDeletedEvent" => {
                            if let Some(id) = parse_id(&data) {
                                let _ = hub.tx.send(ChatEvent::Deleted { id });
                            }
                        }
                        "App\\Events\\PinnedMessageCreatedEvent" => {
                            let inner = data
                                .get("message")
                                .cloned()
                                .unwrap_or(data.clone());
                            if let Some(m) = parse_message(&inner) {
                                if !hub.blocks(&m).await {
                                    let _ = hub.tx.send(ChatEvent::Pinned(m));
                                }
                            }
                        }
                        "App\\Events\\PinnedMessageDeletedEvent" => {
                            if let Some(id) = parse_id(&data) {
                                let _ = hub.tx.send(ChatEvent::Unpinned { id });
                            }
                        }
                        _ => {}
                    }
                }
                Ok(Some(Ok(WsMessage::Ping(payload)))) => {
                    let _ = sink.send(WsMessage::Pong(payload)).await;
                }
                Ok(Some(Ok(WsMessage::Close(_)))) => break,
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(_))) | Ok(None) => break,
                Err(_) => {
                    // Silence: keep the socket alive.
                    if sink
                        .send(WsMessage::Text(
                            r#"{"event":"pusher:ping","data":{}}"#.into(),
                        ))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        if hub.generation() != gen {
            return;
        }
        attempt += 1;
        hub.set_status(ChatStatus::new(
            "reconnecting",
            Some(slug.clone()),
            Some(format!("تلاش {attempt}")),
        ))
        .await;
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
    }
}
