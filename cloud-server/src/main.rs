mod config;
mod messages;
mod db;
mod cache;
mod ws;

use std::time::Duration;
use tokio_util::sync::CancellationToken;
use config::Config;
use db::pool::create_pool;
use db::repository::Repository;
use cache::state_cache::StateCache;
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
    let repo = Repository::new(pool);
    let cache = StateCache::new();
    let router = ConnectionRouter::new();

    // Create shutdown token
    let shutdown = CancellationToken::new();

    // Spawn TTL cleanup task for StateCache (with shutdown support)
    let cleanup_cache = cache.clone();
    let cleanup_shutdown = shutdown.clone();
    let cleanup_interval = Duration::from_secs(config.cleanup_interval_secs);
    let max_age = config.max_device_age_secs;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(cleanup_interval);
        loop {
            tokio::select! {
                _ = cleanup_shutdown.cancelled() => {
                    tracing::info!("Cache cleanup task shutting down");
                    break;
                }
                _ = interval.tick() => {
                    cleanup_cache.cleanup_stale(max_age);
                    tracing::debug!("Completed stale device cache cleanup");
                }
            }
        }
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
    run_server(config.ws_port, router, cache, repo, shutdown).await?;

    tracing::info!("Server shutdown complete");
    Ok(())
}