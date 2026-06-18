// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::sync::Arc;
use futures_util::FutureExt;
use parking_lot::RwLock;
use rust_socketio::asynchronous::{Client, ClientBuilder};
use rust_socketio::Payload;
use serde_json::json;
use crate::machine_id::get_machine_token;
use crate::AppState;
use crate::popup_queue::PopupResponse;

/// Cloud client configuration
#[derive(Clone)]
pub struct CloudConfig {
    pub server_url: String,
    pub device_name: Option<String>,
}

/// Cloud client for Socket.IO connection to relay server
pub struct CloudClient {
    config: CloudConfig,
    device_token: String,
    hostname: Option<String>,
    app_state: Arc<RwLock<AppState>>,
    hooks_socket: Option<Client>,
    connected: Arc<RwLock<bool>>,
}

impl CloudClient {
    pub fn new(app_state: Arc<RwLock<AppState>>, config: CloudConfig) -> Self {
        let device_token = get_machine_token();
        let hostname = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok());

        Self {
            config,
            device_token,
            hostname,
            app_state,
            hooks_socket: None,
            connected: Arc::new(RwLock::new(false)),
        }
    }

    pub fn get_device_token(&self) -> String {
        self.device_token.clone()
    }

    pub fn get_hostname(&self) -> Option<String> {
        self.hostname.clone()
    }

    pub fn is_connected(&self) -> bool {
        *self.connected.read()
    }

    pub fn get_connected_arc(&self) -> Arc<RwLock<bool>> {
        self.connected.clone()
    }

    /// Connect to cloud server via Socket.IO
    pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let server_url = self.config.server_url.clone();
        let device_token = self.device_token.clone();
        let hostname = self.hostname.clone();
        let device_name = self.config.device_name.clone();

        tracing::info!("Connecting to cloud server via Socket.IO: {}", server_url);

        // Connect to default namespace with auth
        let auth_data = json!({
            "device_token": device_token,
            "hostname": hostname,
            "device_name": device_name,
        });

        let mut main_builder = ClientBuilder::new(&server_url)
            .auth(auth_data)
            .reconnect(true)
            .reconnect_delay(1000, 5000)
            .max_reconnect_attempts(10);

        // Listen for auth result
        let connected_ref = self.connected.clone();
        main_builder = main_builder
            .on("auth_success", {
                let connected = connected_ref.clone();
                move |_: Payload, _: Client| {
                    let connected = connected.clone();
                    async move {
                        tracing::info!("Socket.IO auth successful");
                        *connected.write() = true;
                    }
                    .boxed()
                }
            })
            .on("auth_error", |payload: Payload, _: Client| {
                async move {
                    tracing::error!("Socket.IO auth failed: {:?}", payload);
                }
                .boxed()
            });

        let _main_socket = main_builder.connect().await?;

        // Connect to /hooks namespace for hook relay
        let app_state = self.app_state.clone();
        let device_token_hooks = device_token.clone();

        let hooks_socket = ClientBuilder::new(&server_url)
            .namespace("/hooks")
            .reconnect(true)
            .reconnect_delay(1000, 5000)
            .on("hook:response", {
                let app_state = app_state.clone();
                move |payload: Payload, _: Client| {
                    let app_state = app_state.clone();
                    async move {
                        if let Payload::Text(values) = payload {
                            if let Some(v) = values.first() {
                                handle_hook_response(&app_state, v);
                            }
                        }
                    }
                    .boxed()
                }
            })
            .on("list:request", {
                let app_state = app_state.clone();
                let device_token = device_token_hooks.clone();
                move |payload: Payload, socket: Client| {
                    let app_state = app_state.clone();
                    let device_token = device_token.clone();
                    async move {
                        if let Payload::Text(values) = payload {
                            if let Some(v) = values.first() {
                                handle_request_session_list(&app_state, &device_token, v, &socket);
                            }
                        }
                    }
                    .boxed()
                }
            })
            .connect()
            .await?;

        self.hooks_socket = Some(hooks_socket);
        *self.connected.write() = true;

        // Send existing sessions to cloud after connection
        self.sync_existing_sessions().await;

        Ok(())
    }

    /// Sync existing Claude sessions to cloud after connection
    async fn sync_existing_sessions(&self) {
        let instances: Vec<(String, Option<String>, String)> = {
            let state = self.app_state.read();
            let all_instances = state.instances.get_all_instances_display();
            tracing::info!("Sending {} existing sessions to cloud", all_instances.len());
            all_instances.into_iter().map(|i| (
                i.session_id.clone(),
                i.session_cwd.clone(),
                i.project_name.clone(),
            )).collect()
        };

        for (session_id, cwd, project_name) in instances {
            let hook_body = json!({
                "hook_event_name": "SessionStart",
                "session_id": session_id,
                "cwd": cwd,
                "project_name": project_name,
            });
            self.push_hook_message_inner(&session_id, "SessionStart", hook_body).await;

            if let Some(cwd_str) = cwd {
                let messages = {
                    let mut state = self.app_state.write();
                    state.conversation_parser.parse_full(&session_id, &cwd_str)
                };
                if !messages.is_empty() {
                    let chat_messages = crate::conversation_parser::ConversationParser::to_chat_messages(messages);
                    self.push_chat_history_inner(&session_id, &chat_messages).await;
                }
            }
        }
    }

    /// Inner async hook push
    async fn push_hook_message_inner(&self, session_id: &str, hook_type: &str, hook_body: serde_json::Value) {
        if let Some(socket) = &self.hooks_socket {
            let payload = json!({
                "deviceToken": self.device_token,
                "sessionId": session_id,
                "hookType": hook_type,
                "hookBody": hook_body,
            });
            if let Err(e) = socket.emit("hook", payload).await {
                tracing::warn!("Failed to push hook message: {}", e);
            }
        }
    }

    /// Push hook message to cloud (called from sync hook handlers)
    pub fn push_hook_message(&self, session_id: &str, hook_type: &str, hook_body: serde_json::Value) {
        if !self.is_connected() {
            return;
        }

        let device_token = self.device_token.clone();
        let session_id = session_id.to_string();
        let hook_type = hook_type.to_string();

        if let Some(socket) = &self.hooks_socket {
            let socket = socket.clone();
            let payload = json!({
                "deviceToken": device_token,
                "sessionId": session_id,
                "hookType": hook_type,
                "hookBody": hook_body,
            });
            tokio::spawn(async move {
                if let Err(e) = socket.emit("hook", payload).await {
                    tracing::warn!("Failed to push hook message: {}", e);
                }
            });
        }
    }

    /// Inner async chat history push
    async fn push_chat_history_inner(&self, session_id: &str, messages: &[crate::chat_messages::ChatMessage]) {
        if let Some(socket) = &self.hooks_socket {
            let messages_data: Vec<serde_json::Value> = messages.iter().map(|msg| {
                json!({
                    "id": msg.id,
                    "sessionId": msg.session_id,
                    "messageType": msg.message_type,
                    "content": msg.content,
                    "toolName": msg.tool_name,
                    "timestamp": msg.timestamp,
                })
            }).collect();

            let payload = json!({
                "deviceToken": self.device_token,
                "sessionId": session_id,
                "messages": messages_data,
            });

            if let Err(e) = socket.emit("history", payload).await {
                tracing::warn!("Failed to push chat history: {}", e);
            }
        }
    }

    /// Push chat history to cloud (called from sync code)
    pub fn push_chat_history(&self, session_id: &str, messages: Vec<crate::chat_messages::ChatMessage>) {
        tracing::info!("push_chat_history called: session={}, messages={}, connected={}",
            session_id, messages.len(), self.is_connected());

        if !self.is_connected() {
            tracing::warn!("push_chat_history SKIPPED: not connected to cloud");
            return;
        }

        if let Some(socket) = &self.hooks_socket {
            let socket = socket.clone();
            let device_token = self.device_token.clone();
            let session_id = session_id.to_string();
            let messages_data: Vec<serde_json::Value> = messages.iter().map(|msg| {
                json!({
                    "id": msg.id,
                    "sessionId": msg.session_id,
                    "messageType": msg.message_type,
                    "content": msg.content,
                    "toolName": msg.tool_name,
                    "timestamp": msg.timestamp,
                })
            }).collect();

            let payload = json!({
                "deviceToken": device_token,
                "sessionId": session_id,
                "messages": messages_data,
            });

            tokio::spawn(async move {
                tracing::info!("Sending {} chat messages to cloud", messages_data.len());
                if let Err(e) = socket.emit("history", payload).await {
                    tracing::warn!("push_chat_history FAILED: {}", e);
                } else {
                    tracing::info!("push_chat_history SUCCESS: sent to cloud");
                }
            });
        } else {
            tracing::warn!("push_chat_history SKIPPED: no hooks socket");
        }
    }

    /// Push popup resolved notification to cloud
    pub fn push_popup_resolved(&self, popup_id: &str, session_id: &str, decision: Option<&str>, answers: Option<&Vec<Vec<String>>>) {
        if !self.is_connected() {
            return;
        }

        if let Some(socket) = &self.hooks_socket {
            let socket = socket.clone();
            let payload = json!({
                "deviceToken": self.device_token,
                "popupId": popup_id,
                "sessionId": session_id,
                "source": "desktop",
                "decision": decision,
                "answers": answers,
            });

            tracing::info!("Pushing popup_resolved: popup={}, decision={:?}", popup_id, decision);
            tokio::spawn(async move {
                if let Err(e) = socket.emit("popup:resolved", payload).await {
                    tracing::warn!("Failed to push popup_resolved: {}", e);
                }
            });
        }
    }
}

