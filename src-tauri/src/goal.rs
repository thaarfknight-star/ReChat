//! Donofa live goal (M3), realtime since 0.3.12.
//!
//! The widget endpoint gives the initial values (one API fetch):
//!   GET https://api.donofa.com/api/v2/widgets/{identifier}?salt={salt}
//!   -> widget.goal {title, unit, initial, progress, total, status, is_active}
//! (pinned live 2026-11-04 against a real user link: goal "ارتقا استریم",
//! unit IRT, total 30,000,000).
//! Updates arrive live over Laravel Reverb (Pusher protocol 7):
//!   wss://ws.donofa.com/app/AF5Ed2JK?protocol=7&client=js&version=8.4.0&flash=false
//!   public channel `widget.{identifier}`, events `.goal.updated` /
//!   `GoalUpdatedEvent` (goal object) and `.widget.updated` (refetch once).
//! Pinned 2026-11-07 from Donofa's own public widget bundle on
//! w.donofa.ir — config {wsHost: ws.donofa.com, wsKey: AF5Ed2JK,
//! 443, forceTLS} + channel `widget.${id}` — and the subscription
//! was verified live (subscription_succeeded) against the user's own
//! widget id. The key is Donofa's public Reverb key, shipped in
//! their public JS; the channel is public (Echo `.channel()`), so no
//! auth is needed. Polling survives only as a fallback: while the
//! socket is down, one fetch every 60s (was every 10s) keeps the bar
//! fresh. A failed fetch never freezes the bar silently: the overlay
//! keeps the last values and shows the error state.
//!
//! Current amount = initial + progress (initial is the goal's head
//! start; 0 on the pinned example, so both readings agree there).

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

use crate::masterstream;

const USER_AGENT: &str = "ReChat/0.3.12";
/// Fallback poll cadence while the realtime socket is down (was 10s
/// when polling was the only path).
const FALLBACK_POLL_SECS: u64 = 60;
/// Reverb (Pusher protocol) endpoint; the key is Donofa's public one.
const WS_URL: &str =
    "wss://ws.donofa.com/app/AF5Ed2JK?protocol=7&client=js&version=8.4.0&flash=false";
/// The server pings every 30s (activity_timeout); silence past this
/// means the socket is dead.
const WS_STALE_SECS: u64 = 45;

/// Goal values ready for the overlay.
#[derive(Clone, Debug, Serialize)]
pub struct GoalState {
    pub title: String,
    pub unit: String,
    pub unit_label: String,
    pub current: f64,
    pub total: f64,
    pub pct: f64,
    pub status: String,
    pub active: bool,
}

/// Poller state: the last goal (if any) plus the connection state.
#[derive(Clone, Debug, Serialize)]
pub struct GoalStatus {
    pub state: String, // idle|loading|live|error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<GoalState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

impl GoalStatus {
    fn new(state: &str, link: Option<String>) -> Self {
        GoalStatus {
            state: state.to_string(),
            detail: None,
            goal: None,
            link,
        }
    }
}

pub struct GoalHub {
    state: RwLock<GoalStatus>,
    gen: AtomicU64,
    link: RwLock<Option<String>>,
    emitter: RwLock<Option<tauri::AppHandle>>,
}

impl GoalHub {
    pub fn new() -> Self {
        GoalHub {
            state: RwLock::new(GoalStatus::new("idle", None)),
            gen: AtomicU64::new(0),
            link: RwLock::new(None),
            emitter: RwLock::new(None),
        }
    }

    pub async fn set_emitter(&self, app: tauri::AppHandle) {
        *self.emitter.write().await = Some(app);
    }

    async fn set(&self, s: GoalStatus) {
        *self.state.write().await = s.clone();
        if let Some(app) = self.emitter.read().await.clone() {
            let _ = app.emit("goal-status", &s);
        }
    }

    pub async fn snapshot(&self) -> GoalStatus {
        self.state.read().await.clone()
    }

