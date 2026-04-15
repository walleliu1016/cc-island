use axum::{
    extract::State,
    routing::{get, post, put},
    http::StatusCode,
    Json, Router,
};
use tower_http::cors::{Any, CorsLayer};
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::oneshot;

use crate::{AppState, SHARED_STATE};
use crate::config;
use crate::instance_manager::{ClaudeInstance, ClaudeInstanceDisplay, InstanceStatus};
use crate::popup_queue::{PopupItem, PopupResponse, PopupType, PopupStatus, AskData, AskQuestion};
use crate::hook_handler::{HookInput, HookOutput, HookSpecificOutput, PermissionData, ElicitationQuestion, DecisionOutput};
use crate::chat_messages::{ChatMessage, MessageType};
use crate::websocket_server;

/// HTTP Server for receiving Claude Code hooks
pub struct HttpServer {
    port: u16,
}

impl HttpServer {
    pub fn new(port: u16) -> Self {
        Self { port }
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let app = Router::new()
            .route("/hook", post(handle_hook))
            .route("/response", post(handle_response))
            .route("/jump", post(handle_jump))
            .route("/instances", get(get_instances))
            .route("/popups", get(get_popups))
            .route("/chat/:session_id", get(get_chat_messages_http))
            .route("/instance/:id", get(get_instance).delete(delete_instance))
            .route("/settings", get(get_settings).put(update_settings))
            .route("/position", put(update_position))
            .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any))
            .with_state(SHARED_STATE.clone());

        let addr = format!("127.0.0.1:{}", self.port);
        tracing::info!("HTTP server listening on {}", addr);

        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

