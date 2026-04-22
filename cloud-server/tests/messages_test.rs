// Tests for CloudMessage serialization/deserialization

use cc_island_cloud::messages::{CloudMessage, HookType, MessageType, DeviceInfo, ClaudeSession, ChatMessageData};
use serde_json::json;

fn s(s: &str) -> String { s.to_string() }

#[test]
fn test_hook_type_serialize() {
    assert_eq!(
        serde_json::to_string(&HookType::SessionStart).unwrap(),
        "\"SessionStart\""
    );
    assert_eq!(
        serde_json::to_string(&HookType::PermissionRequest).unwrap(),
        "\"PermissionRequest\""
    );
    assert_eq!(
        serde_json::to_string(&HookType::PreToolUse).unwrap(),
        "\"PreToolUse\""
    );
}

#[test]
fn test_hook_type_deserialize() {
    let hook: HookType = serde_json::from_str("\"SessionEnd\"").unwrap();
    assert_eq!(hook, HookType::SessionEnd);

    let hook: HookType = serde_json::from_str("\"Stop\"").unwrap();
    assert_eq!(hook, HookType::Stop);
}

#[test]
fn test_message_type_serialize() {
    assert_eq!(
        serde_json::to_string(&MessageType::User).unwrap(),
        "\"user\""
    );
    assert_eq!(
        serde_json::to_string(&MessageType::Assistant).unwrap(),
        "\"assistant\""
    );
    assert_eq!(
        serde_json::to_string(&MessageType::ToolCall).unwrap(),
        "\"toolCall\""
    );
}

#[test]
fn test_message_type_deserialize() {
    let mt: MessageType = serde_json::from_str("\"user\"").unwrap();
    assert_eq!(mt, MessageType::User);

    let mt: MessageType = serde_json::from_str("\"thinking\"").unwrap();
    assert_eq!(mt, MessageType::Thinking);
}

#[test]
fn test_device_register_message() {
    let msg = CloudMessage::DeviceRegister {
        device_token: s("device-1"),
        hostname: Some(s("host-1")),
        device_name: None,
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("device_register"));
    assert!(json.contains("device-1"));

    let parsed: CloudMessage = serde_json::from_str(&json).unwrap();
    match parsed {
        CloudMessage::DeviceRegister { device_token, .. } => {
            assert_eq!(device_token, "device-1");
        },
        _ => panic!("Wrong message type"),
    }
}

#[test]
fn test_mobile_auth_message() {
    let msg = CloudMessage::MobileAuth {
        device_tokens: vec![s("device-a"), s("device-b")],
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("mobile_auth"));

    let parsed: CloudMessage = serde_json::from_str(&json).unwrap();
    match parsed {
        CloudMessage::MobileAuth { device_tokens } => {
            assert_eq!(device_tokens.len(), 2);
        },
        _ => panic!("Wrong message type"),
    }
}

#[test]
fn test_auth_success_message() {
    let msg = CloudMessage::AuthSuccess {
        device_id: s("device-1"),
        hostname: Some(s("host-1")),
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("auth_success"));
}

#[test]
fn test_auth_failed_message() {
    let msg = CloudMessage::AuthFailed {
        reason: s("Invalid token"),
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("auth_failed"));
    assert!(json.contains("Invalid token"));
}

#[test]
fn test_ping_pong_messages() {
    let ping = CloudMessage::Ping;
    let pong = CloudMessage::Pong;

    assert_eq!(serde_json::to_string(&ping).unwrap(), "{\"type\":\"ping\"}");
    assert_eq!(serde_json::to_string(&pong).unwrap(), "{\"type\":\"pong\"}");
}

