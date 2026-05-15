// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
pub mod http_server;
pub mod instance_manager;
pub mod popup_queue;
pub mod hook_handler;
pub mod platform;
pub mod config;
pub mod chat_messages;
pub mod machine_id;
pub mod cloud_client;
pub mod conversation_parser;
pub mod jsonl_watcher;
pub mod apm;

use instance_manager::InstanceManager;
use popup_queue::PopupQueue;
use chat_messages::ChatHistory;
use http_server::HttpServer;
use cloud_client::{CloudClient, CloudConfig};
use conversation_parser::ConversationParser;
use jsonl_watcher::JsonlWatcherHandle;
use serde::{Deserialize, Serialize};

#[cfg(feature = "desktop")]
use tauri::menu::{Menu, MenuItem};

#[cfg(feature = "desktop")]
use tauri::Manager;

use std::sync::Arc;
use parking_lot::RwLock;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock as AsyncRwLock;

/// Ensure device_name has a value (use hostname if empty)
fn ensure_device_name(settings: &mut config::AppSettings) {
    tracing::info!("ensure_device_name called: current device_name = {:?}", settings.device_name);
    if settings.device_name.is_none() || settings.device_name.as_ref().map(|n| n.is_empty()).unwrap_or(true) {
        settings.device_name = Some(machine_id::get_hostname());
        tracing::info!("Device name set to hostname: {:?}", settings.device_name);
    } else {
        tracing::info!("Device name already set, keeping: {:?}", settings.device_name);
    }
}

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

/// Cloud connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "message")]
pub enum CloudConnectionStatus {
    Disconnected,   // Not configured or disabled
    Connecting,     // Attempting to connect
    Connected,      // Successfully connected
    #[serde(rename = "Failed")]
    Failed(String), // Connection failed with error message
}

/// Global state shared between HTTP server and frontend
pub struct AppState {
    pub instances: InstanceManager,
    pub popups: PopupQueue,
    pub chat_history: ChatHistory,
    pub conversation_parser: ConversationParser,
    pub settings: config::AppSettings,
    pub recent_activities: Vec<ToolActivity>,
    pub session_notification: Option<SessionNotification>,
    pub cloud_client: Option<Arc<AsyncRwLock<CloudClient>>>,
    pub cloud_connection_status: CloudConnectionStatus,
    pub cloud_stop_signal: Option<tokio::sync::watch::Sender<bool>>,  // Stop signal for reconnect loop
    pub jsonl_watcher: Option<JsonlWatcherHandle>,  // JSONL file watcher
    pub apm_collector: Option<Arc<apm::ApmCollector>>,  // APM data collector
}

