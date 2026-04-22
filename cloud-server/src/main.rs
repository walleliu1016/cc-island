// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
mod config;
mod messages;
mod db;
mod ws;
mod http;

use tokio_util::sync::CancellationToken;
use config::Config;
use db::pool::create_pool;
use db::repository::Repository;
use db::pending_message::PendingMessageRepo;
use ws::router::ConnectionRouter;
use ws::server::run_server;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Load configuration
    let config = Config::from_env()?;

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