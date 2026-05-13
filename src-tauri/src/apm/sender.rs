// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! APM Sender - sends data to APM Server via HTTP

use reqwest::Client;
use serde_json::json;
use std::sync::Arc;
use tracing::{debug, error};

/// APM Server sender
pub struct ApmSender {
    server_url: String,
    user_id: String,
    device_id: String,
    client: Client,
}

impl ApmSender {
    pub fn new(server_url: String, user_id: String, device_id: String) -> Arc<Self> {
        Arc::new(Self {
            server_url,
            user_id,
            device_id,
            client: Client::new(),
        })
    }

    /// Send hook event to APM Server
    pub async fn send_hook_event(&self, event: &serde_json::Value) {
        let url = format!("{}/api/hooks", self.server_url);

        debug!("Sending hook event to APM Server: {}", url);

        let response = self.client
            .post(&url)
            .header("X-User-ID", &self.user_id)
            .header("X-Device-ID", &self.device_id)
            .json(event)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    debug!("Hook event sent successfully");
                } else {
                    error!("APM Server returned error: {}", resp.status());
                }
            }
            Err(e) => {
                error!("Failed to send hook event: {}", e);
            }
        }
    }

    /// Send message (from JSONL) to APM Server
    pub async fn send_message(&self, message: &serde_json::Value) {
        // Messages are stored in tma1_messages table via hook mechanism
        // For now, we'll send as a special hook event

        let url = format!("{}/api/hooks", self.server_url);

        let event = json!({
            "hook_event_name": "JsonlMessage",
            "session_id": message["session_id"],
            "message": message,
        });

        let response = self.client
            .post(&url)
            .header("X-User-ID", &self.user_id)
            .header("X-Device-ID", &self.device_id)
            .json(&event)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    debug!("Message sent successfully");
                } else {
                    error!("APM Server returned error: {}", resp.status());
                }
            }
            Err(e) => {
                error!("Failed to send message: {}", e);
            }
        }
    }
}