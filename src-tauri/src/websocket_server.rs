// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{AppState, ToolActivity, SessionNotification};
use crate::instance_manager::ClaudeInstanceDisplay;
use crate::popup_queue::{PopupItem, PopupResponse};

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    // Server -> Client
    #[serde(rename = "state_update")]
    StateUpdate {
        instances: Vec<ClaudeInstanceDisplay>,
        popups: Vec<PopupItem>,
        activities: Vec<ToolActivity>,
    },
    #[serde(rename = "new_popup")]
    NewPopup { popup: PopupItem },
    #[serde(rename = "session_notification")]
    SessionNotification { notification: SessionNotification },
    #[serde(rename = "activity")]
    Activity { activity: ToolActivity },

    // Client -> Server
    #[serde(rename = "respond_popup")]
    RespondPopup {
        popup_id: String,
        decision: Option<String>,
        answer: Option<String>,
        answers: Option<Vec<Vec<String>>>,
    },
    #[serde(rename = "jump_to_instance")]
    JumpToInstance { session_id: String },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "pong")]
    Pong,
}

/// WebSocket server configuration
#[derive(Clone)]
pub struct WsServerConfig {
    pub port: u16,
    pub enabled: bool,
    pub password: Option<String>,
}

impl Default for WsServerConfig {
    fn default() -> Self {
        Self {
            port: 17528,
            enabled: false,
            password: None,
        }
    }
}

/// Active WebSocket connections
pub struct WsConnections {
    connections: HashMap<String, tokio::sync::mpsc::Sender<Message>>,
}

impl WsConnections {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    pub fn add(&mut self, id: String, sender: tokio::sync::mpsc::Sender<Message>) {
        self.connections.insert(id, sender);
    }

    pub fn remove(&mut self, id: &str) {
        self.connections.remove(id);
    }

    pub fn broadcast(&self, message: Message) {
        for sender in self.connections.values() {
            let _ = sender.try_send(message.clone());
        }
    }

    pub fn count(&self) -> usize {
        self.connections.len()
    }
}

/// Global WebSocket connections
pub static WS_CONNECTIONS: once_cell::sync::Lazy<Arc<RwLock<WsConnections>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(WsConnections::new())));

/// WebSocket server control handle
pub struct WsServerHandle {
    shutdown_tx: Option<tokio::sync::mpsc::Sender<()>>,
}

impl WsServerHandle {
    pub fn new() -> Self {
        Self { shutdown_tx: None }
    }

    pub fn set_shutdown(&mut self, tx: tokio::sync::mpsc::Sender<()>) {
        self.shutdown_tx = Some(tx);
    }

    pub fn shutdown(&mut self) {
        if let Some(tx) = &self.shutdown_tx {
            let _ = tx.try_send(());
        }
        self.shutdown_tx = None;
    }
}

/// Global WebSocket server handle for restart
pub static WS_SERVER_HANDLE: once_cell::sync::Lazy<Arc<RwLock<WsServerHandle>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(WsServerHandle::new())));

/// WebSocket server
pub struct WsServer {
    config: WsServerConfig,
    state: Arc<RwLock<AppState>>,
}

impl WsServer {
    pub fn new(config: WsServerConfig, state: Arc<RwLock<AppState>>) -> Self {
        Self { config, state }
    }

    pub async fn run(self) -> Result<(), Box<dyn std::error::Error>> {
        if !self.config.enabled {
            tracing::info!("WebSocket server disabled");
            return Ok(());
        }

        let addr = format!("0.0.0.0:{}", self.config.port);
        let listener = TcpListener::bind(&addr).await?;
        tracing::info!("WebSocket server listening on {}", addr);

        let password = self.config.password.clone();
        let state = self.state.clone();

        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);

        // Register shutdown handle
        {
            let mut handle = WS_SERVER_HANDLE.write();
            handle.set_shutdown(shutdown_tx);
        }

