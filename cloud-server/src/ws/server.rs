use tokio::net::TcpListener;
use crate::db::repository::Repository;
use crate::cache::state_cache::StateCache;
use super::router::ConnectionRouter;
use super::connection::handle_connection;

/// Run WebSocket server
pub async fn run_server(
    port: u16,
    router: ConnectionRouter,
    cache: StateCache,
    repo: Repository,
) -> anyhow::Result<()> {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await?;

    tracing::info!("WebSocket server listening on {}", addr);

    loop {
        let (stream, addr) = listener.accept().await?;
        tracing::debug!("New connection from {}", addr);

        // Clone shared state for the connection handler
        let router_clone = router.clone();
        let cache_clone = cache.clone();
        let repo_clone = repo.clone();

        // Spawn a new task for each connection
        tokio::spawn(async move {
            handle_connection(stream, router_clone, cache_clone, repo_clone).await;
        });
    }
}