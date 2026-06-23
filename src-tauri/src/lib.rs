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
pub mod alias_store;
pub mod activity_store;
pub mod history_store;
pub mod restart_config_store;

use instance_manager::InstanceManager;
use popup_queue::PopupQueue;
use chat_messages::ChatHistory;
use http_server::HttpServer;
use cloud_client::{CloudClient, CloudConfig};
use conversation_parser::ConversationParser;
use jsonl_watcher::JsonlWatcherHandle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(feature = "desktop")]
use tauri::menu::{Menu, MenuItem};

#[cfg(feature = "desktop")]
use tauri::Manager;
#[cfg(feature = "desktop")]
use tauri::Emitter;
#[cfg(feature = "desktop")]
use tauri::WebviewUrl;
#[cfg(feature = "desktop")]
use tauri::WebviewWindowBuilder;

use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::time::SystemTime;
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

/// Stats response for stats bar display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsResponse {
    pub session_count: usize,
    pub message_count: usize,
    pub tool_count: usize,
    pub active_count: usize,
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
    pub history_store: history_store::HistoryStore,
    pub desktop_window_open: bool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            instances: InstanceManager::new(),
            popups: PopupQueue::new(),
            chat_history: ChatHistory::new(),
            conversation_parser: ConversationParser::new(),
            settings: config::load_settings(),
            recent_activities: Vec::new(),
            session_notification: None,
            cloud_client: None,
            cloud_connection_status: CloudConnectionStatus::Disconnected,
            cloud_stop_signal: None,
            jsonl_watcher: None,
            history_store: history_store::HistoryStore::new(),
            desktop_window_open: false,
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

/// Handle for sending stdin input to a spawned Claude process
struct ClaudeSessionHandle {
    stdin_tx: tokio::sync::mpsc::UnboundedSender<String>,
    session_id: Option<String>,
    cwd: String,
}

/// Active Claude sessions with stdin bridges (keyed by cwd)
static CLAUDE_SESSIONS: Lazy<std::sync::Mutex<HashMap<String, ClaudeSessionHandle>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

/// Set the session_id on a cc-island-owned Claude session (called from SessionStart hook)
pub fn set_owned_session_id(cwd: &str, session_id: &str) {
    let mut map = CLAUDE_SESSIONS.lock().unwrap();
    if let Some(handle) = map.get_mut(cwd) {
        handle.session_id = Some(session_id.to_string());
        tracing::info!("Linked owned session cwd={} → session_id={}", cwd, session_id);
    }
}

/// Check if a session_id belongs to a cc-island-owned Claude session
pub fn is_owned_session(session_id: &str) -> bool {
    CLAUDE_SESSIONS.lock().unwrap()
        .values()
        .any(|h| h.session_id.as_deref() == Some(session_id))
}

/// Check if a cwd has a cc-island-owned Claude session entry
pub fn is_owned_session_by_cwd(cwd: &str) -> bool {
    CLAUDE_SESSIONS.lock().unwrap().contains_key(cwd)
}

/// End a cc-island-owned session (removes from tracking, next SessionEnd will behave normally)
pub fn end_owned_session(session_id: &str) {
    let mut map = CLAUDE_SESSIONS.lock().unwrap();
    map.retain(|_, h| h.session_id.as_deref() != Some(session_id));
    tracing::info!("Ended owned session: {}", session_id);
}

