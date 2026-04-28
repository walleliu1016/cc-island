// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use sqlx::PgPool;
use anyhow::Result;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::protocol::Message;

/// Direction of pending message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    ToMobile,
    ToDesktop,
}

impl Direction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Direction::ToMobile => "to_mobile",
            Direction::ToDesktop => "to_desktop",
        }
    }
}

/// Pending message stored in database
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PendingMessage {
    pub id: Uuid,
    pub device_token: String,
    pub direction: String,
    pub message_type: String,
    pub message_body: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Notify payload (lightweight, sent via PostgreSQL NOTIFY)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyPayload {
    pub device_token: String,
    pub direction: String,
    pub message_id: Uuid,
}

/// Repository for pending_messages table operations
#[derive(Clone)]
pub struct PendingMessageRepo {
    pool: PgPool,
}

impl PendingMessageRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a pending message
    pub async fn insert(
        &self,
        device_token: &str,
        direction: Direction,
        message_type: &str,
        message_body: serde_json::Value,
    ) -> Result<Uuid> {
        let id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO pending_messages (id, device_token, direction, message_type, message_body)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            id,
            device_token,
            direction.as_str(),
            message_type,
            message_body,
        )
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    /// Get and delete a pending message by id (atomic operation)
    pub async fn get_and_delete(&self, message_id: Uuid) -> Result<Option<PendingMessage>> {
        // Use DELETE with RETURNING for atomic get-and-delete
        let result = sqlx::query_as::<_, PendingMessage>(
            r#"
            DELETE FROM pending_messages
            WHERE id = $1
            RETURNING id, device_token, direction, message_type, message_body, created_at
            "#,
        )
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    /// Delete stale messages older than threshold
    pub async fn delete_stale(&self, older_than_minutes: f64) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            DELETE FROM pending_messages
            WHERE created_at < NOW() - INTERVAL '1 minute' * $1
            "#,
            older_than_minutes,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Send NOTIFY to PostgreSQL channel
    pub async fn notify(&self, payload: &NotifyPayload) -> Result<()> {
        let payload_json = serde_json::to_string(payload)?;
        sqlx::query!(
            r#"
            SELECT pg_notify('pending_message_notify', $1)
            "#,
            payload_json,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Reconstruct WebSocket Message from stored data
    pub fn to_ws_message(&self, pending: &PendingMessage) -> Message {
        // The message_body is already the full CloudMessage JSON
        Message::text(pending.message_body.to_string())
    }
}