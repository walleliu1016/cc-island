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
                tracing::info!("📱 MobileAuth (update subscription): {} devices: {:?}", device_tokens.len(), device_tokens);

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

                // Push pending popups for subscribed devices (for H5 refresh recovery)
                for device_token in &device_tokens {
                    let pending_popups = self.repo.get_pending_popups(device_token).await.unwrap_or_default();
                    for popup in pending_popups {
                        // Skip if session_id is missing
                        let session_id = match popup.session_id {
                            Some(sid) => sid,
                            None => {
                                tracing::warn!("Skipping popup {} without session_id", popup.id);
                                continue;
                            }
                        };

                        // Build hook_message from popup data
                        let hook_type = match popup.popup_type.as_str() {
                            "permission" => crate::messages::HookType::PermissionRequest,
                            "ask" => crate::messages::HookType::Notification,  // ask is Notification with type='ask'
                            _ => crate::messages::HookType::PermissionRequest,
                        };

                        // Build hook_body from popup data
                        let hook_body = if popup.popup_type == "permission" {
                            serde_json::json!({
                                "session_id": session_id,
                                "project_name": popup.project_name,
                                "tool_name": popup.data.get("tool_name"),
                                "permission_data": popup.data.get("permission_data"),
                                "tool_input": serde_json::json!({
                                    "description": popup.data.get("action"),
                                }),
                            })
                        } else {
                            // ask type
                            serde_json::json!({
                                "session_id": session_id,
                                "project_name": popup.project_name,
                                "questions": popup.data.get("questions"),
                                "notification_data": popup.data.get("notification_data"),
                            })
                        };

                        let hook_msg = CloudMessage::HookMessage {
                            device_token: device_token.clone(),
                            session_id,
                            hook_type,
                            hook_body,
                        };
                        let json = serde_json::to_string(&hook_msg).unwrap();
                        if let Err(e) = tx.try_send(Message::text(json)) {
                            tracing::warn!("Failed to send pending popup hook_message: {}", e);
                        } else {
                            tracing::info!("📱 Sent pending popup {} for device {} to mobile", popup.id, device_token);
                        }
                    }
                }

                // Request real-time session list from desktop (instead of DB query)
                for device_token in &device_tokens {
                    if self.router.has_desktop_connection(device_token) {
                        // Fast path: Desktop is on this instance, send request directly
                        let conn_id_str = self.mobile_conn_id.map(|id| id.to_string()).unwrap_or_default();
                        let request_msg = CloudMessage::RequestSessionList {
                            device_token: device_token.clone(),
                            mobile_conn_id: conn_id_str,
                        };
                        let json = serde_json::to_string(&request_msg).unwrap();
                        self.router.send_to_desktop(device_token, Message::text(json));
                        tracing::info!("📱 Sent RequestSessionList directly to desktop for {}", device_token);
                    } else {
                        // Slow path: Desktop may be on another instance, use NOTIFY
                        // Each instance will check if it has the desktop connection
                        let conn_id_str = self.mobile_conn_id.map(|id| id.to_string()).unwrap_or_default();
                        let request_msg = CloudMessage::RequestSessionList {
                            device_token: device_token.clone(),
                            mobile_conn_id: conn_id_str,
                        };
                        let message_body = serde_json::to_value(&request_msg).unwrap();
                        match self.pending_repo.insert(device_token, Direction::ToDesktop, "request_session_list", message_body).await {
                            Ok(message_id) => {
                                let payload = NotifyPayload {
                                    device_token: device_token.clone(),
                                    direction: "to_desktop".to_string(),
                                    message_id,
                                };
                                if let Err(e) = self.pending_repo.notify(&payload).await {
                                    tracing::error!("Failed to NOTIFY RequestSessionList for {}: {}", device_token, e);
                                } else {
                                    tracing::info!("📱 Stored RequestSessionList for {}, sent NOTIFY", device_token);
                                }
                            }
                            Err(e) => {
                                tracing::error!("Failed to insert RequestSessionList for {}: {}", device_token, e);
                            }
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

            // Mobile -> Cloud: Hook response (forward to desktop + broadcast PopupResolved)
            CloudMessage::HookResponse { device_token, session_id, decision, answers } => {
                tracing::info!("HookResponse from mobile: device={}, session={}, decision={:?}",
                    device_token, session_id, decision);

                // Forward to desktop
                let response_msg = CloudMessage::HookResponse {
                    device_token: device_token.clone(),
                    session_id: session_id.clone(),
                    decision: decision.clone(),
                    answers: answers.clone(),
                };
                let message_body = serde_json::to_value(&response_msg).unwrap();
                self.send_to_desktop_via_notify(&device_token, "hook_response", message_body).await;

                // Resolve ALL popups for this session in database (permission + ask)
                if let Err(e) = self.repo.resolve_popups_by_session(&session_id).await {
                    tracing::warn!("Failed to resolve popups for session {} in database: {}", session_id, e);
                }

                // Broadcast PopupResolved to all mobiles (including the responder)
                let popup_id = format!("popup-{}", session_id);
                let resolved_msg = CloudMessage::PopupResolved {
                    device_token: device_token.clone(),
                    popup_id,
                    session_id: session_id.clone(),
                    source: "mobile".to_string(),
                    decision,
                    answers,
                };
                let resolved_body = serde_json::to_value(&resolved_msg).unwrap();
                self.send_to_mobiles_via_notify(&device_token, "popup_resolved", resolved_body).await;
            }

            // Desktop -> Cloud: Popup resolved (broadcast to all mobiles)
            CloudMessage::PopupResolved { device_token, popup_id, session_id, source, decision, answers } => {
                tracing::info!("PopupResolved from {}: device={}, popup={}, session={}, decision={:?}",
                    source, device_token, popup_id, session_id, decision);

                // Resolve ALL popups for this session in database (permission + ask)
                if let Err(e) = self.repo.resolve_popups_by_session(&session_id).await {
                    tracing::warn!("Failed to resolve popups for session {} in database: {}", session_id, e);
                }

                // Broadcast to all mobiles
                let resolved_msg = CloudMessage::PopupResolved {
                    device_token: device_token.clone(),
                    popup_id,
                    session_id,
                    source,
                    decision,
                    answers,
                };
                let resolved_body = serde_json::to_value(&resolved_msg).unwrap();
                self.send_to_mobiles_via_notify(&device_token, "popup_resolved", resolved_body).await;
            }

            // Ping/Pong
            CloudMessage::Ping => {
                let pong_msg = CloudMessage::Pong;
                let json = serde_json::to_string(&pong_msg).unwrap();
                if let Err(e) = tx.try_send(Message::text(json)) {
                    tracing::warn!("Failed to send pong: {}", e);
                }
            }

            // Desktop -> Cloud: Session list response (forward to mobile)
            CloudMessage::SessionListResponse { device_token, mobile_conn_id, sessions } => {
                tracing::info!("📱 SessionListResponse from desktop: device={}, {} sessions, target_mobile={}",
                    device_token, sessions.len(), mobile_conn_id);

                // Forward to mobile via NOTIFY (mobile may be on different instance)
                let session_list_msg = CloudMessage::SessionList {
                    device_token: device_token.clone(),
                    sessions,
                };
                let message_body = serde_json::to_value(&session_list_msg).unwrap();
                self.send_to_mobiles_via_notify(&device_token, "session_list", message_body).await;
            }

            // RequestSessionList is sent by Cloud, Desktop will handle it
            CloudMessage::RequestSessionList { .. } => {
                tracing::debug!("RequestSessionList should only be sent by Cloud Server");
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
        // Extract session_id from message_body for logging
        let session_id = message_body.get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("-");

        if self.router.has_mobile_subscribers(device_token) {
            // Fast path: local subscriber exists
            let json = message_body.to_string();
            let mobile_count = self.router.get_mobile_subscriber_count(device_token);
            self.router.broadcast_to_mobiles(device_token, Message::text(json));
            tracing::info!("📤 Sent {} to mobiles: device={}, session={}, count={}", message_type, device_token, session_id, mobile_count);
        } else {
            // Slow path: no local subscriber, use NOTIFY
            tracing::info!("⏳ No local mobiles for device={}, session={}, storing {} via NOTIFY", device_token, session_id, message_type);
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
        // Extract session_id from message_body for logging
        let session_id = message_body.get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("-");

        if self.router.has_desktop_connection(device_token) {
            // Fast path: local connection exists
            let json = message_body.to_string();
            if self.router.send_to_desktop(device_token, Message::text(json)) {
                tracing::info!("✅ Sent {} to desktop: device={}, session={}", message_type, device_token, session_id);
            } else {
                tracing::warn!("❌ Failed to send {} to desktop: device={}, session={}", message_type, device_token, session_id);
            }
        } else {
            // Slow path: no local connection, use NOTIFY
            tracing::info!("⏳ No local desktop for device={}, session={}, storing {} via NOTIFY", device_token, session_id, message_type);
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
                        tracing::info!("✅ Stored {} for device={} (message_id={}), sent NOTIFY", message_type, device_token, message_id);
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to insert pending message for {}: {}", device_token, e);
                }
            }
        }
    }
}