/// Handle incoming hook from Claude Code
async fn handle_hook(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(input): Json<HookInput>,
) -> Result<Json<HookOutput>, StatusCode> {
    // Log complete hook JSON to file if logging enabled (async, no lock)
    if crate::is_logging_enabled() {
        let log_entry = format!(
            "[{}] {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            serde_json::to_string(&input).unwrap_or_else(|_| "serialize error".to_string())
        );
        crate::write_log(&log_entry);
    }

    // Async forward hook to configured URL
    let forward_url = {
        let state_guard = state.read();
        state_guard.settings.hook_forward_url.clone()
    };
    if let Some(url) = forward_url {
        if !url.is_empty() {
            let input_clone = input.clone();
            tokio::spawn(async move {
                forward_hook(&url, input_clone).await;
            });
        }
    }

    let hook_event = input.hook_event_name.as_str();

    // Check if auto-allow is enabled for PermissionRequest
    if hook_event == "PermissionRequest" {
        let auto_allow = {
            let state_guard = state.read();
            state_guard.settings.auto_allow_permissions
        };
        if auto_allow {
            // Auto allow - return immediately without creating popup
            return Ok(Json(HookOutput {
                continue_exec: true,
                decision: None,
                reason: None,
                system_message: None,
                suppress_output: None,
                hook_specific_output: Some(HookSpecificOutput {
                    hook_event_name: "PermissionRequest".to_string(),
                    additional_context: None,
                    permission_decision: None,
                    permission_decision_reason: None,
                    updated_input: None,
                    action: None,
                    decision: Some(DecisionOutput {
                        behavior: "allow".to_string(),
                        updated_input: None,
                        message: None,
                        interrupt: None,
                    }),
                    content: None,
                }),
            }));
        }
    }

    // Check if this is a blocking event
    // - PermissionRequest: needs user decision
    // - Elicitation (AskUserQuestion): needs user answers
    // - Notification with ask: needs user response
    let is_blocking = hook_event == "PermissionRequest" ||
        hook_event == "Elicitation" ||
        (hook_event == "Notification" && input.notification_data.as_ref().map(|n| n.is_ask()).unwrap_or(false));

    if is_blocking {
        // Create popup and wait for user response
        let popup_id = uuid::Uuid::new_v4().to_string();

        let (tx, rx) = oneshot::channel();
        let timeout_secs = if hook_event == "PermissionRequest" { 300 } else { 120 };

        // Store context for building response
        let (questions_for_conversion, hook_event_name, elicitation_questions, tool_name, tool_input) = {
            let mut state_guard = state.write();

            // Create popup item
            let popup = create_popup_from_hook(&popup_id, &input);

            // Extract questions for answer conversion
            let questions = popup.ask_data.as_ref().map(|ad| ad.questions.clone());

            // Store original Elicitation questions (for additionalContext format)
            let elicitation_questions = input.questions.clone();

            // Store tool_name and tool_input for AskUserQuestion handling
            let tool_name = input.tool_name.clone();
            let tool_input = input.tool_input.clone();

            // Clone popup for WebSocket broadcast
            let popup_for_broadcast = popup.clone();

            // Update instance status to WaitingForApproval
            if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                if let Some(ref name) = tool_name {
                    instance.set_status(InstanceStatus::WaitingForApproval(name.clone()));
                    instance.current_tool = Some(name.clone());

                    // Save tool input for display
                    if let Some(ref ti) = tool_input {
                        let command = ti.get("command")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let file_path = ti.get("file_path")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let action = ti.get("description")
                            .or_else(|| ti.get("command"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let details = ti.get("command")
                            .or_else(|| ti.get("file_path"))
                            .or_else(|| ti.get("url"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        instance.tool_input = Some(crate::instance_manager::ToolInput {
                            tool_name: name.clone(),
                            action,
                            details,
                            command,
                            file_path,
                        });
                    }
                }
            }

            state_guard.popups.add(popup);
            state_guard.popups.register_waiter(popup_id.clone(), tx, timeout_secs);

            // Broadcast new popup to WebSocket clients
            websocket_server::broadcast_new_popup(popup_for_broadcast);

            (questions, input.hook_event_name.clone(), elicitation_questions, tool_name, tool_input)
        };

        // Wait for response (with timeout handled in popup_queue)
        match rx.await {
            Ok(response) => {
                // Build hook output per docs/hook-reference.md format
                let output = build_hook_output(
                    &hook_event_name,
                    &tool_name,
                    &tool_input,
                    &response,
                    &questions_for_conversion,
                    &elicitation_questions,
                );

                // Log the response to file if logging enabled (async, no lock)
                if crate::is_logging_enabled() {
                    let log_content = format!(
                        "[{}] Response: {:?}\n",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                        serde_json::to_string(&output)
                    );
                    crate::write_log(&log_content);
                }

                Ok(Json(output))
            }
            Err(_) => {
                // Timeout - return deny decision
                build_timeout_output(&hook_event_name)
            }
        }
    } else {
        // Non-blocking event - process immediately
        {
            let mut state_guard = state.write();

            match hook_event {
                "SessionStart" => {
                    let session_id = input.session_id.clone();
                    let project_name = extract_project_name(&input);
                    let mut instance = ClaudeInstance::new(session_id.clone(), project_name.clone());

                    // Try to find process info
                    if let Some(cwd) = &input.cwd {
                        if let Some(process_info) = crate::platform::find_claude_process_by_cwd(cwd) {
                            instance.process_info = Some(process_info);
                            tracing::info!("Found process info for session {}: pid={}",
                                session_id, instance.process_info.as_ref().unwrap().pid);
                        }
                    }

                    // Fallback: try to find any claude process
                    if instance.process_info.is_none() {
                        if let Some(process_info) = crate::platform::find_any_claude_process() {
                            instance.process_info = Some(process_info);
                            tracing::info!("Found claude process for session {}: pid={}",
                                session_id, instance.process_info.as_ref().unwrap().pid);
                        }
                    }

                    tracing::info!("New session: {} - {}", instance.session_id, instance.project_name);
                    state_guard.instances.add_instance(instance);

                    // Set session notification
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                    let notification = crate::SessionNotification {
                        project_name,
                        notification_type: "started".to_string(),
                        timestamp: now,
                    };
                    state_guard.set_session_notification(notification.clone());

                    // Broadcast to WebSocket clients
                    websocket_server::broadcast_session_notification(notification);
                    websocket_server::broadcast_state_update(
                        state_guard.instances.get_all_instances_display(),
                        state_guard.popups.get_all()
                    );
                }
                "SessionEnd" => {
                    // Get project name before marking as ended
                    let project_name = state_guard.instances.get_instance(&input.session_id)
                        .map(|i| i.project_name.clone())
                        .unwrap_or_else(|| "Unknown".to_string());

                    // Cancel any pending popups for this session
                    let cancelled = state_guard.popups.cancel_session_popups(&input.session_id);
                    if !cancelled.is_empty() {
                        tracing::info!("Session {} ended, cancelled {} pending popups",
                            input.session_id, cancelled.len());
                    }

                    // Mark instance as ended
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.set_status(InstanceStatus::Ended);
                    }

                    // Clear chat history for this session
                    state_guard.chat_history.clear_session(&input.session_id);

                    // Set session notification
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                    let notification = crate::SessionNotification {
                        project_name,
                        notification_type: "ended".to_string(),
                        timestamp: now,
                    };
                    state_guard.set_session_notification(notification.clone());

                    // Broadcast to WebSocket clients
                    websocket_server::broadcast_session_notification(notification);
                    websocket_server::broadcast_state_update(
                        state_guard.instances.get_all_instances_display(),
                        state_guard.popups.get_all()
                    );
                }
                "Stop" => {
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.set_status(InstanceStatus::Idle);
                        instance.current_tool = None;
                        instance.tool_input = None;
                    }

                    // Record assistant response completion
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    state_guard.chat_history.add_message(ChatMessage {
                        id: uuid::Uuid::new_v4().to_string(),
                        session_id: input.session_id.clone(),
                        message_type: MessageType::Assistant,
                        content: "Response complete".to_string(),
                        tool_name: None,
                        timestamp: now_ms,
                    });
                }
                "PreToolUse" => {
                    // First, update instance and extract data
                    let activity_data = if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        let tool_name = input.tool_name.clone().unwrap_or_default();

                        // Extract tool input details for display
                        let tool_input = input.tool_input.as_ref().map(|ti| {
                            let command = ti.get("command")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            let file_path = ti.get("file_path")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            let action = ti.get("description")
                                .or_else(|| ti.get("command"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            let details = ti.get("command")
                                .or_else(|| ti.get("file_path"))
                                .or_else(|| ti.get("url"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            crate::instance_manager::ToolInput {
                                tool_name: tool_name.clone(),
                                action,
                                details,
                                command,
                                file_path,
                            }
                        });

                        instance.set_working(tool_name.clone(), tool_input);
                        Some((instance.project_name.clone(), tool_name))
                    } else {
                        None
                    };

                    // Then, record activity (separate borrow)
                    if let Some((project_name, tool_name)) = activity_data {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs();
                        state_guard.add_activity(crate::ToolActivity {
                            session_id: input.session_id.clone(),
                            project_name,
                            tool_name: tool_name.clone(),
                            timestamp: now,
                        });

                        // Store tool call message
                        let tool_content = format!(
                            "{}: {}",
                            tool_name,
                            input.tool_input.as_ref()
                                .and_then(|ti| serde_json::to_string(ti).ok())
                                .unwrap_or_else(|| "{}".to_string())
                        );
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;

                        state_guard.chat_history.add_message(ChatMessage {
                            id: uuid::Uuid::new_v4().to_string(),
                            session_id: input.session_id.clone(),
                            message_type: MessageType::ToolCall,
                            content: tool_content,
                            tool_name: Some(tool_name),
                            timestamp: now_ms,
                        });
                    }
                }
                "PostToolUse" => {
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        // Tool done, but AI may continue thinking → Waiting
                        instance.set_status(InstanceStatus::Waiting);
                        instance.current_tool = None;
                        instance.tool_input = None;
                    }

                    // Store tool result message
                    let tool_name = input.tool_name.clone().unwrap_or_default();
                    let result_content = input.tool_response.as_ref()
                        .and_then(|tr| tr.get("output"))
                        .and_then(|o| o.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "Tool executed".to_string());

                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    state_guard.chat_history.add_message(ChatMessage {
                        id: uuid::Uuid::new_v4().to_string(),
                        session_id: input.session_id.clone(),
                        message_type: MessageType::ToolResult,
                        content: result_content,
                        tool_name: Some(tool_name),
                        timestamp: now_ms,
                    });
                }
                "PostToolUseFailure" => {
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.set_status(InstanceStatus::Error);
                        instance.current_tool = None;
                        instance.tool_input = None;
                    }
                }
                "PreCompact" => {
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.set_status(InstanceStatus::Compacting);
                    }
                }
                "PostCompact" => {
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.set_status(InstanceStatus::Idle);
                    }
                }
                "UserPromptSubmit" => {
                    // User submitted a prompt → AI is thinking
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.set_status(InstanceStatus::Thinking);
                        instance.update_activity();
                    }

                    // Extract user message from hook data
                    if let Some(prompt) = input.tool_input.as_ref()
                        .and_then(|ti| ti.get("prompt"))
                        .and_then(|p| p.as_str())
                    {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;

                        let message = ChatMessage {
                            id: uuid::Uuid::new_v4().to_string(),
                            session_id: input.session_id.clone(),
                            message_type: MessageType::User,
                            content: prompt.to_string(),
                            tool_name: None,
                            timestamp: now,
                        };
                        state_guard.chat_history.add_message(message);
                    }
                }
                "SubagentStart" | "SubagentStop" => {
                    // Just update activity
                    if let Some(instance) = state_guard.instances.get_instance_mut(&input.session_id) {
                        instance.update_activity();
                    }
                }
                _ => {}
            }
        }

        Ok(Json(HookOutput {
            continue_exec: true,
            decision: None,
            reason: None,
            system_message: None,
            suppress_output: None,
            hook_specific_output: None,
        }))
    }
}

