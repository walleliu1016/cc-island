// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use tokio::net::TcpStream;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use tokio::sync::mpsc::{Sender, Receiver, channel};
use crate::messages::CloudMessage;
use crate::db::repository::Repository;
use super::router::{ConnectionRouter, ConnectionType};
use super::handler::MessageHandler;

/// Handle a single WebSocket connection
pub async fn handle_connection(
    stream: TcpStream,
    router: ConnectionRouter,
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
        Ok((conn_type, device_token, hostname)) => {
            // Send auth success
            let auth_success = CloudMessage::AuthSuccess {
                device_id: device_token.clone(),
                hostname: hostname.clone(),
            };
            let json = serde_json::to_string(&auth_success).unwrap();
            if let Err(e) = ws_tx.send(Message::text(json)).await {
                tracing::error!("Failed to send auth_success: {}", e);
                return;
            }

            // Register connection and track mobile connection_id for cleanup
            let mobile_conn_id = match conn_type {
                ConnectionType::Desktop => {
                    router.register_desktop(&device_token, hostname.clone(), out_tx.clone());
                    // Notify mobiles subscribed to this device
                    let device_info = crate::messages::DeviceInfo {
                        token: device_token.clone(),
                        hostname: hostname.clone(),
                        registered_at: None,  // Will be fetched by mobile if needed
                        online: true,
                    };
                    let online_msg = CloudMessage::DeviceOnline { device: device_info };
                    let json = serde_json::to_string(&online_msg).unwrap();
                    router.broadcast_to_mobiles(&device_token, Message::text(json));
                    None
                },
                ConnectionType::Mobile => {
                    // For mobile, we expect device_tokens in auth, but for now just register
                    // The handler will process MobileAuth to update subscription
                    Some(router.register_mobile_empty(out_tx.clone()))
                }
            };

            // For mobile: send device list
            if conn_type == ConnectionType::Mobile {
                let online_devices = router.get_online_devices_info();
                let device_list_msg = CloudMessage::DeviceList { devices: online_devices };
                let json = serde_json::to_string(&device_list_msg).unwrap();
                if let Err(e) = out_tx.try_send(Message::text(json)) {
                    tracing::warn!("Failed to send device list: {}", e);
                }
            }

            // Create message handler
            let handler = MessageHandler::new(router.clone(), repo.clone(), mobile_conn_id);

            // Spawn send task (forward outgoing messages to WebSocket)
            let send_task = async {
                tracing::debug!("Send task started for connection");
                while let Some(msg) = out_rx.recv().await {
                    tracing::debug!("Send task: sending message");
                    if ws_tx.send(msg).await.is_err() {
                        tracing::warn!("Send task: send failed, breaking");
                        break;
                    }
                }
                tracing::info!("Send task ended for connection");
            };

            // Spawn receive task (handle incoming messages)
            let recv_task = async {
                tracing::debug!("Recv task started for connection");
                while let Some(msg_result) = ws_rx.next().await {
                    match msg_result {
                        Ok(Message::Text(text)) => {
                            let text_preview = text.chars().take(300).collect::<String>();
                            tracing::info!("Recv task: received text message: {}", text_preview);
                            if let Ok(cloud_msg) = serde_json::from_str::<CloudMessage>(&text) {
                                tracing::info!("Recv task: parsed CloudMessage type: {:?}", cloud_msg);
                                handler.handle(cloud_msg, &out_tx, &device_token).await;
                            } else {
                                tracing::warn!("Recv task: failed to parse message as CloudMessage. Full text: {}", text);
                            }
                        },
                        Ok(Message::Ping(data)) => {
                            tracing::debug!("Recv task: Ping received");
                            if let Err(e) = out_tx.try_send(Message::Pong(data)) {
                                tracing::warn!("Failed to send pong: {}", e);
                            }
                        },
                        Ok(Message::Close(_)) => {
                            tracing::info!("Recv task: received Close from client");
                            break;
                        },
                        Err(e) => {
                            tracing::error!("Recv task: WebSocket error: {}", e);
                            break;
                        },
                        Ok(other) => {
                            tracing::debug!("Recv task: other message: {:?}", other);
                        },
                    }
                }
                tracing::info!("Recv task ended: ws_rx stream ended");
            };

            // Run both tasks concurrently
            tracing::debug!("Starting send/recv tasks with tokio::select!");
            tokio::select! {
                _ = send_task => { tracing::info!("select: send_task finished first"); },
                _ = recv_task => { tracing::info!("select: recv_task finished first"); },
            }
            tracing::info!("Connection loop ended, starting cleanup");

            // Close WebSocket connection gracefully
            if let Err(e) = ws_tx.close().await {
                tracing::debug!("WebSocket close error: {}", e);
            }

            // Cleanup on disconnect
            match conn_type {
                ConnectionType::Desktop => {
                    // Notify mobiles subscribed to this device
                    let offline_msg = CloudMessage::DeviceOffline {
                        device_token: device_token.clone(),
                    };
                    let json = serde_json::to_string(&offline_msg).unwrap();
                    router.broadcast_to_mobiles(&device_token, Message::text(json));

                    router.unregister_desktop(&device_token);
                    if let Err(e) = repo.set_device_offline(&device_token).await {
                        tracing::error!("Failed to set device offline: {}", e);
                    }
                },
                ConnectionType::Mobile => {
                    if let Some(conn_id) = mobile_conn_id {
                        router.unregister_mobile(conn_id);
                    }
                }
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
async fn parse_and_handle_auth(text: &str, repo: &Repository) -> Result<(ConnectionType, String, Option<String>), String> {
    let msg: CloudMessage = serde_json::from_str(text)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    match msg {
        CloudMessage::DeviceRegister { device_token, hostname, device_name } => {
            // Register device in database
            if let Err(e) = repo.upsert_device(&device_token, hostname.as_deref(), device_name.as_deref()).await {
                tracing::error!("Failed to register device: {}", e);
            }
            Ok((ConnectionType::Desktop, device_token, hostname))
        },
        CloudMessage::MobileAuth { device_tokens } => {
            // Mobile subscribes to devices
            // Return first token as device_id for auth response
            let first_token = device_tokens.first().cloned().unwrap_or_default();
            Ok((ConnectionType::Mobile, first_token, None))
        },
        _ => Err("Expected device_register or mobile_auth as first message".to_string()),
    }
}