// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! API handlers
//!
//! Endpoints:
//! - POST /api/hooks  - Hook events from Desktop
//! - GET  /api/query  - SQL query proxy
//! - GET  /api/stream - SSE real-time stream
//! - POST /v1/traces  - OTLP traces receiver

mod hooks;
mod query;
mod sse;
mod otlp;

pub use hooks::*;
pub use query::*;
pub use sse::*;
pub use otlp::*;

use axum::{
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use std::sync::Arc;

use crate::{config::Config, greptime::GreptimeDBClient};

/// Create router with all handlers
pub fn create_router(greptimedb: Arc<GreptimeDBClient>, config: Config) -> Router {
    Router::new()
        // Hook events
        .route("/api/hooks", post(handle_hooks))

        // Query proxy
        .route("/api/query", get(handle_query))

        // SSE stream
        .route("/api/stream", get(handle_sse))

        // OTLP endpoints
        .route("/v1/traces", post(handle_traces))
        .route("/v1/metrics", post(handle_metrics))

        // CORS for frontend
        .layer(CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any))

        // Shared state
        .with_state(AppState {
            greptimedb,
            config,
        })
}

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub greptimedb: Arc<GreptimeDBClient>,
    pub config: Config,
}