// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::mpsc::{Sender, Receiver, channel};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{SinkExt, StreamExt};
use crate::machine_id::get_machine_token;
use crate::AppState;
use crate::popup_queue::PopupResponse;

/// Cloud client configuration
pub struct CloudConfig {
    pub server_url: String,
    pub device_name: Option<String>,
}

/// Cloud client for WebSocket connection to relay server
pub struct CloudClient {
    config: CloudConfig,
    device_token: String,
    hostname: Option<String>,
    app_state: Arc<RwLock<AppState>>,
    out_tx: Option<Sender<Message>>,
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
            out_tx: None,
            connected: Arc::new(RwLock::new(false)),
        }
    }

    /// Get device token for display to user
    pub fn get_device_token(&self) -> String {
        self.device_token.clone()
    }

    /// Get hostname for display
    pub fn get_hostname(&self) -> Option<String> {
        self.hostname.clone()
    }

    /// Check if connected to cloud server
    pub fn is_connected(&self) -> bool {
        *self.connected.read()
    }

    /// Get connected arc for external monitoring
    pub fn get_connected_arc(&self) -> Arc<RwLock<bool>> {
        self.connected.clone()
    }

    /// Get outgoing channel for hook pushing
    pub fn get_out_tx(&self) -> Option<Sender<Message>> {
        self.out_tx.clone()
    }

    /// Connect to cloud server with timeout
    pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let server_url = self.config.server_url.clone();
        let device_token = self.device_token.clone();
        let hostname = self.hostname.clone();
        let device_name = self.config.device_name.clone();

        tracing::info!("Connecting to cloud server: {}", server_url);

        // Connect WebSocket with 5 second timeout (don't block app startup)
        let connect_result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            connect_async(&server_url)
        ).await;

        let (ws_stream, _) = match connect_result {
            Ok(Ok(stream)) => stream,
            Ok(Err(e)) => return Err(format!("Connection refused: {}", e).into()),
            Err(_) => return Err("Connection timeout after 5 seconds".into()),
        };

        let (mut ws_tx, mut ws_rx) = ws_stream.split();

        // Create outgoing message channel
        let (out_tx, mut out_rx): (Sender<Message>, Receiver<Message>) = channel(64);
        self.out_tx = Some(out_tx.clone());

        // Send device registration with hostname
        let register_msg = serde_json::json!({
            "type": "device_register",
            "device_token": device_token,
            "hostname": hostname,
            "device_name": device_name,
        });
        ws_tx.send(Message::text(register_msg.to_string())).await?;

        // Wait for auth response - must receive one
        match ws_rx.next().await {
            Some(Ok(msg)) => {
                if let Message::Text(text) = msg {
                    let json: serde_json::Value = serde_json::from_str(&text)?;
                    if json["type"] == "auth_success" {
                        tracing::info!("Cloud authentication successful");
                        *self.connected.write() = true;

                        // Send existing sessions to cloud after connection
                        // This allows mobile to see already-running Claude instances
                        let app_state = self.app_state.clone();
                        let device_token = self.device_token.clone();
                        let out_tx_clone = out_tx.clone();
                        tokio::spawn(async move {
                            // Need to drop read lock before acquiring write lock for parsing
                            let instances: Vec<(String, Option<String>, String)> = {
                                let state = app_state.read();
                                let all_instances = state.instances.get_all_instances_display();
                                tracing::info!("Sending {} existing sessions to cloud", all_instances.len());
                                all_instances.into_iter().map(|i| (
                                    i.session_id.clone(),
                                    i.session_cwd.clone(),
                                    i.project_name.clone(),  // project_name is String, not Option
                                )).collect()
                            };

                            for (session_id, cwd, project_name) in instances {
                                // Send SessionStart-like hook message for existing session
                                let hook_body = serde_json::json!({
                                    "hook_event_name": "SessionStart",
                                    "session_id": session_id,
                                    "cwd": cwd,
                                    "project_name": project_name,
                                });
                                let msg = serde_json::json!({
                                    "type": "hook_message",
                                    "device_token": device_token,
                                    "session_id": session_id,
                                    "hook_type": "SessionStart",  // PascalCase for consistency
                                    "hook_body": hook_body,
                                });
                                if let Err(e) = out_tx_clone.try_send(Message::text(msg.to_string())) {
                                    tracing::warn!("Failed to send existing session hook: {}", e);
                                }

                                // Parse and push chat history for existing session
                                if let Some(cwd_str) = cwd {
                                    // Parse full JSONL for existing session (not incremental, since we want complete history)
                                    // Need to access conversation_parser through app_state
                                    let messages = {
                                        let mut state = app_state.write();
                                        state.conversation_parser.parse_full(&session_id, &cwd_str)
                                    };
                                    if !messages.is_empty() {
                                        let chat_messages = crate::conversation_parser::ConversationParser::to_chat_messages(messages);
                                        tracing::info!("Pushing {} chat messages for existing session {}", chat_messages.len(), session_id);

                                        // Convert ChatMessage to ChatMessageData format
                                        let messages_data: Vec<serde_json::Value> = chat_messages.iter().map(|msg| {
                                            serde_json::json!({
                                                "id": msg.id,
                                                "sessionId": msg.session_id,
                                                "messageType": msg.message_type,
                                                "content": msg.content,
                                                "toolName": msg.tool_name,
                                                "timestamp": msg.timestamp,
                                            })
                                        }).collect();

                                        let chat_msg = serde_json::json!({
                                            "type": "chat_history",
                                            "device_token": device_token,
                                            "session_id": session_id,
                                            "messages": messages_data,
                                        });
                                        if let Err(e) = out_tx_clone.try_send(Message::text(chat_msg.to_string())) {
                                            tracing::warn!("Failed to send chat history for {}: {}", session_id, e);
                                        }
                                    }
                                }
                            }
                        });
                    } else if json["type"] == "auth_failed" {
                        let reason = json["reason"].as_str().unwrap_or("unknown");
                        tracing::error!("Cloud authentication failed: {}", reason);
                        return Err(format!("Auth failed: {}", reason).into());
                    } else {
                        tracing::error!("Unexpected auth response: {}", json["type"]);
                        return Err("Unexpected auth response".into());
                    }
                } else {
                    return Err("Expected text message for auth response".into());
                }
            },
            Some(Err(e)) => {
                tracing::error!("WebSocket error during auth: {}", e);
                return Err(format!("WebSocket error: {}", e).into());
            },
            None => {
                tracing::error!("Connection closed before auth response received");
                return Err("No auth response received".into());
            },
        }

        // Spawn send task
        let connected = self.connected.clone();
        let send_task = async move {
            while let Some(msg) = out_rx.recv().await {
                if ws_tx.send(msg).await.is_err() {
                    tracing::warn!("Send task: WebSocket send failed");
                    *connected.write() = false;
                    break;
                }
            }
            tracing::info!("Send task ended");
        };

        // Spawn receive task
        let app_state = self.app_state.clone();
        let connected = self.connected.clone();
        let recv_task = async move {
            while let Some(msg) = ws_rx.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        let json: serde_json::Value = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(e) => {
                                tracing::warn!("Failed to parse WebSocket message as JSON: {}", e);
                                serde_json::json!({})
                            }
                        };
                        if json["type"] == "hook_response" {
                            handle_hook_response(&app_state, &json);
                        }
                    },
                    Ok(Message::Pong(_)) => {},
                    Ok(Message::Close(_)) => {
                        tracing::info!("Receive task: Close frame received");
                        *connected.write() = false;
                        break;
                    },
                    Err(e) => {
                        tracing::error!("WebSocket error: {}", e);
                        *connected.write() = false;
                        break;
                    },
                    _ => {}
                }
            }
            tracing::info!("Receive task ended");
        };

        tokio::spawn(async move {
            tokio::select! {
                _ = send_task => {},
                _ = recv_task => {},
            }
            tracing::info!("Cloud client disconnected");
        });

        Ok(())
    }

    /// Push hook message to cloud (transparent forwarding)
    pub fn push_hook_message(&self, session_id: &str, hook_type: &str, hook_body: serde_json::Value) {
        if !self.is_connected() {
            return;
        }

        if let Some(tx) = &self.out_tx {
            let msg = serde_json::json!({
                "type": "hook_message",
                "device_token": self.device_token,
                "session_id": session_id,
                "hook_type": hook_type,
                "hook_body": hook_body,
            });
            if let Err(e) = tx.try_send(Message::text(msg.to_string())) {
                tracing::warn!("Failed to push hook message: {}", e);
            }
        }
    }

    /// Push chat history to cloud
    pub fn push_chat_history(&self, session_id: &str, messages: Vec<crate::chat_messages::ChatMessage>) {
        tracing::info!("🔵 push_chat_history called: session={}, messages={}, connected={}",
            session_id, messages.len(), self.is_connected());

        if !self.is_connected() {
            tracing::warn!("🔵 push_chat_history SKIPPED: not connected to cloud");
            return;
        }

        if let Some(tx) = &self.out_tx {
            // Convert ChatMessage to ChatMessageData format (camelCase for frontend)
            let messages_data: Vec<serde_json::Value> = messages.iter().map(|msg| {
                serde_json::json!({
                    "id": msg.id,
                    "sessionId": msg.session_id,
                    "messageType": msg.message_type,
                    "content": msg.content,
                    "toolName": msg.tool_name,
                    "timestamp": msg.timestamp,
                })
            }).collect();

            let msg = serde_json::json!({
                "type": "chat_history",
                "device_token": self.device_token,
                "session_id": session_id,
                "messages": messages_data,
            });
            tracing::info!("🔵 push_chat_history SENDING: session={}, {} messages to cloud",
                session_id, messages_data.len());
            if let Err(e) = tx.try_send(Message::text(msg.to_string())) {
                tracing::warn!("🔵 push_chat_history FAILED: {}", e);
            } else {
                tracing::info!("🔵 push_chat_history SUCCESS: sent to cloud");
            }
        } else {
            tracing::warn!("🔵 push_chat_history SKIPPED: no out_tx channel");
        }
    }
}

fn handle_hook_response(app_state: &Arc<RwLock<AppState>>, json: &serde_json::Value) {
    let session_id = json["session_id"].as_str().unwrap_or("");
    let decision = json["decision"].as_str();
    let answers = json["answers"].as_array();

    tracing::info!("Received hook response from mobile: session {} -> {:?}", session_id, decision);

    // Build PopupResponse and resolve via popup_queue
    // Need to find popup_id by session_id
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

        // Resolve the popup through popup_queue
        let resolved = {
            let mut state = app_state.write();
            state.popups.resolve(response.clone())
        };

        if resolved {
            // Clear WaitingForApproval status for the instance
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