// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Tenant management
//!
//! Provides:
//! - Tenant identification from headers
//! - SQL query filtering by tenant
//! - Session registry management

/// Extract tenant info from HTTP headers
pub fn extract_tenant(headers: &axum::http::HeaderMap) -> TenantInfo {
    let user_id = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let device_id = headers
        .get("x-device-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    TenantInfo { user_id, device_id }
}

/// Tenant identification
#[derive(Debug, Clone)]
pub struct TenantInfo {
    pub user_id: String,
    pub device_id: String,
}

impl TenantInfo {
    /// Create SQL filter clause for tenant
    pub fn sql_filter(&self) -> String {
        format!(
            "user_id = '{}' AND device_id = '{}'",
            escape_sql(&self.user_id),
            escape_sql(&self.device_id)
        )
    }

    /// Create SQL filter for user only (all devices)
    pub fn sql_filter_user(&self) -> String {
        format!("user_id = '{}'", escape_sql(&self.user_id))
    }
}

/// Escape SQL string
fn escape_sql(s: &str) -> String {
    s.replace("'", "''")
}