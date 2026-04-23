// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use tokio::net::TcpListener;
use tokio::time::Duration;
use tokio_util::sync::CancellationToken;
use socket2::{SockRef, TcpKeepalive};
use crate::db::repository::Repository;
use crate::db::pending_message::PendingMessageRepo;
use super::router::ConnectionRouter;
use super::connection::handle_connection;

/// Run WebSocket server on the specified port.
///
/// # Arguments
/// * `port` - Port to listen on
/// * `router` - Connection router for message routing
/// * `repo` - Database repository for persistence
/// * `pending_repo` - Repository for pending messages (cross-instance messaging)
/// * `shutdown` - Token to signal graceful shutdown
///
/// The server will gracefully stop when `shutdown` is cancelled,
/// allowing existing connections to complete their cleanup.
pub async fn run_server(
    port: u16,
    router: ConnectionRouter,
    repo: Repository,
    pending_repo: PendingMessageRepo,
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

                        // Set TCP keepalive to detect zombie connections
                        // 60 seconds idle, then probe every 10 seconds, 3 probes before close
                        let sock_ref = SockRef::from(&stream);
                        let keepalive = TcpKeepalive::new()
                            .with_time(Duration::from_secs(60))
                            .with_interval(Duration::from_secs(10))
                            .with_retries(3);
                        if let Err(e) = sock_ref.set_tcp_keepalive(&keepalive) {
                            tracing::warn!("Failed to set TCP keepalive for {}: {}", addr, e);
                        }

                        // Clone shared state for the connection handler
                        let router_clone = router.clone();
                        let repo_clone = repo.clone();
                        let pending_repo_clone = pending_repo.clone();

                        // Spawn a new task for each connection
                        tokio::spawn(async move {
                            handle_connection(stream, router_clone, repo_clone, pending_repo_clone).await;
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