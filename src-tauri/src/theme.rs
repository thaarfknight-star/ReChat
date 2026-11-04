//! Themes + per-scene profiles (M4).
//!
//! A profile is one complete look. Each profile gets its own overlay
//! URLs: `/chat?profile=gameplay`, `/goal?profile=gameplay` (no profile
//! = the active profile). The server injects the profile's CSS
//! variables, conditional rules, and custom CSS into the overlay page
//! head, so Meld sees the themed page in a single request.
//!
//! Profiles persist in `themes.json` under the app data dir; the
//! settings window edits them through Tauri commands. The overlay
//! stylesheet (`overlay.css`) reads the variables, so the theme and the
//! page never drift apart.

use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

fn d18() -> u32 {
    18
}
fn d10() -> u32 {
    10
}
fn d8() -> u32 {
    8
}
fn d20() -> u32 {
    20
}
fn d22() -> u32 {
    22
}
fn d50() -> usize {
    50
}
fn d_opacity() -> f32 {
    0.55
}
fn d_line_height() -> f32 {
    1.7
}
fn d_msg_pad() -> u32 {
    10
}
fn d_true() -> bool {
    true
}
fn d_text() -> String {
    "#ffffff".to_string()
}
fn d_c1() -> String {
    "#16a34a".to_string()
}
fn d_c2() -> String {
    "#4ade80".to_string()
}

/// One complete look for chat + goal overlays.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Theme {
    #[serde(default = "d18")]
    pub chat_font_size: u32,
    #[serde(default = "d_opacity")]
    pub chat_bg_opacity: f32,
    #[serde(default = "d_text")]
    pub chat_text_color: String,
    #[serde(default = "d10")]
    pub chat_radius: u32,
    #[serde(default = "d8")]
    pub chat_gap: u32,
    #[serde(default = "d_line_height")]
    pub chat_line_height: f32,
    #[serde(default = "d_msg_pad")]
    pub chat_msg_padding: u32,
    #[serde(default = "d_true")]
    pub show_badges: bool,
    #[serde(default = "d_true")]
    pub show_username_color: bool,
    #[serde(default = "d50")]
    pub max_messages: usize,
    #[serde(default = "d20")]
    pub goal_title_size: u32,
    #[serde(default = "d_c1")]
    pub goal_bar_c1: String,
    #[serde(default = "d_c2")]
    pub goal_bar_c2: String,
    #[serde(default = "d22")]
    pub goal_bar_height: u32,
    #[serde(default = "d_true")]
    pub show_goal_values: bool,
    #[serde(default)]
    pub custom_css: String,
}

impl Default for Theme {
    fn default() -> Self {
        Theme {
            chat_font_size: d18(),
            chat_bg_opacity: d_opacity(),
            chat_text_color: d_text(),
            chat_radius: d10(),
            chat_gap: d8(),
            chat_line_height: d_line_height(),
            chat_msg_padding: d_msg_pad(),
            show_badges: true,
            show_username_color: true,
            max_messages: d50(),
            goal_title_size: d20(),
            goal_bar_c1: d_c1(),
            goal_bar_c2: d_c2(),
            goal_bar_height: d22(),
            show_goal_values: true,
            custom_css: String::new(),
        }
    }
}

/// All profiles + which one is active.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Themes {
    #[serde(default)]
    pub profiles: HashMap<String, Theme>,
    #[serde(default = "default_profile_name")]
    pub active: String,
}

fn default_profile_name() -> String {
    "default".to_string()
}

impl Default for Themes {
    fn default() -> Self {
        let mut profiles = HashMap::new();
        profiles.insert("default".to_string(), Theme::default());
        Themes {
            profiles,
            active: "default".to_string(),
        }
    }
}

impl Themes {
    /// Resolve a profile name: explicit > active > "default" > built-in.
    pub fn resolve(&self, name: Option<&str>) -> (String, Theme) {
        let wanted = name
            .filter(|n| !n.is_empty())
            .map(|n| n.to_string())
            .or_else(|| Some(self.active.clone()))
            .unwrap_or_else(default_profile_name);
        if let Some(t) = self.profiles.get(&wanted) {
            return (wanted, t.clone());
        }
        if let Some(t) = self.profiles.get("default") {
            return ("default".to_string(), t.clone());
        }
        (default_profile_name(), Theme::default())
    }

    /// CSS injected into the overlay page for a profile.
    pub fn css(&self, name: Option<&str>) -> String {
        let (_, t) = self.resolve(name);
        let mut css = format!(
            ":root{{--chat-font-size:{}px;--chat-bg-opacity:{};--chat-text:{};--chat-radius:{}px;--chat-gap:{}px;--chat-line-height:{};--chat-msg-padding:{}px;--goal-title-size:{}px;--goal-bar-h:{}px;--goal-c1:{};--goal-c2:{};}}",
            t.chat_font_size,
            t.chat_bg_opacity.clamp(0.0, 1.0),
            t.chat_text_color,
            t.chat_radius,
            t.chat_gap,
            t.chat_line_height.clamp(1.2, 2.2),
            t.chat_msg_padding,
            t.goal_title_size,
            t.goal_bar_height,
            t.goal_bar_c1,
            t.goal_bar_c2,
        );
        if !t.show_badges {
            css.push_str(".msg .badge,.msg .badge-img{display:none!important}");
        }
        if !t.show_username_color {
            css.push_str(".msg .user{color:var(--chat-text)!important}");
        }
        if !t.show_goal_values {
            css.push_str("#goal .values{display:none!important}");
        }
        if !t.custom_css.trim().is_empty() {
            css.push('\n');
            css.push_str(&t.custom_css);
        }
        css
    }

    pub fn max_messages(&self, name: Option<&str>) -> usize {
        let (_, t) = self.resolve(name);
        t.max_messages.max(1)
    }
}

/// Themes + their file. Owned by the app, shared with the server.
pub struct ThemeStore {
    pub themes: RwLock<Themes>,
    pub file: PathBuf,
}

impl ThemeStore {
    /// Sync load for the Tauri setup hook (commands need the store
    /// managed before the window serves).
    pub fn load_sync(file: PathBuf) -> Self {
        let themes = match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Themes::default(),
        };
        ThemeStore {
            themes: RwLock::new(themes),
            file,
        }
    }

    pub async fn persist(&self) -> Result<(), String> {
        let text = {
            let t = self.themes.read().await;
            serde_json::to_string_pretty(&*t).map_err(|e| e.to_string())?
        };
        if let Some(parent) = self.file.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        tokio::fs::write(&self.file, text)
            .await
            .map_err(|e| e.to_string())
    }
}
