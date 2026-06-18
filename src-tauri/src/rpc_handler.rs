// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::protocol::Message;
use crate::AppState;
use crate::platform;

/// Handle an RPC request from mobile, dispatch to the appropriate handler
pub fn handle_rpc_request(
    _app_state: &Arc<RwLock<AppState>>,
    out_tx: &Sender<Message>,
    device_token: &str,
    request_id: &str,
    method: &str,
    params: &serde_json::Value,
) {
    tracing::info!("RPC request: method={}, request_id={}", method, request_id);

    let (result, error) = match method {
        "spawn_session" => handle_spawn_session(params),
        _ => (None, Some(format!("Unknown RPC method: {}", method))),
    };

    let response = serde_json::json!({
        "type": "rpc_response",
        "request_id": request_id,
        "device_token": device_token,
        "mobile_conn_id": null,
        "result": result,
        "error": error,
    });

    if let Err(e) = out_tx.try_send(Message::text(response.to_string())) {
        tracing::warn!("Failed to send RPC response: {}", e);
    }
}

/// Spawn a new Claude session in a terminal window
///
/// Params:
/// - cwd: Working directory for the Claude session (required)
/// - command: Custom command override (optional, defaults to "claude")
fn handle_spawn_session(params: &serde_json::Value) -> (Option<serde_json::Value>, Option<String>) {
    let cwd = match params.get("cwd").and_then(|v| v.as_str()) {
        Some(cwd) if !cwd.is_empty() => cwd,
        _ => return (None, Some("Missing or empty 'cwd' parameter".to_string())),
    };

    let command = params
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("claude");

    // Get available terminals on this platform
    let terminals = platform::get_available_terminals();
    if terminals.is_empty() {
        return (None, Some("No terminal emulator found on this system".to_string()));
    }

    // Use the first available terminal
    let terminal = &terminals[0];
    tracing::info!(
        "Spawning Claude session: cwd={}, command={}, terminal={}",
        cwd, command, terminal.display_name
    );

    match platform::launch_in_terminal(&terminal.bundle_id, command, cwd) {
        Ok(()) => {
            let result = serde_json::json!({
                "success": true,
                "message": format!("Claude session started in {}: {}", terminal.display_name, cwd),
                "cwd": cwd,
                "terminal": terminal.display_name,
            });
            (Some(result), None)
        }
        Err(e) => {
            tracing::error!("Failed to spawn Claude session: {}", e);
            (None, Some(format!("Failed to launch terminal: {}", e)))
        }
    }
}
