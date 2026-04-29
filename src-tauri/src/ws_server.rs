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
    /// bridge_id → WebSocket sender (for direct messaging)
    bridges: HashMap<String, broadcast::Sender<Message>>,
    /// session_id → bridge_id mapping (for routing)
    session_bindings: HashMap<String, String>,
}

impl McpBridgeState {
    pub fn new() -> Self {
        Self {
            bridges: HashMap::new(),
            session_bindings: HashMap::new(),
        }
    }
}

/// Message types for MCP Bridge protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpBridgeMessage {
    #[serde(rename = "bridge_register")]
    BridgeRegister { bridge_id: String },

    #[serde(rename = "bridge_registered")]
    BridgeRegistered { bridge_id: String },

    #[serde(rename = "bind_session")]
    BindSession { bridge_id: String, session_id: String },

    #[serde(rename = "session_bound")]
    SessionBound { session_id: String },

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

    // Wait for bridge_register message
    let bridge_id = match rx.next().await {
        Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<McpBridgeMessage>(&text) {
                Ok(McpBridgeMessage::BridgeRegister { bridge_id }) => bridge_id,
                Ok(other) => {
                    tracing::warn!("Expected bridge_register, got: {:?}", other);
                    return;
                }
                Err(e) => {
                    tracing::warn!("Failed to parse bridge_register: {}", e);
                    return;
                }
            }
        },
        _ => {
            tracing::warn!("No bridge_register received");
            return;
        }
    };

    // Register MCP Bridge
    let (bridge_tx, mut bridge_rx) = broadcast::channel::<Message>(16);
    {
        let mut state = MCP_BRIDGE_STATE.write();
        state.bridges.insert(bridge_id.clone(), bridge_tx.clone());
        tracing::info!("MCP Bridge registered: {}", bridge_id);
    }

    // Send bridge_registered confirmation
    let confirmation = serde_json::to_string(&McpBridgeMessage::BridgeRegistered {
        bridge_id: bridge_id.clone()
    }).unwrap_or_default();
    if tx.send(Message::Text(confirmation)).await.is_err() {
        cleanup_bridge(&bridge_id);
        return;
    }

    tracing::info!("MCP Bridge {} ready, waiting for session binding", bridge_id);

    // Handle messages
    loop {
        tokio::select! {
            // Receive from MCP Bridge
            msg = rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<McpBridgeMessage>(&text) {
                            Ok(McpBridgeMessage::BindSession { bridge_id, session_id }) => {
                                // Bind session to this bridge
                                {
                                    let mut state = MCP_BRIDGE_STATE.write();
                                    state.session_bindings.insert(session_id.clone(), bridge_id.clone());
                                    tracing::info!("Session {} bound to bridge {}", session_id, bridge_id);
                                }
                                // Send confirmation
                                let bound_msg = serde_json::to_string(&McpBridgeMessage::SessionBound {
                                    session_id: session_id.clone()
                                }).unwrap_or_default();
                                if tx.send(Message::Text(bound_msg)).await.is_err() {
                                    tracing::warn!("Failed to send session_bound");
                                    break;
                                }
                            }
                            Ok(McpBridgeMessage::ChatReply { session_id, text, reply_to }) => {
                                // Forward to Cloud Client
                                crate::cloud_client::send_chat_reply_from_bridge(&session_id, &text, reply_to.as_deref());
                            }
                            Ok(other) => {
                                tracing::debug!("Received from MCP Bridge: {:?}", other);
                            }
                            Err(e) => {
                                tracing::warn!("Failed to parse MCP Bridge message: {}", e);
                            }
                        }
                    },
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("MCP Bridge {} disconnected", bridge_id);
                        break;
                    },
                    Some(Err(e)) => {
                        tracing::error!("MCP Bridge {} WebSocket error: {}", bridge_id, e);
                        break;
                    },
                    _ => {}
                }
            }
            // Receive from bridge_tx (chat_message routed to this bridge)
            msg = bridge_rx.recv() => {
                if let Ok(msg) = msg {
                    if tx.send(msg).await.is_err() {
                        tracing::warn!("Failed to send to MCP Bridge {}", bridge_id);
                        break;
                    }
                }
            }
        }
    }

    cleanup_bridge(&bridge_id);
}

/// Cleanup MCP Bridge
fn cleanup_bridge(bridge_id: &str) {
    let mut state = MCP_BRIDGE_STATE.write();
    state.bridges.remove(bridge_id);
    // Remove any session bindings for this bridge
    state.session_bindings.retain(|_, bid| bid != bridge_id);
    tracing::info!("MCP Bridge {} unregistered", bridge_id);
}

/// Route chat_message to specific MCP Bridge by session_id (called by Cloud Client)
pub fn send_to_mcp_bridge(session_id: &str, text: &str, message_id: &str) {
    let state = MCP_BRIDGE_STATE.read();

    // Find bridge_id for this session
    let bridge_id = state.session_bindings.get(session_id);

    if let Some(bridge_id) = bridge_id {
        if let Some(bridge_tx) = state.bridges.get(bridge_id) {
            let msg = McpBridgeMessage::ChatMessage {
                session_id: session_id.to_string(),
                text: text.to_string(),
                message_id: message_id.to_string(),
            };
            let json = serde_json::to_string(&msg).unwrap_or_default();
            if let Err(e) = bridge_tx.send(Message::Text(json)) {
                tracing::warn!("Failed to send to MCP Bridge {}: {}", bridge_id, e);
            } else {
                tracing::info!("Sent chat_message to MCP Bridge {} (session {})", bridge_id, session_id);
            }
        } else {
            tracing::warn!("Bridge {} not found for session {}", bridge_id, session_id);
        }
    } else {
        tracing::warn!("No bridge bound for session {}", session_id);
    }
}