/// SQLite activity store for tool history persistence
pub static ACTIVITY_STORE: Lazy<Arc<activity_store::ActivityStore>> = Lazy::new(|| {
    match activity_store::ActivityStore::new() {
        Ok(store) => Arc::new(store),
        Err(e) => {
            tracing::error!("Failed to init activity store: {}", e);
            panic!("Activity store initialization failed - check disk space and permissions");
        }
    }
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
fn set_always_on_top(window: tauri::Window, always_on_top: bool) -> Result<(), String> {
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_skip_taskbar(window: tauri::Window, skip: bool) -> Result<(), String> {
    window.set_skip_taskbar(skip).map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn toggle_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_min_size(window: tauri::Window, width: u32, height: u32) -> Result<(), String> {
    use tauri::Size;
    window.set_min_size(Some(Size::Logical(tauri::LogicalSize { width: width as f64, height: height as f64 })))
        .map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_resizable(window: tauri::Window, resizable: bool) -> Result<(), String> {
    window.set_resizable(resizable).map_err(|e| e.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_window_label(window: tauri::Window) -> String {
    window.label().to_string()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn open_desktop_window(app: tauri::AppHandle) -> Result<(), String> {
    // Check if desktop window already exists
    if let Some(window) = app.get_webview_window("desktop") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        // Update state
        let mut state = SHARED_STATE.write();
        state.desktop_window_open = true;
        // Emit state change
        let _ = app.emit("desktop-window-state", true);
        return Ok(());
    }

    // Create new desktop window
    let window = WebviewWindowBuilder::new(&app, "desktop", WebviewUrl::App("index.html".into()))
        .title("CC-Island Desktop")
        .inner_size(1100.0, 720.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .decorations(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .center()
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Clone app handle for event handler
    let app_clone = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let window = app_clone.get_webview_window("desktop").unwrap();
            let _ = window.hide();
            let mut state = SHARED_STATE.write();
            state.desktop_window_open = false;
            let _ = app_clone.emit("desktop-window-state", false);
        }
    });

    // Update state
    let mut state = SHARED_STATE.write();
    state.desktop_window_open = true;
    let _ = app.emit("desktop-window-state", true);

    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn close_desktop_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("desktop") {
        window.hide().map_err(|e| e.to_string())?;
    }
    let mut state = SHARED_STATE.write();
    state.desktop_window_open = false;
    let _ = app.emit("desktop-window-state", false);
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_app_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    use tauri::Theme;
    let t = match theme.as_str() {
        "light" => Theme::Light,
        _ => Theme::Dark,
    };
    for (_label, window) in app.webview_windows() {
        let _ = window.set_theme(Some(t));
    }
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_desktop_window_state() -> bool {
    let state = SHARED_STATE.read();
    state.desktop_window_open
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_instances() -> Vec<instance_manager::ClaudeInstanceDisplay> {
    cleanup_dead_sessions();

    let state = SHARED_STATE.read();
    let instances = state.instances.get_all_instances_display();
    // Fill activities for each instance from ACTIVITY_STORE
    instances.into_iter().map(|inst| {
        let activities = ACTIVITY_STORE.get_activities(&inst.session_id, 200).unwrap_or_default();
        instance_manager::ClaudeInstanceDisplay {
            activities,
            ..inst
        }
    }).collect()
}

#[cfg(feature = "desktop")]
static LAST_DEAD_CHECK: AtomicU64 = AtomicU64::new(0);

#[cfg(feature = "desktop")]
fn cleanup_dead_sessions() {
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let last = LAST_DEAD_CHECK.load(Ordering::Relaxed);
    // Check at most every 5 seconds
    if now.saturating_sub(last) < 5 {
        return;
    }
    LAST_DEAD_CHECK.store(now, Ordering::Relaxed);

    // Collect PIDs to check (read lock) — skip owned sessions (they exit between turns)
    let to_check: Vec<(String, u32)> = {
        let state = SHARED_STATE.read();
        state.instances.get_all_instances()
            .iter()
            .filter(|inst| !inst.is_owned)
            .filter_map(|inst| {
                inst.process_info.as_ref().map(|pi| (inst.session_id.clone(), pi.pid))
            })
            .collect()
    };

    if to_check.is_empty() {
        return;
    }

    // Check processes outside lock
    let dead: Vec<String> = to_check
        .into_iter()
        .filter(|(_, pid)| !crate::platform::is_process_alive(*pid))
        .map(|(sid, _)| sid)
        .collect();

    if dead.is_empty() {
        return;
    }

    // Cleanup dead sessions (write lock)
    let mut state = SHARED_STATE.write();
    for session_id in &dead {
        if let Some(mut instance) = state.instances.get_instance(session_id).cloned() {
            let now = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            instance.ended_at = Some(now);
            instance.status = instance_manager::InstanceStatus::Ended;
            tracing::info!(
                "Auto-ending dead session: {} ({})",
                session_id,
                instance.project_name
            );
            state.history_store.upsert(instance);
        }
        state.instances.remove_instance(session_id);
    }
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
fn get_hostname() -> String {
    machine_id::get_hostname()
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
fn get_alias(cwd: String) -> Option<String> {
    alias_store::get_alias(&cwd)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_alias(cwd: String, alias: String) -> Result<(), String> {
    alias_store::set_alias(&cwd, &alias)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_all_aliases() -> HashMap<String, String> {
    alias_store::get_all_aliases()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_activities(session_id: String, limit: Option<i64>) -> Vec<activity_store::ToolActivityDetail> {
    let limit = limit.unwrap_or(200);
    ACTIVITY_STORE.get_activities(&session_id, limit).unwrap_or_default()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_stats() -> StatsResponse {
    let state = SHARED_STATE.read();
    let session_count = state.instances.count();
    let message_count = state.chat_history.total_count();
    let tool_count = ACTIVITY_STORE.total_count().unwrap_or(0);

    // Count active instances (working, thinking, waiting)
    let active_count = state.instances.get_all_instances()
        .iter()
        .filter(|i| {
            matches!(
                i.status,
                instance_manager::InstanceStatus::Working(_)
                    | instance_manager::InstanceStatus::Thinking
                    | instance_manager::InstanceStatus::Waiting
            )
        })
        .count();

    StatsResponse {
        session_count,
        message_count,
        tool_count,
        active_count,
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_history_sessions() -> Vec<instance_manager::ClaudeInstance> {
    let mut sessions = SHARED_STATE.read().history_store.get_ended();
    for session in &mut sessions {
        session.activities = ACTIVITY_STORE.get_activities(&session.session_id, 200).unwrap_or_default();
    }
    sessions
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn remove_history_session(session_id: String) -> Result<(), String> {
    let mut state = SHARED_STATE.write();
    state.history_store.remove(&session_id);
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_available_terminals() -> Vec<platform::TerminalInfo> {
    platform::get_available_terminals()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn restart_session(session_id: String, terminal_bundle_id: String, extra_args: String) -> Result<(), String> {
    let cwd = {
        let state = SHARED_STATE.read();
        match state.history_store.get(&session_id) {
            Some(instance) => instance.session_cwd.clone().unwrap_or_default(),
            None => return Err("Session not found in history".to_string()),
        }
    };

    let args = if extra_args.trim().is_empty() {
        String::new()
    } else {
        format!(" {}", extra_args.trim())
    };

    let command = format!("claude --resume {}{}", session_id, args);

    // Remove from history store and instance manager since it's being restarted as active
    {
        let mut state = SHARED_STATE.write();
        state.history_store.remove(&session_id);
        state.instances.remove_instance(&session_id);
    }

    tracing::info!("restart_session: cwd='{}', command='{}'", cwd, command);

    if !cwd.is_empty() {
        let command = format!("cd \"{}\" && echo \"📂 $(pwd)\" && {}", cwd, command);
        platform::launch_in_terminal(&terminal_bundle_id, &command, &cwd)
    } else {
        tracing::warn!("restart_session: cwd is empty for session {}, running without cd", session_id);
        let command = format!("echo \"⚠ cwd missing, running in $(pwd)\" && {}", command);
        platform::launch_in_terminal(&terminal_bundle_id, &command, "")
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_restart_config() -> restart_config_store::RestartConfig {
    restart_config_store::get_restart_config_snapshot()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn save_restart_preset(name: String, args: String) -> Result<(), String> {
    restart_config_store::save_restart_preset(name, args)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn delete_restart_preset(name: String) -> Result<(), String> {
    restart_config_store::delete_restart_preset(name)
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

    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn get_available_models() -> Vec<String> {
    // Try Anthropic Models API via reqwest
    let api_key = std::env::var("ANTHROPIC_API_KEY").ok();
    let base_url = std::env::var("ANTHROPIC_BASE_URL")
        .unwrap_or_else(|_| "https://api.anthropic.com".to_string());

    if let Some(key) = api_key {
        let url = format!("{}/v1/models", base_url);
        if let Ok(resp) = reqwest::Client::new()
            .get(&url)
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(models) = json["data"].as_array() {
                    let ids: Vec<String> = models
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        .collect();
                    if !ids.is_empty() {
                        return ids;
                    }
                }
            }
        }
    }

    // Fallback
    vec![
        "sonnet".to_string(),
        "opus".to_string(),
        "haiku".to_string(),
    ]
}

#[cfg(feature = "desktop")]
#[tauri::command]
async fn spawn_claude(
    project_path: String,
    prompt: Option<String>,
    model: Option<String>,
    flags: Option<Vec<String>>,
    permission_mode: Option<String>,
) -> Result<(), String> {
    use tokio::process::Command;

    tracing::info!("spawn_claude: path={}, prompt={:?}", project_path, prompt);

    let mut cmd = Command::new("claude");
    cmd.current_dir(&project_path);

    if let Some(ref m) = model {
        cmd.arg("--model").arg(m);
    }

    for flag in flags.unwrap_or_default() {
        cmd.arg(flag);
    }

    if let Some(ref mode) = permission_mode {
        cmd.arg("--permission-mode").arg(mode);
    }

    if let Some(ref p) = prompt {
        if !p.is_empty() {
            cmd.arg("-p").arg(p);
        }
    }

    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start Claude: {}", e))?;
    let child_stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    // Log stderr for debugging
    if let Some(stderr) = child_stderr {
        let cwd_dbg = project_path.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!("[claude stderr {}] {}", cwd_dbg, line);
            }
        });
    }

    // Log stdout for debugging
    if let Some(stdout) = child_stdout {
        let cwd_dbg = project_path.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let reader = tokio::io::BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!("[claude stdout {}] {}", cwd_dbg, line);
            }
        });
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let cwd = project_path.clone();
    CLAUDE_SESSIONS.lock().unwrap().insert(
        cwd.clone(),
        ClaudeSessionHandle { stdin_tx: tx, session_id: None, cwd: cwd.clone() },
    );

    tokio::spawn(async move {
        let mut stdin = child_stdin;
        loop {
            tokio::select! {
                text = rx.recv() => {
                    match text {
                        Some(t) => {
                            use tokio::io::AsyncWriteExt;
                            if stdin.write_all(t.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                status = child.wait() => {
                    tracing::debug!("Claude session at {} exited: {:?}", cwd, status.ok());
                    break;
                }
            }
        }
        // Keep entry in CLAUDE_SESSIONS for multi-turn — session_id stays
        // so http_server can check ownership in SessionEnd handler
    });

    Ok(())
}

#[tauri::command]
async fn send_claude_input(cwd: String, text: String) -> Result<(), String> {
    // Path 1: cc-island-owned session with active pipe
    {
        let map = CLAUDE_SESSIONS.lock().unwrap();
        if let Some(handle) = map.get(&cwd) {
            match handle.stdin_tx.send(text.clone()) {
                Ok(()) => return Ok(()),
                Err(_) => {
                    // Pipe closed — Claude exited between turns. Respawn below.
                    tracing::debug!("Pipe closed for {}, respawning Claude", cwd);
                }
            }
        }
    }

    // Path 2: cc-island-owned session, Claude exited — respawn with --resume
    {
        let (owned, session_id_opt) = {
            let map = CLAUDE_SESSIONS.lock().unwrap();
            match map.get(&cwd) {
                Some(h) => (true, h.session_id.clone()),
                None => (false, None),
            }
        };
        if owned {
            if let Some(sid) = session_id_opt {
                return respawn_claude_for_turn(&cwd, &sid, &text).await;
            }
        }
    }

    // Path 3: externally-launched Claude — write to /proc/<pid>/fd/0
    let state = SHARED_STATE.read();
    let instance = state.instances.get_instances_by_cwd(&cwd)
        .into_iter()
        .find(|i| i.status != instance_manager::InstanceStatus::Ended);
    match instance {
        Some(inst) => match &inst.process_info {
            Some(pi) => {
                let stdin_path = format!("/proc/{}/fd/0", pi.pid);
                std::fs::write(&stdin_path, text.as_bytes())
                    .map_err(|e| format!("Failed to write to {}: {}", stdin_path, e))
            }
            None => Err("No process info for this session".into()),
        },
        None => Err(format!("No active Claude session in {}", cwd)),
    }
}

/// Respawn Claude with --resume for the next turn in a multi-turn session
async fn respawn_claude_for_turn(cwd: &str, session_id: &str, text: &str) -> Result<(), String> {
    use tokio::process::Command;

    let mut cmd = Command::new("claude");
    cmd.current_dir(cwd);
    cmd.arg("--resume").arg(session_id);
    cmd.arg("-p").arg(text);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to respawn Claude: {}", e))?;
    let child_stdin = child.stdin.take().ok_or("Failed to capture stdin")?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let cwd_owned = cwd.to_string();

    // Update the CLAUDE_SESSIONS entry with new pipe
    {
        let mut map = CLAUDE_SESSIONS.lock().unwrap();
        if let Some(handle) = map.get_mut(&cwd_owned) {
            handle.stdin_tx = tx;
        }
    }

    tokio::spawn(async move {
        let mut stdin = child_stdin;
        loop {
            tokio::select! {
                text = rx.recv() => {
                    match text {
                        Some(t) => {
                            use tokio::io::AsyncWriteExt;
                            if stdin.write_all(t.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                status = child.wait() => {
                    tracing::debug!("Claude session at {} (resume) exited: {:?}", cwd_owned, status.ok());
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn end_owned_session_cmd(cwd: String) -> Result<(), String> {
    let session_id = {
        let map = CLAUDE_SESSIONS.lock().unwrap();
        map.get(&cwd).and_then(|h| h.session_id.clone())
    };
    match session_id {
        Some(sid) => {
            // Remove from owned tracking — next SessionEnd will behave normally
            crate::end_owned_session(&sid);

            // If Claude already exited (idle), manually move to history
            let mut state = SHARED_STATE.write();
            if let Some(instance) = state.instances.get_instance_mut(&sid) {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                instance.ended_at = Some(now);
                instance.status = crate::instance_manager::InstanceStatus::Ended;
                let clone_for_history = instance.clone();
                state.history_store.upsert(clone_for_history);
            }
            state.instances.remove_instance(&sid);
            if let Some(ref mut watcher) = state.jsonl_watcher {
                watcher.unwatch_session(&sid);
            }

            Ok(())
        }
        None => Err("No owned session for this cwd".into()),
    }
}

pub fn end_owned_session_by_id(session_id: &str) {
    crate::end_owned_session(session_id);
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
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                // When second instance tries to start, focus both existing windows
                let _ = app.get_webview_window("main").map(|w| {
                    w.set_focus().ok();
                    w.show().ok();
                });
                let _ = app.get_webview_window("desktop").map(|w| {
                    w.set_focus().ok();
                    w.show().ok();
                });
            }))
            .invoke_handler(tauri::generate_handler![
                start_drag,
                resize_window,
                set_always_on_top,
                set_skip_taskbar,
                minimize_window,
                close_window,
                toggle_maximize,
                set_min_size,
                set_resizable,
                get_window_label,
                open_desktop_window,
                close_desktop_window,
                show_main_window,
                get_desktop_window_state,
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
                get_hostname,
                get_device_token,
                get_cloud_connection_status,
                set_app_theme,
                generate_device_qrcode,
                get_alias,
                set_alias,
                get_all_aliases,
                get_activities,
                get_stats,
                get_history_sessions,
                get_available_models,
                spawn_claude,
                send_claude_input,
                end_owned_session_cmd,
                remove_history_session,
                get_available_terminals,
                restart_session,
                get_restart_config,
                save_restart_preset,
                delete_restart_preset,
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

                // On macOS, non-key transparent windows do NOT receive mouseEnter events
                // by default. Without this, the island won't auto-expand on hover unless
                // the user clicks it first to make it active.
                #[cfg(target_os = "macos")]
                {
                    use objc::{sel, sel_impl};
                    let ns_window = window.ns_window().expect("Failed to get NSWindow handle");
                    unsafe {
                        let _: () = objc::msg_send!(ns_window as *mut objc::runtime::Object, setAcceptsMouseMovedEvents: true);
                    }
                    tracing::info!("Set acceptsMouseMovedEvents=YES on NSWindow");
                }

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

                // Periodic popup maintenance (every 1s)
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                        let mut state = SHARED_STATE.write();
                        // Check for timeouts and auto-resolve expired popups
                        state.popups.check_timeouts();
                        // Remove resolved/auto-closed popups after 1s display grace
                        state.popups.cleanup();
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