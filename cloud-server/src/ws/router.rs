use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message;

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

    /// device_token -> list of mobile connections
    mobile_connections: HashMap<String, Vec<Sender<Message>>>,
}

impl ConnectionRouter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(RouterInner {
                desktop_connections: HashMap::new(),
                mobile_connections: HashMap::new(),
            })),
        }
    }

    /// Register desktop connection for a device
    pub fn register_desktop(&self, device_token: &str, tx: Sender<Message>) {
        let mut inner = self.inner.write();
        inner.desktop_connections.insert(device_token.to_string(), tx);
        tracing::info!("Desktop registered: {}", device_token);
    }

    /// Register mobile connection for a device
    pub fn register_mobile(&self, device_token: &str, tx: Sender<Message>) {
        let mut inner = self.inner.write();
        inner.mobile_connections
            .entry(device_token.to_string())
            .or_insert_with(Vec::new)
            .push(tx);
        tracing::info!("Mobile registered for device: {}", device_token);
    }

    /// Unregister desktop connection
    pub fn unregister_desktop(&self, device_token: &str) {
        let mut inner = self.inner.write();
        inner.desktop_connections.remove(device_token);
        tracing::info!("Desktop unregistered: {}", device_token);
    }

    /// Unregister a specific mobile connection by finding matching sender
    /// Note: Since Sender doesn't implement PartialEq, we use weak references
    /// to detect closed channels. Simplified: remove all connections for device.
    pub fn unregister_mobile(&self, device_token: &str) {
        let mut inner = self.inner.write();
        inner.mobile_connections.remove(device_token);
        tracing::info!("All mobile connections removed for device: {}", device_token);
    }

    /// Broadcast to all mobile clients subscribed to a device
    pub fn broadcast_to_mobiles(&self, device_token: &str, msg: Message) {
        let inner = self.inner.read();
        if let Some(mobiles) = inner.mobile_connections.get(device_token) {
            for tx in mobiles {
                if let Err(e) = tx.try_send(msg.clone()) {
                    tracing::warn!("Failed to send to mobile: {}", e);
                }
            }
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
            return true;
        }
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
}

impl Default for ConnectionRouter {
    fn default() -> Self {
        Self::new()
    }
}