/// Handle user response to popup
async fn handle_response(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(response): Json<PopupResponse>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    tracing::info!("Received response for popup: {}", response.popup_id);

    let mut state_guard = state.write();

    if state_guard.popups.resolve(response.clone()) {
        Ok(Json(serde_json::json!({ "success": true })))
    } else {
        Ok(Json(serde_json::json!({ "success": false, "error": "popup not found or already resolved" })))
    }
}

/// Handle jump request
async fn handle_jump(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let session_id = payload["session_id"].as_str().unwrap_or("");

    let state_guard = state.read();

    if let Some(instance) = state_guard.instances.get_instance(&session_id.to_string()) {
        if let Some(process_info) = &instance.process_info {
            // Jump to terminal
            crate::platform::jump_to_terminal(process_info);
            Ok(Json(serde_json::json!({ "success": true })))
        } else {
            Ok(Json(serde_json::json!({ "success": false, "error": "no process info" })))
        }
    } else {
        Ok(Json(serde_json::json!({ "success": false, "error": "instance not found" })))
    }
}

/// Get all instances
async fn get_instances(
    State(state): State<Arc<RwLock<AppState>>>,
) -> Json<Vec<ClaudeInstanceDisplay>> {
    let state_guard = state.read();
    Json(state_guard.instances.get_all_instances_display())
}

