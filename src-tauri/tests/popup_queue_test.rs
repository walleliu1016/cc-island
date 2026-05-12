// Tests for popup_queue module

use cc_island_lib::popup_queue::{PopupQueue, PopupItem, PopupType, PopupStatus, PopupResponse};
use tokio::sync::oneshot;

fn create_test_popup(id: &str, session_id: &str) -> PopupItem {
    PopupItem {
        id: id.to_string(),
        session_id: session_id.to_string(),
        project_name: "test-project".to_string(),
        popup_type: PopupType::Permission,
        permission_data: None,
        ask_data: None,
        notification_data: None,
        status: PopupStatus::Pending,
        created_at: 1000,
        auto_close_at: None,
        timeout_at: None,
    }
}

#[test]
fn test_popup_queue_new() {
    let queue = PopupQueue::new();
    assert_eq!(queue.count_pending(), 0);
}

#[test]
fn test_popup_queue_add() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));

    assert_eq!(queue.count_pending(), 1);
    assert!(queue.get("popup-1").is_some());
}

#[test]
fn test_popup_queue_add_multiple() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));
    queue.add(create_test_popup("popup-2", "session-1"));
    queue.add(create_test_popup("popup-3", "session-2"));

    assert_eq!(queue.count_pending(), 3);
    assert_eq!(queue.get_pending().len(), 3);
}

#[test]
fn test_popup_queue_remove() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));
    queue.add(create_test_popup("popup-2", "session-1"));

    queue.remove("popup-1");

    assert_eq!(queue.count_pending(), 1);
    assert!(queue.get("popup-1").is_none());
    assert!(queue.get("popup-2").is_some());
}

#[test]
fn test_popup_queue_get_pending() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));

    let pending = queue.get_pending();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, "popup-1");
}

#[test]
fn test_popup_queue_get_displayed_limit() {
    let mut queue = PopupQueue::new();
    for i in 0..10 {
        queue.add(create_test_popup(&format!("popup-{}", i), "session-1"));
    }

    // max_displayed is 5
    let displayed = queue.get_displayed();
    assert_eq!(displayed.len(), 5);
}

#[test]
fn test_popup_queue_get_all() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));
    queue.add(create_test_popup("popup-2", "session-2"));

    let all = queue.get_all();
    assert_eq!(all.len(), 2);
}

#[test]
fn test_popup_queue_find_by_session() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));
    queue.add(create_test_popup("popup-2", "session-2"));

    let found = queue.find_popup_by_session("session-1");
    assert!(found.is_some());
    assert_eq!(found.unwrap(), "popup-1");

    let not_found = queue.find_popup_by_session("session-3");
    assert!(not_found.is_none());
}

#[test]
fn test_popup_queue_cancel_session_popups() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));
    queue.add(create_test_popup("popup-2", "session-1"));
    queue.add(create_test_popup("popup-3", "session-2"));

    let cancelled = queue.cancel_session_popups("session-1");

    assert_eq!(cancelled.len(), 2);
    assert!(cancelled.contains(&"popup-1".to_string()));
    assert!(cancelled.contains(&"popup-2".to_string()));

    // popup-1 and popup-2 should be resolved
    assert_eq!(queue.get("popup-1").unwrap().status, PopupStatus::Resolved);
    assert_eq!(queue.get("popup-2").unwrap().status, PopupStatus::Resolved);

    // popup-3 should still be pending
    assert_eq!(queue.get("popup-3").unwrap().status, PopupStatus::Pending);
}

#[test]
fn test_popup_type_display() {
    assert_eq!(PopupType::Permission.to_string(), "permission");
    assert_eq!(PopupType::Ask.to_string(), "ask");
    assert_eq!(PopupType::Notification.to_string(), "notification");
}

#[test]
fn test_popup_status_display() {
    assert_eq!(PopupStatus::Pending.to_string(), "pending");
    assert_eq!(PopupStatus::Processing.to_string(), "processing");
    assert_eq!(PopupStatus::Resolved.to_string(), "resolved");
    assert_eq!(PopupStatus::AutoClose.to_string(), "autoclose");
}

#[test]
fn test_popup_item_serialization() {
    let popup = create_test_popup("popup-1", "session-1");
    let json = serde_json::to_string(&popup).unwrap();
    assert!(json.contains("popup-1"));
    assert!(json.contains("permission"));

    let parsed: PopupItem = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "popup-1");
    assert_eq!(parsed.popup_type, PopupType::Permission);
}

#[test]
fn test_popup_response_serialization() {
    let response = PopupResponse {
        popup_id: "popup-1".to_string(),
        decision: Some("allow".to_string()),
        answer: None,
        answers: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("allow"));

    let parsed: PopupResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.decision, Some("allow".to_string()));
}

// ===== Tests for waiter/resolver functionality =====

#[tokio::test]
async fn test_popup_queue_register_waiter_and_resolve() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));

    // Register waiter
    let (tx, rx) = oneshot::channel::<PopupResponse>();
    queue.register_waiter("popup-1".to_string(), tx, 300);

    // Resolve the popup
    let response = PopupResponse {
        popup_id: "popup-1".to_string(),
        decision: Some("allow".to_string()),
        answer: None,
        answers: None,
    };

    let resolved = queue.resolve(response);
    assert!(resolved, "resolve should return true when waiter exists");

    // Receive the response
    let received = rx.await.expect("Should receive response");
    assert_eq!(received.decision, Some("allow".to_string()));

    // Popup should be resolved
    assert_eq!(queue.get("popup-1").unwrap().status, PopupStatus::Resolved);
}

#[tokio::test]
async fn test_popup_queue_resolve_nonexistent_waiter() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));

    // No waiter registered
    let response = PopupResponse {
        popup_id: "popup-1".to_string(),
        decision: Some("allow".to_string()),
        answer: None,
        answers: None,
    };

    let resolved = queue.resolve(response);
    assert!(!resolved, "resolve should return false when no waiter exists");
}

#[tokio::test]
async fn test_popup_queue_cancel_with_waiter() {
    let mut queue = PopupQueue::new();
    queue.add(create_test_popup("popup-1", "session-1"));

    // Register waiter
    let (tx, rx) = oneshot::channel::<PopupResponse>();
    queue.register_waiter("popup-1".to_string(), tx, 300);

    // Cancel session popups
    let cancelled = queue.cancel_session_popups("session-1");
    assert_eq!(cancelled.len(), 1);

    // Receive auto-deny response
    let received = rx.await.expect("Should receive auto-deny response");
    assert_eq!(received.decision, Some("deny".to_string()));
}