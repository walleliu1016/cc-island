pub mod http_server;
pub mod instance_manager;
pub mod popup_queue;
pub mod hook_handler;
pub mod platform;
pub mod config;
pub mod chat_messages;
pub mod websocket_server;
pub mod machine_id;

use instance_manager::InstanceManager;
use popup_queue::PopupQueue;
use chat_messages::ChatHistory;
use http_server::HttpServer;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};

use std::sync::Arc;
use parking_lot::RwLock;
use once_cell::sync::Lazy;
use tauri::Manager;
use std::sync::atomic::{AtomicBool, Ordering};

/// Global atomic flag for logging (no lock needed)
pub static LOGGING_ENABLED: AtomicBool = AtomicBool::new(false);

/// Recent tool activity for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolActivity {
    pub session_id: String,
    pub project_name: String,
    pub tool_name: String,
    pub timestamp: u64,
}

/// Session notification for display (start/end)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionNotification {
    pub project_name: String,
    pub notification_type: String, // "started" or "ended"
    pub timestamp: u64,
}

/// Global state shared between HTTP server and frontend
pub struct AppState {
    pub instances: InstanceManager,
    pub popups: PopupQueue,
    pub chat_history: ChatHistory,
    pub settings: config::AppSettings,
    pub recent_activities: Vec<ToolActivity>,
    pub session_notification: Option<SessionNotification>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            instances: InstanceManager::new(),
            popups: PopupQueue::new(),
            chat_history: ChatHistory::new(),
            settings: config::load_settings(),
            recent_activities: Vec::new(),
            session_notification: None,
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

    /// Set session notification (start/end)
    pub fn set_session_notification(&mut self, notification: SessionNotification) {
        self.session_notification = Some(notification);
    }

    /// Get session notification and clear if expired (after 3 seconds)
    pub fn get_session_notification(&mut self) -> Option<SessionNotification> {
        if let Some(notification) = &self.session_notification {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            // Clear notification after 3 seconds
            if now - notification.timestamp > 3 {
                self.session_notification = None;
                return None;
            }
            return Some(notification.clone());
        }
        None
    }
}

pub static SHARED_STATE: Lazy<Arc<RwLock<AppState>>> = Lazy::new(|| {
    Arc::new(RwLock::new(AppState::new()))
});

/// Check if logging is enabled (atomic, no lock)
pub fn is_logging_enabled() -> bool {
    LOGGING_ENABLED.load(Ordering::Relaxed)
}

/// Set logging enabled state (atomic, no lock)
pub fn set_logging_enabled(enabled: bool) {
    LOGGING_ENABLED.store(enabled, Ordering::Relaxed);
}

/// Write to log file directly (atomic check + file write, no RwLock involved)
/// This is safe to call even when holding RwLock because file I/O is independent
pub fn write_log(content: &str) {
    if !LOGGING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    // Get log file path
    let log_path = config::get_log_file_path();

    // Ensure directory exists
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Direct file write - no locks involved, safe to call from anywhere
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, content.as_bytes()));
}