    pub fn generation(&self) -> u64 {
        self.gen.load(Ordering::SeqCst)
    }

    /// Start polling a link. False = nothing to spawn (invalid link or
    /// same link already live).
    pub async fn connect(&self, link: String) -> bool {
        let Some((id, salt)) = parse_goal_link(&link) else {
            let mut s = GoalStatus::new("error", Some(link));
            s.detail = Some("لینک Goal معتبر نیست (باید لینک donofa.ir/w/… با salt باشد)".to_string());
            self.set(s).await;
            return false;
        };
        let _ = (id, salt);
        let same = self.link.read().await.clone() == Some(link.clone());
        if same {
            let st = self.snapshot().await;
            if st.state == "live" || st.state == "loading" {
                return false;
            }
        }
        *self.link.write().await = Some(link.clone());
        self.gen.fetch_add(1, Ordering::SeqCst);
        self.set(GoalStatus::new("loading", Some(link))).await;
        true
    }

    pub async fn disconnect(&self) {
        self.gen.fetch_add(1, Ordering::SeqCst);
        *self.link.write().await = None;
        self.set(GoalStatus::new("idle", None)).await;
    }
}

pub fn spawn_goal_loop(hub: Arc<GoalHub>, link: String) {
    let gen = hub.generation();
    tokio::spawn(run_goal_loop(hub, link, gen));
}

/// Accept a full `donofa.ir/w/{id}?salt={salt}` link (or `id?salt=`).
/// Returns (identifier, salt). Salt is required: the public endpoint
/// answers the widget only with it.
pub fn parse_goal_link(input: &str) -> Option<(String, String)> {
    let s = input.trim();
    let salt = s
        .split("salt=")
        .nth(1)?
        .split(['&', '#'])
        .next()?
        .trim()
        .to_string();
    let id = if let Some(pos) = s.find("/w/") {
        s[pos + 3..].split(['?', '#', '/']).next()?.trim()
    } else {
        s.split(['?', '#']).next()?.trim()
    };
    if id.is_empty() || salt.is_empty() {
        return None;
    }
    Some((id.to_string(), salt))
}

#[derive(Deserialize)]
struct WidgetResp {
    widget: Option<WidgetData>,
}

#[derive(Deserialize)]
struct WidgetData {
    goal: Option<RawGoal>,
}

#[derive(Deserialize)]
struct RawGoal {
    #[serde(default)]
    title: String,
    #[serde(default)]
    unit: String,
    #[serde(default)]
    initial: f64,
    #[serde(default)]
    progress: f64,
    #[serde(default)]
    total: f64,
    #[serde(default)]
    status: String,
    #[serde(default)]
    is_active: bool,
}

fn unit_label(unit: &str) -> String {
    match unit {
        "IRT" => "تومان".to_string(),
        "USD" => "دلار".to_string(),
        "EUR" => "یورو".to_string(),
        other => other.to_string(),
    }
}

/// Classify a failed Donofa request into a short Persian detail.
/// 0.3.11: reqwest's Display embeds the full request URL — including
/// the widget salt — and the overlay prints the detail raw, so the
/// salt used to show on stream (see the 2026-11-07 screenshot) while
/// the generic "error sending request" said nothing about the cause.
/// The detail now names the cause and never contains the URL. Only
/// the error's source chain is read for classification; no part of
/// it is ever copied into the output.
fn describe_send_error(e: &reqwest::Error) -> String {
    let mut chain = String::new();
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = cur {
        if !chain.is_empty() {
            chain.push(' ');
        }
        chain.push_str(&err.to_string());
        cur = err.source();
    }
    let lower = chain.to_lowercase();
    if e.is_timeout() || lower.contains("timed out") || lower.contains("deadline") {
        "دونوفا دیر جواب داد (تایم‌اوت)".to_string()
    } else if lower.contains("dns")
        || lower.contains("lookup")
        || lower.contains("name resolution")
    {
        "آدرس دونوفا پیدا نشد (DNS)؛ DNS یا VPN را چک کن".to_string()
    } else if lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("connection aborted")
    {
        "اتصال به دونوفا رد شد".to_string()
    } else if lower.contains("tls")
        || lower.contains("certificate")
        || lower.contains("ssl")
        || lower.contains("handshake")
    {
        "اتصال امن به دونوفا برقرار نشد".to_string()
    } else {
        "خطا در اتصال به دونوفا".to_string()
    }
}

async fn fetch_goal(id: &str, salt: &str) -> Result<GoalState, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let bust = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let url = format!(
        "https://api.donofa.com/api/v2/widgets/{id}?salt={salt}&cache_bust={bust}"
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| describe_send_error(&e))?;
    if !resp.status().is_success() {
        return Err(format!("دونوفا جواب نداد ({})", resp.status()));
    }
    let wr: WidgetResp = resp.json().await.map_err(|e| e.to_string())?;
    let g = wr
        .widget
        .and_then(|w| w.goal)
        .ok_or("در این لینک Goal فعالی نیست")?;
    Ok(to_goal_state(g))
}

