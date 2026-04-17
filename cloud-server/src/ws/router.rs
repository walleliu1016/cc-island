// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

/// Connection type identifier
#[derive(Debug, Clone, PartialEq, Copy)]
pub enum ConnectionType {
    Desktop,
    Mobile,
}

/// Router manages all WebSocket connections with thread-safe access
#[derive(Clone)]
pub struct ConnectionRouter {
    inner: Arc<RwLock<RouterInner>>,
}

struct RouterInner {
    /// device_token -> desktop connection
    desktop_connections: HashMap<String, Sender<Message>>,

    /// device_token -> (connection_id, sender) pairs for mobile connections
    mobile_connections: HashMap<String, Vec<(Uuid, Sender<Message>)>>,

    /// Reverse index: connection_id -> list of device_tokens it subscribes to
    mobile_subscriptions: HashMap<Uuid, Vec<String>>,
}

impl ConnectionRouter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(RouterInner {
                desktop_connections: HashMap::new(),
                mobile_connections: HashMap::new(),
                mobile_subscriptions: HashMap::new(),
            })),
        }
    }

    /// Register desktop connection for a device
    pub fn register_desktop(&self, device_token: &str, tx: Sender<Message>) {
        let mut inner = self.inner.write();
        inner.desktop_connections.insert(device_token.to_string(), tx);
        tracing::info!("Desktop registered: {}", device_token);
    }

    /// Register mobile connection for multiple devices
    /// Returns the connection_id for later cleanup
    pub fn register_mobile(&self, device_tokens: &[String], tx: Sender<Message>) -> Uuid {
        let mut inner = self.inner.write();
        let conn_id = Uuid::new_v4();

        // Store reverse index for cleanup
        inner.mobile_subscriptions.insert(conn_id, device_tokens.to_vec());

        // Add this connection to each device's mobile list
        for token in device_tokens {
            inner.mobile_connections
                .entry(token.clone())
                .or_insert_with(Vec::new)
                .push((conn_id, tx.clone()));
        }
        tracing::info!("Mobile registered for {} devices (conn_id: {})", device_tokens.len(), conn_id);
        conn_id
    }

    /// Unregister desktop connection
    pub fn unregister_desktop(&self, device_token: &str) {
        let mut inner = self.inner.write();
        inner.desktop_connections.remove(device_token);
        tracing::info!("Desktop unregistered: {}", device_token);
    }

    /// Unregister a mobile connection by connection_id
    pub fn unregister_mobile(&self, conn_id: Uuid) {
        let mut inner = self.inner.write();

        // Get all devices this connection subscribed to
        if let Some(device_tokens) = inner.mobile_subscriptions.remove(&conn_id) {
            let count = device_tokens.len();
            // Remove from each device's mobile list
            for token in &device_tokens {
                if let Some(mobiles) = inner.mobile_connections.get_mut(token) {
                    mobiles.retain(|(id, _)| *id != conn_id);
                }
                // Clean up empty lists
                if inner.mobile_connections.get(token).map(|v| v.is_empty()).unwrap_or(false) {
                    inner.mobile_connections.remove(token);
                }
            }
            tracing::info!("Mobile connection unregistered from {} devices", count);
        }
    }

    /// Broadcast to all mobile clients subscribed to a device
    pub fn broadcast_to_mobiles(&self, device_token: &str, msg: Message) {
        let inner = self.inner.read();
        if let Some(mobiles) = inner.mobile_connections.get(device_token) {
            let count = mobiles.len();
            for (_, tx) in mobiles {
                if let Err(e) = tx.try_send(msg.clone()) {
                    tracing::warn!("Failed to send to mobile: {}", e);
                }
            }
            tracing::debug!("Broadcasted to {} mobile(s) for device: {}", count, device_token);
        } else {
            tracing::debug!("No mobiles connected for device: {}", device_token);
        }
    }

    /// Send to desktop client for a device
    pub fn send_to_desktop(&self, device_token: &str, msg: Message) -> bool {
        let inner = self.inner.read();
        if let Some(tx) = inner.desktop_connections.get(device_token) {
            if let Err(e) = tx.try_send(msg) {
                tracing::warn!("Failed to send to desktop: {}", e);
                return false;
            }
            tracing::debug!("Sent message to desktop for device: {}", device_token);
            return true;
        }
        tracing::debug!("No desktop connected for device: {}", device_token);
        false
    }

    /// Check if mobile client is online for a device
    pub fn is_mobile_online(&self, device_token: &str) -> bool {
        let inner = self.inner.read();
        inner.mobile_connections
            .get(device_token)
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }

    /// Check if desktop client is online for a device
    pub fn is_desktop_online(&self, device_token: &str) -> bool {
        let inner = self.inner.read();
        inner.desktop_connections.contains_key(device_token)
    }

    /// Get all online device tokens (desktops that are connected)
    pub fn get_online_devices(&self) -> Vec<String> {
        let inner = self.inner.read();
        inner.desktop_connections.keys().cloned().collect()
    }
}

impl Default for ConnectionRouter {
    fn default() -> Self {
        Self::new()
    }
}