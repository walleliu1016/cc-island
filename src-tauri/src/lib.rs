pub mod http_server;
pub mod instance_manager;
pub mod popup_queue;
pub mod hook_handler;
pub mod platform;
pub mod config;

use instance_manager::InstanceManager;
use popup_queue::PopupQueue;
use http_server::HttpServer;
use serde::{Deserialize, Serialize};

use std::sync::Arc;
use parking_lot::RwLock;
use once_cell::sync::Lazy;
use tauri::Manager;

/// Recent tool activity for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolActivity {
    pub session_id: String,
    pub project_name: String,
    pub tool_name: String,
    pub timestamp: u64,
}

/// Global state shared between HTTP server and frontend
pub struct AppState {
    pub instances: InstanceManager,
    pub popups: PopupQueue,
    pub settings: config::AppSettings,
    pub recent_activities: Vec<ToolActivity>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            instances: InstanceManager::new(),
            popups: PopupQueue::new(),
            settings: config::AppSettings::default(),
            recent_activities: Vec::new(),
        }
    }

    /// Add activity and clean old ones (keep last 10 within 5 seconds)
    pub fn add_activity(&mut self, activity: ToolActivity) {
        let now = activity.timestamp;
        // Keep activities within last 5 seconds
        self.recent_activities.retain(|a| now - a.timestamp < 5);
        // Add new activity
        self.recent_activities.push(activity);
        // Keep max 10
        if self.recent_activities.len() > 10 {
            self.recent_activities.remove(0);
        }
    }

    /// Get recent activities (within last 2 seconds for display)
    pub fn get_display_activities(&self) -> Vec<&ToolActivity> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.recent_activities.iter()
            .filter(|a| now - a.timestamp < 2)
            .collect()
    }
}

pub static SHARED_STATE: Lazy<Arc<RwLock<AppState>>> = Lazy::new(|| {
    Arc::new(RwLock::new(AppState::new()))
});

/// Check if logging is enabled
pub fn is_logging_enabled() -> bool {
    SHARED_STATE.read().settings.enable_logging
}

/// Write to log file if logging is enabled
pub fn write_log(filename: &str, content: &str) {
    if !is_logging_enabled() {
        return;
    }
    let path = format!("/tmp/{}", filename);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, content.as_bytes()));
}

// Tauri commands
#[tauri::command]
fn start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_instances() -> Vec<instance_manager::ClaudeInstance> {
    let state = SHARED_STATE.read();
    state.instances.get_all_instances()
}

#[tauri::command]
fn get_popups() -> Vec<popup_queue::PopupItem> {
    let state = SHARED_STATE.read();
    state.popups.get_all()
}

#[tauri::command]
fn get_recent_activities() -> Vec<ToolActivity> {
    let state = SHARED_STATE.read();
    state.get_display_activities().into_iter().cloned().collect()
}

#[tauri::command]
fn respond_popup(
    popup_id: String,
    decision: Option<String>,
    answer: Option<String>,
    answers: Option<Vec<Vec<String>>>,
) -> Result<(), String> {
    // Log to file if logging enabled
    let log_content = format!(
        "[{}] respond_popup called: popup_id={}, decision={:?}, answers={:?}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        popup_id, decision, answers
    );
    write_log("cc-island-response.log", &log_content);

    let mut state = SHARED_STATE.write();
    let response = popup_queue::PopupResponse {
        popup_id: popup_id.clone(),
        decision,
        answer,
        answers,
    };

    if state.popups.resolve(response) {
        Ok(())
    } else {
        Err("Popup not found or already resolved".to_string())
    }
}

#[tauri::command]
fn jump_to_instance(session_id: String) -> Result<(), String> {
    let state = SHARED_STATE.read();
    if let Some(instance) = state.instances.get_instance(&session_id) {
        if let Some(process_info) = &instance.process_info {
            platform::jump_to_terminal(process_info);
            Ok(())
        } else {
            Err("No process info available".to_string())
        }
    } else {
        Err("Instance not found".to_string())
    }
}

#[tauri::command]
fn check_claude_hooks() -> config::HooksCheckResult {
    config::check_claude_hooks_config()
}

#[tauri::command]
fn update_claude_hooks(hooks: Vec<String>) -> Result<(), String> {
    config::update_claude_hooks_config(hooks)
}

#[tauri::command]
fn get_settings() -> config::AppSettings {
    let state = SHARED_STATE.read();
    state.settings.clone()
}

#[tauri::command]
fn update_settings(settings: config::AppSettings) -> Result<(), String> {
    let mut state = SHARED_STATE.write();
    state.settings = settings;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

    rt.block_on(async {
        tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                // When second instance tries to start, focus the existing window
                let _ = app.get_webview_window("main").map(|w| {
                    w.set_focus().ok();
                    w.show().ok();
                });
            }))
            .invoke_handler(tauri::generate_handler![
                start_drag,
                get_instances,
                get_popups,
                get_recent_activities,
                respond_popup,
                jump_to_instance,
                check_claude_hooks,
                update_claude_hooks,
                get_settings,
                update_settings
            ])
            .setup(|app| {
                let _window = app.get_webview_window("main").unwrap();

                // Start HTTP server in background
                let server = HttpServer::new(17527);
                tokio::spawn(async move {
                    if let Err(e) = server.run().await {
                        tracing::error!("HTTP server error: {}", e);
                    }
                });

                tracing::info!("CC-Island started successfully");
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    });
}