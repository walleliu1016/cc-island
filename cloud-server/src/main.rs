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
use db::pending_message::PendingMessageRepo;
use ws::router::ConnectionRouter;
use ws::server::run_server;
use ws::notify_listener::NotifyListener;

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
        .with_ansi(false)  // Disable colors for file output
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
    let pending_repo = PendingMessageRepo::new(pool.clone());
    let router = ConnectionRouter::new();

    // Create shutdown token
    let shutdown = CancellationToken::new();

    // Spawn HTTP server for API endpoints
    let http_router = http::create_http_router(repo.clone(), router.clone());
    let http_port = config.http_port;
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", http_port)).await.unwrap();
        tracing::info!("HTTP API server listening on {}", http_port);
        axum::serve(listener, http_router).await.unwrap();
    });

    // Start NotifyListener for cross-instance message routing
    let notify_listener = NotifyListener::new(pool.clone(), router.clone());
    let notify_shutdown = shutdown.clone();
    tokio::spawn(async move {
        if let Err(e) = notify_listener.run(notify_shutdown).await {
            tracing::error!("NotifyListener error: {}", e);
        }
    });
    tracing::info!("NotifyListener started");

    // Start stale cleanup task (runs every minute, cleans pending messages and stale sessions)
    let cleanup_pending_repo = PendingMessageRepo::new(pool.clone());
    let cleanup_session_repo = Repository::new(pool.clone());
    let cleanup_shutdown = shutdown.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {
                    // Cleanup stale pending messages (> 5 minutes)
                    match cleanup_pending_repo.delete_stale(5.0).await {
                        Ok(count) if count > 0 => {
                            tracing::debug!("Cleaned up {} stale pending messages", count);
                        }
                        Err(e) => {
                            tracing::error!("Pending message cleanup error: {}", e);
                        }
                        _ => {}
                    }
                    // Cleanup stale sessions (> 30 minutes, not ended)
                    match cleanup_session_repo.cleanup_stale_sessions(30.0).await {
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
    tracing::info!("Stale cleanup task started (pending messages + sessions)");

    // Handle Ctrl+C for graceful shutdown
    let shutdown_clone = shutdown.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for Ctrl+C");
        tracing::info!("Ctrl+C received, initiating shutdown");
        shutdown_clone.cancel();
    });

    // Run WebSocket server
    run_server(config.ws_port, router, repo, pending_repo, shutdown).await?;

    tracing::info!("Server shutdown complete");
    Ok(())
}