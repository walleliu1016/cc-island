// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Table schema definitions and DDL
//!
//! Tables with tenant isolation (user_id, device_id)

use serde::{Deserialize, Serialize};

/// Hook event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEventRecord {
    /// Timestamp (ISO 8601 format)
    pub ts: String,

    /// Tenant isolation
    pub user_id: String,
    pub device_id: String,

    /// Session info
    pub session_id: String,
    pub event_type: String,  // SessionStart/PreToolUse/PostToolUse/Stop/etc.
    pub agent_source: String,  // claude_code

    /// Tool info
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,  // JSON string
    pub tool_result: Option<String>,  // JSON string
    pub tool_use_id: Option<String>,

    /// Agent info
    pub agent_id: Option<String>,
    pub agent_type: Option<String>,

    /// Notification info
    pub notification_type: Option<String>,
    pub message: Option<String>,

    /// Context
    pub cwd: Option<String>,
    pub transcript_path: Option<String>,
    pub conversation_id: Option<String>,
    pub permission_mode: Option<String>,
    pub metadata: Option<String>,  // JSON blob

    /// cc-island specific
    pub project_name: Option<String>,
    pub duration_ms: Option<i64>,
    pub success: Option<bool>,
}

/// Message record (with token usage)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRecord {
    /// Timestamp
    pub ts: String,

    /// Tenant isolation
    pub user_id: String,
    pub device_id: String,

    /// Session info
    pub session_id: String,
    pub message_type: String,  // user/assistant/thinking/tool_use/tool_result
    pub role: String,  // user/assistant

    /// Content
    pub content: Option<String>,
    pub model: Option<String>,

    /// Tool info
    pub tool_name: Option<String>,
    pub tool_use_id: Option<String>,

    /// Token usage
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,

    /// Performance
    pub duration_ms: Option<i64>,

    /// cc-island specific
    pub project_name: Option<String>,
    pub cost_usd: Option<f64>,
}

/// DDL for tma1_hook_events table
pub const HOOK_EVENTS_DDL: &str = r#"
DROP TABLE IF EXISTS tma1_hook_events;

CREATE TABLE IF NOT EXISTS tma1_hook_events (
    ts                TIMESTAMP TIME INDEX,

    -- Tenant isolation
    user_id           STRING SKIPPING INDEX,
    device_id         STRING SKIPPING INDEX,

    -- Session info
    session_id        STRING SKIPPING INDEX,
    event_type        STRING INVERTED INDEX,
    agent_source      STRING INVERTED INDEX,

    -- Tool info
    tool_name         STRING NULL,
    tool_input        STRING NULL,
    tool_result       STRING NULL,
    tool_use_id       STRING NULL,

    -- Agent info
    agent_id          STRING NULL,
    agent_type        STRING NULL,

    -- Notification info
    notification_type STRING NULL,
    "message"         STRING NULL,

    -- Context
    cwd               STRING NULL,
    transcript_path   STRING NULL,
    conversation_id   STRING NULL,
    permission_mode   STRING NULL,
    metadata          STRING NULL,

    -- cc-island specific
    project_name      STRING NULL,
    duration_ms       BIGINT NULL,
    success           BOOLEAN NULL
) WITH ('append_mode'='true');
"#;

/// DDL for tma1_messages table
pub const MESSAGES_DDL: &str = r#"
DROP TABLE IF EXISTS tma1_messages;

CREATE TABLE IF NOT EXISTS tma1_messages (
    ts              TIMESTAMP TIME INDEX,

    -- Tenant isolation
    user_id         STRING SKIPPING INDEX,
    device_id       STRING SKIPPING INDEX,

    -- Session info
    session_id      STRING SKIPPING INDEX,
    message_type    STRING INVERTED INDEX,
    "role"          STRING INVERTED INDEX,

    -- Content
    content         STRING NULL FULLTEXT INDEX,
    model           STRING NULL INVERTED INDEX,

    -- Tool info
    tool_name       STRING NULL,
    tool_use_id     STRING NULL,

    -- Token usage
    input_tokens    BIGINT NULL,
    output_tokens   BIGINT NULL,
    cache_read_tokens      BIGINT NULL,
    cache_creation_tokens  BIGINT NULL,

    -- Performance
    duration_ms     BIGINT NULL,

    -- cc-island specific
    project_name    STRING NULL,
    cost_usd        DOUBLE NULL
) WITH ('append_mode'='true');
"#;

/// DDL for tma1_session_registry table
pub const SESSION_REGISTRY_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS tma1_session_registry (
    session_id      STRING PRIMARY KEY,

    -- Tenant isolation
    user_id         STRING SKIPPING INDEX,
    device_id       STRING SKIPPING INDEX,

    -- Session meta
    project_name    STRING,
    cwd             STRING,
    start_ts        TIMESTAMP,
    end_ts          TIMESTAMP NULL,
    status          STRING
);
"#;