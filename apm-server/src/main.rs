// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! APM Server entry point
//!
//! Standalone service for receiving APM data from cc-island Desktop
//! and writing to GreptimeDB.
//!
//! # Architecture
//!
//! ```
//! Desktop → HTTP POST → APM Server → GreptimeDB
//!                     ↓
//!            SSE Stream → Frontend
//! ```
//!
//! # Endpoints
//!
//! - POST /api/hooks     - Hook events from Desktop
//! - GET  /api/query     - SQL query proxy
//! - GET  /api/stream    - SSE real-time stream
//! - POST /v1/traces     - OTLP traces receiver
//! - POST /v1/metrics    - OTLP metrics receiver
//!
//! # Usage
//!
//! ```bash
//! cc-island-apm --greptimedb-host localhost:4000 --database cc_island
//! ```

use std::env;
use std::net::SocketAddr;

use cc_island_apm::{config::Config, handler::create_router, greptime::GreptimeDBClient};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Parse configuration from args/env
    let config = Config::from_args();

    info!("Starting CC-Island APM Server...");
    info!("GreptimeDB: {}:{}", config.greptimedb_host, config.greptimedb_http_port);
    info!("Database: {}", config.database);
    info!("HTTP Port: {}", config.http_port);
    info!("OTLP Port: {}", config.otlp_port);

    // Initialize GreptimeDB client
    let greptimedb = GreptimeDBClient::new(
        config.greptimedb_host.clone(),
        config.greptimedb_http_port,
        config.database.clone(),
    );

    // Create router with all handlers
    let app = create_router(greptimedb, config.clone());

    // Bind address
    let addr: SocketAddr = format!("{}:{}", config.bind_host, config.http_port)
        .parse()
        .expect("Invalid address");

    info!("Listening on {}", addr);

    // Start server
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(async {
            let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
            axum::serve(listener, app).await.unwrap();
        });
}

fn print_help() {
    println!("CC-Island APM Server - APM data collector and GreptimeDB writer");
    println!("Version: {}", env!("CARGO_PKG_VERSION"));
    println!();
    println!("USAGE:");
    println!("  cc-island-apm [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("  --bind-host <HOST>           Bind address (default: 127.0.0.1)");
    println!("  --http-port <PORT>           HTTP API port (default: 17530)");
    println!("  --otlp-port <PORT>           OTLP receiver port (default: 17531)");
    println!("  --greptimedb-host <HOST>     GreptimeDB host (default: localhost)");
    println!("  --greptimedb-http-port <PORT> GreptimeDB HTTP port (default: 4000)");
    println!("  --database <NAME>            Database name (default: cc_island)");
    println!("  --retention-days <DAYS>      Data retention days (default: 30)");
    println!("  --otlp-export-url <URL>      OTLP export URL (optional)");
    println!("  --help, -h                   Show this help");
    println!("  --version, -V                Show version");
    println!();
    println!("ENVIRONMENT VARIABLES:");
    println!("  APM_BIND_HOST                Bind address");
    println!("  APM_HTTP_PORT                HTTP port");
    println!("  APM_GREPTIMEDB_HOST          GreptimeDB host");
    println!("  APM_GREPTIMEDB_HTTP_PORT     GreptimeDB HTTP port");
    println!("  APM_DATABASE                 Database name");
    println!("  APM_OTLP_EXPORT_URL          OTLP export URL");
    println!();
}