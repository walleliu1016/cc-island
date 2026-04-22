// Repository integration tests
// Tests database operations for devices, sessions, and chat messages

use cc_island_cloud::db::repository::Repository;
use cc_island_cloud::messages::{ChatMessageData, MessageType};

fn s(s: &str) -> String { s.to_string() }

#[sqlx::test]
async fn test_upsert_device(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Insert new device
    let device = repo.upsert_device("device-1", Some("host1"), Some("MyDevice"))
        .await
        .expect("Upsert should succeed");

    assert_eq!(device.device_token, "device-1");
    assert_eq!(device.hostname, Some(s("host1")));
    assert_eq!(device.name, Some(s("MyDevice")));
    assert_eq!(device.status, "online");
}

#[sqlx::test]
async fn test_upsert_device_update(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Insert device
    repo.upsert_device("device-2", Some("host2"), None)
        .await
        .expect("First upsert should succeed");

    // Update device (change hostname)
    let device = repo.upsert_device("device-2", Some("new-host"), Some("Updated"))
        .await
        .expect("Second upsert should succeed");

    assert_eq!(device.hostname, Some(s("new-host")));
    assert_eq!(device.name, Some(s("Updated")));
}

#[sqlx::test]
async fn test_set_device_offline(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device
    repo.upsert_device("device-3", None, None)
        .await
        .expect("Upsert should succeed");

    // Set offline
    repo.set_device_offline("device-3")
        .await
        .expect("Set offline should succeed");

    // Verify
    let devices = repo.get_online_devices().await.expect("Get online should succeed");
    let online_device = devices.iter().find(|d| d.token == "device-3");
    assert!(online_device.is_none(), "Device should be offline");
}

#[sqlx::test]
async fn test_get_online_devices(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create multiple devices
    repo.upsert_device("device-a", Some("host-a"), None).await.expect("Upsert A should succeed");
    repo.upsert_device("device-b", Some("host-b"), None).await.expect("Upsert B should succeed");
    repo.set_device_offline("device-a").await.expect("Set offline A should succeed");

    let devices = repo.get_online_devices().await.expect("Get online should succeed");
    assert_eq!(devices.len(), 1, "Only one device should be online");
    assert_eq!(devices[0].token, "device-b");
}

#[sqlx::test]
async fn test_get_devices_info(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create devices
    repo.upsert_device("device-x", Some("host-x"), None).await.expect("Upsert X should succeed");
    repo.upsert_device("device-y", Some("host-y"), None).await.expect("Upsert Y should succeed");

    // Query specific devices
    let devices = repo.get_devices_info(&[s("device-x"), s("device-y")])
        .await
        .expect("Get devices info should succeed");

    assert_eq!(devices.len(), 2);
}

#[sqlx::test]
async fn test_upsert_session(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first (foreign key constraint)
    repo.upsert_device("device-s1", None, None).await.expect("Upsert device should succeed");

    // Create session
    repo.upsert_session("device-s1", "session-1", Some("my-project"), "idle", None)
        .await
        .expect("Upsert session should succeed");

    // Update session status
    repo.upsert_session("device-s1", "session-1", None, "working", Some("Bash"))
        .await
        .expect("Update session should succeed");

    // Query active sessions
    let sessions = repo.get_active_sessions(&[s("device-s1")])
        .await
        .expect("Get sessions should succeed");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].status, "working");
    assert_eq!(sessions[0].current_tool, Some(s("Bash")));
}

#[sqlx::test]
async fn test_end_session(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-s2", None, None).await.expect("Upsert device should succeed");

    // Create session
    repo.upsert_session("device-s2", "session-2", Some("project"), "idle", None)
        .await
        .expect("Upsert session should succeed");

    // End session
    repo.end_session("device-s2", "session-2")
        .await
        .expect("End session should succeed");

    // Query - ended sessions should not appear
    let sessions = repo.get_active_sessions(&[s("device-s2")])
        .await
        .expect("Get sessions should succeed");

    assert_eq!(sessions.len(), 0, "Ended session should not appear in active list");
}

#[sqlx::test]
async fn test_update_session_project_name(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-s3", None, None).await.expect("Upsert device should succeed");

    // Create session without project name
    repo.upsert_session("device-s3", "session-3", None, "idle", None)
        .await
        .expect("Upsert session should succeed");

    // Update project name
    repo.update_session_project_name("device-s3", "session-3", "new-project")
        .await
        .expect("Update project name should succeed");

    // Query
    let sessions = repo.get_active_sessions(&[s("device-s3")])
        .await
        .expect("Get sessions should succeed");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].project_name, Some(s("new-project")));
}

