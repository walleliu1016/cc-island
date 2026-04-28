// Tests for HTTP API endpoint types

use cc_island_cloud::http::{SessionInfoResponse, create_http_router};
use cc_island_cloud::db::repository::Repository;
use cc_island_cloud::ws::router::ConnectionRouter;

fn s(s: &str) -> String { s.to_string() }

#[sqlx::test]
async fn test_create_http_router(pool: sqlx::PgPool) {
    let repo = Repository::new(pool.clone());
    let router = ConnectionRouter::new();

    // Verify router creation works
    let _app = create_http_router(repo, router);
}

#[test]
fn test_session_info_response_serialize() {
    let response = SessionInfoResponse {
        device_token: s("device-1"),
        session_id: s("session-1"),
        project_name: Some(s("my-project")),
        status: s("working"),
        current_tool: Some(s("Bash")),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("device-1"));
    assert!(json.contains("session-1"));
    assert!(json.contains("my-project"));
    assert!(json.contains("working"));
    assert!(json.contains("Bash"));
}

#[test]
fn test_session_info_response_deserialize() {
    let json = "{\"device_token\":\"d1\",\"session_id\":\"s1\",\"project_name\":\"p1\",\"status\":\"idle\",\"current_tool\":null}";
    let response: SessionInfoResponse = serde_json::from_str(json).unwrap();

    assert_eq!(response.device_token, "d1");
    assert_eq!(response.session_id, "s1");
    assert_eq!(response.project_name, Some(s("p1")));
    assert_eq!(response.status, "idle");
    assert_eq!(response.current_tool, None);
}

#[test]
fn test_session_info_response_no_project() {
    let response = SessionInfoResponse {
        device_token: s("d"),
        session_id: s("s"),
        project_name: None,
        status: s("idle"),
        current_tool: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("null"));
}

#[test]
fn test_session_info_response_no_tool() {
    let response = SessionInfoResponse {
        device_token: s("d"),
        session_id: s("s"),
        project_name: Some(s("p")),
        status: s("working"),
        current_tool: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    let parsed: SessionInfoResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.current_tool, None);
}

#[test]
fn test_session_info_response_working_status() {
    let response = SessionInfoResponse {
        device_token: s("d"),
        session_id: s("s"),
        project_name: Some(s("project")),
        status: s("working"),
        current_tool: Some(s("Read")),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("working"));
    assert!(json.contains("Read"));
}

#[test]
fn test_session_info_response_waiting_status() {
    let response = SessionInfoResponse {
        device_token: s("d"),
        session_id: s("s"),
        project_name: Some(s("project")),
        status: s("waiting"),
        current_tool: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("waiting"));
}

#[test]
fn test_session_info_response_compacting_status() {
    let response = SessionInfoResponse {
        device_token: s("d"),
        session_id: s("s"),
        project_name: Some(s("project")),
        status: s("compacting"),
        current_tool: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("compacting"));
}

#[test]
fn test_session_info_response_waiting_for_approval() {
    let response = SessionInfoResponse {
        device_token: s("d"),
        session_id: s("s"),
        project_name: Some(s("project")),
        status: s("waitingForApproval"),
        current_tool: Some(s("Bash")),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("waitingForApproval"));
}