fn handle_hook_response(app_state: &Arc<RwLock<AppState>>, json: &serde_json::Value) {
    let session_id = json["session_id"].as_str().unwrap_or("");
    let decision = json["decision"].as_str();
    let answers = json["answers"].as_array();

    tracing::info!("Received hook response from mobile: session {} -> {:?}", session_id, decision);

    let popup_id = {
        let state = app_state.read();
        state.popups.find_popup_by_session(session_id)
    };

    if let Some(popup_id) = popup_id {
        let response = PopupResponse {
            popup_id: popup_id.clone(),
            decision: decision.map(|s| s.to_string()),
            answer: None,
            answers: answers.map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_array())
                    .map(|inner| inner.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .collect()
            }),
        };

        let resolved = {
            let mut state = app_state.write();
            state.popups.resolve(response.clone())
        };

        if resolved {
            let mut state = app_state.write();
            if let Some(instance) = state.instances.get_instance_mut(&session_id.to_string()) {
                if matches!(instance.status, crate::instance_manager::InstanceStatus::WaitingForApproval(_)) {
                    instance.set_status(crate::instance_manager::InstanceStatus::Idle);
                    instance.current_tool = None;
                    instance.tool_input = None;
                }
            }
            tracing::info!("Popup {} resolved successfully from mobile", popup_id);
        } else {
            tracing::warn!("Popup {} not found or already resolved", popup_id);
        }
    } else {
        tracing::warn!("No pending popup found for session {}", session_id);
    }
}

