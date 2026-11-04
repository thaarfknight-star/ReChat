//! ReChat — Kick chat + Goal overlays for Meld Studio.
//!
//! M1: settings window + localhost overlay server.
//! M2: live Kick chat (see kick.rs) via Pusher, broadcast to overlays
//! over SSE and to the settings window via Tauri events.

mod goal;
mod kick;
mod kick_auth;
mod server;
mod theme;

use std::{path::PathBuf, sync::Arc};

use goal::{GoalHub, GoalStatus};
use kick::{ChatHub, ChatStatus, Filters};
use kick_auth::{KickAuthState, KickOauthStatus};
use theme::{Theme, ThemeStore, Themes};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

/// Resolve the frontend dist dir. 0.3.3: the old code only looked in
/// `resource_dir()/dist` and then in a cwd-relative `dist/`, but the
/// installed layout is not guaranteed — the MSI/NSIS resource folder,
/// the exe folder, and a flattened layout (files at the resource root)
/// are all seen in the wild, and a GUI app's cwd is unpredictable, so a
/// single guess 404s the overlays ("overlay file not found") even though
/// dist IS bundled. Try every plausible home; a candidate counts only
/// when it holds both overlay pages.
fn dist_dir(app: &tauri::AppHandle) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("dist"));
        candidates.push(res);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("dist"));
            candidates.push(dir.to_path_buf());
        }
    }
    candidates.push(PathBuf::from("dist"));
    for c in &candidates {
        if c.join("chat.html").exists() && c.join("goal.html").exists() {
            return c.clone();
        }
    }
    candidates.into_iter().next().unwrap_or_else(|| PathBuf::from("dist"))
}

#[tauri::command]
async fn connect_chat(
    hub: tauri::State<'_, Arc<ChatHub>>,
    channel: String,
) -> Result<(), String> {
    if hub.connect(channel.clone()).await {
        kick::spawn_loop(hub.inner().clone(), channel);
    }
    Ok(())
}

#[tauri::command]
async fn disconnect_chat(hub: tauri::State<'_, Arc<ChatHub>>) -> Result<(), String> {
    hub.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn chat_status(hub: tauri::State<'_, Arc<ChatHub>>) -> Result<ChatStatus, String> {
    Ok(hub.status_snapshot().await)
}

#[tauri::command]
async fn save_filters(
    hub: tauri::State<'_, Arc<ChatHub>>,
    filters: Filters,
) -> Result<(), String> {
    hub.set_filters(filters).await;
    Ok(())
}

#[tauri::command]
async fn get_filters(hub: tauri::State<'_, Arc<ChatHub>>) -> Result<Filters, String> {
    Ok(hub.filters_snapshot().await)
}

#[tauri::command]
async fn connect_goal(
    hub: tauri::State<'_, Arc<GoalHub>>,
    link: String,
) -> Result<(), String> {
    if hub.connect(link.clone()).await {
        goal::spawn_goal_loop(hub.inner().clone(), link);
    }
    Ok(())
}

#[tauri::command]
async fn disconnect_goal(hub: tauri::State<'_, Arc<GoalHub>>) -> Result<(), String> {
    hub.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn goal_status(hub: tauri::State<'_, Arc<GoalHub>>) -> Result<GoalStatus, String> {
    Ok(hub.snapshot().await)
}

#[tauri::command]
async fn get_themes(store: tauri::State<'_, Arc<ThemeStore>>) -> Result<Themes, String> {
    Ok(store.themes.read().await.clone())
}

#[tauri::command]
async fn save_theme(
    store: tauri::State<'_, Arc<ThemeStore>>,
    profile: String,
    theme: Theme,
) -> Result<(), String> {
    {
        let mut t = store.themes.write().await;
        t.profiles.insert(profile, theme);
    }
    store.persist().await
}

#[tauri::command]
async fn create_profile(
    store: tauri::State<'_, Arc<ThemeStore>>,
    name: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("نام پروفایل خالی است".to_string());
    }
    let mut t = store.themes.write().await;
    if t.profiles.contains_key(&name) {
        return Err("پروفایلی با این نام هست".to_string());
    }
    let base = t.resolve(None).1;
    t.profiles.insert(name, base);
    drop(t);
    store.persist().await
}

#[tauri::command]
async fn rename_profile(
    store: tauri::State<'_, Arc<ThemeStore>>,
    old: String,
    new: String,
) -> Result<(), String> {
    let new = new.trim().to_string();
    if new.is_empty() {
        return Err("نام تازه خالی است".to_string());
    }
    let mut t = store.themes.write().await;
    if t.profiles.contains_key(&new) {
        return Err("پروفایلی با این نام هست".to_string());
    }
    let Some(theme) = t.profiles.remove(&old) else {
        return Err("پروفایل پیدا نشد".to_string());
    };
    if t.active == old {
        t.active = new.clone();
    }
    t.profiles.insert(new, theme);
    drop(t);
    store.persist().await
}

#[tauri::command]
async fn duplicate_profile(
    store: tauri::State<'_, Arc<ThemeStore>>,
    name: String,
    new_name: String,
) -> Result<(), String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("نام تازه خالی است".to_string());
    }
    let mut t = store.themes.write().await;
    if t.profiles.contains_key(&new_name) {
        return Err("پروفایلی با این نام هست".to_string());
    }
    let Some(theme) = t.profiles.get(&name).cloned() else {
        return Err("پروفایل پیدا نشد".to_string());
    };
    t.profiles.insert(new_name, theme);
    drop(t);
    store.persist().await
}

