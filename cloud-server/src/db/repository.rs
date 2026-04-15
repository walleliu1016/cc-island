use sqlx::PgPool;
use anyhow::Result;
use chrono::Utc;
use super::models::{Device, Session, Popup};

/// Repository for database operations
pub struct Repository {
    pool: PgPool,
}

impl Repository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // ===== Device operations =====

    /// Upsert device (register or update online status)
    pub async fn upsert_device(&self, device_token: &str, name: Option<&str>) -> Result<Device> {
        let now = Utc::now();
        let device = sqlx::query_as::<_, Device>(
            r#"
            INSERT INTO devices (device_token, name, status, last_seen_at)
            VALUES ($1, $2, 'online', $3)
            ON CONFLICT (device_token)
            DO UPDATE SET status = 'online', last_seen_at = $3, name = COALESCE($2, devices.name)
            RETURNING *
            "#,
        )
        .bind(device_token)
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

    // ===== Session operations =====

    /// Upsert multiple sessions for a device (with transaction)
    pub async fn upsert_sessions(&self, device_token: &str, sessions: &[crate::messages::SessionState]) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        for session in sessions {
            sqlx::query(
                r#"
                INSERT INTO sessions (device_token, session_id, project_name, status, current_tool, tool_input, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (device_token, session_id)
                DO UPDATE SET status = $4, current_tool = $5, tool_input = $6, project_name = $3, updated_at = NOW()
                "#,
            )
            .bind(device_token)
            .bind(&session.session_id)
            .bind(&session.project_name)
            .bind(&session.status)
            .bind(&session.current_tool)
            .bind(&session.tool_input)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Get all sessions for a device
    pub async fn get_sessions(&self, device_token: &str) -> Result<Vec<Session>> {
        let sessions = sqlx::query_as::<_, Session>(
            "SELECT * FROM sessions WHERE device_token = $1 ORDER BY updated_at DESC",
        )
        .bind(device_token)
        .fetch_all(&self.pool)
        .await?;

        Ok(sessions)
    }

    // ===== Popup operations =====

    /// Upsert a popup for a device
    pub async fn upsert_popup(&self, device_token: &str, popup: &crate::messages::PopupState) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO popups (id, device_token, session_id, project_name, popup_type, data, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            ON CONFLICT (id) DO UPDATE SET data = $6, status = 'pending'
            "#,
        )
        .bind(&popup.id)
        .bind(device_token)
        .bind(&popup.session_id)
        .bind(&popup.project_name)
        .bind(&popup.popup_type)
        .bind(&popup.data)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get pending popups for a device
    pub async fn get_pending_popups(&self, device_token: &str) -> Result<Vec<Popup>> {
        let popups = sqlx::query_as::<_, Popup>(
            "SELECT * FROM popups WHERE device_token = $1 AND status = 'pending' ORDER BY created_at DESC",
        )
        .bind(device_token)
        .fetch_all(&self.pool)
        .await?;

        Ok(popups)
    }

    /// Mark popup as resolved
    pub async fn resolve_popup(&self, popup_id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE popups SET status = 'resolved', resolved_at = NOW() WHERE id = $1",
        )
        .bind(popup_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}