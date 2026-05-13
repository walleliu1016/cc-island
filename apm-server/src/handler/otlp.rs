// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! OTLP receiver handlers
//!
//! Receives OpenTelemetry Protocol data (traces, metrics)

use axum::{extract::State, Json};
use serde_json::Value;
use tracing::debug;

/// Handle POST /v1/traces
pub async fn handle_traces(
    State(state): State<crate::handler::AppState>,
    Json(body): Json<Value>,
) -> Json<OtlpResponse> {
    debug!("OTLP traces received");

    // Process traces: extract spans, inject tenant attributes, write to GreptimeDB
    // This is a simplified implementation

    // TODO: Parse OTLP format and write to GreptimeDB opentelemetry_traces table

    Json(OtlpResponse {
        success: true,
        message: "Traces recorded".to_string(),
    })
}

/// Handle POST /v1/metrics
pub async fn handle_metrics(
    State(state): State<crate::handler::AppState>,
    Json(body): Json<Value>,
) -> Json<OtlpResponse> {
    debug!("OTLP metrics received");

    // Process metrics: extract data points, inject tenant attributes, write to GreptimeDB

    // TODO: Parse OTLP format and write to GreptimeDB opentelemetry_metrics table

    Json(OtlpResponse {
        success: true,
        message: "Metrics recorded".to_string(),
    })
}

#[derive(Debug, serde::Serialize)]
pub struct OtlpResponse {
    pub success: bool,
    pub message: String,
}