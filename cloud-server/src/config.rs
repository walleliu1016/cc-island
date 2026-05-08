// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use anyhow::Result;

/// Log output destination
#[derive(Debug, Clone, Copy)]
pub enum LogOutput {
    Stdout,
    File,
}

/// Log file rotation strategy
#[derive(Debug, Clone, Copy)]
pub enum LogRotation {
    Hourly,
    Daily,
}

/// Application configuration from environment variables.
///
/// Required: DATABASE_URL
/// Optional: WS_PORT (default: 17528), HTTP_PORT (default: 17529)
/// Optional: LOG_OUTPUT (default: stdout), LOG_DIR, LOG_FILE, LOG_ROTATION, LOG_LEVEL
pub struct Config {
    /// PostgreSQL connection URL
    pub database_url: String,
    /// WebSocket server port (default: 17528)
    pub ws_port: u16,
    /// HTTP API server port (default: 17529)
    pub http_port: u16,
    // 日志配置
    /// Log output destination (default: stdout)
    pub log_output: LogOutput,
    /// Log directory (default: ./logs, only for file mode)
    pub log_dir: String,
    /// Log file prefix (default: cloud-server, only for file mode)
    pub log_file: String,
    /// Log rotation strategy (default: hourly, only for file mode)
    pub log_rotation: LogRotation,
    /// Log level (default: info)
    pub log_level: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();  // Load .env file if present

        let database_url = std::env::var("DATABASE_URL")
            .map_err(|_| anyhow::anyhow!("DATABASE_URL environment variable must be set"))?;

        let ws_port: u16 = std::env::var("WS_PORT")
            .unwrap_or_else(|_| "17528".to_string())
            .parse()
            .map_err(|e| anyhow::anyhow!("WS_PORT must be a valid port number: {}", e))?;

        let http_port: u16 = std::env::var("HTTP_PORT")
            .unwrap_or_else(|_| "17529".to_string())
            .parse()
            .map_err(|e| anyhow::anyhow!("HTTP_PORT must be a valid port number: {}", e))?;

        if ws_port == 0 || http_port == 0 {
            return Err(anyhow::anyhow!("Ports must be between 1 and 65535"));
        }

        // 日志配置
        let log_output = match std::env::var("LOG_OUTPUT")
            .unwrap_or_else(|_| "stdout".to_string())
            .to_lowercase()
            .as_str()
        {
            "file" => LogOutput::File,
            "stdout" => LogOutput::Stdout,
            other => return Err(anyhow::anyhow!("LOG_OUTPUT must be 'stdout' or 'file', got: {}", other)),
        };

        let log_dir = std::env::var("LOG_DIR")
            .unwrap_or_else(|_| "./logs".to_string());

        let log_file = std::env::var("LOG_FILE")
            .unwrap_or_else(|_| "cloud-server".to_string());

        let log_rotation = match std::env::var("LOG_ROTATION")
            .unwrap_or_else(|_| "hourly".to_string())
            .to_lowercase()
            .as_str()
        {
            "hourly" => LogRotation::Hourly,
            "daily" => LogRotation::Daily,
            other => return Err(anyhow::anyhow!("LOG_ROTATION must be 'hourly' or 'daily', got: {}", other)),
        };

        let log_level = std::env::var("LOG_LEVEL")
            .unwrap_or_else(|_| "info".to_string());

        Ok(Self {
            database_url,
            ws_port,
            http_port,
            log_output,
            log_dir,
            log_file,
            log_rotation,
            log_level,
        })
    }
}