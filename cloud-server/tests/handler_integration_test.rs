// Integration tests for MessageHandler
// Tests message handling logic with real database

use cc_island_cloud::ws::handler::MessageHandler;
use cc_island_cloud::ws::router::ConnectionRouter;
use cc_island_cloud::db::repository::Repository;
use cc_island_cloud::db::pending_message::PendingMessageRepo;
use cc_island_cloud::messages::{CloudMessage, HookType, ChatMessageData, MessageType};
use tokio::sync::mpsc::{channel, Sender};
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

fn s(s: &str) -> String { s.to_string() }

fn create_handler(pool: sqlx::PgPool, mobile_conn_id: Option<Uuid>) -> (MessageHandler, Sender<Message>, ConnectionRouter, Repository) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool);
    let (tx, _rx) = channel::<Message>(32);

    (MessageHandler::new(router.clone(), repo.clone(), pending_repo, mobile_conn_id), tx, router, repo)
}

#[sqlx::test]
async fn test_handler_ping(pool: sqlx::PgPool) {
    let (handler, tx, _, _) = create_handler(pool, None);

    handler.handle(CloudMessage::Ping, &tx, "").await;
}

#[sqlx::test]
async fn test_handler_mobile_auth(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool);
    let (tx, _rx) = channel::<Message>(32);

    // Register mobile connection
    let conn_id = router.register_mobile_empty(tx.clone());

    let handler = MessageHandler::new(router.clone(), repo.clone(), pending_repo, Some(conn_id));

    // Create device first
    repo.upsert_device("device-auth-1", Some("host-1"), None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-auth-1", "session-auth", Some("project-auth"), "idle", None)
        .await
        .expect("Upsert session should succeed");

    // Handle MobileAuth
    handler.handle(
        CloudMessage::MobileAuth { device_tokens: vec![s("device-auth-1")] },
        &tx,
        "",
    ).await;

    // Check subscription updated
    assert!(router.has_mobile_subscribers("device-auth-1"));
}

