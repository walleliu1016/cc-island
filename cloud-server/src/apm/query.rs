// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

use axum::Json;
use serde::{Deserialize, Serialize};
use crate::db::greptime::{GreptimeClient, Value};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct QueryParams {
    sql: String,
}

#[derive(Debug, Serialize)]
pub struct QueryResponse {
    rows: Vec<Vec<serde_json::Value>>,
    columns: Vec<String>,
}

pub struct QueryApi {
    client: Arc<GreptimeClient>,
}

impl QueryApi {
    pub fn new(client: GreptimeClient) -> Self {
        Self {
            client: Arc::new(client),
        }
    }

    /// Query with tenant filter injection
    pub async fn query(&self, params: QueryParams, tenant_id: &str) -> Json<QueryResponse> {
        // Inject tenant_id filter (safety: prepend WHERE clause)
        let sql = inject_tenant_filter(&params.sql, tenant_id);

        match self.client.query(&sql).await {
            Ok(result) => {
                let columns = result
                    .output
                    .first()
                    .map(|o| {
                        o.records
                            .schema
                            .column_schemas
                            .iter()
                            .map(|c| c.name.clone())
                            .collect()
                    })
                    .unwrap_or_default();

                let rows = result
                    .output
                    .first()
                    .map(|o| {
                        o.records
                            .rows
                            .iter()
                            .map(|r| r.iter().map(value_to_json).collect())
                            .collect()
                    })
                    .unwrap_or_default();

                Json(QueryResponse { rows, columns })
            }
            Err(e) => {
                tracing::error!("Query failed: {}", e);
                Json(QueryResponse {
                    rows: vec![],
                    columns: vec![],
                })
            }
        }
    }
}

fn inject_tenant_filter(sql: &str, tenant_id: &str) -> String {
    // Simple injection: if WHERE exists, prepend tenant_id condition
    // For safety, should use proper SQL parser in production
    if sql.to_uppercase().contains("WHERE") {
        // Find the WHERE position (case-insensitive)
        let where_pos = sql.to_uppercase().find("WHERE").unwrap();
        let before_where = &sql[..where_pos];
        let after_where = &sql[where_pos..];
        format!(
            "{} WHERE tenant_id = '{}' AND {}",
            before_where,
            tenant_id,
            after_where["WHERE".len()..].trim_start()
        )
    } else {
        format!("{} WHERE tenant_id = '{}'", sql, tenant_id)
    }
}

fn value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::String(s) => serde_json::Value::String(s.clone()),
        Value::Int(i) => {
            // i64 -> serde_json::Number (need to check bounds for i64)
            serde_json::Value::Number((*i).into())
        }
        Value::Float(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Bool(b) => serde_json::Value::Bool(*b),
        Value::Null => serde_json::Value::Null,
    }
}