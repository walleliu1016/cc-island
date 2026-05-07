//! CC-Island registration - register/unregister session with Desktop app

use std::path::PathBuf;
use std::time::Duration;
use serde_json::json;
use tracing::{error, info, warn};

const CC_ISLAND_HOST: &str = "http://localhost:17527";
const REGISTER_ENDPOINT: &str = "/wrapper_register";
const UNREGISTER_ENDPOINT: &str = "/wrapper_unregister";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Register session with CC-Island Desktop
pub fn register_session(session_id: &str, port: u16, cwd: &PathBuf) {
    let client = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("Failed to create HTTP client");

    let payload = json!({
        "session_id": session_id,
        "port": port,
        "cwd": cwd.to_string_lossy().to_string(),
    });

    info!("Registering session: {} at port {}", session_id, port);

    match client
        .post(format!("{}{}", CC_ISLAND_HOST, REGISTER_ENDPOINT))
        .json(&payload)
        .send()
    {
        Ok(response) if response.status().is_success() => {
            info!("Session registered successfully");
        }
        Ok(response) => {
            warn!("Registration failed with status: {}", response.status());
        }
        Err(e) => {
            error!("Registration request failed: {}", e);
            warn!("CC-Island may not be running. Remote input injection will not work.");
        }
    }
}

/// Unregister session from CC-Island Desktop
pub fn unregister_session(session_id: &str) {
    let client = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("Failed to create HTTP client");

    let payload = json!({
        "session_id": session_id,
    });

    info!("Unregistering session: {}", session_id);

    match client
        .post(format!("{}{}", CC_ISLAND_HOST, UNREGISTER_ENDPOINT))
        .json(&payload)
        .send()
    {
        Ok(_) => {
            info!("Session unregistered successfully");
        }
        Err(e) => {
            warn!("Unregister request failed: {}", e);
        }
    }
}