use tokio::net::TcpStream;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use tokio::sync::mpsc::{Sender, Receiver, channel};
use crate::messages::CloudMessage;
use crate::db::repository::Repository;
use crate::cache::state_cache::StateCache;
use super::router::{ConnectionRouter, ConnectionType};
use super::handler::MessageHandler;

/// Handle a single WebSocket connection
pub async fn handle_connection(
    stream: TcpStream,
    router: ConnectionRouter,
    cache: StateCache,
    repo: Repository,
) {
    // Accept WebSocket connection
    let ws_result = accept_async(stream).await;
    if let Err(e) = ws_result {
        tracing::error!("WebSocket accept error: {}", e);
        return;
    }

    let ws = ws_result.unwrap();
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Channel for outgoing messages
    let (out_tx, mut out_rx): (Sender<Message>, Receiver<Message>) = channel(32);

    // Wait for first message (must be auth)
    let auth_msg = ws_rx.next().await;

    let auth_result = match auth_msg {
        Some(Ok(Message::Text(text))) => {
            parse_and_handle_auth(&text, &repo).await
        },
        Some(Ok(Message::Ping(data))) => {
            // Respond to ping and wait for auth
            if let Err(e) = ws_tx.send(Message::Pong(data)).await {
                tracing::error!("Failed to send pong: {}", e);
                return;
            }
            // Wait for actual auth message
            match ws_rx.next().await {
                Some(Ok(Message::Text(text))) => parse_and_handle_auth(&text, &repo).await,
                _ => Err("Expected auth message after ping".to_string()),
            }
        },
        _ => Err("Expected auth message as first message".to_string()),
    };

    match auth_result {
        Ok((conn_type, device_token)) => {
            // Send auth success
            let auth_success = CloudMessage::AuthSuccess {
                device_id: device_token.clone(),
                device_name: None,
            };
            let json = serde_json::to_string(&auth_success).unwrap();
            if let Err(e) = ws_tx.send(Message::text(json)).await {
                tracing::error!("Failed to send auth_success: {}", e);
                return;
            }

            // Register connection
            match conn_type {
                ConnectionType::Desktop => router.register_desktop(&device_token, out_tx.clone()),
                ConnectionType::Mobile => router.register_mobile(&device_token, out_tx.clone()),
            }

            // For mobile: send initial state from cache
            if conn_type == ConnectionType::Mobile {
                if let Some(state) = cache.get_state(&device_token) {
                    let init_msg = CloudMessage::InitialState {
                        sessions: state.sessions,
                        popups: state.popups,
                    };
                    let json = serde_json::to_string(&init_msg).unwrap();
                    if let Err(e) = out_tx.try_send(Message::text(json)) {
                        tracing::warn!("Failed to send initial state: {}", e);
                    }
                }
            }

            // Create message handler
            let handler = MessageHandler::new(router.clone(), cache.clone(), repo.clone());

            // Spawn send task (forward outgoing messages to WebSocket)
            let send_task = async {
                while let Some(msg) = out_rx.recv().await {
                    if ws_tx.send(msg).await.is_err() {
                        break;
                    }
                }
            };

            // Spawn receive task (handle incoming messages)
            let recv_task = async {
                while let Some(msg_result) = ws_rx.next().await {
                    match msg_result {
                        Ok(Message::Text(text)) => {
                            if let Ok(cloud_msg) = serde_json::from_str::<CloudMessage>(&text) {
                                handler.handle(cloud_msg, &out_tx, &device_token).await;
                            }
                        },
                        Ok(Message::Ping(data)) => {
                            if let Err(e) = out_tx.try_send(Message::Pong(data)) {
                                tracing::warn!("Failed to send pong: {}", e);
                            }
                        },
                        Ok(Message::Close(_)) => break,
                        Err(e) => {
                            tracing::error!("WebSocket error: {}", e);
                            break;
                        },
                        _ => {},
                    }
                }
            };

            // Run both tasks concurrently
            tokio::select! {
                _ = send_task => {},
                _ = recv_task => {},
            }

            // Close WebSocket connection gracefully
            if let Err(e) = ws_tx.close().await {
                tracing::debug!("WebSocket close error: {}", e);
            }

            // Cleanup on disconnect
            match conn_type {
                ConnectionType::Desktop => {
                    router.unregister_desktop(&device_token);
                    if let Err(e) = repo.set_device_offline(&device_token).await {
                        tracing::error!("Failed to set device offline: {}", e);
                    }
                    cache.remove_device(&device_token);
                },
                ConnectionType::Mobile => router.unregister_mobile(&device_token),
            }
        },
        Err(reason) => {
            // Send auth failure
            let auth_failed = CloudMessage::AuthFailed { reason };
            let json = serde_json::to_string(&auth_failed).unwrap();
            let _ = ws_tx.send(Message::text(json)).await;
            let _ = ws_tx.close().await;
        },
    }
}

/// Parse and handle authentication message
async fn parse_and_handle_auth(text: &str, repo: &Repository) -> Result<(ConnectionType, String), String> {
    let msg: CloudMessage = serde_json::from_str(text)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    match msg {
        CloudMessage::DeviceRegister { device_token, device_name } => {
            // Register device in database
            if let Err(e) = repo.upsert_device(&device_token, device_name.as_deref()).await {
                tracing::error!("Failed to register device: {}", e);
            }
            Ok((ConnectionType::Desktop, device_token))
        },
        CloudMessage::MobileAuth { device_token } => {
            // Mobile doesn't need database registration
            Ok((ConnectionType::Mobile, device_token))
        },
        _ => Err("Expected device_register or mobile_auth as first message".to_string()),
    }
}