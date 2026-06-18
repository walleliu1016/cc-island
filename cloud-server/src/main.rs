// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
mod config;
mod messages;
mod db;
mod ws;
mod http;

use tokio_util::sync::CancellationToken;
use config::{Config, LogRotation};
use db::pool::create_pool;
use db::repository::Repository;

/// Initialize logging with file output.
fn init_logging(config: &Config) {
    use tracing_subscriber::EnvFilter;
    use tracing_appender::rolling;

    let env_filter = EnvFilter::new(&config.log_level);

    let rotation = match config.log_rotation {
        LogRotation::Hourly => rolling::Rotation::HOURLY,
        LogRotation::Daily => rolling::Rotation::DAILY,
    };

    let file_appender = rolling::RollingFileAppender::builder()
        .rotation(rotation)
        .filename_prefix(&config.log_file)
        .filename_suffix("log")
        .build(&config.log_dir)
        .expect("Failed to create log file appender");

    tracing_subscriber::fmt()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_env_filter(env_filter)
        .init();
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load configuration
    let config = Config::from_env()?;

    // Initialize logging with file output
    init_logging(&config);

    tracing::info!("Starting CC-Island Cloud Server...");

    // Create database pool
    let pool = create_pool(&config.database_url).await?;
    tracing::info!("Database connected");

    // Run migrations
    db::pool::run_migrations(&pool).await?;
    tracing::info!("Migrations complete");

    // Create shared components
    let repo = Repository::new(pool.clone());

    // Build Socket.IO server with PostgreSQL adapter
    let (socketio_layer, _io) = ws::server::build_socketio_server(pool.clone(), repo.clone()).await?;
    tracing::info!("Socket.IO server built");

    // Create HTTP router for API endpoints
    let http_router = http::create_http_router(repo.clone());

    // Create shutdown token
    let shutdown = CancellationToken::new();

    // Start stale session cleanup task (runs every minute)
    let cleanup_repo = Repository::new(pool.clone());
    let cleanup_shutdown = shutdown.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {
                    match cleanup_repo.cleanup_stale_sessions(30.0).await {
                        Ok(count) if count > 0 => {
                            tracing::info!("Cleaned up {} stale sessions (marked as ended)", count);
                        }
                        Err(e) => {
                            tracing::error!("Session cleanup error: {}", e);
                        }
                        _ => {}
                    }
                }
                _ = cleanup_shutdown.cancelled() => {
                    tracing::info!("Cleanup task stopped");
                    break;
                }
            }
        }
    });
    tracing::info!("Stale session cleanup task started");

    // Handle Ctrl+C for graceful shutdown
    let shutdown_clone = shutdown.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for Ctrl+C");
        tracing::info!("Ctrl+C received, initiating shutdown");
        shutdown_clone.cancel();
    });

    // CORS layer — allow any origin for development
    let cors_layer = tower_http::cors::CorsLayer::permissive();

    // Merge HTTP API routes with Socket.IO layer
    // CORS must be outermost so it processes preflight and adds headers to all responses
    let app = axum::Router::new()
        .merge(http_router)
        .layer(socketio_layer)
        .layer(cors_layer);

    // Bind and serve
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.ws_port)).await?;
    tracing::info!("Server listening on port {} (HTTP API + Socket.IO)", config.ws_port);
    axum::serve(listener, app).await?;

    tracing::info!("Server shutdown complete");
    Ok(())
}
