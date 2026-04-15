use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CloudMessage {
    // Authentication
    #[serde(rename = "device_register")]
    DeviceRegister {
        device_token: String,
        device_name: Option<String>,
    },

    #[serde(rename = "mobile_auth")]
    MobileAuth {
        device_token: String,
    },

    #[serde(rename = "auth_success")]
    AuthSuccess {
        device_id: String,
        device_name: Option<String>,
    },

    #[serde(rename = "auth_failed")]
    AuthFailed {
        reason: String,
    },

    // Desktop -> Cloud
    #[serde(rename = "state_update")]
    StateUpdate {
        device_token: String,
        sessions: Vec<SessionState>,
        popups: Vec<PopupState>,
    },

    #[serde(rename = "new_popup")]
    NewPopup {
        device_token: String,
        popup: PopupState,
    },

    #[serde(rename = "ping")]
    Ping,

    // Cloud -> Mobile
    #[serde(rename = "initial_state")]
    InitialState {
        sessions: Vec<SessionState>,
        popups: Vec<PopupState>,
    },

    #[serde(rename = "new_popup_from_device")]
    NewPopupFromDevice {
        popup: PopupState,
    },

    // Mobile -> Cloud
    #[serde(rename = "respond_popup")]
    RespondPopup {
        device_token: String,
        popup_id: String,
        decision: Option<String>,
        answers: Option<Vec<Vec<String>>>,
    },

    // Cloud -> Desktop
    #[serde(rename = "popup_response")]
    PopupResponse {
        popup_id: String,
        decision: Option<String>,
        answers: Option<Vec<Vec<String>>>,
    },

    #[serde(rename = "pong")]
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub session_id: String,
    pub project_name: Option<String>,
    pub status: String,
    pub current_tool: Option<String>,
    pub tool_input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PopupState {
    pub id: String,
    pub session_id: Option<String>,
    pub project_name: Option<String>,
    #[serde(rename = "type")]
    pub popup_type: String,
    pub data: serde_json::Value,
    pub status: String,
}