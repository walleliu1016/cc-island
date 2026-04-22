// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use anyhow::Result;

/// Application configuration from environment variables.
///
/// Required: DATABASE_URL
/// Optional: WS_PORT (default: 17528), HTTP_PORT (default: 17529)
pub struct Config {
    /// PostgreSQL connection URL
    pub database_url: String,
    /// WebSocket server port (default: 17528)
    pub ws_port: u16,
    /// HTTP API server port (default: 17529)
    pub http_port: u16,
    /// OpenTelemetry tracing enabled
    pub enable_tracing: bool,
    /// OpenTelemetry OTLP endpoint (e.g., "http://localhost:4317")
    pub otel_endpoint: Option<String>,
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

        let enable_tracing = std::env::var("CC_ISLAND_TRACING_ENABLED")
            .map(|v| v == "true")
            .unwrap_or(false);

        let otel_endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT").ok();

        Ok(Self {
            database_url,
            ws_port,
            http_port,
            enable_tracing,
            otel_endpoint,
        })
    }
}