#[sqlx::test]
async fn test_upsert_chat_messages(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-c1", None, None).await.expect("Upsert device should succeed");

    // Create messages
    let messages = vec![
        ChatMessageData {
            id: s("msg-1"),
            session_id: s("session-4"),
            message_type: MessageType::User,
            content: s("Hello"),
            tool_name: None,
            timestamp: 1000,
        },
        ChatMessageData {
            id: s("msg-2"),
            session_id: s("session-4"),
            message_type: MessageType::Assistant,
            content: s("Hi there"),
            tool_name: None,
            timestamp: 2000,
        },
    ];

    repo.upsert_chat_messages("device-c1", "session-4", &messages)
        .await
        .expect("Upsert chat messages should succeed");

    // Query
    let retrieved = repo.get_chat_history("device-c1", "session-4", None)
        .await
        .expect("Get chat history should succeed");

    assert_eq!(retrieved.len(), 2);
    assert_eq!(retrieved[0].content, "Hello");
    assert_eq!(retrieved[1].content, "Hi there");
}

#[sqlx::test]
async fn test_upsert_chat_messages_duplicate(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-c2", None, None).await.expect("Upsert device should succeed");

    // Create message
    let messages = vec![
        ChatMessageData {
            id: s("msg-dup"),
            session_id: s("session-5"),
            message_type: MessageType::User,
            content: s("First content"),
            tool_name: None,
            timestamp: 1000,
        },
    ];

    repo.upsert_chat_messages("device-c2", "session-5", &messages)
        .await
        .expect("First upsert should succeed");

    // Try to insert duplicate with different content
    let messages2 = vec![
        ChatMessageData {
            id: s("msg-dup"),
            session_id: s("session-5"),
            message_type: MessageType::User,
            content: s("Second content"),
            tool_name: None,
            timestamp: 2000,
        },
    ];

    repo.upsert_chat_messages("device-c2", "session-5", &messages2)
        .await
        .expect("Duplicate upsert should succeed (ON CONFLICT DO NOTHING)");

    // Query - should have original content
    let retrieved = repo.get_chat_history("device-c2", "session-5", None)
        .await
        .expect("Get chat history should succeed");

    assert_eq!(retrieved.len(), 1);
    assert_eq!(retrieved[0].content, "First content", "Duplicate should not overwrite");
}

#[sqlx::test]
async fn test_get_chat_history_limit(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-c3", None, None).await.expect("Upsert device should succeed");

    // Create multiple messages
    let messages: Vec<ChatMessageData> = (0..10).map(|i| {
        ChatMessageData {
            id: s(&format!("msg-limit-{}", i)),
            session_id: s("session-6"),
            message_type: MessageType::Assistant,
            content: s(&format!("Message {}", i)),
            tool_name: None,
            timestamp: i as u64 * 1000,
        }
    }).collect();

    repo.upsert_chat_messages("device-c3", "session-6", &messages)
        .await
        .expect("Upsert should succeed");

    // Query with limit
    let retrieved = repo.get_chat_history("device-c3", "session-6", Some(5))
        .await
        .expect("Get chat history should succeed");

    assert_eq!(retrieved.len(), 5, "Should respect limit");
}

#[sqlx::test]
async fn test_upsert_popup(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-p1", None, None).await.expect("Upsert device should succeed");

    // Create popup
    repo.upsert_popup(
        "device-p1",
        "session-7",
        "popup-1",
        "permission",
        Some("project"),
        serde_json::json!({"tool_name": "Bash"}),
    ).await.expect("Upsert popup should succeed");

    // Query
    let popups = repo.get_pending_popups("device-p1")
        .await
        .expect("Get popups should succeed");

    assert_eq!(popups.len(), 1);
    assert_eq!(popups[0].popup_type, "permission");
}

#[sqlx::test]
async fn test_resolve_popup(pool: sqlx::PgPool) {
    let repo = Repository::new(pool);

    // Create device first
    repo.upsert_device("device-p2", None, None).await.expect("Upsert device should succeed");

    // Create popup
    repo.upsert_popup(
        "device-p2",
        "session-8",
        "popup-2",
        "ask",
        None,
        serde_json::json!({"questions": []}),
    ).await.expect("Upsert popup should succeed");

    // Resolve
    repo.resolve_popup("popup-2")
        .await
        .expect("Resolve popup should succeed");

    // Query - resolved popup should not appear
    let popups = repo.get_pending_popups("device-p2")
        .await
        .expect("Get popups should succeed");

    assert_eq!(popups.len(), 0, "Resolved popup should not appear in pending list");
}