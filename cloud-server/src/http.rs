// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use axum::{
    extract::Path,
    routing::get,
    Json, Router,
    extract::Query,
    http::HeaderMap,
};
use crate::db::repository::Repository;
use crate::ws::router::ConnectionRouter;
use crate::apm::query::{QueryApi, QueryParams, QueryResponse};
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfoResponse {
    pub device_token: String,
    pub session_id: String,
    pub project_name: Option<String>,
    pub status: String,
    pub current_tool: Option<String>,
}

/// Create HTTP router for API endpoints
pub fn create_http_router(
    repo: Repository,
    router: ConnectionRouter,
    query_api: QueryApi,
) -> Router {
    Router::new()
        .route("/api/devices", get(get_devices))
        .route("/api/sessions/:device_token", get(get_sessions))
        .route("/api/debug/sessions", get(get_all_sessions))
        .route("/api/apm/query", get(apm_query))
        .with_state((repo, router, query_api))
}

/// Get all online devices
async fn get_devices(
    axum::extract::State((_repo, router, _query_api)): axum::extract::State<(Repository, ConnectionRouter, QueryApi)>,
) -> Json<Vec<crate::messages::DeviceInfo>> {
    Json(router.get_online_devices_info())
}

/// Get sessions for a device
async fn get_sessions(
    axum::extract::State((repo, _router, _query_api)): axum::extract::State<(Repository, ConnectionRouter, QueryApi)>,
    Path(device_token): Path<String>,
) -> Json<Vec<SessionInfoResponse>> {
    match repo.get_active_sessions(&[device_token]).await {
        Ok(sessions) => {
            let result = sessions.into_iter().map(|s| SessionInfoResponse {
                device_token: s.device_token,
                session_id: s.session_id,
                project_name: s.project_name,
                status: s.status,
                current_tool: s.current_tool,
            }).collect();
            Json(result)
        }
        Err(_) => Json(vec![]),
    }
}

/// Get all sessions (debug)
async fn get_all_sessions(
    axum::extract::State((repo, _router, _query_api)): axum::extract::State<(Repository, ConnectionRouter, QueryApi)>,
) -> Json<Vec<SessionInfoResponse>> {
    // Get all sessions from online devices
    let devices = repo.get_online_devices().await.unwrap_or_default();
    let device_tokens: Vec<String> = devices.iter().map(|d| d.token.clone()).collect();

    match repo.get_active_sessions(&device_tokens).await {
        Ok(sessions) => {
            let result = sessions.into_iter().map(|s| SessionInfoResponse {
                device_token: s.device_token,
                session_id: s.session_id,
                project_name: s.project_name,
                status: s.status,
                current_tool: s.current_tool,
            }).collect();
            Json(result)
        }
        Err(_) => Json(vec![]),
    }
}

/// APM query endpoint
async fn apm_query(
    axum::extract::State((_repo, _router, query_api)): axum::extract::State<(Repository, ConnectionRouter, QueryApi)>,
    Query(params): Query<QueryParams>,
    headers: HeaderMap,
) -> Json<QueryResponse> {
    // Get tenant_id from X-User-ID header, fallback to device_token
    let tenant_id = headers.get("X-User-ID")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    query_api.query(params, tenant_id).await
}