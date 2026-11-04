//! ReChat — Kick chat + Goal overlays for Meld Studio.
//!
//! M1: settings window + localhost overlay server.
//! M2: live Kick chat (see kick.rs) via Pusher, broadcast to overlays
//! over SSE and to the settings window via Tauri events.

mod goal;
mod kick;
mod server;
mod theme;

use std::{path::PathBuf, sync::Arc};

use goal::{GoalHub, GoalStatus};
use kick::{ChatHub, ChatStatus, Filters};
use theme::{Theme, ThemeStore, Themes};
use tauri::Manager;

/// Resolve the frontend dist dir: packaged resource dir first, then
/// `<repo>/dist` for `tauri dev`.
fn dist_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("dist");
        if bundled.join("chat.html").exists() {
            return bundled;
        }
    }
    PathBuf::from("dist")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let hub = Arc::new(ChatHub::new());
            let goal_hub = Arc::new(GoalHub::new());
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let store = Arc::new(ThemeStore::load_sync(data_dir.join("themes.json")));
            app.manage(hub.clone());
            app.manage(goal_hub.clone());
            app.manage(store.clone());
            let dist = dist_dir(app.handle());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                hub.set_emitter(handle.clone()).await;
                goal_hub.set_emitter(handle).await;
                server::run(dist, hub, goal_hub, store).await;
            });
            Ok(())
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
            export_themes
        ])
        .run(tauri::generate_context!())
        .expect("error while running ReChat");
}
