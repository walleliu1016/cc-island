// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Device {
    pub id: uuid::Uuid,
    pub device_token: String,
    pub name: Option<String>,
    pub status: String,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Session {
    pub id: uuid::Uuid,
    pub device_token: String,
    pub session_id: String,
    pub project_name: Option<String>,
    pub status: String,
    pub current_tool: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub started_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Popup {
    pub id: String,
    pub device_token: String,
    pub session_id: Option<String>,
    pub project_name: Option<String>,
    pub popup_type: String,
    pub data: serde_json::Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: uuid::Uuid,
    pub device_token: String,
    pub session_id: String,
    pub message_id: String,
    pub message_type: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}