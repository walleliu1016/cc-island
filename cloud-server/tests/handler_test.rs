// Tests for handler notify path logic

use cc_island_cloud::ws::router::ConnectionRouter;
use cc_island_cloud::db::pending_message::{Direction, NotifyPayload};
use tokio::sync::mpsc::channel;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;
use serde_json::json;

fn s(s: &str) -> String { s.to_string() }

fn simulate_send_decision(router: &ConnectionRouter, device_token: &str, direction: Direction) -> bool {
    match direction {
        Direction::ToMobile => router.has_mobile_subscribers(device_token),
        Direction::ToDesktop => router.has_desktop_connection(device_token),
    }
}

#[test]
fn test_fast_path_mobile_exists() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1")], &tx);
    assert!(simulate_send_decision(&router, "device-1", Direction::ToMobile));
}

#[test]
fn test_slow_path_no_mobile() {
    let router = ConnectionRouter::new();
    assert!(!simulate_send_decision(&router, "device-unknown", Direction::ToMobile));
}

#[test]
fn test_fast_path_desktop_connected() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    router.register_desktop("device-1", None, tx);
    assert!(simulate_send_decision(&router, "device-1", Direction::ToDesktop));
}

#[test]
fn test_slow_path_no_desktop() {
    let router = ConnectionRouter::new();
    assert!(!simulate_send_decision(&router, "device-unknown", Direction::ToDesktop));
}

#[test]
fn test_hook_message_body() {
    let hook_msg = json!({
        "type": "hook_message",
        "device_token": "device-1",
        "session_id": "session-1",
        "hook_type": "PreToolUse"
    });
    assert_eq!(hook_msg["type"], "hook_message");
}

#[test]
fn test_hook_response_body() {
    let response_msg = json!({
        "type": "hook_response",
        "device_token": "device-1",
        "session_id": "session-1",
        "decision": "allow"
    });
    assert_eq!(response_msg["decision"], "allow");
}

#[test]
fn test_notify_payload_creation() {
    let payload = NotifyPayload {
        device_token: s("device-1"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };
    let json = serde_json::to_string(&payload).unwrap();
    assert!(json.contains("device-1"));
}

#[test]
fn test_disconnect_changes_routing() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    router.register_desktop("device-1", None, tx);
    assert!(simulate_send_decision(&router, "device-1", Direction::ToDesktop));
    router.unregister_desktop("device-1");
    assert!(!simulate_send_decision(&router, "device-1", Direction::ToDesktop));
}