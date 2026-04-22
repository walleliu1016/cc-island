// Integration tests for multi-instance cloud server
// Tests cross-instance message routing via PostgreSQL LISTEN/NOTIFY
//
// NOTE: These tests require a running PostgreSQL database.
// Set DATABASE_URL environment variable or use .env file.
// Run migrations manually before tests: cargo run --release

use cc_island_cloud::db::pending_message::{PendingMessageRepo, Direction, NotifyPayload};

#[sqlx::test]
async fn test_pending_message_insert_and_retrieve(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert a pending message
    let message_body = serde_json::json!({
        "type": "hook_message",
        "device_token": "test-device-1",
        "session_id": "test-session-1",
        "hook_type": "PreToolUse",
        "hook_body": {"tool_name": "Bash"}
    });

    let message_id = repo.insert(
        "test-device-1",
        Direction::ToMobile,
        "hook_message",
        message_body.clone(),
    ).await.expect("Insert should succeed");

    // Retrieve and delete
    let retrieved = repo.get_and_delete(message_id).await.expect("Get should succeed");

    assert!(retrieved.is_some(), "Message should exist");
    let msg = retrieved.unwrap();
    assert_eq!(msg.device_token, "test-device-1");
    assert_eq!(msg.direction, "to_mobile");
    assert_eq!(msg.message_type, "hook_message");

    // Verify deletion - second get should return None
    let second = repo.get_and_delete(message_id).await.expect("Second get should succeed");
    assert!(second.is_none(), "Message should be deleted after first retrieval");
}

#[sqlx::test]
async fn test_pending_message_notify(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert message
    let message_id = repo.insert(
        "test-device-notify",
        Direction::ToDesktop,
        "hook_response",
        serde_json::json!({"type": "hook_response"}),
    ).await.expect("Insert should succeed");

    // Send NOTIFY
    let payload = NotifyPayload {
        device_token: "test-device-notify".to_string(),
        direction: "to_desktop".to_string(),
        message_id,
    };

    repo.notify(&payload).await.expect("Notify should succeed");

    // Verify message exists
    let retrieved = repo.get_and_delete(message_id).await.expect("Get should succeed");
    assert!(retrieved.is_some(), "Message should exist after NOTIFY");
}

#[sqlx::test]
async fn test_delete_stale_messages(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert a message
    let message_id = repo.insert(
        "test-device-stale",
        Direction::ToMobile,
        "test_message",
        serde_json::json!({"test": true}),
    ).await.expect("Insert should succeed");

    // Delete messages older than -1 minutes (should delete everything including fresh message)
    // Negative threshold means delete messages created before NOW() + 1 minute, which is all messages
    let count = repo.delete_stale(-1.0).await.expect("Delete stale should succeed");

    // Message should be deleted now
    let retrieved = repo.get_and_delete(message_id).await.expect("Get should succeed");
    assert!(retrieved.is_none(), "Message should be deleted by stale cleanup");
    assert!(count >= 1, "At least one message should be deleted");
}

#[sqlx::test]
async fn test_concurrent_get_and_delete(pool: sqlx::PgPool) {
    let repo = PendingMessageRepo::new(pool.clone());

    // Insert a single message
    let message_id = repo.insert(
        "test-device-concurrent",
        Direction::ToMobile,
        "concurrent_test",
        serde_json::json!({"concurrent": true}),
    ).await.expect("Insert should succeed");

    // Spawn two tasks trying to get the same message
    let repo1 = repo.clone();
    let repo2 = repo.clone();

    let task1 = tokio::spawn(async move {
        repo1.get_and_delete(message_id).await
    });

    let task2 = tokio::spawn(async move {
        repo2.get_and_delete(message_id).await
    });

    let result1 = task1.await.expect("Task1 should complete").expect("Task1 should succeed");
    let result2 = task2.await.expect("Task2 should complete").expect("Task2 should succeed");

    // Exactly one should succeed, one should get None
    let success_count = match (result1, result2) {
        (Some(_), None) => 1,
        (None, Some(_)) => 1,
        (Some(_), Some(_)) => 2, // This shouldn't happen
        (None, None) => 0, // This shouldn't happen
    };

    assert_eq!(success_count, 1, "Exactly one task should retrieve the message");
}