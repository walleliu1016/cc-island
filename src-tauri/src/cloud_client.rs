use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::mpsc::{Sender, Receiver, channel};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{SinkExt, StreamExt};
use crate::machine_id::get_machine_token;
use crate::AppState;

/// Cloud client configuration
pub struct CloudConfig {
    pub server_url: String,
    pub device_name: Option<String>,
}

/// Cloud client for WebSocket connection to relay server
pub struct CloudClient {
    config: CloudConfig,
    device_token: String,
    app_state: Arc<RwLock<AppState>>,
    out_tx: Option<Sender<Message>>,
    connected: Arc<RwLock<bool>>,
}

impl CloudClient {
    pub fn new(app_state: Arc<RwLock<AppState>>, config: CloudConfig) -> Self {
        let device_token = get_machine_token();

        Self {
            config,
            device_token,
            app_state,
            out_tx: None,
            connected: Arc::new(RwLock::new(false)),
        }
    }

    /// Get device token for display to user
    pub fn get_device_token(&self) -> String {
        self.device_token.clone()
    }

    /// Check if connected to cloud server
    pub fn is_connected(&self) -> bool {
        *self.connected.read()
    }

    /// Connect to cloud server
    pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let server_url = self.config.server_url.clone();
        let device_token = self.device_token.clone();
        let device_name = self.config.device_name.clone();

        tracing::info!("Connecting to cloud server: {}", server_url);

        // Connect WebSocket
        let (ws_stream, _) = connect_async(&server_url).await?;
        let (mut ws_tx, mut ws_rx) = ws_stream.split();

        // Create outgoing message channel
        let (out_tx, mut out_rx): (Sender<Message>, Receiver<Message>) = channel(64);
        self.out_tx = Some(out_tx.clone());

        // Send device registration
        let register_msg = serde_json::json!({
            "type": "device_register",
            "device_token": device_token,
            "device_name": device_name,
        });
        ws_tx.send(Message::text(register_msg.to_string())).await?;

        // Wait for auth response
        if let Some(Ok(msg)) = ws_rx.next().await {
            if let Message::Text(text) = msg {
                let json: serde_json::Value = serde_json::from_str(&text)?;
                if json["type"] == "auth_success" {
                    tracing::info!("Cloud authentication successful");
                    *self.connected.write() = true;
                } else if json["type"] == "auth_failed" {
                    let reason = json["reason"].as_str().unwrap_or("unknown");
                    tracing::error!("Cloud authentication failed: {}", reason);
                    return Err(format!("Auth failed: {}", reason).into());
                }
            }
        }

        // Spawn send task
        let send_task = async move {
            while let Some(msg) = out_rx.recv().await {
                if ws_tx.send(msg).await.is_err() {
                    break;
                }
            }
        };

        // Spawn receive task
        let app_state = self.app_state.clone();
        let connected = self.connected.clone();
        let recv_task = async move {
            while let Some(msg) = ws_rx.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        let json: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                        if json["type"] == "popup_response" {
                            handle_popup_response(&app_state, &json);
                        }
                    },
                    Ok(Message::Pong(_)) => {},
                    Ok(Message::Close(_)) => {
                        *connected.write() = false;
                        break;
                    },
                    Err(e) => {
                        tracing::error!("WebSocket error: {}", e);
                        *connected.write() = false;
                        break;
                    },
                    _ => {}
                }
            }
        };

        tokio::spawn(async move {
            tokio::select! {
                _ = send_task => {},
                _ = recv_task => {},
            }
            tracing::info!("Cloud client disconnected");
        });

        Ok(())
    }

    /// Push state update to cloud
    pub fn push_state(&self, sessions: Vec<SessionState>, popups: Vec<PopupState>) {
        if !self.is_connected() {
            return;
        }

        if let Some(tx) = &self.out_tx {
            let msg = serde_json::json!({
                "type": "state_update",
                "device_token": self.device_token,
                "sessions": sessions,
                "popups": popups,
            });
            if let Err(e) = tx.try_send(Message::text(msg.to_string())) {
                tracing::warn!("Failed to push state: {}", e);
            }
        }
    }

    /// Push new popup to cloud
    pub fn push_new_popup(&self, popup: PopupState) {
        if !self.is_connected() {
            return;
        }

        if let Some(tx) = &self.out_tx {
            let msg = serde_json::json!({
                "type": "new_popup",
                "device_token": self.device_token,
                "popup": popup,
            });
            if let Err(e) = tx.try_send(Message::text(msg.to_string())) {
                tracing::warn!("Failed to push popup: {}", e);
            }
        }
    }
}

fn handle_popup_response(app_state: &Arc<RwLock<AppState>>, json: &serde_json::Value) {
    let popup_id = json["popup_id"].as_str().unwrap_or("");
    let decision = json["decision"].as_str();
    let _answers = json["answers"].as_array();

    tracing::info!("Received popup response from mobile: {} -> {:?}", popup_id, decision);

    // Forward to popup queue resolver
    // Note: This integration will be completed in Task 14
    let state = app_state.read();
    if let Some(_popup) = state.popups.get(popup_id) {
        // TODO: Send response through resolver channel
        tracing::info!("Popup {} found, response forwarding to be implemented", popup_id);
    }
}

// Simplified state types for cloud messages
#[derive(serde::Serialize)]
pub struct SessionState {
    pub session_id: String,
    pub project_name: Option<String>,
    pub status: String,
    pub current_tool: Option<String>,
    pub tool_input: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
pub struct PopupState {
    pub id: String,
    pub session_id: Option<String>,
    pub project_name: Option<String>,
    #[serde(rename = "type")]
    pub popup_type: String,
    pub data: serde_json::Value,
    pub status: String,
}