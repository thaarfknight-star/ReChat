//! Donofa live goal (M3).
//!
//! Polling, not websocket, by design. The widget endpoint is public,
//! needs no auth, and returns the exact current/target:
//!   GET https://api.donofa.com/api/v2/widgets/{identifier}?salt={salt}
//!   -> widget.goal {title, unit, initial, progress, total, status, is_active}
//! (pinned live 2026-11-04 against a real user link: goal "ارتقا استریم",
//! unit IRT, total 30,000,000).
//! A websocket (`.goal.updated` on ws.donofa.com) exists, but its channel
//! /auth dance is undocumented for public widgets; polling every 10s is
//! the stable path. A failed poll never freezes the bar silently: the
//! overlay keeps the last values and shows the error state.
//!
//! Current amount = initial + progress (initial is the goal's head
//! start; 0 on the pinned example, so both readings agree there).

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::RwLock;

const USER_AGENT: &str = "ReChat/0.1.0";
const POLL_SECS: u64 = 10;

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
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("دونوفا جواب نداد ({})", resp.status()));
    }
    let wr: WidgetResp = resp.json().await.map_err(|e| e.to_string())?;
    let g = wr
        .widget
        .and_then(|w| w.goal)
        .ok_or("در این لینک Goal فعالی نیست")?;
    let current = g.initial + g.progress;
    let pct = if g.total > 0.0 {
        (current / g.total * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    Ok(GoalState {
        title: g.title,
        unit_label: unit_label(&g.unit),
        unit: g.unit,
        current,
        total: g.total,
        pct,
        status: g.status,
        active: g.is_active,
    })
}

async fn run_goal_loop(hub: Arc<GoalHub>, link: String, gen: u64) {
    let Some((id, salt)) = parse_goal_link(&link) else {
        return;
    };
    loop {
        if hub.generation() != gen {
            return;
        }
        match fetch_goal(&id, &salt).await {
            Ok(goal) => {
                let mut s = GoalStatus::new("live", Some(link.clone()));
                s.goal = Some(goal);
                hub.set(s).await;
            }
            Err(e) => {
                // Keep the last goal; only the state flips to error.
                let mut snap = hub.snapshot().await;
                snap.state = "error".to_string();
                snap.detail = Some(e);
                snap.link = Some(link.clone());
                hub.set(snap).await;
            }
        }
        tokio::time::sleep(Duration::from_secs(POLL_SECS)).await;
    }
}