fn handle_request_session_list(
    app_state: &Arc<RwLock<AppState>>,
    device_token: &str,
    json: &serde_json::Value,
    socket: &Client,
) {
    let mobile_conn_id = json["mobile_conn_id"].as_str().unwrap_or("");
    tracing::info!("Received RequestSessionList: device={}, mobile_conn_id={}", device_token, mobile_conn_id);

    let sessions: Vec<serde_json::Value> = {
        let state = app_state.read();
        let all_instances = state.instances.get_all_instances_display();
        tracing::info!("Returning {} active sessions", all_instances.len());
        all_instances.into_iter().filter(|i| i.status != crate::instance_manager::InstanceStatus::Ended).map(|i| {
            let status_str = match i.status {
                crate::instance_manager::InstanceStatus::Idle => "idle",
                crate::instance_manager::InstanceStatus::Thinking => "thinking",
                crate::instance_manager::InstanceStatus::Working(_) => "working",
                crate::instance_manager::InstanceStatus::Waiting => "waiting",
                crate::instance_manager::InstanceStatus::WaitingForApproval(_) => "waitingForApproval",
                crate::instance_manager::InstanceStatus::Error => "error",
                crate::instance_manager::InstanceStatus::Compacting => "compacting",
                crate::instance_manager::InstanceStatus::Ended => "ended",
            };
            json!({
                "sessionId": i.session_id,
                "projectName": i.project_name,
                "status": status_str,
                "currentTool": i.current_tool,
                "createdAt": i.started_at,
            })
        }).collect()
    };

    let response = json!({
        "deviceToken": device_token,
        "mobileConnId": mobile_conn_id,
        "sessions": sessions,
    });

    let socket = socket.clone();
    let sessions_len = sessions.len();
    tokio::spawn(async move {
        if let Err(e) = socket.emit("list:response", response).await {
            tracing::warn!("Failed to send SessionListResponse: {}", e);
        } else {
            tracing::info!("Sent SessionListResponse with {} sessions", sessions_len);
        }
    });
}
