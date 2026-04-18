// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use sqlx::PgPool;
use anyhow::Result;
use chrono::{TimeZone, Utc};
use tracing::warn;
use super::models::{ChatMessage, Device, SessionInfo, Popup};
use crate::messages::{ChatMessageData, MessageType, DeviceInfo};

/// Repository for database operations
#[derive(Clone)]
pub struct Repository {
    pool: PgPool,
}

impl Repository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // ===== Device operations =====

    /// Upsert device (register or update online status)
    pub async fn upsert_device(&self, device_token: &str, hostname: Option<&str>, name: Option<&str>) -> Result<Device> {
        let now = Utc::now();
        let device = sqlx::query_as::<_, Device>(
            r#"
            INSERT INTO devices (device_token, hostname, name, status, last_seen_at, registered_at)
            VALUES ($1, $2, $3, 'online', $4, $4)
            ON CONFLICT (device_token)
            DO UPDATE SET
                status = 'online',
                last_seen_at = $4,
                hostname = COALESCE($2, devices.hostname),
                name = COALESCE($3, devices.name)
            RETURNING *
            "#,
        )
        .bind(device_token)
        .bind(hostname)
        .bind(name)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;

        Ok(device)
    }

    /// Set device status to offline
    pub async fn set_device_offline(&self, device_token: &str) -> Result<()> {
        sqlx::query(
            "UPDATE devices SET status = 'offline' WHERE device_token = $1",
        )
        .bind(device_token)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get all online devices
    pub async fn get_online_devices(&self) -> Result<Vec<DeviceInfo>> {
        let devices = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices WHERE status = 'online' ORDER BY last_seen_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        let result: Vec<DeviceInfo> = devices
            .into_iter()
            .map(|d| DeviceInfo {
                token: d.device_token,
                hostname: d.hostname,
                registered_at: d.registered_at.map(|t| t.to_rfc3339()),
                online: true,
            })
            .collect();

        Ok(result)
    }

    /// Get subscribed devices info (filter by tokens)
    pub async fn get_devices_info(&self, device_tokens: &[String]) -> Result<Vec<DeviceInfo>> {
        let devices = sqlx::query_as::<_, Device>(
            "SELECT * FROM devices WHERE device_token = ANY($1)",
        )
        .bind(device_tokens)
        .fetch_all(&self.pool)
        .await?;

        let result: Vec<DeviceInfo> = devices
            .into_iter()
            .map(|d| DeviceInfo {
                token: d.device_token,
                hostname: d.hostname,
                registered_at: d.registered_at.map(|t| t.to_rfc3339()),
                online: d.status == "online",
            })
            .collect();

        Ok(result)
    }

    // ===== Session operations =====

    /// Upsert session (create or update)
    pub async fn upsert_session(
        &self,
        device_token: &str,
        session_id: &str,
        project_name: Option<&str>,
        status: &str,
        current_tool: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query!(
            r#"
            INSERT INTO sessions (device_token, session_id, project_name, status, current_tool, started_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            ON CONFLICT (device_token, session_id)
            DO UPDATE SET
                project_name = COALESCE($3, sessions.project_name),
                status = $4,
                current_tool = $5,
                updated_at = $6
            "#,
            device_token,
            session_id,
            project_name,
            status,
            current_tool,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get active sessions for devices (not ended)
    pub async fn get_active_sessions(&self, device_tokens: &[String]) -> Result<Vec<SessionInfo>> {
        // Filter out ended sessions (handles both 'ended' and '{"type":"ended"}' formats)
        let sessions = sqlx::query_as::<_, SessionInfo>(
            r#"
            SELECT device_token, session_id, project_name, status, current_tool, started_at, updated_at
            FROM sessions
            WHERE device_token = ANY($1)
            AND status NOT LIKE '%ended%'
            AND status NOT LIKE '%test%'
            AND session_id NOT LIKE 'test-%'
            ORDER BY updated_at DESC
            LIMIT 20
            "#,
        )
        .bind(device_tokens)
        .fetch_all(&self.pool)
        .await?;

        Ok(sessions)
    }

    /// End session (mark as ended)
    pub async fn end_session(&self, device_token: &str, session_id: &str) -> Result<()> {
        let now = Utc::now();
        sqlx::query!(
            r#"
            UPDATE sessions
            SET status = 'ended', updated_at = $3
            WHERE device_token = $1 AND session_id = $2
            "#,
            device_token,
            session_id,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // ===== Chat message operations =====

    /// Upsert chat messages for a session (batch insert, skip duplicates)
    pub async fn upsert_chat_messages(
        &self,
        device_token: &str,
        session_id: &str,
        messages: &[ChatMessageData],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        for msg in messages {
            // Convert timestamp (milliseconds) to DateTime<Utc>
            let timestamp = Utc.timestamp_millis_opt(msg.timestamp as i64).single().unwrap_or_else(Utc::now);

            // Convert MessageType to string for storage
            let message_type = match msg.message_type {
                MessageType::User => "user",
                MessageType::Assistant => "assistant",
                MessageType::ToolCall => "toolCall",
                MessageType::ToolResult => "toolResult",
                MessageType::Thinking => "thinking",
                MessageType::Interrupted => "interrupted",
            };

            sqlx::query(
                r#"
                INSERT INTO chat_messages (device_token, session_id, message_id, message_type, content, tool_name, timestamp)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (device_token, session_id, message_id) DO NOTHING
                "#,
            )
            .bind(device_token)
            .bind(session_id)
            .bind(&msg.id)
            .bind(message_type)
            .bind(&msg.content)
            .bind(&msg.tool_name)
            .bind(timestamp)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Get chat history for a session
    pub async fn get_chat_history(
        &self,
        device_token: &str,
        session_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<ChatMessageData>> {
        let limit = limit.unwrap_or(100);

        let messages = sqlx::query_as::<_, ChatMessage>(
            "SELECT * FROM chat_messages WHERE device_token = $1 AND session_id = $2 ORDER BY timestamp ASC LIMIT $3",
        )
        .bind(device_token)
        .bind(session_id)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        // Convert database model to ChatMessageData
        let result: Vec<ChatMessageData> = messages
            .into_iter()
            .map(|msg| {
                // Convert message_type string to MessageType enum
                let message_type = match msg.message_type.as_str() {
                    "user" => MessageType::User,
                    "assistant" => MessageType::Assistant,
                    "toolCall" => MessageType::ToolCall,
                    "toolResult" => MessageType::ToolResult,
                    "thinking" => MessageType::Thinking,
                    "interrupted" => MessageType::Interrupted,
                    other => {
                        warn!("Unknown message_type '{}' in message {}, defaulting to User", other, msg.message_id);
                        MessageType::User
                    }
                };

                // Convert DateTime<Utc> to milliseconds timestamp
                let timestamp = msg.timestamp.timestamp_millis() as u64;

                ChatMessageData {
                    id: msg.message_id,
                    session_id: msg.session_id,
                    message_type,
                    content: msg.content,
                    tool_name: msg.tool_name,
                    timestamp,
                }
            })
            .collect();

        Ok(result)
    }

    // ===== Popup operations =====

    /// Upsert popup (create or update pending popup)
    pub async fn upsert_popup(
        &self,
        device_token: &str,
        session_id: &str,
        popup_id: &str,
        popup_type: &str,
        project_name: Option<&str>,
        data: serde_json::Value,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query!(
            r#"
            INSERT INTO popups (id, device_token, session_id, project_name, popup_type, data, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
            ON CONFLICT (id)
            DO UPDATE SET
                status = 'pending',
                data = $6,
                resolved_at = NULL
            "#,
            popup_id,
            device_token,
            session_id,
            project_name,
            popup_type,
            data,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get pending popups for a device
    pub async fn get_pending_popups(&self, device_token: &str) -> Result<Vec<Popup>> {
        let popups = sqlx::query_as::<_, Popup>(
            r#"
            SELECT id, device_token, session_id, project_name, popup_type, data, status, created_at, resolved_at
            FROM popups
            WHERE device_token = $1 AND status = 'pending'
            ORDER BY created_at DESC
            "#,
        )
        .bind(device_token)
        .fetch_all(&self.pool)
        .await?;

        Ok(popups)
    }

    /// Resolve popup (mark as resolved)
    pub async fn resolve_popup(&self, popup_id: &str) -> Result<()> {
        let now = Utc::now();
        sqlx::query!(
            r#"
            UPDATE popups
            SET status = 'resolved', resolved_at = $2
            WHERE id = $1 AND status = 'pending'
            "#,
            popup_id,
            now,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}