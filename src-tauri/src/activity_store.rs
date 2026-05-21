// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// Tool activity detail for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolActivityDetail {
    pub id: i64,
    pub session_id: String,
    pub tool_name: String,
    pub content: String,
    pub timestamp: u64,
    pub status: String,
    pub result: Option<String>,
}

/// SQLite store for tool activities
pub struct ActivityStore {
    conn: Mutex<Connection>,
}

impl ActivityStore {
    /// Initialize database at ~/.cc-island/data.db
    pub fn new() -> SqliteResult<Self> {
        let db_path = Self::get_db_path();

        // Create parent directory if not exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(&db_path)?;

        // Create table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tool_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                content TEXT,
                timestamp INTEGER NOT NULL,
                status TEXT NOT NULL,
                result TEXT,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Create indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session_id ON tool_activities(session_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_timestamp ON tool_activities(timestamp)",
            [],
        )?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    fn get_db_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".cc-island")
            .join("data.db")
    }

    /// Insert a new activity record
    pub fn insert_activity(
        &self,
        session_id: &str,
        tool_name: &str,
        content: &str,
        status: &str,
    ) -> SqliteResult<i64> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tool_activities (session_id, tool_name, content, timestamp, status, result, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            [session_id, tool_name, content, &timestamp.to_string(), status, &timestamp.to_string()],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Update activity result (for PostToolUse)
    pub fn update_activity_result(&self, id: i64, status: &str, result: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tool_activities SET status = ?1, result = ?2 WHERE id = ?3",
            [status, result, &id.to_string()],
        )?;
        Ok(())
    }

    /// Get recent activities for a session
    pub fn get_activities(&self, session_id: &str, limit: i64) -> SqliteResult<Vec<ToolActivityDetail>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, tool_name, content, timestamp, status, result
             FROM tool_activities
             WHERE session_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2"
        )?;

        let activities = stmt.query_map([session_id, &limit.to_string()], |row| {
            Ok(ToolActivityDetail {
                id: row.get(0)?,
                session_id: row.get(1)?,
                tool_name: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
                status: row.get(5)?,
                result: row.get(6)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

        Ok(activities)
    }

    /// Get latest running activity for a session (to update on PostToolUse)
    pub fn get_latest_running(&self, session_id: &str) -> SqliteResult<Option<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, tool_name FROM tool_activities
             WHERE session_id = ?1 AND status = 'running'
             ORDER BY timestamp DESC LIMIT 1"
        )?;

        let result = stmt.query_row([session_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).ok();

        Ok(result)
    }

    /// Cleanup old activities (older than 7 days)
    pub fn cleanup_old(&self, days: u64) -> SqliteResult<usize> {
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() - (days * 86400);

        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM tool_activities WHERE created_at < ?1",
            [&cutoff.to_string()],
        )?;

        Ok(deleted)
    }
}