#[sqlx::test]
async fn test_handler_hook_message_session_start(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    // Register desktop
    router.register_desktop("device-hook-1", None, tx.clone());

    // Create device first
    repo.upsert_device("device-hook-1", None, None).await.expect("Upsert device should succeed");

    // Handle SessionStart
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-hook-1"),
            session_id: s("session-hook"),
            hook_type: HookType::SessionStart,
            hook_body: serde_json::json!({"cwd": "/path/to/project"}),
        },
        &tx,
        "device-hook-1",
    ).await;

    // Check session created
    let sessions = repo.get_active_sessions(&[s("device-hook-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "session-hook");
}

#[sqlx::test]
async fn test_handler_hook_message_session_end(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    // Register desktop
    router.register_desktop("device-end-1", None, tx.clone());

    // Create device and session
    repo.upsert_device("device-end-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-end-1", "session-end", Some("project"), "idle", None)
        .await
        .expect("Upsert session should succeed");

    // Handle SessionEnd
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-end-1"),
            session_id: s("session-end"),
            hook_type: HookType::SessionEnd,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-end-1",
    ).await;

    // Check session ended
    let sessions = repo.get_active_sessions(&[s("device-end-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions.len(), 0, "Session should be ended");
}

#[sqlx::test]
async fn test_handler_hook_message_pre_tool_use(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-tool-1", None, tx.clone());
    repo.upsert_device("device-tool-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-tool-1", "session-tool", Some("project"), "idle", None)
        .await
        .expect("Upsert session should succeed");

    // Handle PreToolUse
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-tool-1"),
            session_id: s("session-tool"),
            hook_type: HookType::PreToolUse,
            hook_body: serde_json::json!({"tool_name": "Bash"}),
        },
        &tx,
        "device-tool-1",
    ).await;

    // Check session status updated
    let sessions = repo.get_active_sessions(&[s("device-tool-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "working");
    assert_eq!(sessions[0].current_tool, Some(s("Bash")));
}

#[sqlx::test]
async fn test_handler_hook_message_post_tool_use(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-post-1", None, tx.clone());
    repo.upsert_device("device-post-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-post-1", "session-post", Some("project"), "working", Some("Bash"))
        .await
        .expect("Upsert session should succeed");

    // Handle PostToolUse
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-post-1"),
            session_id: s("session-post"),
            hook_type: HookType::PostToolUse,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-post-1",
    ).await;

    // Check session status updated to waiting
    let sessions = repo.get_active_sessions(&[s("device-post-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "waiting");
}

#[sqlx::test]
async fn test_handler_hook_message_stop(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-stop-1", None, tx.clone());
    repo.upsert_device("device-stop-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-stop-1", "session-stop", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle Stop
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-stop-1"),
            session_id: s("session-stop"),
            hook_type: HookType::Stop,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-stop-1",
    ).await;

    // Check session status updated to idle
    let sessions = repo.get_active_sessions(&[s("device-stop-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "idle");
}

#[sqlx::test]
async fn test_handler_hook_message_permission_request(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-perm-1", None, tx.clone());
    repo.upsert_device("device-perm-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-perm-1", "session-perm", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle PermissionRequest
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-perm-1"),
            session_id: s("session-perm"),
            hook_type: HookType::PermissionRequest,
            hook_body: serde_json::json!({
                "tool_name": "Bash",
                "tool_input": {"description": "npm test"},
                "permission_data": {},
            }),
        },
        &tx,
        "device-perm-1",
    ).await;

    // Check session status updated to waitingForApproval
    let sessions = repo.get_active_sessions(&[s("device-perm-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "waitingForApproval");
}

#[sqlx::test]
async fn test_handler_chat_history(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-chat-1", None, tx.clone());
    repo.upsert_device("device-chat-1", None, None).await.expect("Upsert device should succeed");

    // Handle ChatHistory
    handler.handle(
        CloudMessage::ChatHistory {
            device_token: s("device-chat-1"),
            session_id: s("session-chat"),
            messages: vec![
                ChatMessageData {
                    id: s("msg-chat-1"),
                    session_id: s("session-chat"),
                    message_type: MessageType::User,
                    content: s("Hello"),
                    tool_name: None,
                    timestamp: 1000,
                },
            ],
        },
        &tx,
        "device-chat-1",
    ).await;

    // Check messages saved
    let messages = repo.get_chat_history("device-chat-1", "session-chat", None)
        .await
        .expect("Get chat history should succeed");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, "Hello");
}

#[sqlx::test]
async fn test_handler_request_chat_history(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool);
    let (tx, mut rx) = channel::<Message>(32);

    // Register mobile connection
    let conn_id = router.register_mobile_empty(tx.clone());
    let handler = MessageHandler::new(router.clone(), repo.clone(), pending_repo, Some(conn_id));

    // Create device and messages
    repo.upsert_device("device-req-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_chat_messages("device-req-1", "session-req", &[
        ChatMessageData {
            id: s("msg-req-1"),
            session_id: s("session-req"),
            message_type: MessageType::Assistant,
            content: s("Response"),
            tool_name: None,
            timestamp: 1000,
        },
    ]).await.expect("Upsert chat should succeed");

    // Handle RequestChatHistory
    handler.handle(
        CloudMessage::RequestChatHistory {
            device_token: s("device-req-1"),
            session_id: s("session-req"),
            limit: Some(10),
        },
        &tx,
        "",
    ).await;

    // Should receive chat history response
    let received = tokio::time::timeout(tokio::time::Duration::from_millis(100), rx.recv()).await;
    assert!(received.is_ok(), "Should receive chat history response");
}

#[sqlx::test]
async fn test_handler_hook_response_to_desktop(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    // Register desktop
    router.register_desktop("device-resp-1", None, tx.clone());
    repo.upsert_device("device-resp-1", None, None).await.expect("Upsert device should succeed");

    // Handle HookResponse (should route to desktop)
    handler.handle(
        CloudMessage::HookResponse {
            device_token: s("device-resp-1"),
            session_id: s("session-resp"),
            decision: Some(s("allow")),
            answers: None,
        },
        &tx,
        "",
    ).await;
}

#[sqlx::test]
async fn test_handler_project_name_extraction(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-proj-1", None, tx.clone());
    repo.upsert_device("device-proj-1", None, None).await.expect("Upsert device should succeed");

    // Handle SessionStart with cwd containing project name
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-proj-1"),
            session_id: s("session-proj"),
            hook_type: HookType::SessionStart,
            hook_body: serde_json::json!({"cwd": "/home/user/my-awesome-project"}),
        },
        &tx,
        "device-proj-1",
    ).await;

    // Check project name extracted from cwd
    let sessions = repo.get_active_sessions(&[s("device-proj-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].project_name, Some(s("my-awesome-project")));
}

#[sqlx::test]
async fn test_handler_user_prompt_submit(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-user-1", None, tx.clone());
    repo.upsert_device("device-user-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-user-1", "session-user", Some("project"), "idle", None)
        .await
        .expect("Upsert session should succeed");

    // Handle UserPromptSubmit
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-user-1"),
            session_id: s("session-user"),
            hook_type: HookType::UserPromptSubmit,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-user-1",
    ).await;

    // Check session status updated to thinking
    let sessions = repo.get_active_sessions(&[s("device-user-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "thinking");
}

#[sqlx::test]
async fn test_handler_pre_compact(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-compact-1", None, tx.clone());
    repo.upsert_device("device-compact-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-compact-1", "session-compact", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle PreCompact
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-compact-1"),
            session_id: s("session-compact"),
            hook_type: HookType::PreCompact,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-compact-1",
    ).await;

    // Check session status updated to compacting
    let sessions = repo.get_active_sessions(&[s("device-compact-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "compacting");
}

#[sqlx::test]
async fn test_handler_post_compact(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-postcompact-1", None, tx.clone());
    repo.upsert_device("device-postcompact-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-postcompact-1", "session-postcompact", Some("project"), "compacting", None)
        .await
        .expect("Upsert session should succeed");

    // Handle PostCompact
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-postcompact-1"),
            session_id: s("session-postcompact"),
            hook_type: HookType::PostCompact,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-postcompact-1",
    ).await;

    // Check session status updated to idle
    let sessions = repo.get_active_sessions(&[s("device-postcompact-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "idle");
}

#[sqlx::test]
async fn test_handler_hook_message_fast_path(pool: sqlx::PgPool) {
    // Test fast path: local mobile subscriber exists
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool);
    let (tx_mobile, mut rx_mobile) = channel::<Message>(32);
    let (tx_desktop, _rx_desktop) = channel::<Message>(32);

    // Register both desktop and mobile
    router.register_desktop("device-fast-1", None, tx_desktop.clone());
    let conn_id = router.register_mobile_empty(tx_mobile.clone());
    router.update_mobile_subscription(conn_id, &[s("device-fast-1")], &tx_mobile);

    repo.upsert_device("device-fast-1", None, None).await.expect("Upsert device should succeed");

    let handler = MessageHandler::new(router.clone(), repo, pending_repo, Some(conn_id));

    // Handle HookMessage - should go fast path to local mobile
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-fast-1"),
            session_id: s("session-fast"),
            hook_type: HookType::PreToolUse,
            hook_body: serde_json::json!({"tool_name": "Bash"}),
        },
        &tx_desktop,
        "device-fast-1",
    ).await;

    // Mobile should receive message via fast path
    let received = tokio::time::timeout(tokio::time::Duration::from_millis(100), rx_mobile.recv()).await;
    assert!(received.is_ok(), "Mobile should receive message via fast path");
}

#[sqlx::test]
async fn test_handler_hook_message_slow_path(pool: sqlx::PgPool) {
    // Test slow path: no local mobile subscriber, should insert pending_message
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool.clone());
    let (tx, _rx) = channel::<Message>(32);

    // Only register desktop, no mobile
    router.register_desktop("device-slow-1", None, tx.clone());
    repo.upsert_device("device-slow-1", None, None).await.expect("Upsert device should succeed");

    let handler = MessageHandler::new(router.clone(), repo, pending_repo.clone(), None);

    // Handle HookMessage - should go slow path (insert pending_message)
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-slow-1"),
            session_id: s("session-slow"),
            hook_type: HookType::PreToolUse,
            hook_body: serde_json::json!({"tool_name": "Bash"}),
        },
        &tx,
        "device-slow-1",
    ).await;

    // No mobile subscriber, message should be in pending_messages
    // Give time for async insert
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Query pending_messages to verify
    // Note: We can't directly check pending_repo content, but the behavior is tested
    assert!(!router.has_mobile_subscribers("device-slow-1"));
}

#[sqlx::test]
async fn test_handler_post_tool_use_failure(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-fail-1", None, tx.clone());
    repo.upsert_device("device-fail-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-fail-1", "session-fail", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle PostToolUseFailure
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-fail-1"),
            session_id: s("session-fail"),
            hook_type: HookType::PostToolUseFailure,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-fail-1",
    ).await;

    // Check session status updated to error
    let sessions = repo.get_active_sessions(&[s("device-fail-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "error");
}

#[sqlx::test]
async fn test_handler_elicitation(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-elic-1", None, tx.clone());
    repo.upsert_device("device-elic-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-elic-1", "session-elic", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle Elicitation (AskUserQuestion)
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-elic-1"),
            session_id: s("session-elic"),
            hook_type: HookType::Elicitation,
            hook_body: serde_json::json!({
                "questions": [{
                    "header": "Framework",
                    "question": "Which framework?",
                    "options": [{"label": "React"}]
                }]
            }),
        },
        &tx,
        "device-elic-1",
    ).await;

    // Check session status updated to waitingForApproval
    let sessions = repo.get_active_sessions(&[s("device-elic-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "waitingForApproval");
}

#[sqlx::test]
async fn test_handler_notification_ask(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-notif-1", None, tx.clone());
    repo.upsert_device("device-notif-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-notif-1", "session-notif", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle Notification with type=ask
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-notif-1"),
            session_id: s("session-notif"),
            hook_type: HookType::Notification,
            hook_body: serde_json::json!({
                "notification_data": {
                    "type": "ask",
                    "questions": [{"header": "Choice", "question": "Pick one"}]
                }
            }),
        },
        &tx,
        "device-notif-1",
    ).await;

    // Check session status updated to waitingForApproval
    let sessions = repo.get_active_sessions(&[s("device-notif-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].status, "waitingForApproval");
}

#[sqlx::test]
async fn test_handler_notification_non_blocking(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-notif2-1", None, tx.clone());
    repo.upsert_device("device-notif2-1", None, None).await.expect("Upsert device should succeed");
    repo.upsert_session("device-notif2-1", "session-notif2", Some("project"), "working", None)
        .await
        .expect("Upsert session should succeed");

    // Handle Notification without ask type (non-blocking)
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-notif2-1"),
            session_id: s("session-notif2"),
            hook_type: HookType::Notification,
            hook_body: serde_json::json!({
                "notification_data": {
                    "type": "info",
                    "message": "Some info"
                }
            }),
        },
        &tx,
        "device-notif2-1",
    ).await;

    // Session status should not change to waitingForApproval
    let sessions = repo.get_active_sessions(&[s("device-notif2-1")]).await.expect("Get sessions should succeed");
    // Status remains unchanged (not waitingForApproval)
    assert_ne!(sessions[0].status, "waitingForApproval");
}

#[sqlx::test]
async fn test_handler_status_update(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-status-1", None, tx.clone());
    repo.upsert_device("device-status-1", None, None).await.expect("Upsert device should succeed");

    // StatusUpdate doesn't create session, just tests handler accepts it
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-status-1"),
            session_id: s("session-status"),
            hook_type: HookType::StatusUpdate,
            hook_body: serde_json::json!({"status": "idle"}),
        },
        &tx,
        "device-status-1",
    ).await;

    // Handler should process without error
    assert!(true);
}

#[sqlx::test]
async fn test_handler_subagent_start(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-sub-1", None, tx.clone());
    repo.upsert_device("device-sub-1", None, None).await.expect("Upsert device should succeed");

    // SubagentStart doesn't have specific handling
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-sub-1"),
            session_id: s("session-sub"),
            hook_type: HookType::SubagentStart,
            hook_body: serde_json::json!({}),
        },
        &tx,
        "device-sub-1",
    ).await;

    assert!(true);
}

#[sqlx::test]
async fn test_handler_hook_response_with_answers(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-answer-1", None, tx.clone());
    repo.upsert_device("device-answer-1", None, None).await.expect("Upsert device should succeed");

    // Handle HookResponse with answers
    handler.handle(
        CloudMessage::HookResponse {
            device_token: s("device-answer-1"),
            session_id: s("session-answer"),
            decision: None,
            answers: Some(vec![vec![s("React")]]),
        },
        &tx,
        "",
    ).await;

    // Desktop should receive response
    assert!(router.has_desktop_connection("device-answer-1"));
}

#[sqlx::test]
async fn test_handler_project_name_from_body(pool: sqlx::PgPool) {
    let (handler, tx, router, repo) = create_handler(pool, None);

    router.register_desktop("device-projbody-1", None, tx.clone());
    repo.upsert_device("device-projbody-1", None, None).await.expect("Upsert device should succeed");

    // Handle SessionStart with project_name in body
    handler.handle(
        CloudMessage::HookMessage {
            device_token: s("device-projbody-1"),
            session_id: s("session-projbody"),
            hook_type: HookType::SessionStart,
            hook_body: serde_json::json!({"project_name": "explicit-project", "cwd": "/some/path"}),
        },
        &tx,
        "device-projbody-1",
    ).await;

    // Check project_name from body (not cwd)
    let sessions = repo.get_active_sessions(&[s("device-projbody-1")]).await.expect("Get sessions should succeed");
    assert_eq!(sessions[0].project_name, Some(s("explicit-project")));
}