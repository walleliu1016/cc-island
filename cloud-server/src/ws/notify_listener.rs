// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use anyhow::Result;
use tokio_util::sync::CancellationToken;
use crate::db::pending_message::{PendingMessageRepo, NotifyPayload};
use super::router::ConnectionRouter;

/// Listen for PostgreSQL NOTIFY events and handle cross-instance messages
pub struct NotifyListener {
    pool: PgPool,
    router: ConnectionRouter,
    pending_repo: PendingMessageRepo,
}

impl NotifyListener {
    pub fn new(pool: PgPool, router: ConnectionRouter) -> Self {
        let pending_repo = PendingMessageRepo::new(pool.clone());
        Self {
            pool,
            router,
            pending_repo,
        }
    }

    /// Start listening for NOTIFY events
    pub async fn run(self, shutdown: CancellationToken) -> Result<()> {
        tracing::info!("NotifyListener starting, LISTEN on 'pending_message_notify'");

        // Create dedicated listener connection
        let mut listener = PgListener::connect_with(&self.pool).await?;
        listener.listen("pending_message_notify").await?;

        tracing::info!("NotifyListener connected and listening");

        loop {
            tokio::select! {
                // Wait for NOTIFY notification
                notification = listener.recv() => {
                    match notification {
                        Ok(notif) => {
                            tracing::debug!("Received NOTIFY: {:?}", notif.payload());
                            self.handle_notification(notif.payload());
                        }
                        Err(e) => {
                            tracing::error!("NotifyListener error: {}, reconnecting...", e);
                            // Reconnect on error with shutdown check
                            loop {
                                tokio::select! {
                                    reconnect_result = PgListener::connect_with(&self.pool) => {
                                        match reconnect_result {
                                            Ok(new_listener) => {
                                                listener = new_listener;
                                                if let Err(e) = listener.listen("pending_message_notify").await {
                                                    tracing::error!("Failed to re-LISTEN: {}", e);
                                                    continue;
                                                }
                                                tracing::info!("NotifyListener reconnected");
                                                break;
                                            }
                                            Err(e) => {
                                                tracing::error!("Reconnect failed: {}, retrying in 5s...", e);
                                                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                                            }
                                        }
                                    }
                                    _ = shutdown.cancelled() => {
                                        tracing::info!("NotifyListener shutdown during reconnect");
                                        return Ok(());
                                    }
                                }
                            }
                        }
                    }
                }

                // Handle shutdown signal
                _ = shutdown.cancelled() => {
                    tracing::info!("NotifyListener shutdown signal received");
                    break;
                }
            }
        }

        tracing::info!("NotifyListener stopped");
        Ok(())
    }

    /// Handle a NOTIFY notification payload
    fn handle_notification(&self, payload: &str) {
        // Parse NOTIFY payload
        let notify_data: NotifyPayload = match serde_json::from_str(payload) {
            Ok(data) => data,
            Err(e) => {
                tracing::warn!("Failed to parse NOTIFY payload '{}': {}", payload, e);
                return;
            }
        };

        tracing::debug!(
            "NOTIFY received: device={}, direction={}, msg_id={}",
            notify_data.device_token,
            notify_data.direction,
            notify_data.message_id
        );

        // Check if target connection belongs to this instance
        if notify_data.direction == "to_mobile" {
            if self.router.has_mobile_subscribers(&notify_data.device_token) {
                // Belongs to us -> retrieve -> deliver -> delete
                self.deliver_to_mobile(&notify_data);
            } else {
                tracing::debug!("NOTIFY skipped (no mobile subscriber for {})", notify_data.device_token);
            }
        } else if notify_data.direction == "to_desktop" {
            if self.router.has_desktop_connection(&notify_data.device_token) {
                // Belongs to us -> retrieve -> deliver -> delete
                self.deliver_to_desktop(&notify_data);
            } else {
                tracing::debug!("NOTIFY skipped (no desktop connection for {})", notify_data.device_token);
            }
        }
    }

    /// Deliver message to mobile subscribers
    fn deliver_to_mobile(&self, notify_data: &NotifyPayload) {
        // Use blocking spawn to handle async DB operation
        let pending_repo = self.pending_repo.clone();
        let router = self.router.clone();
        let device_token = notify_data.device_token.clone();
        let message_id = notify_data.message_id;

        tokio::spawn(async move {
            match pending_repo.get_and_delete(message_id).await {
                Ok(Some(pending)) => {
                    let msg = pending_repo.to_ws_message(&pending);
                    router.broadcast_to_mobiles(&device_token, msg);
                    tracing::info!("Delivered pending message {} to mobile for device {}", message_id, device_token);
                }
                Ok(None) => {
                    tracing::debug!("Pending message {} already delivered by another instance", message_id);
                }
                Err(e) => {
                    tracing::error!("Failed to retrieve pending message {}: {}", message_id, e);
                }
            }
        });
    }

    /// Deliver message to desktop connection
    fn deliver_to_desktop(&self, notify_data: &NotifyPayload) {
        let pending_repo = self.pending_repo.clone();
        let router = self.router.clone();
        let device_token = notify_data.device_token.clone();
        let message_id = notify_data.message_id;

        tokio::spawn(async move {
            match pending_repo.get_and_delete(message_id).await {
                Ok(Some(pending)) => {
                    let msg = pending_repo.to_ws_message(&pending);
                    router.send_to_desktop(&device_token, msg);
                    tracing::info!("Delivered pending message {} to desktop for device {}", message_id, device_token);
                }
                Ok(None) => {
                    tracing::debug!("Pending message {} already delivered by another instance", message_id);
                }
                Err(e) => {
                    tracing::error!("Failed to retrieve pending message {}: {}", message_id, e);
                }
            }
        });
    }
}