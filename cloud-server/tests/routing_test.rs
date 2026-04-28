// Tests for routing decision logic and NotifyPayload

use cc_island_cloud::ws::router::ConnectionRouter;
use cc_island_cloud::db::pending_message::{NotifyPayload, Direction};
use tokio::sync::mpsc::channel;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

fn s(s: &str) -> String { s.to_string() }

#[test]
fn test_notify_payload_serialize() {
    let payload = NotifyPayload {
        device_token: s("device-123"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };
    let json = serde_json::to_string(&payload).unwrap();
    assert!(json.contains("device-123"));
    let parsed: NotifyPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.device_token, "device-123");
}

#[test]
fn test_notify_payload_json_parsing_valid() {
    let json = "{\"device_token\":\"abc123\",\"direction\":\"to_mobile\",\"message_id\":\"550e8400-e29b-41d4-a716-446655440000\"}";
    let payload: NotifyPayload = serde_json::from_str(json).unwrap();
    assert_eq!(payload.device_token, "abc123");
}

#[test]
fn test_notify_payload_json_parsing_invalid() {
    let result: Result<NotifyPayload, _> = serde_json::from_str("not valid json");
    assert!(result.is_err());
}

#[test]
fn test_direction_strings() {
    assert_eq!(Direction::ToMobile.as_str(), "to_mobile");
    assert_eq!(Direction::ToDesktop.as_str(), "to_desktop");
}

#[test]
fn test_routing_decision_local_subscriber() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1")], &tx);
    assert!(router.has_mobile_subscribers("device-1"));
}

#[test]
fn test_routing_decision_no_subscriber() {
    let router = ConnectionRouter::new();
    assert!(!router.has_mobile_subscribers("device-unknown"));
    assert!(!router.has_desktop_connection("device-unknown"));
}

#[tokio::test]
async fn test_message_delivery_to_mobile() {
    let router = ConnectionRouter::new();
    let (tx, mut rx) = channel::<Message>(32);
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1")], &tx);
    router.broadcast_to_mobiles("device-1", Message::text("{\"type\":\"test\"}"));
    let received = tokio::time::timeout(tokio::time::Duration::from_millis(100), rx.recv()).await;
    assert!(received.is_ok());
}

#[tokio::test]
async fn test_message_delivery_to_desktop() {
    let router = ConnectionRouter::new();
    let (tx, mut rx) = channel::<Message>(32);
    router.register_desktop("device-1", None, tx);
    let sent = router.send_to_desktop("device-1", Message::text("{\"type\":\"test\"}"));
    assert!(sent);
    let received = tokio::time::timeout(tokio::time::Duration::from_millis(100), rx.recv()).await;
    assert!(received.is_ok());
}

#[tokio::test]
async fn test_message_delivery_no_target() {
    let router = ConnectionRouter::new();
    let sent = router.send_to_desktop("device-unknown", Message::text("{\"type\":\"test\"}"));
    assert!(!sent);
}