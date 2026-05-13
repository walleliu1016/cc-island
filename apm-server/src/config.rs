// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Configuration management
//!
//! Supports configuration via:
//! - Command line arguments
//! - Environment variables
//! - Configuration file (TOML)

use std::env;

/// APM Server configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// Bind address for HTTP server
    pub bind_host: String,

    /// HTTP API port (default: 17530)
    pub http_port: u16,

    /// OTLP receiver port (default: 17531)
    pub otlp_port: u16,

    /// GreptimeDB host (default: localhost)
    pub greptimedb_host: String,

    /// GreptimeDB HTTP port (default: 4000)
    pub greptimedb_http_port: u16,

    /// Database name (default: cc_island)
    pub database: String,

    /// Data retention days (default: 30)
    pub retention_days: u64,

    /// OTLP export URL (optional, for external APM)
    pub otlp_export_url: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            bind_host: "127.0.0.1".to_string(),
            http_port: 17530,
            otlp_port: 17531,
            greptimedb_host: "localhost".to_string(),
            greptimedb_http_port: 4000,
            database: "cc_island".to_string(),
            retention_days: 30,
            otlp_export_url: None,
        }
    }
}

impl Config {
    /// Parse configuration from command line arguments and environment variables
    pub fn from_args() -> Self {
        let args: Vec<String> = env::args().collect();
        let mut config = Config::default();

        // Parse environment variables first (as defaults)
        if let Ok(v) = env::var("APM_BIND_HOST") {
            config.bind_host = v;
        }
        if let Ok(v) = env::var("APM_HTTP_PORT") {
            config.http_port = v.parse().unwrap_or(17530);
        }
        if let Ok(v) = env::var("APM_OTLP_PORT") {
            config.otlp_port = v.parse().unwrap_or(17531);
        }
        if let Ok(v) = env::var("APM_GREPTIMEDB_HOST") {
            config.greptimedb_host = v;
        }
        if let Ok(v) = env::var("APM_GREPTIMEDB_HTTP_PORT") {
            config.greptimedb_http_port = v.parse().unwrap_or(4000);
        }
        if let Ok(v) = env::var("APM_DATABASE") {
            config.database = v;
        }
        if let Ok(v) = env::var("APM_OTLP_EXPORT_URL") {
            config.otlp_export_url = Some(v);
        }
        if let Ok(v) = env::var("APM_RETENTION_DAYS") {
            config.retention_days = v.parse().unwrap_or(30);
        }

        // Parse command line arguments (override env vars)
        let mut i = 1;
        while i < args.len() {
            let arg = &args[i];

            match arg.as_str() {
                "--bind-host" => {
                    if i + 1 < args.len() {
                        config.bind_host = args[i + 1].clone();
                        i += 2;
                    }
                }
                "--http-port" => {
                    if i + 1 < args.len() {
                        config.http_port = args[i + 1].parse().unwrap_or(17530);
                        i += 2;
                    }
                }
                "--otlp-port" => {
                    if i + 1 < args.len() {
                        config.otlp_port = args[i + 1].parse().unwrap_or(17531);
                        i += 2;
                    }
                }
                "--greptimedb-host" => {
                    if i + 1 < args.len() {
                        config.greptimedb_host = args[i + 1].clone();
                        i += 2;
                    }
                }
                "--greptimedb-http-port" => {
                    if i + 1 < args.len() {
                        config.greptimedb_http_port = args[i + 1].parse().unwrap_or(4000);
                        i += 2;
                    }
                }
                "--database" => {
                    if i + 1 < args.len() {
                        config.database = args[i + 1].clone();
                        i += 2;
                    }
                }
                "--retention-days" => {
                    if i + 1 < args.len() {
                        config.retention_days = args[i + 1].parse().unwrap_or(30);
                        i += 2;
                    }
                }
                "--otlp-export-url" => {
                    if i + 1 < args.len() {
                        config.otlp_export_url = Some(args[i + 1].clone());
                        i += 2;
                    }
                }
                "--help" | "-h" => {
                    println!("CC-Island APM Server v{}", env!("CARGO_PKG_VERSION"));
                    std::process::exit(0);
                }
                "--version" | "-V" => {
                    println!("cc-island-apm {}", env!("CARGO_PKG_VERSION"));
                    std::process::exit(0);
                }
                _ => {
                    i += 1;
                }
            }
        }

        config
    }

    /// Get GreptimeDB HTTP API URL
    pub fn greptimedb_url(&self) -> String {
        format!("http://{}:{}/v1/sql", self.greptimedb_host, self.greptimedb_http_port)
    }
}