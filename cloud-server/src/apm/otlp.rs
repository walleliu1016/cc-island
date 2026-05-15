// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

//! OTLP (OpenTelemetry Protocol) handler for receiving traces, metrics, and logs.
//!
//! This endpoint receives protobuf-encoded OTLP data on `/v1/otlp`.
//! Currently a placeholder that logs received data.

use axum::{
    body::Body,
    http::StatusCode,
    response::IntoResponse,
};

/// Handle OTLP protobuf data (traces/metrics/logs)
///
/// Receives OTLP protobuf data and returns success.
/// TODO: Parse protobuf using opentelemetry-proto crate and write to storage.
pub async fn handle_otlp(body: Body) -> impl IntoResponse {
    let bytes = match axum::body::to_bytes(body, 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::error!("Failed to read OTLP body: {}", e);
            return (StatusCode::BAD_REQUEST, "Failed to read request body");
        }
    };

    // Parse protobuf (traces/metrics/logs)
    // For now, just log and return success
    tracing::info!("OTLP data received: {} bytes", bytes.len());

    // TODO: Parse protobuf and write to traces/metrics/logs tables
    // This requires opentelemetry-proto crate:
    // use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
    // use opentelemetry_proto::tonic::collector::metrics::v1::ExportMetricsServiceRequest;
    // use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;

    (StatusCode::OK, "OK")
}