// Unit tests for ConnectionRouter
// Tests local connection state management

use cc_island_cloud::ws::router::ConnectionRouter;
use tokio::sync::mpsc::channel;
use tokio_tungstenite::tungstenite::protocol::Message;

#[test]
fn test_router_new() {
    let router = ConnectionRouter::new();
    assert!(!router.has_desktop_connection("any-device"));
    assert!(!router.has_mobile_subscribers("any-device"));
}

#[test]
fn test_register_desktop() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    router.register_desktop("device-1", Some("hostname-1".to_string()), tx);
    assert!(router.has_desktop_connection("device-1"));
    assert!(!router.has_desktop_connection("device-2"));
}

#[test]
fn test_unregister_desktop() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    router.register_desktop("device-1", None, tx);
    assert!(router.has_desktop_connection("device-1"));
    router.unregister_desktop("device-1");
    assert!(!router.has_desktop_connection("device-1"));
}

#[test]
fn test_register_mobile_empty() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    let _conn_id = router.register_mobile_empty(tx);
    assert!(!router.has_mobile_subscribers("device-1"));
}

#[test]
fn test_update_mobile_subscription() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1"), s("device-2")], &tx);
    assert!(router.has_mobile_subscribers("device-1"));
    assert!(router.has_mobile_subscribers("device-2"));
}

#[test]
fn test_update_mobile_subscription_replace() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1")], &tx);
    assert!(router.has_mobile_subscribers("device-1"));
    router.update_mobile_subscription(conn_id, &[s("device-2")], &tx);
    assert!(!router.has_mobile_subscribers("device-1"));
    assert!(router.has_mobile_subscribers("device-2"));
}

#[test]
fn test_unregister_mobile() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    let conn_id = router.register_mobile_empty(tx.clone());
    router.update_mobile_subscription(conn_id, &[s("device-1")], &tx);
    assert!(router.has_mobile_subscribers("device-1"));
    router.unregister_mobile(conn_id);
    assert!(!router.has_mobile_subscribers("device-1"));
}

#[test]
fn test_multiple_mobile_subscribers() {
    let router = ConnectionRouter::new();
    let (tx1, _rx1) = channel::<Message>(32);
    let (tx2, _rx2) = channel::<Message>(32);
    let conn_id1 = router.register_mobile_empty(tx1.clone());
    let conn_id2 = router.register_mobile_empty(tx2.clone());
    router.update_mobile_subscription(conn_id1, &[s("device-1")], &tx1);
    router.update_mobile_subscription(conn_id2, &[s("device-1")], &tx2);
    assert!(router.has_mobile_subscribers("device-1"));
    router.unregister_mobile(conn_id1);
    assert!(router.has_mobile_subscribers("device-1"));
    router.unregister_mobile(conn_id2);
    assert!(!router.has_mobile_subscribers("device-1"));
}

#[test]
fn test_get_online_devices_info() {
    let router = ConnectionRouter::new();
    let (tx, _rx) = channel::<Message>(32);
    router.register_desktop("device-1", Some(s("host1")), tx.clone());
    router.register_desktop("device-2", Some(s("host2")), tx);
    let devices = router.get_online_devices_info();
    assert_eq!(devices.len(), 2);
}

fn s(s: &str) -> String { s.to_string() }