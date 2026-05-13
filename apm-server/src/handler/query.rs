// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Query proxy handler
//!
//! Proxies SQL queries to GreptimeDB with automatic tenant filtering

use axum::{
    extract::{State, Query},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::debug;

use crate::greptime::GreptimeDBClient;

#[derive(Debug, Deserialize)]
pub struct QueryParams {
    pub sql: String,
}

/// Handle GET /api/query?sql=...
pub async fn handle_query(
    State(state): State<crate::handler::AppState>,
    headers: HeaderMap,
    Query(params): Query<QueryParams>,
) -> Json<Value> {
    // Extract tenant info from headers
    let user_id = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    debug!("Query from user {}: {}", user_id, params.sql);

    // Auto-inject tenant filter
    let filtered_sql = inject_tenant_filter(&params.sql, user_id);

    // Query GreptimeDB
    let greptimedb = state.greptimedb.clone();
    let result = greptimedb.query(&filtered_sql).await;

    match result {
        Ok(data) => Json(data),
        Err(e) => Json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

/// Inject tenant filter into SQL query
///
/// Automatically adds "user_id = 'xxx'" filter to WHERE clause
fn inject_tenant_filter(sql: &str, user_id: &str) -> String {
    // Simple injection: add user_id filter to WHERE clause
    // This is a simplified implementation; production code should use proper SQL parsing

    let user_filter = format!("user_id = '{}'", user_id.replace("'", "''"));

    if sql.contains("WHERE") {
        // Add to existing WHERE clause
        sql.replace("WHERE", &format!("WHERE {} AND ", user_filter))
    } else {
        // Add new WHERE clause before ORDER BY, GROUP BY, LIMIT, etc.
        let mut result = sql.to_string();

        // Find position to insert WHERE
        let keywords = ["ORDER BY", "GROUP BY", "LIMIT", "OFFSET", ";"];
        for keyword in keywords {
            if result.contains(keyword) {
                result = result.replace(keyword, &format!("WHERE {} {}", user_filter, keyword));
                return result;
            }
        }

        // No terminating keyword, append WHERE at end
        result.push_str(&format!(" WHERE {}", user_filter));
        result
    }
}