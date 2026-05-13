// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Hook events handler
//!
//! Receives hook events from cc-island Desktop and writes to GreptimeDB

use axum::{
    extract::State,
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::greptime::{GreptimeDBClient, HookEventRecord};

/// Hook event input from Desktop
#[derive(Debug, Deserialize, Serialize)]
pub struct HookInput {
    /// Timestamp (will be auto-generated if missing)
    pub ts: Option<String>,

    // Tenant info from headers
    // user_id and device_id come from headers

    /// Session ID
    pub session_id: String,

    /// Hook event type (SessionStart/PreToolUse/PostToolUse/etc.)
    #[serde(rename = "hook_event_name")]
    pub event_type: String,

    /// Agent source (always "claude_code" for cc-island)
    pub agent_source: Option<String>,

    /// Tool name
    pub tool_name: Option<String>,

    /// Tool input (JSON)
    pub tool_input: Option<serde_json::Value>,

    /// Tool response (JSON)
    pub tool_response: Option<serde_json::Value>,

    /// Tool use ID
    pub tool_use_id: Option<String>,

    /// Agent ID (for subagents)
    pub agent_id: Option<String>,

    /// Agent type
    pub agent_type: Option<String>,

    /// Notification type
    pub notification_type: Option<String>,

    /// Message content
    pub message: Option<String>,

    /// Working directory
    pub cwd: Option<String>,

    /// Transcript path
    pub transcript_path: Option<String>,

    /// Conversation ID
    pub conversation_id: Option<String>,

    /// Permission mode
    pub permission_mode: Option<String>,

    /// Extra metadata (JSON)
    pub metadata: Option<serde_json::Value>,

    /// Project name (extracted from cwd)
    pub project_name: Option<String>,

    /// Duration in milliseconds
    pub duration_ms: Option<i64>,

    /// Success flag
    pub success: Option<bool>,
}

/// Handle POST /api/hooks
pub async fn handle_hooks(
    State(state): State<crate::handler::AppState>,
    headers: HeaderMap,
    Json(input): Json<HookInput>,
) -> Json<HookResponse> {
    // Extract tenant info from headers
    let user_id = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let device_id = headers
        .get("x-device-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    debug!("Hook received: user={}, device={}, session={}, event={}",
        user_id, device_id, input.session_id, input.event_type);

    // Build record
    let record = HookEventRecord {
        ts: input.ts.unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        user_id,
        device_id,
        session_id: input.session_id,
        event_type: input.event_type,
        agent_source: input.agent_source.unwrap_or_else(|| "claude_code".to_string()),
        tool_name: input.tool_name,
        tool_input: input.tool_input.map(|v| v.to_string()),
        tool_result: input.tool_response.map(|v| v.to_string()),
        tool_use_id: input.tool_use_id,
        agent_id: input.agent_id,
        agent_type: input.agent_type,
        notification_type: input.notification_type,
        message: input.message,
        cwd: input.cwd,
        transcript_path: input.transcript_path,
        conversation_id: input.conversation_id,
        permission_mode: input.permission_mode,
        metadata: input.metadata.map(|v| v.to_string()),
        project_name: input.project_name,
        duration_ms: input.duration_ms,
        success: input.success,
    };

    // Write to GreptimeDB (async, non-blocking)
    let greptimedb = state.greptimedb.clone();
    tokio::spawn(async move {
        if let Err(e) = greptimedb.insert_hook_event(&record).await {
            tracing::error!("Failed to insert hook event: {}", e);
        }
    });

    // Broadcast to SSE subscribers (if any)

    Json(HookResponse {
        success: true,
        message: "Hook recorded".to_string(),
    })
}

#[derive(Debug, Serialize)]
pub struct HookResponse {
    pub success: bool,
    pub message: String,
}