#[tauri::command]
async fn delete_profile(
    store: tauri::State<'_, Arc<ThemeStore>>,
    name: String,
) -> Result<(), String> {
    if name == "default" {
        return Err("پروفایل default حذف نمی‌شود".to_string());
    }
    let mut t = store.themes.write().await;
    if t.profiles.remove(&name).is_none() {
        return Err("پروفایل پیدا نشد".to_string());
    }
    if t.active == name {
        t.active = "default".to_string();
    }
    drop(t);
    store.persist().await
}

#[tauri::command]
async fn set_active_profile(
    store: tauri::State<'_, Arc<ThemeStore>>,
    name: String,
) -> Result<(), String> {
    let mut t = store.themes.write().await;
    if !t.profiles.contains_key(&name) {
        return Err("پروفایل پیدا نشد".to_string());
    }
    t.active = name;
    drop(t);
    store.persist().await
}

#[tauri::command]
async fn import_themes(
    store: tauri::State<'_, Arc<ThemeStore>>,
    json: String,
) -> Result<(), String> {
    let parsed: Themes = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    if parsed.profiles.is_empty() {
        return Err("فایل JSON هیچ پروفایلی ندارد".to_string());
    }
    *store.themes.write().await = parsed;
    store.persist().await
}

#[tauri::command]
async fn export_themes(store: tauri::State<'_, Arc<ThemeStore>>) -> Result<String, String> {
    let t = store.themes.read().await;
    serde_json::to_string_pretty(&*t).map_err(|e| e.to_string())
}

// ---------- Kick OAuth (M8) ----------

#[tauri::command]
async fn get_kick_oauth_config(
    auth: tauri::State<'_, Arc<KickAuthState>>,
) -> Result<KickOauthStatus, String> {
    Ok(auth.status().await)
}

#[tauri::command]
async fn save_kick_oauth_config(
    auth: tauri::State<'_, Arc<KickAuthState>>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    auth.save_client(client_id, client_secret).await;
    Ok(())
}

#[tauri::command]
async fn start_kick_oauth(auth: tauri::State<'_, Arc<KickAuthState>>) -> Result<(), String> {
    auth.start().await
}

#[tauri::command]
async fn disconnect_kick_oauth(auth: tauri::State<'_, Arc<KickAuthState>>) -> Result<(), String> {
    auth.clear_tokens().await;
    Ok(())
}

#[tauri::command]
async fn auto_connect_kick(
    auth: tauri::State<'_, Arc<KickAuthState>>,
    hub: tauri::State<'_, Arc<ChatHub>>,
) -> Result<String, String> {
    auth.auto_connect(hub.inner().clone()).await
}

// ---------- System tray (M8.1) ----------

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let hub = Arc::new(ChatHub::new());
            let goal_hub = Arc::new(GoalHub::new());
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let store = Arc::new(ThemeStore::load_sync(data_dir.join("themes.json")));
            let auth = Arc::new(KickAuthState::load_sync(data_dir));
            app.manage(hub.clone());
            app.manage(goal_hub.clone());
            app.manage(store.clone());
            app.manage(auth.clone());
            let dist = dist_dir(app.handle());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                hub.set_emitter(handle.clone()).await;
                goal_hub.set_emitter(handle).await;
                server::run(dist, hub, goal_hub, store, auth).await;
            });
            // Tray icon (M8.1): closing the window hides to tray so
            // the overlay server keeps running in the background.
            // The icon lives in the runtime once built (no Drop
            // removal in tauri 2.12), so the handle need not be kept.
            if let Some(icon) = app.default_window_icon() {
                let show = MenuItemBuilder::with_id("show", "نمایش ReChat").build(app)?;
                let quit = MenuItemBuilder::with_id("quit", "خروج").build(app)?;
                let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .tooltip("ReChat")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        // The X button hides to tray instead of quitting; full quit
        // comes from the tray menu or the in-app Quit button.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            connect_chat,
            disconnect_chat,
            chat_status,
            save_filters,
            get_filters,
            connect_goal,
            disconnect_goal,
            goal_status,
            get_themes,
            save_theme,
            create_profile,
            rename_profile,
            duplicate_profile,
            delete_profile,
            set_active_profile,
            import_themes,
            export_themes,
            get_kick_oauth_config,
            save_kick_oauth_config,
            start_kick_oauth,
            disconnect_kick_oauth,
            auto_connect_kick,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running ReChat");
}
