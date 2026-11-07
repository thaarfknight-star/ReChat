//! Kick OAuth auto-connect (M8).
//!
//! Meld-style flow: the user signs in to Kick once in the browser and
//! ReChat finds their channel itself — no channel link to paste.
//!
//! Official public API (docs.kick.com):
//!   authorize: GET https://id.kick.com/oauth/authorize
//!   token:     POST https://id.kick.com/oauth/token
//!   users:     GET https://api.kick.com/public/v1/users
//!   channels:  GET https://api.kick.com/public/v1/channels
//! Flow: Authorization Code + PKCE (mandatory), scopes
//! `user:read channel:read`. Kick's token endpoint also requires the
//! client_secret even with PKCE, so the app needs both halves: the
//! user registers ONE developer app (kick.com → Settings → Developer,
//! redirect URI exactly http://localhost:17874/oauth/callback) and
//! saves its Client ID + Client Secret in ReChat once. Both values
//! and the tokens live only in the app data dir on this machine.
//!
//! After the browser callback, the local server exchanges the code,
//! resolves the channel slug, persists the tokens and connects chat
//! through the normal Pusher path (kick.rs). Tokens live 2 hours.
//! Auto-connect (0.3.8): chat needs only the stored slug — the Pusher
//! path uses the public channel resolver, no OAuth token — so the
//! login sticks even when the token refresh cannot reach Kick (Kick
//! is unreachable from Iran without VPN/DNS). An expired token is
//! refreshed in the background, best-effort, and never blocks chat.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

use crate::kick::{self, ChatHub};

