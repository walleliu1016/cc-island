// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use anyhow::Result;

/// Application configuration from environment variables.
///
/// Required: DATABASE_URL
/// Optional: WS_PORT (default: 17528), CLEANUP_INTERVAL_SECS (default: 3600), MAX_DEVICE_AGE_SECS (default: 86400)
pub struct Config {
    /// PostgreSQL connection URL
    pub database_url: String,
    /// WebSocket server port (default: 17528)
    pub ws_port: u16,
    /// Interval between cache cleanup runs in seconds (default: 3600)
    pub cleanup_interval_secs: u64,
    /// Maximum age of device entries before cleanup in seconds (default: 86400)
    pub max_device_age_secs: u64,
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

        if ws_port == 0 {
            return Err(anyhow::anyhow!("WS_PORT must be between 1 and 65535"));
        }

        let cleanup_interval_secs: u64 = std::env::var("CLEANUP_INTERVAL_SECS")
            .unwrap_or_else(|_| "3600".to_string())
            .parse()
            .map_err(|e| anyhow::anyhow!("CLEANUP_INTERVAL_SECS must be a valid number: {}", e))?;

        if cleanup_interval_secs == 0 {
            return Err(anyhow::anyhow!("CLEANUP_INTERVAL_SECS must be greater than 0"));
        }

        let max_device_age_secs: u64 = std::env::var("MAX_DEVICE_AGE_SECS")
            .unwrap_or_else(|_| "86400".to_string())
            .parse()
            .map_err(|e| anyhow::anyhow!("MAX_DEVICE_AGE_SECS must be a valid number: {}", e))?;

        if max_device_age_secs == 0 {
            return Err(anyhow::anyhow!("MAX_DEVICE_AGE_SECS must be greater than 0"));
        }

        Ok(Self {
            database_url,
            ws_port,
            cleanup_interval_secs,
            max_device_age_secs,
        })
    }
}