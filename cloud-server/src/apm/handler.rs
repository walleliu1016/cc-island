// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

use crate::db::greptime::{GreptimeClient, Value};
use crate::messages::{CloudMessage, HookType};
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct ApmHandler {
    client: Arc<RwLock<GreptimeClient>>,
}

impl Clone for ApmHandler {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
        }
    }
}

impl ApmHandler {
    pub fn new(client: GreptimeClient) -> Self {
        Self {
            client: Arc::new(RwLock::new(client)),
        }
    }

    /// Write Hook event to hook_events table
    pub async fn write_hook_event(&self, msg: &CloudMessage, tenant_id: &str) {
        // Only handle HookMessage type
        let (device_token, session_id, hook_type, hook_body) = match msg {
            CloudMessage::HookMessage {
                device_token,
                session_id,
                hook_type,
                hook_body,
            } => (device_token, session_id, hook_type, hook_body),
            _ => return,
        };

        let client = self.client.read().await;

        let ts = Utc::now().timestamp_millis();
        let event_type = hook_type_to_string(hook_type);

        // Extract fields from hook_body (serde_json::Value)
        let tool_name = hook_body
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        // Truncate tool_input/result to avoid large data
        let tool_input = hook_body
            .get("tool_input")
            .and_then(|v| serde_json::to_string(v).ok())
            .map(|s| s.chars().take(2048).collect())
            .unwrap_or_default();

        let tool_result = hook_body
            .get("tool_result")
            .and_then(|v| serde_json::to_string(v).ok())
            .map(|s| s.chars().take(4096).collect())
            .unwrap_or_default();

        let tool_use_id = hook_body
            .get("tool_use_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        let agent_id = hook_body
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        let parent_agent_id = hook_body
            .get("parent_agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        let duration_ms = hook_body
            .get("duration_ms")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let success = hook_body
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        // Use device_token as tenant_id fallback if not provided
        let effective_tenant_id = if tenant_id.is_empty() {
            device_token.clone()
        } else {
            tenant_id.to_string()
        };

        let row = vec![
            Value::Int(ts),
            Value::String(effective_tenant_id),
            Value::String(session_id.clone()),
            Value::String(event_type),
            Value::String(tool_name.to_string()),
            Value::String(tool_input),
            Value::String(tool_result),
            Value::String(tool_use_id.to_string()),
            Value::String(agent_id.to_string()),
            Value::String(parent_agent_id.to_string()),
            Value::Int(duration_ms),
            Value::Bool(success),
        ];

        if let Err(e) = client.insert("hook_events", vec![row]).await {
            tracing::warn!("Failed to write hook_event: {}", e);
        }
    }
}

fn hook_type_to_string(hook_type: &HookType) -> String {
    match hook_type {
        HookType::SessionStart => "SessionStart",
        HookType::SessionEnd => "SessionEnd",
        HookType::PreToolUse => "PreToolUse",
        HookType::PostToolUse => "PostToolUse",
        HookType::PostToolUseFailure => "PostToolUseFailure",
        HookType::PermissionRequest => "PermissionRequest",
        HookType::Elicitation => "Elicitation",
        HookType::Notification => "Notification",
        HookType::Stop => "Stop",
        HookType::UserPromptSubmit => "UserPromptSubmit",
        HookType::PreCompact => "PreCompact",
        HookType::PostCompact => "PostCompact",
        HookType::SubagentStart => "SubagentStart",
        HookType::SubagentStop => "SubagentStop",
        HookType::StatusUpdate => "StatusUpdate",
    }
    .to_string()
}