// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

use axum::{
    extract::ws::{WebSocket, WebSocketUpgrade, Message},
    response::Response,
    routing::get,
    Router,
};
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;
use tokio::sync::broadcast;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

/// MCP Bridge connection state
pub struct McpBridgeState {
    /// session_id -> WebSocket sender
    bridges: HashMap<String, broadcast::Sender<Message>>,
}

impl McpBridgeState {
    pub fn new() -> Self {
        Self {
            bridges: HashMap::new(),
        }
    }
}

/// Message types for MCP Bridge protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpBridgeMessage {
    #[serde(rename = "auth")]
    Auth { session_id: String },

    #[serde(rename = "auth_success")]
    AuthSuccess,

    #[serde(rename = "auth_failed")]
    AuthFailed { reason: String },

    #[serde(rename = "chat_message")]
    ChatMessage {
        session_id: String,
        text: String,
        message_id: String,
    },

    #[serde(rename = "chat_reply")]
    ChatReply {
        session_id: String,
        text: String,
        reply_to: Option<String>,
    },
}

/// Global MCP Bridge state
pub static MCP_BRIDGE_STATE: once_cell::sync::Lazy<Arc<RwLock<McpBridgeState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(McpBridgeState::new())));

/// WebSocket server for MCP Bridge connections
pub struct WsServer {
    port: u16,
}

impl WsServer {
    pub fn new(port: u16) -> Self {
        Self { port }
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let app = Router::new()
            .route("/ws", get(handle_ws_upgrade));

        let addr = format!("127.0.0.1:{}", self.port);
        tracing::info!("MCP Bridge WebSocket Server starting on {}", addr);

        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

/// Handle WebSocket upgrade request
async fn handle_ws_upgrade(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

/// Handle WebSocket connection
async fn handle_socket(socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();

    // Wait for auth message
    let auth_msg = match rx.next().await {
        Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<McpBridgeMessage>(&text) {
                Ok(McpBridgeMessage::Auth { session_id }) => session_id,
                Ok(other) => {
                    tracing::warn!("Expected auth message, got: {:?}", other);
                    let _ = tx.send(Message::Text(
                        serde_json::to_string(&McpBridgeMessage::AuthFailed {
                            reason: "Expected auth message first".to_string()
                        }).unwrap_or_default()
                    )).await;
                    return;
                }
                Err(e) => {
                    tracing::warn!("Failed to parse auth message: {}", e);
                    return;
                }
            }
        },
        _ => {
            tracing::warn!("No auth message received");
            return;
        }
    };

    // Register MCP Bridge
    let (bridge_tx, mut bridge_rx) = broadcast::channel::<Message>(16);
    {
        let mut state = MCP_BRIDGE_STATE.write();
        state.bridges.insert(auth_msg.clone(), bridge_tx.clone());
        tracing::info!("MCP Bridge registered: session {}", auth_msg);
    }

    // Send auth success
    let auth_success = serde_json::to_string(&McpBridgeMessage::AuthSuccess).unwrap_or_default();
    if tx.send(Message::Text(auth_success)).await.is_err() {
        tracing::warn!("Failed to send auth_success");
        return;
    }

    // Handle messages
    let session_id = auth_msg.clone();
    loop {
        tokio::select! {
            // Receive from MCP Bridge
            msg = rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<McpBridgeMessage>(&text) {
                            Ok(McpBridgeMessage::ChatReply { session_id, text, reply_to }) => {
                                // Forward to Cloud Client
                                crate::cloud_client::send_chat_reply_from_bridge(&session_id, &text, reply_to.as_deref());
                            }
                            Ok(other) => {
                                tracing::debug!("Received message from MCP Bridge: {:?}", other);
                            }
                            Err(e) => {
                                tracing::warn!("Failed to parse message from MCP Bridge: {}", e);
                            }
                        }
                    },
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("MCP Bridge disconnected: session {}", session_id);
                        break;
                    },
                    Some(Err(e)) => {
                        tracing::error!("MCP Bridge WebSocket error: {}", e);
                        break;
                    },
                    _ => {}
                }
            }
            // Receive from bridge_tx (chat_message from Mobile)
            msg = bridge_rx.recv() => {
                if let Ok(msg) = msg {
                    if tx.send(msg).await.is_err() {
                        tracing::warn!("Failed to send to MCP Bridge");
                        break;
                    }
                }
            }
        }
    }

    // Cleanup
    {
        let mut state = MCP_BRIDGE_STATE.write();
        state.bridges.remove(&session_id);
        tracing::info!("MCP Bridge unregistered: session {}", session_id);
    }
}

/// Send chat_message to MCP Bridge (called by Cloud Client)
pub fn send_to_mcp_bridge(session_id: &str, text: &str, message_id: &str) {
    let state = MCP_BRIDGE_STATE.read();
    if let Some(bridge_tx) = state.bridges.get(session_id) {
        let msg = McpBridgeMessage::ChatMessage {
            session_id: session_id.to_string(),
            text: text.to_string(),
            message_id: message_id.to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap_or_default();
        if let Err(e) = bridge_tx.send(Message::Text(json)) {
            tracing::warn!("Failed to send chat_message to MCP Bridge {}: {}", session_id, e);
        } else {
            tracing::info!("Sent chat_message to MCP Bridge {}", session_id);
        }
    } else {
        tracing::warn!("No MCP Bridge for session {}", session_id);
    }
}