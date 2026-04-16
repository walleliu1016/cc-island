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

/// WebSocket message types for CC-Island cloud relay protocol.
///
/// Messages flow between three parties:
/// - Desktop clients (CC-Island app) connect and push state updates
/// - Mobile clients subscribe to device tokens and receive updates
/// - Cloud server routes messages between them
///
/// The protocol uses a tagged enum format with `type` field for deserialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CloudMessage {
    // ===== Authentication =====

    /// Desktop device registration. Sent when desktop connects to cloud.
    #[serde(rename = "device_register")]
    DeviceRegister {
        /// Unique device identifier (derived from machine hardware)
        device_token: String,
        /// User-defined device name (optional)
        device_name: Option<String>,
    },

    /// Mobile client authentication. Sent when mobile connects to subscribe to a device.
    #[serde(rename = "mobile_auth")]
    MobileAuth {
        /// Device token to subscribe to (received from desktop via QR code)
        device_token: String,
    },

    /// Authentication success response. Sent to client after successful auth.
    #[serde(rename = "auth_success")]
    AuthSuccess {
        /// Assigned device ID for this connection
        device_id: String,
        /// Device name (if provided during registration)
        device_name: Option<String>,
    },

    /// Authentication failure response. Sent when auth fails.
    #[serde(rename = "auth_failed")]
    AuthFailed {
        /// Human-readable reason for authentication failure
        reason: String,
    },

    // ===== Desktop → Cloud =====

    /// Full state sync from desktop. Sent periodically or on significant changes.
    #[serde(rename = "state_update")]
    StateUpdate {
        /// Device token identifying the source desktop
        device_token: String,
        /// All active Claude sessions on this desktop
        sessions: Vec<SessionState>,
        /// All pending popups requiring user action
        popups: Vec<PopupState>,
    },

    /// New popup notification from desktop. Sent when a popup is created.
    #[serde(rename = "new_popup")]
    NewPopup {
        /// Device token identifying the source desktop
        device_token: String,
        /// The newly created popup requiring user action
        popup: PopupState,
    },

    /// Chat messages from desktop. Sent when new messages are added to a session.
    #[serde(rename = "chat_messages")]
    ChatMessages {
        /// Device token identifying the source desktop
        device_token: String,
        /// Session ID these messages belong to
        session_id: String,
        /// Chat messages to sync
        messages: Vec<ChatMessageData>,
    },

    /// Keepalive ping from desktop.
    #[serde(rename = "ping")]
    Ping,

    // ===== Cloud → Mobile =====

    /// Initial state sent to mobile after successful authentication.
    /// Contains all current sessions and popups for the subscribed device.
    #[serde(rename = "initial_state")]
    InitialState {
        /// All active Claude sessions on the subscribed desktop
        sessions: Vec<SessionState>,
        /// All pending popups requiring user action
        popups: Vec<PopupState>,
    },

    /// New popup notification forwarded to mobile client.
    /// Sent when desktop reports a new popup.
    #[serde(rename = "new_popup_from_device")]
    NewPopupFromDevice {
        /// The popup that was created on the desktop
        popup: PopupState,
    },

    /// New chat messages broadcast to mobile clients.
    /// Sent when desktop pushes new chat messages for a session.
    #[serde(rename = "new_chat")]
    NewChat {
        /// Session ID these messages belong to
        session_id: String,
        /// Chat messages to deliver
        messages: Vec<ChatMessageData>,
    },

    /// Chat history response sent to mobile client.
    /// Sent in response to RequestChatHistory.
    #[serde(rename = "chat_history")]
    ChatHistory {
        /// Session ID these messages belong to
        session_id: String,
        /// Chat messages (limited by request)
        messages: Vec<ChatMessageData>,
    },

    // ===== Mobile → Cloud =====

    /// Popup response from mobile client. Sent when user responds to a popup.
    #[serde(rename = "respond_popup")]
    RespondPopup {
        /// Device token identifying the target desktop
        device_token: String,
        /// Unique identifier of the popup being responded to
        popup_id: String,
        /// User's decision (e.g., "allow" or "deny" for permission requests)
        decision: Option<String>,
        /// User's answers for AskUserQuestion popups (array per question)
        answers: Option<Vec<Vec<String>>>,
    },

    /// Request chat history from mobile client. Sent when mobile needs to load past messages.
    #[serde(rename = "request_chat_history")]
    RequestChatHistory {
        /// Device token identifying the target desktop
        device_token: String,
        /// Session ID to request history for
        session_id: String,
        /// Maximum number of messages to retrieve (most recent first)
        limit: Option<u32>,
    },

    // ===== Cloud → Desktop =====

    /// Popup response forwarded to desktop. Contains user's decision or answers.
    #[serde(rename = "popup_response")]
    PopupResponse {
        /// Unique identifier of the popup being responded to
        popup_id: String,
        /// User's decision (e.g., "allow" or "deny")
        decision: Option<String>,
        /// User's answers for AskUserQuestion popups
        answers: Option<Vec<Vec<String>>>,
    },

    /// Keepalive pong to desktop.
    #[serde(rename = "pong")]
    Pong,
}

/// Represents a Claude Code session running on a desktop.
///
/// A session corresponds to a single Claude Code terminal instance,
/// tracking its current state and activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    /// Unique identifier for this Claude session
    pub session_id: String,
    /// Human-readable project name (derived from working directory)
    pub project_name: Option<String>,
    /// Current session status (e.g., "idle", "processing", "waiting")
    pub status: String,
    /// Name of the currently executing tool, if any
    pub current_tool: Option<String>,
    /// JSON input for the current tool, if any
    pub tool_input: Option<serde_json::Value>,
}

/// Represents a pending popup requiring user interaction.
///
/// Popups are created when Claude Code needs user input:
/// - Permission requests (tool execution approval)
/// - AskUserQuestion (user prompts with options)
/// - Ask notifications (free-form user questions)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PopupState {
    /// Unique identifier for this popup
    pub id: String,
    /// Associated Claude session ID, if applicable
    pub session_id: Option<String>,
    /// Project name for display purposes
    pub project_name: Option<String>,
    /// Popup type: "permission", "ask", or "question"
    #[serde(rename = "type")]
    pub popup_type: String,
    /// Type-specific data (permission details, question options, etc.)
    pub data: serde_json::Value,
    /// Current status: "pending", "responded", or "timeout"
    pub status: String,
}