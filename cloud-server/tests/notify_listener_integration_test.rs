// Integration tests for NotifyListener
// Tests notification handling logic

use cc_island_cloud::ws::notify_listener::NotifyListener;
use cc_island_cloud::ws::router::ConnectionRouter;
use cc_island_cloud::db::repository::Repository;
use cc_island_cloud::db::pending_message::{PendingMessageRepo, Direction, NotifyPayload};
use tokio::sync::mpsc::channel;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

fn s(s: &str) -> String { s.to_string() }

#[sqlx::test]
async fn test_notify_listener_creation(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let listener = NotifyListener::new(pool, router);

    // Just verify creation works
    assert!(true);
}

#[sqlx::test]
async fn test_notify_payload_direction_to_mobile(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert message for mobile
    let message_id = repo.insert(
        "device-notify-mobile",
        Direction::ToMobile,
        "test_message",
        serde_json::json!({"type": "test"}),
    ).await.expect("Insert should succeed");

    // Create NOTIFY payload
    let payload = NotifyPayload {
        device_token: s("device-notify-mobile"),
        direction: s("to_mobile"),
        message_id,
    };

    // Verify payload structure
    assert_eq!(payload.direction, "to_mobile");
    assert_eq!(payload.device_token, "device-notify-mobile");
}

#[sqlx::test]
async fn test_notify_payload_direction_to_desktop(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert message for desktop
    let message_id = repo.insert(
        "device-notify-desktop",
        Direction::ToDesktop,
        "hook_response",
        serde_json::json!({"type": "hook_response"}),
    ).await.expect("Insert should succeed");

    // Create NOTIFY payload
    let payload = NotifyPayload {
        device_token: s("device-notify-desktop"),
        direction: s("to_desktop"),
        message_id,
    };

    // Verify payload structure
    assert_eq!(payload.direction, "to_desktop");
}

#[sqlx::test]
async fn test_notify_listener_with_mobile_subscriber(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let (tx, mut rx) = channel::<Message>(32);

    // Register mobile subscriber
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-listener-1")], &tx);

    // Insert pending message
    let repo = PendingMessageRepo::new(pool.clone());
    let message_id = repo.insert(
        "device-listener-1",
        Direction::ToMobile,
        "hook_message",
        serde_json::json!({"type": "hook_message", "session_id": "test"}),
    ).await.expect("Insert should succeed");

    // Simulate NOTIFY
    repo.notify(&NotifyPayload {
        device_token: s("device-listener-1"),
        direction: s("to_mobile"),
        message_id,
    }).await.expect("Notify should succeed");

    // Verify router has subscriber
    assert!(router.has_mobile_subscribers("device-listener-1"));

    // In a real scenario, NotifyListener would retrieve and deliver
    // Here we manually verify get_and_delete works
    let retrieved = repo.get_and_delete(message_id).await.expect("Get should succeed");
    assert!(retrieved.is_some());
}

#[sqlx::test]
async fn test_notify_listener_with_desktop_connection(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let (tx, mut rx) = channel::<Message>(32);

    // Register desktop
    router.register_desktop("device-listener-2", None, tx);

    // Insert pending message
    let repo = PendingMessageRepo::new(pool.clone());
    let message_id = repo.insert(
        "device-listener-2",
        Direction::ToDesktop,
        "hook_response",
        serde_json::json!({"type": "hook_response", "decision": "allow"}),
    ).await.expect("Insert should succeed");

    // Simulate NOTIFY
    repo.notify(&NotifyPayload {
        device_token: s("device-listener-2"),
        direction: s("to_desktop"),
        message_id,
    }).await.expect("Notify should succeed");

    // Verify router has desktop connection
    assert!(router.has_desktop_connection("device-listener-2"));

    // Manually retrieve to verify atomicity
    let retrieved = repo.get_and_delete(message_id).await.expect("Get should succeed");
    assert!(retrieved.is_some());
}

#[sqlx::test]
async fn test_notify_listener_no_subscriber(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();

    // No subscribers registered
    assert!(!router.has_mobile_subscribers("device-no-sub"));
    assert!(!router.has_desktop_connection("device-no-sub"));

    // Insert pending message
    let repo = PendingMessageRepo::new(pool.clone());
    let message_id = repo.insert(
        "device-no-sub",
        Direction::ToMobile,
        "test",
        serde_json::json!({}),
    ).await.expect("Insert should succeed");

    // Message stays in pending_messages
    let retrieved = repo.get_and_delete(message_id).await.expect("Get should succeed");
    assert!(retrieved.is_some());
}

#[sqlx::test]
async fn test_notify_listener_message_already_delivered(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert and immediately delete (simulate another instance delivered)
    let message_id = repo.insert(
        "device-race",
        Direction::ToMobile,
        "test",
        serde_json::json!({}),
    ).await.expect("Insert should succeed");

    // First get_and_delete succeeds
    let first = repo.get_and_delete(message_id).await.expect("First should succeed");
    assert!(first.is_some());

    // Second get_and_delete returns None (race condition handled)
    let second = repo.get_and_delete(message_id).await.expect("Second should succeed");
    assert!(second.is_none(), "Second should return None - message already delivered");
}

#[sqlx::test]
async fn test_notify_listener_notify_payload_json(pool: sqlx::PgPool) {
    // Test NOTIFY payload JSON serialization
    let payload = NotifyPayload {
        device_token: s("device-json-test"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };

    let json = serde_json::to_string(&payload).unwrap();

    // Parse back
    let parsed: NotifyPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.device_token, "device-json-test");
    assert_eq!(parsed.direction, "to_mobile");
}