/// Get all popups
async fn get_popups(
    State(state): State<Arc<RwLock<AppState>>>,
) -> Json<Vec<PopupItem>> {
    let state_guard = state.read();
    Json(state_guard.popups.get_all())
}

/// Get single instance
async fn get_instance(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<ClaudeInstance>, StatusCode> {
    let state_guard = state.read();
    match state_guard.instances.get_instance(&id) {
        Some(instance) => Ok(Json(instance.clone())),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Delete instance
async fn delete_instance(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    let mut state_guard = state.write();
    state_guard.instances.remove_instance(&id);
    Json(serde_json::json!({ "success": true }))
}

/// Get settings from settings.json
async fn get_settings(
    state: State<Arc<RwLock<AppState>>>,
) -> Json<config::AppSettings> {
    let state_guard = state.read();
    Json(state_guard.settings.clone())
}

/// Update settings and save to settings.json
async fn update_settings(
    state: State<Arc<RwLock<AppState>>>,
    Json(settings): Json<config::AppSettings>,
) -> Result<Json<serde_json::Value>, String> {
    // Save to file
    config::save_settings(&settings)?;

    // Update global atomic logging flag
    crate::set_logging_enabled(settings.enable_logging);

    // Update in-memory state
    let mut state_guard = state.write();
    state_guard.settings = settings;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// Get chat messages for a session
async fn get_chat_messages_http(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Json<Vec<ChatMessage>> {
    let state_guard = state.read();
    Json(state_guard.chat_history.get_messages(&session_id))
}
async fn update_position(
    Json(_pos): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // TODO: Update window position via Tauri
    Json(serde_json::json!({ "success": true }))
}

// Helper functions

fn create_popup_from_hook(popup_id: &str, input: &HookInput) -> PopupItem {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let project_name = extract_project_name(input);

    let (popup_type, permission_data, ask_data, notification_data) = {
        // Elicitation event (AskUserQuestion as separate event type)
        if input.hook_event_name == "Elicitation" {
            // Parse questions directly from input.questions
            let questions = if let Some(elicitation_qs) = &input.questions {
                elicitation_qs.iter().map(|q| {
                    AskQuestion {
                        header: q.header.clone(),
                        question: q.question.clone(),
                        multi_select: q.multi_select,
                        options: q.options.iter().map(|o| {
                            crate::popup_queue::AskOption {
                                label: o.label.clone(),
                                description: o.description.clone(),
                            }
                        }).collect(),
                    }
                }).collect()
            } else {
                vec![]
            };

            (PopupType::Ask, None, Some(AskData { questions }), None)
        } else if input.hook_event_name == "PermissionRequest" && input.tool_name.as_deref() == Some("AskUserQuestion") {
            // Parse questions from tool_input
            let questions_json = input.tool_input.as_ref()
                .and_then(|ti| ti.get("questions"))
                .and_then(|q| q.as_array());

            let questions = if let Some(questions_json) = questions_json {
                questions_json.iter().map(|q| {
                    let header = q.get("header")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let question = q.get("question")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Question")
                        .to_string();

                    let multi_select = q.get("multiSelect")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    let options = q.get("options")
                        .and_then(|opts| opts.as_array())
                        .map(|opts| {
                            opts.iter().map(|o| {
                                crate::popup_queue::AskOption {
                                    label: o.get("label")
                                        .and_then(|l| l.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    description: o.get("description")
                                        .and_then(|d| d.as_str())
                                        .map(|s| s.to_string()),
                                }
                            }).collect()
                        }).unwrap_or_default();

                    crate::popup_queue::AskQuestion {
                        header,
                        question,
                        multi_select,
                        options,
                    }
                }).collect()
            } else {
                vec![]
            };

            (PopupType::Ask, None, Some(AskData { questions }), None)
        } else if input.hook_event_name == "PermissionRequest" {
            // Use permission_data if available, otherwise create from tool_name/tool_input
            let perm_data = if let Some(pd) = &input.permission_data {
                pd.clone()
            } else {
                // Create from tool_name and tool_input
                let tool_name = input.tool_name.clone().unwrap_or_else(|| "Unknown".to_string());
                let (action, details) = if let Some(tool_input) = &input.tool_input {
                    // Get description if available
                    let description = tool_input.get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Get command/file_path/url for details
                    let command = tool_input.get("command")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let file_path = tool_input.get("file_path")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let url = tool_input.get("url")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Build action (prefer description, else use command/filepath/url)
                    let action = description.clone()
                        .or_else(|| command.clone())
                        .or_else(|| file_path.clone())
                        .or_else(|| url.clone())
                        .unwrap_or_else(|| {
                            // Fallback: show tool input as JSON
                            let input_str = serde_json::to_string(tool_input).unwrap_or_else(|_| "{}".to_string());
                            if input_str.len() > 100 {
                                format!("{}...", &input_str[..100])
                            } else {
                                input_str
                            }
                        });

                    // Build details: show command/filepath/url if description exists
                    let details = if description.is_some() {
                        command.or(file_path).or(url)
                    } else {
                        None
                    };

                    (action, details)
                } else {
                    ("Execute tool".to_string(), None)
                };
                PermissionData {
                    tool_name,
                    action,
                    details,
                }
            };
            (PopupType::Permission, Some(perm_data), None, None)
        } else if input.hook_event_name == "Notification" {
            if let Some(n) = &input.notification_data {
                if n.is_ask() {
                    // Convert Notification ask format to AskData questions format
                    let questions = vec![
                        AskQuestion {
                            header: "".to_string(),
                            question: n.message.clone(),
                            multi_select: false,
                            options: n.options.as_ref().map(|opts| {
                                opts.iter().map(|o| {
                                    crate::popup_queue::AskOption {
                                        label: o.clone(),
                                        description: None,
                                    }
                                }).collect()
                            }).unwrap_or_default(),
                        }
                    ];
                    (PopupType::Ask, None, Some(AskData { questions }), None)
                } else {
                    (PopupType::Notification, None, None, input.notification_data.clone())
                }
            } else {
                (PopupType::Notification, None, None, None)
            }
        } else {
            (PopupType::Notification, None, None, None)
        }
    };

    let is_notification = popup_type == PopupType::Notification;
    PopupItem {
        id: popup_id.to_string(),
        session_id: input.session_id.clone(),
        project_name,
        popup_type,
        permission_data,
        ask_data,
        notification_data,
        status: PopupStatus::Pending,
        created_at: now,
        auto_close_at: if is_notification { Some(now + 5000) } else { None },
        timeout_at: None,
    }
}

fn extract_project_name(input: &HookInput) -> String {
    // First try cwd (working directory) - this is the most reliable source
    if let Some(cwd) = &input.cwd {
        if let Some(name) = std::path::Path::new(cwd)
            .file_name()
            .and_then(|n| n.to_str()) {
            return name.to_string();
        }
    }

    // Fallback: try tool_input file_path
    if let Some(tool_input) = &input.tool_input {
        if let Some(path) = tool_input.get("file_path").and_then(|v| v.as_str()) {
            return std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
        }
    }
    "unknown".to_string()
}

/// Build hook output per docs/hooks-claude.md format
fn build_hook_output(
    hook_event_name: &str,
    tool_name: &Option<String>,
    tool_input: &Option<std::collections::HashMap<String, serde_json::Value>>,
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
    elicitation_questions: &Option<Vec<ElicitationQuestion>>,
) -> HookOutput {
    match hook_event_name {
        "PermissionRequest" => build_permission_request_output(tool_name, tool_input, response, questions),
        "Elicitation" => build_elicitation_output(response, questions, elicitation_questions),
        "Notification" => build_notification_output(response, questions),
        _ => build_default_output(hook_event_name, response),
    }
}

/// Build PermissionRequest output per docs/hooks-claude.md (line 1068-1092)
/// Format: {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow/deny", "updatedInput": {...}}}}
fn build_permission_request_output(
    tool_name: &Option<String>,
    tool_input: &Option<std::collections::HashMap<String, serde_json::Value>>,
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
) -> HookOutput {
    // Check if this is AskUserQuestion - needs special handling with updatedInput
    if tool_name.as_deref() == Some("AskUserQuestion") {
        return build_ask_user_question_output(tool_input, response, questions);
    }

    // Regular PermissionRequest
    let behavior = response.decision.clone().unwrap_or("deny".to_string());
    let continue_flag = behavior == "allow";

    HookOutput {
        continue_exec: continue_flag,
        decision: None,
        reason: None,
        system_message: None,
        suppress_output: None,
        hook_specific_output: Some(HookSpecificOutput {
            hook_event_name: "PermissionRequest".to_string(),
            additional_context: None,
            permission_decision: None,
            permission_decision_reason: None,
            updated_input: None,
            decision: Some(DecisionOutput {
                behavior: behavior.clone(),
                updated_input: None,
                message: if behavior == "deny" { Some("权限被拒绝".to_string()) } else { None },
                interrupt: None,
            }),
            action: None,
            content: None,
        }),
    }
}

/// Build AskUserQuestion output per docs/hooks-claude.md
/// PermissionRequest with AskUserQuestion: decision.behavior="allow" + decision.updatedInput with questions + answers
fn build_ask_user_question_output(
    tool_input: &Option<std::collections::HashMap<String, serde_json::Value>>,
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
) -> HookOutput {
    // Build updatedInput: original questions + answers
    let updated_input = build_ask_updated_input(tool_input, response, questions);

    HookOutput {
        continue_exec: true,
        decision: None,
        reason: None,
        system_message: None,
        suppress_output: None,
        hook_specific_output: Some(HookSpecificOutput {
            hook_event_name: "PermissionRequest".to_string(),
            additional_context: None,
            permission_decision: None,
            permission_decision_reason: None,
            updated_input: None,
            decision: Some(DecisionOutput {
                behavior: "allow".to_string(),
                updated_input,
                message: None,
                interrupt: None,
            }),
            action: None,
            content: None,
        }),
    }
}

/// Build updatedInput for AskUserQuestion
/// Format: {"questions": [...original...], "answers": {"question_text": "answer"}}
fn build_ask_updated_input(
    tool_input: &Option<std::collections::HashMap<String, serde_json::Value>>,
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
) -> Option<serde_json::Value> {
    // Get original questions from tool_input
    let original_questions = tool_input.as_ref()
        .and_then(|ti| ti.get("questions"))
        .cloned();

    // Build answers object
    let answers = if let (Some(answers_arr), Some(qs)) = (&response.answers, questions) {
        let mut map = serde_json::Map::new();
        for (i, selected) in answers_arr.iter().enumerate() {
            if let Some(q) = qs.get(i) {
                let value = if q.multi_select && selected.len() > 1 {
                    serde_json::Value::Array(selected.iter().map(|s| serde_json::Value::String(s.clone())).collect())
                } else if selected.len() >= 1 {
                    serde_json::Value::String(selected[0].clone())
                } else {
                    serde_json::Value::Null
                };
                map.insert(q.question.clone(), value);
            }
        }
        Some(serde_json::Value::Object(map))
    } else {
        None
    };

    // Build final updatedInput
    let mut updated = serde_json::Map::new();

    // Include original questions
    if let Some(q) = original_questions {
        updated.insert("questions".to_string(), q);
    }

    // Add answers
    if let Some(a) = answers {
        updated.insert("answers".to_string(), a);
    }

    Some(serde_json::Value::Object(updated))
}

/// Build Elicitation output per docs/hooks-claude.md
/// Response format: {"hookSpecificOutput": {"hookEventName": "Elicitation", "action": "accept", "content": {...}}}
fn build_elicitation_output(
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
    elicitation_questions: &Option<Vec<ElicitationQuestion>>,
) -> HookOutput {
    // Build additionalContext with user answers
    let additional_context = build_answers_context(response, questions, elicitation_questions);

    HookOutput {
        continue_exec: false,
        decision: Some("block".to_string()),
        reason: Some("外部服务处理用户输入".to_string()),
        system_message: Some("✅ 问题已发送到外部 UI".to_string()),
        suppress_output: None,
        hook_specific_output: Some(HookSpecificOutput {
            hook_event_name: "Elicitation".to_string(),
            additional_context,
            permission_decision: None,
            permission_decision_reason: None,
            updated_input: None,
            action: None,
            decision: None,
            content: None,
        }),
    }
}

/// Build answers context string for additionalContext field
fn build_answers_context(
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
    elicitation_questions: &Option<Vec<ElicitationQuestion>>,
) -> Option<String> {
    if let Some(answers) = &response.answers {
        let mut parts = Vec::new();

        // Use elicitation_questions if available (original format), fallback to parsed questions
        if let Some(elic_qs) = elicitation_questions {
            for (i, selected) in answers.iter().enumerate() {
                if let Some(q) = elic_qs.get(i) {
                    parts.push(format!("- {} ({}): {}", q.header, q.question, selected.join(", ")));
                }
            }
        } else if let Some(qs) = questions {
            for (i, selected) in answers.iter().enumerate() {
                if let Some(q) = qs.get(i) {
                    let label = if q.header.is_empty() { &q.question } else { &q.header };
                    parts.push(format!("- {}: {}", label, selected.join(", ")));
                }
            }
        }

        Some(format!("用户选择:\n{}", parts.join("\n")))
    } else {
        None
    }
}

/// Build Notification output (for ask type)
fn build_notification_output(
    response: &PopupResponse,
    questions: &Option<Vec<AskQuestion>>,
) -> HookOutput {
    // Build additionalContext with user answer
    let additional_context = if let (Some(answers), Some(qs)) = (&response.answers, questions) {
        let mut parts = Vec::new();
        for (i, selected) in answers.iter().enumerate() {
            if let Some(q) = qs.get(i) {
                parts.push(format!("{}: {}", q.question, selected.join(", ")));
            }
        }
        Some(format!("用户回答:\n{}", parts.join("\n")))
    } else {
        None
    };

    HookOutput {
        continue_exec: false,
        decision: Some("block".to_string()),
        reason: Some("外部服务处理用户输入".to_string()),
        system_message: Some("✅ 已通过外部 UI 收集用户选择".to_string()),
        suppress_output: None,
        hook_specific_output: Some(HookSpecificOutput {
            hook_event_name: "Notification".to_string(),
            additional_context,
            permission_decision: None,
            permission_decision_reason: None,
            updated_input: None,
            action: None,
            decision: None,
            content: None,
        }),
    }
}

/// Build default output for unknown events
fn build_default_output(hook_event_name: &str, response: &PopupResponse) -> HookOutput {
    let decision = response.decision.clone().unwrap_or("deny".to_string());
    let continue_flag = decision == "allow";

    HookOutput {
        continue_exec: continue_flag,
        decision: Some(decision.clone()),
        reason: None,
        system_message: None,
        suppress_output: None,
        hook_specific_output: Some(HookSpecificOutput {
            hook_event_name: hook_event_name.to_string(),
            additional_context: None,
            permission_decision: Some(decision),
            permission_decision_reason: None,
            updated_input: None,
            action: None,
            decision: None,
            content: None,
        }),
    }
}

/// Build timeout output
fn build_timeout_output(hook_event_name: &str) -> Result<Json<HookOutput>, StatusCode> {
    let output = HookOutput {
        continue_exec: false,
        decision: Some("deny".to_string()),
        reason: Some("操作超时".to_string()),
        system_message: Some("⏱️ 操作超时，已自动拒绝".to_string()),
        suppress_output: None,
        hook_specific_output: Some(HookSpecificOutput {
            hook_event_name: hook_event_name.to_string(),
            additional_context: None,
            permission_decision: Some("deny".to_string()),
            permission_decision_reason: Some("用户未响应".to_string()),
            updated_input: None,
            action: None,
            decision: None,
            content: None,
        }),
    };

    Ok(Json(output))
}

/// Forward hook data to configured URL (async, fire-and-forget)
async fn forward_hook(url: &str, input: HookInput) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let body = match serde_json::to_string(&input) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("Failed to serialize hook for forwarding: {}", e);
            return;
        }
    };

    match client
        .post(url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                tracing::debug!("Hook forward returned status: {}", resp.status());
            }
        }
        Err(e) => {
            tracing::debug!("Hook forward failed: {}", e);
        }
    }
}
