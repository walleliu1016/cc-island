use serde::{Deserialize, Serialize};

// Re-export base types from messages.rs
pub use crate::messages::{ChatMessageData, DeviceInfo, ClaudeSession, HookType};

// --- Socket.IO event payloads ---

/// Hook relay payloads (Desktop → Server → Mobile)
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

/// Chat history payloads (Desktop → Server → Mobile, or DB → Mobile)
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

/// Session list payloads (Mobile → Desktop → Mobile)
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

/// Device presence payloads (Desktop auth → room broadcast → Mobile)
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
