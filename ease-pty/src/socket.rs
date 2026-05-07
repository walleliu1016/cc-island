//! Socket server - receive remote input injection requests

use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc::Sender;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

/// Injection request from CC-Island
#[derive(Debug, Deserialize)]
pub struct InjectRequest {
    /// Message type
    #[serde(rename = "type")]
    pub msg_type: String,

    /// Session ID
    #[serde(default)]
    pub session_id: String,

    /// Content to inject
    pub content: String,
}

/// Injection response
#[derive(Debug, Serialize)]
pub struct InjectResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Find an available port in range (sync version for startup)
pub fn find_available_port(base: u16, max: u16) -> u16 {
    use std::net::TcpListener;
    for port in base..max {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    panic!("No available ports in range {}-{}", base, max);
}

/// Start TCP listener
pub async fn start_listener(port: u16) -> TcpListener {
    TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("Failed to bind socket")
}

/// Handle incoming connections
pub async fn handle_connections(listener: TcpListener, input_tx: Sender<String>) {
    info!("Socket handler started");

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                debug!("Connection from: {}", addr);
                tokio::spawn(handle_client(stream, input_tx.clone()));
            }
            Err(e) => {
                error!("Accept error: {}", e);
            }
        }
    }
}

/// Handle a single client connection
async fn handle_client(mut stream: TcpStream, input_tx: Sender<String>) {
    let mut buf = vec![0u8; 8192];

    // Read request
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        Ok(_) => return,
        Err(e) => {
            error!("Socket read error: {}", e);
            return;
        }
    };

    // Parse JSON request
    let json_str = String::from_utf8_lossy(&buf[..n]);

    match serde_json::from_str::<InjectRequest>(&json_str) {
        Ok(req) => {
            info!("Inject request received: {} bytes", req.content.len());
            debug!("Inject content: {}", req.content);

            // Send to PTY input channel
            if input_tx.send(req.content).await.is_err() {
                warn!("Failed to send input to PTY channel");
            }

            // Send success response
            let response = InjectResponse { success: true, error: None };
            if let Ok(json) = serde_json::to_string(&response) {
                stream.write_all(json.as_bytes()).await.ok();
            }
        }
        Err(e) => {
            error!("Failed to parse inject request: {}", e);

            // Send error response
            let response = InjectResponse {
                success: false,
                error: Some(format!("Parse error: {}", e)),
            };
            if let Ok(json) = serde_json::to_string(&response) {
                stream.write_all(json.as_bytes()).await.ok();
            }
        }
    }
}