// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Flow SQL definitions for aggregation
//!
//! Flows aggregate metrics by tenant dimensions (user_id, device_id)

/// Token usage aggregation Flow
pub const TOKEN_USAGE_FLOW: &str = r#"
CREATE OR REPLACE FLOW tma1_token_usage_flow
SINK TO tma1_token_usage_1m
EXPIRE AFTER '7d'
AS SELECT
    date_bin('1 minute', ts) as ts,
    user_id,
    device_id,
    model,
    SUM(input_tokens) as input_tokens,
    SUM(output_tokens) as output_tokens,
    SUM(cache_read_tokens) as cache_read_tokens,
    SUM(cache_creation_tokens) as cache_creation_tokens,
    SUM(cost_usd) as cost_usd,
    COUNT(*) as request_count
FROM tma1_messages
WHERE role = 'assistant' AND user_id IS NOT NULL
GROUP BY ts, user_id, device_id, model;
"#;

/// Cost aggregation Flow
pub const COST_FLOW: &str = r#"
CREATE OR REPLACE FLOW tma1_cost_flow
SINK TO tma1_cost_1m
EXPIRE AFTER '7d'
AS SELECT
    date_bin('1 minute', ts) as ts,
    user_id,
    device_id,
    SUM(cost_usd) as cost_usd,
    COUNT(*) as request_count
FROM tma1_messages
WHERE role = 'assistant' AND user_id IS NOT NULL
GROUP BY ts, user_id, device_id;
"#;

/// Tool calls aggregation Flow (optional)
pub const TOOL_CALLS_FLOW: &str = r#"
CREATE OR REPLACE FLOW tma1_tool_calls_flow
SINK TO tma1_tool_calls_1m
EXPIRE AFTER '7d'
AS SELECT
    date_bin('1 minute', ts) as ts,
    user_id,
    device_id,
    tool_name,
    COUNT(*) as call_count,
    SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as error_count,
    AVG(duration_ms) as avg_latency_ms,
    MAX(duration_ms) as max_latency_ms,
    MIN(duration_ms) as min_latency_ms
FROM tma1_hook_events
WHERE event_type = 'PostToolUse' AND user_id IS NOT NULL AND tool_name IS NOT NULL
GROUP BY ts, user_id, device_id, tool_name;
"#;