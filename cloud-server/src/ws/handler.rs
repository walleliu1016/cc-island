// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message;
use crate::messages::CloudMessage;
use crate::cache::state_cache::StateCache;
use crate::db::repository::Repository;
use super::router::ConnectionRouter;

/// Handles incoming WebSocket messages
pub struct MessageHandler {
    router: ConnectionRouter,
    cache: StateCache,
    repo: Repository,
}

impl MessageHandler {
    pub fn new(router: ConnectionRouter, cache: StateCache, repo: Repository) -> Self {
        Self { router, cache, repo }
    }

    /// Handle an incoming message from a client
    pub async fn handle(&self, msg: CloudMessage, tx: &Sender<Message>, _device_token: &str) {
        match msg {
            // Desktop -> Cloud messages
            CloudMessage::StateUpdate { device_token, sessions, popups } => {
                tracing::info!("StateUpdate from desktop: {} sessions, {} popups", sessions.len(), popups.len());

                // Update database
                if let Err(e) = self.repo.upsert_sessions(&device_token, &sessions).await {
                    tracing::error!("Failed to upsert sessions: {}", e);
                }

                // Update cache
                self.cache.update_state(&device_token, sessions.clone(), popups.clone());

                // Broadcast to mobiles
                let update_msg = CloudMessage::InitialState { sessions, popups };
                let json = serde_json::to_string(&update_msg).unwrap();
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
                tracing::debug!("Broadcasted state update to mobiles for device: {}", device_token);
            }

            CloudMessage::NewPopup { device_token, popup } => {
                tracing::info!("NewPopup from desktop: popup_id={}, type={}", popup.id, popup.popup_type);

                // Save to database
                if let Err(e) = self.repo.upsert_popup(&device_token, &popup).await {
                    tracing::error!("Failed to upsert popup: {}", e);
                }

                // Update cache
                self.cache.add_popup(&device_token, popup.clone());

                // Broadcast to mobiles
                let popup_msg = CloudMessage::NewPopupFromDevice {
                    device_token: device_token.clone(),
                    popup,
                };
                let json = serde_json::to_string(&popup_msg).unwrap();
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
                tracing::debug!("Broadcasted new popup to mobiles for device: {}", device_token);
            }

            CloudMessage::ChatMessages { device_token, session_id, messages } => {
                tracing::info!("ChatMessages from desktop: device={}, session={}, {} messages",
                    device_token, session_id, messages.len());

                // Save messages to database
                if let Err(e) = self.repo.upsert_chat_messages(&device_token, &session_id, &messages).await {
                    tracing::error!("Failed to upsert chat messages: {}", e);
                }

                // Broadcast NewChat to mobiles subscribed to this device_token
                let new_chat_msg = CloudMessage::NewChat { session_id, messages };
                let json = serde_json::to_string(&new_chat_msg).unwrap();
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
                tracing::debug!("Broadcasted chat messages to mobiles for device: {}", device_token);
            }

            CloudMessage::Ping => {
                let pong_msg = CloudMessage::Pong;
                let json = serde_json::to_string(&pong_msg).unwrap();
                if let Err(e) = tx.try_send(Message::text(json)) {
                    tracing::warn!("Failed to send pong: {}", e);
                }
            }

            // Mobile -> Cloud messages
            CloudMessage::RespondPopup { device_token, popup_id, decision, answers } => {
                tracing::info!("RespondPopup from mobile: popup_id={}, decision={:?}",
                    popup_id, decision);

                // Mark as resolved in database
                if let Err(e) = self.repo.resolve_popup(&popup_id).await {
                    tracing::error!("Failed to resolve popup: {}", e);
                }

                // Remove from cache
                self.cache.remove_popup(&device_token, &popup_id);

                // Broadcast PopupResolved to all mobiles (including the sender for confirmation)
                let resolved_msg = CloudMessage::PopupResolved {
                    device_token: device_token.clone(),
                    popup_id: popup_id.clone(),
                    source: "mobile".to_string(),
                    decision: decision.clone(),
                    answers: answers.clone(),
                };
                let json = serde_json::to_string(&resolved_msg).unwrap();
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
                tracing::debug!("Broadcasted popup_resolved to mobiles for device: {}", device_token);

                // Send to desktop
                let response_msg = CloudMessage::PopupResponse {
                    popup_id,
                    decision,
                    answers,
                };
                let json = serde_json::to_string(&response_msg).unwrap();
                self.router.send_to_desktop(&device_token, Message::text(json));
                tracing::debug!("Sent popup response to desktop for device: {}", device_token);
            }

            CloudMessage::RequestChatHistory { device_token, session_id, limit } => {
                tracing::info!("RequestChatHistory from mobile: device={}, session={}, limit={:?}",
                    device_token, session_id, limit);

                // Query chat history from database
                match self.repo.get_chat_history(&device_token, &session_id, limit).await {
                    Ok(messages) => {
                        tracing::info!("ChatHistory response: {} messages for session {}", messages.len(), session_id);

                        // Send ChatHistory response back to the requesting client
                        let history_msg = CloudMessage::ChatHistory { session_id, messages };
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

            // Desktop -> Cloud: popup resolved notification (when desktop locally handles)
            CloudMessage::PopupResolved { device_token, popup_id, source, decision, answers } => {
                // Only handle if source is "desktop" (mobile sends RespondPopup instead)
                if source == "desktop" {
                    tracing::info!("PopupResolved from desktop: popup_id={}, decision={:?}",
                        popup_id, decision);

                    // Remove from cache
                    self.cache.remove_popup(&device_token, &popup_id);

                    // Broadcast to all mobiles subscribed to this device
                    let resolved_msg = CloudMessage::PopupResolved {
                        device_token: device_token.clone(),
                        popup_id: popup_id.clone(),
                        source: source.clone(),
                        decision: decision.clone(),
                        answers: answers.clone(),
                    };
                    let json = serde_json::to_string(&resolved_msg).unwrap();
                    self.router.broadcast_to_mobiles(&device_token, Message::text(json));
                    tracing::debug!("Broadcasted popup_resolved to mobiles for device: {}", device_token);
                }
            }

            // Auth messages are handled separately in connection handler
            CloudMessage::DeviceRegister { .. } |
            CloudMessage::MobileAuth { .. } |
            CloudMessage::AuthSuccess { .. } |
            CloudMessage::AuthFailed { .. } => {
                tracing::debug!("Auth message should be handled in connection setup");
            }

            // Cloud -> Mobile messages (should not be received from clients)
            CloudMessage::InitialState { .. } |
            CloudMessage::NewPopupFromDevice { .. } |
            CloudMessage::NewChat { .. } |
            CloudMessage::ChatHistory { .. } |
            CloudMessage::DeviceList { .. } |
            CloudMessage::DeviceOffline { .. } |

            // Cloud -> Desktop messages (should not be received from clients)
            CloudMessage::PopupResponse { .. } |
            CloudMessage::Pong => {
                tracing::warn!("Received unexpected message type from client: {:?}", msg);
            }
        }
    }
}