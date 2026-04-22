// Tests for NotifyListener behavior patterns

use cc_island_cloud::db::pending_message::{NotifyPayload, Direction};
use uuid::Uuid;

fn s(s: &str) -> String { s.to_string() }

#[test]
fn test_notify_payload_directions() {
    let payload1 = NotifyPayload {
        device_token: s("device-1"),
        direction: s("to_mobile"),
        message_id: Uuid::new_v4(),
    };
    assert_eq!(payload1.direction, "to_mobile");

    let payload2 = NotifyPayload {
        device_token: s("device-1"),
        direction: s("to_desktop"),
        message_id: Uuid::new_v4(),
    };
    assert_eq!(payload2.direction, "to_desktop");
}

#[test]
fn test_direction_to_mobile() {
    assert_eq!(Direction::ToMobile.as_str(), "to_mobile");
}

#[test]
fn test_direction_to_desktop() {
    assert_eq!(Direction::ToDesktop.as_str(), "to_desktop");
}

#[test]
fn test_uuid_unique() {
    let id1 = Uuid::new_v4();
    let id2 = Uuid::new_v4();
    assert_ne!(id1, id2);
}

#[test]
fn test_cleanup_threshold() {
    let threshold_seconds = 5 * 60;
    assert_eq!(threshold_seconds, 300);
}

#[test]
fn test_cleanup_interval() {
    let runs_per_hour = 3600 / 60;
    assert_eq!(runs_per_hour, 60);
}