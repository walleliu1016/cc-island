// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message;
use crate::messages::CloudMessage;
use crate::db::repository::Repository;
use crate::db::pending_message::{PendingMessageRepo, Direction, NotifyPayload};
use super::router::ConnectionRouter;
use uuid::Uuid;

/// Handles incoming WebSocket messages
pub struct MessageHandler {
    router: ConnectionRouter,
    repo: Repository,
    pending_repo: PendingMessageRepo,
    mobile_conn_id: Option<uuid::Uuid>,
}

impl MessageHandler {
    pub fn new(router: ConnectionRouter, repo: Repository, pending_repo: PendingMessageRepo, mobile_conn_id: Option<Uuid>) -> Self {
        Self { router, repo, pending_repo, mobile_conn_id }
    }

    /// Handle an incoming message from a client
    pub async fn handle(&self, msg: CloudMessage, tx: &Sender<Message>, _device_token: &str) {
        match msg {
            // Mobile -> Cloud: Update subscription
            CloudMessage::MobileAuth { device_tokens } => {
                tracing::info!("MobileAuth (update subscription): {} devices: {:?}", device_tokens.len(), device_tokens);

                // Update mobile subscription in router
                if let Some(conn_id) = self.mobile_conn_id {
                    self.router.update_mobile_subscription(conn_id, &device_tokens, tx);
                }

                // Send auth success
                let auth_success = CloudMessage::AuthSuccess {
                    device_id: device_tokens.first().cloned().unwrap_or_default(),
                    hostname: None,
                };
                let json = serde_json::to_string(&auth_success).unwrap();
                if let Err(e) = tx.try_send(Message::text(json)) {
                    tracing::warn!("Failed to send auth_success: {}", e);
                }

                // Send subscribed devices info
                let devices_info = self.repo.get_devices_info(&device_tokens).await.unwrap_or_default();
                let device_list_msg = CloudMessage::DeviceList { devices: devices_info };
                let json = serde_json::to_string(&device_list_msg).unwrap();
                if let Err(e) = tx.try_send(Message::text(json)) {
                    tracing::warn!("Failed to send device list: {}", e);
                }

                // Send active sessions for each subscribed device
                for device_token in &device_tokens {
                    match self.repo.get_active_sessions(&[device_token.clone()]).await {
                        Ok(sessions) => {
                            // Convert to ClaudeSession format
                            let claude_sessions: Vec<crate::messages::ClaudeSession> = sessions
                                .into_iter()
                                .filter_map(|s| {
                                    Some(crate::messages::ClaudeSession {
                                        session_id: s.session_id,
                                        project_name: s.project_name.unwrap_or_else(|| "未知项目".to_string()),
                                        status: s.status,
                                        current_tool: s.current_tool,
                                        created_at: s.started_at.map(|t| t.timestamp_millis() as u64),
                                    })
                                })
                                .collect();

                            if !claude_sessions.is_empty() {
                                let session_list_msg = CloudMessage::SessionList {
                                    device_token: device_token.clone(),
                                    sessions: claude_sessions,
                                };
                                let json = serde_json::to_string(&session_list_msg).unwrap();
                                if let Err(e) = tx.try_send(Message::text(json)) {
                                    tracing::warn!("Failed to send session list for {}: {}", device_token, e);
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Failed to get sessions for {}: {}", device_token, e);
                        }
                    }
                }
            }

            // Desktop -> Cloud: Hook message (transparent forwarding + persistence)
            CloudMessage::HookMessage { device_token, session_id, hook_type, hook_body } => {
                tracing::info!("HookMessage from desktop: device={}, session={}, hook_type={:?}",
                    device_token, session_id, hook_type);

                // Extract project_name (prefer hook_body.project_name, fallback to cwd)
                let project_name = hook_body.get("project_name")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        // Extract project name from cwd path
                        hook_body.get("cwd").and_then(|cwd| {
                            cwd.as_str().and_then(|s| {
                                s.rsplit('/').next()
                            })
                        })
                    });

                // Always update project_name if available (for any hook type)
                if let Some(name) = project_name {
                    if let Err(e) = self.repo.update_session_project_name(&device_token, &session_id, name).await {
                        tracing::debug!("Could not update project_name (session may not exist): {}", e);
                    }
                }

                match hook_type {
                    crate::messages::HookType::SessionStart => {
                        // Create new session
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            project_name,
                            "idle",
                            None,
                        ).await {
                            tracing::error!("Failed to persist SessionStart: {}", e);
                        } else {
                            tracing::info!("Session persisted: device={}, session={}, project={:?}",
                                device_token, session_id, project_name);
                        }
                    }
                    crate::messages::HookType::SessionEnd => {
                        // Mark session as ended
                        if let Err(e) = self.repo.end_session(&device_token, &session_id).await {
                            tracing::error!("Failed to persist SessionEnd: {}", e);
                        } else {
                            tracing::info!("Session ended: device={}, session={}", device_token, session_id);
                        }
                    }
                    crate::messages::HookType::PreToolUse => {
                        // Update session to working
                        let tool_name = hook_body.get("tool_name")
                            .and_then(|v| v.as_str());
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "working",
                            tool_name,
                        ).await {
                            tracing::error!("Failed to persist PreToolUse: {}", e);
                        }
                    }
                    crate::messages::HookType::PostToolUse => {
                        // Update session to waiting
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "waiting",
                            None,
                        ).await {
                            tracing::error!("Failed to persist PostToolUse: {}", e);
                        }
                    }
                    crate::messages::HookType::Stop => {
                        // Update session to idle
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "idle",
                            None,
                        ).await {
                            tracing::error!("Failed to persist Stop: {}", e);
                        }
                    }
                    crate::messages::HookType::UserPromptSubmit => {
                        // Update session to thinking
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "thinking",
                            None,
                        ).await {
                            tracing::error!("Failed to persist UserPromptSubmit: {}", e);
                        }
                    }
                    crate::messages::HookType::PostToolUseFailure => {
                        // Update session to error
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "error",
                            None,
                        ).await {
                            tracing::error!("Failed to persist PostToolUseFailure: {}", e);
                        }
                    }
                    crate::messages::HookType::PreCompact => {
                        // Update session to compacting
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "compacting",
                            None,
                        ).await {
                            tracing::error!("Failed to persist PreCompact: {}", e);
                        }
                    }
                    crate::messages::HookType::PostCompact => {
                        // Update session to idle
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "idle",
                            None,
                        ).await {
                            tracing::error!("Failed to persist PostCompact: {}", e);
                        }
                    }
                    crate::messages::HookType::Elicitation => {
                        // Handle AskUserQuestion (Elicitation)
                        let questions = hook_body.get("questions");

                        // Generate popup_id for elicitation
                        let popup_id = format!("elicitation-{}", session_id);

                        // Create popup data
                        let popup_data = serde_json::json!({
                            "questions": questions,
                        });

                        // Persist popup to database
                        if let Err(e) = self.repo.upsert_popup(
                            &device_token,
                            &session_id,
                            &popup_id,
                            "ask",
                            project_name,
                            popup_data,
                        ).await {
                            tracing::error!("Failed to persist Elicitation popup: {}", e);
                        }

                        // Update session status
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "waitingForApproval",
                            None,
                        ).await {
                            tracing::error!("Failed to persist Elicitation session: {}", e);
                        }
                    }
                    crate::messages::HookType::PermissionRequest => {
                        // Update session to waitingForApproval
                        let tool_name = hook_body.get("tool_name")
                            .and_then(|v| v.as_str());

                        // Generate popup_id from session_id
                        let popup_id = format!("popup-{}", session_id);

                        // Create popup data
                        let popup_data = serde_json::json!({
                            "tool_name": tool_name,
                            "action": hook_body.get("tool_input").and_then(|v| v.get("description")).and_then(|v| v.as_str()),
                            "permission_data": hook_body.get("permission_data"),
                        });

                        // Persist popup to database
                        if let Err(e) = self.repo.upsert_popup(
                            &device_token,
                            &session_id,
                            &popup_id,
                            "permission",
                            project_name,
                            popup_data,
                        ).await {
                            tracing::error!("Failed to persist PermissionRequest popup: {}", e);
                        }

                        // Update session status
                        if let Err(e) = self.repo.upsert_session(
                            &device_token,
                            &session_id,
                            None,
                            "waitingForApproval",
                            tool_name,
                        ).await {
                            tracing::error!("Failed to persist PermissionRequest session: {}", e);
                        }
                    }
                    crate::messages::HookType::Notification => {
                        // Check if it's an ask (blocking) notification
                        let notification_data = hook_body.get("notification_data");
                        let is_ask = notification_data
                            .and_then(|d| d.get("type"))
                            .and_then(|t| t.as_str())
                            .map(|t| t == "ask")
                            .unwrap_or(false);

                        if is_ask || hook_body.get("questions").is_some() {
                            // Generate popup_id for ask
                            let popup_id = format!("ask-{}", session_id);

                            // Get questions
                            let questions = notification_data
                                .and_then(|d| d.get("questions"))
                                .or_else(|| hook_body.get("questions"));

                            // Create popup data
                            let popup_data = serde_json::json!({
                                "questions": questions,
                                "notification_data": notification_data,
                            });

                            // Persist popup to database
                            if let Err(e) = self.repo.upsert_popup(
                                &device_token,
                                &session_id,
                                &popup_id,
                                "ask",
                                project_name,
                                popup_data,
                            ).await {
                                tracing::error!("Failed to persist Notification ask popup: {}", e);
                            }

                            // Update session status
                            if let Err(e) = self.repo.upsert_session(
                                &device_token,
                                &session_id,
                                None,
                                "waitingForApproval",
                                None,
                            ).await {
                                tracing::error!("Failed to persist Notification session: {}", e);
                            }
                        }
                    }
                    _ => {}
                }

                // Forward to all subscribed mobiles
                let hook_msg = CloudMessage::HookMessage {
                    device_token: device_token.clone(),
                    session_id,
                    hook_type,
                    hook_body,
                };
                let message_body = serde_json::to_value(&hook_msg).unwrap();
                self.send_to_mobiles_via_notify(&device_token, "hook_message", message_body).await;
            }

            // Desktop -> Cloud: Chat history sync
            CloudMessage::ChatHistory { device_token, session_id, messages } => {
                tracing::info!("🟢 ChatHistory from desktop: device={}, session={}, {} messages",
                    device_token, session_id, messages.len());

                // Save messages to database
                if let Err(e) = self.repo.upsert_chat_messages(&device_token, &session_id, &messages).await {
                    tracing::error!("🟢 ChatHistory DB ERROR: {}", e);
                } else {
                    tracing::info!("🟢 ChatHistory DB SAVED: {} messages for session {}", messages.len(), session_id);
                }

                // Forward to all subscribed mobiles
                let chat_msg = CloudMessage::ChatHistory {
                    device_token: device_token.clone(),
                    session_id,
                    messages,
                };
                let message_body = serde_json::to_value(&chat_msg).unwrap();
                tracing::info!("🟢 ChatHistory BROADCASTING to mobiles for device {}", device_token);
                self.send_to_mobiles_via_notify(&device_token, "chat_history", message_body).await;
            }

            // Mobile -> Cloud: Request chat history
            CloudMessage::RequestChatHistory { device_token, session_id, limit } => {
                tracing::info!("RequestChatHistory from mobile: device={}, session={}, limit={:?}",
                    device_token, session_id, limit);

                // Query chat history from database
                match self.repo.get_chat_history(&device_token, &session_id, limit).await {
                    Ok(messages) => {
                        let history_msg = CloudMessage::ChatHistory {
                            device_token: device_token.clone(),
                            session_id,
                            messages,
                        };
                        let json = serde_json::to_string(&history_msg).unwrap();
                        if let Err(e) = tx.try_send(Message::text(json)) {
                            tracing::warn!("Failed to send chat history: {}", e);
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to get chat history: {}", e);
                    }
                }
            }

            // Mobile -> Cloud: Hook response (forward to desktop)
            CloudMessage::HookResponse { device_token, session_id, decision, answers } => {
                tracing::info!("HookResponse from mobile: device={}, session={}, decision={:?}",
                    device_token, session_id, decision);

                // Forward to desktop
                let response_msg = CloudMessage::HookResponse {
                    device_token: device_token.clone(),
                    session_id,
                    decision,
                    answers,
                };
                let message_body = serde_json::to_value(&response_msg).unwrap();
                self.send_to_desktop_via_notify(&device_token, "hook_response", message_body).await;
            }

            // Ping/Pong
            CloudMessage::Ping => {
                let pong_msg = CloudMessage::Pong;
                let json = serde_json::to_string(&pong_msg).unwrap();
                if let Err(e) = tx.try_send(Message::text(json)) {
                    tracing::warn!("Failed to send pong: {}", e);
                }
            }

            // Auth messages are handled in connection handler
            CloudMessage::DeviceRegister { .. } |
            CloudMessage::AuthSuccess { .. } |
            CloudMessage::AuthFailed { .. } |
            CloudMessage::DeviceList { .. } |
            CloudMessage::DeviceOnline { .. } |
            CloudMessage::DeviceOffline { .. } |
            CloudMessage::SessionList { .. } |
            CloudMessage::Pong => {
                tracing::debug!("Auth/connection message should be handled in connection setup");
            }
        }
    }

    /// Send message to mobiles, using NOTIFY if not locally subscribed
    async fn send_to_mobiles_via_notify(&self, device_token: &str, message_type: &str, message_body: serde_json::Value) {
        if self.router.has_mobile_subscribers(device_token) {
            // Fast path: local subscriber exists
            let json = message_body.to_string();
            self.router.broadcast_to_mobiles(device_token, Message::text(json));
            tracing::debug!("Sent {} directly to local mobile subscribers", message_type);
        } else {
            // Slow path: no local subscriber, use NOTIFY
            match self.pending_repo.insert(device_token, Direction::ToMobile, message_type, message_body.clone()).await {
                Ok(message_id) => {
                    let payload = NotifyPayload {
                        device_token: device_token.to_string(),
                        direction: "to_mobile".to_string(),
                        message_id,
                    };
                    if let Err(e) = self.pending_repo.notify(&payload).await {
                        tracing::error!("Failed to NOTIFY for {}: {}", device_token, e);
                    } else {
                        tracing::debug!("Stored {} for device {}, sent NOTIFY", message_type, device_token);
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to insert pending message for {}: {}", device_token, e);
                }
            }
        }
    }

    /// Send message to desktop, using NOTIFY if not locally connected
    async fn send_to_desktop_via_notify(&self, device_token: &str, message_type: &str, message_body: serde_json::Value) {
        if self.router.has_desktop_connection(device_token) {
            // Fast path: local connection exists
            let json = message_body.to_string();
            self.router.send_to_desktop(device_token, Message::text(json));
            tracing::debug!("Sent {} directly to local desktop", message_type);
        } else {
            // Slow path: no local connection, use NOTIFY
            match self.pending_repo.insert(device_token, Direction::ToDesktop, message_type, message_body.clone()).await {
                Ok(message_id) => {
                    let payload = NotifyPayload {
                        device_token: device_token.to_string(),
                        direction: "to_desktop".to_string(),
                        message_id,
                    };
                    if let Err(e) = self.pending_repo.notify(&payload).await {
                        tracing::error!("Failed to NOTIFY for {}: {}", device_token, e);
                    } else {
                        tracing::debug!("Stored {} for device {}, sent NOTIFY", message_type, device_token);
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to insert pending message for {}: {}", device_token, e);
                }
            }
        }
    }
}