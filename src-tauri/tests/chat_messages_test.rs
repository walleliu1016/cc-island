// Tests for chat_messages module

use cc_island_lib::chat_messages::{ChatHistory, ChatMessage, MessageType};

fn create_test_message(id: &str, session_id: &str, message_type: MessageType) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        session_id: session_id.to_string(),
        message_type,
        content: "test content".to_string(),
        tool_name: None,
        timestamp: 1000,
    }
}

#[test]
fn test_chat_history_new() {
    let history = ChatHistory::new();
    assert_eq!(history.get_messages("session-1").len(), 0);
}

#[test]
fn test_chat_history_add_message() {
    let mut history = ChatHistory::new();
    history.add_message(create_test_message("msg-1", "session-1", MessageType::User));

    let messages = history.get_messages("session-1");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id, "msg-1");
}

#[test]
fn test_chat_history_add_multiple() {
    let mut history = ChatHistory::new();
    history.add_message(create_test_message("msg-1", "session-1", MessageType::User));
    history.add_message(create_test_message("msg-2", "session-1", MessageType::Assistant));
    history.add_message(create_test_message("msg-3", "session-1", MessageType::ToolCall));

    let messages = history.get_messages("session-1");
    assert_eq!(messages.len(), 3);
}

#[test]
fn test_chat_history_multiple_sessions() {
    let mut history = ChatHistory::new();
    history.add_message(create_test_message("msg-1", "session-1", MessageType::User));
    history.add_message(create_test_message("msg-2", "session-2", MessageType::User));
    history.add_message(create_test_message("msg-3", "session-1", MessageType::Assistant));

    assert_eq!(history.get_messages("session-1").len(), 2);
    assert_eq!(history.get_messages("session-2").len(), 1);
}

#[test]
fn test_chat_history_clear_session() {
    let mut history = ChatHistory::new();
    history.add_message(create_test_message("msg-1", "session-1", MessageType::User));
    history.add_message(create_test_message("msg-2", "session-2", MessageType::User));

    history.clear_session("session-1");

    assert_eq!(history.get_messages("session-1").len(), 0);
    assert_eq!(history.get_messages("session-2").len(), 1);
}

#[test]
fn test_chat_history_get_all() {
    let mut history = ChatHistory::new();
    history.add_message(create_test_message("msg-1", "session-1", MessageType::User));
    history.add_message(create_test_message("msg-2", "session-2", MessageType::User));

    let all = history.get_all();
    assert_eq!(all.len(), 2);
}

#[test]
fn test_chat_history_max_messages() {
    let mut history = ChatHistory::new();

    // Add more than max_per_session (100)
    for i in 0..110 {
        history.add_message(create_test_message(
            &format!("msg-{}", i),
            "session-1",
            MessageType::User
        ));
    }

    let messages = history.get_messages("session-1");
    // Should be capped at max_per_session
    assert_eq!(messages.len(), 100);
    // Oldest messages should be removed
    assert_eq!(messages[0].id, "msg-10");
}

#[test]
fn test_message_type_serialization() {
    let types = [
        MessageType::User,
        MessageType::Assistant,
        MessageType::ToolCall,
        MessageType::ToolResult,
        MessageType::Thinking,
        MessageType::Interrupted,
    ];

    for mt in types {
        let json = serde_json::to_string(&mt).unwrap();
        let parsed: MessageType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, mt);
    }
}

#[test]
fn test_chat_message_serialization() {
    let message = ChatMessage {
        id: "msg-1".to_string(),
        session_id: "session-1".to_string(),
        message_type: MessageType::ToolCall,
        content: "Running tests".to_string(),
        tool_name: Some("Bash".to_string()),
        timestamp: 1234567890,
    };

    let json = serde_json::to_string(&message).unwrap();
    assert!(json.contains("msg-1"));
    assert!(json.contains("toolCall"));
    assert!(json.contains("Bash"));

    let parsed: ChatMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "msg-1");
    assert_eq!(parsed.message_type, MessageType::ToolCall);
    assert_eq!(parsed.tool_name, Some("Bash".to_string()));
}

#[test]
fn test_message_type_equality() {
    assert_eq!(MessageType::User, MessageType::User);
    assert_ne!(MessageType::User, MessageType::Assistant);
    assert_eq!(MessageType::ToolCall, MessageType::ToolCall);
}