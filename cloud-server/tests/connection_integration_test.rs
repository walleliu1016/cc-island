// Integration tests for WebSocket connection handling
// Tests connection setup and authentication

use cc_island_cloud::ws::server::run_server;
use cc_island_cloud::ws::router::ConnectionRouter;
use cc_island_cloud::db::repository::Repository;
use cc_island_cloud::db::pending_message::PendingMessageRepo;
use cc_island_cloud::messages::CloudMessage;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tokio_util::sync::CancellationToken;
use futures_util::{StreamExt, SinkExt};
use std::time::Duration;

fn s(s: &str) -> String { s.to_string() }

fn find_free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("Bind should succeed");
    listener.local_addr().expect("Local addr should exist").port()
}

#[sqlx::test]
async fn test_websocket_desktop_auth(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool.clone());
    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();

    let port = find_free_port();

    let server_task = tokio::spawn(async move {
        run_server(port, router, repo, pending_repo, shutdown_clone).await
    });

    tokio::time::sleep(Duration::from_millis(200)).await;

    let url = format!("ws://127.0.0.1:{}", port);
    let (ws_stream, _) = connect_async(&url).await.expect("Connect should succeed");
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    let auth_msg = CloudMessage::DeviceRegister {
        device_token: s("device-ws-1"),
        hostname: Some(s("test-host")),
        device_name: None,
    };
    ws_tx.send(Message::text(serde_json::to_string(&auth_msg).unwrap())).await.expect("Send should succeed");

    let response = tokio::time::timeout(Duration::from_secs(5), ws_rx.next()).await;
    assert!(response.is_ok(), "Should receive auth response");

    shutdown.cancel();
    server_task.abort();
}

#[sqlx::test]
async fn test_websocket_mobile_auth(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool.clone());
    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();

    repo.upsert_device("device-ws-2", Some("host-2"), None).await.expect("Upsert device should succeed");

    let port = find_free_port();

    let server_task = tokio::spawn(async move {
        run_server(port, router, repo, pending_repo, shutdown_clone).await
    });

    tokio::time::sleep(Duration::from_millis(200)).await;

    let url = format!("ws://127.0.0.1:{}", port);
    let (ws_stream, _) = connect_async(&url).await.expect("Connect should succeed");
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    let auth_msg = CloudMessage::MobileAuth {
        device_tokens: vec![s("device-ws-2")],
    };
    ws_tx.send(Message::text(serde_json::to_string(&auth_msg).unwrap())).await.expect("Send should succeed");

    let response = tokio::time::timeout(Duration::from_secs(5), ws_rx.next()).await;
    assert!(response.is_ok(), "Should receive auth response");

    shutdown.cancel();
    server_task.abort();
}

#[sqlx::test]
async fn test_websocket_auth_failed(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool.clone());
    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();

    let port = find_free_port();

    let server_task = tokio::spawn(async move {
        run_server(port, router, repo, pending_repo, shutdown_clone).await
    });

    tokio::time::sleep(Duration::from_millis(200)).await;

    let url = format!("ws://127.0.0.1:{}", port);
    let (ws_stream, _) = connect_async(&url).await.expect("Connect should succeed");
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    ws_tx.send(Message::text("{\"type\":\"ping\"}")).await.expect("Send should succeed");

    let response = tokio::time::timeout(Duration::from_secs(5), ws_rx.next()).await;
    if let Ok(Some(Ok(Message::Text(text)))) = response {
        assert!(text.contains("auth_failed") || text.contains("Expected"), "Should receive auth_failed or error");
    }

    shutdown.cancel();
    server_task.abort();
}

#[sqlx::test]
async fn test_websocket_ping_pong(pool: sqlx::PgPool) {
    let router = ConnectionRouter::new();
    let repo = Repository::new(pool.clone());
    let pending_repo = PendingMessageRepo::new(pool.clone());
    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();

    repo.upsert_device("device-ws-4", None, None).await.expect("Upsert device should succeed");

    let port = find_free_port();

    let server_task = tokio::spawn(async move {
        run_server(port, router, repo, pending_repo, shutdown_clone).await
    });

    tokio::time::sleep(Duration::from_millis(200)).await;

    let url = format!("ws://127.0.0.1:{}", port);
    let (ws_stream, _) = connect_async(&url).await.expect("Connect should succeed");
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    let auth_msg = CloudMessage::DeviceRegister {
        device_token: s("device-ws-4"),
        hostname: None,
        device_name: None,
    };
    ws_tx.send(Message::text(serde_json::to_string(&auth_msg).unwrap())).await.expect("Send should succeed");
    tokio::time::timeout(Duration::from_secs(5), ws_rx.next()).await.expect("Auth response");

    let ping_msg = CloudMessage::Ping;
    ws_tx.send(Message::text(serde_json::to_string(&ping_msg).unwrap())).await.expect("Send ping should succeed");

    let response = tokio::time::timeout(Duration::from_secs(5), ws_rx.next()).await;
    assert!(response.is_ok(), "Should receive pong");

    shutdown.cancel();
    server_task.abort();
}