#[test]
fn test_hook_message() {
    let msg = CloudMessage::HookMessage {
        device_token: s("device-1"),
        session_id: s("session-1"),
        hook_type: HookType::PreToolUse,
        hook_body: json!({"tool_name": "Bash"}),
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("hook_message"));
    assert!(json.contains("PreToolUse"));

    let parsed: CloudMessage = serde_json::from_str(&json).unwrap();
    match parsed {
        CloudMessage::HookMessage { hook_type, .. } => {
            assert_eq!(hook_type, HookType::PreToolUse);
        },
        _ => panic!("Wrong message type"),
    }
}

#[test]
fn test_chat_history_message() {
    let msg = CloudMessage::ChatHistory {
        device_token: s("device-1"),
        session_id: s("session-1"),
        messages: vec![
            ChatMessageData {
                id: s("msg-1"),
                session_id: s("session-1"),
                message_type: MessageType::User,
                content: s("Hello"),
                tool_name: None,
                timestamp: 1000,
            },
        ],
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("chat_history"));
    assert!(json.contains("Hello"));
}

#[test]
fn test_request_chat_history_message() {
    let msg = CloudMessage::RequestChatHistory {
        device_token: s("device-1"),
        session_id: s("session-1"),
        limit: Some(50),
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("request_chat_history"));
    assert!(json.contains("50"));
}

#[test]
fn test_hook_response_message() {
    let msg = CloudMessage::HookResponse {
        device_token: s("device-1"),
        session_id: s("session-1"),
        decision: Some(s("allow")),
        answers: None,
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("hook_response"));
    assert!(json.contains("allow"));
}

#[test]
fn test_device_list_message() {
    let msg = CloudMessage::DeviceList {
        devices: vec![
            DeviceInfo {
                token: s("device-1"),
                hostname: Some(s("host-1")),
                registered_at: Some(s("2024-01-01T00:00:00Z")),
                online: true,
            },
        ],
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("device_list"));
    assert!(json.contains("device-1"));
}

#[test]
fn test_session_list_message() {
    let msg = CloudMessage::SessionList {
        device_token: s("device-1"),
        sessions: vec![
            ClaudeSession {
                session_id: s("session-1"),
                project_name: s("my-project"),
                status: s("working"),
                current_tool: Some(s("Bash")),
                created_at: Some(1000),
            },
        ],
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("session_list"));
    assert!(json.contains("my-project"));
}

#[test]
fn test_device_online_message() {
    let msg = CloudMessage::DeviceOnline {
        device: DeviceInfo {
            token: s("device-1"),
            hostname: Some(s("host-1")),
            registered_at: None,
            online: true,
        },
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("device_online"));
}

#[test]
fn test_device_offline_message() {
    let msg = CloudMessage::DeviceOffline {
        device_token: s("device-1"),
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("device_offline"));
}

#[test]
fn test_chat_message_data_serialize() {
    let msg = ChatMessageData {
        id: s("msg-1"),
        session_id: s("session-1"),
        message_type: MessageType::ToolCall,
        content: s("Running command"),
        tool_name: Some(s("Bash")),
        timestamp: 1234567890,
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("toolCall"));
    assert!(json.contains("Bash"));
}

#[test]
fn test_chat_message_data_camel_case() {
    // Test that camelCase is used
    let msg = ChatMessageData {
        id: s("msg-1"),
        session_id: s("session-1"),
        message_type: MessageType::ToolResult,
        content: s("Result"),
        tool_name: Some(s("Read")),
        timestamp: 1000,
    };

    let json = serde_json::to_string(&msg).unwrap();
    // Verify camelCase field names
    assert!(json.contains("\"sessionId\""));
    assert!(json.contains("\"messageType\""));
    assert!(json.contains("\"toolName\""));
}

#[test]
fn test_message_type_equality() {
    assert_eq!(MessageType::User, MessageType::User);
    assert_ne!(MessageType::User, MessageType::Assistant);
}

#[test]
fn test_hook_type_equality() {
    assert_eq!(HookType::SessionStart, HookType::SessionStart);
    assert_ne!(HookType::SessionStart, HookType::SessionEnd);
}