        loop {
            // Check for shutdown signal
            if shutdown_rx.try_recv().is_ok() {
                tracing::info!("WebSocket server shutting down");
                // Close all connections
                {
                    let mut connections = WS_CONNECTIONS.write();
                    connections.connections.clear();
                }
                return Ok(());
            }

            // Accept new connection with timeout to allow shutdown check
            let accept_result = tokio::time::timeout(
                tokio::time::Duration::from_millis(100),
                listener.accept()
            ).await;

            match accept_result {
                Ok(Ok((stream, addr))) => {
                    tracing::debug!("New WebSocket connection from {}", addr);

                    let password_ref = password.clone();
                    let state_ref = state.clone();
                    let conn_id = uuid::Uuid::new_v4().to_string();

                    tokio::spawn(async move {
                        let ws_result = tokio_tungstenite::accept_async(stream).await;

                        match ws_result {
                            Ok(ws) => {
                                let (mut ws_tx, mut ws_rx) = ws.split();

                                // Create channel for outgoing messages
                                let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Message>(32);

                                // Authentication check
                                let auth_success = if let Some(pwd) = &password_ref {
                                    // Wait for auth message (first message must be auth)
                                    let auth_timeout = tokio::time::timeout(
                                        tokio::time::Duration::from_secs(5),
                                        ws_rx.next()
                                    ).await;

                                    match auth_timeout {
                                        Ok(Some(Ok(Message::Text(text)))) => {
                                            // Parse as potential auth: {"type":"auth","token":"..."}
                                            if let Ok(auth_msg) = serde_json::from_str::<serde_json::Value>(&text) {
                                                if auth_msg["type"] == "auth" {
                                                    auth_msg["token"].as_str() == Some(pwd)
                                                } else {
                                                    false // Not auth message, reject
                                                }
                                            } else {
                                                false
                                            }
                                        }
                                        _ => false
                                    }
                                } else {
                                    true // No password required
                                };

                                if !auth_success {
                                    tracing::warn!("WebSocket auth failed for {}", conn_id);
                                    let _ = ws_tx.send(Message::text(
                                        serde_json::json!({"type": "auth_failed"}).to_string()
                                    )).await;
                                    return;
                                }

                                // Send auth success
                                let _ = ws_tx.send(Message::text(
                                    serde_json::json!({"type": "auth_success"}).to_string()
                                )).await;

                                // Register connection
                                {
                                    let mut connections = WS_CONNECTIONS.write();
                                    connections.add(conn_id.clone(), out_tx.clone());
                                    tracing::info!("WebSocket authenticated: {} (total: {})", conn_id, connections.count());
                                }

                                // Send initial state
                                {
                                    let state_guard = state_ref.read();
                                    let msg = WsMessage::StateUpdate {
                                        instances: state_guard.instances.get_all_instances_display(),
                                        popups: state_guard.popups.get_all(),
                                        activities: state_guard.recent_activities.clone(),
                                    };
                                    let json = serde_json::to_string(&msg).unwrap();
                                    let _ = out_tx.try_send(Message::text(json));
                                }

                                // Task 1: Send outgoing messages
                                let send_task = async {
                                    while let Some(msg) = out_rx.recv().await {
                                        if ws_tx.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                };

                                // Task 2: Receive and process incoming messages
                                let recv_task = async {
                                    while let Some(msg) = ws_rx.next().await {
                                        match msg {
                                            Ok(Message::Text(text)) => {
                                                if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                                                    handle_message(ws_msg, state_ref.clone(), out_tx.clone());
                                                }
                                            }
                                            Ok(Message::Ping(data)) => {
                                                let _ = out_tx.try_send(Message::Pong(data));
                                            }
                                            Ok(Message::Close(_)) => {
                                                break;
                                            }
                                            Err(e) => {
                                                tracing::warn!("WebSocket error: {}", e);
                                                break;
                                            }
                                            _ => {}
                                        }
                                    }
                                };

                                // Run both tasks
                                tokio::select! {
                                    _ = send_task => {},
                                    _ = recv_task => {},
                                }

                                // Cleanup
                                {
                                    let mut connections = WS_CONNECTIONS.write();
                                    connections.remove(&conn_id);
                                    tracing::info!("WebSocket disconnected: {} (total: {})", conn_id, connections.count());
                                }
                            }
                            Err(e) => {
                                tracing::warn!("WebSocket connection failed: {}", e);
                            }
                        }
                    });
                }
                Ok(Err(e)) => {
                    tracing::warn!("Accept error: {}", e);
                }
                Err(_) => {
                    // Timeout, continue loop to check shutdown
                }
            }
        }
    }
}

