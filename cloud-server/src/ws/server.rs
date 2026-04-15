use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use crate::db::repository::Repository;
use crate::cache::state_cache::StateCache;
use super::router::ConnectionRouter;
use super::connection::handle_connection;

/// Run WebSocket server on the specified port.
///
/// # Arguments
/// * `port` - Port to listen on
/// * `router` - Connection router for message routing
/// * `cache` - State cache for device data
/// * `repo` - Database repository for persistence
/// * `shutdown` - Token to signal graceful shutdown
///
/// The server will gracefully stop when `shutdown` is cancelled,
/// allowing existing connections to complete their cleanup.
pub async fn run_server(
    port: u16,
    router: ConnectionRouter,
    cache: StateCache,
    repo: Repository,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await?;

    tracing::info!("WebSocket server listening on {}", addr);

    loop {
        tokio::select! {
            // Accept new connections
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, addr)) => {
                        tracing::debug!("New connection from {}", addr);

                        // Clone shared state for the connection handler
                        let router_clone = router.clone();
                        let cache_clone = cache.clone();
                        let repo_clone = repo.clone();

                        // Spawn a new task for each connection
                        tokio::spawn(async move {
                            handle_connection(stream, router_clone, cache_clone, repo_clone).await;
                        });
                    },
                    Err(e) => {
                        tracing::error!("Accept error: {}", e);
                        // Continue accepting new connections despite transient errors
                        continue;
                    }
                }
            }

            // Handle shutdown signal
            _ = shutdown.cancelled() => {
                tracing::info!("Server shutdown signal received, stopping accept loop");
                break;
            }
        }
    }

    tracing::info!("WebSocket server stopped");
    Ok(())
}