// Tauri commands
#[tauri::command]
fn start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_window(window: tauri::Window, width: u32, height: u32) -> Result<(), String> {
    use tauri::{Size, Position};

    // Get current monitor size to calculate center position
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?;

    if let Some(monitor) = monitor {
        let screen_size = monitor.size();
        // Calculate centered x position
        let x = (screen_size.width - width) / 2;
        // Keep y = 0 (touching screen top)
        let y = 0u32;

        // Set new position first (to keep window centered)
        window.set_position(Position::Physical(tauri::PhysicalPosition { x: x as i32, y: y as i32 }))
            .map_err(|e| e.to_string())?;
    }

    // Set new size
    window
        .set_size(Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_instances() -> Vec<instance_manager::ClaudeInstanceDisplay> {
    let state = SHARED_STATE.read();
    state.instances.get_all_instances_display()
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
fn get_session_notification() -> Option<SessionNotification> {
    let mut state = SHARED_STATE.write();
    state.get_session_notification()
}

#[tauri::command]
fn get_chat_messages(session_id: String) -> Vec<chat_messages::ChatMessage> {
    let state = SHARED_STATE.read();
    state.chat_history.get_messages(&session_id)
}

#[tauri::command]
fn respond_popup(
    popup_id: String,
    decision: Option<String>,
    answer: Option<String>,
    answers: Option<Vec<Vec<String>>>,
) -> Result<(), String> {
    // Log using async channel (no lock needed)
    if is_logging_enabled() {
        let log_content = format!(
            "[{}] respond_popup called: popup_id={}, decision={:?}, answers={:?}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            popup_id, decision, answers
        );
        write_log(&log_content);
    }

    let mut state = SHARED_STATE.write();

    // Get popup info before resolving (to record answers in chat history)
    let popup_info = state.popups.get(&popup_id).cloned();

    let response = popup_queue::PopupResponse {
        popup_id: popup_id.clone(),
        decision: decision.clone(),
        answer: answer.clone(),
        answers: answers.clone(),
    };

    if state.popups.resolve(response) {
        // Clear WaitingForApproval status for the instance
        if let Some(popup) = &popup_info {
            if let Some(instance) = state.instances.get_instance_mut(&popup.session_id) {
                // Only clear if it's still in WaitingForApproval state
                if matches!(instance.status, instance_manager::InstanceStatus::WaitingForApproval(_)) {
                    instance.set_status(instance_manager::InstanceStatus::Idle);
                    instance.current_tool = None;
                    instance.tool_input = None;
                }
            }
        }

        // Record user answers in chat history if this is an ask popup
        if let Some(popup) = popup_info {
            if popup.popup_type == popup_queue::PopupType::Ask {
                if let (Some(answers_arr), Some(ask_data)) = (&answers, &popup.ask_data) {
                    // Build answer text
                    let _answer_parts: Vec<String> = answers_arr
                        .iter()
                        .enumerate()
                        .map(|(i, selected)| {
                            let q = ask_data.questions.get(i);
                            let q_header = q.map(|q| q.header.as_str()).unwrap_or("Question");
                            format!("{}: {}", q_header, selected.join(", "))
                        })
                        .collect();

                    let answer_content = format!(
                        "AskUserQuestion Answers: {{\"answers\": {}}}",
                        serde_json::to_string(&answers_arr).unwrap_or_default()
                    );

                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    state.chat_history.add_message(chat_messages::ChatMessage {
                        id: uuid::Uuid::new_v4().to_string(),
                        session_id: popup.session_id.clone(),
                        message_type: chat_messages::MessageType::User,
                        content: answer_content,
                        tool_name: Some("AskUserQuestionAnswer".to_string()),
                        timestamp: now_ms,
                    });
                }
            }
        }
        Ok(())
    } else {
        Err("Popup not found or already resolved".to_string())
    }
}

#[tauri::command]
fn jump_to_instance(session_id: String) -> Result<(), String> {
    // First, try to refresh process info in case terminal detection failed
    {
        let state = SHARED_STATE.read();
        if let Some(instance) = state.instances.get_instance(&session_id) {
            if let Some(info) = &instance.process_info {
                if info.terminal_type == instance_manager::TerminalType::Unknown {
                    tracing::info!("Terminal type unknown, attempting refresh");
                    drop(state); // Release read lock
                    let _ = refresh_instance_process_internal(&session_id);
                }
            }
        }
    }

    let state = SHARED_STATE.read();
    if let Some(instance) = state.instances.get_instance(&session_id) {
        if let Some(process_info) = &instance.process_info {
            let result = platform::jump_to_terminal(process_info);
            if result {
                Ok(())
            } else {
                Err("Failed to activate terminal window".to_string())
            }
        } else {
            Err("No process info available. Try refreshing.".to_string())
        }
    } else {
        Err("Instance not found".to_string())
    }
}

/// Internal function to refresh process info (can be called without lock issues)
fn refresh_instance_process_internal(session_id: &str) -> Result<(), String> {
    let process_info = platform::find_any_claude_process();

    if let Some(info) = process_info {
        let mut state = SHARED_STATE.write();
        // Convert &str to &String for the API
        let session_id_string = session_id.to_string();
        if let Some(instance) = state.instances.get_instance_mut(&session_id_string) {
            instance.process_info = Some(info);
            tracing::info!("Refreshed process info for session {}", session_id);
            Ok(())
        } else {
            Err("Instance not found".to_string())
        }
    } else {
        Err("Could not find Claude process".to_string())
    }
}

#[tauri::command]
fn refresh_instance_process(session_id: String) -> Result<(), String> {
    refresh_instance_process_internal(&session_id)
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
fn get_product_name(app: tauri::AppHandle) -> String {
    app.config().product_name.clone().unwrap_or_else(|| "CC-Island".to_string())
}

#[tauri::command]
fn get_device_token() -> String {
    machine_id::get_machine_token()
}

#[tauri::command]
fn update_settings(settings: config::AppSettings) -> Result<(), String> {
    // Get old WebSocket config to check if restart needed
    let old_ws_config = {
        let state = SHARED_STATE.read();
        (
            state.settings.websocket_enabled,
            state.settings.websocket_port,
            state.settings.websocket_password.clone(),
        )
    };

    // Update atomic logging flag first (no lock)
    set_logging_enabled(settings.enable_logging);

    // Save to file
    config::save_settings(&settings)?;

    let mut state = SHARED_STATE.write();
    state.settings = settings.clone();

    // Check if WebSocket config changed
    let ws_changed = old_ws_config.0 != settings.websocket_enabled
        || old_ws_config.1 != settings.websocket_port
        || old_ws_config.2 != settings.websocket_password;

    if ws_changed {
        // Restart WebSocket server (need to release lock first)
        drop(state);
        websocket_server::restart_server(SHARED_STATE.clone());
    }

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
                resize_window,
                get_instances,
                get_popups,
                get_recent_activities,
                get_session_notification,
                get_chat_messages,
                respond_popup,
                jump_to_instance,
                refresh_instance_process,
                check_claude_hooks,
                update_claude_hooks,
                get_settings,
                update_settings,
                get_product_name,
                get_device_token
            ])
            .setup(|app| {
                // Initialize logging flag from saved settings
                {
                    let state = SHARED_STATE.read();
                    set_logging_enabled(state.settings.enable_logging);
                }

                // Auto-setup hooks on first startup
                config::auto_setup_hooks();

                let window = app.get_webview_window("main").unwrap();

                // Position window at top center, touching screen top (y=0)
                if let Ok(monitor) = window.primary_monitor() {
                    if let Some(monitor) = monitor {
                        let screen_size = monitor.size();
                        let window_width = 300u32;  // Collapsed width
                        let x = (screen_size.width - window_width) / 2;
                        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: x as i32, y: 0 }));
                    }
                }

                // Create tray menu with Quit item
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)
                    .expect("Failed to create quit menu item");
                let menu = Menu::with_items(app, &[&quit_item])
                    .expect("Failed to create tray menu");

                // Set tray menu
                let tray = app.tray_by_id("main").expect("Failed to get tray");
                tray.set_menu(Some(menu)).expect("Failed to set tray menu");
                tray.on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                });

                // Start HTTP server in background
                let server = HttpServer::new(17527);
                tokio::spawn(async move {
                    if let Err(e) = server.run().await {
                        tracing::error!("HTTP server error: {}", e);
                    }
                });

                // Start WebSocket server in background (if enabled)
                let ws_config = websocket_server::WsServerConfig {
                    port: SHARED_STATE.read().settings.websocket_port.unwrap_or(17528),
                    enabled: SHARED_STATE.read().settings.websocket_enabled,
                    password: SHARED_STATE.read().settings.websocket_password.clone(),
                };
                if ws_config.enabled {
                    let ws_server = websocket_server::WsServer::new(ws_config, SHARED_STATE.clone());
                    tokio::spawn(async move {
                        if let Err(e) = ws_server.run().await {
                            tracing::error!("WebSocket server error: {}", e);
                        }
                    });
                    tracing::info!("WebSocket server enabled on port {}", SHARED_STATE.read().settings.websocket_port.unwrap_or(17528));
                }

                tracing::info!("CC-Island started successfully");
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    });
}