/// Handle incoming WebSocket message
fn handle_message(
    msg: WsMessage,
    state: Arc<RwLock<AppState>>,
    out_tx: tokio::sync::mpsc::Sender<Message>,
) {
    match msg {
        WsMessage::RespondPopup { popup_id, decision, answer, answers } => {
            let mut state_guard = state.write();
            let response = PopupResponse {
                popup_id,
                decision,
                answer,
                answers,
            };

            if state_guard.popups.resolve(response) {
                tracing::info!("Popup resolved via WebSocket");

                // Send updated state
                let update_msg = WsMessage::StateUpdate {
                    instances: state_guard.instances.get_all_instances_display(),
                    popups: state_guard.popups.get_all(),
                    activities: state_guard.recent_activities.clone(),
                };
                let json = serde_json::to_string(&update_msg).unwrap();
                let _ = out_tx.try_send(Message::text(json));
            }
        }
        WsMessage::JumpToInstance { session_id } => {
            let state_guard = state.read();
            if let Some(instance) = state_guard.instances.get_instance(&session_id) {
                if let Some(process_info) = &instance.process_info {
                    let _ = crate::platform::jump_to_terminal(process_info);
                }
            }
        }
        WsMessage::Ping => {
            let pong = serde_json::to_string(&WsMessage::Pong).unwrap();
            let _ = out_tx.try_send(Message::text(pong));
        }
        _ => {}
    }
}

/// Broadcast state update to all connected WebSocket clients
pub fn broadcast_state_update(instances: Vec<ClaudeInstanceDisplay>, popups: Vec<PopupItem>) {
    let connections = WS_CONNECTIONS.read();
    if connections.count() == 0 {
        return;
    }

    let msg = WsMessage::StateUpdate {
        instances,
        popups,
        activities: vec![],
    };
    let json = serde_json::to_string(&msg).unwrap();
    connections.broadcast(Message::text(json));
}

/// Broadcast new popup to all connected WebSocket clients
pub fn broadcast_new_popup(popup: PopupItem) {
    let connections = WS_CONNECTIONS.read();
    if connections.count() == 0 {
        return;
    }

    let msg = WsMessage::NewPopup { popup };
    let json = serde_json::to_string(&msg).unwrap();
    connections.broadcast(Message::text(json));
}

/// Broadcast session notification to all connected WebSocket clients
pub fn broadcast_session_notification(notification: SessionNotification) {
    let connections = WS_CONNECTIONS.read();
    if connections.count() == 0 {
        return;
    }

    let msg = WsMessage::SessionNotification { notification };
    let json = serde_json::to_string(&msg).unwrap();
    connections.broadcast(Message::text(json));
}

/// Broadcast activity to all connected WebSocket clients
pub fn broadcast_activity(activity: ToolActivity) {
    let connections = WS_CONNECTIONS.read();
    if connections.count() == 0 {
        return;
    }

    let msg = WsMessage::Activity { activity };
    let json = serde_json::to_string(&msg).unwrap();
    connections.broadcast(Message::text(json));
}

/// Restart WebSocket server with new configuration
pub fn restart_server(state: Arc<RwLock<AppState>>) {
    // Shutdown existing server
    {
        let mut handle = WS_SERVER_HANDLE.write();
        handle.shutdown();
    }

    // Wait a moment for shutdown
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Get new config
    let config = {
        let state_guard = state.read();
        WsServerConfig {
            port: state_guard.settings.websocket_port.unwrap_or(17528),
            enabled: state_guard.settings.websocket_enabled,
            password: state_guard.settings.websocket_password.clone(),
        }
    };

    // Start new server if enabled
    if config.enabled {
        let port = config.port;
        let ws_server = WsServer::new(config, state);
        tokio::spawn(async move {
            if let Err(e) = ws_server.run().await {
                tracing::error!("WebSocket server error: {}", e);
            }
        });
        tracing::info!("WebSocket server restarted on port {}", port);
    } else {
        tracing::info!("WebSocket server disabled");
    }
}