// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

pub const SCHEMA: &str = r#"
-- hook_events table
CREATE TABLE IF NOT EXISTS hook_events (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,
    session_id STRING SKIPPING INDEX,
    event_type STRING INVERTED INDEX,
    tool_name STRING NULL,
    tool_input STRING NULL,
    tool_result STRING NULL,
    tool_use_id STRING NULL,
    agent_id STRING NULL,
    parent_agent_id STRING NULL,
    duration_ms BIGINT NULL,
    success BOOLEAN NULL
);

-- messages table
CREATE TABLE IF NOT EXISTS messages (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,
    session_id STRING SKIPPING INDEX,
    message_type STRING,
    role STRING,
    content STRING NULL,
    model STRING NULL,
    input_tokens BIGINT NULL,
    output_tokens BIGINT NULL,
    cache_read_tokens BIGINT NULL,
    cache_creation_tokens BIGINT NULL,
    cost_usd DOUBLE NULL
);
"#;

pub async fn init_schema(client: &super::GreptimeClient) -> Result<(), Box<dyn std::error::Error>> {
    // Split by semicolon and execute each statement
    for stmt in SCHEMA.split(';').filter(|s| !s.trim().is_empty()) {
        client.query(stmt.trim()).await?;
    }
    Ok(())
}