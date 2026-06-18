// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};

/// Chat message types (matches desktop's ChatMessage)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageType {
    User,
    Assistant,
    ToolCall,
    ToolResult,
    Thinking,
    Interrupted,
}

/// Chat message data for WebSocket transmission (matches desktop's ChatMessage)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageData {
    pub id: String,
    pub session_id: String,
    pub message_type: MessageType,
    pub content: String,
    /// Tool name for toolCall/toolResult
    pub tool_name: Option<String>,
    /// Timestamp in milliseconds
    pub timestamp: u64,
}

/// Device information for display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub token: String,
    pub hostname: Option<String>,
    pub registered_at: Option<String>,  // ISO datetime string
    pub online: bool,
}

/// Claude session information for display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub session_id: String,
    pub project_name: String,
    pub status: String,
    pub current_tool: Option<String>,
    pub created_at: Option<u64>,  // milliseconds
}

/// Hook types that can be transmitted (PascalCase for consistency with Claude Code)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HookType {
    SessionStart,
    SessionEnd,
    PreToolUse,
    PostToolUse,
    PostToolUseFailure,
    PermissionRequest,
    Elicitation,
    Notification,
    Stop,
    UserPromptSubmit,
    PreCompact,
    PostCompact,
    SubagentStart,
    SubagentStop,
    StatusUpdate,
}