fn to_goal_state(g: RawGoal) -> GoalState {
    let current = g.initial + g.progress;
    let pct = if g.total > 0.0 {
        (current / g.total * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    GoalState {
        title: g.title,
        unit_label: unit_label(&g.unit),
        unit: g.unit,
        current,
        total: g.total,
        pct,
        status: g.status,
        active: g.is_active,
    }
}

/// Extract a goal from a Reverb event payload, the way Donofa's own
/// widget does: `d.goal || d.data.goal || d.data || d`. The payload
/// carries the same goal fields as the API. Returns None when the
/// payload holds no goal at all (then the caller refetches once).
fn goal_from_event(data: &Value) -> Option<GoalState> {
    let cand = data
        .get("goal")
        .or_else(|| data.get("data").and_then(|d| d.get("goal")))
        .or_else(|| data.get("data"))
        .unwrap_or(data);
    let g: RawGoal = serde_json::from_value(cand.clone()).ok()?;
    if g.total <= 0.0 && g.title.is_empty() {
        return None;
    }
    Some(to_goal_state(g))
}

/// Pusher frames carry `data` as a JSON string; parse it, falling
/// back to the raw value when it already is one.
fn pusher_data(frame: &Value) -> Option<Value> {
    match frame.get("data") {
        Some(Value::String(s)) => serde_json::from_str(s).ok(),
        Some(v) => Some(v.clone()),
        None => None,
    }
}

async fn set_live(hub: &Arc<GoalHub>, link: &str, goal: GoalState) {
    let mut s = GoalStatus::new("live", Some(link.to_string()));
    s.goal = Some(goal);
    hub.set(s).await;
}

async fn set_error(hub: &Arc<GoalHub>, link: &str, e: String) {
    // Keep the last goal; only the state flips to error.
    let mut snap = hub.snapshot().await;
    snap.state = "error".to_string();
    snap.detail = Some(e);
    snap.link = Some(link.to_string());
    hub.set(snap).await;
}

enum WsOutcome {
    /// The loop's generation moved on (disconnect / new link).
    Replaced,
    /// The socket died; the caller falls back to polling, then retries.
    Down,
}

/// One Reverb session: connect, subscribe to `widget.{id}`, and apply
/// live goal events until the socket dies or the loop is replaced.
async fn run_goal_ws_session(
    hub: &Arc<GoalHub>,
    link: &str,
    id: &str,
    salt: &str,
    gen: u64,
) -> WsOutcome {
    let req = match masterstream::ws_request(WS_URL, USER_AGENT) {
        Ok(r) => r,
        Err(_) => return WsOutcome::Down,
    };
    let (mut ws, _) = match connect_async(req).await {
        Ok(p) => p,
        Err(_) => return WsOutcome::Down,
    };
    let channel = format!("widget.{id}");
    let mut subscribed = false;
    let mut last_frame = Instant::now();
    loop {
        if hub.generation() != gen {
            return WsOutcome::Replaced;
        }
        // Short reads so a disconnect is noticed within seconds; the
        // socket is only stale when nothing arrived for 45s (the
        // server pings every 30s).
        let next = tokio::time::timeout(Duration::from_secs(5), ws.next()).await;
        let msg = match next {
            Ok(Some(Ok(m))) => {
                last_frame = Instant::now();
                m
            }
            Ok(Some(Err(_))) | Ok(None) => return WsOutcome::Down,
            Err(_) => {
                if last_frame.elapsed() > Duration::from_secs(WS_STALE_SECS) {
                    return WsOutcome::Down;
                }
                continue;
            }
        };
        let WsMessage::Text(text) = msg else {
            continue;
        };
        let Ok(frame) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let event = frame.get("event").and_then(|e| e.as_str()).unwrap_or("");
        match event {
            "pusher:connection_established" => {
                let sub = serde_json::json!({
                    "event": "pusher:subscribe",
                    "data": { "channel": channel },
                });
                if ws.send(WsMessage::Text(sub.to_string().into())).await.is_err() {
                    return WsOutcome::Down;
                }
            }
            "pusher_internal:subscription_succeeded" => subscribed = true,
            "pusher:ping" => {
                let pong = serde_json::json!({ "event": "pusher:pong", "data": {} });
                if ws.send(WsMessage::Text(pong.to_string().into())).await.is_err() {
                    return WsOutcome::Down;
                }
            }
            "pusher:error" => return WsOutcome::Down,
            ".goal.updated" | "GoalUpdatedEvent" if subscribed => {
                let Some(data) = pusher_data(&frame) else {
                    continue;
                };
                match goal_from_event(&data) {
                    Some(goal) => set_live(hub, link, goal).await,
                    // Shape differs from the widget's? Refetch once —
                    // one request per donation beats a stale bar.
                    None => {
                        if let Ok(goal) = fetch_with_retry(id, salt).await {
                            set_live(hub, link, goal).await;
                        }
                    }
                }
            }
            ".widget.updated" | "WidgetUpdated" | "WidgetUpdateEvent" if subscribed => {
                // Mirror the widget: a widget update means refetch once.
                if let Ok(goal) = fetch_with_retry(id, salt).await {
                    set_live(hub, link, goal).await;
                }
            }
            _ => {}
        }
    }
}

/// One poll tick with two quick retries: a transient blip (a single
/// failed request) heals without ever flipping the overlay to error.
async fn fetch_with_retry(id: &str, salt: &str) -> Result<GoalState, String> {
    let mut last_err = String::new();
    for attempt in 0..3 {
        match fetch_goal(id, salt).await {
            Ok(goal) => return Ok(goal),
            Err(e) => {
                last_err = e;
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    }
    Err(last_err)
}

async fn run_goal_loop(hub: Arc<GoalHub>, link: String, gen: u64) {
    let Some((id, salt)) = parse_goal_link(&link) else {
        return;
    };
    // One initial fetch for the current values; after that the
    // socket carries every update and Donofa gets no polling at all.
    match fetch_with_retry(&id, &salt).await {
        Ok(goal) => set_live(&hub, &link, goal).await,
        Err(e) => set_error(&hub, &link, e).await,
    }
    loop {
        if hub.generation() != gen {
            return;
        }
        match run_goal_ws_session(&hub, &link, &id, &salt, gen).await {
            WsOutcome::Replaced => return,
            WsOutcome::Down => {
                // Socket down: one poll tick every 60s keeps the bar
                // fresh, then the socket is retried.
                tokio::time::sleep(Duration::from_secs(FALLBACK_POLL_SECS)).await;
                if hub.generation() != gen {
                    return;
                }
                match fetch_with_retry(&id, &salt).await {
                    Ok(goal) => set_live(&hub, &link, goal).await,
                    Err(e) => set_error(&hub, &link, e).await,
                }
            }
        }
    }
}
