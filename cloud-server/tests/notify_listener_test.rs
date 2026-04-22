// Tests for NotifyListener logic (parse and routing)

use cc_island_cloud::db::pending_message::NotifyPayload;
use cc_island_cloud::ws::router::ConnectionRouter;
use cc_island_cloud::ws::notify_listener::NotifyListener;
use tokio::sync::mpsc::channel;
use tokio_tungstenite::tungstenite::protocol::Message;
use uuid::Uuid;

fn s(s: &str) -> String { s.to_string() }

#[test]
fn test_notify_payload_parse_valid() {
    let payload = "{\"device_token\":\"device-1\",\"direction\":\"to_mobile\",\"message_id\":\"550e8400-e29b-41d4-a716-446655440000\"}";
    let notify_data: NotifyPayload = serde_json::from_str(payload).unwrap();

    assert_eq!(notify_data.device_token, "device-1");
    assert_eq!(notify_data.direction, "to_mobile");
    assert_eq!(notify_data.message_id, Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap());
}

#[test]
fn test_notify_payload_parse_invalid_json() {
    let payload = "not valid json";
    let result: Result<NotifyPayload, _> = serde_json::from_str(payload);
    assert!(result.is_err());
}

#[test]
fn test_notify_payload_parse_missing_field() {
    let payload = "{\"device_token\":\"device-1\"}";
    let result: Result<NotifyPayload, _> = serde_json::from_str(payload);
    assert!(result.is_err());
}

#[test]
fn test_routing_decision_from_notify() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);

    // Register mobile for device-1
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1")], &tx);

    // Simulate NOTIFY payload - should route to mobile
    let notify_data = NotifyPayload {
        device_token: s("device-1"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };

    // Check routing decision
    assert!(router.has_mobile_subscribers(&notify_data.device_token));
}

#[test]
fn test_routing_decision_no_match() {
    let router = ConnectionRouter::new();

    let notify_data = NotifyPayload {
        device_token: s("device-unknown"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };

    // No mobile subscriber -> should skip
    assert!(!router.has_mobile_subscribers(&notify_data.device_token));
}

#[test]
fn test_routing_to_desktop_connected() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);

    // Register desktop
    router.register_desktop("device-2", None, tx);

    let notify_data = NotifyPayload {
        device_token: s("device-2"),
        direction: s("to_desktop"),
        message_id: Uuid::new_v4(),
    };

    assert!(router.has_desktop_connection(&notify_data.device_token));
}

#[test]
fn test_notify_payload_all_fields() {
    let payload = NotifyPayload {
        device_token: s("test-device"),
        direction: s("to_desktop"),
        message_id: Uuid::new_v4(),
    };

    let json = serde_json::to_string(&payload).unwrap();
    let parsed: NotifyPayload = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.device_token, "test-device");
    assert_eq!(parsed.direction, "to_desktop");
}

#[test]
fn test_notify_direction_variants() {
    // to_mobile direction
    let payload1 = NotifyPayload {
        device_token: s("d1"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };
    assert_eq!(payload1.direction, "to_mobile");

    // to_desktop direction
    let payload2 = NotifyPayload {
        device_token: s("d2"),
        direction: s("to_desktop"),
        message_id: Uuid::new_v4(),
    };
    assert_eq!(payload2.direction, "to_desktop");
}