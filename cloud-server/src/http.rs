// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use axum::{
    extract::Path,
    routing::get,
    Json, Router,
};
use crate::db::repository::Repository;
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
pub fn create_http_router(repo: Repository) -> Router {
    Router::new()
        .route("/api/devices", get(get_devices))
        .route("/api/sessions/:device_token", get(get_sessions))
        .route("/api/debug/sessions", get(get_all_sessions))
        .with_state(repo)
}

/// Get all online devices
async fn get_devices(
    axum::extract::State(repo): axum::extract::State<Repository>,
) -> Json<Vec<crate::messages::DeviceInfo>> {
    Json(repo.get_online_devices().await.unwrap_or_default())
}

/// Get sessions for a device
async fn get_sessions(
    axum::extract::State(repo): axum::extract::State<Repository>,
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
    axum::extract::State(repo): axum::extract::State<Repository>,
) -> Json<Vec<SessionInfoResponse>> {
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
