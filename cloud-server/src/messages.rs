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

/// Hook types that can be transmitted
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum HookType {
    SessionStart,
    SessionEnd,
    PreToolUse,
    PostToolUse,
    PermissionRequest,
    Notification,
    Stop,
    UserPromptSubmit,
    StatusUpdate,
}

/// WebSocket message types for CC-Island cloud relay protocol.
///
/// Messages flow between three parties:
/// - Desktop clients (CC-Island app) connect and push hook messages
/// - Mobile clients subscribe to device tokens and receive updates
/// - Cloud server routes messages between them
///
/// The protocol uses a tagged enum format with `type` field for deserialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CloudMessage {
    // ===== Connection Management =====

    /// Desktop device registration. Sent when desktop connects to cloud.
    #[serde(rename = "device_register")]
    DeviceRegister {
        /// Unique device identifier
        device_token: String,
        /// System hostname
        hostname: Option<String>,
        /// User-defined device name (optional)
        device_name: Option<String>,
    },

    /// Mobile client authentication. Sent when mobile connects to subscribe to devices.
    #[serde(rename = "mobile_auth")]
    MobileAuth {
        /// Device tokens to subscribe to
        device_tokens: Vec<String>,
    },

    /// Authentication success response.
    #[serde(rename = "auth_success")]
    AuthSuccess {
        /// Device ID for this connection
        device_id: String,
        /// Hostname (for display)
        hostname: Option<String>,
    },

    /// Authentication failure response.
    #[serde(rename = "auth_failed")]
    AuthFailed {
        /// Human-readable reason
        reason: String,
    },

    /// Device list with full info sent to mobile after authentication.
    #[serde(rename = "device_list")]
    DeviceList {
        /// List of devices with details
        devices: Vec<DeviceInfo>,
    },

    /// Notification that a device has come online.
    #[serde(rename = "device_online")]
    DeviceOnline {
        /// Device info
        device: DeviceInfo,
    },

    /// Notification that a device has gone offline.
    #[serde(rename = "device_offline")]
    DeviceOffline {
        /// Device token that went offline
        device_token: String,
    },

    /// Session list sent to mobile after subscription.
    #[serde(rename = "session_list")]
    SessionList {
        /// Device token
        device_token: String,
        /// Active sessions
        sessions: Vec<ClaudeSession>,
    },

    /// Keepalive ping.
    #[serde(rename = "ping")]
    Ping,

    /// Keepalive pong.
    #[serde(rename = "pong")]
    Pong,

    // ===== Hook Message (Desktop → Cloud → Mobile) =====

    /// Hook message transparent transmission from desktop.
    #[serde(rename = "hook_message")]
    HookMessage {
        /// Device token identifying the source
        device_token: String,
        /// Claude session ID
        session_id: String,
        /// Hook type
        hook_type: HookType,
        /// Raw hook data
        hook_body: serde_json::Value,
    },

    // ===== Chat History (Desktop → Cloud → Mobile) =====

    /// Chat history sync from desktop.
    #[serde(rename = "chat_history")]
    ChatHistory {
        /// Device token
        device_token: String,
        /// Session ID
        session_id: String,
        /// Chat messages
        messages: Vec<ChatMessageData>,
    },

    /// Request chat history from mobile.
    #[serde(rename = "request_chat_history")]
    RequestChatHistory {
        /// Device token
        device_token: String,
        /// Session ID
        session_id: String,
        /// Max messages to retrieve
        limit: Option<u32>,
    },

    // ===== Hook Response (Mobile → Cloud → Desktop) =====

    /// Hook response from mobile client (for blocking hooks like PermissionRequest).
    #[serde(rename = "hook_response")]
    HookResponse {
        /// Device token
        device_token: String,
        /// Session ID
        session_id: String,
        /// User's decision (e.g., "allow" or "deny")
        decision: Option<String>,
        /// User's answers for AskUserQuestion
        answers: Option<Vec<Vec<String>>>,
    },
}