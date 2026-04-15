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
            }

            CloudMessage::NewPopup { device_token, popup } => {
                // Save to database
                if let Err(e) = self.repo.upsert_popup(&device_token, &popup).await {
                    tracing::error!("Failed to upsert popup: {}", e);
                }

                // Update cache
                self.cache.add_popup(&device_token, popup.clone());

                // Broadcast to mobiles
                let popup_msg = CloudMessage::NewPopupFromDevice { popup };
                let json = serde_json::to_string(&popup_msg).unwrap();
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
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
                // Mark as resolved in database
                if let Err(e) = self.repo.resolve_popup(&popup_id).await {
                    tracing::error!("Failed to resolve popup: {}", e);
                }

                // Remove from cache
                self.cache.remove_popup(&device_token, &popup_id);

                // Send to desktop
                let response_msg = CloudMessage::PopupResponse {
                    popup_id,
                    decision,
                    answers,
                };
                let json = serde_json::to_string(&response_msg).unwrap();
                self.router.send_to_desktop(&device_token, Message::text(json));
            }

            // Auth messages are handled separately in connection handler
            CloudMessage::DeviceRegister { .. } |
            CloudMessage::MobileAuth { .. } |
            CloudMessage::AuthSuccess { .. } |
            CloudMessage::AuthFailed { .. } => {
                tracing::debug!("Auth message should be handled in connection setup");
            }

            // Other messages not handled in MVP
            _ => {
                tracing::debug!("Unhandled message type: {:?}", msg);
            }
        }
    }
}