// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! GreptimeDB HTTP SQL API client

use crate::greptime::schema::*;
use crate::greptime::flows::*;
use anyhow::{Error, Result};
use reqwest::Client;
use serde_json::Value;
use std::sync::Arc;
use tracing::{debug, error, info};

/// GreptimeDB HTTP SQL API client
pub struct GreptimeDBClient {
    host: String,
    port: u16,
    database: String,
    client: Client,
}

impl GreptimeDBClient {
    pub fn new(host: String, port: u16, database: String) -> Arc<Self> {
        Arc::new(Self {
            host,
            port,
            database,
            client: Client::new(),
        })
    }

    /// Get HTTP API URL
    fn sql_url(&self) -> String {
        format!("http://{}:{}//v1/sql?db={}", self.host, self.port, self.database)
    }

    /// Execute SQL query (SELECT)
    pub async fn query(&self, sql: &str) -> Result<Value> {
        debug!("Query: {}", sql);

        let response = self.client
            .post(&self.sql_url())
            .form(&[("sql", sql)])
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            error!("Query failed: {}", error_text);
            return Err(Error::msg(format!("GreptimeDB query failed: {}", error_text)));
        }

        let json: Value = response.json().await?;
        Ok(json)
    }

    /// Execute SQL (INSERT/DDL)
    pub async fn execute(&self, sql: &str) -> Result<()> {
        debug!("Execute: {}", sql);

        let response = self.client
            .post(&self.sql_url())
            .form(&[("sql", sql)])
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            error!("Execute failed: {}", error_text);
            return Err(Error::msg(format!("GreptimeDB execute failed: {}", error_text)));
        }

        Ok(())
    }

    /// Initialize tables (DDL)
    pub async fn init_tables(&self) -> Result<()> {
        info!("Initializing GreptimeDB tables...");

        // Create hook_events table
        self.execute(HOOK_EVENTS_DDL).await?;
        info!("Created table: tma1_hook_events");

        // Create messages table
        self.execute(MESSAGES_DDL).await?;
        info!("Created table: tma1_messages");

        // Create session_registry table
        self.execute(SESSION_REGISTRY_DDL).await?;
        info!("Created table: tma1_session_registry");

        // Create flows
        self.execute(TOKEN_USAGE_FLOW).await?;
        info!("Created flow: tma1_token_usage_flow");

        self.execute(COST_FLOW).await?;
        info!("Created flow: tma1_cost_flow");

        info!("Tables initialized successfully");
        Ok(())
    }

    /// Insert hook event
    pub async fn insert_hook_event(&self, record: &HookEventRecord) -> Result<()> {
        let sql = self.build_insert_hook_event(record);
        self.execute(&sql).await
    }

    /// Insert message
    pub async fn insert_message(&self, record: &MessageRecord) -> Result<()> {
        let sql = self.build_insert_message(record);
        self.execute(&sql).await
    }

    /// Build INSERT SQL for hook event
    fn build_insert_hook_event(&self, record: &HookEventRecord) -> String {
        format!(
            "INSERT INTO tma1_hook_events (ts, user_id, device_id, session_id, event_type, \
            agent_source, tool_name, tool_input, tool_result, tool_use_id, agent_id, agent_type, \
            notification_type, \"message\", cwd, transcript_path, conversation_id, permission_mode, \
            metadata, project_name, duration_ms, success) VALUES \
            ('{}', '{}', '{}', '{}', '{}', '{}', {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})",
            record.ts,
            escape_sql_string(&record.user_id),
            escape_sql_string(&record.device_id),
            escape_sql_string(&record.session_id),
            escape_sql_string(&record.event_type),
            escape_sql_string(&record.agent_source),
            sql_option_string(&record.tool_name),
            sql_option_string(&record.tool_input),
            sql_option_string(&record.tool_result),
            sql_option_string(&record.tool_use_id),
            sql_option_string(&record.agent_id),
            sql_option_string(&record.agent_type),
            sql_option_string(&record.notification_type),
            sql_option_string(&record.message),
            sql_option_string(&record.cwd),
            sql_option_string(&record.transcript_path),
            sql_option_string(&record.conversation_id),
            sql_option_string(&record.permission_mode),
            sql_option_string(&record.metadata),
            sql_option_string(&record.project_name),
            sql_option_i64(&record.duration_ms),
            sql_option_bool(&record.success),
        )
    }

    /// Build INSERT SQL for message
    fn build_insert_message(&self, record: &MessageRecord) -> String {
        format!(
            "INSERT INTO tma1_messages (ts, user_id, device_id, session_id, message_type, \
            \"role\", content, model, tool_name, tool_use_id, input_tokens, output_tokens, \
            cache_read_tokens, cache_creation_tokens, duration_ms, project_name, cost_usd) VALUES \
            ('{}', '{}', '{}', '{}', '{}', '{}', {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})",
            record.ts,
            escape_sql_string(&record.user_id),
            escape_sql_string(&record.device_id),
            escape_sql_string(&record.session_id),
            escape_sql_string(&record.message_type),
            escape_sql_string(&record.role),
            sql_option_string(&record.content),
            sql_option_string(&record.model),
            sql_option_string(&record.tool_name),
            sql_option_string(&record.tool_use_id),
            sql_option_i64(&record.input_tokens),
            sql_option_i64(&record.output_tokens),
            sql_option_i64(&record.cache_read_tokens),
            sql_option_i64(&record.cache_creation_tokens),
            sql_option_i64(&record.duration_ms),
            sql_option_string(&record.project_name),
            sql_option_f64(&record.cost_usd),
        )
    }
}

/// Escape SQL string (replace ' with '')
fn escape_sql_string(s: &str) -> String {
    s.replace("'", "''")
}

/// Format optional string for SQL (NULL or 'value')
fn sql_option_string(s: &Option<String>) -> String {
    match s {
        Some(v) => format!("'{}'", escape_sql_string(v)),
        None => "NULL".to_string(),
    }
}

/// Format optional i64 for SQL
fn sql_option_i64(v: &Option<i64>) -> String {
    match v {
        Some(n) => n.to_string(),
        None => "NULL".to_string(),
    }
}

/// Format optional f64 for SQL
fn sql_option_f64(v: &Option<f64>) -> String {
    match v {
        Some(n) => n.to_string(),
        None => "NULL".to_string(),
    }
}

/// Format optional bool for SQL
fn sql_option_bool(v: &Option<bool>) -> String {
    match v {
        Some(b) => b.to_string(),
        None => "NULL".to_string(),
    }
}