impl AppState {
    pub fn new() -> Self {
        let settings = config::load_settings();

        // Initialize APM collector if enabled
        let apm_collector = if settings.apm_enabled {
            Some(apm::ApmCollector::new(&settings))
        } else {
            None
        };

        Self {
            instances: InstanceManager::new(),
            popups: PopupQueue::new(),
            chat_history: ChatHistory::new(),
            conversation_parser: ConversationParser::new(),
            settings,
            recent_activities: Vec::new(),
            session_notification: None,
            cloud_client: None,
            cloud_connection_status: CloudConnectionStatus::Disconnected,
            cloud_stop_signal: None,
            jsonl_watcher: None,
            apm_collector,
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

// Tauri commands (only available in desktop mode)
#[cfg(feature = "desktop")]
#[tauri::command]
fn start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn resize_window(window: tauri::Window, width: u32, height: u32) -> Result<(), String> {
    use tauri::{Size, Position};

    // Get current window position
    let current_position = window.outer_position().map_err(|e| e.to_string())?;
    // Convert physical position to logical
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let current_x = current_position.x as f64 / scale_factor;
    let current_y = current_position.y as f64 / scale_factor;

    // Get current size to determine if this is an expand or collapse
    let current_size = window.outer_size().map_err(|e| e.to_string())?;
    let current_width = current_size.width as f64 / scale_factor;

    // Calculate new X position: keep the window center-aligned relative to current position
    // If currently at position X with width W, after resize to new width W':
    // New X = X + (W - W') / 2 (this keeps the center point fixed)
    let new_x = current_x + (current_width - width as f64) / 2.0;

    // Keep current Y position (don't reset to top)
    let new_y = current_y;

    // Ensure window stays within screen bounds
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?;
    if let Some(monitor) = monitor {
        let physical_size = monitor.size();
        let logical_screen_width = physical_size.width as f64 / monitor.scale_factor();

        // Clamp X to keep window on screen
        let clamped_x = new_x.max(0.0).min(logical_screen_width - width as f64);

        window.set_position(Position::Logical(tauri::LogicalPosition { x: clamped_x, y: new_y }))
            .map_err(|e| e.to_string())?;
    } else {
        // No monitor info, just use calculated position
        window.set_position(Position::Logical(tauri::LogicalPosition { x: new_x, y: new_y }))
            .map_err(|e| e.to_string())?;
    }

    // Set new size using Logical coordinates (DPI-aware)
    window
        .set_size(Size::Logical(tauri::LogicalSize { width: width as f64, height: height as f64 }))
        .map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_instances() -> Vec<instance_manager::ClaudeInstanceDisplay> {
    let state = SHARED_STATE.read();
    state.instances.get_all_instances_display()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_popups() -> Vec<popup_queue::PopupItem> {
    let state = SHARED_STATE.read();
    state.popups.get_all()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_recent_activities() -> Vec<ToolActivity> {
    let state = SHARED_STATE.read();
    state.get_display_activities().into_iter().cloned().collect()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_session_notification() -> Option<SessionNotification> {
    let mut state = SHARED_STATE.write();
    state.get_session_notification()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_chat_messages(session_id: String) -> Vec<chat_messages::ChatMessage> {
    // First get cwd with read lock (no mutation needed)
    let cwd = {
        let state = SHARED_STATE.read();
        state.instances.get_instance(&session_id)
            .and_then(|i| i.session_cwd.clone())
            .or_else(|| {
                state.instances.get_instance(&session_id)
                    .and_then(|i| i.process_info.as_ref())
                    .map(|p| p.working_directory.clone())
            })
    };

    // Parse JSONL with write lock (needs to update cache)
    if let Some(cwd) = cwd {
        let mut state = SHARED_STATE.write();
        let messages = state.conversation_parser.parse_full(&session_id, &cwd);
        if !messages.is_empty() {
            return conversation_parser::ConversationParser::to_chat_messages(messages);
        }
    }

    // Fallback: search all project directories for JSONL file
    {
        let mut state = SHARED_STATE.write();
        let messages = state.conversation_parser.parse_full_without_cwd(&session_id);
        if !messages.is_empty() {
            return conversation_parser::ConversationParser::to_chat_messages(messages);
        }
    }

    // Final fallback: hook-based chat history
    let state = SHARED_STATE.read();
    state.chat_history.get_messages(&session_id)
}

#[cfg(feature = "desktop")]
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
        if let Some(ref popup) = popup_info {
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

        // Push PopupResolved to cloud (notify mobiles) - get cloud_client before releasing lock
        let cloud_client_ref = state.cloud_client.clone();
        let session_id_for_cloud = popup_info.as_ref().map(|p| p.session_id.clone());

        // Release the write lock before async operation
        drop(state);

        // Push PopupResolved to cloud (notify mobiles)
        if let Some(cloud_client) = cloud_client_ref {
            if let Some(session_id) = session_id_for_cloud {
                // Use try_read for non-blocking access to CloudClient
                if let Ok(client) = cloud_client.try_read() {
                    tracing::info!("📤 push_popup_resolved: popup={}, session={}, decision={:?}",
                        popup_id, session_id, decision);
                    client.push_popup_resolved(
                        &popup_id,
                        &session_id,
                        decision.as_deref(),
                        answers.as_ref(),
                    );
                } else {
                    tracing::warn!("📤 push_popup_resolved: cannot acquire cloud_client lock");
                }
            }
        }

        Ok(())
    } else {
        Err("Popup not found or already resolved".to_string())
    }
}

#[cfg(feature = "desktop")]
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

#[cfg(feature = "desktop")]
#[tauri::command]
fn refresh_instance_process(session_id: String) -> Result<(), String> {
    refresh_instance_process_internal(&session_id)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn check_claude_hooks() -> config::HooksCheckResult {
    config::check_claude_hooks_config()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn update_claude_hooks(hooks: Vec<String>) -> Result<(), String> {
    config::update_claude_hooks_config(hooks)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_settings() -> config::AppSettings {
    let state = SHARED_STATE.read();
    state.settings.clone()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_product_name(app: tauri::AppHandle) -> String {
    app.config().product_name.clone().unwrap_or_else(|| "CC-Island".to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_device_token() -> String {
    machine_id::get_machine_token()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_cloud_connection_status() -> CloudConnectionStatus {
    SHARED_STATE.read().cloud_connection_status.clone()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn generate_device_qrcode(server_url: String) -> Result<String, String> {
    let device_token = machine_id::get_machine_token();

    let payload = serde_json::json!({
        "device_token": device_token,
        "server_url": server_url,
    }).to_string();

    use qrcode::QrCode;
    use qrcode::render::svg;

    let code = QrCode::new(payload)
        .map_err(|e| format!("QR generation failed: {}", e))?;

    let svg = code
        .render()
        .min_dimensions(200, 200)
        .dark_color(svg::Color("#ffffff"))
        .light_color(svg::Color("#000000"))
        .build();

    Ok(svg)
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn apply_otel_config(otel_enabled: bool, otel_endpoint: String) -> Result<(), String> {
    use std::fs;

    // Get Claude settings path
    let claude_dir = dirs::home_dir()
        .map(|h| h.join(".claude"))
        .ok_or("Cannot find home directory")?;

    let settings_path = claude_dir.join("settings.json");

    // Read existing settings or create new
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Update env section
    if otel_enabled {
        settings["env"] = serde_json::json!({
            "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
            "OTEL_METRICS_EXPORTER": "otlp",
            "OTEL_LOGS_EXPORTER": "otlp",
            "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
            "OTEL_EXPORTER_OTLP_ENDPOINT": otel_endpoint,
        });
    } else {
        // Remove OTel env if disabled
        if let Some(env) = settings.get_mut("env") {
            if let Some(env_obj) = env.as_object_mut() {
                env_obj.remove("CLAUDE_CODE_ENABLE_TELEMETRY");
                env_obj.remove("OTEL_METRICS_EXPORTER");
                env_obj.remove("OTEL_LOGS_EXPORTER");
                env_obj.remove("OTEL_EXPORTER_OTLP_PROTOCOL");
                env_obj.remove("OTEL_EXPORTER_OTLP_ENDPOINT");
            }
        }
    }

    // Write back
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| e.to_string())?;
    fs::write(&settings_path, content)
        .map_err(|e| e.to_string())?;

    tracing::info!("OTel config applied: enabled={}, endpoint={}", otel_enabled, otel_endpoint);
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn update_settings(settings: config::AppSettings) -> Result<(), String> {
    // Validate cloud mode settings
    if settings.cloud_mode {
        if settings.cloud_server_url.is_none() || settings.cloud_server_url.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            return Err("启用远程访问时必须配置云服务器地址".to_string());
        }
        // Validate URL format
        if let Some(ref url) = settings.cloud_server_url {
            if !url.starts_with("ws://") && !url.starts_with("wss://") {
                return Err("云服务器地址必须以 ws:// 或 wss:// 开头".to_string());
            }
        }
    }

    // Update atomic logging flag first (no lock)
    set_logging_enabled(settings.enable_logging);

    // Get old cloud config to check if restart needed
    let old_cloud_config = {
        let state = SHARED_STATE.read();
        (
            state.settings.cloud_mode,
            state.settings.cloud_server_url.clone(),
        )
    };

    // Get old APM config to check if restart needed
    let old_apm_config = {
        let state = SHARED_STATE.read();
        (
            state.settings.apm_enabled,
            state.settings.apm_server_url.clone(),
            state.settings.apm_user_id.clone(),
        )
    };

    // Save to file
    config::save_settings(&settings)?;
    tracing::info!("Settings saved to file");

    // Update state
    {
        let mut state = SHARED_STATE.write();
        state.settings = settings.clone();
    }

    // Check if cloud config changed - reconnect if needed
    let cloud_changed = old_cloud_config.0 != settings.cloud_mode
        || old_cloud_config.1 != settings.cloud_server_url;

    if cloud_changed && settings.cloud_mode {
        // Stop existing connection first
        stop_cloud_client();

        // Start/restart Cloud client with reconnect
        if let Some(ref url) = settings.cloud_server_url {
            let url_clone = url.clone();
            let device_name = settings.device_name.clone();

            tracing::info!("Cloud mode enabled, connecting to {}", url_clone);
            start_cloud_with_reconnect(url_clone, device_name);
        }
    } else if !settings.cloud_mode && old_cloud_config.0 {
        // Cloud mode disabled - stop connection
        stop_cloud_client();
        tracing::info!("Cloud mode disabled");
    }

    // Check if APM config changed - reinit collector if needed
    let apm_changed = old_apm_config.0 != settings.apm_enabled
        || old_apm_config.1 != settings.apm_server_url
        || old_apm_config.2 != settings.apm_user_id;

    if apm_changed {
        // Reinitialize APM collector
        let new_collector = if settings.apm_enabled && settings.apm_server_url.is_some() {
            Some(apm::ApmCollector::new(&settings))
        } else {
            None
        };

        // Update state with new collector
        {
            let mut state = SHARED_STATE.write();
            state.apm_collector = new_collector;
        }

        tracing::info!(
            "APM collector reinitialized: enabled={}, url={}",
            settings.apm_enabled,
            settings.apm_server_url.as_ref().map(|s| s.as_str()).unwrap_or("none")
        );
    }

    Ok(())
}

/// Start cloud client with automatic reconnect
/// Returns stop signal sender
fn start_cloud_with_reconnect(server_url: String, device_name: Option<String>) -> tokio::sync::watch::Sender<bool> {
    use tokio::sync::watch::{channel, Sender, Receiver};
    use std::time::Duration;

    const RECONNECT_INTERVAL: Duration = Duration::from_secs(5);

    let (stop_tx, stop_rx): (Sender<bool>, Receiver<bool>) = channel(false);
    let stop_tx_clone = stop_tx.clone();

    let app_state = SHARED_STATE.clone();
    let cloud_config = CloudConfig {
        server_url,
        device_name,
    };

    // Set status to Connecting (don't wait for success)
    SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Connecting;

    // Spawn reconnect loop (async, non-blocking)
    tokio::spawn(async move {
        let mut attempt = 0u32;

        // Initialize cloud client inside async block
        let cloud_client = CloudClient::new(app_state.clone(), cloud_config);
        let cloud_client_arc = Arc::new(AsyncRwLock::new(cloud_client));
        let connected_arc = {
            let client = cloud_client_arc.read().await;
            client.get_connected_arc()
        };

        // Store in app state
        {
            let mut state = SHARED_STATE.write();
            state.cloud_client = Some(cloud_client_arc.clone());
            state.cloud_stop_signal = Some(stop_tx_clone);
        }

        tracing::info!("Cloud reconnect loop started, will keep retrying on failure");

        loop {
            // Check stop signal
            if *stop_rx.borrow() {
                tracing::info!("Cloud client stopped by signal");
                break;
            }

            // Set Connecting status before each attempt (简洁提示，不显示技术细节)
            SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Connecting;

            tracing::info!("Attempting cloud connection (attempt {})", attempt + 1);

            // Try to connect
            let connect_result = {
                let mut client = cloud_client_arc.write().await;
                client.connect().await.map_err(|e| format!("{}", e))
            };

            if let Err(error_msg) = connect_result {
                tracing::error!("Cloud connection error: {}", error_msg);
                *connected_arc.write() = false;

                attempt += 1;

                // Update status immediately on failure (show detailed error message)
                let error_display = if error_msg.contains("certificate") || error_msg.contains("SSL") || error_msg.contains("TLS") {
                    "证书验证失败".to_string()
                } else if error_msg.contains("timeout") {
                    "连接超时".to_string()
                } else if error_msg.contains("refused") || error_msg.contains("connection") {
                    "网络连接失败".to_string()
                } else {
                    error_msg.clone()
                };

                SHARED_STATE.write().cloud_connection_status =
                    CloudConnectionStatus::Failed(format!("{} (第{}次)", error_display, attempt));

                // Wait before retry (no max limit - keep retrying forever)
                tokio::time::sleep(RECONNECT_INTERVAL).await;
                continue;
            }

            // Connection successful
            tracing::info!("Cloud connection established");
            SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Connected;
            attempt = 0;

            // Wait for disconnect (monitor connected status)
            loop {
                if *stop_rx.borrow() {
                    tracing::info!("Stop signal received, breaking");
                    break;
                }

                if !*connected_arc.read() {
                    tracing::info!("Connection lost, will reconnect");
                    break;
                }

                // Poll every 1 second
                tokio::time::sleep(Duration::from_secs(1)).await;
            }

            // Check if we should stop
            if *stop_rx.borrow() {
                break;
            }

            // Update status before reconnect
            SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Connecting;

            // Wait before reconnect
            tracing::info!("Will reconnect in {} seconds", RECONNECT_INTERVAL.as_secs());
            tokio::time::sleep(RECONNECT_INTERVAL).await;
        }

        // Cleanup
        *connected_arc.write() = false;
        SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Disconnected;
        tracing::info!("Cloud client run loop ended");
    });

    stop_tx
}

/// Stop cloud client reconnect loop
fn stop_cloud_client() {
    if let Some(stop_tx) = SHARED_STATE.write().cloud_stop_signal.take() {
        let _ = stop_tx.send(true);
    }
    SHARED_STATE.write().cloud_client = None;
    SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Disconnected;
}

/// Initialize tracing with file output (call once at startup)
fn init_tracing() {
    let log_dir = config::get_cc_island_dir();
    let file_appender = tracing_appender::rolling::daily(log_dir, "cc-island.log");

    tracing_subscriber::fmt()
        .with_writer(file_appender)
        .with_ansi(false)  // Disable colors for file output
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();
}

/// Run with Tauri UI (desktop mode only)
#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing with file output
    init_tracing();

    tracing::info!("CC-Island starting in UI mode...");

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
                get_device_token,
                get_cloud_connection_status,
                generate_device_qrcode,
                apply_otel_config
            ])
            .setup(|app| {
                // Ensure device_name has value (use hostname if empty)
                {
                    let mut state = SHARED_STATE.write();
                    ensure_device_name(&mut state.settings);
                    if let Err(e) = config::save_settings(&state.settings) {
                        tracing::warn!("Failed to save device_name: {}", e);
                    }
                }

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
                        // Get scale factor for DPI conversion
                        let scale_factor = monitor.scale_factor();
                        let physical_size = monitor.size();
                        let logical_screen_width = physical_size.width as f64 / scale_factor;
                        let window_width = 300.0;  // Collapsed width (logical)
                        let x = (logical_screen_width - window_width) / 2.0;
                        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 0.0 }));
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

                // Initialize and start JSONL watcher
                {
                    let mut state = SHARED_STATE.write();
                    let mut watcher = JsonlWatcherHandle::new(SHARED_STATE.clone());
                    watcher.start();
                    state.jsonl_watcher = Some(watcher);
                    tracing::info!("JSONL watcher initialized");
                }

                // Start Cloud client in background with reconnect (if enabled)
                {
                    let state = SHARED_STATE.read();
                    if state.settings.cloud_mode {
                        if let Some(ref url) = state.settings.cloud_server_url {
                            let url_clone = url.clone();
                            let device_name = state.settings.device_name.clone();
                            drop(state);

                            tracing::info!("Cloud mode enabled at startup, connecting to {}", url_clone);
                            start_cloud_with_reconnect(url_clone, device_name);
                        } else {
                            tracing::warn!("Cloud mode enabled but no server URL configured");
                            SHARED_STATE.write().cloud_connection_status = CloudConnectionStatus::Failed("未配置云服务器地址".to_string());
                        }
                    }
                }

                tracing::info!("CC-Island started successfully");
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    });
}

/// Run in background mode (no UI)
/// Suitable for server/headless deployment
pub fn run_background() {
    // Initialize tracing with file output
    init_tracing();

    tracing::info!("CC-Island starting in background mode...");

    // Ensure device_name has value (use hostname if empty)
    {
        let mut state = SHARED_STATE.write();
        ensure_device_name(&mut state.settings);
        tracing::info!("Device name: {:?}", state.settings.device_name);
        if let Err(e) = config::save_settings(&state.settings) {
            tracing::warn!("Failed to save device_name: {}", e);
        }
    }

    // Run background logic
    run_background_logic();
}

/// Background mode logic (shared between run_background and run_background_temporary)
fn run_background_logic() {

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

    rt.block_on(async {
        // Initialize logging flag from saved settings
        {
            let state = SHARED_STATE.read();
            set_logging_enabled(state.settings.enable_logging);
            tracing::info!("Logging enabled: {}", state.settings.enable_logging);
        }

        // Auto-setup hooks on startup
        config::auto_setup_hooks();

        // Start HTTP server
        tracing::info!("Starting HTTP server on port 17527...");
        let server = HttpServer::new(17527);
        tokio::spawn(async move {
            if let Err(e) = server.run().await {
                tracing::error!("HTTP server error: {}", e);
            }
        });

        // Initialize and start JSONL watcher
        {
            let mut state = SHARED_STATE.write();
            let mut watcher = JsonlWatcherHandle::new(SHARED_STATE.clone());
            watcher.start();
            state.jsonl_watcher = Some(watcher);
            tracing::info!("JSONL watcher initialized");
        }

        // Start Cloud client (if configured)
        {
            let state = SHARED_STATE.read();
            if state.settings.cloud_mode {
                if let Some(ref url) = state.settings.cloud_server_url {
                    let url_clone = url.clone();
                    let device_name = state.settings.device_name.clone();
                    drop(state);

                    tracing::info!("Cloud mode enabled, connecting to {}", url_clone);
                    start_cloud_with_reconnect(url_clone, device_name);
                } else {
                    tracing::warn!("Cloud mode enabled but no server URL configured");
                }
            } else {
                tracing::info!("Cloud mode disabled");
            }
        }

        // Initialize APM collector (if configured)
        {
            let state = SHARED_STATE.read();
            if state.settings.apm_enabled {
                if state.settings.apm_server_url.is_some() {
                    tracing::info!(
                        "APM enabled, collecting data to {}",
                        state.settings.apm_server_url.as_ref().unwrap()
                    );
                    // APM collector is already initialized in AppState::new()
                    // Just log the status here
                } else {
                    tracing::warn!("APM enabled but no server URL configured");
                }
            } else {
                tracing::info!("APM disabled");
            }
        }

        tracing::info!("CC-Island background mode started successfully");

        // Print pairing info for Mobile
        {
            let state = SHARED_STATE.read();
            let device_token = machine_id::get_machine_token();
            tracing::info!("=== Pairing Info for Mobile App ===");
            tracing::info!("Device Token: {}", device_token);
            tracing::info!("Device Name: {}", state.settings.device_name.clone().unwrap_or_default());
            if let Some(url) = &state.settings.cloud_server_url {
                tracing::info!("Server URL: {}", url);
                tracing::info!("Status: Cloud mode enabled ✓");
            } else {
                tracing::info!("Server URL: (not configured)");
                tracing::info!("Status: Cloud mode disabled - run 'cc-island --config --cloud-mode' to enable");
            }
            tracing::info!("====================================");
        }

        tracing::info!("Press Ctrl+C to stop...");

        // Wait for termination signal
        tokio::signal::ctrl_c().await.ok();
        tracing::info!("Received Ctrl+C, shutting down...");

        // Cleanup
        stop_cloud_client();

        tracing::info!("CC-Island background mode stopped");
    });
}

/// Show current configuration
pub fn show_config() {
    let settings = config::load_settings();
    println!("Current CC-Island Configuration:");
    println!("==================");
    println!("{}", serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "Failed to serialize".to_string()));
}

/// Show pairing info for Mobile App
pub fn show_pair_info() {
    let settings = config::load_settings();
    let device_token = machine_id::get_machine_token();
    let device_name = settings.device_name.clone().unwrap_or_else(|| machine_id::get_hostname());
    let server_url = settings.cloud_server_url.clone();

    println!("CC-Island Pairing Information");
    println!("==============================");
    println!();
    println!("Device Token: {}", device_token);
    println!("Device Name:  {}", device_name);
    if let Some(url) = &server_url {
        println!("Server URL:   {}", url);
    } else {
        println!("Server URL:   (not configured)");
    }
    println!();

    if settings.cloud_mode && server_url.is_some() {
        println!("✓ Cloud mode enabled and server configured");
        println!();
        println!("使用方法：");
        println!("1. 在 Mobile App Settings 中点击 '+' 添加设备");
        println!("2. 输入 Device Token: {}", device_token);
        println!("3. 输入 Server URL: {}", server_url.unwrap());
        println!("4. 确保本程序在后台运行 (cc-island --background)");
    } else if !settings.cloud_mode {
        println!("⚠ Cloud mode is DISABLED");
        println!();
        println!("请先启用 cloud mode:");
        println!("  cc-island --config --cloud-mode --cloud-server-url ws://your-server:17528");
    } else {
        println!("⚠ Server URL not configured");
        println!();
        println!("请先配置 server URL:");
        println!("  cc-island --config --cloud-server-url ws://your-server:17528");
    }
}

/// Parse command line arguments and update settings
/// Returns updated settings
fn parse_config_args(args: &[String]) -> config::AppSettings {
    let mut settings = config::load_settings();

    // Helper to find argument value
    fn get_arg_value(args: &[String], flag: &str) -> Option<String> {
        for i in 0..args.len() {
            if args[i] == flag && i + 1 < args.len() {
                return Some(args[i + 1].clone());
            }
            // Support --flag=value format
            if args[i].starts_with(flag) && args[i].contains('=') {
                return Some(args[i].split('=').nth(1).unwrap_or("").to_string());
            }
        }
        None
    }

    // Helper to check boolean flag
    fn has_flag(args: &[String], flag: &str) -> bool {
        args.contains(&flag.to_string())
    }

    // Parse numeric values
    if let Some(v) = get_arg_value(args, "--permission-timeout") {
        settings.permission_timeout = v.parse().unwrap_or(300);
    }
    if let Some(v) = get_arg_value(args, "--ask-timeout") {
        settings.ask_timeout = v.parse().unwrap_or(120);
    }
    if let Some(v) = get_arg_value(args, "--poll-interval") {
        settings.poll_interval = v.parse().unwrap_or(500);
    }
    if let Some(v) = get_arg_value(args, "--max-instances") {
        settings.max_instances = v.parse().unwrap_or(10);
    }
    if let Some(v) = get_arg_value(args, "--max-popup-queue") {
        settings.max_popup_queue = v.parse().unwrap_or(5);
    }
    if let Some(v) = get_arg_value(args, "--warning-time") {
        settings.warning_time = v.parse().unwrap_or(30);
    }
    if let Some(v) = get_arg_value(args, "--critical-time") {
        settings.critical_time = v.parse().unwrap_or(10);
    }
    if let Some(v) = get_arg_value(args, "--notification-auto-close") {
        settings.notification_auto_close = v.parse().unwrap_or(5000);
    }

    // Parse boolean flags
    if has_flag(args, "--auto-deny-on-timeout") {
        settings.auto_deny_on_timeout = true;
    }
    if has_flag(args, "--no-auto-deny-on-timeout") {
        settings.auto_deny_on_timeout = false;
    }
    if has_flag(args, "--auto-allow-permissions") {
        settings.auto_allow_permissions = true;
    }
    if has_flag(args, "--no-auto-allow-permissions") {
        settings.auto_allow_permissions = false;
    }
    if has_flag(args, "--enable-logging") {
        settings.enable_logging = true;
    }
    if has_flag(args, "--no-enable-logging") {
        settings.enable_logging = false;
    }
    if has_flag(args, "--show-notifications") {
        settings.show_notifications = true;
    }
    if has_flag(args, "--no-show-notifications") {
        settings.show_notifications = false;
    }
    if has_flag(args, "--cloud-mode") {
        settings.cloud_mode = true;
    }
    if has_flag(args, "--no-cloud-mode") {
        settings.cloud_mode = false;
    }
    if has_flag(args, "--show-thinking-messages") {
        settings.show_thinking_messages = true;
    }
    if has_flag(args, "--no-show-thinking-messages") {
        settings.show_thinking_messages = false;
    }

    // Parse string values
    if let Some(v) = get_arg_value(args, "--hook-forward-url") {
        settings.hook_forward_url = Some(v);
    }
    if let Some(v) = get_arg_value(args, "--cloud-server-url") {
        settings.cloud_server_url = Some(v);
    }
    if let Some(v) = get_arg_value(args, "--device-name") {
        tracing::info!("CLI --device-name detected: {}", v);
        settings.device_name = Some(v);
    }

    // Parse enabled hooks (comma-separated)
    if let Some(v) = get_arg_value(args, "--enabled-hooks") {
        settings.enabled_hooks = v.split(',').map(|s| s.trim().to_string()).collect();
    }

    settings
}

/// Run in config mode: parse args and save settings
pub fn run_config(args: &[String]) {
    let settings = parse_config_args(args);

    // Save settings
    match config::save_settings(&settings) {
        Ok(_) => {
            println!("Configuration saved successfully!");
            println!("\nNew configuration:");
            println!("{}", serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "Failed to serialize".to_string()));
        }
        Err(e) => {
            eprintln!("Failed to save configuration: {}", e);
        }
    }
}

/// Run in background mode with command line argument overrides (temporary, NOT saved)
/// Priority: CLI args > config file > defaults
pub fn run_background_temporary(args: &[String]) {
    // Initialize tracing with file output
    init_tracing();

    tracing::info!("CC-Island starting in background mode (temporary)...");

    // Apply command line overrides to settings (DO NOT save)
    let mut settings = parse_config_args(args);

    tracing::info!("Settings after CLI parse: device_name={:?}, cloud_mode={}", settings.device_name, settings.cloud_mode);

    // Ensure device_name has value (use hostname if empty)
    ensure_device_name(&mut settings);

    tracing::info!("Settings after ensure_device_name: device_name={:?}", settings.device_name);

    // Update global state with temporary settings
    {
        let mut state = SHARED_STATE.write();
        state.settings = settings.clone();
    }

    // Run background logic (settings not saved to file)
    run_background_logic();
}

/// Configuration management: set and save settings (persistent)
pub fn config_set(args: &[String]) {
    let settings = parse_config_args(args);

    // Save settings permanently
    match config::save_settings(&settings) {
        Ok(_) => {
            println!("Configuration saved successfully!");
            println!("\nNew configuration:");
            println!("{}", serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "Failed to serialize".to_string()));
        }
        Err(e) => {
            eprintln!("Failed to save configuration: {}", e);
        }
    }
}

/// Configuration management: reset to defaults
pub fn config_reset() {
    let default_settings = config::AppSettings::default();

    match config::save_settings(&default_settings) {
        Ok(_) => {
            println!("Configuration reset to defaults!");
            println!("\nDefault configuration:");
            println!("{}", serde_json::to_string_pretty(&default_settings).unwrap_or_else(|_| "Failed to serialize".to_string()));
        }
        Err(e) => {
            eprintln!("Failed to reset configuration: {}", e);
        }
    }
}