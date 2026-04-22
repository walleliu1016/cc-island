// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;
use crate::messages::DeviceInfo;

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
    /// device_token -> (sender, hostname) for desktop connections
    desktop_connections: HashMap<String, (Sender<Message>, Option<String>)>,

    /// connection_id -> sender for mobile connections
    mobile_connections: HashMap<Uuid, Sender<Message>>,

    /// Reverse index: device_token -> list of mobile connection_ids subscribed
    mobile_subscriptions: HashMap<String, Vec<Uuid>>,
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
    pub fn register_desktop(&self, device_token: &str, hostname: Option<String>, tx: Sender<Message>) {
        tracing::info!("Desktop registered: {} (hostname: {:?})", device_token, hostname);
        let mut inner = self.inner.write();
        inner.desktop_connections.insert(device_token.to_string(), (tx, hostname));
    }

    /// Register mobile connection (empty subscription, will be updated via MobileAuth)
    pub fn register_mobile_empty(&self, tx: Sender<Message>) -> Uuid {
        let mut inner = self.inner.write();
        let conn_id = Uuid::new_v4();
        inner.mobile_connections.insert(conn_id, tx);
        tracing::info!("Mobile registered (conn_id: {}, no subscription yet)", conn_id);
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

        // Remove from mobile_connections
        inner.mobile_connections.remove(&conn_id);

        // Remove from all subscriptions
        for (_, subs) in inner.mobile_subscriptions.iter_mut() {
            subs.retain(|id| *id != conn_id);
        }

        // Clean up empty subscription lists
        let empty_tokens: Vec<String> = inner.mobile_subscriptions
            .iter()
            .filter(|(_, subs)| subs.is_empty())
            .map(|(token, _)| token.clone())
            .collect();
        for token in empty_tokens {
            inner.mobile_subscriptions.remove(&token);
        }

        tracing::info!("Mobile connection unregistered: {}", conn_id);
    }

    /// Update mobile subscription (called when MobileAuth is received)
    pub fn update_mobile_subscription(&self, conn_id: Uuid, device_tokens: &[String], _tx: &Sender<Message>) {
        let mut inner = self.inner.write();

        tracing::info!("📱 update_mobile_subscription: conn_id={}, subscribing to {} devices: {:?}",
            conn_id, device_tokens.len(), device_tokens);

        // Get old subscriptions
        let old_tokens: Vec<String> = inner.mobile_subscriptions
            .iter()
            .filter(|(_, subs)| subs.contains(&conn_id))
            .map(|(token, _)| token.clone())
            .collect();

        tracing::info!("📱 Old subscriptions for conn_id {}: {:?}", conn_id, old_tokens);

        // Remove from devices that are no longer subscribed
        for token in &old_tokens {
            if !device_tokens.contains(token) {
                if let Some(subs) = inner.mobile_subscriptions.get_mut(token) {
                    subs.retain(|id| *id != conn_id);
                    tracing::info!("📱 Removed conn_id {} from device {}", conn_id, token);
                }
            }
        }

        // Add to new devices
        for token in device_tokens {
            if !old_tokens.contains(token) {
                inner.mobile_subscriptions
                    .entry(token.clone())
                    .or_insert_with(Vec::new)
                    .push(conn_id);
                tracing::info!("📱 Added conn_id {} to device {}", conn_id, token);
            }
        }

        // Log final subscription state
        tracing::info!("📱 Final mobile_subscriptions state:");
        for (token, subs) in inner.mobile_subscriptions.iter() {
            tracing::info!("📱   device {} -> {} subscribers: {:?}", token, subs.len(), subs);
        }

        tracing::info!("Mobile subscription updated: {} -> {} devices", conn_id, device_tokens.len());
    }

    /// Broadcast to all mobile clients subscribed to a device
    pub fn broadcast_to_mobiles(&self, device_token: &str, msg: Message) {
        let span = tracing::info_span!(
            "broadcast.mobile",
            device_token = %device_token,
        );
        let _enter = span.enter();

        let inner = self.inner.read();

        // Get all mobile connection_ids subscribed to this device
        let subs: Vec<Uuid> = inner.mobile_subscriptions.get(device_token).cloned().unwrap_or_default();

        span.record("subscriber_count", subs.len() as i64);
        tracing::info!("Broadcasting to {} mobile subscribers", subs.len());

        if subs.is_empty() {
            tracing::warn!("broadcast_to_mobiles: NO subscribers for device {}", device_token);
            return;
        }

        for conn_id in subs {
            if let Some(tx) = inner.mobile_connections.get(&conn_id) {
                if let Err(e) = tx.try_send(msg.clone()) {
                    tracing::warn!("Failed to send to mobile {}: {}", conn_id, e);
                } else {
                    tracing::info!("✅ Sent message to mobile {} for device {}", conn_id, device_token);
                }
            }
        }
    }

    /// Send to desktop client for a device
    pub fn send_to_desktop(&self, device_token: &str, msg: Message) -> bool {
        let inner = self.inner.read();
        if let Some((tx, _)) = inner.desktop_connections.get(device_token) {
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

    /// Get all online devices info (for DeviceList response)
    pub fn get_online_devices_info(&self) -> Vec<DeviceInfo> {
        let inner = self.inner.read();
        inner.desktop_connections
            .iter()
            .map(|(token, (_, hostname))| DeviceInfo {
                token: token.clone(),
                hostname: hostname.clone(),
                registered_at: None,
                online: true,
            })
            .collect()
    }

    /// Check if desktop is online for a device
    pub fn is_desktop_online(&self, device_token: &str) -> bool {
        let inner = self.inner.read();
        inner.desktop_connections.contains_key(device_token)
    }

    /// Get the number of mobile subscribers for a device
    pub fn get_subscriber_count(&self, device_token: &str) -> usize {
        let inner = self.inner.read();
        inner.mobile_subscriptions.get(device_token).map(|subs| subs.len()).unwrap_or(0)
    }
}

impl Default for ConnectionRouter {
    fn default() -> Self {
        Self::new()
    }
}