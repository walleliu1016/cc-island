use serde::{Deserialize, Serialize};

// --- 保留原有数据类型（不变） ---
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageData {
    pub id: String,
    pub session_id: String,
    pub message_type: MessageType,
    pub content: String,
    pub tool_name: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub token: String,
    pub hostname: Option<String>,
    pub registered_at: Option<String>,
    pub online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub session_id: String,
    pub project_name: String,
    pub status: String,
    pub current_tool: Option<String>,
    pub created_at: Option<u64>,
}

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

// --- Socket.IO 事件 payload ---

/// /hooks namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPayload {
    pub device_token: String,
    pub session_id: String,
    pub hook_type: HookType,
    pub hook_body: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResponsePayload {
    pub device_token: String,
    pub session_id: String,
    pub decision: Option<String>,
    pub answers: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupResolvedPayload {
    pub device_token: String,
    pub popup_id: String,
    pub session_id: String,
    pub source: String,
    pub decision: Option<String>,
    pub answers: Option<Vec<Vec<String>>>,
}

/// /chat namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryPayload {
    pub device_token: String,
    pub session_id: String,
    pub messages: Vec<ChatMessageData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestChatHistoryPayload {
    pub device_token: String,
    pub session_id: String,
    pub limit: Option<u32>,
}

/// /sessions namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSessionListPayload {
    pub device_token: String,
    pub mobile_conn_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListResponsePayload {
    pub device_token: String,
    pub mobile_conn_id: String,
    pub sessions: Vec<ClaudeSession>,
}

/// /devices namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceOnlinePayload {
    pub device: DeviceInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceOfflinePayload {
    pub device_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceListPayload {
    pub devices: Vec<DeviceInfo>,
}