const AUTHORIZE_URL: &str = "https://id.kick.com/oauth/authorize";
const TOKEN_URL: &str = "https://id.kick.com/oauth/token";
const USERS_URL: &str = "https://api.kick.com/public/v1/users";
const CHANNELS_URL: &str = "https://api.kick.com/public/v1/channels";
const REDIRECT_URI: &str = "http://localhost:17874/oauth/callback";
const USER_AGENT: &str = "ReChat/0.3.10";

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct KickClientConfig {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KickAuthTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    pub expires_at_unix: u64,
    pub username: String,
    pub slug: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct KickOauthStatus {
    pub client_id: String,
    pub has_secret: bool,
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
}

struct PendingOAuth {
    verifier: String,
    state: String,
}

pub struct KickAuthState {
    config_path: PathBuf,
    tokens_path: PathBuf,
    config: RwLock<KickClientConfig>,
    tokens: RwLock<Option<KickAuthTokens>>,
    pending: Mutex<Option<PendingOAuth>>,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_string(n: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(n)
        .map(char::from)
        .collect()
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: i64,
}

impl KickAuthState {
    pub fn load_sync(dir: PathBuf) -> Self {
        let config_path = dir.join("kick-oauth.json");
        let tokens_path = dir.join("kick-auth.json");
        let config = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let tokens = std::fs::read_to_string(&tokens_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        KickAuthState {
            config_path,
            tokens_path,
            config: RwLock::new(config),
            tokens: RwLock::new(tokens),
            pending: Mutex::new(None),
        }
    }

    async fn save_config(&self) {
        let cfg = self.config.read().await.clone();
        if let Ok(json) = serde_json::to_string_pretty(&cfg) {
            let _ = tokio::fs::write(&self.config_path, json).await;
        }
    }

    async fn save_tokens(&self) {
        let toks = self.tokens.read().await.clone();
        match toks {
            Some(t) => {
                if let Ok(json) = serde_json::to_string_pretty(&t) {
                    let _ = tokio::fs::write(&self.tokens_path, json).await;
                }
            }
            None => {
                let _ = tokio::fs::remove_file(&self.tokens_path).await;
            }
        }
    }

    pub async fn status(&self) -> KickOauthStatus {
        let cfg = self.config.read().await;
        let toks = self.tokens.read().await;
        KickOauthStatus {
            client_id: cfg.client_id.clone(),
            has_secret: !cfg.client_secret.is_empty(),
            connected: toks.is_some(),
            username: toks.as_ref().map(|t| t.username.clone()),
            slug: toks.as_ref().map(|t| t.slug.clone()),
        }
    }

    pub async fn save_client(&self, client_id: String, client_secret: String) {
        let mut cfg = self.config.write().await;
        cfg.client_id = client_id;
        // Empty secret means "keep the saved one" (the settings UI
        // never sends the stored secret back).
        if !client_secret.is_empty() {
            cfg.client_secret = client_secret;
        }
        drop(cfg);
        self.save_config().await;
    }

    pub async fn clear_tokens(&self) {
        *self.tokens.write().await = None;
        self.save_tokens().await;
    }

    /// Start the browser flow. Returns Err when the app credentials
    /// are not saved yet (the settings UI shows the guide then).
    pub async fn start(&self) -> Result<(), String> {
        let cfg = self.config.read().await.clone();
        if cfg.client_id.trim().is_empty() || cfg.client_secret.is_empty() {
            return Err("Client ID و Client Secret ذخیره نشده است".to_string());
        }
        let verifier = random_string(64);
        let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(verifier.as_bytes()));
        let state = random_string(24);
        *self.pending.lock().unwrap() = Some(PendingOAuth {
            verifier,
            state: state.clone(),
        });
        let mut url = reqwest::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &cfg.client_id)
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("scope", "user:read channel:read")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        open::that(url.as_str()).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Finish the flow from the local-server callback: validate the
    /// state, exchange the code, resolve the channel, persist tokens.
    pub async fn complete(&self, code: &str, state: &str) -> Result<(String, String), String> {
        let pending = self.pending.lock().unwrap().take();
        let Some(pending) = pending else {
            return Err("درخواست اتصال پیدا نشد؛ دوباره «اتصال با Kick» را بزن".to_string());
        };
        if pending.state != state {
            return Err("state ناهمخوان است؛ اتصال رد شد".to_string());
        }
        let cfg = self.config.read().await.clone();
        let resp = http()
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", cfg.client_id.as_str()),
                ("client_secret", cfg.client_secret.as_str()),
                ("code", code),
                ("redirect_uri", REDIRECT_URI),
                ("code_verifier", pending.verifier.as_str()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("تبدیل کد به توکن ناموفق بود ({})", resp.status()));
        }
        let tok: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
        let (username, slug) = self.resolve_channel(&tok.access_token).await?;
        let expires_at = now_unix().saturating_add(tok.expires_in.max(0) as u64);
        *self.tokens.write().await = Some(KickAuthTokens {
            access_token: tok.access_token,
            refresh_token: tok.refresh_token.unwrap_or_default(),
            expires_at_unix: expires_at,
            username: username.clone(),
            slug: slug.clone(),
        });
        self.save_tokens().await;
        Ok((username, slug))
    }

    /// Resolve the authed user's channel slug: /users first (its
    /// slug when present), else /channels?broadcaster_user_id=.
    async fn resolve_channel(&self, access: &str) -> Result<(String, String), String> {
        let user: serde_json::Value = http()
            .get(USERS_URL)
            .bearer_auth(access)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let first = user
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let username = first
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(slug) = first.get("slug").and_then(|v| v.as_str()) {
            if !slug.is_empty() {
                return Ok((username, slug.to_string()));
            }
        }
        let user_id = first
            .get("user_id")
            .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(|s| s.to_string())))
            .unwrap_or_default();
        if user_id.is_empty() {
            return Err("شناسه‌ی کاربر از Kick خوانده نشد".to_string());
        }
        let chans: serde_json::Value = http()
            .get(CHANNELS_URL)
            .query(&[("broadcaster_user_id", user_id.as_str())])
            .bearer_auth(access)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let slug = chans
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|a| a.first())
            .and_then(|c| c.get("slug"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if slug.is_empty() {
            return Err("کانال کاربر در Kick پیدا نشد".to_string());
        }
        Ok((username, slug))
    }

    async fn refresh(&self) -> Result<(), String> {
        let cfg = self.config.read().await.clone();
        let refresh_token = self
            .tokens
            .read()
            .await
            .as_ref()
            .map(|t| t.refresh_token.clone())
            .unwrap_or_default();
        if refresh_token.is_empty() {
            return Err("refresh token نیست".to_string());
        }
        let resp = http()
            .post(TOKEN_URL)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token.as_str()),
                ("client_id", cfg.client_id.as_str()),
                ("client_secret", cfg.client_secret.as_str()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("تازه‌سازی توکن ناموفق بود ({})", resp.status()));
        }
        let tok: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
        let mut toks = self.tokens.write().await;
        if let Some(t) = toks.as_mut() {
            t.access_token = tok.access_token;
            if let Some(rt) = tok.refresh_token {
                if !rt.is_empty() {
                    t.refresh_token = rt;
                }
            }
            t.expires_at_unix = now_unix().saturating_add(tok.expires_in.max(0) as u64);
        }
        drop(toks);
        self.save_tokens().await;
        Ok(())
    }

    /// Startup auto-connect: connect chat with the stored slug
    /// through the normal Pusher path. The slug never expires, and
    /// the Pusher path needs no OAuth token — so an expired access
    /// token is refreshed in the background (best-effort) and a
    /// refresh failure never blocks the login from sticking. Before
    /// 0.3.8 the refresh ran first and its failure (Kick unreachable
    /// from Iran without VPN/DNS) made every restart look like the
    /// login was lost, forcing a fresh browser login each time.
    pub async fn auto_connect(
        self: &std::sync::Arc<Self>,
        hub: std::sync::Arc<ChatHub>,
    ) -> Result<String, String> {
        let (slug, expired) = {
            let toks = self.tokens.read().await;
            let Some(t) = toks.as_ref() else {
                return Err("اتصال Kick ذخیره نشده است".to_string());
            };
            (
                t.slug.clone(),
                t.expires_at_unix <= now_unix() + 60,
            )
        };
        if slug.is_empty() {
            return Err("کانال ذخیره‌شده خالی است".to_string());
        }
        if expired {
            let this = std::sync::Arc::clone(self);
            tokio::spawn(async move {
                let _ = this.refresh().await;
            });
        }
        if hub.connect(slug.clone()).await {
            kick::spawn_loop(hub, slug.clone());
        }
        Ok(slug)
    }
}
